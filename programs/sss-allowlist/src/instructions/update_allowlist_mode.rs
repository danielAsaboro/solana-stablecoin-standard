//! Update the access mode on an existing [`AllowlistConfig`] PDA.

use anchor_lang::prelude::*;

use crate::error::AllowlistError;
use crate::events::AllowlistModeUpdated;
use crate::state::{AccessMode, AllowlistConfig};

/// Accounts required to update the allowlist mode.
#[derive(Accounts)]
pub struct UpdateAllowlistMode<'info> {
    /// The allowlist authority — must match `allowlist_config.authority`.
    pub authority: Signer<'info>,

    /// The allowlist configuration PDA to update.
    #[account(
        mut,
        seeds = [AllowlistConfig::SEED_PREFIX, allowlist_config.stablecoin_config.as_ref()],
        bump = allowlist_config.bump,
        constraint = allowlist_config.authority == authority.key() @ AllowlistError::Unauthorized,
    )]
    pub allowlist_config: Account<'info, AllowlistConfig>,
}

/// Change the access mode on an existing [`AllowlistConfig`].
///
/// Requires the allowlist authority. Rejects the update if the new mode equals
/// the current mode. Emits [`AllowlistModeUpdated`].
pub fn handler(ctx: Context<UpdateAllowlistMode>, mode: AccessMode) -> Result<()> {
    let allowlist_config = &mut ctx.accounts.allowlist_config;

    let old_mode_byte: u8 = match &allowlist_config.mode {
        AccessMode::Open => 0,
        AccessMode::Allowlist => 1,
        AccessMode::Blocklist => 2,
    };
    let new_mode_byte: u8 = match &mode {
        AccessMode::Open => 0,
        AccessMode::Allowlist => 1,
        AccessMode::Blocklist => 2,
    };

    require!(allowlist_config.mode != mode, AllowlistError::SameMode);

    allowlist_config.mode = mode;

    emit!(AllowlistModeUpdated {
        stablecoin_config: allowlist_config.stablecoin_config,
        old_mode: old_mode_byte,
        new_mode: new_mode_byte,
        updated_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
