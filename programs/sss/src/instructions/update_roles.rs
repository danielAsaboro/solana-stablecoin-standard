use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::RoleUpdated;
use crate::state::{RoleAccount, StablecoinConfig};

/// Accounts required to assign or revoke a role.
///
/// Only the master authority can call this instruction. The role PDA is created
/// on first assignment (`init_if_needed`) and persists across activate/deactivate
/// cycles to preserve the PDA address.
#[derive(Accounts)]
#[instruction(role_type: u8, user: Pubkey)]
pub struct UpdateRoles<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = RoleAccount::LEN,
        seeds = [ROLE_SEED, config.key().as_ref(), &[role_type], user.as_ref()],
        bump,
    )]
    pub role_account: Account<'info, RoleAccount>,

    pub system_program: Program<'info, System>,
}

/// Assign or revoke a role for a user.
///
/// Validates the role type is in range (0–4) and that SSS-2 roles (Blacklister,
/// Seizer) are only assignable when the corresponding feature is enabled.
/// Emits [`RoleUpdated`].
pub fn handler(ctx: Context<UpdateRoles>, role_type: u8, user: Pubkey, active: bool) -> Result<()> {
    require!(role_type <= ROLE_SEIZER, StablecoinError::InvalidRole);

    // SSS-2 roles require compliance features
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
    role_account.active = active;
    role_account.bump = ctx.bumps.role_account;

    emit!(RoleUpdated {
        config: ctx.accounts.config.key(),
        user,
        role_type,
        active,
        updated_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
