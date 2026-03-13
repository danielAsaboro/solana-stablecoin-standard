use anchor_lang::prelude::*;

use crate::error::AsyncError;
use crate::events::RedeemApproved;
use crate::state::{AsyncConfig, RedeemRequest, RequestStatus};

/// Accounts required to approve a redeem request.
#[derive(Accounts)]
#[instruction(request_id: u64)]
pub struct ApproveRedeem<'info> {
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
            RedeemRequest::SEED_PREFIX,
            async_config.key().as_ref(),
            &request_id.to_le_bytes(),
        ],
        bump = redeem_request.bump,
        constraint = redeem_request.async_config == async_config.key() @ AsyncError::RequestNotFound,
        constraint = redeem_request.request_id == request_id @ AsyncError::RequestNotFound,
    )]
    pub redeem_request: Account<'info, RedeemRequest>,
}

/// Approve a [`RedeemRequest`], transitioning it from `Pending` → `Approved`.
///
/// Records the approving authority in `approved_by`. Only the async config
/// authority may call this. The request must be `Pending`.
pub fn handler(ctx: Context<ApproveRedeem>, _request_id: u64) -> Result<()> {
    let redeem_request = &mut ctx.accounts.redeem_request;
    require!(
        redeem_request.status == RequestStatus::Pending,
        AsyncError::InvalidStatus
    );

    let clock = Clock::get()?;
    redeem_request.status = RequestStatus::Approved;
    redeem_request.approved_by = ctx.accounts.authority.key();
    redeem_request.updated_at = clock.unix_timestamp;

    emit!(RedeemApproved {
        request_id: redeem_request.request_id,
        approved_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
