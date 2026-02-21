//! # SSS Transfer Hook Program
//!
//! SPL Transfer Hook that enforces blacklist checks on every `transfer_checked`
//! call for SSS-2 (Compliant Stablecoin) mints.
//!
//! ## How it works
//!
//! When Token-2022 processes a `transfer_checked` for a mint with a transfer hook
//! extension, it CPIs into this program with the SPL Transfer Hook Interface
//! discriminator. The program checks whether either the source or destination
//! owner has a [`BlacklistEntry`](crate::constants::BLACKLIST_SEED) PDA on the
//! SSS main program. If a blacklist PDA exists and is initialized, the transfer
//! is rejected.
//!
//! ## Seizure bypass
//!
//! When the permanent delegate (the [`StablecoinConfig`] PDA) is the authority
//! on a transfer, the hook allows it unconditionally. This enables the `seize`
//! instruction to move tokens from blacklisted accounts to a treasury.
//!
//! ## Account resolution
//!
//! The [`ExtraAccountMetas`] PDA stores the account resolution recipe so that
//! Token-2022 can dynamically derive the required extra accounts (config PDA,
//! source blacklist PDA, destination blacklist PDA) for each transfer.

#![deny(clippy::all)]
// Anchor-generated code triggers these — safe to allow at crate level.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]
#![allow(clippy::result_large_err)]

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
                // Safety: slice length is guaranteed to be exactly 8 bytes
                // by the bounds check above, so try_into cannot fail.
                u64::from_le_bytes(
                    data[8..16]
                        .try_into()
                        .map_err(|_| ProgramError::InvalidInstructionData)?,
                )
            } else {
                0u64
            };
            return instructions::transfer_hook::execute_transfer_hook(accounts, amount);
        }

        Err(ProgramError::InvalidInstructionData.into())
    }
}
