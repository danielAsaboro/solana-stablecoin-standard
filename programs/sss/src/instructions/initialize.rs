use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::TokenInterface;
use spl_token_2022::{
    extension::{
        metadata_pointer, transfer_hook, ExtensionType,
    },
    instruction as token_instruction,
    state::Mint as MintState,
};
use spl_token_metadata_interface::instruction as metadata_instruction;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::StablecoinInitialized;
use crate::state::StablecoinConfig;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub decimals: u8,
    pub enable_permanent_delegate: bool,
    pub enable_transfer_hook: bool,
    pub default_account_frozen: bool,
    pub transfer_hook_program_id: Option<Pubkey>,
}

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

pub fn handler(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    require!(params.name.len() <= MAX_NAME_LEN, StablecoinError::NameTooLong);
    require!(params.symbol.len() <= MAX_SYMBOL_LEN, StablecoinError::SymbolTooLong);
    require!(params.uri.len() <= MAX_URI_LEN, StablecoinError::UriTooLong);
    require!(params.decimals <= 9, StablecoinError::InvalidDecimals);

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

    // Calculate space for mint + extensions (NOT including variable-length metadata)
    let space = ExtensionType::try_calculate_account_len::<MintState>(&extensions)
        .map_err(|_| StablecoinError::MathOverflow)?;

    // Calculate additional space needed for token metadata TLV entry.
    // Token-2022 will realloc the mint account when we call initialize_token_metadata,
    // but the account must have enough lamports to cover the new rent-exempt minimum.
    // TLV overhead: 8 (discriminator) + 4 (length) = 12 bytes
    // TokenMetadata fields: update_authority(32) + mint(32) + name(4+len) +
    //   symbol(4+len) + uri(4+len) + additional_metadata(4)
    let metadata_space: usize = 12
        + 32  // update_authority (OptionalNonZeroPubkey)
        + 32  // mint
        + 4 + params.name.len()
        + 4 + params.symbol.len()
        + 4 + params.uri.len()
        + 4;  // empty additional_metadata vec

    let rent = Rent::get()?;
    // Allocate lamports for the full size (base + metadata) to cover post-realloc rent
    let lamports = rent.minimum_balance(space + metadata_space);

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
    if params.enable_transfer_hook {
        let hook_program_id = params
            .transfer_hook_program_id
            .unwrap_or_default();
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

    // 4. Initialize metadata pointer — BEFORE initialize_mint2
    invoke(
        &metadata_pointer::instruction::initialize(
            ctx.accounts.token_program.key,
            &mint_key,
            Some(config_key),
            Some(mint_key),
        )?,
        &[ctx.accounts.mint.to_account_info()],
    )?;

    // 5. Initialize the mint — config PDA always owns freeze authority so
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

    // 6. Initialize token metadata on the mint itself
    let bump = ctx.bumps.config;
    let signer_seeds: &[&[&[u8]]] = &[&[
        STABLECOIN_SEED,
        mint_key.as_ref(),
        &[bump],
    ]];

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

    // 7. Initialize config PDA
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
    config.paused = false;
    config.total_minted = 0;
    config.total_burned = 0;
    config.transfer_hook_program = params
        .transfer_hook_program_id
        .unwrap_or_default();
    config.bump = bump;
    config._reserved = [0u8; 64];

    emit!(StablecoinInitialized {
        config: config_key,
        mint: mint_key,
        authority: ctx.accounts.authority.key(),
        name: params.name,
        symbol: params.symbol,
        decimals: params.decimals,
        enable_permanent_delegate: params.enable_permanent_delegate,
        enable_transfer_hook: params.enable_transfer_hook,
    });

    Ok(())
}
