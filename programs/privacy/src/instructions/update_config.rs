use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PrivacyError;
use crate::events::PrivacyConfigUpdated;
use crate::state::PrivacyConfig;

/// Parameters for updating a privacy configuration.
///
/// All fields are optional — only provided fields are updated. Omitted fields
/// retain their current values.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdatePrivacyConfigParams {
    /// New value for auto-approve. When `true`, any account can participate in
    /// confidential transfers without explicit allowlisting.
    pub auto_approve: Option<bool>,
}

/// Accounts required to update a privacy configuration.
///
/// Only the privacy config authority can update settings.
#[derive(Accounts)]
pub struct UpdatePrivacyConfig<'info> {
    /// The privacy config authority. Must match `privacy_config.authority`.
    #[account(
        constraint = authority.key() == privacy_config.authority @ PrivacyError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    /// The privacy config PDA to update.
    #[account(
        mut,
        seeds = [PRIVACY_CONFIG_SEED, privacy_config.stablecoin_config.as_ref()],
        bump = privacy_config.bump,
    )]
    pub privacy_config: Account<'info, PrivacyConfig>,
}

/// Update an existing privacy configuration.
///
/// Allows the authority to change the auto-approve setting. All parameters are
/// optional — only provided values are applied.
///
/// # Events
///
/// Emits [`PrivacyConfigUpdated`].
pub fn handler(ctx: Context<UpdatePrivacyConfig>, params: UpdatePrivacyConfigParams) -> Result<()> {
    let privacy_config = &mut ctx.accounts.privacy_config;

    if let Some(auto_approve) = params.auto_approve {
        privacy_config.auto_approve = auto_approve;
    }

    emit!(PrivacyConfigUpdated {
        config: ctx.accounts.privacy_config.key(),
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
