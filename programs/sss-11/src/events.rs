//! Program events emitted by SSS-11 Credit Stablecoin instructions.
//!
//! Every state-changing instruction emits exactly one event. Clients can parse
//! these from transaction logs to monitor positions and liquidations.

use anchor_lang::prelude::*;

/// Emitted when the credit config is initialized.
#[event]
pub struct CreditConfigInitialized {
    /// The newly created [`CreditConfig`](crate::state::CreditConfig) PDA.
    pub credit_config: Pubkey,
    /// The stablecoin config this credit system wraps.
    pub stablecoin_config: Pubkey,
    /// The authority who governs the credit system.
    pub authority: Pubkey,
    /// Minimum collateral ratio in bps.
    pub min_collateral_ratio_bps: u16,
    /// Liquidation threshold in bps.
    pub liquidation_threshold_bps: u16,
    /// Liquidation penalty in bps.
    pub liquidation_penalty_bps: u16,
}

/// Emitted when a borrower opens a new position.
#[event]
pub struct PositionOpened {
    /// The credit config PDA.
    pub credit_config: Pubkey,
    /// The borrower who opened the position.
    pub borrower: Pubkey,
    /// The newly created [`CreditPosition`](crate::state::CreditPosition) PDA.
    pub position: Pubkey,
}

/// Emitted when collateral is deposited into a position.
#[event]
pub struct CollateralDeposited {
    /// The credit config PDA.
    pub credit_config: Pubkey,
    /// The borrower whose position received collateral.
    pub borrower: Pubkey,
    /// Amount of collateral deposited (native units).
    pub amount: u64,
    /// New collateral ratio in bps after the deposit.
    pub new_ratio_bps: u16,
}

/// Emitted when stablecoin credit is issued against a position.
#[event]
pub struct CreditIssued {
    /// The credit config PDA.
    pub credit_config: Pubkey,
    /// The borrower who received the issued stablecoin.
    pub borrower: Pubkey,
    /// Amount of stablecoin issued (base units).
    pub amount: u64,
    /// Collateral ratio in bps after issuance.
    pub new_ratio_bps: u16,
}

/// Emitted when stablecoin is repaid against a position.
#[event]
pub struct CreditRepaid {
    /// The credit config PDA.
    pub credit_config: Pubkey,
    /// The borrower who repaid.
    pub borrower: Pubkey,
    /// Amount of stablecoin repaid (base units).
    pub amount: u64,
    /// Collateral ratio in bps after repayment.
    pub new_ratio_bps: u16,
}

/// Emitted when collateral is withdrawn from a position.
#[event]
pub struct CollateralWithdrawn {
    /// The credit config PDA.
    pub credit_config: Pubkey,
    /// The borrower who withdrew collateral.
    pub borrower: Pubkey,
    /// Amount of collateral withdrawn (native units).
    pub amount: u64,
    /// Collateral ratio in bps after withdrawal.
    pub new_ratio_bps: u16,
}

/// Emitted when an undercollateralized position is liquidated.
#[event]
pub struct PositionLiquidated {
    /// The credit config PDA.
    pub credit_config: Pubkey,
    /// The borrower whose position was liquidated.
    pub borrower: Pubkey,
    /// The liquidator who called the instruction.
    pub liquidator: Pubkey,
    /// Total collateral seized from the position (native units).
    pub collateral_seized: u64,
    /// Liquidation penalty applied in bps.
    pub penalty_bps: u16,
}
