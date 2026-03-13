use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, TokenAccount, TokenInterface};

use crate::error::CreditError;
use crate::events::CreditRepaid;
use crate::instructions::deposit_collateral::compute_ratio_bps;
use crate::state::{CreditConfig, CreditPosition};

/// Accounts required to repay stablecoin debt against a position.
///
/// Burns `amount` stablecoin tokens from the borrower's ATA, reducing the
/// outstanding `issued_amount`. The credit config PDA is the burn authority.
#[derive(Accounts)]
pub struct Repay<'info> {
    pub borrower: Signer<'info>,

    #[account(
        mut,
        seeds = [CreditConfig::SEED_PREFIX, credit_config.stablecoin_config.as_ref()],
        bump = credit_config.bump,
    )]
    pub credit_config: Account<'info, CreditConfig>,

    #[account(
        mut,
        seeds = [
            CreditPosition::SEED_PREFIX,
            credit_config.key().as_ref(),
            borrower.key().as_ref(),
        ],
        bump = credit_position.bump,
        constraint = credit_position.credit_config == credit_config.key() @ CreditError::InvalidConfig,
        constraint = credit_position.borrower == borrower.key() @ CreditError::Unauthorized,
        constraint = credit_position.is_active @ CreditError::PositionNotActive,
    )]
    pub credit_position: Account<'info, CreditPosition>,

    /// CHECK: Token-2022 stablecoin mint.
    #[account(mut)]
    pub stablecoin_mint: AccountInfo<'info>,

    /// Borrower's stablecoin ATA (tokens burned from here).
    #[account(
        mut,
        token::mint = stablecoin_mint,
        token::token_program = token_program,
    )]
    pub borrower_stablecoin: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Repay `amount` of outstanding stablecoin debt.
///
/// Burns stablecoin tokens from the borrower's ATA, decreasing `issued_amount`
/// and updating the collateral ratio. If `amount >= issued_amount`, the position
/// becomes fully repaid and ratio is reset to `u16::MAX`.
pub fn handler(ctx: Context<Repay>, amount: u64) -> Result<()> {
    require!(amount > 0, CreditError::ZeroAmount);

    let credit_position = &ctx.accounts.credit_position;

    // Cap repayment at the outstanding issued amount.
    let repay_amount = amount.min(credit_position.issued_amount);
    require!(repay_amount > 0, CreditError::ZeroAmount);

    // CPI: burn from borrower's ATA (borrower signs).
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.stablecoin_mint.to_account_info(),
                from: ctx.accounts.borrower_stablecoin.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        repay_amount,
    )?;

    let clock = Clock::get()?;
    let credit_position = &mut ctx.accounts.credit_position;

    let new_issued = credit_position
        .issued_amount
        .checked_sub(repay_amount)
        .ok_or(CreditError::MathOverflow)?;

    credit_position.issued_amount = new_issued;
    let new_ratio_bps =
        compute_ratio_bps(credit_position.collateral_amount, new_issued)?;
    credit_position.collateral_ratio_bps = new_ratio_bps;
    credit_position.last_updated = clock.unix_timestamp;

    let credit_config = &mut ctx.accounts.credit_config;
    credit_config.total_issued = credit_config
        .total_issued
        .checked_sub(repay_amount)
        .ok_or(CreditError::MathOverflow)?;

    emit!(CreditRepaid {
        credit_config: credit_config.key(),
        borrower: ctx.accounts.borrower.key(),
        amount: repay_amount,
        new_ratio_bps,
    });

    Ok(())
}
