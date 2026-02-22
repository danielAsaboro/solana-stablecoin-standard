//! Solana data fetching and on-chain account deserialization.
//!
//! Connects to a Solana RPC endpoint and fetches SSS program accounts
//! (config, roles, minter quotas, blacklist entries) plus Token-2022 mint data.

use anyhow::{Context, Result};
use borsh::BorshDeserialize;
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
pub fn fetch_all_data(
    rpc: &RpcClient,
    program_id: &Pubkey,
    mint: &Pubkey,
) -> StablecoinData {
    let (config_pda, _) = derive_config_pda(program_id, mint);
    let mut data = StablecoinData {
        config_pda,
        mint: *mint,
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
        if let Ok(minter) =
            deserialize_anchor_account::<MinterQuotaData>(&account.data, &disc)
        {
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
        if let Ok(entry) =
            deserialize_anchor_account::<BlacklistEntryData>(&account.data, &disc)
        {
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
