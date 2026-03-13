use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::AuthorityTransferAccepted;
use crate::state::StablecoinConfig;

/// Accounts required to accept a pending authority transfer.
///
/// The signer must be the address stored in `config.pending_authority`.
#[derive(Accounts)]
pub struct AcceptAuthorityTransfer<'info> {
    /// The proposed new authority — must sign to confirm acceptance.
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

/// Complete a pending 2-step authority transfer.
///
/// The `new_authority` signer must match the `pending_authority` recorded
/// during [`propose_authority_transfer`](crate::sss::propose_authority_transfer).
/// On success, `master_authority` is updated, `pending_authority` is cleared,
/// and [`AuthorityTransferAccepted`] is emitted.
pub fn handler(ctx: Context<AcceptAuthorityTransfer>) -> Result<()> {
    let config = &mut ctx.accounts.config;

    require!(
        config.pending_authority != Pubkey::default(),
        StablecoinError::NoPendingTransfer
    );
    require!(
        config.pending_authority == ctx.accounts.new_authority.key(),
        StablecoinError::InvalidPendingAuthority
    );

    let previous = config.master_authority;
    let accepted = config.pending_authority;

    config.master_authority = accepted;
    config.pending_authority = Pubkey::default();
    config.authority_transfer_at = 0;

    emit!(AuthorityTransferAccepted {
        config: ctx.accounts.config.key(),
        previous_authority: previous,
        new_authority: accepted,
    });

    Ok(())
}
