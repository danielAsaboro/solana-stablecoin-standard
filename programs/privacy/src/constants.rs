//! Program constants: PDA seed prefixes and field length limits.
//!
//! All PDA seeds are defined here to ensure a single source of truth for account
//! derivation across the program.

// ── PDA seed prefixes ────────────────────────────────────────────────────────

/// PDA seed for [`PrivacyConfig`](crate::state::PrivacyConfig) accounts.
///
/// Full derivation: `["privacy_config", stablecoin_config_pubkey]`.
/// Each SSS stablecoin config has at most one privacy config.
pub const PRIVACY_CONFIG_SEED: &[u8] = b"privacy_config";

/// PDA seed for [`AllowlistEntry`](crate::state::AllowlistEntry) accounts.
///
/// Full derivation: `["allowlist", privacy_config_pubkey, address_pubkey]`.
/// Each address can appear at most once per privacy config.
pub const ALLOWLIST_SEED: &[u8] = b"allowlist";

// ── Field length limits ──────────────────────────────────────────────────────

/// Maximum length (in bytes) for an allowlist entry label.
///
/// Labels are optional human-readable identifiers for allowlisted addresses
/// (e.g., "Treasury", "Market Maker A", "Custodian").
pub const MAX_LABEL_LEN: usize = 32;
