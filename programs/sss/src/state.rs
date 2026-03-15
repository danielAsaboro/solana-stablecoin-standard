//! On-chain account state for the SSS program.
//!
//! All accounts are PDAs derived from deterministic seeds documented in
//! [`constants`](crate::constants). Field-level docs describe each stored value.

use anchor_lang::prelude::*;

use crate::constants::*;

/// Central configuration account for a stablecoin instance.
///
/// Created during [`initialize`](crate::sss::initialize) and owned by this program.
/// The config PDA also serves as the mint authority, freeze authority, and (if SSS-2)
/// permanent delegate for the Token-2022 mint.
///
/// Seeds: `["stablecoin", mint_pubkey]`
#[account]
pub struct StablecoinConfig {
    /// The Token-2022 mint address
    pub mint: Pubkey,
    /// Human-readable name (max 32 chars)
    pub name: String,
    /// Token symbol (max 10 chars)
    pub symbol: String,
    /// Metadata URI (max 200 chars)
    pub uri: String,
    /// Token decimals
    pub decimals: u8,
    /// Master authority that can assign roles
    pub master_authority: Pubkey,

    // Feature flags (immutable after init)
    /// Whether permanent delegate is enabled (required for seize)
    pub enable_permanent_delegate: bool,
    /// Whether transfer hook is enabled (required for blacklist enforcement)
    pub enable_transfer_hook: bool,
    /// Whether new token accounts default to frozen state
    pub default_account_frozen: bool,
    /// Whether confidential transfers are enabled (SSS-3 privacy preset)
    pub enable_confidential_transfer: bool,

    // Runtime state
    /// Whether the stablecoin is paused
    pub paused: bool,
    /// Total tokens minted over lifetime
    pub total_minted: u64,
    /// Total tokens burned over lifetime
    pub total_burned: u64,
    /// Transfer hook program ID (if enabled)
    pub transfer_hook_program: Pubkey,

    /// Global supply cap in base units (0 = unlimited).
    /// Once total_minted reaches this value no further minting is allowed.
    pub supply_cap: u64,

    /// Pending authority in a 2-step authority transfer (Pubkey::default() = no transfer in flight).
    pub pending_authority: Pubkey,

    /// Unix timestamp when the authority transfer was proposed (0 = no transfer in flight).
    pub authority_transfer_at: i64,

    /// PDA bump seed
    pub bump: u8,
    /// Reserved for future use
    pub _reserved: [u8; 15],
}

impl StablecoinConfig {
    pub const LEN: usize = 8 // discriminator
        + 32               // mint
        + (4 + MAX_NAME_LEN)   // name (string prefix + data)
        + (4 + MAX_SYMBOL_LEN) // symbol
        + (4 + MAX_URI_LEN)    // uri
        + 1                // decimals
        + 32               // master_authority
        + 1                // enable_permanent_delegate
        + 1                // enable_transfer_hook
        + 1                // default_account_frozen
        + 1                // enable_confidential_transfer
        + 1                // paused
        + 8                // total_minted
        + 8                // total_burned
        + 32               // transfer_hook_program
        + 8                // supply_cap
        + 32               // pending_authority
        + 8                // authority_transfer_at
        + 1                // bump
        + 15; // _reserved

    pub const SEED_PREFIX: &'static [u8] = STABLECOIN_SEED;
}

/// Tracks whether a user holds a specific role for a stablecoin.
///
/// One PDA per (config, role_type, user) triple. The `active` flag controls
/// whether the role is currently in effect — deactivated roles retain their PDA
/// so they can be re-activated without a new `init`.
///
/// Seeds: `["role", config_pubkey, role_type_u8, user_pubkey]`
#[account]
pub struct RoleAccount {
    /// The stablecoin config this role belongs to
    pub config: Pubkey,
    /// The user who has this role
    pub user: Pubkey,
    /// Role type (0=Minter, 1=Burner, 2=Pauser, 3=Blacklister, 4=Seizer)
    pub role_type: u8,
    /// Whether the role is currently active
    pub active: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl RoleAccount {
    pub const LEN: usize = 8 // discriminator
        + 32  // config
        + 32  // user
        + 1   // role_type
        + 1   // active
        + 1; // bump

    pub const SEED_PREFIX: &'static [u8] = ROLE_SEED;
}

/// Per-minter allowance tracking.
///
/// Each minter has an independent quota and a running total of tokens minted.
/// The master authority sets the `quota`; `minted` is incremented on each
/// [`mint_tokens`](crate::sss::mint_tokens) call and is never reset (preserves
/// audit history even when the quota is increased).
///
/// Seeds: `["minter_quota", config_pubkey, minter_pubkey]`
#[account]
pub struct MinterQuota {
    /// The stablecoin config
    pub config: Pubkey,
    /// The minter address
    pub minter: Pubkey,
    /// Maximum amount the minter can mint
    pub quota: u64,
    /// Amount already minted
    pub minted: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl MinterQuota {
    pub const LEN: usize = 8 // discriminator
        + 32  // config
        + 32  // minter
        + 8   // quota
        + 8   // minted
        + 1; // bump

    pub const SEED_PREFIX: &'static [u8] = MINTER_QUOTA_SEED;
}

/// Records that an address is on the blacklist (SSS-2 only).
///
/// The transfer hook program checks for the existence of this PDA to block
/// transfers involving blacklisted addresses. When removed, the PDA is closed
/// via `close = authority` and rent is returned.
///
/// Evidence fields provide a cryptographic link to off-chain legal documents
/// (court orders, OFAC filings, SAR reports). Anyone can fetch the document at
/// `evidence_uri`, SHA-256 it, and compare against `evidence_hash` to verify
/// the document has not been tampered with since blacklisting.
///
/// Seeds: `["blacklist", config_pubkey, address_pubkey]`
#[account]
pub struct BlacklistEntry {
    /// The stablecoin config
    pub config: Pubkey,
    /// The blacklisted address
    pub address: Pubkey,
    /// Reason for blacklisting (max 64 chars)
    pub reason: String,
    /// Timestamp when blacklisted
    pub blacklisted_at: i64,
    /// Authority who blacklisted the address
    pub blacklisted_by: Pubkey,
    /// SHA-256 hash of the evidence document. `[0; 32]` means no evidence attached.
    pub evidence_hash: [u8; 32],
    /// URI pointing to the evidence document (IPFS, Arweave, HTTPS). Empty means none.
    pub evidence_uri: String,
    /// PDA bump seed
    pub bump: u8,
}

impl BlacklistEntry {
    pub const LEN: usize = 8 // discriminator
        + 32  // config
        + 32  // address
        + (4 + MAX_REASON_LEN)  // reason
        + 8   // blacklisted_at
        + 32  // blacklisted_by
        + 32  // evidence_hash
        + (4 + MAX_EVIDENCE_URI_LEN) // evidence_uri
        + 1; // bump

    pub const SEED_PREFIX: &'static [u8] = BLACKLIST_SEED;
}
