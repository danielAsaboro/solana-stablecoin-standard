use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::OracleError;
use crate::events::OracleConfigUpdated;
use crate::state::OracleConfig;

/// Parameters for updating an oracle configuration.
///
/// All fields are optional — only provided fields are updated. Omitted fields
/// retain their current values.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateOracleConfigParams {
    /// New Switchboard aggregator account address.
    pub new_aggregator: Option<Pubkey>,
    /// New staleness threshold (seconds). Must be > 0 if provided.
    pub new_staleness_threshold: Option<i64>,
    /// New minimum acceptable price.
    pub new_min_price: Option<u64>,
    /// New maximum acceptable price.
    pub new_max_price: Option<u64>,
    /// Enable or disable manual price pushing.
    pub new_manual_override: Option<bool>,
}

/// Accounts required to update an oracle configuration.
///
/// Only the oracle config authority can update settings.
#[derive(Accounts)]
pub struct UpdateOracleConfig<'info> {
    /// The oracle config authority. Must match `oracle_config.authority`.
    #[account(
        constraint = authority.key() == oracle_config.authority @ OracleError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    /// The oracle config PDA to update.
    #[account(
        mut,
        seeds = [ORACLE_CONFIG_SEED, oracle_config.stablecoin_config.as_ref()],
        bump = oracle_config.bump,
    )]
    pub oracle_config: Account<'info, OracleConfig>,
}

/// Update an existing oracle configuration.
///
/// Allows the authority to change the aggregator address, staleness threshold,
/// price bounds, and manual override setting. All parameters are optional —
/// only provided values are applied.
///
/// # Validation
///
/// - `new_staleness_threshold` must be > 0 if provided.
/// - After applying updates, `min_price` must be < `max_price`.
///
/// # Events
///
/// Emits [`OracleConfigUpdated`].
pub fn handler(ctx: Context<UpdateOracleConfig>, params: UpdateOracleConfigParams) -> Result<()> {
    let oracle_config = &mut ctx.accounts.oracle_config;

    if let Some(aggregator) = params.new_aggregator {
        oracle_config.aggregator = aggregator;
    }

    if let Some(staleness) = params.new_staleness_threshold {
        require!(staleness > 0, OracleError::InvalidStaleness);
        oracle_config.staleness_threshold = staleness;
    }

    if let Some(min) = params.new_min_price {
        oracle_config.min_price = min;
    }

    if let Some(max) = params.new_max_price {
        oracle_config.max_price = max;
    }

    if let Some(manual) = params.new_manual_override {
        oracle_config.manual_override = manual;
    }

    // Validate bounds consistency after updates
    require!(
        oracle_config.min_price < oracle_config.max_price,
        OracleError::InvalidPriceBounds
    );

    emit!(OracleConfigUpdated {
        oracle_config: ctx.accounts.oracle_config.key(),
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
