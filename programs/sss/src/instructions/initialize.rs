use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::TokenInterface;
use spl_token_2022::{
    extension::{confidential_transfer, metadata_pointer, transfer_hook, ExtensionType},
    instruction as token_instruction,
    state::Mint as MintState,
};
use spl_token_metadata_interface::instruction as metadata_instruction;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::StablecoinInitialized;
use crate::state::StablecoinConfig;

/// Parameters for initializing a new stablecoin.
///
/// Passed to [`initialize`](crate::sss::initialize). Feature flags are immutable
/// after initialization — choose SSS-1 (all disabled) or SSS-2 (delegate + hook
/// enabled) at creation time.
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    /// Human-readable name (max 32 bytes).
    pub name: String,
    /// Token ticker symbol (max 10 bytes).
    pub symbol: String,
    /// Metadata URI pointing to off-chain JSON (max 200 bytes).
    pub uri: String,
    /// Decimal places for the token (0–9).
    pub decimals: u8,
    /// Enable the permanent delegate extension (required for seize, SSS-2).
    pub enable_permanent_delegate: bool,
    /// Enable the transfer hook extension (required for blacklist enforcement, SSS-2).
    pub enable_transfer_hook: bool,
    /// Whether newly created token accounts default to a frozen state.
    pub default_account_frozen: bool,
    /// Enable confidential transfers via Token-2022 ConfidentialTransferMint extension (SSS-3).
    pub enable_confidential_transfer: bool,
    /// The transfer hook program ID. Required when `enable_transfer_hook` is true.
    pub transfer_hook_program_id: Option<Pubkey>,
    /// Global supply cap in base units. Set to 0 for unlimited supply.
    pub supply_cap: u64,
}

/// Accounts required to initialize a new stablecoin.
///
/// The instruction creates the Token-2022 mint with the requested extensions,
/// sets on-chain metadata, and initializes the config PDA that governs the
/// stablecoin's lifecycle.
#[derive(Accounts)]
#[instruction(params: InitializeParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = StablecoinConfig::LEN,
        seeds = [STABLECOIN_SEED, mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: We create and initialize this account manually for Token-2022 extensions
    #[account(mut)]
    pub mint: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize a new stablecoin with Token-2022 extensions.
///
/// Performs the following steps:
/// 1. Validates input parameters (name, symbol, URI lengths; decimal range).
/// 2. Creates the Token-2022 mint with metadata-pointer (+ optional permanent
///    delegate, transfer hook, and confidential transfer extensions).
/// 3. Initializes mint authority and freeze authority to the config PDA.
/// 4. Writes on-chain token metadata (name, symbol, URI).
/// 5. Populates the [`StablecoinConfig`] PDA with runtime state.
/// 6. Emits a [`StablecoinInitialized`] event.
pub fn handler(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    require!(
        params.name.len() <= MAX_NAME_LEN,
        StablecoinError::NameTooLong
    );
    require!(
        params.symbol.len() <= MAX_SYMBOL_LEN,
        StablecoinError::SymbolTooLong
    );
    require!(params.uri.len() <= MAX_URI_LEN, StablecoinError::UriTooLong);
    require!(params.decimals <= 9, StablecoinError::InvalidDecimals);
    require!(
        !params.enable_transfer_hook || params.transfer_hook_program_id.is_some(),
        StablecoinError::InvalidConfig
    );

    let config_key = ctx.accounts.config.key();
    let mint_key = ctx.accounts.mint.key();

    // Determine which extensions to enable
    let mut extensions = vec![ExtensionType::MetadataPointer];
    if params.enable_permanent_delegate {
        extensions.push(ExtensionType::PermanentDelegate);
    }
    if params.enable_transfer_hook {
        extensions.push(ExtensionType::TransferHook);
    }
    if params.enable_confidential_transfer {
        extensions.push(ExtensionType::ConfidentialTransferMint);
    }

    // Calculate space for mint + extensions (NOT including variable-length metadata)
    let space = ExtensionType::try_calculate_account_len::<MintState>(&extensions)
        .map_err(|_| StablecoinError::MathOverflow)?;

    // Calculate additional space needed for token metadata TLV entry.
    // Token-2022 will realloc the mint account when we call initialize_token_metadata,
    // but the account must have enough lamports to cover the new rent-exempt minimum.
    //
    // Fixed overhead (92 bytes):
    //   TLV header: 8 (discriminator) + 4 (length) = 12
    //   update_authority (OptionalNonZeroPubkey): 32
    //   mint: 32
    //   3 string length prefixes (name, symbol, uri): 4 × 3 = 12
    //   additional_metadata vec length prefix: 4
    //
    // Variable part: name.len() + symbol.len() + uri.len()
    // (bounded by validation above: ≤ 32 + 10 + 200 = 242)
    const METADATA_FIXED_OVERHEAD: usize = 12 + 32 + 32 + 4 + 4 + 4 + 4;
    let metadata_space = METADATA_FIXED_OVERHEAD
        .checked_add(params.name.len())
        .and_then(|v| v.checked_add(params.symbol.len()))
        .and_then(|v| v.checked_add(params.uri.len()))
        .ok_or(StablecoinError::MathOverflow)?;

    let rent = Rent::get()?;
    // Allocate lamports for the full size (base + metadata) to cover post-realloc rent
    let total_space = space
        .checked_add(metadata_space)
        .ok_or(StablecoinError::MathOverflow)?;
    let lamports = rent.minimum_balance(total_space);

    // 1. Create the mint account with base extension space
    invoke(
        &anchor_lang::solana_program::system_instruction::create_account(
            ctx.accounts.authority.key,
            &mint_key,
            lamports,
            space as u64,
            ctx.accounts.token_program.key,
        ),
        &[
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    // 2. Initialize permanent delegate extension (if enabled) — BEFORE initialize_mint2
    if params.enable_permanent_delegate {
        invoke(
            &token_instruction::initialize_permanent_delegate(
                ctx.accounts.token_program.key,
                &mint_key,
                &config_key,
            )?,
            &[ctx.accounts.mint.to_account_info()],
        )?;
    }

    // 3. Initialize transfer hook extension (if enabled) — BEFORE initialize_mint2
    // Safety: validated above that transfer_hook_program_id.is_some() when enable_transfer_hook
    if params.enable_transfer_hook {
        let hook_program_id = params
            .transfer_hook_program_id
            .ok_or(StablecoinError::InvalidConfig)?;
        invoke(
            &transfer_hook::instruction::initialize(
                ctx.accounts.token_program.key,
                &mint_key,
                Some(config_key),
                Some(hook_program_id),
            )?,
            &[ctx.accounts.mint.to_account_info()],
        )?;
    }

    // 4. Initialize confidential transfer mint extension (if enabled) — BEFORE initialize_mint2
    if params.enable_confidential_transfer {
        invoke(
            &confidential_transfer::instruction::initialize_mint(
                ctx.accounts.token_program.key,
                &mint_key,
                Some(config_key),
                true, // auto_approve_new_accounts for PoC
                None, // no auditor for PoC
            )?,
            &[ctx.accounts.mint.to_account_info()],
        )?;
    }

    // 5. Initialize metadata pointer — BEFORE initialize_mint2 (extension inits must precede mint init)
    invoke(
        &metadata_pointer::instruction::initialize(
            ctx.accounts.token_program.key,
            &mint_key,
            Some(config_key),
            Some(mint_key),
        )?,
        &[ctx.accounts.mint.to_account_info()],
    )?;

    // 6. Initialize the mint — config PDA always owns freeze authority so
    //    accounts can be frozen for compliance or pause enforcement.
    invoke(
        &token_instruction::initialize_mint2(
            ctx.accounts.token_program.key,
            &mint_key,
            &config_key,
            Some(&config_key),
            params.decimals,
        )?,
        &[ctx.accounts.mint.to_account_info()],
    )?;

    // 7. Initialize token metadata on the mint itself
    let bump = ctx.bumps.config;
    let signer_seeds: &[&[&[u8]]] = &[&[STABLECOIN_SEED, mint_key.as_ref(), &[bump]]];

    invoke_signed(
        &metadata_instruction::initialize(
            ctx.accounts.token_program.key,
            &mint_key,
            &config_key,
            &mint_key,
            &config_key,
            params.name.clone(),
            params.symbol.clone(),
            params.uri.clone(),
        ),
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    // 8. Initialize config PDA
    let config = &mut ctx.accounts.config;
    config.mint = mint_key;
    config.name = params.name.clone();
    config.symbol = params.symbol.clone();
    config.uri = params.uri.clone();
    config.decimals = params.decimals;
    config.master_authority = ctx.accounts.authority.key();
    config.enable_permanent_delegate = params.enable_permanent_delegate;
    config.enable_transfer_hook = params.enable_transfer_hook;
    config.default_account_frozen = params.default_account_frozen;
    config.enable_confidential_transfer = params.enable_confidential_transfer;
    config.paused = false;
    config.total_minted = 0;
    config.total_burned = 0;
    config.transfer_hook_program = params.transfer_hook_program_id.unwrap_or_default();
    config.supply_cap = params.supply_cap;
    config.pending_authority = Pubkey::default();
    config.authority_transfer_at = 0;
    config.bump = bump;
    config._reserved = [0u8; 15];

    emit!(StablecoinInitialized {
        config: config_key,
        mint: mint_key,
        authority: ctx.accounts.authority.key(),
        name: params.name,
        symbol: params.symbol,
        decimals: params.decimals,
        enable_permanent_delegate: params.enable_permanent_delegate,
        enable_transfer_hook: params.enable_transfer_hook,
        enable_confidential_transfer: params.enable_confidential_transfer,
    });

    Ok(())
}
