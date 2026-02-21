use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::StablecoinPaused;
use crate::state::{RoleAccount, StablecoinConfig};

/// Accounts required to pause the stablecoin.
///
/// The authority must hold an active Pauser role. Pausing blocks minting and
/// burning but does not prevent transfers.
#[derive(Accounts)]
pub struct Pause<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), &[ROLE_PAUSER], authority.key().as_ref()],
        bump = role_account.bump,
        constraint = role_account.active @ StablecoinError::Unauthorized,
    )]
    pub role_account: Account<'info, RoleAccount>,
}

/// Pause the stablecoin, blocking all mint and burn operations.
///
/// Fails if already paused. Emits [`StablecoinPaused`].
pub fn handler(ctx: Context<Pause>) -> Result<()> {
    require!(!ctx.accounts.config.paused, StablecoinError::Paused);

    ctx.accounts.config.paused = true;

    emit!(StablecoinPaused {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
