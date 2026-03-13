//! Remove an address from the allowlist by closing its [`AllowlistEntry`] PDA.

use anchor_lang::prelude::*;

use crate::error::AllowlistError;
use crate::events::AddressRemovedFromAllowlist;
use crate::state::{AllowlistConfig, AllowlistEntry};

/// Accounts required to remove an address from the allowlist.
#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct RemoveFromAllowlist<'info> {
    /// The allowlist authority — must match `allowlist_config.authority`.
    /// Receives the rent lamports when the entry PDA is closed.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The allowlist configuration PDA.
    #[account(
        seeds = [AllowlistConfig::SEED_PREFIX, allowlist_config.stablecoin_config.as_ref()],
        bump = allowlist_config.bump,
        constraint = allowlist_config.authority == authority.key() @ AllowlistError::Unauthorized,
    )]
    pub allowlist_config: Account<'info, AllowlistConfig>,

    /// The allowlist entry PDA to close. Closes and returns rent to `authority`.
    #[account(
        mut,
        seeds = [AllowlistEntry::SEED_PREFIX, allowlist_config.key().as_ref(), address.as_ref()],
        bump = allowlist_entry.bump,
        close = authority,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,

    pub system_program: Program<'info, System>,
}

/// Remove `address` from the allowlist by closing its [`AllowlistEntry`] PDA.
///
/// Rent is returned to `authority`. Emits [`AddressRemovedFromAllowlist`].
pub fn handler(ctx: Context<RemoveFromAllowlist>, address: Pubkey) -> Result<()> {
    emit!(AddressRemovedFromAllowlist {
        allowlist_config: ctx.accounts.allowlist_config.key(),
        address,
        removed_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
