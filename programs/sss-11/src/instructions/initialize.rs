use anchor_lang::prelude::*;

use crate::error::CreditError;
use crate::events::CreditConfigInitialized;
use crate::state::CreditConfig;

/// Accounts required to initialize the credit stablecoin config.
#[derive(Accounts)]
pub struct InitializeCreditConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = CreditConfig::LEN,
        seeds = [CreditConfig::SEED_PREFIX, stablecoin_config.key().as_ref()],
        bump,
    )]
    pub credit_config: Account<'info, CreditConfig>,

    /// CHECK: Foreign SSS StablecoinConfig PDA — validated as non-default.
    pub stablecoin_config: AccountInfo<'info>,

    /// CHECK: Oracle config from the SSS oracle program — validated as non-default.
    pub oracle_config: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Initialize a new [`CreditConfig`] for the given stablecoin.
///
/// Validates parameter sanity:
/// - `min_collateral_ratio_bps` must be > 10000 (i.e., over-collateralized minimum)
/// - `liquidation_threshold_bps` must be < `min_collateral_ratio_bps`
/// - `liquidation_penalty_bps` must be < 5000 (max 50% penalty sanity check)
pub fn handler(
    ctx: Context<InitializeCreditConfig>,
    min_collateral_ratio_bps: u16,
    liquidation_threshold_bps: u16,
    liquidation_penalty_bps: u16,
) -> Result<()> {
    require_keys_neq!(
        ctx.accounts.stablecoin_config.key(),
        Pubkey::default(),
        CreditError::InvalidConfig
    );
    require_keys_neq!(
        ctx.accounts.oracle_config.key(),
        Pubkey::default(),
        CreditError::InvalidConfig
    );
    require!(min_collateral_ratio_bps > 10000, CreditError::InvalidConfig);
    require!(
        liquidation_threshold_bps < min_collateral_ratio_bps,
        CreditError::InvalidConfig
    );
    require!(liquidation_penalty_bps < 5000, CreditError::InvalidConfig);

    let credit_config = &mut ctx.accounts.credit_config;
    credit_config.stablecoin_config = ctx.accounts.stablecoin_config.key();
    credit_config.authority = ctx.accounts.authority.key();
    credit_config.oracle_config = ctx.accounts.oracle_config.key();
    credit_config.min_collateral_ratio_bps = min_collateral_ratio_bps;
    credit_config.liquidation_threshold_bps = liquidation_threshold_bps;
    credit_config.liquidation_penalty_bps = liquidation_penalty_bps;
    credit_config.total_issued = 0;
    credit_config.total_collateral = 0;
    credit_config.bump = ctx.bumps.credit_config;

    emit!(CreditConfigInitialized {
        credit_config: credit_config.key(),
        stablecoin_config: credit_config.stablecoin_config,
        authority: credit_config.authority,
        min_collateral_ratio_bps,
        liquidation_threshold_bps,
        liquidation_penalty_bps,
    });

    Ok(())
}
