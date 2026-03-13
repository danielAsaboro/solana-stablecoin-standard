use anchor_lang::prelude::*;

use crate::error::AsyncError;
use crate::events::MintCancelled;
use crate::state::{AsyncConfig, MintRequest, RequestStatus};

/// Accounts required to cancel a pending mint request.
#[derive(Accounts)]
#[instruction(request_id: u64)]
pub struct CancelMintRequest<'info> {
    pub requester: Signer<'info>,

    #[account(
        seeds = [AsyncConfig::SEED_PREFIX, async_config.stablecoin_config.as_ref()],
        bump = async_config.bump,
    )]
    pub async_config: Account<'info, AsyncConfig>,

    #[account(
        mut,
        seeds = [
            MintRequest::SEED_PREFIX,
            async_config.key().as_ref(),
            &request_id.to_le_bytes(),
        ],
        bump = mint_request.bump,
        constraint = mint_request.async_config == async_config.key() @ AsyncError::RequestNotFound,
        constraint = mint_request.request_id == request_id @ AsyncError::RequestNotFound,
        constraint = mint_request.requester == requester.key() @ AsyncError::Unauthorized,
    )]
    pub mint_request: Account<'info, MintRequest>,
}

/// Cancel a [`MintRequest`] that is still in `Pending` status.
///
/// Only the original requester may cancel their own request. The request must
/// be `Pending` — approved or executed requests cannot be cancelled.
pub fn handler(ctx: Context<CancelMintRequest>, _request_id: u64) -> Result<()> {
    let mint_request = &mut ctx.accounts.mint_request;
    require!(
        mint_request.status == RequestStatus::Pending,
        AsyncError::InvalidStatus
    );

    let clock = Clock::get()?;
    mint_request.status = RequestStatus::Cancelled;
    mint_request.updated_at = clock.unix_timestamp;

    emit!(MintCancelled {
        request_id: mint_request.request_id,
        cancelled_by: ctx.accounts.requester.key(),
    });

    Ok(())
}
