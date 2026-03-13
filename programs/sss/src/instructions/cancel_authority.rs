use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::AuthorityTransferCancelled;
use crate::state::StablecoinConfig;

/// Accounts required to cancel a pending authority transfer.
///
/// Only the current master authority may cancel a pending transfer.
#[derive(Accounts)]
pub struct CancelAuthorityTransfer<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

/// Cancel a pending 2-step authority transfer.
///
/// Only the current master authority may cancel. The `pending_authority` field
/// is cleared and [`AuthorityTransferCancelled`] is emitted.
pub fn handler(ctx: Context<CancelAuthorityTransfer>) -> Result<()> {
    let config = &mut ctx.accounts.config;

    require!(
        config.pending_authority != Pubkey::default(),
        StablecoinError::NoPendingTransfer
    );

    let cleared = config.pending_authority;
    config.pending_authority = Pubkey::default();
    config.authority_transfer_at = 0;

    emit!(AuthorityTransferCancelled {
        config: ctx.accounts.config.key(),
        cancelled_by: ctx.accounts.authority.key(),
        cleared_pending: cleared,
    });

    Ok(())
}
