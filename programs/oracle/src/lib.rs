//! # SSS Oracle Integration Module
//!
//! A Switchboard V2 price feed integration for SSS stablecoins pegged to
//! non-USD currencies (EUR, BRL, CPI-indexed, etc.).
//!
//! ## Architecture
//!
//! The oracle module is a **separate Anchor program** that reads price data from
//! [Switchboard V2](https://switchboard.xyz/) aggregator accounts and stores
//! verified, bounds-checked prices in an on-chain [`OracleConfig`](state::OracleConfig)
//! PDA. The SSS stablecoin program itself is unchanged — the oracle is a
//! companion data provider used by the backend service or SDK to calculate
//! mint/redeem amounts at the correct exchange rate.
//!
//! ```text
//! ┌──────────────┐     reads      ┌──────────────────┐
//! │  Switchboard │ ◄───────────── │   Oracle Program  │
//! │  Aggregator  │                │  (refresh_price)  │
//! └──────────────┘                └────────┬─────────┘
//!                                          │ stores
//!                                 ┌────────▼─────────┐
//!                                 │   OracleConfig    │
//!                                 │  PDA (on-chain)   │
//!                                 └────────┬─────────┘
//!                                          │ reads
//!                          ┌───────────────┴───────────────┐
//!                          │                               │
//!                 ┌────────▼────────┐            ┌────────▼────────┐
//!                 │  Backend / SDK  │            │    Frontend     │
//!                 │ (mint/redeem    │            │  (display rate) │
//!                 │  pricing)       │            │                 │
//!                 └─────────────────┘            └─────────────────┘
//! ```
//!
//! ## Switchboard Integration
//!
//! The oracle reads Switchboard V2 aggregator accounts by parsing the Borsh-serialized
//! `AggregatorAccountData` at known byte offsets. This avoids a dependency on the
//! full `switchboard-solana` SDK, keeping the BPF binary small and free of
//! transitive dependency conflicts.
//!
//! ## Manual Override
//!
//! For testing, development, or fallback scenarios, the oracle supports manual
//! price pushing via [`push_manual_price`](sss_oracle::push_manual_price).
//! This must be explicitly enabled in the oracle config.
//!
//! ## Checked Arithmetic
//!
//! All arithmetic operations use `checked_*` methods and return
//! [`OracleError::MathOverflow`](error::OracleError::MathOverflow) on overflow.

#![deny(clippy::all)]
// Anchor-generated code triggers these — safe to allow at crate level.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]
#![allow(clippy::result_large_err)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod switchboard;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ");

#[program]
pub mod sss_oracle {
    use super::*;

    /// Initialize a new oracle configuration linked to an SSS stablecoin
    /// and a Switchboard V2 aggregator.
    pub fn initialize_oracle(
        ctx: Context<InitializeOracle>,
        params: InitializeOracleParams,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Update oracle configuration (aggregator, thresholds, bounds).
    /// Oracle authority only.
    pub fn update_oracle_config(
        ctx: Context<UpdateOracleConfig>,
        params: UpdateOracleConfigParams,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, params)
    }

    /// Refresh the price from the Switchboard V2 aggregator.
    /// Permissionless — anyone can crank the price update.
    pub fn refresh_price(ctx: Context<RefreshPrice>) -> Result<()> {
        instructions::refresh_price::handler(ctx)
    }

    /// Push a price manually. Oracle authority only, requires manual_override enabled.
    pub fn push_manual_price(ctx: Context<PushManualPrice>, price: u64) -> Result<()> {
        instructions::push_price::handler(ctx, price)
    }
}
