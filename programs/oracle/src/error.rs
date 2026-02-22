//! Custom error codes for the Oracle Integration Module.
//!
//! Each variant maps to a unique Anchor error code and includes a human-readable
//! message returned to clients.

use anchor_lang::prelude::*;

/// Errors that can be returned by oracle program instructions.
#[error_code]
pub enum OracleError {
    /// The caller is not the oracle config authority.
    #[msg("Unauthorized - caller is not the oracle authority")]
    Unauthorized,

    /// The aggregator account data is too short or malformed.
    #[msg("Invalid aggregator account data - cannot parse Switchboard result")]
    InvalidAggregatorData,

    /// The price from the aggregator is older than the staleness threshold.
    #[msg("Price data is stale - exceeds staleness threshold")]
    StalePrice,

    /// The price falls outside the configured min/max bounds.
    #[msg("Price out of bounds - below minimum or above maximum")]
    PriceOutOfBounds,

    /// The aggregator returned a negative or zero price.
    #[msg("Invalid price - must be positive")]
    InvalidPrice,

    /// Manual price pushing is disabled for this oracle config.
    #[msg("Manual override is disabled - use refresh_price with a Switchboard aggregator")]
    ManualOverrideDisabled,

    /// Arithmetic overflow during price conversion.
    #[msg("Arithmetic overflow")]
    MathOverflow,

    /// The base currency string exceeds the maximum length.
    #[msg("Currency identifier exceeds maximum length")]
    CurrencyTooLong,

    /// The provided min_price is greater than or equal to max_price.
    #[msg("Invalid price bounds - min_price must be less than max_price")]
    InvalidPriceBounds,

    /// The staleness threshold must be positive.
    #[msg("Invalid staleness threshold - must be greater than zero")]
    InvalidStaleness,

    /// The aggregator account does not match the configured aggregator.
    #[msg("Aggregator mismatch - provided account does not match oracle config")]
    AggregatorMismatch,
}
