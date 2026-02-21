# Security Audit Checklist

> Comprehensive security analysis of the Solana Stablecoin Standard (SSS) on-chain programs.
> Programs audited: `sss` (main program) and `transfer-hook` (blacklist enforcement).

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Access Control Matrix](#2-access-control-matrix)
3. [PDA Validation Checklist](#3-pda-validation-checklist)
4. [Account Constraint Audit](#4-account-constraint-audit)
5. [Arithmetic Safety](#5-arithmetic-safety)
6. [CPI Security Analysis](#6-cpi-security-analysis)
7. [Reentrancy Analysis](#7-reentrancy-analysis)
8. [Feature Gating Verification](#8-feature-gating-verification)
9. [Transfer Hook Security](#9-transfer-hook-security)
10. [Input Validation](#10-input-validation)
11. [Event Emission Audit](#11-event-emission-audit)
12. [Known Limitations](#12-known-limitations)
13. [Deployment Security Checklist](#13-deployment-security-checklist)

---

## 1. Threat Model

### Adversary Assumptions

| Adversary | Capability | Goal |
|-----------|-----------|------|
| External attacker | Can submit arbitrary transactions | Mint unauthorized tokens, steal funds |
| Compromised minter | Has valid Minter role keypair | Mint beyond quota, bypass pause |
| Compromised pauser | Has valid Pauser role keypair | Freeze legitimate accounts, grief users |
| Rogue blacklister | Has valid Blacklister role keypair | Blacklist innocent addresses |
| Spoofed program | Deploys program at different address | Bypass transfer hook, forge PDAs |
| Front-runner | Observes mempool | Race to exploit time-of-check/time-of-use gaps |

### Trust Boundaries

```
┌─────────────────────────────────────────────────────┐
│                 Untrusted Zone                      │
│  (External transactions, arbitrary signers)         │
├─────────────────────────────────────────────────────┤
│  Anchor Constraint Layer (account deserialization)  │
│  → Seeds, bumps, has_one, token::mint validated     │
├─────────────────────────────────────────────────────┤
│  Instruction Handler Layer (business logic)         │
│  → Role checks, pause checks, quota checks         │
├─────────────────────────────────────────────────────┤
│  CPI Layer (Token-2022, System Program)             │
│  → Mint authority, freeze authority, delegate       │
├─────────────────────────────────────────────────────┤
│                 Trusted Zone                        │
│  (PDA-signed operations, Token-2022 guarantees)     │
└─────────────────────────────────────────────────────┘
```

### Security Invariants

1. **Only authorized roles can execute privileged operations** — Every instruction enforces role checks at the Anchor constraint level before handler execution.
2. **Minters cannot exceed their quota** — Cumulative `minted` counter tracked per-minter with checked arithmetic.
3. **No operations during pause** — Mint and burn check `!config.paused` at the constraint level.
4. **Blacklisted addresses cannot transfer** — Transfer hook enforces on every `transfer_checked`, no gaps.
5. **Feature flags are immutable** — Set at initialization, cannot be changed post-deployment.
6. **Only the Config PDA can sign as mint/freeze/delegate authority** — PDA-derived, no private key exists.

---

## 2. Access Control Matrix

### Per-Instruction Authorization

| Instruction | Required Role | Auth Mechanism | Additional Checks |
|-------------|--------------|----------------|-------------------|
| `initialize` | None (any signer) | Signer pays rent | Input validation only |
| `mint_tokens` | Minter (0) | Role PDA + `active` constraint | Quota check, pause check |
| `burn_tokens` | Burner (1) | Role PDA + `active` constraint | Pause check, zero amount |
| `freeze_token_account` | Pauser (2) | Role PDA + `active` constraint | — |
| `thaw_token_account` | Pauser (2) | Role PDA + `active` constraint | — |
| `pause` | Pauser (2) | Role PDA + `active` constraint | `!config.paused` |
| `unpause` | Pauser (2) | Role PDA + `active` constraint | `config.paused` |
| `update_roles` | Master authority | `config.master_authority == signer` | Feature gate for roles 3, 4 |
| `update_minter` | Master authority | `config.master_authority == signer` | — |
| `transfer_authority` | Master authority | `config.master_authority == signer` | `new != current` |
| `add_to_blacklist` | Blacklister (3) | Role PDA + `active` constraint | `enable_transfer_hook` |
| `remove_from_blacklist` | Blacklister (3) | Role PDA + `active` constraint | `enable_transfer_hook` |
| `seize` | Seizer (4) | Role PDA + `active` constraint | `enable_permanent_delegate` |

### Role Constraint Pattern

All role-gated instructions use this Anchor constraint pattern, which validates at deserialization time (before the handler executes):

```rust
#[account(
    seeds = [ROLE_SEED, config.key().as_ref(), &[ROLE_TYPE], authority.key().as_ref()],
    bump = role_account.bump,
    constraint = role_account.active @ StablecoinError::Unauthorized,
)]
pub role_account: Account<'info, RoleAccount>
```

**Verification**: [x] Seeds bind role to specific config, role type, and user — cannot be reused across configs or roles.
**Verification**: [x] Bump stored on-chain prevents bump manipulation attacks.
**Verification**: [x] `active` check prevents deactivated roles from being used.

### Master Authority Constraint Pattern

```rust
#[account(
    constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
)]
```

**Verification**: [x] Direct pubkey comparison, not PDA-derived — only one master authority exists per config.

---

## 3. PDA Validation Checklist

### StablecoinConfig

| Property | Value | Status |
|----------|-------|--------|
| Seeds | `["stablecoin", mint_pubkey]` | [x] Verified |
| Bump | Stored in `config.bump` | [x] Verified |
| Uniqueness | One config per mint (mint is unique) | [x] Verified |
| Owner | SSS program | [x] Verified (Anchor `Account<>` enforces) |
| Initialization | `init` constraint with payer | [x] Verified |

### RoleAccount

| Property | Value | Status |
|----------|-------|--------|
| Seeds | `["role", config, role_type_u8, user]` | [x] Verified |
| Bump | Stored in `role_account.bump` | [x] Verified |
| Uniqueness | One per (config, role_type, user) triple | [x] Verified |
| Lifecycle | `init_if_needed` — persists across activate/deactivate | [x] Verified |
| Owner | SSS program | [x] Verified |

### MinterQuota

| Property | Value | Status |
|----------|-------|--------|
| Seeds | `["minter_quota", config, minter]` | [x] Verified |
| Bump | Stored in `minter_quota.bump` | [x] Verified |
| Uniqueness | One per (config, minter) pair | [x] Verified |
| Counter | `minted` is cumulative, never reset | [x] Verified |
| Owner | SSS program | [x] Verified |

### BlacklistEntry

| Property | Value | Status |
|----------|-------|--------|
| Seeds | `["blacklist", config, address]` | [x] Verified |
| Bump | Stored in `blacklist_entry.bump` | [x] Verified |
| Uniqueness | One per (config, address) pair | [x] Verified |
| Closure | `close = authority` on removal | [x] Verified |
| Rent return | Returns to removing authority | [x] Verified |

### ExtraAccountMetas (Transfer Hook)

| Property | Value | Status |
|----------|-------|--------|
| Seeds | `["extra-account-metas", mint]` | [x] Verified |
| Owner | Transfer hook program | [x] Verified |
| Initialization | One-time setup during stablecoin init | [x] Verified |
| Content | Account resolution recipes for 4 extra accounts | [x] Verified |

---

## 4. Account Constraint Audit

### Token Account Validation

All token account parameters use explicit `token::mint` and `token::token_program` constraints:

| Instruction | Account | Constraint | Status |
|-------------|---------|-----------|--------|
| `mint_tokens` | `recipient_token_account` | `token::mint = mint, token::token_program = token_program` | [x] Typed |
| `burn_tokens` | `from_token_account` | `token::mint = mint, token::token_program = token_program` | [x] Typed |
| `freeze_token_account` | `token_account` | `token::mint = mint, token::token_program = token_program` | [x] Typed |
| `thaw_token_account` | `token_account` | `token::mint = mint, token::token_program = token_program` | [x] Typed |
| `seize` | `from_token_account` | `token::mint = mint, token::token_program = token_program` | [x] Typed |
| `seize` | `to_token_account` | `token::mint = mint, token::token_program = token_program` | [x] Typed |

### Mint Account Validation

| Instruction | Account | Constraint | Status |
|-------------|---------|-----------|--------|
| `mint_tokens` | `mint` | `address = config.mint` | [x] Verified |
| `burn_tokens` | `mint` | `address = config.mint` | [x] Verified |
| `freeze_token_account` | `mint` | `address = config.mint` | [x] Verified |
| `thaw_token_account` | `mint` | `address = config.mint` | [x] Verified |
| `seize` | `mint` | `address = config.mint` | [x] Verified |
| `initialize` | `mint` | Created in instruction (new keypair) | [x] N/A |
| `initialize_extra_account_metas` | `mint` | `InterfaceAccount<Mint>` (ownership check) | [x] Typed |

### Remaining `/// CHECK:` Annotations

Only justified uses remain:

| Program | Account | Justification |
|---------|---------|---------------|
| SSS | `mint` (in most instructions) | Constrained via `address = config.mint` — exact pubkey match |
| Transfer Hook | All 9 accounts in `TransferHookAccounts` | Token-2022 validates these accounts before CPI into the hook; the hook cannot be called directly by external transactions |

**Verification**: [x] No `/// CHECK:` on token accounts that could be typed as `InterfaceAccount<TokenAccount>`.

---

## 5. Arithmetic Safety

### Checked Operations Inventory

| File | Operation | Type | Error |
|------|-----------|------|-------|
| `mint.rs:67` | `minter_quota.minted.checked_add(amount)` | u64 + u64 | `MathOverflow` |
| `mint.rs:75` | `config.total_minted.checked_add(amount)` | u64 + u64 | `MathOverflow` |
| `burn.rs:75` | `config.total_burned.checked_add(amount)` | u64 + u64 | `MathOverflow` |
| `initialize.rs:103` | `ExtensionType::try_calculate_account_len` | usize | `MathOverflow` |
| `initialize.rs:118` | `METADATA_FIXED_OVERHEAD.checked_add(name.len())...` | usize chain | `MathOverflow` |
| `initialize.rs:124` | `space.checked_add(metadata_space)` | usize + usize | `MathOverflow` |

### Overflow Scenario Analysis

| Scenario | Max Value | Risk | Mitigation |
|----------|-----------|------|------------|
| `total_minted` overflow | u64::MAX (~18.4 quintillion) | Negligible — would require minting 18.4 quintillion smallest units | `checked_add` returns `MathOverflow` |
| `minter_quota.minted` overflow | u64::MAX | Same as above | `checked_add` returns `MathOverflow` |
| `total_burned` overflow | u64::MAX | Same — bounded by total_minted | `checked_add` returns `MathOverflow` |
| Mint account space | Platform-bounded | Cannot overflow — `try_calculate_account_len` returns error | Mapped to `MathOverflow` |
| Metadata space calc | Bounded (max ≈ 334 bytes) | Input validation caps name≤32, symbol≤10, uri≤200 | `checked_add` chain returns `MathOverflow` |
| Total space (base+metadata) | Platform-bounded | Base ≈ 234 bytes + metadata ≈ 334 bytes = ~568 | `checked_add` returns `MathOverflow` |

### Compile-Time Constant Arithmetic

Account size constants (`StablecoinConfig::LEN`, `RoleAccount::LEN`, `MinterQuota::LEN`, `BlacklistEntry::LEN`) use `+` operators in `const` expressions. Rust evaluates `const` arithmetic at compile time with overflow checking — any overflow is a **compile-time error**, not a runtime risk.

### Type Cast Audit

| File | Cast | Direction | Status |
|------|------|-----------|--------|
| `initialize.rs:130` | `space as u64` | usize → u64 | [x] Safe — usize ≤ u64 on all Solana targets |
| `initialize_extra_account_metas.rs:143` | `account_size as u64` | usize → u64 | [x] Safe — same reason |

No narrowing casts (e.g., u64 → u32) exist in either program.

### Unchecked Arithmetic Scan

**Result**: [x] Zero unchecked arithmetic operations on runtime values in production code.

Full audit verified: no uses of `+`, `-`, `*`, `/` operators on runtime integer values in any instruction handler. All runtime arithmetic uses `checked_*` methods with explicit error propagation via `ok_or(StablecoinError::MathOverflow)?`.

---

## 6. CPI Security Analysis

### CPI Inventory

| Instruction | CPI Target | Authority | Signer Type |
|-------------|-----------|-----------|-------------|
| `initialize` | `system_program::create_account` | `authority` (user signer) | Direct signer |
| `initialize` | `token_2022::initialize_permanent_delegate` | N/A (init extension) | N/A |
| `initialize` | `transfer_hook::initialize` | N/A (init extension) | N/A |
| `initialize` | `token_2022::metadata_pointer::initialize` | N/A (init extension) | N/A |
| `initialize` | `token_2022::initialize_mint2` | N/A (init) | N/A |
| `initialize` | `token_2022::initialize_token_metadata` | Config PDA | PDA signer |
| `mint_tokens` | `token_2022::mint_to` | Config PDA | PDA signer |
| `burn_tokens` | `token_2022::burn` | Burner (user signer) | Direct signer |
| `freeze_token_account` | `token_2022::freeze_account` | Config PDA | PDA signer |
| `thaw_token_account` | `token_2022::thaw_account` | Config PDA | PDA signer |
| `seize` | `token_2022::transfer_checked` | Config PDA (permanent delegate) | PDA signer |

### CPI Safety Properties

- [x] **No arbitrary CPI targets**: All CPIs target Token-2022 or System Program — both are well-audited, immutable Solana runtime programs.
- [x] **No user-controlled CPI targets**: Program IDs are always derived from `Interface<>` or hardcoded constants.
- [x] **PDA signing uses stored bump**: Signer seeds use `config.bump` stored at initialization, preventing bump grinding.
- [x] **No writable account confusion**: CPI accounts match the instruction's declared mutability.
- [x] **Config PDA is the sole authority**: Mint authority, freeze authority, and permanent delegate are all the same PDA — simplifies trust model.

### Seize Instruction — Manual CPI Justification

The `seize` handler constructs a `transfer_checked` instruction manually (not via Anchor's `token_interface` helper) because:

1. Anchor's `token_interface::transfer_checked` does **not** forward `remaining_accounts` in the CPI
2. Token-2022 requires transfer hook extra accounts in the instruction's account list
3. The manual construction appends `ctx.remaining_accounts` to the instruction before `invoke_signed`

**Risk**: `remaining_accounts` are untrusted and passed through to Token-2022. However, Token-2022 validates the extra account metas against the on-chain `ExtraAccountMetas` PDA, so injecting malicious accounts causes the CPI to fail.

---

## 7. Reentrancy Analysis

### Solana's Reentrancy Model

Solana's BPF runtime **prevents self-reentrancy** by design: a program cannot CPI back into itself during execution. This eliminates the classic reentrancy attack vector.

### Cross-Program Reentrancy

| CPI Chain | Reentrancy Possible? | Analysis |
|-----------|---------------------|----------|
| SSS → Token-2022 → Transfer Hook → SSS | **No** | The transfer hook program is a **separate** program from SSS. Token-2022 CPIs into the hook, not back into SSS. |
| SSS → Token-2022 | **No** | Token-2022 does not CPI back into SSS (except via transfer hook, which routes to the hook program). |
| SSS → System Program | **No** | System program never CPIs into user programs. |

### State Mutation Ordering

All instructions follow **check-mutate-CPI** ordering:

1. **Check**: Anchor constraints validate all accounts at deserialization
2. **Mutate**: State updates (quota, counters, flags) happen before CPI
3. **CPI**: Token operations (mint/burn/transfer/freeze) execute last

This ordering ensures that if the CPI fails, the transaction rolls back atomically (Solana's runtime guarantee), and state mutations are never persisted without a successful CPI.

**Exception**: `mint_tokens` updates `minter_quota.minted` and `config.total_minted` before the `mint_to` CPI. If `mint_to` fails, the entire transaction reverts — the updated counters are **not** persisted. This is safe because Solana transactions are atomic.

### Verdict

[x] **No reentrancy vulnerabilities exist** in either the SSS program or the transfer hook program. Solana's runtime prevents self-CPI, and no cross-program callback chains can re-enter the SSS program.

---

## 8. Feature Gating Verification

### Immutability Check

Feature flags are set in `initialize` and stored in `StablecoinConfig`:

```rust
pub enable_permanent_delegate: bool,  // Enables seize
pub enable_transfer_hook: bool,       // Enables blacklist enforcement
pub default_account_frozen: bool,     // New accounts frozen by default
```

**Verification**: [x] No instruction modifies these fields after initialization. They are set once in `initialize` and read-only thereafter.

### Gate Enforcement Matrix

| Feature | Gate Location | Gated Instructions | Error |
|---------|--------------|-------------------|-------|
| `enable_transfer_hook` | Account constraint | `add_to_blacklist`, `remove_from_blacklist` | `ComplianceNotEnabled` |
| `enable_transfer_hook` | `update_roles` handler | Blacklister (3) role assignment | `ComplianceNotEnabled` |
| `enable_permanent_delegate` | Account constraint | `seize` | `PermanentDelegateNotEnabled` |
| `enable_permanent_delegate` | `update_roles` handler | Seizer (4) role assignment | `ComplianceNotEnabled` |

### Downgrade Prevention

- [x] Cannot disable `enable_transfer_hook` after initialization
- [x] Cannot disable `enable_permanent_delegate` after initialization
- [x] Cannot re-initialize a config PDA (Anchor `init` constraint prevents duplicate creation)
- [x] SSS-1 configs cannot execute SSS-2 instructions even if a blacklister role PDA somehow existed (feature gate check precedes role check in account constraints)

---

## 9. Transfer Hook Security

### Hook Invocation Chain

```
User → transfer_checked → Token-2022 Program
  → Resolves ExtraAccountMetas from PDA
  → CPIs into Transfer Hook Program
    → Checks source blacklist PDA existence
    → Checks destination blacklist PDA existence
    → Returns Ok or Error
```

### Security Properties

- [x] **Mandatory enforcement**: Token-2022 always invokes the hook on `transfer_checked` — cannot be bypassed by the sender.
- [x] **Direct transfer blocked**: `transfer` (without checked) is not available on Token-2022 mints with transfer hooks enabled.
- [x] **Blacklist check is existence-based**: Checks `!data_is_empty() && owner != system_program` — a closed PDA (returned to system program) is correctly treated as non-blacklisted.
- [x] **Seizure bypass is PDA-verified**: The hook derives the expected Config PDA from seeds and verifies the owner/delegate matches — cannot be spoofed by an external account.

### Dual Entry Point Consistency

The transfer hook has two entry points for the same logic:

1. **Anchor dispatch** (`transfer_hook_execute`): Called when Anchor's discriminator matches
2. **SPL fallback** (`execute_transfer_hook`): Called when Token-2022 uses the SPL Transfer Hook Interface discriminator `[105, 37, 101, 197, 75, 251, 102, 26]`

**Verification**: [x] Both entry points perform identical blacklist checks with identical logic. No code path divergence.

### ExtraAccountMetas Resolution

The extra accounts resolved by Token-2022 at transfer time:

| Index | Account | Resolution Method |
|-------|---------|-------------------|
| 5 | SSS Program | Literal pubkey (stored in ExtraAccountMetas) |
| 6 | StablecoinConfig PDA | Derived from seed `["stablecoin", mint]` using SSS program ID (index 5) |
| 7 | Source BlacklistEntry PDA | Derived from seed `["blacklist", config, source_owner]` |
| 8 | Dest BlacklistEntry PDA | Derived from seed `["blacklist", config, dest_owner]` |

**Verification**: [x] Account resolution is deterministic — Token-2022 derives these from the on-chain recipe, not from user-supplied accounts.

---

## 10. Input Validation

### String Length Limits

| Field | Max Length | Validation Location | Error |
|-------|-----------|-------------------|-------|
| Name | 32 bytes | `initialize` handler | `NameTooLong` |
| Symbol | 10 bytes | `initialize` handler | `SymbolTooLong` |
| URI | 200 bytes | `initialize` handler | `UriTooLong` |
| Blacklist reason | 64 bytes | `add_to_blacklist` handler | `ReasonTooLong` |

### Numeric Bounds

| Field | Valid Range | Validation | Error |
|-------|-----------|------------|-------|
| Decimals | 0–9 | `initialize` handler | `InvalidDecimals` |
| Amount (mint/burn/seize) | > 0 | Each handler's `require!` | `ZeroAmount` |
| Role type | 0–4 | `update_roles` handler | `InvalidRole` |
| Minter quota | Any u64 | No upper bound restriction | N/A (intentional) |

### Edge Case Handling

| Edge Case | Handling | Status |
|-----------|---------|--------|
| Zero amount mint | Rejected with `ZeroAmount` | [x] Safe |
| Zero amount burn | Rejected with `ZeroAmount` | [x] Safe |
| Zero amount seize | Rejected with `ZeroAmount` | [x] Safe |
| Mint when paused | Rejected with `Paused` | [x] Safe |
| Burn when paused | Rejected with `Paused` | [x] Safe |
| Pause when already paused | Rejected with `Paused` | [x] Safe |
| Unpause when not paused | Rejected with `NotPaused` | [x] Safe |
| Transfer authority to self | Rejected with `SameAuthority` | [x] Safe |
| Duplicate blacklist entry | Rejected (Anchor `init` fails — account already exists) | [x] Safe |
| Remove non-blacklisted | Rejected (PDA does not exist — Anchor deserialization fails) | [x] Safe |
| Mint exceeding quota | Rejected with `QuotaExceeded` | [x] Safe |
| Role type > 4 | Rejected with `InvalidRole` | [x] Safe |
| Empty name/symbol/uri | Allowed (valid use case) | [x] Intentional |
| Freeze already frozen account | Token-2022 CPI error (account already frozen) | [x] Handled by Token-2022 |
| Thaw non-frozen account | Token-2022 CPI error (account not frozen) | [x] Handled by Token-2022 |

---

## 11. Event Emission Audit

Every state-changing instruction emits an event for off-chain indexing and audit trails.

| Instruction | Event | Key Fields | Status |
|-------------|-------|------------|--------|
| `initialize` | `StablecoinInitialized` | config, mint, authority, name, symbol, decimals, feature flags | [x] Emitted |
| `mint_tokens` | `TokensMinted` | config, minter, recipient, amount, minter_total_minted | [x] Emitted |
| `burn_tokens` | `TokensBurned` | config, burner, from, amount | [x] Emitted |
| `freeze_token_account` | `AccountFrozen` | config, authority, account | [x] Emitted |
| `thaw_token_account` | `AccountThawed` | config, authority, account | [x] Emitted |
| `pause` | `StablecoinPaused` | config, authority | [x] Emitted |
| `unpause` | `StablecoinUnpaused` | config, authority | [x] Emitted |
| `update_roles` | `RoleUpdated` | config, user, role_type, active, updated_by | [x] Emitted |
| `update_minter` | `MinterQuotaUpdated` | config, minter, new_quota, updated_by | [x] Emitted |
| `transfer_authority` | `AuthorityTransferred` | config, previous_authority, new_authority | [x] Emitted |
| `add_to_blacklist` | `AddressBlacklisted` | config, address, reason, blacklisted_by | [x] Emitted |
| `remove_from_blacklist` | `AddressUnblacklisted` | config, address, removed_by | [x] Emitted |
| `seize` | `TokensSeized` | config, from, to, amount, seized_by | [x] Emitted |

**Verification**: [x] All 13 instructions emit events. No silent state mutations.

### Audit Trail Completeness

Events contain sufficient data for full reconstruction:
- [x] **Who**: Authority/role holder pubkey in every event
- [x] **What**: Action type implicit in event name, amount/address in fields
- [x] **When**: Solana slot/timestamp available from transaction metadata
- [x] **Context**: Config pubkey links all events to a specific stablecoin instance

---

## 12. Known Limitations

### By Design

| Limitation | Rationale | Risk Level |
|-----------|-----------|------------|
| Master authority is a single keypair | Simplicity; multisig can be used as master authority externally | Low — mitigated by using multisig programs |
| Feature flags cannot be changed post-init | Prevents security downgrades (e.g., disabling blacklist after deployment) | None — this is a security feature |
| Minter quota `minted` counter never resets | Preserves audit trail; increase quota to "reset" effective remaining | None — intentional design |
| No on-chain multisig | Out of scope; integrate with Squads or other multisig programs | Low — standard Solana pattern |
| Transfer hook only checks `transfer_checked` | `transfer` is disabled by Token-2022 when transfer hook is enabled | None — Token-2022 guarantee |
| Blacklist check is address-based, not account-based | An address blacklisted as a wallet owner; all their ATAs are affected | None — desired behavior |

### Operational Considerations

| Consideration | Impact | Mitigation |
|---------------|--------|------------|
| Master authority key loss | Cannot assign/revoke roles, cannot transfer authority | Use hardware wallet or multisig; document recovery procedures |
| All pausers compromised | System cannot be paused during incident | Master authority can assign new pausers |
| Blacklist PDA rent cost | Each blacklist entry costs ~0.002 SOL in rent | Rent returned on removal (`close = authority`) |
| Hook program upgrade | Transfer hook program is not upgradeable by default | Deploy as upgradeable if future changes are anticipated |

---

## 13. Deployment Security Checklist

### Pre-Deployment

- [ ] Verify program binaries match source code (reproducible build)
- [ ] Confirm program IDs match expected addresses
- [ ] Master authority keypair is secured (hardware wallet or multisig)
- [ ] Role assignment plan documented (which keys get which roles)
- [ ] Initial minter quotas calculated and documented
- [ ] Transfer hook program deployed and verified before SSS program
- [ ] ExtraAccountMetas initialized for the mint

### Post-Deployment

- [ ] Verify `initialize` transaction succeeded with correct feature flags
- [ ] Confirm Config PDA is the mint authority (`spl-token display <mint>`)
- [ ] Confirm Config PDA is the freeze authority
- [ ] If SSS-2: confirm Config PDA is the permanent delegate
- [ ] If SSS-2: confirm transfer hook program ID is set on the mint
- [ ] Assign all required roles and verify with on-chain queries
- [ ] Test mint/burn/freeze cycle on devnet before mainnet
- [ ] Set up event indexing/monitoring for all 13 event types
- [ ] Document program IDs, config PDA, and role holders for operations team

### Ongoing Operations

- [ ] Monitor for unauthorized role changes (watch `RoleUpdated` events)
- [ ] Monitor for authority transfers (watch `AuthorityTransferred` events)
- [ ] Rotate role keypairs periodically
- [ ] Maintain incident response runbook for pause/freeze/seize scenarios
- [ ] Keep minter quotas aligned with expected issuance volume

---

## Summary

| Category | Items Checked | Issues Found | Status |
|----------|:---:|:---:|:---:|
| Access Control | 13 instructions | 0 | **Pass** |
| PDA Validation | 5 PDA types | 0 | **Pass** |
| Account Constraints | 14 token/mint accounts | 0 | **Pass** |
| Arithmetic Safety | 6 operations + 2 casts | 0 | **Pass** |
| CPI Security | 11 CPI calls | 0 | **Pass** |
| Reentrancy | 3 CPI chains | 0 | **Pass** |
| Feature Gating | 4 gate points | 0 | **Pass** |
| Transfer Hook | 2 entry points | 0 | **Pass** |
| Input Validation | 12 edge cases | 0 | **Pass** |
| Event Emissions | 13 events | 0 | **Pass** |

**Overall Assessment**: No security vulnerabilities identified. All access control, PDA validation, arithmetic safety, and CPI security patterns follow Solana and Anchor best practices.
