//! Program constants: PDA seeds, field length limits, and Switchboard data offsets.
//!
//! ## Switchboard V2 Aggregator Data Layout
//!
//! The oracle module reads price data directly from Switchboard V2 aggregator
//! accounts using fixed byte offsets. This avoids a heavy SDK dependency while
//! maintaining correctness. The offsets are derived from the Borsh-serialized
//! layout of `AggregatorAccountData` in the `switchboard-solana` crate.

// ── PDA seed prefixes ────────────────────────────────────────────────────────

/// PDA seed for [`OracleConfig`](crate::state::OracleConfig) accounts.
/// Full derivation: `["oracle_config", stablecoin_config_pubkey]`.
pub const ORACLE_CONFIG_SEED: &[u8] = b"oracle_config";

// ── Field length limits ──────────────────────────────────────────────────────

/// Maximum length (in bytes) for the base currency identifier (e.g., "USD", "BRL", "EUR").
pub const MAX_CURRENCY_LEN: usize = 8;

// ── Switchboard V2 Aggregator byte offsets ───────────────────────────────────
//
// All offsets measured from the start of raw account data (including the
// 8-byte Anchor discriminator that Switchboard V2 uses).
//
// AggregatorAccountData layout (after 8-byte discriminator at offset 0):
//   [8..40]   name: [u8; 32]
//   [40..168] metadata: [u8; 128]
//   [168..200] reserved1: [u8; 32]
//   [200..232] queue_pubkey: Pubkey
//   [232..236] oracle_request_batch_size: u32
//   [236..240] min_oracle_results: u32
//   [240..244] min_job_results: u32
//   [244..248] min_update_delay_seconds: u32
//   [248..256] start_after: i64
//   [256..276] variance_threshold: SwitchboardDecimal (i128 + u32)
//   [276..284] force_report_period: i64
//   [284..292] expiration: i64
//   [292..300] consecutive_failure_count: u64
//   [300..308] next_allowed_update_time: i64
//   [308..309] is_locked: bool
//   [309..341] crank_pubkey: Pubkey
//   === latest_confirmed_round (Round) starts at offset 341 ===
//   Round layout:
//     [341..357]  id: u128
//     [357..365]  round_open_slot: u64
//     [365..373]  round_open_timestamp: i64
//     [373..393]  result: SwitchboardDecimal { mantissa: i128, scale: u32 }

/// Byte offset to `latest_confirmed_round.round_open_timestamp` (i64, 8 bytes).
pub const AGGREGATOR_TIMESTAMP_OFFSET: usize = 365;

/// Byte offset to `latest_confirmed_round.result.mantissa` (i128, 16 bytes).
pub const AGGREGATOR_MANTISSA_OFFSET: usize = 373;

/// Byte offset to `latest_confirmed_round.result.scale` (u32, 4 bytes).
pub const AGGREGATOR_SCALE_OFFSET: usize = 389;

/// Minimum account data length required to read the price result from a
/// Switchboard V2 aggregator account (through the scale field).
pub const AGGREGATOR_MIN_DATA_LEN: usize = AGGREGATOR_SCALE_OFFSET + 4; // 393

/// The Switchboard V2 program ID on mainnet-beta.
/// Used to validate that the aggregator account is owned by the correct program.
pub const SWITCHBOARD_V2_PROGRAM_ID: &str = "SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f";
