//! Add an address to the allowlist/blocklist by creating an [`AllowlistEntry`] PDA.

use anchor_lang::prelude::*;

use crate::error::AllowlistError;
use crate::events::AddressAddedToAllowlist;
use crate::state::{AllowlistConfig, AllowlistEntry, MAX_LABEL_LEN};

/// Accounts required to add an address to the allowlist.
#[derive(Accounts)]
#[instruction(address: Pubkey, label: String)]
pub struct AddToAllowlist<'info> {
    /// The allowlist authority — must match `allowlist_config.authority`.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The allowlist configuration PDA.
    #[account(
        seeds = [AllowlistConfig::SEED_PREFIX, allowlist_config.stablecoin_config.as_ref()],
        bump = allowlist_config.bump,
        constraint = allowlist_config.authority == authority.key() @ AllowlistError::Unauthorized,
    )]
    pub allowlist_config: Account<'info, AllowlistConfig>,

    /// The allowlist entry PDA to create. Uniquely identifies the address within
    /// this allowlist. Creation fails if the PDA already exists (i.e., the address
    /// is already listed), which surfaces as an Anchor `AccountAlreadyInitialized`
    /// error equivalent to [`AllowlistError::AlreadyListed`].
    #[account(
        init,
        payer = authority,
        space = AllowlistEntry::LEN,
        seeds = [AllowlistEntry::SEED_PREFIX, allowlist_config.key().as_ref(), address.as_ref()],
        bump,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,

    pub system_program: Program<'info, System>,
}

/// Add `address` to the allowlist by creating an [`AllowlistEntry`] PDA.
///
/// The label must not exceed [`MAX_LABEL_LEN`] characters. Emits
/// [`AddressAddedToAllowlist`].
pub fn handler(ctx: Context<AddToAllowlist>, address: Pubkey, label: String) -> Result<()> {
    require!(label.len() <= MAX_LABEL_LEN, AllowlistError::LabelTooLong);

    let clock = Clock::get()?;

    let allowlist_entry = &mut ctx.accounts.allowlist_entry;
    allowlist_entry.allowlist_config = ctx.accounts.allowlist_config.key();
    allowlist_entry.address = address;
    allowlist_entry.label = label.clone();
    allowlist_entry.added_at = clock.unix_timestamp;
    allowlist_entry.bump = ctx.bumps.allowlist_entry;

    emit!(AddressAddedToAllowlist {
        allowlist_config: ctx.accounts.allowlist_config.key(),
        address,
        label,
        added_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
