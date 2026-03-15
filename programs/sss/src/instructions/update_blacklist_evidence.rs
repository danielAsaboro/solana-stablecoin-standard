use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::EvidenceAttached;
use crate::state::{BlacklistEntry, RoleAccount, StablecoinConfig};

/// Accounts required to attach or update evidence on an existing blacklist entry.
///
/// Uses `realloc` so that legacy blacklist entries (created before evidence fields
/// existed) are transparently expanded to the new size. The payer covers any
/// additional rent.
#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct UpdateBlacklistEvidence<'info> {
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
        realloc = BlacklistEntry::LEN,
        realloc::payer = authority,
        realloc::zero = false,
        seeds = [BLACKLIST_SEED, config.key().as_ref(), address.as_ref()],
        bump = blacklist_entry.bump,
        constraint = blacklist_entry.config == config.key() @ StablecoinError::InvalidAuthority,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    pub system_program: Program<'info, System>,
}

/// Attach or update evidence on an existing blacklist entry.
///
/// Requires a non-zero evidence hash (use `remove_from_blacklist` + `add_to_blacklist`
/// to clear evidence entirely). The `previous_hash` is recorded in the
/// [`EvidenceAttached`] event so the full evidence history is preserved in
/// transaction logs even when evidence is overwritten.
pub fn handler(
    ctx: Context<UpdateBlacklistEvidence>,
    _address: Pubkey,
    evidence_hash: [u8; 32],
    evidence_uri: String,
) -> Result<()> {
    require!(
        evidence_hash != [0u8; 32],
        StablecoinError::InvalidEvidenceHash
    );
    require!(
        evidence_uri.len() <= MAX_EVIDENCE_URI_LEN,
        StablecoinError::EvidenceUriTooLong
    );

    let entry = &mut ctx.accounts.blacklist_entry;
    let previous_hash = entry.evidence_hash;

    entry.evidence_hash = evidence_hash;
    entry.evidence_uri = evidence_uri.clone();

    emit!(EvidenceAttached {
        config: ctx.accounts.config.key(),
        address: entry.address,
        evidence_hash,
        evidence_uri,
        previous_hash,
        attached_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
