use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, TokenAccount, TokenInterface, TransferChecked};

use crate::error::CreditError;
use crate::events::PositionLiquidated;
use crate::instructions::deposit_collateral::compute_ratio_bps;
use crate::state::{CreditConfig, CreditPosition};

/// Accounts required to liquidate an undercollateralized position.
///
/// The liquidator repays all outstanding debt on behalf of the borrower and
/// receives the borrower's collateral minus the liquidation penalty. The
/// penalty amount remains in the vault (it can be claimed by the authority
/// via a separate governance mechanism).
#[derive(Accounts)]
#[instruction(borrower: Pubkey)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

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
            borrower.as_ref(),
        ],
        bump = credit_position.bump,
        constraint = credit_position.credit_config == credit_config.key() @ CreditError::InvalidConfig,
        constraint = credit_position.borrower == borrower @ CreditError::InvalidConfig,
        constraint = credit_position.is_active @ CreditError::PositionNotActive,
    )]
    pub credit_position: Account<'info, CreditPosition>,

    /// CHECK: Collateral mint.
    pub collateral_mint: AccountInfo<'info>,

    /// CHECK: Token-2022 stablecoin mint.
    #[account(mut)]
    pub stablecoin_mint: AccountInfo<'info>,

    /// Liquidator's stablecoin ATA (debt repayment is burned from here).
    #[account(
        mut,
        token::mint = stablecoin_mint,
        token::token_program = token_program,
    )]
    pub liquidator_stablecoin: InterfaceAccount<'info, TokenAccount>,

    /// Vault ATA owned by credit config PDA (source of collateral).
    #[account(
        mut,
        token::mint = collateral_mint,
        token::token_program = token_program,
        token::authority = credit_config,
    )]
    pub collateral_vault: InterfaceAccount<'info, TokenAccount>,

    /// Liquidator's collateral ATA (receives seized collateral minus penalty).
    #[account(
        mut,
        token::mint = collateral_mint,
        token::token_program = token_program,
    )]
    pub liquidator_collateral: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Liquidate an undercollateralized position.
///
/// Requires that the position's current collateral ratio is strictly below
/// `liquidation_threshold_bps`. The liquidator:
/// 1. Burns all outstanding stablecoin debt from their own ATA.
/// 2. Receives the borrower's full collateral minus the liquidation penalty
///    (penalty stays in the vault for the protocol).
/// 3. The position is marked inactive.
pub fn handler(ctx: Context<Liquidate>, _borrower: Pubkey) -> Result<()> {
    let credit_position = &ctx.accounts.credit_position;
    let credit_config = &ctx.accounts.credit_config;

    // Verify position is actually undercollateralized.
    let current_ratio = compute_ratio_bps(
        credit_position.collateral_amount,
        credit_position.issued_amount,
    )?;
    require!(
        current_ratio < credit_config.liquidation_threshold_bps,
        CreditError::PositionHealthy
    );

    let issued_amount = credit_position.issued_amount;
    let collateral_amount = credit_position.collateral_amount;
    let penalty_bps = credit_config.liquidation_penalty_bps;

    // Calculate penalty amount and liquidator payout.
    // penalty = collateral * penalty_bps / 10000
    // liquidator receives: collateral - penalty
    let penalty_amount = (collateral_amount as u128)
        .checked_mul(penalty_bps as u128)
        .ok_or(CreditError::MathOverflow)?
        .checked_div(10000)
        .ok_or(CreditError::MathOverflow)? as u64;

    let liquidator_collateral_amount = collateral_amount
        .checked_sub(penalty_amount)
        .ok_or(CreditError::MathOverflow)?;

    // Read collateral decimals for transfer_checked.
    let mint_data = ctx.accounts.collateral_mint.try_borrow_data()?;
    let collateral_decimals = mint_data[44];
    drop(mint_data);

    // Step 1: Burn the outstanding stablecoin debt from the liquidator's ATA.
    if issued_amount > 0 {
        token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.stablecoin_mint.to_account_info(),
                    from: ctx.accounts.liquidator_stablecoin.to_account_info(),
                    authority: ctx.accounts.liquidator.to_account_info(),
                },
            ),
            issued_amount,
        )?;
    }

    // Step 2: Transfer (collateral - penalty) to the liquidator.
    if liquidator_collateral_amount > 0 {
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
                    to: ctx.accounts.liquidator_collateral.to_account_info(),
                    authority: ctx.accounts.credit_config.to_account_info(),
                },
                signer_seeds,
            ),
            liquidator_collateral_amount,
            collateral_decimals,
        )?;
    }

    // Step 3: Update global counters and mark position inactive.
    let clock = Clock::get()?;
    let credit_config = &mut ctx.accounts.credit_config;

    credit_config.total_issued = credit_config
        .total_issued
        .checked_sub(issued_amount)
        .ok_or(CreditError::MathOverflow)?;

    // Total collateral decreases only by the amount transferred out; penalty stays in vault.
    credit_config.total_collateral = credit_config
        .total_collateral
        .checked_sub(liquidator_collateral_amount)
        .ok_or(CreditError::MathOverflow)?;

    let credit_position = &mut ctx.accounts.credit_position;
    credit_position.issued_amount = 0;
    credit_position.collateral_amount = penalty_amount; // penalty remains tracked
    credit_position.collateral_ratio_bps = u16::MAX;
    credit_position.is_active = false;
    credit_position.last_updated = clock.unix_timestamp;

    emit!(PositionLiquidated {
        credit_config: credit_config.key(),
        borrower: credit_position.borrower,
        liquidator: ctx.accounts.liquidator.key(),
        collateral_seized: liquidator_collateral_amount,
        penalty_bps,
    });

    Ok(())
}
