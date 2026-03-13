//! Initialize a new [`AllowlistConfig`] PDA for a stablecoin.

use anchor_lang::prelude::*;

use crate::events::AllowlistConfigInitialized;
use crate::state::{AccessMode, AllowlistConfig};

/// Accounts required to initialize the allowlist configuration.
#[derive(Accounts)]
pub struct InitializeAllowlistConfig<'info> {
    /// The signer who pays for account creation and becomes the allowlist authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The SSS stablecoin config key used as a PDA seed.
    ///
    /// CHECK: External account whose pubkey we use only as a seed.
    /// We do not read or write its data.
    pub stablecoin_config: AccountInfo<'info>,

    /// The allowlist configuration PDA to be created.
    #[account(
        init,
        payer = authority,
        space = AllowlistConfig::LEN,
        seeds = [AllowlistConfig::SEED_PREFIX, stablecoin_config.key().as_ref()],
        bump,
    )]
    pub allowlist_config: Account<'info, AllowlistConfig>,

    pub system_program: Program<'info, System>,
}

/// Create a new [`AllowlistConfig`] PDA and set the initial access mode.
///
/// The transaction signer becomes the authority. Emits
/// [`AllowlistConfigInitialized`].
pub fn handler(ctx: Context<InitializeAllowlistConfig>, mode: AccessMode) -> Result<()> {
    let mode_byte: u8 = match mode {
        AccessMode::Open => 0,
        AccessMode::Allowlist => 1,
        AccessMode::Blocklist => 2,
    };

    let allowlist_config = &mut ctx.accounts.allowlist_config;
    allowlist_config.stablecoin_config = ctx.accounts.stablecoin_config.key();
    allowlist_config.authority = ctx.accounts.authority.key();
    allowlist_config.mode = mode;
    allowlist_config.bump = ctx.bumps.allowlist_config;

    emit!(AllowlistConfigInitialized {
        stablecoin_config: ctx.accounts.stablecoin_config.key(),
        authority: ctx.accounts.authority.key(),
        mode: mode_byte,
    });

    Ok(())
}
