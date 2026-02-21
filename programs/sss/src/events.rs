use anchor_lang::prelude::*;

#[event]
pub struct StablecoinInitialized {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub enable_permanent_delegate: bool,
    pub enable_transfer_hook: bool,
}

#[event]
pub struct TokensMinted {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub minter_total_minted: u64,
}

#[event]
pub struct TokensBurned {
    pub config: Pubkey,
    pub burner: Pubkey,
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AccountFrozen {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub account: Pubkey,
}

#[event]
pub struct AccountThawed {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub account: Pubkey,
}

#[event]
pub struct StablecoinPaused {
    pub config: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct StablecoinUnpaused {
    pub config: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct RoleUpdated {
    pub config: Pubkey,
    pub user: Pubkey,
    pub role_type: u8,
    pub active: bool,
    pub updated_by: Pubkey,
}

#[event]
pub struct MinterQuotaUpdated {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub new_quota: u64,
    pub updated_by: Pubkey,
}

#[event]
pub struct AuthorityTransferred {
    pub config: Pubkey,
    pub previous_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct AddressBlacklisted {
    pub config: Pubkey,
    pub address: Pubkey,
    pub reason: String,
    pub blacklisted_by: Pubkey,
}

#[event]
pub struct AddressUnblacklisted {
    pub config: Pubkey,
    pub address: Pubkey,
    pub removed_by: Pubkey,
}

#[event]
pub struct TokensSeized {
    pub config: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub seized_by: Pubkey,
}
