//! Program events emitted by SSS Privacy Module instructions.
//!
//! Every state-changing instruction emits exactly one event. Clients can parse
//! these from transaction logs to track allowlist changes and configuration updates.

use anchor_lang::prelude::*;

/// Emitted when a new privacy configuration is initialized via
/// [`initialize_privacy`](crate::sss_privacy::initialize_privacy).
#[event]
pub struct PrivacyInitialized {
    /// The newly created [`PrivacyConfig`](crate::state::PrivacyConfig) PDA.
    pub config: Pubkey,
    /// The SSS stablecoin config this privacy config is linked to.
    pub stablecoin_config: Pubkey,
    /// The authority who initialized the privacy config.
    pub authority: Pubkey,
    /// Whether new accounts are auto-approved for confidential transfers.
    pub auto_approve: bool,
}

/// Emitted when the privacy configuration is updated via
/// [`update_privacy_config`](crate::sss_privacy::update_privacy_config).
#[event]
pub struct PrivacyConfigUpdated {
    /// The [`PrivacyConfig`](crate::state::PrivacyConfig) PDA that was updated.
    pub config: Pubkey,
    /// The authority who updated the config.
    pub authority: Pubkey,
}

/// Emitted when an address is added to the confidential transfer allowlist via
/// [`add_to_allowlist`](crate::sss_privacy::add_to_allowlist).
#[event]
pub struct AllowlistEntryAdded {
    /// The [`PrivacyConfig`](crate::state::PrivacyConfig) PDA.
    pub config: Pubkey,
    /// The address that was added to the allowlist.
    pub address: Pubkey,
    /// The human-readable label for the allowlisted address.
    pub label: String,
    /// The authority who added the entry.
    pub added_by: Pubkey,
}

/// Emitted when an address is removed from the confidential transfer allowlist via
/// [`remove_from_allowlist`](crate::sss_privacy::remove_from_allowlist).
#[event]
pub struct AllowlistEntryRemoved {
    /// The [`PrivacyConfig`](crate::state::PrivacyConfig) PDA.
    pub config: Pubkey,
    /// The address that was removed from the allowlist.
    pub address: Pubkey,
    /// The authority who removed the entry.
    pub removed_by: Pubkey,
}
