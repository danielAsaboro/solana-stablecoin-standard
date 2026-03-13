//! Solana data fetching and on-chain account deserialization.
//!
//! Connects to a Solana RPC endpoint and fetches SSS program accounts
//! (config, roles, minter quotas, blacklist entries) plus Token-2022 mint data.

use anyhow::{Context, Result};
use borsh::BorshDeserialize;
use serde::Deserialize;
use solana_client::rpc_client::RpcClient;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_sdk::account::Account;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;

use std::str::FromStr;

// ── Default program IDs ─────────────────────────────────────────────────────

/// Default SSS program ID (localnet deployment).
pub const DEFAULT_PROGRAM_ID: &str = "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu";

/// Default RPC URL (local validator).
pub const DEFAULT_RPC_URL: &str = "http://localhost:8899";

// ── PDA seeds (must match on-chain constants) ───────────────────────────────

const STABLECOIN_SEED: &[u8] = b"stablecoin";

// ── Role type constants ─────────────────────────────────────────────────────

pub const ROLE_MINTER: u8 = 0;
pub const ROLE_BURNER: u8 = 1;
pub const ROLE_PAUSER: u8 = 2;
pub const ROLE_BLACKLISTER: u8 = 3;
pub const ROLE_SEIZER: u8 = 4;

/// Human-readable role name.
pub fn role_name(role_type: u8) -> &'static str {
    match role_type {
        ROLE_MINTER => "Minter",
        ROLE_BURNER => "Burner",
        ROLE_PAUSER => "Pauser",
        ROLE_BLACKLISTER => "Blacklister",
        ROLE_SEIZER => "Seizer",
        _ => "Unknown",
    }
}

// ── Anchor discriminator ────────────────────────────────────────────────────

/// Compute the 8-byte Anchor account discriminator: SHA256("account:<Name>")[0..8].
fn account_discriminator(name: &str) -> [u8; 8] {
    let input = format!("account:{name}");
    let hash = solana_sdk::hash::hash(input.as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash.to_bytes()[..8]);
    disc
}

// ── On-chain account types (Borsh deserialization) ──────────────────────────

/// Mirrors `StablecoinConfig` from `programs/sss/src/state.rs`.
/// All fields must be present for correct Borsh deserialization layout.
#[derive(Debug, Clone, BorshDeserialize)]
#[allow(dead_code)]
pub struct ConfigAccount {
    pub mint: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub decimals: u8,
    pub master_authority: Pubkey,
    pub enable_permanent_delegate: bool,
    pub enable_transfer_hook: bool,
    pub default_account_frozen: bool,
    pub paused: bool,
    pub total_minted: u64,
    pub total_burned: u64,
    pub transfer_hook_program: Pubkey,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

/// Mirrors `RoleAccount` from `programs/sss/src/state.rs`.
#[derive(Debug, Clone, BorshDeserialize)]
#[allow(dead_code)]
pub struct RoleAccountData {
    pub config: Pubkey,
    pub user: Pubkey,
    pub role_type: u8,
    pub active: bool,
    pub bump: u8,
}

/// Mirrors `MinterQuota` from `programs/sss/src/state.rs`.
#[derive(Debug, Clone, BorshDeserialize)]
#[allow(dead_code)]
pub struct MinterQuotaData {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub quota: u64,
    pub minted: u64,
    pub bump: u8,
}

/// Mirrors `BlacklistEntry` from `programs/sss/src/state.rs`.
#[derive(Debug, Clone, BorshDeserialize)]
#[allow(dead_code)]
pub struct BlacklistEntryData {
    pub config: Pubkey,
    pub address: Pubkey,
    pub reason: String,
    pub blacklisted_at: i64,
    pub blacklisted_by: Pubkey,
    pub bump: u8,
}

// ── Composite data snapshot ─────────────────────────────────────────────────

/// All fetched stablecoin data in a single snapshot.
#[derive(Debug, Clone, Default)]
pub struct StablecoinData {
    /// The stablecoin config. `None` if not yet fetched or not found.
    pub config: Option<ConfigAccount>,
    /// Live mint supply from Token-2022 mint account.
    pub live_supply: Option<u64>,
    /// All role assignments for this stablecoin.
    pub roles: Vec<RoleAccountData>,
    /// All minter quotas for this stablecoin.
    pub minters: Vec<MinterQuotaData>,
    /// All blacklist entries for this stablecoin (SSS-2 only).
    pub blacklist: Vec<BlacklistEntryData>,
    /// Config PDA address.
    pub config_pda: Pubkey,
    /// Mint address.
    pub mint: Pubkey,
    /// Most recent fetch error, if any.
    pub error: Option<String>,
    /// Timestamp of last successful fetch.
    pub last_fetched: Option<chrono::DateTime<chrono::Local>>,
    /// Optional backend incident stream for operator visibility.
    pub incidents: Vec<OperatorIncident>,
    /// Optional backend URL used for incident telemetry.
    pub backend_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OperatorIncident {
    pub id: String,
    pub occurred_at: String,
    pub action: String,
    pub severity: String,
    pub status: String,
    pub summary: String,
    pub related_count: usize,
}

/// Freshness classification for the current snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchFreshness {
    Connecting,
    Fresh,
    Stale,
    Error,
}

const STALE_AFTER_SECS: i64 = 15;

impl StablecoinData {
    /// Classify the current snapshot as fresh, stale, connecting, or error.
    pub fn freshness_at(&self, now: chrono::DateTime<chrono::Local>) -> FetchFreshness {
        if self.error.is_some() {
            return FetchFreshness::Error;
        }

        let Some(last_fetched) = self.last_fetched else {
            return FetchFreshness::Connecting;
        };

        if (now - last_fetched) > chrono::Duration::seconds(STALE_AFTER_SECS) {
            FetchFreshness::Stale
        } else {
            FetchFreshness::Fresh
        }
    }

    /// Human-readable age since the last successful refresh.
    pub fn age_label(&self, now: chrono::DateTime<chrono::Local>) -> Option<String> {
        self.last_fetched.map(|last_fetched| {
            let seconds = (now - last_fetched).num_seconds().max(0);
            format!("{seconds}s ago")
        })
    }
}

// ── PDA derivation ──────────────────────────────────────────────────────────

/// Derive the config PDA: `["stablecoin", mint]`.
pub fn derive_config_pda(program_id: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STABLECOIN_SEED, mint.as_ref()], program_id)
}

// ── Deserialization helpers ─────────────────────────────────────────────────

/// Deserialize an Anchor account by skipping the 8-byte discriminator.
fn deserialize_anchor_account<T: BorshDeserialize>(
    data: &[u8],
    expected_discriminator: &[u8; 8],
) -> Result<T> {
    if data.len() < 8 {
        anyhow::bail!("Account data too short ({} bytes)", data.len());
    }
    if &data[..8] != expected_discriminator {
        anyhow::bail!("Account discriminator mismatch");
    }
    T::try_from_slice(&data[8..]).context("Borsh deserialization failed")
}

// ── Data fetching ───────────────────────────────────────────────────────────

/// Fetch all stablecoin data from the on-chain program.
///
/// This performs multiple RPC calls:
/// 1. Config PDA account
/// 2. Token-2022 mint account (for live supply)
/// 3. All role accounts (via `getProgramAccounts` with memcmp filter)
/// 4. All minter quota accounts
/// 5. All blacklist entries
#[allow(dead_code)]
pub fn fetch_all_data(rpc: &RpcClient, program_id: &Pubkey, mint: &Pubkey) -> StablecoinData {
    fetch_all_data_with_backend(rpc, program_id, mint, None)
}

pub fn fetch_all_data_with_backend(
    rpc: &RpcClient,
    program_id: &Pubkey,
    mint: &Pubkey,
    backend_url: Option<&str>,
) -> StablecoinData {
    let (config_pda, _) = derive_config_pda(program_id, mint);
    let mut data = StablecoinData {
        config_pda,
        mint: *mint,
        backend_url: backend_url.map(str::to_string),
        ..Default::default()
    };

    // 1. Fetch config account
    match fetch_config(rpc, &config_pda) {
        Ok(config) => data.config = Some(config),
        Err(e) => {
            data.error = Some(format!("Config fetch failed: {e}"));
            return data;
        }
    }

    // 2. Fetch live supply from mint
    match fetch_mint_supply(rpc, mint) {
        Ok(supply) => data.live_supply = Some(supply),
        Err(e) => {
            data.error = Some(format!("Mint fetch failed: {e}"));
        }
    }

    // 3. Fetch all roles
    match fetch_roles(rpc, program_id, &config_pda) {
        Ok(roles) => data.roles = roles,
        Err(e) => {
            data.error = Some(format!("Role fetch failed: {e}"));
        }
    }

    // 4. Fetch all minter quotas
    match fetch_minter_quotas(rpc, program_id, &config_pda) {
        Ok(minters) => data.minters = minters,
        Err(e) => {
            data.error = Some(format!("Minter quota fetch failed: {e}"));
        }
    }

    // 5. Fetch blacklist entries (only for SSS-2 configs)
    if data.config.as_ref().is_some_and(|c| c.enable_transfer_hook) {
        match fetch_blacklist(rpc, program_id, &config_pda) {
            Ok(entries) => data.blacklist = entries,
            Err(e) => {
                data.error = Some(format!("Blacklist fetch failed: {e}"));
            }
        }
    }

    data.last_fetched = Some(chrono::Local::now());
    if let Some(url) = backend_url {
        let incident_url = format!(
            "{}/api/v1/operator-timeline?limit=20",
            url.trim_end_matches('/')
        );
        match reqwest::blocking::get(&incident_url) {
            Ok(response) if response.status().is_success() => {
                if let Ok(incidents) = response.json::<Vec<OperatorIncident>>() {
                    data.incidents = incidents;
                }
            }
            Ok(_) | Err(_) => {}
        }
    }
    if data.error.is_none() {
        data.error = None; // clear any partial errors
    }
    data
}

/// Fetch and deserialize the StablecoinConfig PDA.
fn fetch_config(rpc: &RpcClient, config_pda: &Pubkey) -> Result<ConfigAccount> {
    let account = rpc
        .get_account_with_commitment(config_pda, CommitmentConfig::confirmed())?
        .value
        .context("Config account not found")?;

    let disc = account_discriminator("StablecoinConfig");
    deserialize_anchor_account::<ConfigAccount>(&account.data, &disc)
}

/// Fetch live supply from the Token-2022 mint account.
///
/// Parses the supply field directly from the raw account data at offset 36.
/// This works for both SPL Token and Token-2022 since the base Mint layout
/// is identical: `COption<Pubkey>` (36 bytes) then `u64 supply` (8 bytes).
fn fetch_mint_supply(rpc: &RpcClient, mint: &Pubkey) -> Result<u64> {
    let account = rpc
        .get_account_with_commitment(mint, CommitmentConfig::confirmed())?
        .value
        .context("Mint account not found")?;

    // Mint layout: mint_authority COption<Pubkey> (4 + 32 = 36) + supply u64 (8)
    const SUPPLY_OFFSET: usize = 36;
    const SUPPLY_END: usize = SUPPLY_OFFSET + 8;

    if account.data.len() < SUPPLY_END {
        anyhow::bail!(
            "Mint account data too short ({} bytes, need {})",
            account.data.len(),
            SUPPLY_END
        );
    }

    let supply_bytes: [u8; 8] = account.data[SUPPLY_OFFSET..SUPPLY_END]
        .try_into()
        .map_err(|_| anyhow::anyhow!("Invalid mint supply bytes"))?;

    Ok(u64::from_le_bytes(supply_bytes))
}

#[cfg(test)]
mod tests {
    use super::{
        account_discriminator, derive_config_pda, deserialize_anchor_account, role_name,
        FetchFreshness, StablecoinData, ROLE_BLACKLISTER, ROLE_BURNER, ROLE_MINTER, ROLE_PAUSER,
        ROLE_SEIZER,
    };
    use borsh::{BorshDeserialize, BorshSerialize};
    use chrono::{Duration, Local};
    use solana_sdk::pubkey::Pubkey;

    #[derive(BorshDeserialize, BorshSerialize)]
    struct TestAccount {
        value: u64,
    }

    #[test]
    fn role_names_match_expected_labels() {
        assert_eq!(role_name(ROLE_MINTER), "Minter");
        assert_eq!(role_name(ROLE_BURNER), "Burner");
        assert_eq!(role_name(ROLE_PAUSER), "Pauser");
        assert_eq!(role_name(ROLE_BLACKLISTER), "Blacklister");
        assert_eq!(role_name(ROLE_SEIZER), "Seizer");
        assert_eq!(role_name(99), "Unknown");
    }

    #[test]
    fn config_pda_derivation_is_deterministic() {
        let program_id = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let first = derive_config_pda(&program_id, &mint);
        let second = derive_config_pda(&program_id, &mint);
        assert_eq!(first, second);
    }

    #[test]
    fn account_discriminator_is_stable_for_same_name() {
        let first = account_discriminator("StablecoinConfig");
        let second = account_discriminator("StablecoinConfig");
        let different = account_discriminator("RoleAccount");
        assert_eq!(first, second);
        assert_ne!(first, different);
    }

    #[test]
    fn deserialize_anchor_account_rejects_wrong_discriminator() {
        let mut data = Vec::from([0u8; 8]);
        data.extend(TestAccount { value: 42 }.try_to_vec().unwrap());
        let expected = account_discriminator("StablecoinConfig");
        let result = deserialize_anchor_account::<TestAccount>(&data, &expected);
        assert!(result.is_err());
    }

    #[test]
    fn deserialize_anchor_account_reads_payload_after_discriminator() {
        let expected = account_discriminator("TestAccount");
        let mut data = Vec::from(expected);
        data.extend(TestAccount { value: 42 }.try_to_vec().unwrap());
        let decoded = deserialize_anchor_account::<TestAccount>(&data, &expected).unwrap();
        assert_eq!(decoded.value, 42);
    }

    #[test]
    fn freshness_distinguishes_connecting_fresh_stale_and_error() {
        let now = Local::now();

        let connecting = StablecoinData::default();
        assert_eq!(connecting.freshness_at(now), FetchFreshness::Connecting);

        let fresh = StablecoinData {
            last_fetched: Some(now - Duration::seconds(5)),
            ..StablecoinData::default()
        };
        assert_eq!(fresh.freshness_at(now), FetchFreshness::Fresh);

        let stale = StablecoinData {
            last_fetched: Some(now - Duration::seconds(30)),
            ..StablecoinData::default()
        };
        assert_eq!(stale.freshness_at(now), FetchFreshness::Stale);

        let errored = StablecoinData {
            error: Some("rpc failed".to_string()),
            last_fetched: Some(now - Duration::seconds(5)),
            ..StablecoinData::default()
        };
        assert_eq!(errored.freshness_at(now), FetchFreshness::Error);
    }
}

/// Fetch all RoleAccount PDAs for this stablecoin via memcmp filter.
fn fetch_roles(
    rpc: &RpcClient,
    program_id: &Pubkey,
    config_pda: &Pubkey,
) -> Result<Vec<RoleAccountData>> {
    let disc = account_discriminator("RoleAccount");
    let accounts = fetch_program_accounts(rpc, program_id, &disc, 8, config_pda)?;

    let mut roles = Vec::new();
    for (_, account) in &accounts {
        if let Ok(role) = deserialize_anchor_account::<RoleAccountData>(&account.data, &disc) {
            roles.push(role);
        }
    }
    Ok(roles)
}

/// Fetch all MinterQuota PDAs for this stablecoin via memcmp filter.
fn fetch_minter_quotas(
    rpc: &RpcClient,
    program_id: &Pubkey,
    config_pda: &Pubkey,
) -> Result<Vec<MinterQuotaData>> {
    let disc = account_discriminator("MinterQuota");
    let accounts = fetch_program_accounts(rpc, program_id, &disc, 8, config_pda)?;

    let mut minters = Vec::new();
    for (_, account) in &accounts {
        if let Ok(minter) = deserialize_anchor_account::<MinterQuotaData>(&account.data, &disc) {
            minters.push(minter);
        }
    }
    Ok(minters)
}

/// Fetch all BlacklistEntry PDAs for this stablecoin via memcmp filter.
fn fetch_blacklist(
    rpc: &RpcClient,
    program_id: &Pubkey,
    config_pda: &Pubkey,
) -> Result<Vec<BlacklistEntryData>> {
    let disc = account_discriminator("BlacklistEntry");
    let accounts = fetch_program_accounts(rpc, program_id, &disc, 8, config_pda)?;

    let mut entries = Vec::new();
    for (_, account) in &accounts {
        if let Ok(entry) = deserialize_anchor_account::<BlacklistEntryData>(&account.data, &disc) {
            entries.push(entry);
        }
    }
    Ok(entries)
}

/// Generic helper to fetch program accounts with discriminator + config memcmp filters.
fn fetch_program_accounts(
    rpc: &RpcClient,
    program_id: &Pubkey,
    discriminator: &[u8; 8],
    config_offset: usize,
    config_pda: &Pubkey,
) -> Result<Vec<(Pubkey, Account)>> {
    let config = RpcProgramAccountsConfig {
        filters: Some(vec![
            // Filter by account discriminator (first 8 bytes)
            RpcFilterType::Memcmp(Memcmp::new_raw_bytes(0, discriminator.to_vec())),
            // Filter by config PDA (bytes 8..40 for most account types)
            RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                config_offset,
                config_pda.to_bytes().to_vec(),
            )),
        ]),
        account_config: RpcAccountInfoConfig {
            commitment: Some(CommitmentConfig::confirmed()),
            ..Default::default()
        },
        ..Default::default()
    };

    rpc.get_program_accounts_with_config(program_id, config)
        .context("getProgramAccounts RPC call failed")
}

/// Parse a pubkey from a string, with a descriptive error.
pub fn parse_pubkey(s: &str) -> Result<Pubkey> {
    Pubkey::from_str(s).map_err(|e| anyhow::anyhow!("Invalid pubkey '{}': {}", s, e))
}
