//! Solana RPC client wrapper, PDA derivation, and Anchor instruction builders.
//!
//! Provides [`SolanaContext`] — the shared Solana connectivity layer used by all
//! backend services. Also exports PDA derivation helpers and instruction builders
//! that construct Anchor-compatible transactions for the SSS program.

use sha2::{Digest, Sha256};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};
use std::str::FromStr;
use std::sync::OnceLock;

use crate::error::AppError;

// ── Well-Known Program IDs ─────────────────────────────────────────────────

/// Returns the Token-2022 program ID.
fn token_2022_program_id() -> Pubkey {
    static ID: OnceLock<Pubkey> = OnceLock::new();
    *ID.get_or_init(|| {
        Pubkey::from_str("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
            .expect("Token-2022 program ID is a valid hardcoded constant")
    })
}

/// Returns the Associated Token Account program ID.
fn associated_token_program_id() -> Pubkey {
    static ID: OnceLock<Pubkey> = OnceLock::new();
    *ID.get_or_init(|| {
        Pubkey::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
            .expect("ATA program ID is a valid hardcoded constant")
    })
}

// ── PDA Seed Constants ─────────────────────────────────────────────────────

const STABLECOIN_SEED: &[u8] = b"stablecoin";
const ROLE_SEED: &[u8] = b"role";
const MINTER_QUOTA_SEED: &[u8] = b"minter_quota";
const BLACKLIST_SEED: &[u8] = b"blacklist";

/// Minter role type identifier (matches on-chain `ROLE_MINTER`).
const ROLE_MINTER: u8 = 0;
/// Burner role type identifier (matches on-chain `ROLE_BURNER`).
const ROLE_BURNER: u8 = 1;
/// Blacklister role type identifier (matches on-chain `ROLE_BLACKLISTER`).
const ROLE_BLACKLISTER: u8 = 3;

// ── SolanaContext ──────────────────────────────────────────────────────────

/// Shared Solana connectivity context used by all backend services.
///
/// Holds the RPC client, program addresses, and the service keypair used
/// to sign transactions. Wrapped in `Arc<SolanaContext>` for concurrent access.
pub struct SolanaContext {
    /// Async Solana RPC client
    pub rpc: RpcClient,
    /// SSS program ID
    pub program_id: Pubkey,
    /// Token-2022 mint address for this stablecoin
    pub mint: Pubkey,
    /// Config PDA derived from `["stablecoin", mint]`
    pub config_pda: Pubkey,
    /// Bump seed for the config PDA
    pub config_bump: u8,
    /// Service keypair used to sign transactions (must hold required on-chain roles)
    pub keypair: Keypair,
    /// RPC URL for explorer link generation
    pub rpc_url: String,
}

impl SolanaContext {
    /// Create a new SolanaContext.
    ///
    /// Derives the config PDA from the mint address and program ID.
    pub fn new(rpc_url: &str, program_id: Pubkey, mint: Pubkey, keypair: Keypair) -> Self {
        let (config_pda, config_bump) =
            Pubkey::find_program_address(&[STABLECOIN_SEED, mint.as_ref()], &program_id);

        tracing::info!(
            config_pda = %config_pda,
            config_bump = config_bump,
            service_key = %keypair.pubkey(),
            "Derived stablecoin config PDA"
        );

        Self {
            rpc: RpcClient::new_with_commitment(
                rpc_url.to_string(),
                CommitmentConfig::confirmed(),
            ),
            program_id,
            mint,
            config_pda,
            config_bump,
            keypair,
            rpc_url: rpc_url.to_string(),
        }
    }

    /// Build, sign, and send a transaction with the given instructions.
    ///
    /// Returns the transaction signature as a base58 string on success.
    pub async fn send_transaction(
        &self,
        instructions: Vec<Instruction>,
    ) -> Result<String, AppError> {
        let blockhash = self
            .rpc
            .get_latest_blockhash()
            .await
            .map_err(|e| AppError::SolanaRpc(format!("Failed to get blockhash: {e}")))?;

        let tx = Transaction::new_signed_with_payer(
            &instructions,
            Some(&self.keypair.pubkey()),
            &[&self.keypair],
            blockhash,
        );

        let signature = self
            .rpc
            .send_and_confirm_transaction(&tx)
            .await
            .map_err(|e| AppError::TransactionFailed(format!("{e}")))?;

        Ok(signature.to_string())
    }
}

// ── PDA Derivation ─────────────────────────────────────────────────────────

/// Derive the stablecoin config PDA: `["stablecoin", mint]`.
#[allow(dead_code)]
pub fn derive_config_pda(mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[STABLECOIN_SEED, mint.as_ref()], program_id)
}

/// Derive a role PDA: `["role", config, role_type, user]`.
pub fn derive_role_pda(
    config: &Pubkey,
    role_type: u8,
    user: &Pubkey,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ROLE_SEED, config.as_ref(), &[role_type], user.as_ref()],
        program_id,
    )
}

/// Derive a minter quota PDA: `["minter_quota", config, minter]`.
pub fn derive_minter_quota_pda(
    config: &Pubkey,
    minter: &Pubkey,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[MINTER_QUOTA_SEED, config.as_ref(), minter.as_ref()],
        program_id,
    )
}

/// Derive a blacklist entry PDA: `["blacklist", config, address]`.
pub fn derive_blacklist_pda(
    config: &Pubkey,
    address: &Pubkey,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[BLACKLIST_SEED, config.as_ref(), address.as_ref()],
        program_id,
    )
}

/// Derive the Associated Token Account for a wallet on Token-2022.
pub fn get_associated_token_address(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    let (address, _) = Pubkey::find_program_address(
        &[
            wallet.as_ref(),
            token_2022_program_id().as_ref(),
            mint.as_ref(),
        ],
        &associated_token_program_id(),
    );
    address
}

// ── Anchor Instruction Builders ────────────────────────────────────────────

/// Compute the 8-byte Anchor instruction discriminator for a given instruction name.
///
/// Formula: `sha256("global:<snake_case_name>")[0..8]`
fn anchor_discriminator(instruction_name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{instruction_name}"));
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

/// Build the `mint_tokens` instruction for the SSS program.
///
/// Accounts (in order):
/// 1. minter (signer) — must hold active Minter role
/// 2. config (writable) — stablecoin config PDA
/// 3. role_account — minter's role PDA
/// 4. minter_quota (writable) — minter's quota PDA
/// 5. mint (writable) — Token-2022 mint
/// 6. recipient_token_account (writable) — recipient's ATA
/// 7. token_program — Token-2022 program
pub fn build_mint_instruction(
    ctx: &SolanaContext,
    recipient_token_account: &Pubkey,
    amount: u64,
) -> Instruction {
    let minter = ctx.keypair.pubkey();
    let (role_pda, _) = derive_role_pda(&ctx.config_pda, ROLE_MINTER, &minter, &ctx.program_id);
    let (quota_pda, _) =
        derive_minter_quota_pda(&ctx.config_pda, &minter, &ctx.program_id);

    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&anchor_discriminator("mint_tokens"));
    data.extend_from_slice(&amount.to_le_bytes());

    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(minter, true),
            AccountMeta::new(ctx.config_pda, false),
            AccountMeta::new_readonly(role_pda, false),
            AccountMeta::new(quota_pda, false),
            AccountMeta::new(ctx.mint, false),
            AccountMeta::new(*recipient_token_account, false),
            AccountMeta::new_readonly(token_2022_program_id(), false),
        ],
        data,
    }
}

/// Build the `burn_tokens` instruction for the SSS program.
///
/// Accounts (in order):
/// 1. burner (signer) — must hold active Burner role
/// 2. config (writable) — stablecoin config PDA
/// 3. role_account — burner's role PDA
/// 4. mint (writable) — Token-2022 mint
/// 5. from_token_account (writable) — token account to burn from
/// 6. token_program — Token-2022 program
pub fn build_burn_instruction(
    ctx: &SolanaContext,
    from_token_account: &Pubkey,
    amount: u64,
) -> Instruction {
    let burner = ctx.keypair.pubkey();
    let (role_pda, _) = derive_role_pda(&ctx.config_pda, ROLE_BURNER, &burner, &ctx.program_id);

    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&anchor_discriminator("burn_tokens"));
    data.extend_from_slice(&amount.to_le_bytes());

    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new_readonly(burner, true),
            AccountMeta::new(ctx.config_pda, false),
            AccountMeta::new_readonly(role_pda, false),
            AccountMeta::new(ctx.mint, false),
            AccountMeta::new(*from_token_account, false),
            AccountMeta::new_readonly(token_2022_program_id(), false),
        ],
        data,
    }
}

/// The System Program ID.
fn system_program_id() -> Pubkey {
    static ID: OnceLock<Pubkey> = OnceLock::new();
    *ID.get_or_init(|| {
        Pubkey::from_str("11111111111111111111111111111111")
            .expect("System program ID is a valid hardcoded constant")
    })
}

/// Build the `add_to_blacklist` instruction for the SSS program.
///
/// Accounts (in order):
/// 1. authority (signer, writable) — must hold active Blacklister role, pays rent
/// 2. config — stablecoin config PDA (must have `enable_transfer_hook`)
/// 3. role_account — authority's Blacklister role PDA
/// 4. blacklist_entry (writable) — BlacklistEntry PDA to be created (`init`)
/// 5. system_program — for PDA account creation
///
/// Data: `[discriminator("add_to_blacklist"), address: Pubkey, reason_len: u32, reason: bytes]`
pub fn build_add_to_blacklist_instruction(
    ctx: &SolanaContext,
    address: &Pubkey,
    reason: &str,
) -> Instruction {
    let authority = ctx.keypair.pubkey();
    let (role_pda, _) =
        derive_role_pda(&ctx.config_pda, ROLE_BLACKLISTER, &authority, &ctx.program_id);
    let (blacklist_pda, _) =
        derive_blacklist_pda(&ctx.config_pda, address, &ctx.program_id);

    let reason_bytes = reason.as_bytes();
    let reason_len = reason_bytes.len() as u32;
    let mut data = Vec::with_capacity(8 + 32 + 4 + reason_bytes.len());
    data.extend_from_slice(&anchor_discriminator("add_to_blacklist"));
    data.extend_from_slice(address.as_ref());
    data.extend_from_slice(&reason_len.to_le_bytes());
    data.extend_from_slice(reason_bytes);

    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(ctx.config_pda, false),
            AccountMeta::new_readonly(role_pda, false),
            AccountMeta::new(blacklist_pda, false),
            AccountMeta::new_readonly(system_program_id(), false),
        ],
        data,
    }
}

/// Build the `remove_from_blacklist` instruction for the SSS program.
///
/// Accounts (in order):
/// 1. authority (signer, writable) — must hold active Blacklister role, receives rent
/// 2. config — stablecoin config PDA
/// 3. role_account — authority's Blacklister role PDA
/// 4. blacklist_entry (writable) — BlacklistEntry PDA to be closed
///
/// Data: `[discriminator("remove_from_blacklist"), address: Pubkey]`
pub fn build_remove_from_blacklist_instruction(
    ctx: &SolanaContext,
    address: &Pubkey,
) -> Instruction {
    let authority = ctx.keypair.pubkey();
    let (role_pda, _) =
        derive_role_pda(&ctx.config_pda, ROLE_BLACKLISTER, &authority, &ctx.program_id);
    let (blacklist_pda, _) =
        derive_blacklist_pda(&ctx.config_pda, address, &ctx.program_id);

    let mut data = Vec::with_capacity(8 + 32);
    data.extend_from_slice(&anchor_discriminator("remove_from_blacklist"));
    data.extend_from_slice(address.as_ref());

    Instruction {
        program_id: ctx.program_id,
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(ctx.config_pda, false),
            AccountMeta::new_readonly(role_pda, false),
            AccountMeta::new(blacklist_pda, false),
        ],
        data,
    }
}

// ── Utility Functions ──────────────────────────────────────────────────────

/// Parse a base58-encoded string into a Solana `Pubkey`.
pub fn parse_pubkey(s: &str) -> Result<Pubkey, AppError> {
    Pubkey::from_str(s).map_err(|_| AppError::InvalidInput(format!("Invalid base58 address: {s}")))
}

/// Load a Solana keypair from a JSON file (standard CLI format: `[u8; 64]`).
pub fn load_keypair_from_file(path: &str) -> Result<Keypair, AppError> {
    let data = std::fs::read_to_string(path)
        .map_err(|e| AppError::NotConfigured(format!("Cannot read keypair file '{path}': {e}")))?;
    let bytes: Vec<u8> = serde_json::from_str(&data)
        .map_err(|e| AppError::NotConfigured(format!("Invalid keypair JSON in '{path}': {e}")))?;
    Keypair::from_bytes(&bytes)
        .map_err(|e| AppError::NotConfigured(format!("Invalid keypair bytes: {e}")))
}
