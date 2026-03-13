//! On-chain account state for the SSS Allowlist module.
//!
//! Two account types are managed by this program:
//!
//! - [`AllowlistConfig`] — the singleton config PDA per stablecoin that records
//!   the current access mode.
//! - [`AllowlistEntry`] — one PDA per listed address. The transfer hook checks
//!   for the existence of these entries to enforce the current mode.

use anchor_lang::prelude::*;

/// Maximum character length for an [`AllowlistEntry`] label.
pub const MAX_LABEL_LEN: usize = 32;

/// Controls how addresses are checked during transfers.
///
/// Stored as a single `u8` on chain (Anchor derives the discriminant from the
/// variant index: Open=0, Allowlist=1, Blocklist=2).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum AccessMode {
    /// No restriction — all addresses may transfer freely.
    Open,
    /// Allowlist mode — only addresses with an [`AllowlistEntry`] PDA may transfer.
    Allowlist,
    /// Blocklist mode — addresses with an [`AllowlistEntry`] PDA are blocked from
    /// transferring. Equivalent to a blacklist at the module level.
    Blocklist,
}

/// Configuration for the allowlist/blocklist attached to a stablecoin.
///
/// Created via [`initialize_allowlist_config`](crate::sss_allowlist::initialize_allowlist_config)
/// and updated via [`update_allowlist_mode`](crate::sss_allowlist::update_allowlist_mode).
///
/// Seeds: `["allowlist_config", stablecoin_config]`
#[account]
pub struct AllowlistConfig {
    /// The SSS [`StablecoinConfig`] PDA this module is attached to.
    pub stablecoin_config: Pubkey,
    /// The authority who may update the mode and manage entries.
    pub authority: Pubkey,
    /// Current access control mode.
    pub mode: AccessMode,
    /// PDA bump seed.
    pub bump: u8,
}

impl AllowlistConfig {
    /// Serialized byte length: discriminator + fields.
    /// `AccessMode` is stored as a single `u8`.
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1;

    /// Seed prefix used when deriving the PDA.
    pub const SEED_PREFIX: &'static [u8] = b"allowlist_config";
}

/// Records that a specific address is listed (allowlisted or blocklisted).
///
/// Created via [`add_to_allowlist`](crate::sss_allowlist::add_to_allowlist) and
/// closed via [`remove_from_allowlist`](crate::sss_allowlist::remove_from_allowlist).
/// Rent is returned to the authority on close.
///
/// Seeds: `["allowlist_entry", allowlist_config, address]`
#[account]
pub struct AllowlistEntry {
    /// The [`AllowlistConfig`] PDA this entry belongs to.
    pub allowlist_config: Pubkey,
    /// The address that has been listed.
    pub address: Pubkey,
    /// Human-readable label explaining why the address was added (max 32 chars).
    pub label: String,
    /// Unix timestamp (seconds) when the entry was created.
    pub added_at: i64,
    /// PDA bump seed.
    pub bump: u8,
}

impl AllowlistEntry {
    /// Serialized byte length: discriminator + fields.
    /// `label` is a length-prefixed string (4-byte prefix + max 32 bytes data).
    pub const LEN: usize = 8 + 32 + 32 + (4 + MAX_LABEL_LEN) + 8 + 1;

    /// Seed prefix used when deriving the PDA.
    pub const SEED_PREFIX: &'static [u8] = b"allowlist_entry";
}
