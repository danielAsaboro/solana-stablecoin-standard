use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
};

use crate::constants::*;

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The ExtraAccountMetas PDA — we create and write to it manually
    #[account(
        mut,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump,
    )]
    pub extra_account_metas: AccountInfo<'info>,

    /// CHECK: The Token-2022 mint this hook is associated with
    pub mint: AccountInfo<'info>,

    /// CHECK: The SSS main program ID for PDA derivation
    pub sss_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
    // Define the extra accounts needed by the transfer hook:
    //
    // The SPL Transfer Hook interface provides these standard accounts at indices 0-4:
    // 0: source token account
    // 1: mint
    // 2: destination token account
    // 3: source owner/delegate
    // 4: extra_account_metas PDA
    //
    // We need additional accounts starting at index 5:
    // 5: SSS program (for PDA derivation)
    // 6: StablecoinConfig PDA  — seeds: ["stablecoin", mint] from SSS program
    // 7: Source BlacklistEntry PDA — seeds: ["blacklist", config, source_owner] from SSS program
    // 8: Dest BlacklistEntry PDA — seeds: ["blacklist", config, dest_owner] from SSS program

    let extra_account_metas = vec![
        // Index 5: SSS program (external, not a PDA, just a static account key)
        ExtraAccountMeta::new_with_pubkey(&ctx.accounts.sss_program.key(), false, false)?,

        // Index 6: StablecoinConfig PDA (read-only)
        // Seeds: ["stablecoin", mint.key()] on sss_program (index 5)
        ExtraAccountMeta::new_external_pda_with_seeds(
            5, // program at extra account index 0 → absolute index 5
            &[
                Seed::Literal {
                    bytes: STABLECOIN_SEED.to_vec(),
                },
                Seed::AccountKey { index: 1 }, // mint (standard account index 1)
            ],
            false, // is_signer
            false, // is_writable
        )?,

        // Index 7: Source owner BlacklistEntry PDA (may not exist)
        // Seeds: ["blacklist", config, source_owner] on sss_program
        // source_owner is extracted from the source token account's owner field
        ExtraAccountMeta::new_external_pda_with_seeds(
            5, // sss_program
            &[
                Seed::Literal {
                    bytes: BLACKLIST_SEED.to_vec(),
                },
                Seed::AccountKey { index: 6 }, // config PDA (extra account index 1 → absolute 6)
                Seed::AccountData {
                    account_index: 0,   // source token account (standard index 0)
                    data_index: 32,    // owner field offset in Token-2022 account data
                    length: 32,         // pubkey length
                },
            ],
            false,
            false,
        )?,

        // Index 8: Destination owner BlacklistEntry PDA (may not exist)
        // Seeds: ["blacklist", config, dest_owner] on sss_program
        ExtraAccountMeta::new_external_pda_with_seeds(
            5, // sss_program
            &[
                Seed::Literal {
                    bytes: BLACKLIST_SEED.to_vec(),
                },
                Seed::AccountKey { index: 6 }, // config PDA
                Seed::AccountData {
                    account_index: 2,   // destination token account (standard index 2)
                    data_index: 32,    // owner field offset
                    length: 32,         // pubkey length
                },
            ],
            false,
            false,
        )?,
    ];

    // Calculate space needed for the extra account meta list
    let account_size = ExtraAccountMetaList::size_of(extra_account_metas.len())?;

    // Create the PDA account
    let mint_key = ctx.accounts.mint.key();
    let bump = ctx.bumps.extra_account_metas;
    let signer_seeds: &[&[&[u8]]] = &[&[
        EXTRA_ACCOUNT_METAS_SEED,
        mint_key.as_ref(),
        &[bump],
    ]];

    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(account_size);

    invoke_signed(
        &anchor_lang::solana_program::system_instruction::create_account(
            ctx.accounts.payer.key,
            ctx.accounts.extra_account_metas.key,
            lamports,
            account_size as u64,
            &crate::id(),
        ),
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.extra_account_metas.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        signer_seeds,
    )?;

    // Initialize the extra account meta list
    let mut data = ctx.accounts.extra_account_metas.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<spl_transfer_hook_interface::instruction::ExecuteInstruction>(
        &mut data,
        &extra_account_metas,
    )?;

    Ok(())
}
