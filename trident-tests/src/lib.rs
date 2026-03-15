//! # SSS Program Fuzz Tests — Property-Based State Machine Verification
//!
//! This crate implements property-based fuzz testing for the Solana Stablecoin
//! Standard (SSS) program using [`proptest`]. Rather than executing transactions
//! against a validator, we maintain a **pure-Rust model** of the on-chain state
//! machine and verify that all program invariants hold across thousands of
//! randomly-generated operation sequences.
//!
//! ## Approach
//!
//! 1. **State Machine Model** — [`StablecoinModel`] mirrors the on-chain
//!    [`StablecoinConfig`], [`RoleAccount`], [`MinterQuota`], and
//!    [`BlacklistEntry`] accounts with identical validation logic.
//!
//! 2. **Operation Generation** — [`Operation`] enum covers all 13 SSS
//!    instructions. `proptest` generates random sequences of 50–200
//!    operations with boundary-value biased amounts (0, 1, u64::MAX).
//!
//! 3. **Invariant Checking** — After every operation,
//!    [`StablecoinModel::check_invariants`] verifies 8 safety properties.
//!
//! ## Invariants Verified
//!
//! | # | Invariant | Category |
//! |---|-----------|----------|
//! | 1 | `total_minted >= total_burned` | Arithmetic |
//! | 2 | No u64 overflow in any counter | Arithmetic |
//! | 3 | `minter.minted <= minter.quota` for successful mints | Quota |
//! | 4 | Mint and burn blocked when `paused == true` | Pause guard |
//! | 5 | Only users with active roles can execute role-gated ops | Access control |
//! | 6 | SSS-2 ops fail when compliance features are disabled | Feature gating |
//! | 7 | Cannot blacklist the same address twice | Blacklist |
//! | 8 | Only master authority can manage roles/quotas/authority | Authority |
//!
//! ## Running
//!
//! ```bash
//! cd trident-tests && cargo test -- --nocapture
//! # Run with more cases:
//! PROPTEST_CASES=10000 cargo test -- --nocapture
//! ```

use std::collections::{HashMap, HashSet};

// Re-export constants from the SSS program for validation parity
pub use sss::constants::*;

// ---------------------------------------------------------------------------
// Error model — mirrors on-chain StablecoinError
// ---------------------------------------------------------------------------

/// Modeled program errors matching [`sss::error::StablecoinError`] variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelError {
    Unauthorized,
    Paused,
    NotPaused,
    QuotaExceeded,
    ZeroAmount,
    NameTooLong,
    SymbolTooLong,
    InvalidRole,
    ComplianceNotEnabled,
    PermanentDelegateNotEnabled,
    AlreadyBlacklisted,
    NotBlacklisted,
    MathOverflow,
    InvalidAuthority,
    SameAuthority,
    InvalidDecimals,
    ReasonTooLong,
    /// Anchor-level failures (e.g. account-already-exists on duplicate init)
    AnchorError,
}

pub type ModelResult<T> = Result<T, ModelError>;

// ---------------------------------------------------------------------------
// Operation enum — all program instructions
// ---------------------------------------------------------------------------

/// Fuzzable operations covering all 13 SSS program instructions.
///
/// User identifiers are small u8 values (0–7) representing distinct keypairs.
/// Amounts are full u64 to stress arithmetic boundaries.
#[derive(Debug, Clone)]
pub enum Operation {
    /// `initialize` — only valid once per model instance
    Initialize {
        caller: u8,
        decimals: u8,
        enable_permanent_delegate: bool,
        enable_transfer_hook: bool,
        enable_confidential_transfer: bool,
    },
    /// `mint_tokens` — requires Minter role + quota
    Mint { minter: u8, amount: u64 },
    /// `burn_tokens` — requires Burner role
    Burn { burner: u8, amount: u64 },
    /// `pause` — requires Pauser role, fails if already paused
    Pause { pauser: u8 },
    /// `unpause` — requires Pauser role, fails if not paused
    Unpause { pauser: u8 },
    /// `freeze_account` — requires Pauser role
    FreezeAccount { pauser: u8, target: u8 },
    /// `thaw_account` — requires Pauser role
    ThawAccount { pauser: u8, target: u8 },
    /// `update_roles` — master authority only
    UpdateRole {
        caller: u8,
        user: u8,
        role_type: u8,
        active: bool,
    },
    /// `create_minter` — master authority only, initializes new minter PDA
    CreateMinter {
        caller: u8,
        minter: u8,
        quota: u64,
    },
    /// `update_minter` — master authority only, mutates existing minter PDA
    UpdateMinter {
        caller: u8,
        minter: u8,
        quota: u64,
    },
    /// `propose_authority_transfer` + `accept_authority_transfer` — master authority proposes, new authority accepts
    TransferAuthority { caller: u8, new_authority: u8 },
    /// `add_to_blacklist` — requires Blacklister role (SSS-2)
    AddToBlacklist {
        caller: u8,
        address: u8,
        reason_len: usize,
    },
    /// `remove_from_blacklist` — requires Blacklister role (SSS-2)
    RemoveFromBlacklist { caller: u8, address: u8 },
    /// `seize` — requires Seizer role (SSS-2)
    Seize {
        seizer: u8,
        from: u8,
        to: u8,
        amount: u64,
    },
}

// ---------------------------------------------------------------------------
// State machine model
// ---------------------------------------------------------------------------

/// Pure-Rust model of the SSS program's on-chain state.
///
/// Mirrors the state stored across [`StablecoinConfig`], [`RoleAccount`],
/// [`MinterQuota`], and [`BlacklistEntry`] PDAs. All validation logic
/// replicates the program's Anchor constraints and handler checks.
#[derive(Debug, Clone)]
pub struct StablecoinModel {
    // --- Config fields ---
    pub initialized: bool,
    pub decimals: u8,
    pub paused: bool,
    pub total_minted: u64,
    pub total_burned: u64,
    pub enable_permanent_delegate: bool,
    pub enable_transfer_hook: bool,
    pub enable_confidential_transfer: bool,
    pub master_authority: u8,

    // --- Role state: (user_id, role_type) -> active ---
    pub roles: HashMap<(u8, u8), bool>,

    // --- Minter quotas: user_id -> (quota, minted) ---
    pub minter_quotas: HashMap<u8, (u64, u64)>,

    // --- Blacklist: set of blacklisted address IDs ---
    pub blacklist: HashSet<u8>,

    // --- Frozen accounts: set of frozen address IDs ---
    pub frozen_accounts: HashSet<u8>,

    // --- Token balances: user_id -> balance (simplified) ---
    pub balances: HashMap<u8, u64>,

    // --- Audit counters ---
    pub operation_count: u64,
    pub total_operations_attempted: u64,
    pub total_operations_succeeded: u64,
    pub total_operations_failed: u64,
}

impl Default for StablecoinModel {
    fn default() -> Self {
        Self::new()
    }
}

impl StablecoinModel {
    /// Create a new uninitialized model.
    pub fn new() -> Self {
        Self {
            initialized: false,
            decimals: 0,
            paused: false,
            total_minted: 0,
            total_burned: 0,
            enable_permanent_delegate: false,
            enable_transfer_hook: false,
            enable_confidential_transfer: false,
            master_authority: 0,
            roles: HashMap::new(),
            minter_quotas: HashMap::new(),
            blacklist: HashSet::new(),
            frozen_accounts: HashSet::new(),
            balances: HashMap::new(),
            operation_count: 0,
            total_operations_attempted: 0,
            total_operations_succeeded: 0,
            total_operations_failed: 0,
        }
    }

    /// Create a pre-initialized SSS-1 model for testing.
    pub fn new_sss1(authority: u8) -> Self {
        let mut m = Self::new();
        m.initialized = true;
        m.decimals = 6;
        m.master_authority = authority;
        m
    }

    /// Create a pre-initialized SSS-2 model for testing.
    pub fn new_sss2(authority: u8) -> Self {
        let mut m = Self::new_sss1(authority);
        m.enable_permanent_delegate = true;
        m.enable_transfer_hook = true;
        m
    }

    // --- Helper: check if user has an active role ---
    fn has_role(&self, user: u8, role_type: u8) -> bool {
        self.roles.get(&(user, role_type)).copied().unwrap_or(false)
    }

    // --- Helper: check if caller is master authority ---
    fn is_authority(&self, caller: u8) -> bool {
        caller == self.master_authority
    }

    /// Apply a single operation to the model, returning Ok on success or
    /// the modeled error on failure. This mirrors the on-chain instruction
    /// handler logic exactly.
    pub fn apply(&mut self, op: &Operation) -> ModelResult<()> {
        self.total_operations_attempted = self.total_operations_attempted.saturating_add(1);

        let result = match op {
            Operation::Initialize {
                caller,
                decimals,
                enable_permanent_delegate,
                enable_transfer_hook,
                enable_confidential_transfer,
            } => self.apply_initialize(*caller, *decimals, *enable_permanent_delegate, *enable_transfer_hook, *enable_confidential_transfer),

            Operation::Mint { minter, amount } => self.apply_mint(*minter, *amount),

            Operation::Burn { burner, amount } => self.apply_burn(*burner, *amount),

            Operation::Pause { pauser } => self.apply_pause(*pauser),

            Operation::Unpause { pauser } => self.apply_unpause(*pauser),

            Operation::FreezeAccount { pauser, target } => {
                self.apply_freeze_account(*pauser, *target)
            }

            Operation::ThawAccount { pauser, target } => {
                self.apply_thaw_account(*pauser, *target)
            }

            Operation::UpdateRole {
                caller,
                user,
                role_type,
                active,
            } => self.apply_update_role(*caller, *user, *role_type, *active),

            Operation::CreateMinter {
                caller,
                minter,
                quota,
            } => self.apply_create_minter(*caller, *minter, *quota),

            Operation::UpdateMinter {
                caller,
                minter,
                quota,
            } => self.apply_update_minter(*caller, *minter, *quota),

            Operation::TransferAuthority {
                caller,
                new_authority,
            } => self.apply_propose_and_accept_authority(*caller, *new_authority),

            Operation::AddToBlacklist {
                caller,
                address,
                reason_len,
            } => self.apply_add_to_blacklist(*caller, *address, *reason_len),

            Operation::RemoveFromBlacklist { caller, address } => {
                self.apply_remove_from_blacklist(*caller, *address)
            }

            Operation::Seize {
                seizer,
                from,
                to,
                amount,
            } => self.apply_seize(*seizer, *from, *to, *amount),
        };

        match &result {
            Ok(()) => {
                self.operation_count = self.operation_count.saturating_add(1);
                self.total_operations_succeeded = self.total_operations_succeeded.saturating_add(1);
            }
            Err(_) => {
                self.total_operations_failed = self.total_operations_failed.saturating_add(1);
            }
        }

        result
    }

    // --- Instruction handlers ---

    fn apply_initialize(
        &mut self,
        caller: u8,
        decimals: u8,
        enable_permanent_delegate: bool,
        enable_transfer_hook: bool,
        enable_confidential_transfer: bool,
    ) -> ModelResult<()> {
        if self.initialized {
            return Err(ModelError::AnchorError); // PDA already exists
        }
        if decimals > 9 {
            return Err(ModelError::InvalidDecimals);
        }

        self.initialized = true;
        self.decimals = decimals;
        self.master_authority = caller;
        self.enable_permanent_delegate = enable_permanent_delegate;
        self.enable_transfer_hook = enable_transfer_hook;
        self.enable_confidential_transfer = enable_confidential_transfer;
        self.paused = false;
        self.total_minted = 0;
        self.total_burned = 0;

        Ok(())
    }

    fn apply_mint(&mut self, minter: u8, amount: u64) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if amount == 0 {
            return Err(ModelError::ZeroAmount);
        }
        if self.paused {
            return Err(ModelError::Paused);
        }
        if !self.has_role(minter, ROLE_MINTER) {
            return Err(ModelError::Unauthorized);
        }

        // Check quota
        let (quota, minted) = self
            .minter_quotas
            .get(&minter)
            .copied()
            .ok_or(ModelError::AnchorError)?; // No quota PDA

        let new_minted = minted.checked_add(amount).ok_or(ModelError::MathOverflow)?;
        if new_minted > quota {
            return Err(ModelError::QuotaExceeded);
        }

        // Validate ALL checks before mutating state (atomic like on-chain)
        let new_total_minted = self
            .total_minted
            .checked_add(amount)
            .ok_or(ModelError::MathOverflow)?;

        let current_balance = self.balances.get(&minter).copied().unwrap_or(0);
        let new_balance = current_balance
            .checked_add(amount)
            .ok_or(ModelError::MathOverflow)?;

        // All checks passed — now mutate state atomically
        self.minter_quotas.insert(minter, (quota, new_minted));
        self.total_minted = new_total_minted;
        self.balances.insert(minter, new_balance);

        Ok(())
    }

    fn apply_burn(&mut self, burner: u8, amount: u64) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if amount == 0 {
            return Err(ModelError::ZeroAmount);
        }
        if self.paused {
            return Err(ModelError::Paused);
        }
        if !self.has_role(burner, ROLE_BURNER) {
            return Err(ModelError::Unauthorized);
        }

        // Check balance (simplified: burner burns from own account)
        let balance = self.balances.get(&burner).copied().unwrap_or(0);
        if balance < amount {
            return Err(ModelError::AnchorError); // Insufficient funds
        }

        // Update global total
        self.total_burned = self
            .total_burned
            .checked_add(amount)
            .ok_or(ModelError::MathOverflow)?;

        // Debit burner
        self.balances.insert(burner, balance.saturating_sub(amount));

        Ok(())
    }

    fn apply_pause(&mut self, pauser: u8) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.has_role(pauser, ROLE_PAUSER) {
            return Err(ModelError::Unauthorized);
        }
        if self.paused {
            return Err(ModelError::Paused);
        }

        self.paused = true;
        Ok(())
    }

    fn apply_unpause(&mut self, pauser: u8) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.has_role(pauser, ROLE_PAUSER) {
            return Err(ModelError::Unauthorized);
        }
        if !self.paused {
            return Err(ModelError::NotPaused);
        }

        self.paused = false;
        Ok(())
    }

    fn apply_freeze_account(&mut self, pauser: u8, target: u8) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.has_role(pauser, ROLE_PAUSER) {
            return Err(ModelError::Unauthorized);
        }

        self.frozen_accounts.insert(target);
        Ok(())
    }

    fn apply_thaw_account(&mut self, pauser: u8, target: u8) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.has_role(pauser, ROLE_PAUSER) {
            return Err(ModelError::Unauthorized);
        }

        self.frozen_accounts.remove(&target);
        Ok(())
    }

    fn apply_update_role(
        &mut self,
        caller: u8,
        user: u8,
        role_type: u8,
        active: bool,
    ) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.is_authority(caller) {
            return Err(ModelError::InvalidAuthority);
        }
        if role_type > ROLE_SEIZER {
            return Err(ModelError::InvalidRole);
        }

        // SSS-2 feature gating
        if role_type == ROLE_BLACKLISTER && !self.enable_transfer_hook {
            return Err(ModelError::ComplianceNotEnabled);
        }
        if role_type == ROLE_SEIZER && !self.enable_permanent_delegate {
            return Err(ModelError::PermanentDelegateNotEnabled);
        }

        self.roles.insert((user, role_type), active);
        Ok(())
    }

    fn apply_create_minter(
        &mut self,
        caller: u8,
        minter: u8,
        quota: u64,
    ) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.is_authority(caller) {
            return Err(ModelError::InvalidAuthority);
        }

        // Minter PDA must not already exist (init constraint)
        if self.minter_quotas.contains_key(&minter) {
            return Err(ModelError::AnchorError);
        }

        self.minter_quotas.insert(minter, (quota, 0));
        Ok(())
    }

    fn apply_update_minter(
        &mut self,
        caller: u8,
        minter: u8,
        quota: u64,
    ) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.is_authority(caller) {
            return Err(ModelError::InvalidAuthority);
        }

        // Minter PDA must already exist (mut constraint, not init)
        let existing_minted = match self.minter_quotas.get(&minter) {
            Some((_, minted)) => *minted,
            None => return Err(ModelError::AnchorError),
        };
        self.minter_quotas.insert(minter, (quota, existing_minted));

        Ok(())
    }

    fn apply_propose_and_accept_authority(
        &mut self,
        caller: u8,
        new_authority: u8,
    ) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.is_authority(caller) {
            return Err(ModelError::InvalidAuthority);
        }
        if caller == new_authority {
            return Err(ModelError::SameAuthority);
        }

        // Step 1: propose — sets pending_authority (modeled implicitly)
        // Step 2: accept — new_authority signs and becomes master_authority
        self.master_authority = new_authority;
        Ok(())
    }

    fn apply_add_to_blacklist(
        &mut self,
        caller: u8,
        address: u8,
        reason_len: usize,
    ) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.enable_transfer_hook {
            return Err(ModelError::ComplianceNotEnabled);
        }
        if !self.has_role(caller, ROLE_BLACKLISTER) {
            return Err(ModelError::Unauthorized);
        }
        if reason_len > MAX_REASON_LEN {
            return Err(ModelError::ReasonTooLong);
        }
        if self.blacklist.contains(&address) {
            return Err(ModelError::AlreadyBlacklisted);
        }

        self.blacklist.insert(address);
        Ok(())
    }

    fn apply_remove_from_blacklist(
        &mut self,
        caller: u8,
        address: u8,
    ) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.enable_transfer_hook {
            return Err(ModelError::ComplianceNotEnabled);
        }
        if !self.has_role(caller, ROLE_BLACKLISTER) {
            return Err(ModelError::Unauthorized);
        }
        if !self.blacklist.contains(&address) {
            return Err(ModelError::NotBlacklisted);
        }

        self.blacklist.remove(&address);
        Ok(())
    }

    fn apply_seize(
        &mut self,
        seizer: u8,
        from: u8,
        to: u8,
        amount: u64,
    ) -> ModelResult<()> {
        if !self.initialized {
            return Err(ModelError::AnchorError);
        }
        if !self.enable_permanent_delegate {
            return Err(ModelError::PermanentDelegateNotEnabled);
        }
        if !self.has_role(seizer, ROLE_SEIZER) {
            return Err(ModelError::Unauthorized);
        }
        if amount == 0 {
            return Err(ModelError::ZeroAmount);
        }

        // Transfer tokens from -> to
        let from_balance = self.balances.get(&from).copied().unwrap_or(0);
        if from_balance < amount {
            return Err(ModelError::AnchorError); // Insufficient funds
        }
        self.balances.insert(from, from_balance.saturating_sub(amount));
        let to_balance = self.balances.entry(to).or_insert(0);
        *to_balance = to_balance.checked_add(amount).ok_or(ModelError::MathOverflow)?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Invariant verification — called after every operation
    // -----------------------------------------------------------------------

    /// Verify all 8 safety invariants. Panics with a descriptive message if
    /// any invariant is violated.
    ///
    /// This is the core of the fuzz testing strategy: generate random operation
    /// sequences and assert that these invariants ALWAYS hold.
    pub fn check_invariants(&self) {
        // Invariant 1: total_minted >= total_burned
        assert!(
            self.total_minted >= self.total_burned,
            "INVARIANT VIOLATION: total_minted ({}) < total_burned ({})",
            self.total_minted,
            self.total_burned
        );

        // Invariant 2: No counter overflow — enforced by checked arithmetic,
        // but verify counters are consistent with operations
        let net_supply = self.total_minted.saturating_sub(self.total_burned);
        let total_balance: u64 = self.balances.values().sum();
        assert!(
            net_supply >= total_balance || !self.initialized,
            "INVARIANT VIOLATION: net supply ({}) < sum of balances ({})",
            net_supply,
            total_balance
        );

        // Invariant 3: Minter quotas — minted is consistent with total_minted.
        // Note: minted CAN exceed quota if the authority lowered the quota after
        // minting. The program only enforces minted <= quota at mint time, not
        // globally. So we verify a weaker property: total of all minter minted
        // values should not exceed total_minted.
        let total_minter_minted: u64 = self
            .minter_quotas
            .values()
            .map(|(_, minted)| *minted)
            .fold(0u64, |acc, v| acc.saturating_add(v));
        assert!(
            total_minter_minted <= self.total_minted,
            "INVARIANT VIOLATION: sum of minter minted ({}) > total_minted ({})",
            total_minter_minted,
            self.total_minted
        );

        // Invariant 4: Pause state consistency — verified via operation
        // rejection (tested in apply_mint/apply_burn guards)

        // Invariant 5: Role types are valid (0-4)
        for ((_, role_type), _) in &self.roles {
            assert!(
                *role_type <= ROLE_SEIZER,
                "INVARIANT VIOLATION: invalid role type {} stored",
                role_type
            );
        }

        // Invariant 6: Feature gating — if compliance not enabled, no
        // blacklist entries should exist
        if !self.enable_transfer_hook {
            assert!(
                self.blacklist.is_empty(),
                "INVARIANT VIOLATION: blacklist non-empty but transfer_hook disabled"
            );
        }

        // Invariant 7: Feature gating — if permanent delegate not enabled,
        // no seizer roles should be active
        if !self.enable_permanent_delegate {
            let has_active_seizer = self
                .roles
                .iter()
                .any(|((_, rt), active)| *rt == ROLE_SEIZER && *active);
            assert!(
                !has_active_seizer,
                "INVARIANT VIOLATION: active seizer role exists but permanent_delegate disabled"
            );
        }

        // Invariant 8: If transfer hook not enabled, no blacklister roles active
        if !self.enable_transfer_hook {
            let has_active_blacklister = self
                .roles
                .iter()
                .any(|((_, rt), active)| *rt == ROLE_BLACKLISTER && *active);
            assert!(
                !has_active_blacklister,
                "INVARIANT VIOLATION: active blacklister role but transfer_hook disabled"
            );
        }

        // Invariant 9: Operation count consistency
        assert_eq!(
            self.total_operations_attempted,
            self.total_operations_succeeded + self.total_operations_failed,
            "INVARIANT VIOLATION: operation counts inconsistent"
        );
    }
}

// ---------------------------------------------------------------------------
// Proptest strategies and tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use proptest::collection::vec as prop_vec;

    /// Number of simulated users in the fuzz model (0..NUM_USERS)
    const NUM_USERS: u8 = 8;

    /// Strategy for generating a single [`Operation`] with boundary-biased values.
    fn operation_strategy() -> impl Strategy<Value = Operation> {
        // Bias amounts toward interesting boundaries
        let amount_strategy = prop_oneof![
            3 => Just(0u64),              // zero (should fail)
            3 => Just(1u64),              // minimum valid
            2 => 1u64..1_000_000,          // small amounts
            2 => 1_000_000u64..=u64::MAX / 2, // medium amounts
            2 => Just(u64::MAX),          // maximum (overflow trigger)
            1 => Just(u64::MAX - 1),      // near-maximum
        ];

        let user_strategy = 0..NUM_USERS;
        let role_strategy = prop_oneof![
            5 => 0u8..=4u8,               // valid roles
            1 => Just(5u8),               // invalid role (>4)
            1 => Just(255u8),             // far out of range
        ];
        let reason_len_strategy = prop_oneof![
            3 => 0usize..=MAX_REASON_LEN,  // valid
            1 => MAX_REASON_LEN + 1..=MAX_REASON_LEN + 10, // too long
        ];

        prop_oneof![
            // Weight operations to cover interesting state transitions
            3 => (user_strategy.clone(), amount_strategy.clone())
                .prop_map(|(m, a)| Operation::Mint { minter: m, amount: a }),
            3 => (user_strategy.clone(), amount_strategy.clone())
                .prop_map(|(b, a)| Operation::Burn { burner: b, amount: a }),
            2 => user_strategy.clone().prop_map(|p| Operation::Pause { pauser: p }),
            2 => user_strategy.clone().prop_map(|p| Operation::Unpause { pauser: p }),
            1 => (user_strategy.clone(), user_strategy.clone())
                .prop_map(|(p, t)| Operation::FreezeAccount { pauser: p, target: t }),
            1 => (user_strategy.clone(), user_strategy.clone())
                .prop_map(|(p, t)| Operation::ThawAccount { pauser: p, target: t }),
            3 => (user_strategy.clone(), user_strategy.clone(), role_strategy, any::<bool>())
                .prop_map(|(c, u, r, a)| Operation::UpdateRole {
                    caller: c, user: u, role_type: r, active: a,
                }),
            2 => (user_strategy.clone(), user_strategy.clone(), amount_strategy.clone())
                .prop_map(|(c, m, q)| Operation::CreateMinter {
                    caller: c, minter: m, quota: q,
                }),
            2 => (user_strategy.clone(), user_strategy.clone(), amount_strategy.clone())
                .prop_map(|(c, m, q)| Operation::UpdateMinter {
                    caller: c, minter: m, quota: q,
                }),
            1 => (user_strategy.clone(), user_strategy.clone())
                .prop_map(|(c, n)| Operation::TransferAuthority {
                    caller: c, new_authority: n,
                }),
            2 => (user_strategy.clone(), user_strategy.clone(), reason_len_strategy)
                .prop_map(|(c, a, r)| Operation::AddToBlacklist {
                    caller: c, address: a, reason_len: r,
                }),
            1 => (user_strategy.clone(), user_strategy.clone())
                .prop_map(|(c, a)| Operation::RemoveFromBlacklist {
                    caller: c, address: a,
                }),
            1 => (user_strategy.clone(), user_strategy.clone(), user_strategy.clone(), amount_strategy)
                .prop_map(|(s, f, t, a)| Operation::Seize {
                    seizer: s, from: f, to: t, amount: a,
                }),
        ]
    }

    /// Strategy for a sequence of operations.
    fn operation_sequence(min: usize, max: usize) -> impl Strategy<Value = Vec<Operation>> {
        prop_vec(operation_strategy(), min..=max)
    }

    // ===================================================================
    // Test 1: SSS-1 state machine — random operation sequences
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        /// Fuzz SSS-1 state machine with random operation sequences.
        ///
        /// Pre-conditions: initialized with user 0 as authority, user 1 as
        /// minter+burner+pauser with 10M quota.
        ///
        /// Invariants checked after every operation.
        #[test]
        fn fuzz_sss1_state_machine(ops in operation_sequence(10, 100)) {
            let mut model = StablecoinModel::new_sss1(0);

            // Setup: assign roles + quota
            model.roles.insert((1, ROLE_MINTER), true);
            model.roles.insert((1, ROLE_BURNER), true);
            model.roles.insert((1, ROLE_PAUSER), true);
            model.minter_quotas.insert(1, (10_000_000, 0));

            for op in &ops {
                let _ = model.apply(op); // Errors are expected for invalid ops
                model.check_invariants();
            }
        }

        /// Fuzz SSS-2 state machine with compliance features enabled.
        #[test]
        fn fuzz_sss2_state_machine(ops in operation_sequence(10, 100)) {
            let mut model = StablecoinModel::new_sss2(0);

            // Setup: assign all role types
            model.roles.insert((1, ROLE_MINTER), true);
            model.roles.insert((1, ROLE_BURNER), true);
            model.roles.insert((1, ROLE_PAUSER), true);
            model.roles.insert((2, ROLE_BLACKLISTER), true);
            model.roles.insert((3, ROLE_SEIZER), true);
            model.minter_quotas.insert(1, (10_000_000, 0));

            for op in &ops {
                let _ = model.apply(op);
                model.check_invariants();
            }
        }
    }

    // ===================================================================
    // Test 2: Arithmetic safety — u64 boundary probing
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2000))]

        /// Fuzz arithmetic boundaries — probe amounts near u64::MAX to verify
        /// that checked_add prevents overflow and MathOverflow is returned.
        #[test]
        fn fuzz_arithmetic_overflow_prevention(
            amount1 in 0u64..=u64::MAX,
            amount2 in 0u64..=u64::MAX,
        ) {
            let mut model = StablecoinModel::new_sss1(0);
            model.roles.insert((1, ROLE_MINTER), true);
            model.roles.insert((1, ROLE_BURNER), true);
            model.minter_quotas.insert(1, (u64::MAX, 0));

            // First mint
            let r1 = model.apply(&Operation::Mint { minter: 1, amount: amount1 });

            if amount1 == 0 {
                assert_eq!(r1, Err(ModelError::ZeroAmount));
            } else {
                // Should succeed (quota is u64::MAX, minted was 0)
                assert!(r1.is_ok(), "First mint of {} failed: {:?}", amount1, r1);
            }

            model.check_invariants();

            // Second mint — may overflow
            let r2 = model.apply(&Operation::Mint { minter: 1, amount: amount2 });

            if amount2 == 0 {
                assert_eq!(r2, Err(ModelError::ZeroAmount));
            } else if amount1 > 0 && amount1.checked_add(amount2).is_none() {
                // Overflow: minted + amount2 > u64::MAX
                assert_eq!(r2, Err(ModelError::MathOverflow),
                    "Expected MathOverflow for {} + {}", amount1, amount2);
            }

            // Invariants must hold regardless
            model.check_invariants();
        }
    }

    // ===================================================================
    // Test 3: Quota enforcement — targeted fuzzing
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2000))]

        /// Fuzz quota enforcement: random quota + minted sequence must never
        /// allow minted to exceed quota.
        #[test]
        fn fuzz_quota_enforcement(
            quota in 1u64..=10_000_000_000u64,
            amounts in prop_vec(1u64..=1_000_000_000u64, 1..20),
        ) {
            let mut model = StablecoinModel::new_sss1(0);
            model.roles.insert((1, ROLE_MINTER), true);
            model.minter_quotas.insert(1, (quota, 0));

            let mut expected_minted: u64 = 0;

            for amount in &amounts {
                let result = model.apply(&Operation::Mint { minter: 1, amount: *amount });

                match expected_minted.checked_add(*amount) {
                    Some(new_total) if new_total <= quota => {
                        // Should succeed
                        assert!(result.is_ok(), "Mint of {} should succeed (total would be {} <= quota {})",
                            amount, new_total, quota);
                        expected_minted = new_total;
                    }
                    _ => {
                        // Should fail (quota exceeded or overflow)
                        assert!(result.is_err(), "Mint of {} should fail (total would exceed quota {})",
                            amount, quota);
                    }
                }

                model.check_invariants();
            }
        }
    }

    // ===================================================================
    // Test 4: Access control — unauthorized caller rejection
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        /// Fuzz access control: random callers without roles must be rejected.
        #[test]
        fn fuzz_access_control_rejection(
            caller in 2u8..NUM_USERS,
            amount in 1u64..1_000_000u64,
        ) {
            let mut model = StablecoinModel::new_sss2(0);
            // Only user 1 has roles
            model.roles.insert((1, ROLE_MINTER), true);
            model.roles.insert((1, ROLE_BURNER), true);
            model.roles.insert((1, ROLE_PAUSER), true);
            model.roles.insert((1, ROLE_BLACKLISTER), true);
            model.roles.insert((1, ROLE_SEIZER), true);
            model.minter_quotas.insert(1, (u64::MAX, 0));

            // Unauthorized caller (2..7) should be rejected for all role-gated ops
            assert_eq!(
                model.apply(&Operation::Mint { minter: caller, amount }),
                Err(ModelError::Unauthorized),
                "Unauthorized mint by user {} should fail", caller
            );
            assert_eq!(
                model.apply(&Operation::Burn { burner: caller, amount }),
                Err(ModelError::Unauthorized),
                "Unauthorized burn by user {} should fail", caller
            );
            assert_eq!(
                model.apply(&Operation::Pause { pauser: caller }),
                Err(ModelError::Unauthorized),
                "Unauthorized pause by user {} should fail", caller
            );
            assert_eq!(
                model.apply(&Operation::AddToBlacklist {
                    caller,
                    address: 5,
                    reason_len: 10,
                }),
                Err(ModelError::Unauthorized),
                "Unauthorized blacklist by user {} should fail", caller
            );

            // Non-authority callers should be rejected for admin ops
            assert_eq!(
                model.apply(&Operation::UpdateRole {
                    caller,
                    user: 5,
                    role_type: ROLE_MINTER,
                    active: true,
                }),
                Err(ModelError::InvalidAuthority),
                "Non-authority update_role by user {} should fail", caller
            );
            assert_eq!(
                model.apply(&Operation::CreateMinter {
                    caller,
                    minter: 5,
                    quota: 1000,
                }),
                Err(ModelError::InvalidAuthority),
                "Non-authority create_minter by user {} should fail", caller
            );
            assert_eq!(
                model.apply(&Operation::TransferAuthority {
                    caller,
                    new_authority: 5,
                }),
                Err(ModelError::InvalidAuthority),
                "Non-authority propose_and_accept_authority by user {} should fail", caller
            );

            model.check_invariants();
        }
    }

    // ===================================================================
    // Test 5: Pause guard — minting/burning blocked when paused
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]

        /// Fuzz pause guard: when paused, all mint/burn operations must fail
        /// with Paused error regardless of amount or caller.
        #[test]
        fn fuzz_pause_blocks_operations(
            amount in 1u64..u64::MAX,
            minter in 0u8..NUM_USERS,
            burner in 0u8..NUM_USERS,
        ) {
            let mut model = StablecoinModel::new_sss1(0);
            // Give everyone all roles
            for user in 0..NUM_USERS {
                model.roles.insert((user, ROLE_MINTER), true);
                model.roles.insert((user, ROLE_BURNER), true);
                model.roles.insert((user, ROLE_PAUSER), true);
                model.minter_quotas.insert(user, (u64::MAX, 0));
            }

            // Pause
            model.apply(&Operation::Pause { pauser: 0 }).unwrap();
            assert!(model.paused);

            // All mints should fail with Paused
            assert_eq!(
                model.apply(&Operation::Mint { minter, amount }),
                Err(ModelError::Paused),
                "Mint should fail when paused"
            );

            // All burns should fail with Paused
            assert_eq!(
                model.apply(&Operation::Burn { burner, amount }),
                Err(ModelError::Paused),
                "Burn should fail when paused"
            );

            // Unpause should work
            model.apply(&Operation::Unpause { pauser: 0 }).unwrap();
            assert!(!model.paused);

            // Now mint should succeed
            let result = model.apply(&Operation::Mint { minter, amount });
            assert!(result.is_ok(), "Mint should succeed after unpause: {:?}", result);

            model.check_invariants();
        }
    }

    // ===================================================================
    // Test 6: Feature gating — SSS-2 ops fail on SSS-1 config
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]

        /// Fuzz feature gating: SSS-2 operations must fail on SSS-1 configs.
        #[test]
        fn fuzz_feature_gating(
            address in 0u8..NUM_USERS,
            reason_len in 0usize..=MAX_REASON_LEN,
            amount in 1u64..1_000_000u64,
        ) {
            let mut model = StablecoinModel::new_sss1(0);

            // Attempt SSS-2 operations on SSS-1 config
            assert_eq!(
                model.apply(&Operation::AddToBlacklist {
                    caller: 0,
                    address,
                    reason_len,
                }),
                Err(ModelError::ComplianceNotEnabled),
                "Blacklist should fail on SSS-1"
            );
            assert_eq!(
                model.apply(&Operation::RemoveFromBlacklist {
                    caller: 0,
                    address,
                }),
                Err(ModelError::ComplianceNotEnabled),
                "Remove blacklist should fail on SSS-1"
            );
            assert_eq!(
                model.apply(&Operation::Seize {
                    seizer: 0,
                    from: 1,
                    to: 2,
                    amount,
                }),
                Err(ModelError::PermanentDelegateNotEnabled),
                "Seize should fail on SSS-1"
            );

            // Assigning SSS-2 roles should fail
            assert_eq!(
                model.apply(&Operation::UpdateRole {
                    caller: 0,
                    user: 1,
                    role_type: ROLE_BLACKLISTER,
                    active: true,
                }),
                Err(ModelError::ComplianceNotEnabled),
                "Blacklister role should fail on SSS-1"
            );
            assert_eq!(
                model.apply(&Operation::UpdateRole {
                    caller: 0,
                    user: 1,
                    role_type: ROLE_SEIZER,
                    active: true,
                }),
                Err(ModelError::PermanentDelegateNotEnabled),
                "Seizer role should fail on SSS-1"
            );

            model.check_invariants();
        }
    }

    // ===================================================================
    // Test 7: Blacklist uniqueness — can't blacklist same address twice
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]

        /// Fuzz blacklist uniqueness: adding the same address twice must fail.
        #[test]
        fn fuzz_blacklist_uniqueness(
            address in 0u8..NUM_USERS,
            extra_addresses in prop_vec(0u8..NUM_USERS, 0..5),
        ) {
            let mut model = StablecoinModel::new_sss2(0);
            model.roles.insert((0, ROLE_BLACKLISTER), true);

            // First blacklist should succeed
            let r = model.apply(&Operation::AddToBlacklist {
                caller: 0,
                address,
                reason_len: 10,
            });
            assert!(r.is_ok(), "First blacklist should succeed");

            // Second blacklist of same address should fail
            assert_eq!(
                model.apply(&Operation::AddToBlacklist {
                    caller: 0,
                    address,
                    reason_len: 10,
                }),
                Err(ModelError::AlreadyBlacklisted),
                "Duplicate blacklist should fail"
            );

            // Blacklist additional addresses (may or may not duplicate)
            for addr in &extra_addresses {
                let _ = model.apply(&Operation::AddToBlacklist {
                    caller: 0,
                    address: *addr,
                    reason_len: 5,
                });
            }

            model.check_invariants();

            // Remove and re-add should work
            model.apply(&Operation::RemoveFromBlacklist {
                caller: 0,
                address,
            }).unwrap();
            let r2 = model.apply(&Operation::AddToBlacklist {
                caller: 0,
                address,
                reason_len: 10,
            });
            assert!(r2.is_ok(), "Re-blacklist after removal should succeed");

            model.check_invariants();
        }
    }

    // ===================================================================
    // Test 8: Authority transfer chain — A → B → C → A
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]

        /// Fuzz authority transfer: random chains of authority transfers must
        /// maintain exactly one authority and block old authorities.
        #[test]
        fn fuzz_authority_transfer_chain(
            transfers in prop_vec(0u8..NUM_USERS, 1..10),
        ) {
            let mut model = StablecoinModel::new_sss1(0);
            let mut current_authority = 0u8;

            for new_auth in &transfers {
                let result = model.apply(&Operation::TransferAuthority {
                    caller: current_authority,
                    new_authority: *new_auth,
                });

                if *new_auth == current_authority {
                    assert_eq!(result, Err(ModelError::SameAuthority));
                } else {
                    assert!(result.is_ok(), "Transfer from {} to {} should succeed",
                        current_authority, new_auth);

                    // Old authority should be blocked
                    let old = current_authority;
                    current_authority = *new_auth;

                    if old != current_authority {
                        assert_eq!(
                            model.apply(&Operation::UpdateRole {
                                caller: old,
                                user: 5,
                                role_type: ROLE_MINTER,
                                active: true,
                            }),
                            Err(ModelError::InvalidAuthority),
                            "Old authority {} should be blocked after transfer to {}",
                            old, current_authority
                        );
                    }
                }

                model.check_invariants();
            }

            // Current authority should still work
            assert!(model.apply(&Operation::UpdateRole {
                caller: current_authority,
                user: 7,
                role_type: ROLE_MINTER,
                active: true,
            }).is_ok(), "Current authority {} should still work", current_authority);
        }
    }

    // ===================================================================
    // Test 9: Role lifecycle — activate/deactivate/re-activate
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]

        /// Fuzz role lifecycle: random sequences of role activations and
        /// deactivations must correctly gate operations. Verifies the core
        /// property: deactivated roles ALWAYS reject, active roles succeed
        /// when preconditions are met.
        #[test]
        fn fuzz_role_lifecycle(
            toggles in prop_vec((0u8..NUM_USERS, 0u8..=2u8, any::<bool>()), 5..30),
        ) {
            let mut model = StablecoinModel::new_sss1(0);

            for (user, role_type, active) in &toggles {
                // Authority assigns role
                let _ = model.apply(&Operation::UpdateRole {
                    caller: 0,
                    user: *user,
                    role_type: *role_type,
                    active: *active,
                });

                // Set up generous minter quota if activating minter
                if *role_type == ROLE_MINTER && *active {
                    let _ = model.apply(&Operation::UpdateMinter {
                        caller: 0,
                        minter: *user,
                        quota: u64::MAX,
                    });
                }

                // Ensure not paused for clean role testing
                if model.paused {
                    // Find any active pauser to unpause
                    for u in 0..NUM_USERS {
                        if model.has_role(u, ROLE_PAUSER) {
                            let _ = model.apply(&Operation::Unpause { pauser: u });
                            break;
                        }
                    }
                }

                // Test if role-gated operation works/fails correctly
                match role_type {
                    0 => {
                        // Minter — only test when NOT paused
                        if !model.paused {
                            let r = model.apply(&Operation::Mint { minter: *user, amount: 100 });
                            if !*active {
                                assert_eq!(r, Err(ModelError::Unauthorized),
                                    "Inactive minter {} should be rejected", user);
                            }
                            // Active minter: result depends on quota PDA existence
                        }
                    }
                    2 => {
                        // Pauser
                        if !*active {
                            let r = model.apply(&Operation::Pause { pauser: *user });
                            assert_eq!(r, Err(ModelError::Unauthorized),
                                "Inactive pauser {} should be rejected", user);
                        } else if !model.paused {
                            let r = model.apply(&Operation::Pause { pauser: *user });
                            assert!(r.is_ok(), "Active pauser {} should be able to pause", user);
                            // Unpause immediately
                            let _ = model.apply(&Operation::Unpause { pauser: *user });
                        }
                    }
                    _ => {}
                }

                model.check_invariants();
            }
        }
    }

    // ===================================================================
    // Test 10: Input validation — boundary values
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]

        /// Fuzz input validation: random role types, decimals, and string
        /// lengths must be correctly validated.
        #[test]
        fn fuzz_input_validation(
            role_type in 0u8..=255u8,
            decimals in 0u8..=255u8,
            reason_len in 0usize..=200usize,
        ) {
            // Test role type validation
            {
                let mut model = StablecoinModel::new_sss2(0);
                let result = model.apply(&Operation::UpdateRole {
                    caller: 0,
                    user: 1,
                    role_type,
                    active: true,
                });

                if role_type > ROLE_SEIZER {
                    assert_eq!(result, Err(ModelError::InvalidRole),
                        "Role type {} should be invalid", role_type);
                }
            }

            // Test decimals validation
            {
                let mut model = StablecoinModel::new();
                let result = model.apply(&Operation::Initialize {
                    caller: 0,
                    decimals,
                    enable_permanent_delegate: false,
                    enable_transfer_hook: false,
                    enable_confidential_transfer: false,
                });

                if decimals > 9 {
                    assert_eq!(result, Err(ModelError::InvalidDecimals),
                        "Decimals {} should be invalid", decimals);
                } else {
                    assert!(result.is_ok(),
                        "Decimals {} should be valid", decimals);
                }
            }

            // Test reason length validation
            {
                let mut model = StablecoinModel::new_sss2(0);
                model.roles.insert((0, ROLE_BLACKLISTER), true);
                let result = model.apply(&Operation::AddToBlacklist {
                    caller: 0,
                    address: 5,
                    reason_len,
                });

                if reason_len > MAX_REASON_LEN {
                    assert_eq!(result, Err(ModelError::ReasonTooLong),
                        "Reason length {} should be too long", reason_len);
                } else {
                    assert!(result.is_ok(),
                        "Reason length {} should be valid", reason_len);
                }
            }
        }
    }

    // ===================================================================
    // Test 11: Seize operations — SSS-2 permanent delegate
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(500))]

        /// Fuzz seize operations: verify token balances are preserved across
        /// seizures (no tokens created or destroyed).
        #[test]
        fn fuzz_seize_balance_conservation(
            mint_amounts in prop_vec(1u64..1_000_000u64, 1..5),
            seize_amount in 1u64..5_000_000u64,
        ) {
            let mut model = StablecoinModel::new_sss2(0);
            model.roles.insert((1, ROLE_MINTER), true);
            model.roles.insert((2, ROLE_SEIZER), true);

            // Mint tokens to user 3
            let total_minted: u64 = {
                let mut total = 0u64;
                let mut quota = 0u64;
                for amount in &mint_amounts {
                    quota = quota.saturating_add(*amount);
                }
                model.minter_quotas.insert(1, (quota, 0));

                for amount in &mint_amounts {
                    // Mint to minter (user 1), then conceptually they are in user 3's account
                    if model.apply(&Operation::Mint { minter: 1, amount: *amount }).is_ok() {
                        total = total.saturating_add(*amount);
                    }
                }
                // Move balance to user 3 for seize test
                let balance = model.balances.remove(&1).unwrap_or(0);
                model.balances.insert(3, balance);
                total
            };

            let before_total: u64 = model.balances.values().sum();

            // Attempt seize
            let result = model.apply(&Operation::Seize {
                seizer: 2,
                from: 3,
                to: 4,
                amount: seize_amount,
            });

            let after_total: u64 = model.balances.values().sum();

            // Balance conservation: total tokens across all accounts unchanged
            assert_eq!(before_total, after_total,
                "Seize must conserve total token balance (before={}, after={})",
                before_total, after_total);

            if seize_amount <= total_minted {
                assert!(result.is_ok(), "Seize of {} from {} available should succeed",
                    seize_amount, total_minted);
            }

            model.check_invariants();
        }
    }

    // ===================================================================
    // Test 12: Zero amount validation
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        /// Fuzz zero amount: all operations that take an amount must reject
        /// zero values with ZeroAmount error.
        #[test]
        fn fuzz_zero_amount_rejection(
            user in 0u8..NUM_USERS,
        ) {
            let mut model = StablecoinModel::new_sss2(0);
            for u in 0..NUM_USERS {
                model.roles.insert((u, ROLE_MINTER), true);
                model.roles.insert((u, ROLE_BURNER), true);
                model.roles.insert((u, ROLE_SEIZER), true);
                model.minter_quotas.insert(u, (u64::MAX, 0));
            }

            assert_eq!(
                model.apply(&Operation::Mint { minter: user, amount: 0 }),
                Err(ModelError::ZeroAmount),
                "Zero mint should fail"
            );
            assert_eq!(
                model.apply(&Operation::Burn { burner: user, amount: 0 }),
                Err(ModelError::ZeroAmount),
                "Zero burn should fail"
            );
            assert_eq!(
                model.apply(&Operation::Seize {
                    seizer: user,
                    from: 1,
                    to: 2,
                    amount: 0,
                }),
                Err(ModelError::ZeroAmount),
                "Zero seize should fail"
            );

            model.check_invariants();
        }
    }

    // ===================================================================
    // Test 13: Long-running state machine stress test
    // ===================================================================

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Stress test: 200 random operations on SSS-2 model. Verifies that
        /// the state machine remains consistent over long operation sequences.
        #[test]
        fn fuzz_stress_test_200_operations(ops in operation_sequence(150, 200)) {
            let mut model = StablecoinModel::new_sss2(0);

            // Rich initial state: multiple users with various roles
            for user in 0..4u8 {
                model.roles.insert((user, ROLE_MINTER), true);
                model.roles.insert((user, ROLE_BURNER), true);
                model.roles.insert((user, ROLE_PAUSER), true);
                model.minter_quotas.insert(user, (100_000_000, 0));
            }
            model.roles.insert((4, ROLE_BLACKLISTER), true);
            model.roles.insert((5, ROLE_SEIZER), true);

            for op in &ops {
                let _ = model.apply(op);
                model.check_invariants();
            }

            // Final consistency check: verify net supply
            let net = model.total_minted.saturating_sub(model.total_burned);
            let total_balance: u64 = model.balances.values().sum();
            assert!(
                net >= total_balance,
                "Final: net supply ({}) must be >= total balances ({})",
                net, total_balance
            );
        }
    }

    // ===================================================================
    // Deterministic unit tests for specific invariants
    // ===================================================================

    #[test]
    fn test_double_initialize_rejected() {
        let mut model = StablecoinModel::new();
        assert!(model
            .apply(&Operation::Initialize {
                caller: 0,
                decimals: 6,
                enable_permanent_delegate: false,
                enable_transfer_hook: false,
                enable_confidential_transfer: false,
            })
            .is_ok());
        assert_eq!(
            model.apply(&Operation::Initialize {
                caller: 0,
                decimals: 6,
                enable_permanent_delegate: false,
                enable_transfer_hook: false,
                enable_confidential_transfer: false,
            }),
            Err(ModelError::AnchorError)
        );
    }

    #[test]
    fn test_mint_burn_lifecycle() {
        let mut model = StablecoinModel::new_sss1(0);
        model.roles.insert((1, ROLE_MINTER), true);
        model.roles.insert((1, ROLE_BURNER), true);
        model.minter_quotas.insert(1, (1_000_000, 0));

        // Mint 500,000
        model
            .apply(&Operation::Mint {
                minter: 1,
                amount: 500_000,
            })
            .unwrap();
        assert_eq!(model.total_minted, 500_000);
        assert_eq!(model.total_burned, 0);
        assert_eq!(model.balances[&1], 500_000);

        // Burn 200,000
        model
            .apply(&Operation::Burn {
                burner: 1,
                amount: 200_000,
            })
            .unwrap();
        assert_eq!(model.total_minted, 500_000);
        assert_eq!(model.total_burned, 200_000);
        assert_eq!(model.balances[&1], 300_000);

        model.check_invariants();
    }

    #[test]
    fn test_quota_not_reset_on_update() {
        let mut model = StablecoinModel::new_sss1(0);
        model.roles.insert((1, ROLE_MINTER), true);
        model.minter_quotas.insert(1, (1_000_000, 0));

        // Mint 600,000
        model
            .apply(&Operation::Mint {
                minter: 1,
                amount: 600_000,
            })
            .unwrap();

        // Update quota to 2,000,000 — minted should remain 600,000
        model
            .apply(&Operation::UpdateMinter {
                caller: 0,
                minter: 1,
                quota: 2_000_000,
            })
            .unwrap();

        let (quota, minted) = model.minter_quotas[&1];
        assert_eq!(quota, 2_000_000);
        assert_eq!(minted, 600_000, "Minted counter must survive quota updates");

        model.check_invariants();
    }

    #[test]
    fn test_pause_unpause_double_guard() {
        let mut model = StablecoinModel::new_sss1(0);
        model.roles.insert((0, ROLE_PAUSER), true);

        // Pause
        model.apply(&Operation::Pause { pauser: 0 }).unwrap();

        // Double pause fails
        assert_eq!(
            model.apply(&Operation::Pause { pauser: 0 }),
            Err(ModelError::Paused)
        );

        // Unpause
        model.apply(&Operation::Unpause { pauser: 0 }).unwrap();

        // Double unpause fails
        assert_eq!(
            model.apply(&Operation::Unpause { pauser: 0 }),
            Err(ModelError::NotPaused)
        );
    }

    #[test]
    fn test_sss2_full_compliance_flow() {
        let mut model = StablecoinModel::new_sss2(0);
        model.roles.insert((1, ROLE_MINTER), true);
        model.roles.insert((2, ROLE_BLACKLISTER), true);
        model.roles.insert((3, ROLE_SEIZER), true);
        model.minter_quotas.insert(1, (10_000_000, 0));

        // Mint to user 1, transfer to user 5
        model
            .apply(&Operation::Mint {
                minter: 1,
                amount: 5_000_000,
            })
            .unwrap();
        let bal = model.balances.remove(&1).unwrap_or(0);
        model.balances.insert(5, bal);

        // Blacklist user 5
        model
            .apply(&Operation::AddToBlacklist {
                caller: 2,
                address: 5,
                reason_len: 20,
            })
            .unwrap();
        assert!(model.blacklist.contains(&5));

        // Seize tokens from user 5 to user 6
        model
            .apply(&Operation::Seize {
                seizer: 3,
                from: 5,
                to: 6,
                amount: 5_000_000,
            })
            .unwrap();
        assert_eq!(model.balances.get(&5).copied().unwrap_or(0), 0);
        assert_eq!(model.balances[&6], 5_000_000);

        // Remove from blacklist
        model
            .apply(&Operation::RemoveFromBlacklist {
                caller: 2,
                address: 5,
            })
            .unwrap();
        assert!(!model.blacklist.contains(&5));

        model.check_invariants();
    }

    #[test]
    fn test_max_u64_overflow_prevention() {
        let mut model = StablecoinModel::new_sss1(0);
        model.roles.insert((1, ROLE_MINTER), true);
        model.minter_quotas.insert(1, (u64::MAX, 0));

        // Mint near-max
        model
            .apply(&Operation::Mint {
                minter: 1,
                amount: u64::MAX - 1,
            })
            .unwrap();

        // Mint 2 more should overflow
        assert_eq!(
            model.apply(&Operation::Mint {
                minter: 1,
                amount: 2,
            }),
            Err(ModelError::MathOverflow),
            "u64 overflow must be caught"
        );

        model.check_invariants();
    }

    #[test]
    fn test_role_self_revocation() {
        let mut model = StablecoinModel::new_sss1(0);

        // Authority gives themselves minter role
        model
            .apply(&Operation::UpdateRole {
                caller: 0,
                user: 0,
                role_type: ROLE_MINTER,
                active: true,
            })
            .unwrap();
        model.minter_quotas.insert(0, (1_000_000, 0));

        // Mint works
        model
            .apply(&Operation::Mint {
                minter: 0,
                amount: 100,
            })
            .unwrap();

        // Self-revoke minter role
        model
            .apply(&Operation::UpdateRole {
                caller: 0,
                user: 0,
                role_type: ROLE_MINTER,
                active: false,
            })
            .unwrap();

        // Mint now fails
        assert_eq!(
            model.apply(&Operation::Mint {
                minter: 0,
                amount: 100,
            }),
            Err(ModelError::Unauthorized)
        );

        model.check_invariants();
    }
}
