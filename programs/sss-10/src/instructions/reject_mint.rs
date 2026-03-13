use anchor_lang::prelude::*;

use crate::error::AsyncError;
use crate::events::MintRejected;
use crate::state::{AsyncConfig, MintRequest, RequestStatus};

/// Accounts required to reject a mint request.
#[derive(Accounts)]
#[instruction(request_id: u64)]
pub struct RejectMint<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [AsyncConfig::SEED_PREFIX, async_config.stablecoin_config.as_ref()],
        bump = async_config.bump,
        constraint = async_config.authority == authority.key() @ AsyncError::Unauthorized,
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
    )]
    pub mint_request: Account<'info, MintRequest>,
}

/// Reject a [`MintRequest`], transitioning it from `Pending` → `Rejected`.
///
/// Only the async config authority may call this. The request must be `Pending`.
pub fn handler(ctx: Context<RejectMint>, _request_id: u64) -> Result<()> {
    let mint_request = &mut ctx.accounts.mint_request;
    require!(
        mint_request.status == RequestStatus::Pending,
        AsyncError::InvalidStatus
    );

    let clock = Clock::get()?;
    mint_request.status = RequestStatus::Rejected;
    mint_request.updated_at = clock.unix_timestamp;

    emit!(MintRejected {
        request_id: mint_request.request_id,
        rejected_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
