//! # SSS-11 — Credit Stablecoin (undercollateralized, compliance-heavy)
//!
//! Implements a credit-based stablecoin system where borrowers post collateral
//! to receive stablecoin issuance below the collateral's full value. This model
//! is used by CDPs (collateralized debt positions) such as MakerDAO/DAI and is
//! suitable for regulated institutions with identity-verified borrowers who can
//! operate at lower collateral ratios than pure over-collateralized systems.
//!
//! ## Position Lifecycle
//!
//! 1. [`open_position`](sss_11::open_position) — Borrower creates a
//!    [`CreditPosition`](state::CreditPosition) PDA with zero collateral and
//!    zero debt.
//! 2. [`deposit_collateral`](sss_11::deposit_collateral) — Borrower deposits
//!    collateral tokens into the credit config's vault.
//! 3. [`issue_credit`](sss_11::issue_credit) — Borrower draws stablecoin up
//!    to the collateral ratio limit.
//! 4. [`repay`](sss_11::repay) — Borrower burns stablecoin to reduce debt.
//! 5. [`withdraw_collateral`](sss_11::withdraw_collateral) — Borrower
//!    withdraws collateral if ratio stays above minimum.
//!
//! ## Liquidation
//!
//! If the collateral ratio falls below `liquidation_threshold_bps`, anyone may
//! call [`liquidate`](sss_11::liquidate), which burns all outstanding debt from
//! the liquidator's balance and transfers the collateral (minus penalty) to the
//! liquidator. The position is then closed.
//!
//! ## Collateral Ratio Formula
//!
//! `ratio_bps = (collateral_amount * 10000) / issued_amount`
//!
//! When `issued_amount == 0`, the ratio is `u16::MAX` (no debt).
//!
//! ## Checked Arithmetic
//!
//! All arithmetic uses `checked_add` / `checked_sub` / `checked_mul` and
//! returns [`CreditError::MathOverflow`](error::CreditError::MathOverflow) on
//! overflow.

#![deny(clippy::all)]
// Anchor-generated code triggers these — safe to allow at crate level.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]
#![allow(clippy::result_large_err)]

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("5HVLwytfKU82SiuUUesevhjh28SExBsHMkLbQ6Wd7Z6q");

#[program]
pub mod sss_11 {
    use super::*;

    /// Initialize the credit stablecoin config with collateral and liquidation parameters.
    pub fn initialize_credit_config(
        ctx: Context<InitializeCreditConfig>,
        min_collateral_ratio_bps: u16,
        liquidation_threshold_bps: u16,
        liquidation_penalty_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            min_collateral_ratio_bps,
            liquidation_threshold_bps,
            liquidation_penalty_bps,
        )
    }

    /// Open a new credit position for the signer.
    pub fn open_position(ctx: Context<OpenPosition>) -> Result<()> {
        instructions::open_position::handler(ctx)
    }

    /// Deposit collateral tokens into the position vault.
    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        instructions::deposit_collateral::handler(ctx, amount)
    }

    /// Issue stablecoin credit against the deposited collateral.
    pub fn issue_credit(ctx: Context<IssueCredit>, amount: u64) -> Result<()> {
        instructions::issue_credit::handler(ctx, amount)
    }

    /// Repay outstanding stablecoin debt, burning tokens from the borrower's ATA.
    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::repay::handler(ctx, amount)
    }

    /// Withdraw collateral from the vault, subject to minimum ratio constraint.
    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        instructions::withdraw_collateral::handler(ctx, amount)
    }

    /// Liquidate an undercollateralized position.
    /// Callable by anyone if the position's ratio is below `liquidation_threshold_bps`.
    pub fn liquidate(ctx: Context<Liquidate>, borrower: Pubkey) -> Result<()> {
        instructions::liquidate::handler(ctx, borrower)
    }
}
