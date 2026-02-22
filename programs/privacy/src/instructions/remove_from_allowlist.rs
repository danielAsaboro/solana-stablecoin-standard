use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PrivacyError;
use crate::events::AllowlistEntryRemoved;
use crate::state::{AllowlistEntry, PrivacyConfig};

/// Accounts required to remove an address from the allowlist.
///
/// Closes the [`AllowlistEntry`] PDA and returns the rent to the authority.
/// Decrements the allowlist count on the privacy config. Only the privacy
/// authority can remove entries.
#[derive(Accounts)]
pub struct RemoveFromAllowlist<'info> {
    /// The privacy config authority. Must match `privacy_config.authority`.
    /// Receives the rent refund from closing the allowlist entry account.
    #[account(
        mut,
        constraint = authority.key() == privacy_config.authority @ PrivacyError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    /// The privacy config PDA that owns this allowlist.
    #[account(
        mut,
        seeds = [PRIVACY_CONFIG_SEED, privacy_config.stablecoin_config.as_ref()],
        bump = privacy_config.bump,
    )]
    pub privacy_config: Account<'info, PrivacyConfig>,

    /// The allowlist entry PDA to close. The address field is used in the seed
    /// derivation to ensure the correct entry is being removed.
    #[account(
        mut,
        close = authority,
        seeds = [ALLOWLIST_SEED, privacy_config.key().as_ref(), allowlist_entry.address.as_ref()],
        bump = allowlist_entry.bump,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,
}

/// Remove an address from the confidential transfer allowlist.
///
/// Closes the [`AllowlistEntry`] PDA account, returning rent to the authority,
/// and decrements the privacy config's `allowlist_count`.
///
/// # Events
///
/// Emits [`AllowlistEntryRemoved`].
pub fn handler(ctx: Context<RemoveFromAllowlist>) -> Result<()> {
    let address = ctx.accounts.allowlist_entry.address;

    let privacy_config = &mut ctx.accounts.privacy_config;
    privacy_config.allowlist_count = privacy_config
        .allowlist_count
        .checked_sub(1)
        .ok_or(PrivacyError::MathOverflow)?;

    emit!(AllowlistEntryRemoved {
        config: ctx.accounts.privacy_config.key(),
        address,
        removed_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
