//! Initialize a new [`TimelockConfig`] PDA for a stablecoin.

use anchor_lang::prelude::*;

use crate::error::TimelockError;
use crate::events::TimelockInitialized;
use crate::state::TimelockConfig;

/// Accounts required to initialize the timelock configuration.
#[derive(Accounts)]
pub struct InitializeTimelock<'info> {
    /// The signer who pays for account creation and becomes the timelock authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The SSS stablecoin config key used as a PDA seed.
    ///
    /// CHECK: External account whose pubkey we use only as a seed.
    /// We do not read or write its data.
    pub stablecoin_config: AccountInfo<'info>,

    /// The timelock configuration PDA to be created.
    #[account(
        init,
        payer = authority,
        space = TimelockConfig::LEN,
        seeds = [TimelockConfig::SEED_PREFIX, stablecoin_config.key().as_ref()],
        bump,
    )]
    pub timelock_config: Account<'info, TimelockConfig>,

    pub system_program: Program<'info, System>,
}

/// Create a new [`TimelockConfig`] PDA for a stablecoin.
///
/// `delay_seconds` must be greater than zero. The transaction signer becomes
/// the timelock authority. Emits [`TimelockInitialized`].
pub fn handler(ctx: Context<InitializeTimelock>, delay_seconds: u64) -> Result<()> {
    require!(delay_seconds > 0, TimelockError::InvalidDelay);

    let timelock_config = &mut ctx.accounts.timelock_config;
    timelock_config.stablecoin_config = ctx.accounts.stablecoin_config.key();
    timelock_config.authority = ctx.accounts.authority.key();
    timelock_config.delay_seconds = delay_seconds;
    timelock_config.bump = ctx.bumps.timelock_config;

    emit!(TimelockInitialized {
        stablecoin_config: ctx.accounts.stablecoin_config.key(),
        authority: ctx.accounts.authority.key(),
        delay_seconds,
    });

    Ok(())
}
