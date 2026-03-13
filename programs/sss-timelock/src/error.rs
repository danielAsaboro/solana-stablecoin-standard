//! Custom error codes for the SSS Timelock module.
//!
//! Each variant maps to a unique Anchor error code and includes a human-readable
//! message returned to clients.

use anchor_lang::prelude::*;

/// Errors that can be returned by SSS Timelock program instructions.
#[error_code]
pub enum TimelockError {
    #[msg("Unauthorized - caller is not the timelock authority")]
    Unauthorized,

    #[msg("Timelock delay has not yet elapsed — operation is not ready for execution")]
    OperationNotReady,

    #[msg("Operation has already been executed")]
    AlreadyExecuted,

    #[msg("Operation has already been cancelled")]
    AlreadyCancelled,

    #[msg("Delay must be greater than zero")]
    InvalidDelay,

    #[msg("Arithmetic overflow computing valid_after timestamp")]
    ArithmeticOverflow,
}
