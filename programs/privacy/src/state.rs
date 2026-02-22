//! On-chain account state for the SSS Privacy Module.
//!
//! The privacy module stores an allowlist configuration and individual allowlist
//! entries for Token-2022 confidential transfers. Each SSS stablecoin has at most
//! one privacy config, derived as a PDA from the stablecoin config address.

use anchor_lang::prelude::*;

use crate::constants::*;

/// Privacy configuration for a stablecoin's confidential transfer allowlist.
///
/// Links an SSS stablecoin to an allowlist that controls which addresses are
/// permitted to participate in Token-2022 confidential transfers. The authority
/// can add/remove addresses and toggle auto-approval for new accounts.
///
/// Seeds: `["privacy_config", stablecoin_config_pubkey]`
#[account]
pub struct PrivacyConfig {
    /// The authority who can manage this privacy config and the allowlist.
    /// Only this signer can add/remove allowlist entries and update settings.
    pub authority: Pubkey,
    /// The SSS stablecoin config PDA this privacy config is linked to.
    /// Establishes the one-to-one relationship between a stablecoin and its
    /// privacy configuration.
    pub stablecoin_config: Pubkey,
    /// Whether new accounts are auto-approved for confidential transfers.
    /// When `true`, any account can participate in confidential transfers
    /// without being explicitly added to the allowlist. When `false`, only
    /// addresses on the allowlist are permitted.
    pub auto_approve: bool,
    /// Total number of addresses currently on the allowlist.
    /// Incremented on add, decremented on remove. Uses checked arithmetic.
    pub allowlist_count: u32,
    /// PDA bump seed for this account.
    pub bump: u8,
    /// Reserved bytes for future use (e.g., additional feature flags).
    pub _reserved: [u8; 64],
}

impl PrivacyConfig {
    /// Total space required for a serialized `PrivacyConfig` account,
    /// including the 8-byte Anchor discriminator.
    pub const LEN: usize = 8   // discriminator
        + 32                    // authority
        + 32                    // stablecoin_config
        + 1                     // auto_approve
        + 4                     // allowlist_count
        + 1                     // bump
        + 64;                   // _reserved
    // Total = 142

    /// The PDA seed prefix for this account type.
    pub const SEED_PREFIX: &'static [u8] = PRIVACY_CONFIG_SEED;
}

/// An individual entry on the confidential transfer allowlist.
///
/// Each entry represents a single address that is permitted to participate in
/// Token-2022 confidential transfers for the linked stablecoin. Entries are
/// created by the privacy authority and can be removed at any time (closing
/// the account and reclaiming rent).
///
/// Seeds: `["allowlist", privacy_config_pubkey, address_pubkey]`
#[account]
pub struct AllowlistEntry {
    /// The [`PrivacyConfig`] PDA this entry belongs to.
    pub config: Pubkey,
    /// The allowed address (wallet or token account) that may participate
    /// in confidential transfers.
    pub address: Pubkey,
    /// Optional human-readable label for the entry (max 32 bytes).
    /// Useful for identifying the purpose of the allowlisted address
    /// (e.g., "Treasury", "Market Maker A").
    pub label: String,
    /// Unix timestamp (seconds) when this entry was added.
    pub added_at: i64,
    /// The authority who added this entry to the allowlist.
    pub added_by: Pubkey,
    /// PDA bump seed for this account.
    pub bump: u8,
}

impl AllowlistEntry {
    /// Total space required for a serialized `AllowlistEntry` account,
    /// including the 8-byte Anchor discriminator.
    pub const LEN: usize = 8   // discriminator
        + 32                    // config
        + 32                    // address
        + (4 + MAX_LABEL_LEN)   // label (string prefix + max data)
        + 8                     // added_at
        + 32                    // added_by
        + 1;                    // bump
    // Total = 149

    /// The PDA seed prefix for this account type.
    pub const SEED_PREFIX: &'static [u8] = ALLOWLIST_SEED;
}
