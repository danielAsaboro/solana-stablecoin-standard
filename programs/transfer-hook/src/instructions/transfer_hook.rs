use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;

use crate::error::TransferHookError;

/// Read the `paused` flag from a StablecoinConfig account's raw data.
///
/// The field sits after three variable-length Borsh strings, so we skip
/// through discriminator (8) + mint (32) + name + symbol + uri + decimals (1)
/// + master_authority (32) + four bool flags, where `paused` is the fifth bool.
fn is_config_paused(config: &AccountInfo) -> Result<bool> {
    let data = config.try_borrow_data()?;
    let mut offset: usize = 8 + 32; // discriminator + mint

    // Skip three Borsh strings (4-byte len prefix + content)
    for _ in 0..3 {
        if offset + 4 > data.len() {
            return Err(ProgramError::InvalidAccountData.into());
        }
        let len = u32::from_le_bytes(
            data[offset..offset + 4]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?,
        ) as usize;
        offset += 4 + len;
    }

    // decimals (1) + master_authority (32) + 4 bool flags
    offset += 1 + 32 + 4;

    if offset >= data.len() {
        return Err(ProgramError::InvalidAccountData.into());
    }

    Ok(data[offset] != 0)
}

/// Transfer hook handler — called by Token-2022 on every transfer_checked.
/// Checks if either the source owner or destination owner is blacklisted.
///
/// The accounts follow the SPL Transfer Hook Interface:
/// 0: source token account
/// 1: mint
/// 2: destination token account
/// 3: source owner/delegate
/// 4: extra_account_metas PDA
/// 5+: extra accounts (config, source blacklist, dest blacklist)
#[derive(Accounts)]
pub struct TransferHookAccounts<'info> {
    /// CHECK: Source token account (validated by Token-2022)
    pub source_token: AccountInfo<'info>,

    /// CHECK: Token-2022 mint
    pub mint: AccountInfo<'info>,

    /// CHECK: Destination token account (validated by Token-2022)
    pub destination_token: AccountInfo<'info>,

    /// CHECK: Source token account owner/delegate
    pub owner_delegate: AccountInfo<'info>,

    /// CHECK: ExtraAccountMetas PDA
    pub extra_account_metas: AccountInfo<'info>,

    /// CHECK: SSS program ID (for PDA validation)
    pub sss_program: AccountInfo<'info>,

    /// CHECK: StablecoinConfig PDA from SSS program
    pub config: AccountInfo<'info>,

    /// CHECK: Source owner's BlacklistEntry PDA (may not exist = not blacklisted)
    pub source_blacklist: AccountInfo<'info>,

    /// CHECK: Destination owner's BlacklistEntry PDA (may not exist = not blacklisted)
    pub dest_blacklist: AccountInfo<'info>,
}

/// Anchor-dispatched transfer hook handler.
///
/// Checks blacklist PDAs for both source and destination owners. If either PDA
/// exists and is initialized (owned by the SSS program), the transfer is rejected.
/// Seizure transfers (where the authority is the config PDA / permanent delegate)
/// are allowed unconditionally.
pub fn handler(ctx: Context<TransferHookAccounts>, _amount: u64) -> Result<()> {
    // Check if this is a seizure by the permanent delegate (config PDA)
    // The authority is the 4th standard account (index 3)
    // Extra accounts: [sss_program, config_pda, source_blacklist, dest_blacklist]
    let sss_program_key = ctx.accounts.sss_program.key;
    let (expected_config, _) = Pubkey::find_program_address(
        &[b"stablecoin", ctx.accounts.mint.key.as_ref()],
        sss_program_key,
    );
    if ctx.accounts.owner_delegate.key == &expected_config {
        return Ok(()); // Seizure by permanent delegate - allow
    }

    // Reject transfers when the stablecoin is paused
    if is_config_paused(&ctx.accounts.config)? {
        return Err(TransferHookError::Paused.into());
    }

    // If the source blacklist PDA account has data, the source is blacklisted.
    // An empty/uninitialized account means not blacklisted.
    let source_bl = &ctx.accounts.source_blacklist;
    if !source_bl.data_is_empty()
        && source_bl.owner != &anchor_lang::solana_program::system_program::ID
    {
        return Err(TransferHookError::SourceBlacklisted.into());
    }

    // Same check for destination
    let dest_bl = &ctx.accounts.dest_blacklist;
    if !dest_bl.data_is_empty() && dest_bl.owner != &anchor_lang::solana_program::system_program::ID
    {
        return Err(TransferHookError::DestinationBlacklisted.into());
    }

    Ok(())
}

/// Raw handler for SPL Transfer Hook Execute calls (non-Anchor dispatch).
/// Token-2022 CPIs into the hook using the SPL Transfer Hook Interface
/// discriminator, which differs from Anchor's discriminator. This function
/// is called from the program's `fallback` entry point.
///
/// Accounts layout from Token-2022 CPI:
/// 0: source token account
/// 1: mint
/// 2: destination token account
/// 3: owner/delegate
/// 4: extra_account_metas PDA
/// Extra accounts from ExtraAccountMetas:
/// 5: sss_program
/// 6: config_pda
/// 7: source_blacklist
/// 8: dest_blacklist
pub fn execute_transfer_hook<'info>(
    accounts: &[AccountInfo<'info>],
    _amount: u64,
) -> anchor_lang::Result<()> {
    if accounts.len() < 9 {
        return Err(ProgramError::NotEnoughAccountKeys.into());
    }

    let mint = &accounts[1];
    let owner_delegate = &accounts[3];
    let sss_program = &accounts[5];
    let source_blacklist = &accounts[7];
    let dest_blacklist = &accounts[8];

    // Check if this is a seizure by the permanent delegate (config PDA).
    // If the owner/delegate is the config PDA, allow the transfer unconditionally.
    let (expected_config, _) =
        Pubkey::find_program_address(&[b"stablecoin", mint.key.as_ref()], sss_program.key);
    if owner_delegate.key == &expected_config {
        return Ok(()); // Seizure by permanent delegate - allow
    }

    let config = &accounts[6];
    if is_config_paused(config)? {
        return Err(TransferHookError::Paused.into());
    }

    // Check blacklist: if the source blacklist PDA has data and is owned by the
    // SSS program (not the system program), the source owner is blacklisted.
    if !source_blacklist.data_is_empty()
        && source_blacklist.owner != &anchor_lang::solana_program::system_program::ID
    {
        return Err(TransferHookError::SourceBlacklisted.into());
    }

    // Same check for destination
    if !dest_blacklist.data_is_empty()
        && dest_blacklist.owner != &anchor_lang::solana_program::system_program::ID
    {
        return Err(TransferHookError::DestinationBlacklisted.into());
    }

    Ok(())
}
