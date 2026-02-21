use anchor_lang::prelude::*;
use anchor_spl::token_interface;
use anchor_spl::token_interface::TokenInterface;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::TokensBurned;
use crate::state::{RoleAccount, StablecoinConfig};

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    pub burner: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), &[ROLE_BURNER], burner.key().as_ref()],
        bump = role_account.bump,
        constraint = role_account.active @ StablecoinError::Unauthorized,
    )]
    pub role_account: Account<'info, RoleAccount>,

    /// CHECK: Token-2022 mint
    #[account(
        mut,
        address = config.mint,
    )]
    pub mint: AccountInfo<'info>,

    /// CHECK: Token account to burn from (must be owned/delegated by burner)
    #[account(mut)]
    pub from_token_account: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);
    require!(!ctx.accounts.config.paused, StablecoinError::Paused);

    // CPI: burn tokens (burner must be the token account owner or delegate)
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_interface::Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.from_token_account.to_account_info(),
                authority: ctx.accounts.burner.to_account_info(),
            },
        ),
        amount,
    )?;

    let config = &mut ctx.accounts.config;
    config.total_burned = config
        .total_burned
        .checked_add(amount)
        .ok_or(StablecoinError::MathOverflow)?;

    emit!(TokensBurned {
        config: ctx.accounts.config.key(),
        burner: ctx.accounts.burner.key(),
        from: ctx.accounts.from_token_account.key(),
        amount,
    });

    Ok(())
}
