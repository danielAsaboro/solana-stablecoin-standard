//! PDA seed constants used by the transfer hook program.

/// PDA seed for the [`ExtraAccountMetaList`] that stores the account resolution
/// recipe for Token-2022 transfer hook calls.
/// Full derivation: `["extra-account-metas", mint_pubkey]`.
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

/// PDA seed for blacklist entries on the SSS main program.
/// Used here for PDA derivation in extra account metas.
pub const BLACKLIST_SEED: &[u8] = b"blacklist";

/// PDA seed for stablecoin config on the SSS main program.
/// Used here for PDA derivation in extra account metas.
pub const STABLECOIN_SEED: &[u8] = b"stablecoin";
