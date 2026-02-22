use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::OracleError;
use crate::events::ManualPricePushed;
use crate::state::OracleConfig;

/// Accounts required to manually push a price to the oracle config.
///
/// Only the oracle config authority can push manual prices, and only when
/// `manual_override` is enabled on the config.
#[derive(Accounts)]
pub struct PushManualPrice<'info> {
    /// The oracle config authority. Must match `oracle_config.authority`.
    #[account(
        constraint = authority.key() == oracle_config.authority @ OracleError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    /// The oracle config PDA to update with the manual price.
    #[account(
        mut,
        seeds = [ORACLE_CONFIG_SEED, oracle_config.stablecoin_config.as_ref()],
        bump = oracle_config.bump,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
}

/// Push a price manually to the oracle config.
///
/// This instruction allows the oracle authority to set the price directly,
/// bypassing the Switchboard aggregator. It is useful for:
///
/// - **Testing and development:** Set deterministic prices on localnet/devnet.
/// - **Backup feed:** Provide pricing when the Switchboard feed is unavailable.
/// - **Custom feeds:** Use off-chain price sources not available on Switchboard.
///
/// # Validation
///
/// - `manual_override` must be enabled on the oracle config.
/// - The price must be within the configured `[min_price, max_price]` bounds.
/// - The price must be greater than zero.
///
/// # Events
///
/// Emits [`ManualPricePushed`].
pub fn handler(ctx: Context<PushManualPrice>, price: u64) -> Result<()> {
    require!(
        ctx.accounts.oracle_config.manual_override,
        OracleError::ManualOverrideDisabled
    );

    require!(price > 0, OracleError::InvalidPrice);

    require!(
        price >= ctx.accounts.oracle_config.min_price
            && price <= ctx.accounts.oracle_config.max_price,
        OracleError::PriceOutOfBounds
    );

    let clock = Clock::get()?;

    let oracle_config = &mut ctx.accounts.oracle_config;
    oracle_config.last_price = price;
    oracle_config.last_timestamp = clock.unix_timestamp;

    emit!(ManualPricePushed {
        oracle_config: ctx.accounts.oracle_config.key(),
        price,
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
