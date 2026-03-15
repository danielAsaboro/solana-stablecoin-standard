use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::RoleUpdated;
use crate::state::{RoleAccount, StablecoinConfig};

#[derive(Accounts)]
#[instruction(role_type: u8, user: Pubkey)]
pub struct UpdateRole<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [ROLE_SEED, config.key().as_ref(), &[role_type], user.as_ref()],
        bump = role_account.bump,
    )]
    pub role_account: Account<'info, RoleAccount>,
}

pub fn handler(
    ctx: Context<UpdateRole>,
    _role_type: u8,
    _user: Pubkey,
    active: bool,
) -> Result<()> {
    ctx.accounts.role_account.active = active;

    emit!(RoleUpdated {
        config: ctx.accounts.config.key(),
        user: ctx.accounts.role_account.user,
        role_type: ctx.accounts.role_account.role_type,
        active,
        updated_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
