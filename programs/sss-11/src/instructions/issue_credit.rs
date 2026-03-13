use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, MintTo, TokenAccount, TokenInterface};

use crate::error::CreditError;
use crate::events::CreditIssued;
use crate::instructions::deposit_collateral::compute_ratio_bps;
use crate::state::{CreditConfig, CreditPosition};

/// Accounts required to issue stablecoin credit against a position.
///
/// The credit config PDA signs the `mint_to` CPI as mint authority over the
/// Token-2022 stablecoin mint. The borrower must have sufficient collateral.
#[derive(Accounts)]
pub struct IssueCredit<'info> {
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

    /// CHECK: Token-2022 stablecoin mint — must be the mint referenced by the stablecoin config.
    #[account(mut)]
    pub stablecoin_mint: AccountInfo<'info>,

    /// Borrower's stablecoin ATA to receive the minted tokens.
    #[account(
        mut,
        token::mint = stablecoin_mint,
        token::token_program = token_program,
    )]
    pub borrower_stablecoin: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Issue `amount` stablecoin tokens to the borrower if the position remains
/// above the minimum collateral ratio after issuance.
///
/// Validates:
/// - `amount > 0`
/// - New collateral ratio ≥ `min_collateral_ratio_bps`
///
/// Updates `issued_amount`, `collateral_ratio_bps`, `total_issued`, and emits
/// [`CreditIssued`].
pub fn handler(ctx: Context<IssueCredit>, amount: u64) -> Result<()> {
    require!(amount > 0, CreditError::ZeroAmount);

    let credit_position = &ctx.accounts.credit_position;
    let credit_config = &ctx.accounts.credit_config;

    let new_issued = credit_position
        .issued_amount
        .checked_add(amount)
        .ok_or(CreditError::MathOverflow)?;

    let new_ratio_bps = compute_ratio_bps(credit_position.collateral_amount, new_issued)?;
    require!(
        new_ratio_bps >= credit_config.min_collateral_ratio_bps,
        CreditError::InsufficientCollateral
    );

    // CPI: mint_to, signed by credit_config PDA as mint authority.
    let stablecoin_config_key = credit_config.stablecoin_config;
    let bump = credit_config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        CreditConfig::SEED_PREFIX,
        stablecoin_config_key.as_ref(),
        &[bump],
    ]];

    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.stablecoin_mint.to_account_info(),
                to: ctx.accounts.borrower_stablecoin.to_account_info(),
                authority: ctx.accounts.credit_config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    let clock = Clock::get()?;
    let credit_position = &mut ctx.accounts.credit_position;
    credit_position.issued_amount = new_issued;
    credit_position.collateral_ratio_bps = new_ratio_bps;
    credit_position.last_updated = clock.unix_timestamp;

    let credit_config = &mut ctx.accounts.credit_config;
    credit_config.total_issued = credit_config
        .total_issued
        .checked_add(amount)
        .ok_or(CreditError::MathOverflow)?;

    emit!(CreditIssued {
        credit_config: credit_config.key(),
        borrower: ctx.accounts.borrower.key(),
        amount,
        new_ratio_bps,
    });

    Ok(())
}
