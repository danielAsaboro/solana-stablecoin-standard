use anchor_lang::prelude::*;

use crate::error::AsyncError;
use crate::events::RedeemRequested;
use crate::state::{AsyncConfig, RedeemRequest, RequestStatus};

pub(crate) const MAX_MEMO_LEN: usize = 128;

/// Accounts required to submit a redeem request.
#[derive(Accounts)]
#[instruction(amount: u64, memo: String)]
pub struct RequestRedeem<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,

    #[account(
        mut,
        seeds = [AsyncConfig::SEED_PREFIX, async_config.stablecoin_config.as_ref()],
        bump = async_config.bump,
    )]
    pub async_config: Account<'info, AsyncConfig>,

    #[account(
        init,
        payer = requester,
        space = RedeemRequest::LEN,
        seeds = [
            RedeemRequest::SEED_PREFIX,
            async_config.key().as_ref(),
            &async_config.total_requests.to_le_bytes(),
        ],
        bump,
    )]
    pub redeem_request: Account<'info, RedeemRequest>,

    /// CHECK: Source token account the requester controls — validated by the
    /// requester's authority; not verified on-chain here.
    pub source_token_account: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Submit a new [`RedeemRequest`] with status `Pending`.
///
/// Increments `total_requests` on the config (shared counter for mint and redeem).
/// Validates `amount > 0` and `memo.len() <= 128`.
pub fn handler(ctx: Context<RequestRedeem>, amount: u64, memo: String) -> Result<()> {
    require!(amount > 0, AsyncError::ZeroAmount);
    require!(memo.len() <= MAX_MEMO_LEN, AsyncError::MemoTooLong);

    let clock = Clock::get()?;
    let async_config = &mut ctx.accounts.async_config;
    let request_id = async_config.total_requests;

    async_config.total_requests = async_config
        .total_requests
        .checked_add(1)
        .ok_or(AsyncError::MathOverflow)?;

    let redeem_request = &mut ctx.accounts.redeem_request;
    redeem_request.async_config = async_config.key();
    redeem_request.request_id = request_id;
    redeem_request.requester = ctx.accounts.requester.key();
    redeem_request.source_token_account = ctx.accounts.source_token_account.key();
    redeem_request.amount = amount;
    redeem_request.status = RequestStatus::Pending;
    redeem_request.created_at = clock.unix_timestamp;
    redeem_request.updated_at = clock.unix_timestamp;
    redeem_request.approved_by = Pubkey::default();
    redeem_request.memo = memo;
    redeem_request.bump = ctx.bumps.redeem_request;

    emit!(RedeemRequested {
        async_config: async_config.key(),
        request_id,
        requester: ctx.accounts.requester.key(),
        source_token_account: ctx.accounts.source_token_account.key(),
        amount,
    });

    Ok(())
}
