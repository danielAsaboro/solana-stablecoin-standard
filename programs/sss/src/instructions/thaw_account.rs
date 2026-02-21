use anchor_lang::prelude::*;
use anchor_spl::token_interface;
use anchor_spl::token_interface::TokenInterface;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::AccountThawed;
use crate::state::{RoleAccount, StablecoinConfig};

/// Accounts required to thaw a previously frozen token account.
///
/// The authority must hold an active Pauser role. The config PDA signs the
/// `thaw_account` CPI as the freeze authority.
#[derive(Accounts)]
pub struct ThawTokenAccount<'info> {
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

    /// CHECK: Token account to thaw
    #[account(mut)]
    pub token_account: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Thaw a frozen token account, restoring transfer capability.
///
/// Unlike freeze, thaw does not require the stablecoin to be unpaused — an
/// operator may need to thaw accounts even while paused. Emits [`AccountThawed`].
pub fn handler(ctx: Context<ThawTokenAccount>) -> Result<()> {
    let mint_key = ctx.accounts.config.mint;
    let bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        STABLECOIN_SEED,
        mint_key.as_ref(),
        &[bump],
    ]];

    token_interface::thaw_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::ThawAccount {
                account: ctx.accounts.token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
    )?;

    emit!(AccountThawed {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.authority.key(),
        account: ctx.accounts.token_account.key(),
    });

    Ok(())
}
