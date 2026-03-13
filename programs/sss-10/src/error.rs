//! Custom error codes for the SSS-10 Async Mint/Redeem program.

use anchor_lang::prelude::*;

/// Errors returned by SSS-10 program instructions.
#[error_code]
pub enum AsyncError {
    #[msg("Unauthorized - caller is not the async config authority")]
    Unauthorized,

    #[msg("Memo exceeds maximum length of 128 characters")]
    MemoTooLong,

    #[msg("Request is not in the required status for this operation")]
    InvalidStatus,

    #[msg("Request account does not match the expected request_id")]
    RequestNotFound,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Request has already been executed")]
    AlreadyExecuted,

    #[msg("Arithmetic overflow")]
    MathOverflow,
}
