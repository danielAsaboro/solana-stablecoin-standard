//! Program events emitted by SSS Allowlist instructions.
//!
//! Every state-changing instruction emits exactly one event. Clients can parse
//! these from transaction logs to build an off-chain audit trail.

use anchor_lang::prelude::*;

/// Emitted when a new [`AllowlistConfig`](crate::state::AllowlistConfig) is
/// created via [`initialize_allowlist_config`](crate::sss_allowlist::initialize_allowlist_config).
#[event]
pub struct AllowlistConfigInitialized {
    /// The SSS stablecoin config PDA this allowlist module is attached to.
    pub stablecoin_config: Pubkey,
    /// The authority who initialized the allowlist config.
    pub authority: Pubkey,
    /// The initial access mode (`0`=Open, `1`=Allowlist, `2`=Blocklist).
    pub mode: u8,
}

/// Emitted when the access mode is changed via
/// [`update_allowlist_mode`](crate::sss_allowlist::update_allowlist_mode).
#[event]
pub struct AllowlistModeUpdated {
    /// The SSS stablecoin config PDA.
    pub stablecoin_config: Pubkey,
    /// The access mode before the update.
    pub old_mode: u8,
    /// The new access mode.
    pub new_mode: u8,
    /// The authority who performed the update.
    pub updated_by: Pubkey,
}

/// Emitted when an address is added via
/// [`add_to_allowlist`](crate::sss_allowlist::add_to_allowlist).
#[event]
pub struct AddressAddedToAllowlist {
    /// The allowlist config PDA.
    pub allowlist_config: Pubkey,
    /// The address that was added.
    pub address: Pubkey,
    /// The label attached to the entry.
    pub label: String,
    /// The authority who added the address.
    pub added_by: Pubkey,
}

/// Emitted when an address is removed via
/// [`remove_from_allowlist`](crate::sss_allowlist::remove_from_allowlist).
#[event]
pub struct AddressRemovedFromAllowlist {
    /// The allowlist config PDA.
    pub allowlist_config: Pubkey,
    /// The address that was removed.
    pub address: Pubkey,
    /// The authority who removed the address.
    pub removed_by: Pubkey,
}
