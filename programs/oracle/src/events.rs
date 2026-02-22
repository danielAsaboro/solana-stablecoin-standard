//! Program events emitted by Oracle Integration Module instructions.
//!
//! Every state-changing instruction emits exactly one event. Clients can parse
//! these from transaction logs to track oracle price updates and configuration changes.

use anchor_lang::prelude::*;

/// Emitted when a new oracle configuration is initialized via
/// [`initialize_oracle`](crate::sss_oracle::initialize_oracle).
#[event]
pub struct OracleInitialized {
    /// The newly created [`OracleConfig`](crate::state::OracleConfig) PDA.
    pub oracle_config: Pubkey,
    /// The SSS stablecoin config this oracle is linked to.
    pub stablecoin_config: Pubkey,
    /// The Switchboard V2 aggregator account for price data.
    pub aggregator: Pubkey,
    /// The base currency for pricing (e.g., "USD", "BRL", "EUR").
    pub base_currency: String,
    /// The authority who initialized the oracle config.
    pub authority: Pubkey,
}

/// Emitted when the oracle configuration is updated via
/// [`update_oracle_config`](crate::sss_oracle::update_oracle_config).
#[event]
pub struct OracleConfigUpdated {
    /// The [`OracleConfig`](crate::state::OracleConfig) PDA that was updated.
    pub oracle_config: Pubkey,
    /// The authority who updated the config.
    pub authority: Pubkey,
}

/// Emitted when the price is refreshed from a Switchboard aggregator via
/// [`refresh_price`](crate::sss_oracle::refresh_price).
#[event]
pub struct PriceRefreshed {
    /// The [`OracleConfig`](crate::state::OracleConfig) PDA.
    pub oracle_config: Pubkey,
    /// The verified price (scaled by `10^price_decimals`).
    pub price: u64,
    /// The Unix timestamp of the price data from the aggregator.
    pub timestamp: i64,
    /// The Switchboard aggregator account that provided the price.
    pub aggregator: Pubkey,
}

/// Emitted when a price is manually pushed via
/// [`push_manual_price`](crate::sss_oracle::push_manual_price).
///
/// Manual price pushing is only available when `manual_override` is enabled
/// on the oracle config. This is useful for testing, development, or as a
/// backup when the Switchboard feed is unavailable.
#[event]
pub struct ManualPricePushed {
    /// The [`OracleConfig`](crate::state::OracleConfig) PDA.
    pub oracle_config: Pubkey,
    /// The manually set price (scaled by `10^price_decimals`).
    pub price: u64,
    /// The authority who pushed the price.
    pub authority: Pubkey,
}
