//! Program events emitted by SSS Timelock instructions.
//!
//! Every state-changing instruction emits exactly one event. Clients can parse
//! these from transaction logs to build an off-chain audit trail or drive
//! webhook notifications for pending governance operations.

use anchor_lang::prelude::*;

/// Emitted when a new [`TimelockConfig`](crate::state::TimelockConfig) is
/// created via [`initialize_timelock`](crate::sss_timelock::initialize_timelock).
#[event]
pub struct TimelockInitialized {
    /// The SSS stablecoin config PDA this timelock module is attached to.
    pub stablecoin_config: Pubkey,
    /// The authority who initialized the timelock.
    pub authority: Pubkey,
    /// The delay in seconds between proposal and earliest allowed execution.
    pub delay_seconds: u64,
}

/// Emitted when a governance operation is proposed via
/// [`propose_operation`](crate::sss_timelock::propose_operation).
#[event]
pub struct OperationProposed {
    /// The timelock config PDA.
    pub timelock_config: Pubkey,
    /// The application-level operation identifier passed by the caller.
    pub op_id: u64,
    /// The type of operation that was proposed (as u8 discriminant).
    pub operation_type: u8,
    /// Unix timestamp after which the operation is eligible for execution.
    pub valid_after: i64,
    /// The address that proposed the operation.
    pub initiator: Pubkey,
}

/// Emitted when a pending operation is executed via
/// [`execute_operation`](crate::sss_timelock::execute_operation).
#[event]
pub struct OperationExecuted {
    /// The timelock config PDA.
    pub timelock_config: Pubkey,
    /// The application-level operation identifier.
    pub op_id: u64,
    /// The address that executed the operation.
    pub executed_by: Pubkey,
}

/// Emitted when a pending operation is cancelled via
/// [`cancel_operation`](crate::sss_timelock::cancel_operation).
#[event]
pub struct OperationCancelled {
    /// The timelock config PDA.
    pub timelock_config: Pubkey,
    /// The application-level operation identifier.
    pub op_id: u64,
    /// The authority who cancelled the operation.
    pub cancelled_by: Pubkey,
}
