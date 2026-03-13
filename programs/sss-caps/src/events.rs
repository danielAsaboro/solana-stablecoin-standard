//! Program events emitted by SSS Caps instructions.
//!
//! Every state-changing instruction emits exactly one event. Clients can parse
//! these from transaction logs to build an off-chain audit trail.

use anchor_lang::prelude::*;

/// Emitted when a new [`CapsConfig`](crate::state::CapsConfig) is created via
/// [`initialize_caps_config`](crate::sss_caps::initialize_caps_config).
#[event]
pub struct CapsConfigInitialized {
    /// The SSS stablecoin config PDA this caps module is attached to.
    pub stablecoin_config: Pubkey,
    /// The authority who initialized the caps config.
    pub authority: Pubkey,
    /// The initial global supply cap (`0` = unlimited).
    pub global_cap: u64,
    /// The initial per-minter cap (`0` = unlimited).
    pub per_minter_cap: u64,
}

/// Emitted when caps are updated via
/// [`update_caps_config`](crate::sss_caps::update_caps_config).
#[event]
pub struct CapsConfigUpdated {
    /// The SSS stablecoin config PDA.
    pub stablecoin_config: Pubkey,
    /// The global cap value before the update.
    pub old_global_cap: u64,
    /// The new global cap value.
    pub new_global_cap: u64,
    /// The per-minter cap value before the update.
    pub old_per_minter_cap: u64,
    /// The new per-minter cap value.
    pub new_per_minter_cap: u64,
    /// The authority who performed the update.
    pub updated_by: Pubkey,
}
