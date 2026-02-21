use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::AddressBlacklisted;
use crate::state::{BlacklistEntry, RoleAccount, StablecoinConfig};

#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct AddToBlacklist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.enable_transfer_hook @ StablecoinError::ComplianceNotEnabled,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), &[ROLE_BLACKLISTER], authority.key().as_ref()],
        bump = role_account.bump,
        constraint = role_account.active @ StablecoinError::Unauthorized,
    )]
    pub role_account: Account<'info, RoleAccount>,

    #[account(
        init,
        payer = authority,
        space = BlacklistEntry::LEN,
        seeds = [BLACKLIST_SEED, config.key().as_ref(), address.as_ref()],
        bump,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddToBlacklist>, address: Pubkey, reason: String) -> Result<()> {
    require!(reason.len() <= MAX_REASON_LEN, StablecoinError::ReasonTooLong);

    let clock = Clock::get()?;
    let entry = &mut ctx.accounts.blacklist_entry;
    entry.config = ctx.accounts.config.key();
    entry.address = address;
    entry.reason = reason.clone();
    entry.blacklisted_at = clock.unix_timestamp;
    entry.blacklisted_by = ctx.accounts.authority.key();
    entry.bump = ctx.bumps.blacklist_entry;

    emit!(AddressBlacklisted {
        config: ctx.accounts.config.key(),
        address,
        reason,
        blacklisted_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
