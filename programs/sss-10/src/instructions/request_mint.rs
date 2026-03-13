use anchor_lang::prelude::*;

use crate::error::AsyncError;
use crate::events::MintRequested;
use crate::state::{AsyncConfig, MintRequest, RequestStatus};

pub(crate) const MAX_MEMO_LEN: usize = 128;

/// Accounts required to submit a mint request.
///
/// The `request_id` seed is derived from `async_config.total_requests` *before*
/// incrementing, so the PDA is deterministic from the caller's perspective.
#[derive(Accounts)]
#[instruction(amount: u64, memo: String)]
pub struct RequestMint<'info> {
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
        space = MintRequest::LEN,
        seeds = [
            MintRequest::SEED_PREFIX,
            async_config.key().as_ref(),
            &async_config.total_requests.to_le_bytes(),
        ],
        bump,
    )]
    pub mint_request: Account<'info, MintRequest>,

    /// CHECK: Recipient token account — ownership is the requester's concern.
    pub recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Submit a new [`MintRequest`] with status `Pending`.
///
/// Increments `total_requests` on the config (used as the next PDA seed).
/// Validates `amount > 0` and `memo.len() <= 128`.
pub fn handler(ctx: Context<RequestMint>, amount: u64, memo: String) -> Result<()> {
    require!(amount > 0, AsyncError::ZeroAmount);
    require!(memo.len() <= MAX_MEMO_LEN, AsyncError::MemoTooLong);

    let clock = Clock::get()?;
    let async_config = &mut ctx.accounts.async_config;
    let request_id = async_config.total_requests;

    async_config.total_requests = async_config
        .total_requests
        .checked_add(1)
        .ok_or(AsyncError::MathOverflow)?;

    let mint_request = &mut ctx.accounts.mint_request;
    mint_request.async_config = async_config.key();
    mint_request.request_id = request_id;
    mint_request.requester = ctx.accounts.requester.key();
    mint_request.recipient = ctx.accounts.recipient.key();
    mint_request.amount = amount;
    mint_request.status = RequestStatus::Pending;
    mint_request.created_at = clock.unix_timestamp;
    mint_request.updated_at = clock.unix_timestamp;
    mint_request.approved_by = Pubkey::default();
    mint_request.memo = memo;
    mint_request.bump = ctx.bumps.mint_request;

    emit!(MintRequested {
        async_config: async_config.key(),
        request_id,
        requester: ctx.accounts.requester.key(),
        recipient: ctx.accounts.recipient.key(),
        amount,
    });

    Ok(())
}
