//! On-chain account state for the SSS Caps module.
//!
//! The [`CapsConfig`] PDA is the single account managed by this program. It
//! stores the global supply cap and per-minter cap that the main SSS program
//! reads from `remaining_accounts` during minting operations.

use anchor_lang::prelude::*;

/// Configuration for supply caps attached to a stablecoin instance.
///
/// Created via [`initialize_caps_config`](crate::sss_caps::initialize_caps_config)
/// and updated via [`update_caps_config`](crate::sss_caps::update_caps_config).
///
/// Seeds: `["caps_config", stablecoin_config]`
#[account]
pub struct CapsConfig {
    /// The SSS [`StablecoinConfig`] PDA this module is attached to.
    pub stablecoin_config: Pubkey,
    /// The authority who may call [`update_caps_config`](crate::sss_caps::update_caps_config).
    pub authority: Pubkey,
    /// Global maximum supply across all minters in base units.
    /// `0` means unlimited — no global cap is enforced.
    pub global_cap: u64,
    /// Maximum cumulative amount that any single minter may mint in base units.
    /// `0` means unlimited — no per-minter cap is enforced.
    pub per_minter_cap: u64,
    /// PDA bump seed.
    pub bump: u8,
}

impl CapsConfig {
    /// Serialized byte length including the 8-byte Anchor discriminator.
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;

    /// Seed prefix used when deriving the PDA.
    pub const SEED_PREFIX: &'static [u8] = b"caps_config";
}
