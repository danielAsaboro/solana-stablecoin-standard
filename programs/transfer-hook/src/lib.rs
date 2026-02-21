pub mod constants;
pub mod error;
pub mod instructions;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;
use instructions::*;

declare_id!("Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH");

#[program]
pub mod transfer_hook {
    use super::*;

    /// Initialize the ExtraAccountMetas PDA for a stablecoin mint.
    /// Must be called after the stablecoin is initialized with transfer hook enabled.
    pub fn initialize_extra_account_metas(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        instructions::initialize_extra_account_metas::handler(ctx)
    }

    /// Transfer hook handler — invoked by Token-2022 on every transfer_checked.
    /// This is the Anchor instruction that maps to the SPL Transfer Hook execute interface.
    pub fn transfer_hook_execute(
        ctx: Context<TransferHookAccounts>,
        amount: u64,
    ) -> Result<()> {
        instructions::transfer_hook::handler(ctx, amount)
    }

    /// Fallback handler for SPL Transfer Hook Interface.
    ///
    /// Token-2022 CPIs into the transfer hook program using the SPL Transfer
    /// Hook Interface discriminator (`[105, 37, 101, 197, 75, 251, 102, 26]`),
    /// which is different from Anchor's auto-generated discriminator. Without
    /// this fallback, the program returns `InstructionFallbackNotFound` because
    /// Anchor cannot match the incoming instruction data to any known handler.
    ///
    /// This function intercepts the SPL discriminator, parses the amount from
    /// the instruction data, and delegates to `execute_transfer_hook` which
    /// performs the same blacklist checks as the Anchor-dispatched handler.
    pub fn fallback<'info>(
        _program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        // SPL Transfer Hook Execute discriminator
        let execute_discriminator: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];

        if data.len() >= 8 && data[..8] == execute_discriminator {
            let amount = if data.len() >= 16 {
                u64::from_le_bytes(data[8..16].try_into().unwrap())
            } else {
                0u64
            };
            return instructions::transfer_hook::execute_transfer_hook(accounts, amount);
        }

        Err(ProgramError::InvalidInstructionData.into())
    }
}
