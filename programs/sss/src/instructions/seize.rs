use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::TokenInterface;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::TokensSeized;
use crate::state::{RoleAccount, StablecoinConfig};

/// Accounts required to seize tokens from an account (SSS-2 only).
///
/// The authority must hold an active Seizer role and the stablecoin must have
/// permanent delegate enabled. The config PDA acts as the permanent delegate,
/// allowing it to transfer tokens out of any account without the owner's consent.
///
/// `remaining_accounts` must include the transfer hook's extra account metas
/// (resolved by the SDK) so Token-2022 can forward them to the hook program.
#[derive(Accounts)]
pub struct Seize<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.enable_permanent_delegate @ StablecoinError::PermanentDelegateNotEnabled,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), &[ROLE_SEIZER], authority.key().as_ref()],
        bump = role_account.bump,
        constraint = role_account.active @ StablecoinError::Unauthorized,
    )]
    pub role_account: Account<'info, RoleAccount>,

    /// CHECK: Token-2022 mint
    #[account(address = config.mint)]
    pub mint: AccountInfo<'info>,

    /// CHECK: Source token account to seize from
    #[account(mut)]
    pub from_token_account: AccountInfo<'info>,

    /// CHECK: Destination token account (e.g., treasury)
    #[account(mut)]
    pub to_token_account: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Seize `amount` tokens from a source account to a destination (e.g., treasury).
///
/// Uses the config PDA as permanent delegate to execute `transfer_checked`.
/// The transfer hook's extra accounts are passed via `remaining_accounts` so
/// Token-2022 can invoke the hook — the hook recognizes the permanent delegate
/// as the authority and skips blacklist checks. Emits [`TokensSeized`].
pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, Seize<'info>>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);

    let mint_key = ctx.accounts.config.mint;
    let bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        STABLECOIN_SEED,
        mint_key.as_ref(),
        &[bump],
    ]];

    let decimals = ctx.accounts.config.decimals;

    // Build the transfer_checked instruction manually so that remaining_accounts
    // (needed by the transfer hook) are forwarded through the CPI.  Anchor's
    // token_interface::transfer_checked helper does NOT pass remaining_accounts
    // to invoke_signed, which prevents Token-2022 from resolving the transfer
    // hook's ExtraAccountMetas.
    let mut ix = spl_token_2022::instruction::transfer_checked(
        ctx.accounts.token_program.key,
        ctx.accounts.from_token_account.key,
        ctx.accounts.mint.key,
        ctx.accounts.to_token_account.key,
        ctx.accounts.config.to_account_info().key,
        &[],
        amount,
        decimals,
    )?;

    // Append the remaining accounts to the instruction's account metas.
    // These are the transfer hook's extra accounts (resolved from ExtraAccountMetas),
    // the hook program, and the ExtraAccountMetas PDA.  Token-2022 needs them in
    // the instruction's account list to forward them to the hook program.
    for remaining in ctx.remaining_accounts.iter() {
        ix.accounts.push(anchor_lang::solana_program::instruction::AccountMeta {
            pubkey: *remaining.key,
            is_signer: remaining.is_signer,
            is_writable: remaining.is_writable,
        });
    }

    // Collect ALL account infos: the 4 base accounts + remaining accounts.
    let mut account_infos = vec![
        ctx.accounts.from_token_account.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.to_token_account.to_account_info(),
        ctx.accounts.config.to_account_info(),
    ];
    for remaining in ctx.remaining_accounts.iter() {
        account_infos.push(remaining.to_account_info());
    }

    invoke_signed(&ix, &account_infos, signer_seeds)?;

    emit!(TokensSeized {
        config: ctx.accounts.config.key(),
        from: ctx.accounts.from_token_account.key(),
        to: ctx.accounts.to_token_account.key(),
        amount,
        seized_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
