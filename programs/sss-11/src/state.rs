//! On-chain account state for the SSS-11 Credit Stablecoin program.
//!
//! The [`CreditConfig`] governs global parameters for undercollateralized
//! issuance, while [`CreditPosition`] tracks each borrower's individual
//! collateral and debt.

use anchor_lang::prelude::*;

/// Global configuration for the credit stablecoin system.
///
/// Stores collateralization thresholds and aggregate statistics. All ratio
/// parameters are in basis points (bps): 10000 = 100%.
///
/// Seeds: `["credit_config", stablecoin_config]`
#[account]
pub struct CreditConfig {
    /// The SSS [`StablecoinConfig`] PDA this credit system is built on top of.
    pub stablecoin_config: Pubkey,
    /// Master authority who can update parameters.
    pub authority: Pubkey,
    /// Oracle config used for collateral pricing (from the SSS oracle program).
    pub oracle_config: Pubkey,
    /// Minimum collateral ratio required to issue credit, in bps.
    /// e.g., 15000 = 150% collateralization required.
    pub min_collateral_ratio_bps: u16,
    /// Ratio below which a position becomes eligible for liquidation, in bps.
    /// e.g., 12000 = 120%.
    pub liquidation_threshold_bps: u16,
    /// Penalty applied to the collateral seized during liquidation, in bps.
    /// e.g., 1000 = 10% penalty paid to the liquidator.
    pub liquidation_penalty_bps: u16,
    /// Total stablecoin issued across all positions (base units).
    pub total_issued: u64,
    /// Total collateral deposited across all positions (native units).
    pub total_collateral: u64,
    /// PDA bump seed.
    pub bump: u8,
}

impl CreditConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 2 + 2 + 2 + 8 + 8 + 1;
    pub const SEED_PREFIX: &'static [u8] = b"credit_config";
}

/// Per-borrower collateral and debt position.
///
/// One PDA per (credit_config, borrower) pair. The position tracks deposited
/// collateral, outstanding issued stablecoin, and the current collateral ratio.
///
/// Seeds: `["credit_position", credit_config, borrower]`
#[account]
pub struct CreditPosition {
    /// The [`CreditConfig`] this position belongs to.
    pub credit_config: Pubkey,
    /// The borrower's public key.
    pub borrower: Pubkey,
    /// Amount of collateral deposited (native units, e.g., lamports for SOL).
    pub collateral_amount: u64,
    /// Amount of stablecoin issued against this position (base units).
    pub issued_amount: u64,
    /// Current collateral ratio in bps, updated on every deposit/issue/repay.
    /// Set to u16::MAX when no debt is outstanding.
    pub collateral_ratio_bps: u16,
    /// Unix timestamp of the last state-changing operation.
    pub last_updated: i64,
    /// Whether the position is currently active (not closed).
    pub is_active: bool,
    /// PDA bump seed.
    pub bump: u8,
}

impl CreditPosition {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 2 + 8 + 1 + 1;
    pub const SEED_PREFIX: &'static [u8] = b"credit_position";
}
