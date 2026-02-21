use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::AddressUnblacklisted;
use crate::state::{BlacklistEntry, RoleAccount, StablecoinConfig};

/// Accounts required to remove an address from the blacklist (SSS-2 only).
///
/// The authority must hold an active Blacklister role. Closing the
/// [`BlacklistEntry`] PDA returns the rent-exempt lamports to the authority.
#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct RemoveFromBlacklist<'info> {
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
        mut,
        close = authority,
        seeds = [BLACKLIST_SEED, config.key().as_ref(), address.as_ref()],
        bump = blacklist_entry.bump,
        constraint = blacklist_entry.config == config.key(),
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,
}

/// Remove an address from the blacklist.
///
/// The [`BlacklistEntry`] PDA is closed and rent returned to the authority.
/// Subsequent transfers involving this address will no longer be blocked by
/// the transfer hook. Emits [`AddressUnblacklisted`].
pub fn handler(ctx: Context<RemoveFromBlacklist>, address: Pubkey) -> Result<()> {
    emit!(AddressUnblacklisted {
        config: ctx.accounts.config.key(),
        address,
        removed_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
