use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PrivacyError;
use crate::events::AllowlistEntryAdded;
use crate::state::{AllowlistEntry, PrivacyConfig};

/// Parameters for adding an address to the confidential transfer allowlist.
///
/// Passed to [`add_to_allowlist`](crate::sss_privacy::add_to_allowlist).
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AddToAllowlistParams {
    /// Human-readable label for the allowlisted address (max 32 bytes).
    /// Examples: "Treasury", "Market Maker A", "Custodian".
    pub label: String,
}

/// Accounts required to add an address to the allowlist.
///
/// Creates a new [`AllowlistEntry`] PDA for the specified address and increments
/// the allowlist count on the privacy config. Only the privacy authority can
/// add entries.
#[derive(Accounts)]
pub struct AddToAllowlist<'info> {
    /// The privacy config authority. Must match `privacy_config.authority`.
    /// Also the payer for creating the allowlist entry account.
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

    /// The allowlist entry PDA to create for the given address.
    #[account(
        init,
        payer = authority,
        space = AllowlistEntry::LEN,
        seeds = [ALLOWLIST_SEED, privacy_config.key().as_ref(), address.key().as_ref()],
        bump,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,

    /// The address to add to the allowlist. Can be any valid public key
    /// (wallet, token account, etc.).
    /// CHECK: The address to add to the allowlist. Can be any valid public key.
    /// No validation is needed — the address is simply stored as a reference.
    pub address: UncheckedAccount<'info>,

    /// The Solana system program, required for account creation.
    pub system_program: Program<'info, System>,
}

/// Add an address to the confidential transfer allowlist.
///
/// Creates a new [`AllowlistEntry`] PDA and increments the privacy config's
/// `allowlist_count`. The entry records who added the address and when.
///
/// # Validation
///
/// - The `label` must not exceed [`MAX_LABEL_LEN`] (32 bytes).
/// - The authority must match the privacy config authority.
///
/// # Events
///
/// Emits [`AllowlistEntryAdded`].
pub fn handler(ctx: Context<AddToAllowlist>, params: AddToAllowlistParams) -> Result<()> {
    require!(
        params.label.len() <= MAX_LABEL_LEN,
        PrivacyError::LabelTooLong
    );

    let clock = Clock::get()?;

    let allowlist_entry = &mut ctx.accounts.allowlist_entry;
    allowlist_entry.config = ctx.accounts.privacy_config.key();
    allowlist_entry.address = ctx.accounts.address.key();
    allowlist_entry.label = params.label.clone();
    allowlist_entry.added_at = clock.unix_timestamp;
    allowlist_entry.added_by = ctx.accounts.authority.key();
    allowlist_entry.bump = ctx.bumps.allowlist_entry;

    let privacy_config = &mut ctx.accounts.privacy_config;
    privacy_config.allowlist_count = privacy_config
        .allowlist_count
        .checked_add(1)
        .ok_or(PrivacyError::MathOverflow)?;

    emit!(AllowlistEntryAdded {
        config: ctx.accounts.privacy_config.key(),
        address: ctx.accounts.address.key(),
        label: params.label,
        added_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
