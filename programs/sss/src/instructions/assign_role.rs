use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::RoleUpdated;
use crate::state::{RoleAccount, StablecoinConfig};

#[derive(Accounts)]
#[instruction(role_type: u8, user: Pubkey)]
pub struct AssignRole<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init,
        payer = authority,
        space = RoleAccount::LEN,
        seeds = [ROLE_SEED, config.key().as_ref(), &[role_type], user.as_ref()],
        bump,
    )]
    pub role_account: Account<'info, RoleAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AssignRole>, role_type: u8, user: Pubkey) -> Result<()> {
    require!(role_type <= ROLE_SEIZER, StablecoinError::InvalidRole);

    if role_type == ROLE_BLACKLISTER {
        require!(
            ctx.accounts.config.enable_transfer_hook,
            StablecoinError::ComplianceNotEnabled
        );
    }
    if role_type == ROLE_SEIZER {
        require!(
            ctx.accounts.config.enable_permanent_delegate,
            StablecoinError::ComplianceNotEnabled
        );
    }

    let role_account = &mut ctx.accounts.role_account;
    role_account.config = ctx.accounts.config.key();
    role_account.user = user;
    role_account.role_type = role_type;
    role_account.active = true;
    role_account.bump = ctx.bumps.role_account;

    emit!(RoleUpdated {
        config: ctx.accounts.config.key(),
        user,
        role_type,
        active: true,
        updated_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
