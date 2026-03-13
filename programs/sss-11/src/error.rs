//! Custom error codes for the SSS-11 Credit Stablecoin program.

use anchor_lang::prelude::*;

/// Errors returned by SSS-11 program instructions.
#[error_code]
pub enum CreditError {
    #[msg("Unauthorized - caller is not the credit config authority")]
    Unauthorized,

    #[msg("Insufficient collateral to issue the requested amount")]
    InsufficientCollateral,

    #[msg("Position is healthy and cannot be liquidated")]
    PositionHealthy,

    #[msg("A credit position already exists for this borrower")]
    PositionAlreadyExists,

    #[msg("Position is not active")]
    PositionNotActive,

    #[msg("Operation would bring collateral ratio below the minimum")]
    RatioBelowMinimum,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Invalid configuration parameters")]
    InvalidConfig,
}
