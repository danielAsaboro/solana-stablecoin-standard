use anchor_lang::prelude::*;

use crate::events::PositionOpened;
use crate::state::{CreditConfig, CreditPosition};

/// Accounts required to open a new credit position.
///
/// Each borrower can hold at most one position per credit config. The
/// `init` constraint enforces uniqueness via the deterministic PDA seed.
#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        seeds = [CreditConfig::SEED_PREFIX, credit_config.stablecoin_config.as_ref()],
        bump = credit_config.bump,
    )]
    pub credit_config: Account<'info, CreditConfig>,

    #[account(
        init,
        payer = borrower,
        space = CreditPosition::LEN,
        seeds = [
            CreditPosition::SEED_PREFIX,
            credit_config.key().as_ref(),
            borrower.key().as_ref(),
        ],
        bump,
    )]
    pub credit_position: Account<'info, CreditPosition>,

    pub system_program: Program<'info, System>,
}

/// Open a new [`CreditPosition`] for the signer.
///
/// Initializes the position with zero collateral and zero debt. The `init`
/// constraint on the PDA ensures each borrower can only open one position
/// per credit config.
pub fn handler(ctx: Context<OpenPosition>) -> Result<()> {
    let clock = Clock::get()?;
    let credit_position = &mut ctx.accounts.credit_position;

    credit_position.credit_config = ctx.accounts.credit_config.key();
    credit_position.borrower = ctx.accounts.borrower.key();
    credit_position.collateral_amount = 0;
    credit_position.issued_amount = 0;
    // No debt outstanding → ratio is effectively infinite; represent as u16::MAX.
    credit_position.collateral_ratio_bps = u16::MAX;
    credit_position.last_updated = clock.unix_timestamp;
    credit_position.is_active = true;
    credit_position.bump = ctx.bumps.credit_position;

    emit!(PositionOpened {
        credit_config: ctx.accounts.credit_config.key(),
        borrower: ctx.accounts.borrower.key(),
        position: credit_position.key(),
    });

    Ok(())
}
