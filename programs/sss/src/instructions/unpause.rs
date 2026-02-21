use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::StablecoinUnpaused;
use crate::state::{RoleAccount, StablecoinConfig};

#[derive(Accounts)]
pub struct Unpause<'info> {
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

pub fn handler(ctx: Context<Unpause>) -> Result<()> {
    require!(ctx.accounts.config.paused, StablecoinError::NotPaused);

    ctx.accounts.config.paused = false;

    emit!(StablecoinUnpaused {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
