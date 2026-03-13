use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked};

use crate::error::AsyncError;
use crate::events::RedeemExecuted;
use crate::state::{AsyncConfig, RedeemRequest, RequestStatus};

/// Accounts required to execute an approved redeem request.
///
/// Transfers tokens from the requester's source token account into a burn ATA
/// controlled by the async config PDA, then marks the request as `Executed`.
/// The burn ATA is owned by the async config PDA (signer authority via seeds).
#[derive(Accounts)]
#[instruction(request_id: u64)]
pub struct ExecuteRedeem<'info> {
    /// Anyone may execute an approved request.
    pub executor: Signer<'info>,

    #[account(
        seeds = [AsyncConfig::SEED_PREFIX, async_config.stablecoin_config.as_ref()],
        bump = async_config.bump,
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

    /// CHECK: Token-2022 mint — caller must provide the correct mint.
    pub mint: AccountInfo<'info>,

    /// Source token account from which tokens are transferred out.
    /// Must match `redeem_request.source_token_account`.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
        constraint = source_token_account.key() == redeem_request.source_token_account
            @ AsyncError::RequestNotFound,
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Burn vault ATA owned by the async config PDA. Tokens are transferred here
    /// before being burned off-chain or via a separate burn instruction.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
        token::authority = async_config,
    )]
    pub burn_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Execute an approved [`RedeemRequest`].
///
/// Transfers `amount` tokens from the requester's source token account into
/// the async config's burn vault ATA, then marks the request as `Executed`.
/// The mint decimals are read from the mint account data to satisfy the
/// `transfer_checked` constraint.
pub fn handler(ctx: Context<ExecuteRedeem>, _request_id: u64) -> Result<()> {
    let redeem_request = &mut ctx.accounts.redeem_request;
    require!(
        redeem_request.status == RequestStatus::Approved,
        AsyncError::InvalidStatus
    );

    let amount = redeem_request.amount;

    // Read decimals from mint account for transfer_checked.
    let mint_data = ctx.accounts.mint.try_borrow_data()?;
    let decimals = mint_data[44]; // byte 44 is the decimals field in SPL Mint layout

    // CPI: transfer_checked from source → burn vault.
    // The source account must have already delegated to async_config PDA so that
    // the config PDA can act as transfer authority permissionlessly.
    let stablecoin_config_key = ctx.accounts.async_config.stablecoin_config;
    let bump = ctx.accounts.async_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        AsyncConfig::SEED_PREFIX,
        stablecoin_config_key.as_ref(),
        &[bump],
    ]];
    drop(mint_data);

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.source_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.burn_vault.to_account_info(),
                authority: ctx.accounts.async_config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )?;

    let clock = Clock::get()?;
    redeem_request.status = RequestStatus::Executed;
    redeem_request.updated_at = clock.unix_timestamp;

    emit!(RedeemExecuted {
        request_id: redeem_request.request_id,
        amount,
    });

    Ok(())
}
