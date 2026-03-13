use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::AuthorityTransferProposed;
use crate::state::StablecoinConfig;

/// Accounts required to propose a 2-step master authority transfer.
#[derive(Accounts)]
pub struct ProposeAuthorityTransfer<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

/// Propose a transfer of master authority to `new_authority`.
///
/// The transfer is NOT immediate. The proposed authority must call
/// [`accept_authority_transfer`](crate::sss::accept_authority_transfer) to
/// complete the handoff. Only one transfer may be in flight at a time.
///
/// The existing [`transfer_authority`](crate::sss::transfer_authority) remains
/// available as an emergency immediate-transfer path.
///
/// Emits [`AuthorityTransferProposed`].
pub fn handler(ctx: Context<ProposeAuthorityTransfer>, new_authority: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;

    require!(
        config.pending_authority == Pubkey::default(),
        StablecoinError::PendingTransferExists
    );
    require!(
        new_authority != config.master_authority,
        StablecoinError::SameAuthority
    );

    let clock = Clock::get()?;
    config.pending_authority = new_authority;
    config.authority_transfer_at = clock.unix_timestamp;

    emit!(AuthorityTransferProposed {
        config: ctx.accounts.config.key(),
        current_authority: ctx.accounts.authority.key(),
        pending_authority: new_authority,
        proposed_at: clock.unix_timestamp,
    });

    Ok(())
}
