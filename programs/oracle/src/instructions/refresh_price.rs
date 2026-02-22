use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::OracleError;
use crate::events::PriceRefreshed;
use crate::state::OracleConfig;
use crate::switchboard::{convert_to_fixed_point, parse_aggregator_result};

/// Accounts required to refresh the oracle price from a Switchboard aggregator.
///
/// Anyone can call this instruction (cranking is permissionless), but the
/// aggregator account must match the one configured in the oracle config.
#[derive(Accounts)]
pub struct RefreshPrice<'info> {
    /// The caller who triggers the price refresh. Can be any signer
    /// (permissionless cranking).
    pub caller: Signer<'info>,

    /// The oracle config PDA to update with the latest price.
    #[account(
        mut,
        seeds = [ORACLE_CONFIG_SEED, oracle_config.stablecoin_config.as_ref()],
        bump = oracle_config.bump,
    )]
    pub oracle_config: Account<'info, OracleConfig>,

    /// The Switchboard V2 aggregator account to read the price from.
    /// Must match `oracle_config.aggregator`.
    /// CHECK: We validate the account address matches `oracle_config.aggregator`
    /// and parse the data manually using known Switchboard V2 byte offsets.
    /// The account is read-only — no mutations are performed.
    #[account(
        constraint = aggregator.key() == oracle_config.aggregator @ OracleError::AggregatorMismatch,
    )]
    pub aggregator: UncheckedAccount<'info>,
}

/// Refresh the oracle price by reading from the Switchboard V2 aggregator.
///
/// Performs the following steps:
/// 1. Reads the aggregator account data and extracts the latest confirmed
///    round's result (mantissa, scale) and timestamp.
/// 2. Validates that the price data is not stale (within `staleness_threshold`).
/// 3. Converts the Switchboard decimal to a fixed-point u64 with the configured
///    `price_decimals`.
/// 4. Validates the price is within the configured `[min_price, max_price]` bounds.
/// 5. Stores the verified price and timestamp in the oracle config.
///
/// # Permissionless Cranking
///
/// This instruction does not require the oracle authority — anyone can call it
/// to update the price. This enables permissionless oracle cranking by keepers,
/// bots, or the application backend.
///
/// # Events
///
/// Emits [`PriceRefreshed`].
pub fn handler(ctx: Context<RefreshPrice>) -> Result<()> {
    let aggregator_data = ctx.accounts.aggregator.try_borrow_data()?;
    let result = parse_aggregator_result(&aggregator_data)?;

    // Validate staleness: check that the price is recent enough
    let clock = Clock::get()?;
    let age = clock
        .unix_timestamp
        .checked_sub(result.timestamp)
        .ok_or(OracleError::MathOverflow)?;
    require!(
        age <= ctx.accounts.oracle_config.staleness_threshold,
        OracleError::StalePrice
    );

    // Convert Switchboard decimal to our fixed-point format
    let price = convert_to_fixed_point(
        result.mantissa,
        result.scale,
        ctx.accounts.oracle_config.price_decimals,
    )?;

    // Validate price bounds
    require!(
        price >= ctx.accounts.oracle_config.min_price
            && price <= ctx.accounts.oracle_config.max_price,
        OracleError::PriceOutOfBounds
    );

    // Store the verified price
    let oracle_config = &mut ctx.accounts.oracle_config;
    oracle_config.last_price = price;
    oracle_config.last_timestamp = result.timestamp;

    emit!(PriceRefreshed {
        oracle_config: ctx.accounts.oracle_config.key(),
        price,
        timestamp: result.timestamp,
        aggregator: ctx.accounts.aggregator.key(),
    });

    Ok(())
}
