//! On-chain account state for the SSS Timelock module.
//!
//! Two account types are managed by this program:
//!
//! - [`TimelockConfig`] — the singleton config PDA per stablecoin that records
//!   the enforced delay period.
//! - [`PendingOp`] — one PDA per proposed operation. Operations cannot be
//!   executed until `valid_after` has passed and may be cancelled before that.

use anchor_lang::prelude::*;

/// Classification of the governance operation being timelocked.
///
/// Stored as a single `u8` on chain (Anchor derives the discriminant from the
/// variant value).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
#[repr(u8)]
pub enum OperationType {
    /// Transfer of the master authority to a new address.
    AuthorityTransfer = 0,
    /// Update to the global or per-minter supply cap.
    SupplyCapUpdate = 1,
    /// Pause or unpause the stablecoin protocol.
    PauseProtocol = 2,
    /// Assignment or revocation of a role.
    UpdateRoles = 3,
}

/// Configuration for the timelock attached to a stablecoin.
///
/// Created via [`initialize_timelock`](crate::sss_timelock::initialize_timelock).
///
/// Seeds: `["timelock_config", stablecoin_config]`
#[account]
pub struct TimelockConfig {
    /// The SSS [`StablecoinConfig`] PDA this module is attached to.
    pub stablecoin_config: Pubkey,
    /// The authority who may propose and cancel operations, and update the delay.
    pub authority: Pubkey,
    /// Minimum number of seconds that must elapse between proposal and execution.
    pub delay_seconds: u64,
    /// PDA bump seed.
    pub bump: u8,
}

impl TimelockConfig {
    /// Serialized byte length including the 8-byte Anchor discriminator.
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1;

    /// Seed prefix used when deriving the PDA.
    pub const SEED_PREFIX: &'static [u8] = b"timelock_config";
}

/// A pending governance operation awaiting the timelock delay.
///
/// Created via [`propose_operation`](crate::sss_timelock::propose_operation).
/// Executed via [`execute_operation`](crate::sss_timelock::execute_operation).
/// Cancelled via [`cancel_operation`](crate::sss_timelock::cancel_operation).
///
/// Seeds: `["pending_op", timelock_config, op_id_le_bytes]`
#[account]
pub struct PendingOp {
    /// The [`TimelockConfig`] PDA this operation belongs to.
    pub timelock_config: Pubkey,
    /// The type of governance operation.
    pub operation_type: OperationType,
    /// The address that proposed this operation.
    pub initiator: Pubkey,
    /// Unix timestamp (seconds) after which the operation may be executed.
    pub valid_after: i64,
    /// Whether the operation has been successfully executed.
    pub executed: bool,
    /// Whether the operation has been cancelled.
    pub cancelled: bool,
    /// PDA bump seed.
    pub bump: u8,
}

impl PendingOp {
    /// Serialized byte length including the 8-byte Anchor discriminator.
    pub const LEN: usize = 8 + 32 + 1 + 32 + 8 + 1 + 1 + 1;

    /// Seed prefix used when deriving the PDA.
    pub const SEED_PREFIX: &'static [u8] = b"pending_op";
}
