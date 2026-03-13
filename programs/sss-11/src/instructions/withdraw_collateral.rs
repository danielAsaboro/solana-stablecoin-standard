use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TokenInterface, TransferChecked};

use crate::error::CreditError;
use crate::events::CollateralWithdrawn;
use crate::instructions::deposit_collateral::compute_ratio_bps;
use crate::state::{CreditConfig, CreditPosition};

/// Accounts required to withdraw collateral from a credit position.
///
/// The credit config PDA signs the outbound transfer as vault authority.
#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
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

    /// CHECK: Collateral mint.
    pub collateral_mint: AccountInfo<'info>,

    /// Vault ATA owned by credit config PDA (source).
    #[account(
        mut,
        token::mint = collateral_mint,
        token::token_program = token_program,
        token::authority = credit_config,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,

    /// Borrower's collateral ATA (destination).
    #[account(
        mut,
        token::mint = collateral_mint,
        token::token_program = token_program,
    )]
    pub borrower_collateral: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Withdraw `amount` of collateral from the borrower's position.
///
/// Validates that the remaining collateral ratio after withdrawal stays at or
/// above `min_collateral_ratio_bps`. If `issued_amount == 0`, any amount may
/// be withdrawn (ratio is effectively infinite).
pub fn handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, CreditError::ZeroAmount);

    let credit_position = &ctx.accounts.credit_position;
    let credit_config = &ctx.accounts.credit_config;

    let new_collateral = credit_position
        .collateral_amount
        .checked_sub(amount)
        .ok_or(CreditError::MathOverflow)?;

    let new_ratio_bps = compute_ratio_bps(new_collateral, credit_position.issued_amount)?;

    // If there's outstanding debt, ensure ratio stays above minimum.
    if credit_position.issued_amount > 0 {
        require!(
            new_ratio_bps >= credit_config.min_collateral_ratio_bps,
            CreditError::RatioBelowMinimum
        );
    }

    // Read decimals for transfer_checked.
    let mint_data = ctx.accounts.collateral_mint.try_borrow_data()?;
    let decimals = mint_data[44];
    drop(mint_data);

    // CPI: transfer collateral from vault → borrower (signed by credit_config PDA).
    let stablecoin_config_key = credit_config.stablecoin_config;
    let bump = credit_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        CreditConfig::SEED_PREFIX,
        stablecoin_config_key.as_ref(),
        &[bump],
    ]];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.collateral_vault.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.borrower_collateral.to_account_info(),
                authority: ctx.accounts.credit_config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )?;

    let clock = Clock::get()?;
    let credit_position = &mut ctx.accounts.credit_position;
    credit_position.collateral_amount = new_collateral;
    credit_position.collateral_ratio_bps = new_ratio_bps;
    credit_position.last_updated = clock.unix_timestamp;

    let credit_config = &mut ctx.accounts.credit_config;
    credit_config.total_collateral = credit_config
        .total_collateral
        .checked_sub(amount)
        .ok_or(CreditError::MathOverflow)?;

    emit!(CollateralWithdrawn {
        credit_config: credit_config.key(),
        borrower: ctx.accounts.borrower.key(),
        amount,
        new_ratio_bps,
    });

    Ok(())
}
