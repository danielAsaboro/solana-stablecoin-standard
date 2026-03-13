use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked};

use crate::error::CreditError;
use crate::events::CollateralDeposited;
use crate::state::{CreditConfig, CreditPosition};

/// Accounts required to deposit collateral into a credit position.
///
/// Collateral is transferred from the borrower's token account into a vault
/// PDA controlled by the credit config. Collateral ratio is updated after.
#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
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

    /// CHECK: Collateral mint — could be any SPL token used as collateral.
    pub collateral_mint: AccountInfo<'info>,

    /// Borrower's collateral token account (source).
    #[account(
        mut,
        token::mint = collateral_mint,
        token::token_program = token_program,
    )]
    pub borrower_collateral: InterfaceAccount<'info, TokenAccount>,

    /// Vault ATA owned by the credit config PDA (destination).
    #[account(
        mut,
        token::mint = collateral_mint,
        token::token_program = token_program,
        token::authority = credit_config,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Deposit collateral into the borrower's credit position.
///
/// Transfers `amount` tokens from the borrower's collateral ATA into the
/// credit config's collateral vault. Updates `collateral_amount`,
/// `collateral_ratio_bps`, and the global `total_collateral` counter.
///
/// Collateral ratio is recalculated as:
/// `(collateral_amount * 10000) / issued_amount` in bps.
/// When `issued_amount == 0`, the ratio is set to `u16::MAX`.
pub fn handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, CreditError::ZeroAmount);

    // Read decimals from the collateral mint.
    let mint_data = ctx.accounts.collateral_mint.try_borrow_data()?;
    let decimals = mint_data[44];
    drop(mint_data);

    // CPI: transfer collateral from borrower → vault.
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.borrower_collateral.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    let clock = Clock::get()?;
    let credit_position = &mut ctx.accounts.credit_position;
    let credit_config = &mut ctx.accounts.credit_config;

    credit_position.collateral_amount = credit_position
        .collateral_amount
        .checked_add(amount)
        .ok_or(CreditError::MathOverflow)?;

    credit_config.total_collateral = credit_config
        .total_collateral
        .checked_add(amount)
        .ok_or(CreditError::MathOverflow)?;

    let new_ratio_bps = compute_ratio_bps(
        credit_position.collateral_amount,
        credit_position.issued_amount,
    )?;
    credit_position.collateral_ratio_bps = new_ratio_bps;
    credit_position.last_updated = clock.unix_timestamp;

    emit!(CollateralDeposited {
        credit_config: credit_config.key(),
        borrower: ctx.accounts.borrower.key(),
        amount,
        new_ratio_bps,
    });

    Ok(())
}

/// Compute the collateral ratio in bps.
///
/// Returns `u16::MAX` when `issued == 0` (no outstanding debt).
/// Returns an error on arithmetic overflow.
pub fn compute_ratio_bps(collateral: u64, issued: u64) -> Result<u16> {
    if issued == 0 {
        return Ok(u16::MAX);
    }
    // ratio_bps = (collateral * 10000) / issued
    let ratio = (collateral as u128)
        .checked_mul(10000)
        .ok_or(crate::error::CreditError::MathOverflow)?
        .checked_div(issued as u128)
        .ok_or(crate::error::CreditError::MathOverflow)?;

    // Cap at u16::MAX to avoid truncation on very large ratios.
    Ok(ratio.min(u16::MAX as u128) as u16)
}
