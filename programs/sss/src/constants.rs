//! Program constants: PDA seeds, field length limits, and role type identifiers.

// ── PDA seed prefixes ────────────────────────────────────────────────────────

/// PDA seed for [`StablecoinConfig`](crate::state::StablecoinConfig) accounts.
/// Full derivation: `["stablecoin", mint_pubkey]`.
pub const STABLECOIN_SEED: &[u8] = b"stablecoin";

/// PDA seed for [`RoleAccount`](crate::state::RoleAccount) accounts.
/// Full derivation: `["role", config_pubkey, role_type_u8, user_pubkey]`.
pub const ROLE_SEED: &[u8] = b"role";

/// PDA seed for [`MinterQuota`](crate::state::MinterQuota) accounts.
/// Full derivation: `["minter_quota", config_pubkey, minter_pubkey]`.
pub const MINTER_QUOTA_SEED: &[u8] = b"minter_quota";

/// PDA seed for [`BlacklistEntry`](crate::state::BlacklistEntry) accounts.
/// Full derivation: `["blacklist", config_pubkey, address_pubkey]`.
pub const BLACKLIST_SEED: &[u8] = b"blacklist";

// ── Field length limits ──────────────────────────────────────────────────────

/// Maximum length (in bytes) for the stablecoin name.
pub const MAX_NAME_LEN: usize = 32;

/// Maximum length (in bytes) for the token symbol.
pub const MAX_SYMBOL_LEN: usize = 10;

/// Maximum length (in bytes) for the metadata URI.
pub const MAX_URI_LEN: usize = 200;

/// Maximum length (in bytes) for a blacklist reason string.
pub const MAX_REASON_LEN: usize = 64;

// ── Role type identifiers ────────────────────────────────────────────────────

/// Minter role — can mint tokens up to their assigned quota.
pub const ROLE_MINTER: u8 = 0;

/// Burner role — can burn tokens from accounts they own or have delegation over.
pub const ROLE_BURNER: u8 = 1;

/// Pauser role — can pause/unpause the stablecoin and freeze/thaw token accounts.
pub const ROLE_PAUSER: u8 = 2;

/// Blacklister role — can add/remove addresses from the blacklist (SSS-2 only).
pub const ROLE_BLACKLISTER: u8 = 3;

/// Seizer role — can seize tokens via permanent delegate (SSS-2 only).
pub const ROLE_SEIZER: u8 = 4;
