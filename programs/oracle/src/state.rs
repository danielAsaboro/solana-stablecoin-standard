//! On-chain account state for the Oracle Integration Module.
//!
//! The oracle config stores feed configuration and the latest verified price
//! for a specific stablecoin instance. Each stablecoin has at most one oracle
//! config, derived as a PDA from the stablecoin config address.

use anchor_lang::prelude::*;

use crate::constants::*;

/// Oracle configuration and latest price data for a stablecoin.
///
/// Links an SSS stablecoin to a Switchboard V2 aggregator for real-time
/// pricing of non-USD pegs (EUR, BRL, CPI-indexed, etc.). The oracle reads
/// the aggregator's latest confirmed result and stores a verified, bounds-checked
/// price that the backend or SDK can query for mint/redeem pricing.
///
/// Seeds: `["oracle_config", stablecoin_config_pubkey]`
#[account]
pub struct OracleConfig {
    /// Authority who can update this oracle config and push manual prices.
    pub authority: Pubkey,
    /// The SSS stablecoin config PDA this oracle is linked to.
    pub stablecoin_config: Pubkey,
    /// The Switchboard V2 aggregator account address for the price feed.
    pub aggregator: Pubkey,
    /// Base currency identifier (e.g., "USD", "BRL", "EUR", "CPI").
    /// The price represents: 1 token = `last_price / 10^price_decimals` of this currency.
    pub base_currency: String,

    // ── Feed configuration ───────────────────────────────────────────────
    /// Maximum acceptable age (in seconds) of the aggregator price data.
    /// If the aggregator's `round_open_timestamp` is older than this threshold
    /// relative to the current clock, `refresh_price` will reject the data.
    pub staleness_threshold: i64,
    /// Number of decimal places for price values.
    /// A `last_price` of `1_500_000` with `price_decimals = 6` means 1.500000.
    pub price_decimals: u8,
    /// Minimum acceptable price (scaled by `10^price_decimals`).
    /// Prices below this bound are rejected as erroneous.
    pub min_price: u64,
    /// Maximum acceptable price (scaled by `10^price_decimals`).
    /// Prices above this bound are rejected as erroneous.
    pub max_price: u64,
    /// Whether manual price pushing via [`push_manual_price`] is enabled.
    /// Useful for testing, development, or as a fallback when the feed is down.
    pub manual_override: bool,

    // ── Latest verified price ────────────────────────────────────────────
    /// The most recently verified price (scaled by `10^price_decimals`).
    /// Updated by `refresh_price` or `push_manual_price`.
    pub last_price: u64,
    /// Unix timestamp of the most recently verified price.
    pub last_timestamp: i64,

    /// PDA bump seed.
    pub bump: u8,
    /// Reserved for future use.
    pub _reserved: [u8; 64],
}

impl OracleConfig {
    pub const LEN: usize = 8  // discriminator
        + 32                   // authority
        + 32                   // stablecoin_config
        + 32                   // aggregator
        + (4 + MAX_CURRENCY_LEN) // base_currency (string prefix + data)
        + 8                    // staleness_threshold
        + 1                    // price_decimals
        + 8                    // min_price
        + 8                    // max_price
        + 1                    // manual_override
        + 8                    // last_price
        + 8                    // last_timestamp
        + 1                    // bump
        + 64; // _reserved

    pub const SEED_PREFIX: &'static [u8] = ORACLE_CONFIG_SEED;
}
