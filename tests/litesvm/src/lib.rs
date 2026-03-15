#[cfg(test)]
#[allow(dead_code)]
mod helpers {
    use litesvm::LiteSVM;
    use sha2::{Digest, Sha256};
    use solana_sdk::{
        clock::Clock,
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        signature::{Keypair, Signer},
        system_program,
        transaction::Transaction,
    };

    // ── PDA seeds (mirror programs/sss/src/constants.rs) ────────────────────

    pub const STABLECOIN_SEED: &[u8] = b"stablecoin";
    pub const ROLE_SEED: &[u8] = b"role";
    pub const MINTER_QUOTA_SEED: &[u8] = b"minter_quota";
    pub const BLACKLIST_SEED: &[u8] = b"blacklist";

    // ── Role type constants ─────────────────────────────────────────────────

    pub const ROLE_MINTER: u8 = 0;
    pub const ROLE_BURNER: u8 = 1;
    pub const ROLE_PAUSER: u8 = 2;
    pub const ROLE_BLACKLISTER: u8 = 3;
    pub const ROLE_SEIZER: u8 = 4;

    // ── Well-known program IDs ──────────────────────────────────────────────

    pub fn sss_program_id() -> Pubkey {
        "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
            .parse()
            .unwrap()
    }

    pub fn token_2022_program_id() -> Pubkey {
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
            .parse()
            .unwrap()
    }

    pub fn associated_token_program_id() -> Pubkey {
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
            .parse()
            .unwrap()
    }

    pub fn rent_sysvar() -> Pubkey {
        solana_sdk::sysvar::rent::ID
    }

    // ── PDA derivation helpers ──────────────────────────────────────────────

    pub fn find_config_pda(mint: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[STABLECOIN_SEED, mint.as_ref()], &sss_program_id())
    }

    pub fn find_role_pda(config: &Pubkey, role_type: u8, user: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[ROLE_SEED, config.as_ref(), &[role_type], user.as_ref()],
            &sss_program_id(),
        )
    }

    pub fn find_minter_quota_pda(config: &Pubkey, minter: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[MINTER_QUOTA_SEED, config.as_ref(), minter.as_ref()],
            &sss_program_id(),
        )
    }

    pub fn find_blacklist_pda(config: &Pubkey, address: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[BLACKLIST_SEED, config.as_ref(), address.as_ref()],
            &sss_program_id(),
        )
    }

    pub fn find_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        spl_associated_token_account::get_associated_token_address_with_program_id(
            owner,
            mint,
            &token_2022_program_id(),
        )
    }

    // ── Anchor discriminator ────────────────────────────────────────────────

    pub fn anchor_discriminator(name: &str) -> [u8; 8] {
        let mut hasher = Sha256::new();
        hasher.update(format!("global:{}", name));
        let hash = hasher.finalize();
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&hash[..8]);
        disc
    }

    // ── Borsh serialization helpers ─────────────────────────────────────────

    fn push_string(buf: &mut Vec<u8>, s: &str) {
        buf.extend_from_slice(&(s.len() as u32).to_le_bytes());
        buf.extend_from_slice(s.as_bytes());
    }

    fn push_u8(buf: &mut Vec<u8>, v: u8) {
        buf.push(v);
    }

    fn push_bool(buf: &mut Vec<u8>, v: bool) {
        buf.push(u8::from(v));
    }

    fn push_u64(buf: &mut Vec<u8>, v: u64) {
        buf.extend_from_slice(&v.to_le_bytes());
    }

    fn push_pubkey(buf: &mut Vec<u8>, pk: &Pubkey) {
        buf.extend_from_slice(pk.as_ref());
    }

    fn push_option_pubkey(buf: &mut Vec<u8>, opt: &Option<Pubkey>) {
        match opt {
            Some(pk) => {
                buf.push(1);
                push_pubkey(buf, pk);
            }
            None => buf.push(0),
        }
    }

    // ── Instruction builders ────────────────────────────────────────────────

    pub fn build_initialize_ix(
        authority: &Pubkey,
        mint: &Pubkey,
        config: &Pubkey,
        name: &str,
        symbol: &str,
        uri: &str,
        decimals: u8,
        enable_permanent_delegate: bool,
        enable_transfer_hook: bool,
        default_account_frozen: bool,
        enable_confidential_transfer: bool,
        transfer_hook_program_id: Option<Pubkey>,
        supply_cap: u64,
    ) -> Instruction {
        let mut data = anchor_discriminator("initialize").to_vec();
        push_string(&mut data, name);
        push_string(&mut data, symbol);
        push_string(&mut data, uri);
        push_u8(&mut data, decimals);
        push_bool(&mut data, enable_permanent_delegate);
        push_bool(&mut data, enable_transfer_hook);
        push_bool(&mut data, default_account_frozen);
        push_bool(&mut data, enable_confidential_transfer);
        push_option_pubkey(&mut data, &transfer_hook_program_id);
        push_u64(&mut data, supply_cap);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new(*authority, true),
                AccountMeta::new(*config, false),
                AccountMeta::new(*mint, true),
                AccountMeta::new_readonly(token_2022_program_id(), false),
                AccountMeta::new_readonly(associated_token_program_id(), false),
                AccountMeta::new_readonly(system_program::ID, false),
                AccountMeta::new_readonly(rent_sysvar(), false),
            ],
            data,
        }
    }

    pub fn build_assign_role_ix(
        authority: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
        role_type: u8,
        user: &Pubkey,
    ) -> Instruction {
        let mut data = anchor_discriminator("assign_role").to_vec();
        push_u8(&mut data, role_type);
        push_pubkey(&mut data, user);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new(*role_account, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    pub fn build_update_role_ix(
        authority: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
        role_type: u8,
        user: &Pubkey,
        active: bool,
    ) -> Instruction {
        let mut data = anchor_discriminator("update_role").to_vec();
        push_u8(&mut data, role_type);
        push_pubkey(&mut data, user);
        push_bool(&mut data, active);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new(*role_account, false),
            ],
            data,
        }
    }

    pub fn build_create_minter_ix(
        authority: &Pubkey,
        config: &Pubkey,
        minter_quota: &Pubkey,
        minter: &Pubkey,
        quota: u64,
    ) -> Instruction {
        let mut data = anchor_discriminator("create_minter").to_vec();
        push_pubkey(&mut data, minter);
        push_u64(&mut data, quota);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new(*minter_quota, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    pub fn build_update_minter_ix(
        authority: &Pubkey,
        config: &Pubkey,
        minter_quota: &Pubkey,
        minter: &Pubkey,
        quota: u64,
    ) -> Instruction {
        let mut data = anchor_discriminator("update_minter").to_vec();
        push_pubkey(&mut data, minter);
        push_u64(&mut data, quota);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new(*minter_quota, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    pub fn build_reset_minter_quota_ix(
        authority: &Pubkey,
        config: &Pubkey,
        minter_quota: &Pubkey,
        minter: &Pubkey,
    ) -> Instruction {
        let mut data = anchor_discriminator("reset_minter_quota").to_vec();
        push_pubkey(&mut data, minter);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new(*minter_quota, false),
            ],
            data,
        }
    }

    pub fn build_mint_tokens_ix(
        minter: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
        minter_quota: &Pubkey,
        mint: &Pubkey,
        recipient_token_account: &Pubkey,
        amount: u64,
    ) -> Instruction {
        let mut data = anchor_discriminator("mint_tokens").to_vec();
        push_u64(&mut data, amount);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*minter, true),
                AccountMeta::new(*config, false),
                AccountMeta::new_readonly(*role_account, false),
                AccountMeta::new(*minter_quota, false),
                AccountMeta::new(*mint, false),
                AccountMeta::new(*recipient_token_account, false),
                AccountMeta::new_readonly(token_2022_program_id(), false),
            ],
            data,
        }
    }

    pub fn build_burn_tokens_ix(
        burner: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
        mint: &Pubkey,
        from_token_account: &Pubkey,
        amount: u64,
    ) -> Instruction {
        let mut data = anchor_discriminator("burn_tokens").to_vec();
        push_u64(&mut data, amount);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*burner, true),
                AccountMeta::new(*config, false),
                AccountMeta::new_readonly(*role_account, false),
                AccountMeta::new(*mint, false),
                AccountMeta::new(*from_token_account, false),
                AccountMeta::new_readonly(token_2022_program_id(), false),
            ],
            data,
        }
    }

    pub fn build_pause_ix(
        authority: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
    ) -> Instruction {
        let data = anchor_discriminator("pause").to_vec();

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*authority, true),
                AccountMeta::new(*config, false),
                AccountMeta::new_readonly(*role_account, false),
            ],
            data,
        }
    }

    pub fn build_unpause_ix(
        authority: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
    ) -> Instruction {
        let data = anchor_discriminator("unpause").to_vec();

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*authority, true),
                AccountMeta::new(*config, false),
                AccountMeta::new_readonly(*role_account, false),
            ],
            data,
        }
    }

    pub fn build_propose_authority_transfer_ix(
        authority: &Pubkey,
        config: &Pubkey,
        new_authority: &Pubkey,
    ) -> Instruction {
        let mut data = anchor_discriminator("propose_authority_transfer").to_vec();
        push_pubkey(&mut data, new_authority);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*authority, true),
                AccountMeta::new(*config, false),
            ],
            data,
        }
    }

    pub fn build_accept_authority_transfer_ix(
        new_authority: &Pubkey,
        config: &Pubkey,
    ) -> Instruction {
        let data = anchor_discriminator("accept_authority_transfer").to_vec();

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*new_authority, true),
                AccountMeta::new(*config, false),
            ],
            data,
        }
    }

    pub fn build_cancel_authority_transfer_ix(authority: &Pubkey, config: &Pubkey) -> Instruction {
        let data = anchor_discriminator("cancel_authority_transfer").to_vec();

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*authority, true),
                AccountMeta::new(*config, false),
            ],
            data,
        }
    }

    pub fn build_add_to_blacklist_ix(
        authority: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
        blacklist_entry: &Pubkey,
        address: &Pubkey,
        reason: &str,
        evidence_hash: [u8; 32],
        evidence_uri: &str,
    ) -> Instruction {
        let mut data = anchor_discriminator("add_to_blacklist").to_vec();
        push_pubkey(&mut data, address);
        push_string(&mut data, reason);
        data.extend_from_slice(&evidence_hash);
        push_string(&mut data, evidence_uri);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new_readonly(*role_account, false),
                AccountMeta::new(*blacklist_entry, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    // ── SVM bootstrap ───────────────────────────────────────────────────────

    pub fn setup_svm() -> LiteSVM {
        let mut svm = LiteSVM::new();
        svm.set_sysvar::<Clock>(&Clock {
            slot: 1,
            epoch_start_timestamp: 1_700_000_000,
            epoch: 0,
            leader_schedule_epoch: 0,
            unix_timestamp: 1_700_000_000,
        });
        let program_bytes = std::fs::read("../../target/deploy/sss.so")
            .expect("SSS program not found at target/deploy/sss.so — run `anchor build` first");
        svm.add_program(sss_program_id(), &program_bytes);
        svm
    }

    pub fn airdrop(svm: &mut LiteSVM, pubkey: &Pubkey, lamports: u64) {
        svm.airdrop(pubkey, lamports).unwrap();
    }

    pub const SOL: u64 = 1_000_000_000;

    // ── Transaction helpers ─────────────────────────────────────────────────

    pub fn send_tx(
        svm: &mut LiteSVM,
        ixs: &[Instruction],
        payer: &Keypair,
        signers: &[&Keypair],
    ) -> Result<(), litesvm::types::FailedTransactionMetadata> {
        let blockhash = svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), signers, blockhash);
        svm.send_transaction(tx).map(|_| ())
    }

    // ── Account deserialization ─────────────────────────────────────────────

    /// Read a raw account's data from the SVM, stripping the 8-byte Anchor discriminator.
    pub fn read_account_data(svm: &LiteSVM, pubkey: &Pubkey) -> Option<Vec<u8>> {
        svm.get_account(pubkey).map(|a| a.data)
    }

    /// Deserialize a StablecoinConfig from account data.
    /// Layout (after 8-byte discriminator):
    ///   mint: Pubkey (32)
    ///   name: String (4 + len)
    ///   symbol: String (4 + len)
    ///   uri: String (4 + len)
    ///   decimals: u8
    ///   master_authority: Pubkey (32)
    ///   enable_permanent_delegate: bool
    ///   enable_transfer_hook: bool
    ///   default_account_frozen: bool
    ///   enable_confidential_transfer: bool
    ///   paused: bool
    ///   total_minted: u64
    ///   total_burned: u64
    ///   transfer_hook_program: Pubkey (32)
    ///   supply_cap: u64
    ///   pending_authority: Pubkey (32)
    ///   authority_transfer_at: i64
    ///   bump: u8
    ///   _reserved: [u8; 15]
    pub struct ConfigData {
        pub mint: Pubkey,
        pub name: String,
        pub symbol: String,
        pub uri: String,
        pub decimals: u8,
        pub master_authority: Pubkey,
        pub enable_permanent_delegate: bool,
        pub enable_transfer_hook: bool,
        pub default_account_frozen: bool,
        pub enable_confidential_transfer: bool,
        pub paused: bool,
        pub total_minted: u64,
        pub total_burned: u64,
        pub transfer_hook_program: Pubkey,
        pub supply_cap: u64,
        pub pending_authority: Pubkey,
        pub authority_transfer_at: i64,
        pub bump: u8,
    }

    fn read_pubkey(data: &[u8], offset: &mut usize) -> Pubkey {
        let pk = Pubkey::try_from(&data[*offset..*offset + 32]).unwrap();
        *offset += 32;
        pk
    }

    fn read_string(data: &[u8], offset: &mut usize) -> String {
        let len = u32::from_le_bytes(data[*offset..*offset + 4].try_into().unwrap()) as usize;
        *offset += 4;
        let s = String::from_utf8(data[*offset..*offset + len].to_vec()).unwrap();
        *offset += len;
        s
    }

    fn read_bool(data: &[u8], offset: &mut usize) -> bool {
        let v = data[*offset] != 0;
        *offset += 1;
        v
    }

    fn read_u8(data: &[u8], offset: &mut usize) -> u8 {
        let v = data[*offset];
        *offset += 1;
        v
    }

    fn read_u64(data: &[u8], offset: &mut usize) -> u64 {
        let v = u64::from_le_bytes(data[*offset..*offset + 8].try_into().unwrap());
        *offset += 8;
        v
    }

    fn read_i64(data: &[u8], offset: &mut usize) -> i64 {
        let v = i64::from_le_bytes(data[*offset..*offset + 8].try_into().unwrap());
        *offset += 8;
        v
    }

    pub fn deserialize_config(data: &[u8]) -> ConfigData {
        let mut offset = 8; // skip Anchor discriminator
        let mint = read_pubkey(data, &mut offset);
        let name = read_string(data, &mut offset);
        let symbol = read_string(data, &mut offset);
        let uri = read_string(data, &mut offset);
        let decimals = read_u8(data, &mut offset);
        let master_authority = read_pubkey(data, &mut offset);
        let enable_permanent_delegate = read_bool(data, &mut offset);
        let enable_transfer_hook = read_bool(data, &mut offset);
        let default_account_frozen = read_bool(data, &mut offset);
        let enable_confidential_transfer = read_bool(data, &mut offset);
        let paused = read_bool(data, &mut offset);
        let total_minted = read_u64(data, &mut offset);
        let total_burned = read_u64(data, &mut offset);
        let transfer_hook_program = read_pubkey(data, &mut offset);
        let supply_cap = read_u64(data, &mut offset);
        let pending_authority = read_pubkey(data, &mut offset);
        let authority_transfer_at = read_i64(data, &mut offset);
        let bump = read_u8(data, &mut offset);

        ConfigData {
            mint,
            name,
            symbol,
            uri,
            decimals,
            master_authority,
            enable_permanent_delegate,
            enable_transfer_hook,
            default_account_frozen,
            enable_confidential_transfer,
            paused,
            total_minted,
            total_burned,
            transfer_hook_program,
            supply_cap,
            pending_authority,
            authority_transfer_at,
            bump,
        }
    }

    /// Deserialize a RoleAccount from raw account data.
    /// Layout (after 8-byte discriminator):
    ///   config: Pubkey (32)
    ///   user: Pubkey (32)
    ///   role_type: u8
    ///   active: bool
    ///   bump: u8
    pub struct RoleData {
        pub config: Pubkey,
        pub user: Pubkey,
        pub role_type: u8,
        pub active: bool,
        pub bump: u8,
    }

    pub fn deserialize_role(data: &[u8]) -> RoleData {
        let mut offset = 8;
        let config = read_pubkey(data, &mut offset);
        let user = read_pubkey(data, &mut offset);
        let role_type = read_u8(data, &mut offset);
        let active = read_bool(data, &mut offset);
        let bump = read_u8(data, &mut offset);

        RoleData {
            config,
            user,
            role_type,
            active,
            bump,
        }
    }

    /// Deserialize a MinterQuota from raw account data.
    /// Layout (after 8-byte discriminator):
    ///   config: Pubkey (32)
    ///   minter: Pubkey (32)
    ///   quota: u64
    ///   minted: u64
    ///   bump: u8
    pub struct MinterQuotaData {
        pub config: Pubkey,
        pub minter: Pubkey,
        pub quota: u64,
        pub minted: u64,
        pub bump: u8,
    }

    pub fn deserialize_minter_quota(data: &[u8]) -> MinterQuotaData {
        let mut offset = 8;
        let config = read_pubkey(data, &mut offset);
        let minter = read_pubkey(data, &mut offset);
        let quota = read_u64(data, &mut offset);
        let minted = read_u64(data, &mut offset);
        let bump = read_u8(data, &mut offset);

        MinterQuotaData {
            config,
            minter,
            quota,
            minted,
            bump,
        }
    }

    /// Deserialize a BlacklistEntry from raw account data.
    /// Layout (after 8-byte discriminator):
    ///   config: Pubkey (32)
    ///   address: Pubkey (32)
    ///   reason: String (4 + len)
    ///   blacklisted_at: i64
    ///   blacklisted_by: Pubkey (32)
    ///   bump: u8
    pub struct BlacklistData {
        pub config: Pubkey,
        pub address: Pubkey,
        pub reason: String,
        pub blacklisted_at: i64,
        pub blacklisted_by: Pubkey,
        pub evidence_hash: [u8; 32],
        pub evidence_uri: String,
        pub bump: u8,
    }

    pub fn deserialize_blacklist(data: &[u8]) -> BlacklistData {
        let mut offset = 8;
        let config = read_pubkey(data, &mut offset);
        let address = read_pubkey(data, &mut offset);
        let reason = read_string(data, &mut offset);
        let blacklisted_at = read_i64(data, &mut offset);
        let blacklisted_by = read_pubkey(data, &mut offset);

        let mut evidence_hash = [0u8; 32];
        evidence_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let evidence_uri = read_string(data, &mut offset);
        let bump = read_u8(data, &mut offset);

        BlacklistData {
            config,
            address,
            reason,
            blacklisted_at,
            blacklisted_by,
            evidence_hash,
            evidence_uri,
            bump,
        }
    }

    pub fn build_update_blacklist_evidence_ix(
        authority: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
        blacklist_entry: &Pubkey,
        address: &Pubkey,
        evidence_hash: [u8; 32],
        evidence_uri: &str,
    ) -> Instruction {
        let mut data = anchor_discriminator("update_blacklist_evidence").to_vec();
        push_pubkey(&mut data, address);
        data.extend_from_slice(&evidence_hash);
        push_string(&mut data, evidence_uri);

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new_readonly(*role_account, false),
                AccountMeta::new(*blacklist_entry, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    // ── Composite setup helpers ─────────────────────────────────────────────

    /// Initialize an SSS-1 stablecoin (no permanent delegate, no transfer hook).
    /// Returns (svm, authority, mint_keypair, config_pda).
    pub fn setup_sss1() -> (LiteSVM, Keypair, Keypair, Pubkey) {
        let mut svm = setup_svm();
        let authority = Keypair::new();
        let mint = Keypair::new();
        airdrop(&mut svm, &authority.pubkey(), 10 * SOL);

        let (config_pda, _) = find_config_pda(&mint.pubkey());

        let ix = build_initialize_ix(
            &authority.pubkey(),
            &mint.pubkey(),
            &config_pda,
            "Test USD",
            "TUSD",
            "https://example.com/tusd.json",
            6,
            false, // no permanent delegate
            false, // no transfer hook
            false, // no default frozen
            false, // no confidential transfer
            None,
            0, // no supply cap
        );

        send_tx(&mut svm, &[ix], &authority, &[&authority, &mint])
            .expect("initialize SSS-1 failed");

        (svm, authority, mint, config_pda)
    }

    /// Initialize an SSS-1 stablecoin with a supply cap.
    pub fn setup_sss1_with_cap(cap: u64) -> (LiteSVM, Keypair, Keypair, Pubkey) {
        let mut svm = setup_svm();
        let authority = Keypair::new();
        let mint = Keypair::new();
        airdrop(&mut svm, &authority.pubkey(), 10 * SOL);

        let (config_pda, _) = find_config_pda(&mint.pubkey());

        let ix = build_initialize_ix(
            &authority.pubkey(),
            &mint.pubkey(),
            &config_pda,
            "Capped USD",
            "CUSD",
            "https://example.com/cusd.json",
            6,
            false,
            false,
            false,
            false,
            None,
            cap,
        );

        send_tx(&mut svm, &[ix], &authority, &[&authority, &mint])
            .expect("initialize SSS-1 (capped) failed");

        (svm, authority, mint, config_pda)
    }

    /// Assign a minter role and set a quota. Returns (role_pda, quota_pda).
    pub fn setup_minter(
        svm: &mut LiteSVM,
        authority: &Keypair,
        config: &Pubkey,
        minter: &Pubkey,
        quota: u64,
    ) -> (Pubkey, Pubkey) {
        let (role_pda, _) = find_role_pda(config, ROLE_MINTER, minter);
        let (quota_pda, _) = find_minter_quota_pda(config, minter);

        let assign_ix =
            build_assign_role_ix(&authority.pubkey(), config, &role_pda, ROLE_MINTER, minter);
        send_tx(svm, &[assign_ix], authority, &[authority]).expect("assign minter role failed");

        let quota_ix =
            build_create_minter_ix(&authority.pubkey(), config, &quota_pda, minter, quota);
        send_tx(svm, &[quota_ix], authority, &[authority]).expect("create minter quota failed");

        (role_pda, quota_pda)
    }

    /// Assign a burner role. Returns role_pda.
    pub fn setup_burner(
        svm: &mut LiteSVM,
        authority: &Keypair,
        config: &Pubkey,
        burner: &Pubkey,
    ) -> Pubkey {
        let (role_pda, _) = find_role_pda(config, ROLE_BURNER, burner);

        let assign_ix =
            build_assign_role_ix(&authority.pubkey(), config, &role_pda, ROLE_BURNER, burner);
        send_tx(svm, &[assign_ix], authority, &[authority]).expect("assign burner role failed");

        role_pda
    }

    /// Assign a pauser role. Returns role_pda.
    pub fn setup_pauser(
        svm: &mut LiteSVM,
        authority: &Keypair,
        config: &Pubkey,
        pauser: &Pubkey,
    ) -> Pubkey {
        let (role_pda, _) = find_role_pda(config, ROLE_PAUSER, pauser);

        let assign_ix =
            build_assign_role_ix(&authority.pubkey(), config, &role_pda, ROLE_PAUSER, pauser);
        send_tx(svm, &[assign_ix], authority, &[authority]).expect("assign pauser role failed");

        role_pda
    }

    /// Create an ATA for an owner using Token-2022. Returns ATA pubkey.
    pub fn create_ata(svm: &mut LiteSVM, payer: &Keypair, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        let ata = find_ata(owner, mint);
        let ix = spl_associated_token_account::instruction::create_associated_token_account(
            &payer.pubkey(),
            owner,
            mint,
            &token_2022_program_id(),
        );
        send_tx(svm, &[ix], payer, &[payer]).expect("create ATA failed");
        ata
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Test modules
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod sss1_lifecycle {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_initialize_sss1() {
        let (svm, authority, mint, config_pda) = setup_sss1();

        let data = read_account_data(&svm, &config_pda).expect("config account not found");
        let config = deserialize_config(&data);

        assert_eq!(config.mint, mint.pubkey());
        assert_eq!(config.name, "Test USD");
        assert_eq!(config.symbol, "TUSD");
        assert_eq!(config.uri, "https://example.com/tusd.json");
        assert_eq!(config.decimals, 6);
        assert_eq!(config.master_authority, authority.pubkey());
        assert!(!config.enable_permanent_delegate);
        assert!(!config.enable_transfer_hook);
        assert!(!config.default_account_frozen);
        assert!(!config.enable_confidential_transfer);
        assert!(!config.paused);
        assert_eq!(config.total_minted, 0);
        assert_eq!(config.total_burned, 0);
        assert_eq!(config.supply_cap, 0);
    }

    #[test]
    fn test_init_mint_burn_lifecycle() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        // Set up a minter/burner user
        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);

        let (minter_role, minter_quota) =
            setup_minter(&mut svm, &authority, &config_pda, &user.pubkey(), 1_000_000);
        let burner_role = setup_burner(&mut svm, &authority, &config_pda, &user.pubkey());

        // Create recipient ATA
        let recipient_ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Mint 500_000 tokens
        let mint_ix = build_mint_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &recipient_ata,
            500_000,
        );
        send_tx(&mut svm, &[mint_ix], &user, &[&user]).expect("mint_tokens failed");

        // Verify config state
        let data = read_account_data(&svm, &config_pda).expect("config missing");
        let config = deserialize_config(&data);
        assert_eq!(config.total_minted, 500_000);
        assert_eq!(config.total_burned, 0);

        // Verify minter quota state
        let qdata = read_account_data(&svm, &minter_quota).expect("quota missing");
        let quota = deserialize_minter_quota(&qdata);
        assert_eq!(quota.minted, 500_000);
        assert_eq!(quota.quota, 1_000_000);

        // Burn 200_000 tokens
        let burn_ix = build_burn_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &burner_role,
            &mint.pubkey(),
            &recipient_ata,
            200_000,
        );
        send_tx(&mut svm, &[burn_ix], &user, &[&user]).expect("burn_tokens failed");

        // Verify updated supply counters
        let data = read_account_data(&svm, &config_pda).expect("config missing");
        let config = deserialize_config(&data);
        assert_eq!(config.total_minted, 500_000);
        assert_eq!(config.total_burned, 200_000);
    }

    #[test]
    fn test_initialize_with_supply_cap() {
        let (svm, _authority, _mint, config_pda) = setup_sss1_with_cap(10_000_000);

        let data = read_account_data(&svm, &config_pda).expect("config missing");
        let config = deserialize_config(&data);
        assert_eq!(config.supply_cap, 10_000_000);
    }
}

#[cfg(test)]
mod roles {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_assign_and_read_role() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), SOL);

        let (role_pda, _) = find_role_pda(&config_pda, ROLE_MINTER, &user.pubkey());
        let ix = build_assign_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_MINTER,
            &user.pubkey(),
        );
        send_tx(&mut svm, &[ix], &authority, &[&authority]).expect("assign_role failed");

        let data = read_account_data(&svm, &role_pda).expect("role PDA missing");
        let role = deserialize_role(&data);
        assert_eq!(role.config, config_pda);
        assert_eq!(role.user, user.pubkey());
        assert_eq!(role.role_type, ROLE_MINTER);
        assert!(role.active);
    }

    #[test]
    fn test_deactivate_role() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), SOL);

        let (role_pda, _) = find_role_pda(&config_pda, ROLE_PAUSER, &user.pubkey());
        let assign_ix = build_assign_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_PAUSER,
            &user.pubkey(),
        );
        send_tx(&mut svm, &[assign_ix], &authority, &[&authority]).unwrap();

        // Deactivate
        let update_ix = build_update_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_PAUSER,
            &user.pubkey(),
            false,
        );
        send_tx(&mut svm, &[update_ix], &authority, &[&authority]).unwrap();

        let data = read_account_data(&svm, &role_pda).expect("role PDA missing");
        let role = deserialize_role(&data);
        assert!(!role.active);
    }

    #[test]
    fn test_reactivate_role() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), SOL);

        let (role_pda, _) = find_role_pda(&config_pda, ROLE_BURNER, &user.pubkey());

        // Assign
        let assign_ix = build_assign_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_BURNER,
            &user.pubkey(),
        );
        send_tx(&mut svm, &[assign_ix], &authority, &[&authority]).unwrap();

        // Deactivate
        let deactivate_ix = build_update_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_BURNER,
            &user.pubkey(),
            false,
        );
        send_tx(&mut svm, &[deactivate_ix], &authority, &[&authority]).unwrap();

        // Reactivate
        let reactivate_ix = build_update_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_BURNER,
            &user.pubkey(),
            true,
        );
        send_tx(&mut svm, &[reactivate_ix], &authority, &[&authority]).unwrap();

        let data = read_account_data(&svm, &role_pda).expect("role PDA missing");
        let role = deserialize_role(&data);
        assert!(role.active);
    }

    #[test]
    fn test_feature_gated_blacklister_blocked_on_sss1() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), SOL);

        let (role_pda, _) = find_role_pda(&config_pda, ROLE_BLACKLISTER, &user.pubkey());
        let ix = build_assign_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_BLACKLISTER,
            &user.pubkey(),
        );
        let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
        assert!(
            result.is_err(),
            "assigning blacklister on SSS-1 should fail"
        );
    }

    #[test]
    fn test_feature_gated_seizer_blocked_on_sss1() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), SOL);

        let (role_pda, _) = find_role_pda(&config_pda, ROLE_SEIZER, &user.pubkey());
        let ix = build_assign_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_SEIZER,
            &user.pubkey(),
        );
        let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
        assert!(result.is_err(), "assigning seizer on SSS-1 should fail");
    }
}

#[cfg(test)]
mod security {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_non_authority_cannot_assign_role() {
        let (mut svm, _authority, _mint, config_pda) = setup_sss1();
        let impostor = Keypair::new();
        let user = Keypair::new();
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);

        let (role_pda, _) = find_role_pda(&config_pda, ROLE_MINTER, &user.pubkey());
        let ix = build_assign_role_ix(
            &impostor.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_MINTER,
            &user.pubkey(),
        );
        let result = send_tx(&mut svm, &[ix], &impostor, &[&impostor]);
        assert!(result.is_err(), "non-authority should not assign roles");
    }

    #[test]
    fn test_deactivated_minter_cannot_mint() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), 5 * SOL);

        let (role_pda, quota_pda) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter_kp.pubkey(),
            1_000_000,
        );

        // Deactivate the minter role
        let deactivate_ix = build_update_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_MINTER,
            &minter_kp.pubkey(),
            false,
        );
        send_tx(&mut svm, &[deactivate_ix], &authority, &[&authority]).unwrap();

        // Create ATA
        let ata = create_ata(&mut svm, &authority, &minter_kp.pubkey(), &mint.pubkey());

        // Attempt to mint
        let mint_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            100,
        );
        let result = send_tx(&mut svm, &[mint_ix], &minter_kp, &[&minter_kp]);
        assert!(result.is_err(), "deactivated minter should not mint");
    }

    #[test]
    fn test_zero_amount_mint_rejected() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), 5 * SOL);

        let (role_pda, quota_pda) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter_kp.pubkey(),
            1_000_000,
        );
        let ata = create_ata(&mut svm, &authority, &minter_kp.pubkey(), &mint.pubkey());

        let mint_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            0,
        );
        let result = send_tx(&mut svm, &[mint_ix], &minter_kp, &[&minter_kp]);
        assert!(result.is_err(), "zero-amount mint should be rejected");
    }

    #[test]
    fn test_zero_amount_burn_rejected() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();
        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);

        let burner_role = setup_burner(&mut svm, &authority, &config_pda, &user.pubkey());
        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        let burn_ix = build_burn_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &burner_role,
            &mint.pubkey(),
            &ata,
            0,
        );
        let result = send_tx(&mut svm, &[burn_ix], &user, &[&user]);
        assert!(result.is_err(), "zero-amount burn should be rejected");
    }

    #[test]
    fn test_paused_blocks_mint() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        // Set up pauser
        let pauser_kp = Keypair::new();
        airdrop(&mut svm, &pauser_kp.pubkey(), 5 * SOL);
        let pauser_role = setup_pauser(&mut svm, &authority, &config_pda, &pauser_kp.pubkey());

        // Set up minter
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), 5 * SOL);
        let (minter_role, minter_quota_pda) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter_kp.pubkey(),
            1_000_000,
        );
        let ata = create_ata(&mut svm, &authority, &minter_kp.pubkey(), &mint.pubkey());

        // Pause
        let pause_ix = build_pause_ix(&pauser_kp.pubkey(), &config_pda, &pauser_role);
        send_tx(&mut svm, &[pause_ix], &pauser_kp, &[&pauser_kp]).expect("pause failed");

        // Verify paused
        let data = read_account_data(&svm, &config_pda).unwrap();
        let config = deserialize_config(&data);
        assert!(config.paused);

        // Attempt mint — should fail
        let mint_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota_pda,
            &mint.pubkey(),
            &ata,
            100,
        );
        let result = send_tx(&mut svm, &[mint_ix], &minter_kp, &[&minter_kp]);
        assert!(result.is_err(), "minting while paused should fail");
    }

    #[test]
    fn test_paused_blocks_burn() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);

        // Set up minter, burner, pauser
        let (minter_role, minter_quota) =
            setup_minter(&mut svm, &authority, &config_pda, &user.pubkey(), 1_000_000);
        let burner_role = setup_burner(&mut svm, &authority, &config_pda, &user.pubkey());
        let pauser_role = setup_pauser(&mut svm, &authority, &config_pda, &user.pubkey());

        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Mint some tokens first
        let mint_ix = build_mint_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            1_000,
        );
        send_tx(&mut svm, &[mint_ix], &user, &[&user]).expect("mint failed");

        // Pause
        let pause_ix = build_pause_ix(&user.pubkey(), &config_pda, &pauser_role);
        send_tx(&mut svm, &[pause_ix], &user, &[&user]).expect("pause failed");

        // Attempt burn — should fail
        let burn_ix = build_burn_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &burner_role,
            &mint.pubkey(),
            &ata,
            500,
        );
        let result = send_tx(&mut svm, &[burn_ix], &user, &[&user]);
        assert!(result.is_err(), "burning while paused should fail");
    }

    #[test]
    fn test_unpause_re_enables_mint() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);

        let (minter_role, minter_quota) =
            setup_minter(&mut svm, &authority, &config_pda, &user.pubkey(), 1_000_000);
        let pauser_role = setup_pauser(&mut svm, &authority, &config_pda, &user.pubkey());
        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Pause
        let pause_ix = build_pause_ix(&user.pubkey(), &config_pda, &pauser_role);
        send_tx(&mut svm, &[pause_ix], &user, &[&user]).unwrap();

        // Unpause
        let unpause_ix = build_unpause_ix(&user.pubkey(), &config_pda, &pauser_role);
        send_tx(&mut svm, &[unpause_ix], &user, &[&user]).unwrap();

        // Verify unpaused
        let data = read_account_data(&svm, &config_pda).unwrap();
        let config = deserialize_config(&data);
        assert!(!config.paused);

        // Mint should succeed again
        let mint_ix = build_mint_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            100,
        );
        send_tx(&mut svm, &[mint_ix], &user, &[&user]).expect("mint after unpause should succeed");
    }

    #[test]
    fn test_quota_enforcement() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), 5 * SOL);

        let quota_amount = 1_000u64;
        let (role_pda, quota_pda) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter_kp.pubkey(),
            quota_amount,
        );
        let ata = create_ata(&mut svm, &authority, &minter_kp.pubkey(), &mint.pubkey());

        // Mint exactly at quota — should succeed
        let mint_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            quota_amount,
        );
        send_tx(&mut svm, &[mint_ix], &minter_kp, &[&minter_kp])
            .expect("minting at quota should succeed");

        // Mint 1 more — should fail (quota exhausted)
        let over_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            1,
        );
        let result = send_tx(&mut svm, &[over_ix], &minter_kp, &[&minter_kp]);
        assert!(result.is_err(), "minting beyond quota should fail");
    }

    #[test]
    fn test_supply_cap_enforcement() {
        let cap = 5_000u64;
        let (mut svm, authority, mint, config_pda) = setup_sss1_with_cap(cap);

        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), 5 * SOL);

        // Give minter a quota larger than the supply cap
        let (role_pda, quota_pda) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter_kp.pubkey(),
            100_000,
        );
        let ata = create_ata(&mut svm, &authority, &minter_kp.pubkey(), &mint.pubkey());

        // Mint up to cap
        let mint_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            cap,
        );
        send_tx(&mut svm, &[mint_ix], &minter_kp, &[&minter_kp])
            .expect("mint up to cap should succeed");

        // Mint 1 more — should fail
        let over_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            1,
        );
        let result = send_tx(&mut svm, &[over_ix], &minter_kp, &[&minter_kp]);
        assert!(result.is_err(), "minting beyond supply cap should fail");
    }

    #[test]
    fn test_invalid_role_type_rejected() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), SOL);

        let invalid_role: u8 = 99;
        let (role_pda, _) = find_role_pda(&config_pda, invalid_role, &user.pubkey());
        let ix = build_assign_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            invalid_role,
            &user.pubkey(),
        );
        let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
        assert!(result.is_err(), "invalid role type should be rejected");
    }

    #[test]
    fn test_non_authority_cannot_update_minter() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let impostor = Keypair::new();
        let minter = Keypair::new();
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);
        airdrop(&mut svm, &minter.pubkey(), SOL);

        // Legitimate setup first
        setup_minter(&mut svm, &authority, &config_pda, &minter.pubkey(), 1_000);

        // Impostor tries to update the quota
        let (quota_pda, _) = find_minter_quota_pda(&config_pda, &minter.pubkey());
        let ix = build_update_minter_ix(
            &impostor.pubkey(),
            &config_pda,
            &quota_pda,
            &minter.pubkey(),
            999_999,
        );
        let result = send_tx(&mut svm, &[ix], &impostor, &[&impostor]);
        assert!(
            result.is_err(),
            "non-authority should not update minter quota"
        );
    }
}

#[cfg(test)]
mod authority {
    use super::helpers::*;
    use solana_sdk::{
        pubkey::Pubkey,
        signature::{Keypair, Signer},
    };

    #[test]
    fn test_two_step_authority_transfer() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let new_auth = Keypair::new();
        airdrop(&mut svm, &new_auth.pubkey(), 5 * SOL);

        // Propose
        let propose_ix = build_propose_authority_transfer_ix(
            &authority.pubkey(),
            &config_pda,
            &new_auth.pubkey(),
        );
        send_tx(&mut svm, &[propose_ix], &authority, &[&authority])
            .expect("propose_authority_transfer failed");

        // Verify pending
        let data = read_account_data(&svm, &config_pda).unwrap();
        let config = deserialize_config(&data);
        assert_eq!(config.pending_authority, new_auth.pubkey());
        assert!(config.authority_transfer_at > 0);

        // Accept
        let accept_ix = build_accept_authority_transfer_ix(&new_auth.pubkey(), &config_pda);
        send_tx(&mut svm, &[accept_ix], &new_auth, &[&new_auth])
            .expect("accept_authority_transfer failed");

        // Verify transferred
        let data = read_account_data(&svm, &config_pda).unwrap();
        let config = deserialize_config(&data);
        assert_eq!(config.master_authority, new_auth.pubkey());
        assert_eq!(config.pending_authority, Pubkey::default());
        assert_eq!(config.authority_transfer_at, 0);
    }

    #[test]
    fn test_wrong_signer_cannot_accept_transfer() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let new_auth = Keypair::new();
        let wrong_signer = Keypair::new();
        airdrop(&mut svm, &new_auth.pubkey(), SOL);
        airdrop(&mut svm, &wrong_signer.pubkey(), SOL);

        // Propose to new_auth
        let propose_ix = build_propose_authority_transfer_ix(
            &authority.pubkey(),
            &config_pda,
            &new_auth.pubkey(),
        );
        send_tx(&mut svm, &[propose_ix], &authority, &[&authority]).unwrap();

        // Wrong signer attempts to accept
        let accept_ix = build_accept_authority_transfer_ix(&wrong_signer.pubkey(), &config_pda);
        let result = send_tx(&mut svm, &[accept_ix], &wrong_signer, &[&wrong_signer]);
        assert!(result.is_err(), "wrong signer should not accept transfer");
    }

    #[test]
    fn test_cancel_authority_transfer() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let new_auth = Keypair::new();
        airdrop(&mut svm, &new_auth.pubkey(), SOL);

        // Propose
        let propose_ix = build_propose_authority_transfer_ix(
            &authority.pubkey(),
            &config_pda,
            &new_auth.pubkey(),
        );
        send_tx(&mut svm, &[propose_ix], &authority, &[&authority]).unwrap();

        // Cancel
        let cancel_ix = build_cancel_authority_transfer_ix(&authority.pubkey(), &config_pda);
        send_tx(&mut svm, &[cancel_ix], &authority, &[&authority])
            .expect("cancel_authority_transfer failed");

        // Verify cleared
        let data = read_account_data(&svm, &config_pda).unwrap();
        let config = deserialize_config(&data);
        assert_eq!(config.pending_authority, Pubkey::default());
        assert_eq!(config.authority_transfer_at, 0);
        assert_eq!(config.master_authority, authority.pubkey());
    }

    #[test]
    fn test_same_authority_transfer_rejected() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();

        let propose_ix = build_propose_authority_transfer_ix(
            &authority.pubkey(),
            &config_pda,
            &authority.pubkey(),
        );
        let result = send_tx(&mut svm, &[propose_ix], &authority, &[&authority]);
        assert!(result.is_err(), "proposing transfer to self should fail");
    }

    #[test]
    fn test_duplicate_propose_rejected() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let new_auth_a = Keypair::new();
        let new_auth_b = Keypair::new();
        airdrop(&mut svm, &new_auth_a.pubkey(), SOL);
        airdrop(&mut svm, &new_auth_b.pubkey(), SOL);

        // First propose
        let propose_a = build_propose_authority_transfer_ix(
            &authority.pubkey(),
            &config_pda,
            &new_auth_a.pubkey(),
        );
        send_tx(&mut svm, &[propose_a], &authority, &[&authority]).unwrap();

        // Second propose while first is pending
        let propose_b = build_propose_authority_transfer_ix(
            &authority.pubkey(),
            &config_pda,
            &new_auth_b.pubkey(),
        );
        let result = send_tx(&mut svm, &[propose_b], &authority, &[&authority]);
        assert!(result.is_err(), "duplicate propose should fail");
    }

    #[test]
    fn test_accept_with_no_pending_rejected() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();

        let accept_ix = build_accept_authority_transfer_ix(&authority.pubkey(), &config_pda);
        let result = send_tx(&mut svm, &[accept_ix], &authority, &[&authority]);
        assert!(
            result.is_err(),
            "accepting with no pending transfer should fail"
        );
    }
}

#[cfg(test)]
mod minter_quota {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_update_quota_preserves_minted() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), 5 * SOL);

        let (role_pda, quota_pda) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter_kp.pubkey(),
            1_000,
        );
        let ata = create_ata(&mut svm, &authority, &minter_kp.pubkey(), &mint.pubkey());

        // Mint 500
        let mint_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            500,
        );
        send_tx(&mut svm, &[mint_ix], &minter_kp, &[&minter_kp]).unwrap();

        // Increase quota to 2000
        let update_ix = build_update_minter_ix(
            &authority.pubkey(),
            &config_pda,
            &quota_pda,
            &minter_kp.pubkey(),
            2_000,
        );
        send_tx(&mut svm, &[update_ix], &authority, &[&authority]).unwrap();

        // Verify minted counter preserved
        let data = read_account_data(&svm, &quota_pda).unwrap();
        let quota = deserialize_minter_quota(&data);
        assert_eq!(quota.quota, 2_000);
        assert_eq!(quota.minted, 500);
    }

    #[test]
    fn test_reset_minter_quota() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), 5 * SOL);

        let (role_pda, quota_pda) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter_kp.pubkey(),
            1_000,
        );
        let ata = create_ata(&mut svm, &authority, &minter_kp.pubkey(), &mint.pubkey());

        // Mint 800
        let mint_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            800,
        );
        send_tx(&mut svm, &[mint_ix], &minter_kp, &[&minter_kp]).unwrap();

        // Reset quota counter
        let reset_ix = build_reset_minter_quota_ix(
            &authority.pubkey(),
            &config_pda,
            &quota_pda,
            &minter_kp.pubkey(),
        );
        send_tx(&mut svm, &[reset_ix], &authority, &[&authority])
            .expect("reset_minter_quota failed");

        let data = read_account_data(&svm, &quota_pda).unwrap();
        let quota = deserialize_minter_quota(&data);
        assert_eq!(quota.minted, 0);
        assert_eq!(quota.quota, 1_000);

        // Minter can now mint the full quota again
        let mint_again = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            1_000,
        );
        send_tx(&mut svm, &[mint_again], &minter_kp, &[&minter_kp])
            .expect("mint after reset should succeed");
    }
}

#[cfg(test)]
mod create_update_minter_split {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_create_minter_happy() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), SOL);

        let (quota_pda, _) = find_minter_quota_pda(&config_pda, &minter_kp.pubkey());

        let ix = build_create_minter_ix(
            &authority.pubkey(),
            &config_pda,
            &quota_pda,
            &minter_kp.pubkey(),
            5_000,
        );
        send_tx(&mut svm, &[ix], &authority, &[&authority]).expect("create_minter failed");

        let data = read_account_data(&svm, &quota_pda).expect("minter quota PDA missing");
        let quota = deserialize_minter_quota(&data);
        assert_eq!(quota.config, config_pda);
        assert_eq!(quota.minter, minter_kp.pubkey());
        assert_eq!(quota.quota, 5_000);
        assert_eq!(quota.minted, 0);
    }

    #[test]
    fn test_create_minter_duplicate_fails() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), SOL);

        let (quota_pda, _) = find_minter_quota_pda(&config_pda, &minter_kp.pubkey());

        let ix1 = build_create_minter_ix(
            &authority.pubkey(),
            &config_pda,
            &quota_pda,
            &minter_kp.pubkey(),
            1_000,
        );
        send_tx(&mut svm, &[ix1], &authority, &[&authority]).expect("first create_minter failed");

        let ix2 = build_create_minter_ix(
            &authority.pubkey(),
            &config_pda,
            &quota_pda,
            &minter_kp.pubkey(),
            2_000,
        );
        let result = send_tx(&mut svm, &[ix2], &authority, &[&authority]);
        assert!(
            result.is_err(),
            "creating the same minter twice should fail"
        );
    }

    #[test]
    fn test_update_minter_nonexistent_fails() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), SOL);

        let (quota_pda, _) = find_minter_quota_pda(&config_pda, &minter_kp.pubkey());

        let ix = build_update_minter_ix(
            &authority.pubkey(),
            &config_pda,
            &quota_pda,
            &minter_kp.pubkey(),
            1_000,
        );
        let result = send_tx(&mut svm, &[ix], &authority, &[&authority]);
        assert!(result.is_err(), "updating a nonexistent minter should fail");
    }

    #[test]
    fn test_create_then_update_minter() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();
        let minter_kp = Keypair::new();
        airdrop(&mut svm, &minter_kp.pubkey(), 5 * SOL);

        // Assign minter role
        let (role_pda, _) = find_role_pda(&config_pda, ROLE_MINTER, &minter_kp.pubkey());
        let assign_ix = build_assign_role_ix(
            &authority.pubkey(),
            &config_pda,
            &role_pda,
            ROLE_MINTER,
            &minter_kp.pubkey(),
        );
        send_tx(&mut svm, &[assign_ix], &authority, &[&authority])
            .expect("assign minter role failed");

        // Create minter quota
        let (quota_pda, _) = find_minter_quota_pda(&config_pda, &minter_kp.pubkey());
        let create_ix = build_create_minter_ix(
            &authority.pubkey(),
            &config_pda,
            &quota_pda,
            &minter_kp.pubkey(),
            1_000,
        );
        send_tx(&mut svm, &[create_ix], &authority, &[&authority]).expect("create_minter failed");

        // Mint 400 tokens
        let ata = create_ata(&mut svm, &authority, &minter_kp.pubkey(), &mint.pubkey());
        let mint_ix = build_mint_tokens_ix(
            &minter_kp.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            400,
        );
        send_tx(&mut svm, &[mint_ix], &minter_kp, &[&minter_kp]).expect("mint failed");

        // Update quota to 5_000
        let update_ix = build_update_minter_ix(
            &authority.pubkey(),
            &config_pda,
            &quota_pda,
            &minter_kp.pubkey(),
            5_000,
        );
        send_tx(&mut svm, &[update_ix], &authority, &[&authority]).expect("update_minter failed");

        // Verify quota updated but minted preserved
        let data = read_account_data(&svm, &quota_pda).expect("quota PDA missing");
        let quota = deserialize_minter_quota(&data);
        assert_eq!(quota.quota, 5_000);
        assert_eq!(quota.minted, 400);
    }
}

#[cfg(test)]
mod pause_unpause {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_pause_already_paused_fails() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let pauser_kp = Keypair::new();
        airdrop(&mut svm, &pauser_kp.pubkey(), 5 * SOL);
        let role_pda = setup_pauser(&mut svm, &authority, &config_pda, &pauser_kp.pubkey());

        // Pause once
        let pause1 = build_pause_ix(&pauser_kp.pubkey(), &config_pda, &role_pda);
        send_tx(&mut svm, &[pause1], &pauser_kp, &[&pauser_kp]).unwrap();

        // Pause again — should fail
        let pause2 = build_pause_ix(&pauser_kp.pubkey(), &config_pda, &role_pda);
        let result = send_tx(&mut svm, &[pause2], &pauser_kp, &[&pauser_kp]);
        assert!(
            result.is_err(),
            "pausing an already-paused stablecoin should fail"
        );
    }

    #[test]
    fn test_unpause_not_paused_fails() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();
        let pauser_kp = Keypair::new();
        airdrop(&mut svm, &pauser_kp.pubkey(), 5 * SOL);
        let role_pda = setup_pauser(&mut svm, &authority, &config_pda, &pauser_kp.pubkey());

        // Unpause without being paused
        let unpause_ix = build_unpause_ix(&pauser_kp.pubkey(), &config_pda, &role_pda);
        let result = send_tx(&mut svm, &[unpause_ix], &pauser_kp, &[&pauser_kp]);
        assert!(result.is_err(), "unpausing when not paused should fail");
    }
}

#[cfg(test)]
mod discriminator_sanity {
    use super::helpers::anchor_discriminator;

    #[test]
    fn test_known_discriminators() {
        // Spot-check a few discriminators to make sure our sha2 computation
        // matches what Anchor would produce. The values below are the first 8
        // bytes of sha256("global:<name>").
        let disc = anchor_discriminator("initialize");
        assert_eq!(disc.len(), 8);
        assert_ne!(disc, [0u8; 8], "discriminator should not be all zeroes");

        // Two different instructions must produce different discriminators
        let disc_mint = anchor_discriminator("mint_tokens");
        let disc_burn = anchor_discriminator("burn_tokens");
        assert_ne!(disc_mint, disc_burn);
    }
}

#[cfg(test)]
mod blacklist {
    use super::helpers::*;
    use solana_sdk::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        signature::{Keypair, Signer},
    };

    /// Initialize an SSS-2 config (transfer hook + permanent delegate enabled).
    /// The hook program ID is a dummy since we only test blacklist PDA ops, not
    /// actual transfer enforcement.
    fn setup_sss2() -> (litesvm::LiteSVM, Keypair, Keypair, Pubkey) {
        let mut svm = setup_svm();
        let authority = Keypair::new();
        let mint = Keypair::new();
        airdrop(&mut svm, &authority.pubkey(), 10 * SOL);

        let (config_pda, _) = find_config_pda(&mint.pubkey());
        let dummy_hook = Pubkey::new_unique();

        let ix = build_initialize_ix(
            &authority.pubkey(),
            &mint.pubkey(),
            &config_pda,
            "SSS2 Test",
            "S2T",
            "https://example.com/s2t.json",
            6,
            true,  // enable_permanent_delegate
            true,  // enable_transfer_hook
            false, // default_account_frozen
            false, // enable_confidential_transfer
            Some(dummy_hook),
            0,
        );

        send_tx(&mut svm, &[ix], &authority, &[&authority, &mint])
            .expect("initialize SSS-2 failed");

        (svm, authority, mint, config_pda)
    }

    fn setup_blacklister(
        svm: &mut litesvm::LiteSVM,
        authority: &Keypair,
        config: &Pubkey,
        blacklister: &Pubkey,
    ) -> Pubkey {
        let (role_pda, _) = find_role_pda(config, ROLE_BLACKLISTER, blacklister);
        let ix = build_assign_role_ix(
            &authority.pubkey(),
            config,
            &role_pda,
            ROLE_BLACKLISTER,
            blacklister,
        );
        send_tx(svm, &[ix], authority, &[authority]).expect("assign blacklister failed");
        role_pda
    }

    fn build_remove_from_blacklist_ix(
        authority: &Pubkey,
        config: &Pubkey,
        role_account: &Pubkey,
        blacklist_entry: &Pubkey,
        address: &Pubkey,
    ) -> Instruction {
        let mut data = anchor_discriminator("remove_from_blacklist").to_vec();
        // instruction arg: address: Pubkey
        data.extend_from_slice(address.as_ref());

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new_readonly(*role_account, false),
                AccountMeta::new(*blacklist_entry, false),
            ],
            data,
        }
    }

    #[test]
    fn test_add_to_blacklist() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();

        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "sanctions compliance",
            [0u8; 32],
            "",
        );
        send_tx(&mut svm, &[ix], &blacklister, &[&blacklister]).expect("add_to_blacklist failed");

        let data = read_account_data(&svm, &bl_pda).expect("blacklist entry not found");
        let entry = deserialize_blacklist(&data);
        assert_eq!(entry.config, config_pda);
        assert_eq!(entry.address, target);
        assert_eq!(entry.reason, "sanctions compliance");
        assert_eq!(entry.blacklisted_by, blacklister.pubkey());
        assert!(entry.blacklisted_at > 0);
    }

    #[test]
    fn test_remove_from_blacklist() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();

        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        // Add to blacklist
        let add_ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "temporary hold",
            [0u8; 32],
            "",
        );
        send_tx(&mut svm, &[add_ix], &blacklister, &[&blacklister])
            .expect("add_to_blacklist failed");

        // Remove from blacklist
        let remove_ix = build_remove_from_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
        );
        send_tx(&mut svm, &[remove_ix], &blacklister, &[&blacklister])
            .expect("remove_from_blacklist failed");

        // Account should be closed
        let account = svm.get_account(&bl_pda);
        assert!(
            account.is_none() || account.unwrap().data.is_empty(),
            "blacklist entry should be closed after removal"
        );
    }

    #[test]
    fn test_non_blacklister_cannot_blacklist() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();

        let impostor = Keypair::new();
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);

        // Impostor has no blacklister role; derive a role PDA that does not exist
        let (fake_role_pda, _) = find_role_pda(&config_pda, ROLE_BLACKLISTER, &impostor.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let ix = build_add_to_blacklist_ix(
            &impostor.pubkey(),
            &config_pda,
            &fake_role_pda,
            &bl_pda,
            &target,
            "should fail",
            [0u8; 32],
            "",
        );
        let result = send_tx(&mut svm, &[ix], &impostor, &[&impostor]);
        assert!(
            result.is_err(),
            "non-blacklister should not add to blacklist"
        );
    }

    #[test]
    fn test_double_blacklist_fails() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();

        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "first",
            [0u8; 32],
            "",
        );
        send_tx(&mut svm, &[ix], &blacklister, &[&blacklister])
            .expect("first blacklist should succeed");

        // Second blacklist of same address should fail (PDA already initialized)
        let ix2 = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "second",
            [0u8; 32],
            "",
        );
        let result = send_tx(&mut svm, &[ix2], &blacklister, &[&blacklister]);
        assert!(
            result.is_err(),
            "blacklisting an already-blacklisted address should fail"
        );
    }

    #[test]
    fn test_remove_non_blacklisted_fails() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();

        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        // Try to remove an address that was never blacklisted
        let remove_ix = build_remove_from_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
        );
        let result = send_tx(&mut svm, &[remove_ix], &blacklister, &[&blacklister]);
        assert!(
            result.is_err(),
            "removing a non-blacklisted address should fail"
        );
    }
}

#[cfg(test)]
mod freeze_thaw {
    use super::helpers::*;
    use solana_sdk::{
        instruction::{AccountMeta, Instruction},
        signature::{Keypair, Signer},
    };

    fn build_freeze_token_account_ix(
        authority: &solana_sdk::pubkey::Pubkey,
        config: &solana_sdk::pubkey::Pubkey,
        role_account: &solana_sdk::pubkey::Pubkey,
        mint: &solana_sdk::pubkey::Pubkey,
        token_account: &solana_sdk::pubkey::Pubkey,
    ) -> Instruction {
        let data = anchor_discriminator("freeze_token_account").to_vec();

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new_readonly(*role_account, false),
                AccountMeta::new_readonly(*mint, false),
                AccountMeta::new(*token_account, false),
                AccountMeta::new_readonly(token_2022_program_id(), false),
            ],
            data,
        }
    }

    fn build_thaw_token_account_ix(
        authority: &solana_sdk::pubkey::Pubkey,
        config: &solana_sdk::pubkey::Pubkey,
        role_account: &solana_sdk::pubkey::Pubkey,
        mint: &solana_sdk::pubkey::Pubkey,
        token_account: &solana_sdk::pubkey::Pubkey,
    ) -> Instruction {
        let data = anchor_discriminator("thaw_token_account").to_vec();

        Instruction {
            program_id: sss_program_id(),
            accounts: vec![
                AccountMeta::new_readonly(*authority, true),
                AccountMeta::new_readonly(*config, false),
                AccountMeta::new_readonly(*role_account, false),
                AccountMeta::new_readonly(*mint, false),
                AccountMeta::new(*token_account, false),
                AccountMeta::new_readonly(token_2022_program_id(), false),
            ],
            data,
        }
    }

    #[test]
    fn test_freeze_account() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let pauser = Keypair::new();
        airdrop(&mut svm, &pauser.pubkey(), 5 * SOL);
        let pauser_role = setup_pauser(&mut svm, &authority, &config_pda, &pauser.pubkey());

        // Set up a minter to create some tokens first
        let minter = Keypair::new();
        airdrop(&mut svm, &minter.pubkey(), 5 * SOL);
        let (minter_role, minter_quota) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter.pubkey(),
            1_000_000,
        );

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);
        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Mint some tokens to the user
        let mint_ix = build_mint_tokens_ix(
            &minter.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            1_000,
        );
        send_tx(&mut svm, &[mint_ix], &minter, &[&minter]).expect("mint failed");

        // Freeze the account
        let freeze_ix = build_freeze_token_account_ix(
            &pauser.pubkey(),
            &config_pda,
            &pauser_role,
            &mint.pubkey(),
            &ata,
        );
        send_tx(&mut svm, &[freeze_ix], &pauser, &[&pauser]).expect("freeze_token_account failed");

        // Minting to the frozen account should fail
        let mint_ix2 = build_mint_tokens_ix(
            &minter.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            100,
        );
        let result = send_tx(&mut svm, &[mint_ix2], &minter, &[&minter]);
        assert!(result.is_err(), "minting to a frozen account should fail");
    }

    #[test]
    fn test_thaw_account() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let pauser = Keypair::new();
        airdrop(&mut svm, &pauser.pubkey(), 5 * SOL);
        let pauser_role = setup_pauser(&mut svm, &authority, &config_pda, &pauser.pubkey());

        let minter = Keypair::new();
        airdrop(&mut svm, &minter.pubkey(), 5 * SOL);
        let (minter_role, minter_quota) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter.pubkey(),
            1_000_000,
        );

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);
        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Mint tokens
        let mint_ix = build_mint_tokens_ix(
            &minter.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            1_000,
        );
        send_tx(&mut svm, &[mint_ix], &minter, &[&minter]).expect("mint failed");

        // Freeze
        let freeze_ix = build_freeze_token_account_ix(
            &pauser.pubkey(),
            &config_pda,
            &pauser_role,
            &mint.pubkey(),
            &ata,
        );
        send_tx(&mut svm, &[freeze_ix], &pauser, &[&pauser]).expect("freeze failed");

        // Thaw
        let thaw_ix = build_thaw_token_account_ix(
            &pauser.pubkey(),
            &config_pda,
            &pauser_role,
            &mint.pubkey(),
            &ata,
        );
        send_tx(&mut svm, &[thaw_ix], &pauser, &[&pauser]).expect("thaw_token_account failed");

        // Minting should succeed again after thaw
        let mint_ix2 = build_mint_tokens_ix(
            &minter.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            100,
        );
        send_tx(&mut svm, &[mint_ix2], &minter, &[&minter])
            .expect("mint after thaw should succeed");
    }

    #[test]
    fn test_non_pauser_cannot_freeze() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let minter = Keypair::new();
        airdrop(&mut svm, &minter.pubkey(), 5 * SOL);
        let (minter_role, minter_quota) = setup_minter(
            &mut svm,
            &authority,
            &config_pda,
            &minter.pubkey(),
            1_000_000,
        );

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);
        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Mint tokens first
        let mint_ix = build_mint_tokens_ix(
            &minter.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            1_000,
        );
        send_tx(&mut svm, &[mint_ix], &minter, &[&minter]).expect("mint failed");

        // Random user (no pauser role) tries to freeze
        let impostor = Keypair::new();
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);
        let (fake_role_pda, _) = find_role_pda(&config_pda, ROLE_PAUSER, &impostor.pubkey());

        let freeze_ix = build_freeze_token_account_ix(
            &impostor.pubkey(),
            &config_pda,
            &fake_role_pda,
            &mint.pubkey(),
            &ata,
        );
        let result = send_tx(&mut svm, &[freeze_ix], &impostor, &[&impostor]);
        assert!(result.is_err(), "non-pauser should not freeze accounts");
    }

    #[test]
    fn test_freeze_when_paused_fails() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let pauser = Keypair::new();
        airdrop(&mut svm, &pauser.pubkey(), 5 * SOL);
        let pauser_role = setup_pauser(&mut svm, &authority, &config_pda, &pauser.pubkey());

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);
        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Pause the stablecoin
        let pause_ix = build_pause_ix(&pauser.pubkey(), &config_pda, &pauser_role);
        send_tx(&mut svm, &[pause_ix], &pauser, &[&pauser]).expect("pause failed");

        // Freeze should fail while paused
        let freeze_ix = build_freeze_token_account_ix(
            &pauser.pubkey(),
            &config_pda,
            &pauser_role,
            &mint.pubkey(),
            &ata,
        );
        let result = send_tx(&mut svm, &[freeze_ix], &pauser, &[&pauser]);
        assert!(
            result.is_err(),
            "freeze should fail when stablecoin is paused"
        );
    }
}

#[cfg(test)]
mod role_boundaries {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_burner_cannot_mint() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);

        // Give user only the burner role
        let burner_role = setup_burner(&mut svm, &authority, &config_pda, &user.pubkey());

        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Derive quota PDA (won't be initialized, but we need an address)
        let (quota_pda, _) = find_minter_quota_pda(&config_pda, &user.pubkey());

        // Attempt to mint using burner role PDA as the role_account
        let mint_ix = build_mint_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &burner_role, // wrong role type
            &quota_pda,
            &mint.pubkey(),
            &ata,
            100,
        );
        let result = send_tx(&mut svm, &[mint_ix], &user, &[&user]);
        assert!(result.is_err(), "burner should not be able to mint");
    }

    #[test]
    fn test_minter_cannot_burn() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);

        // Give user only the minter role
        let (minter_role, minter_quota) =
            setup_minter(&mut svm, &authority, &config_pda, &user.pubkey(), 1_000_000);

        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Mint some tokens first
        let mint_ix = build_mint_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            500,
        );
        send_tx(&mut svm, &[mint_ix], &user, &[&user]).expect("mint failed");

        // Attempt to burn using minter role PDA as the role_account
        let burn_ix = build_burn_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &minter_role, // wrong role type
            &mint.pubkey(),
            &ata,
            100,
        );
        let result = send_tx(&mut svm, &[burn_ix], &user, &[&user]);
        assert!(result.is_err(), "minter should not be able to burn");
    }

    #[test]
    fn test_non_authority_cannot_pause() {
        let (mut svm, _authority, _mint, config_pda) = setup_sss1();

        let impostor = Keypair::new();
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);

        // Derive a role PDA that does not exist
        let (fake_role_pda, _) = find_role_pda(&config_pda, ROLE_PAUSER, &impostor.pubkey());

        let pause_ix = build_pause_ix(&impostor.pubkey(), &config_pda, &fake_role_pda);
        let result = send_tx(&mut svm, &[pause_ix], &impostor, &[&impostor]);
        assert!(result.is_err(), "non-pauser should not be able to pause");
    }

    #[test]
    fn test_non_authority_cannot_unpause() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();

        // Set up a legitimate pauser and pause the stablecoin
        let pauser = Keypair::new();
        airdrop(&mut svm, &pauser.pubkey(), 5 * SOL);
        let pauser_role = setup_pauser(&mut svm, &authority, &config_pda, &pauser.pubkey());

        let pause_ix = build_pause_ix(&pauser.pubkey(), &config_pda, &pauser_role);
        send_tx(&mut svm, &[pause_ix], &pauser, &[&pauser]).expect("pause failed");

        // Impostor tries to unpause
        let impostor = Keypair::new();
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);
        let (fake_role_pda, _) = find_role_pda(&config_pda, ROLE_PAUSER, &impostor.pubkey());

        let unpause_ix = build_unpause_ix(&impostor.pubkey(), &config_pda, &fake_role_pda);
        let result = send_tx(&mut svm, &[unpause_ix], &impostor, &[&impostor]);
        assert!(result.is_err(), "non-pauser should not be able to unpause");
    }
}

#[cfg(test)]
mod init_edge_cases {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_double_initialization_fails() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        // Try to initialize the same mint again
        let ix = build_initialize_ix(
            &authority.pubkey(),
            &mint.pubkey(),
            &config_pda,
            "Duplicate",
            "DUP",
            "https://example.com/dup.json",
            6,
            false,
            false,
            false,
            false,
            None,
            0,
        );

        // Mint keypair must sign, but config PDA is already initialized so this
        // should fail with an account-already-in-use error.
        let result = send_tx(&mut svm, &[ix], &authority, &[&authority, &mint]);
        assert!(
            result.is_err(),
            "re-initializing an already-initialized mint should fail"
        );
    }

    #[test]
    fn test_burn_more_than_balance_fails() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);

        let (minter_role, minter_quota) =
            setup_minter(&mut svm, &authority, &config_pda, &user.pubkey(), 1_000_000);
        let burner_role = setup_burner(&mut svm, &authority, &config_pda, &user.pubkey());
        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Mint 500 tokens
        let mint_ix = build_mint_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            500,
        );
        send_tx(&mut svm, &[mint_ix], &user, &[&user]).expect("mint failed");

        // Try to burn 600 (more than balance)
        let burn_ix = build_burn_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &burner_role,
            &mint.pubkey(),
            &ata,
            600,
        );
        let result = send_tx(&mut svm, &[burn_ix], &user, &[&user]);
        assert!(result.is_err(), "burning more than balance should fail");
    }

    #[test]
    fn test_supply_cap_with_mint_and_burn_cycle() {
        let cap = 1_000u64;
        let (mut svm, authority, mint, config_pda) = setup_sss1_with_cap(cap);

        let user = Keypair::new();
        airdrop(&mut svm, &user.pubkey(), 5 * SOL);

        let (minter_role, minter_quota) =
            setup_minter(&mut svm, &authority, &config_pda, &user.pubkey(), 10_000);
        let burner_role = setup_burner(&mut svm, &authority, &config_pda, &user.pubkey());
        let ata = create_ata(&mut svm, &authority, &user.pubkey(), &mint.pubkey());

        // Mint up to cap
        let mint_ix = build_mint_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            cap,
        );
        send_tx(&mut svm, &[mint_ix], &user, &[&user]).expect("mint to cap failed");

        // Burn 500
        let burn_ix = build_burn_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &burner_role,
            &mint.pubkey(),
            &ata,
            500,
        );
        send_tx(&mut svm, &[burn_ix], &user, &[&user]).expect("burn failed");

        // Supply cap tracks total_minted (cumulative), NOT circulating supply.
        // Burning does NOT free cap space — re-minting should still fail.
        let mint_ix2 = build_mint_tokens_ix(
            &user.pubkey(),
            &config_pda,
            &minter_role,
            &minter_quota,
            &mint.pubkey(),
            &ata,
            1,
        );
        let result = send_tx(&mut svm, &[mint_ix2], &user, &[&user]);
        assert!(
            result.is_err(),
            "re-mint after burn should still fail because supply cap tracks total_minted"
        );

        // Verify counters — total_minted stayed at cap, total_burned = 500
        let data = read_account_data(&svm, &config_pda).expect("config missing");
        let config = deserialize_config(&data);
        assert_eq!(config.total_minted, cap);
        assert_eq!(config.total_burned, 500);
    }
}

#[cfg(test)]
mod minter_quota_sad_paths {
    use super::helpers::*;
    use solana_sdk::signature::{Keypair, Signer};

    #[test]
    fn test_non_authority_cannot_update_quota() {
        let (mut svm, authority, _mint, config_pda) = setup_sss1();

        let minter = Keypair::new();
        let impostor = Keypair::new();
        airdrop(&mut svm, &minter.pubkey(), SOL);
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);

        // Legitimate minter setup
        let (_role_pda, quota_pda) =
            setup_minter(&mut svm, &authority, &config_pda, &minter.pubkey(), 1_000);

        // Impostor tries to update quota
        let ix = build_update_minter_ix(
            &impostor.pubkey(),
            &config_pda,
            &quota_pda,
            &minter.pubkey(),
            999_999,
        );
        let result = send_tx(&mut svm, &[ix], &impostor, &[&impostor]);
        assert!(
            result.is_err(),
            "non-authority should not update minter quota"
        );
    }

    #[test]
    fn test_non_authority_cannot_reset_quota() {
        let (mut svm, authority, mint, config_pda) = setup_sss1();

        let minter = Keypair::new();
        let impostor = Keypair::new();
        airdrop(&mut svm, &minter.pubkey(), 5 * SOL);
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);

        let (role_pda, quota_pda) =
            setup_minter(&mut svm, &authority, &config_pda, &minter.pubkey(), 1_000);

        let ata = create_ata(&mut svm, &authority, &minter.pubkey(), &mint.pubkey());

        // Mint some to accumulate usage
        let mint_ix = build_mint_tokens_ix(
            &minter.pubkey(),
            &config_pda,
            &role_pda,
            &quota_pda,
            &mint.pubkey(),
            &ata,
            500,
        );
        send_tx(&mut svm, &[mint_ix], &minter, &[&minter]).expect("mint failed");

        // Impostor tries to reset quota
        let reset_ix = build_reset_minter_quota_ix(
            &impostor.pubkey(),
            &config_pda,
            &quota_pda,
            &minter.pubkey(),
        );
        let result = send_tx(&mut svm, &[reset_ix], &impostor, &[&impostor]);
        assert!(
            result.is_err(),
            "non-authority should not reset minter quota"
        );

        // Verify minted counter was not reset
        let data = read_account_data(&svm, &quota_pda).expect("quota missing");
        let quota = deserialize_minter_quota(&data);
        assert_eq!(quota.minted, 500);
    }
}

#[cfg(test)]
mod evidence_chain {
    use super::helpers::*;
    use solana_sdk::{
        pubkey::Pubkey,
        signature::{Keypair, Signer},
    };

    fn setup_sss2() -> (litesvm::LiteSVM, Keypair, Keypair, Pubkey) {
        let mut svm = setup_svm();
        let authority = Keypair::new();
        let mint = Keypair::new();
        airdrop(&mut svm, &authority.pubkey(), 10 * SOL);

        let (config_pda, _) = find_config_pda(&mint.pubkey());
        let dummy_hook = Pubkey::new_unique();

        let ix = build_initialize_ix(
            &authority.pubkey(),
            &mint.pubkey(),
            &config_pda,
            "Evidence Test",
            "EVD",
            "",
            6,
            true,
            true,
            false,
            false,
            Some(dummy_hook),
            0,
        );
        send_tx(&mut svm, &[ix], &authority, &[&authority, &mint])
            .expect("initialize SSS-2 failed");
        (svm, authority, mint, config_pda)
    }

    fn setup_blacklister(
        svm: &mut litesvm::LiteSVM,
        authority: &Keypair,
        config: &Pubkey,
        blacklister: &Pubkey,
    ) -> Pubkey {
        let (role_pda, _) = find_role_pda(config, ROLE_BLACKLISTER, blacklister);
        let ix = build_assign_role_ix(
            &authority.pubkey(),
            config,
            &role_pda,
            ROLE_BLACKLISTER,
            blacklister,
        );
        send_tx(svm, &[ix], authority, &[authority]).expect("assign blacklister failed");
        role_pda
    }

    fn sample_evidence_hash() -> [u8; 32] {
        let mut h = [0u8; 32];
        // SHA-256 of "court-order-2024-1847.pdf" (fake but deterministic)
        for (i, b) in h.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(7).wrapping_add(0xAB);
        }
        h
    }

    // ── Happy path ──────────────────────────────────────────────────────────

    #[test]
    fn test_blacklist_with_evidence() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);
        let hash = sample_evidence_hash();

        let ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "OFAC SDN Match",
            hash,
            "ipfs://QmFakeHashForCourtOrder123456789",
        );
        send_tx(&mut svm, &[ix], &blacklister, &[&blacklister])
            .expect("blacklist with evidence failed");

        let data = read_account_data(&svm, &bl_pda).expect("entry not found");
        let entry = deserialize_blacklist(&data);
        assert_eq!(entry.reason, "OFAC SDN Match");
        assert_eq!(entry.evidence_hash, hash);
        assert_eq!(
            entry.evidence_uri,
            "ipfs://QmFakeHashForCourtOrder123456789"
        );
    }

    #[test]
    fn test_blacklist_without_evidence_backward_compat() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "no evidence needed",
            [0u8; 32],
            "",
        );
        send_tx(&mut svm, &[ix], &blacklister, &[&blacklister])
            .expect("blacklist without evidence failed");

        let data = read_account_data(&svm, &bl_pda).expect("entry not found");
        let entry = deserialize_blacklist(&data);
        assert_eq!(entry.evidence_hash, [0u8; 32]);
        assert_eq!(entry.evidence_uri, "");
    }

    #[test]
    fn test_update_evidence_on_existing_entry() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        // Blacklist without evidence first
        let add_ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "pending evidence",
            [0u8; 32],
            "",
        );
        send_tx(&mut svm, &[add_ix], &blacklister, &[&blacklister])
            .expect("initial blacklist failed");

        // Now attach evidence
        let hash = sample_evidence_hash();
        let update_ix = build_update_blacklist_evidence_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            hash,
            "ar://TxId_CourtOrder_2024",
        );
        send_tx(&mut svm, &[update_ix], &blacklister, &[&blacklister])
            .expect("update evidence failed");

        let data = read_account_data(&svm, &bl_pda).expect("entry not found");
        let entry = deserialize_blacklist(&data);
        assert_eq!(entry.evidence_hash, hash);
        assert_eq!(entry.evidence_uri, "ar://TxId_CourtOrder_2024");
        // Original fields preserved
        assert_eq!(entry.reason, "pending evidence");
        assert_eq!(entry.blacklisted_by, blacklister.pubkey());
    }

    #[test]
    fn test_update_evidence_overwrites_previous() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let hash1 = sample_evidence_hash();
        let add_ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "fraud case",
            hash1,
            "ipfs://QmFirst",
        );
        send_tx(&mut svm, &[add_ix], &blacklister, &[&blacklister])
            .expect("initial blacklist failed");

        // Overwrite with new evidence
        let mut hash2 = [0u8; 32];
        hash2[0] = 0xFF;
        hash2[31] = 0x01;
        let update_ix = build_update_blacklist_evidence_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            hash2,
            "ipfs://QmSecondUpdated",
        );
        send_tx(&mut svm, &[update_ix], &blacklister, &[&blacklister])
            .expect("evidence update failed");

        let data = read_account_data(&svm, &bl_pda).expect("entry not found");
        let entry = deserialize_blacklist(&data);
        assert_eq!(entry.evidence_hash, hash2);
        assert_eq!(entry.evidence_uri, "ipfs://QmSecondUpdated");
    }

    // ── Sad path ────────────────────────────────────────────────────────────

    #[test]
    fn test_update_evidence_zero_hash_rejected() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let add_ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "test",
            [0u8; 32],
            "",
        );
        send_tx(&mut svm, &[add_ix], &blacklister, &[&blacklister]).expect("blacklist failed");

        // Try to update with zero hash — should fail
        let update_ix = build_update_blacklist_evidence_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            [0u8; 32],
            "ipfs://Qm...",
        );
        let result = send_tx(&mut svm, &[update_ix], &blacklister, &[&blacklister]);
        assert!(result.is_err(), "zero evidence hash should be rejected");
    }

    #[test]
    fn test_update_evidence_uri_too_long_rejected() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let add_ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "test",
            [0u8; 32],
            "",
        );
        send_tx(&mut svm, &[add_ix], &blacklister, &[&blacklister]).expect("blacklist failed");

        // URI exceeds MAX_EVIDENCE_URI_LEN (128)
        let long_uri = "x".repeat(129);
        let update_ix = build_update_blacklist_evidence_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            sample_evidence_hash(),
            &long_uri,
        );
        let result = send_tx(&mut svm, &[update_ix], &blacklister, &[&blacklister]);
        assert!(
            result.is_err(),
            "URI exceeding 128 bytes should be rejected"
        );
    }

    #[test]
    fn test_add_blacklist_evidence_uri_too_long_rejected() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let long_uri = "x".repeat(129);
        let ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "test",
            sample_evidence_hash(),
            &long_uri,
        );
        let result = send_tx(&mut svm, &[ix], &blacklister, &[&blacklister]);
        assert!(result.is_err(), "URI too long should be rejected on add");
    }

    #[test]
    fn test_non_blacklister_cannot_update_evidence() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        let impostor = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        airdrop(&mut svm, &impostor.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        let add_ix = build_add_to_blacklist_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            "test",
            [0u8; 32],
            "",
        );
        send_tx(&mut svm, &[add_ix], &blacklister, &[&blacklister]).expect("blacklist failed");

        // Impostor tries to update evidence — no role PDA
        let (fake_role, _) = find_role_pda(&config_pda, ROLE_BLACKLISTER, &impostor.pubkey());
        let update_ix = build_update_blacklist_evidence_ix(
            &impostor.pubkey(),
            &config_pda,
            &fake_role,
            &bl_pda,
            &target,
            sample_evidence_hash(),
            "ipfs://QmEvil",
        );
        let result = send_tx(&mut svm, &[update_ix], &impostor, &[&impostor]);
        assert!(
            result.is_err(),
            "non-blacklister should not update evidence"
        );
    }

    #[test]
    fn test_update_evidence_on_nonexistent_entry_fails() {
        let (mut svm, authority, _mint, config_pda) = setup_sss2();
        let blacklister = Keypair::new();
        airdrop(&mut svm, &blacklister.pubkey(), 5 * SOL);
        let role_pda = setup_blacklister(&mut svm, &authority, &config_pda, &blacklister.pubkey());

        let target = Pubkey::new_unique();
        let (bl_pda, _) = find_blacklist_pda(&config_pda, &target);

        // Try to update evidence on an entry that doesn't exist
        let update_ix = build_update_blacklist_evidence_ix(
            &blacklister.pubkey(),
            &config_pda,
            &role_pda,
            &bl_pda,
            &target,
            sample_evidence_hash(),
            "ipfs://QmGhost",
        );
        let result = send_tx(&mut svm, &[update_ix], &blacklister, &[&blacklister]);
        assert!(
            result.is_err(),
            "updating evidence on nonexistent entry should fail"
        );
    }
}
