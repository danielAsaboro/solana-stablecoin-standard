use anchor_lang::prelude::*;

use crate::error::AsyncError;
use crate::events::MintExecuted;
use crate::state::{AsyncConfig, MintRequest, RequestStatus};

/// Accounts required to execute an approved mint request.
///
/// This instruction does NOT perform the actual token mint CPI — the actual
/// minting is done through the main SSS program, which accepts this request PDA
/// as proof of approval. Executing this instruction simply marks the request as
/// `Executed` so it cannot be acted upon again.
#[derive(Accounts)]
#[instruction(request_id: u64)]
pub struct ExecuteMint<'info> {
    /// Anyone may call this once the request is `Approved`.
    pub executor: Signer<'info>,

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
    )]
    pub mint_request: Account<'info, MintRequest>,
}

/// Mark an `Approved` mint request as `Executed`.
///
/// Callable by anyone once the request has been approved. Transitions
/// `Approved` → `Executed` so the request cannot be re-executed. The actual
/// token mint is expected to be performed via the SSS program using this PDA
/// as proof of authorization.
pub fn handler(ctx: Context<ExecuteMint>, _request_id: u64) -> Result<()> {
    let mint_request = &mut ctx.accounts.mint_request;
    require!(
        mint_request.status == RequestStatus::Approved,
        AsyncError::InvalidStatus
    );

    let clock = Clock::get()?;
    let amount = mint_request.amount;
    mint_request.status = RequestStatus::Executed;
    mint_request.updated_at = clock.unix_timestamp;

    emit!(MintExecuted {
        request_id: mint_request.request_id,
        amount,
    });

    Ok(())
}
