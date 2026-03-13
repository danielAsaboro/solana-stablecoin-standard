use anchor_lang::prelude::*;

use crate::error::AsyncError;
use crate::events::MintApproved;
use crate::state::{AsyncConfig, MintRequest, RequestStatus};

/// Accounts required to approve a mint request.
#[derive(Accounts)]
#[instruction(request_id: u64)]
pub struct ApproveMint<'info> {
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

/// Approve a [`MintRequest`], transitioning it from `Pending` → `Approved`.
///
/// Records the approving authority in `approved_by`. Only the async config
/// authority may call this instruction. The request must currently be `Pending`.
pub fn handler(ctx: Context<ApproveMint>, _request_id: u64) -> Result<()> {
    let mint_request = &mut ctx.accounts.mint_request;
    require!(
        mint_request.status == RequestStatus::Pending,
        AsyncError::InvalidStatus
    );

    let clock = Clock::get()?;
    mint_request.status = RequestStatus::Approved;
    mint_request.approved_by = ctx.accounts.authority.key();
    mint_request.updated_at = clock.unix_timestamp;

    emit!(MintApproved {
        request_id: mint_request.request_id,
        approved_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
