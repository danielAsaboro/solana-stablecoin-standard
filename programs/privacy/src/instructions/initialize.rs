use anchor_lang::prelude::*;

use crate::constants::*;
use crate::events::PrivacyInitialized;
use crate::state::PrivacyConfig;

/// Parameters for initializing a new privacy configuration.
///
/// Passed to [`initialize_privacy`](crate::sss_privacy::initialize_privacy).
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializePrivacyParams {
    /// Whether new accounts are auto-approved for confidential transfers.
    /// When `true`, any account can participate without explicit allowlisting.
    pub auto_approve: bool,
}

/// Accounts required to initialize a new privacy configuration.
///
/// Creates a [`PrivacyConfig`] PDA linked to an existing SSS stablecoin config.
/// The authority (payer) becomes the privacy config authority who can manage
/// the allowlist and update settings.
#[derive(Accounts)]
pub struct InitializePrivacy<'info> {
    /// The authority who will own this privacy config. Must be a signer and payer.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The privacy config PDA to initialize.
    #[account(
        init,
        payer = authority,
        space = PrivacyConfig::LEN,
        seeds = [PRIVACY_CONFIG_SEED, stablecoin_config.key().as_ref()],
        bump,
    )]
    pub privacy_config: Account<'info, PrivacyConfig>,

    /// The SSS stablecoin config PDA that this privacy config is linked to.
    /// Passed as an unchecked account since it lives in a different program.
    /// CHECK: The stablecoin config PDA from the SSS program. Validated by the
    /// authority who must also own this config. We store this pubkey as a
    /// reference — the privacy program does not CPI into the SSS program.
    pub stablecoin_config: UncheckedAccount<'info>,

    /// The Solana system program, required for account creation.
    pub system_program: Program<'info, System>,
}

/// Initialize a new privacy configuration for a stablecoin.
///
/// Creates the [`PrivacyConfig`] PDA and links it to the specified SSS stablecoin
/// config. The allowlist starts empty with a count of zero.
///
/// # Events
///
/// Emits [`PrivacyInitialized`].
pub fn handler(ctx: Context<InitializePrivacy>, params: InitializePrivacyParams) -> Result<()> {
    let privacy_config = &mut ctx.accounts.privacy_config;
    privacy_config.authority = ctx.accounts.authority.key();
    privacy_config.stablecoin_config = ctx.accounts.stablecoin_config.key();
    privacy_config.auto_approve = params.auto_approve;
    privacy_config.allowlist_count = 0;
    privacy_config.bump = ctx.bumps.privacy_config;
    privacy_config._reserved = [0u8; 64];

    emit!(PrivacyInitialized {
        config: ctx.accounts.privacy_config.key(),
        stablecoin_config: ctx.accounts.stablecoin_config.key(),
        authority: ctx.accounts.authority.key(),
        auto_approve: params.auto_approve,
    });

    Ok(())
}
