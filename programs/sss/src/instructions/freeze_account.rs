use anchor_lang::prelude::*;
use anchor_spl::token_interface;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::AccountFrozen;
use crate::state::{RoleAccount, StablecoinConfig};

/// Accounts required to freeze a token account.
///
/// The authority must hold an active Pauser role. The config PDA signs the
/// `freeze_account` CPI as the freeze authority.
#[derive(Accounts)]
pub struct FreezeTokenAccount<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), &[ROLE_PAUSER], authority.key().as_ref()],
        bump = role_account.bump,
        constraint = role_account.active @ StablecoinError::Unauthorized,
    )]
    pub role_account: Account<'info, RoleAccount>,

    /// CHECK: Token-2022 mint
    #[account(address = config.mint)]
    pub mint: AccountInfo<'info>,

    /// Token account to freeze, validated to belong to the correct mint and token program.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Freeze a token account, preventing all transfers out.
///
/// The stablecoin must not be paused. Emits [`AccountFrozen`].
pub fn handler(ctx: Context<FreezeTokenAccount>) -> Result<()> {
    require!(!ctx.accounts.config.paused, StablecoinError::Paused);

    let mint_key = ctx.accounts.config.mint;
    let bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[STABLECOIN_SEED, mint_key.as_ref(), &[bump]]];

    token_interface::freeze_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token_interface::FreezeAccount {
            account: ctx.accounts.token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        },
        signer_seeds,
    ))?;

    emit!(AccountFrozen {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.authority.key(),
        account: ctx.accounts.token_account.key(),
    });

    Ok(())
}
