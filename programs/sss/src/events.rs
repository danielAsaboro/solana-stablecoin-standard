//! Program events emitted by SSS instructions.
//!
//! Every state-changing instruction emits exactly one event. Clients can parse
//! these from transaction logs to build an off-chain audit trail or drive
//! webhook notifications.

use anchor_lang::prelude::*;

/// Emitted when a new stablecoin is initialized via [`initialize`](crate::sss::initialize).
#[event]
pub struct StablecoinInitialized {
    /// The newly created [`StablecoinConfig`](crate::state::StablecoinConfig) PDA.
    pub config: Pubkey,
    /// The Token-2022 mint address.
    pub mint: Pubkey,
    /// The master authority who initialized the stablecoin.
    pub authority: Pubkey,
    /// Human-readable name of the stablecoin.
    pub name: String,
    /// Token ticker symbol.
    pub symbol: String,
    /// Number of decimal places.
    pub decimals: u8,
    /// Whether the permanent delegate extension is enabled (SSS-2).
    pub enable_permanent_delegate: bool,
    /// Whether the transfer hook extension is enabled (SSS-2).
    pub enable_transfer_hook: bool,
    /// Whether confidential transfers are enabled (SSS-3).
    pub enable_confidential_transfer: bool,
}

/// Emitted when tokens are minted via [`mint_tokens`](crate::sss::mint_tokens).
#[event]
pub struct TokensMinted {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The minter who executed the mint operation.
    pub minter: Pubkey,
    /// The recipient's token account that received the minted tokens.
    pub recipient: Pubkey,
    /// The number of tokens minted (in base units).
    pub amount: u64,
    /// The minter's cumulative minted amount after this operation.
    pub minter_total_minted: u64,
}

/// Emitted when tokens are burned via [`burn_tokens`](crate::sss::burn_tokens).
#[event]
pub struct TokensBurned {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The burner who executed the burn operation.
    pub burner: Pubkey,
    /// The token account from which tokens were burned.
    pub from: Pubkey,
    /// The number of tokens burned (in base units).
    pub amount: u64,
}

/// Emitted when a token account is frozen via [`freeze_token_account`](crate::sss::freeze_token_account).
#[event]
pub struct AccountFrozen {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The pauser who froze the account.
    pub authority: Pubkey,
    /// The token account that was frozen.
    pub account: Pubkey,
}

/// Emitted when a token account is thawed via [`thaw_token_account`](crate::sss::thaw_token_account).
#[event]
pub struct AccountThawed {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The pauser who thawed the account.
    pub authority: Pubkey,
    /// The token account that was thawed.
    pub account: Pubkey,
}

/// Emitted when the stablecoin is paused via [`pause`](crate::sss::pause).
///
/// While paused, minting and burning are blocked.
#[event]
pub struct StablecoinPaused {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The pauser who triggered the pause.
    pub authority: Pubkey,
}

/// Emitted when the stablecoin is unpaused via [`unpause`](crate::sss::unpause).
#[event]
pub struct StablecoinUnpaused {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The pauser who triggered the unpause.
    pub authority: Pubkey,
}

/// Emitted when a role is assigned or revoked via [`update_roles`](crate::sss::update_roles).
#[event]
pub struct RoleUpdated {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The user whose role was updated.
    pub user: Pubkey,
    /// The role type (0=Minter, 1=Burner, 2=Pauser, 3=Blacklister, 4=Seizer).
    pub role_type: u8,
    /// Whether the role is now active (`true`) or revoked (`false`).
    pub active: bool,
    /// The master authority who made the change.
    pub updated_by: Pubkey,
}

/// Emitted when a minter's quota is set or updated via [`update_minter`](crate::sss::update_minter).
#[event]
pub struct MinterQuotaUpdated {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The minter whose quota was updated.
    pub minter: Pubkey,
    /// The new maximum mint quota (in base units).
    pub new_quota: u64,
    /// The master authority who made the change.
    pub updated_by: Pubkey,
}

/// Emitted when master authority is transferred via [`transfer_authority`](crate::sss::transfer_authority).
#[event]
pub struct AuthorityTransferred {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The outgoing master authority.
    pub previous_authority: Pubkey,
    /// The incoming master authority.
    pub new_authority: Pubkey,
}

/// Emitted when an address is added to the blacklist via [`add_to_blacklist`](crate::sss::add_to_blacklist).
///
/// SSS-2 only — requires transfer hook to be enabled.
#[event]
pub struct AddressBlacklisted {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The address that was blacklisted.
    pub address: Pubkey,
    /// The reason for blacklisting (e.g., "OFAC match").
    pub reason: String,
    /// The blacklister who added the entry.
    pub blacklisted_by: Pubkey,
}

/// Emitted when an address is removed from the blacklist via [`remove_from_blacklist`](crate::sss::remove_from_blacklist).
///
/// SSS-2 only. The [`BlacklistEntry`](crate::state::BlacklistEntry) PDA is closed
/// and rent is returned to the authority.
#[event]
pub struct AddressUnblacklisted {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The address that was removed from the blacklist.
    pub address: Pubkey,
    /// The blacklister who removed the entry.
    pub removed_by: Pubkey,
}

/// Emitted when tokens are seized via [`seize`](crate::sss::seize).
///
/// SSS-2 only — requires permanent delegate to be enabled. Uses the config PDA
/// as permanent delegate to execute a `transfer_checked` from the source to the
/// destination (typically a treasury account).
#[event]
pub struct TokensSeized {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The token account from which tokens were seized.
    pub from: Pubkey,
    /// The destination token account (e.g., treasury).
    pub to: Pubkey,
    /// The number of tokens seized (in base units).
    pub amount: u64,
    /// The seizer who executed the operation.
    pub seized_by: Pubkey,
}

/// Emitted when a minter's cumulative `minted` counter is reset via
/// [`reset_minter_quota`](crate::sss::reset_minter_quota).
#[event]
pub struct MinterQuotaReset {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The minter whose counter was reset.
    pub minter: Pubkey,
    /// The `minted` value before the reset.
    pub previous_minted: u64,
    /// The master authority who triggered the reset.
    pub reset_by: Pubkey,
}

/// Emitted when an authority transfer is proposed via
/// [`propose_authority_transfer`](crate::sss::propose_authority_transfer).
#[event]
pub struct AuthorityTransferProposed {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The current master authority proposing the transfer.
    pub current_authority: Pubkey,
    /// The proposed new master authority.
    pub pending_authority: Pubkey,
    /// Unix timestamp when the proposal was created.
    pub proposed_at: i64,
}

/// Emitted when a pending authority transfer is cancelled via
/// [`cancel_authority_transfer`](crate::sss::cancel_authority_transfer).
#[event]
pub struct AuthorityTransferCancelled {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The authority that cancelled the transfer.
    pub cancelled_by: Pubkey,
    /// The pending authority that was cleared.
    pub cleared_pending: Pubkey,
}

/// Emitted when a 2-step authority transfer is completed via
/// [`accept_authority_transfer`](crate::sss::accept_authority_transfer).
#[event]
pub struct AuthorityTransferAccepted {
    /// The stablecoin config PDA.
    pub config: Pubkey,
    /// The outgoing master authority.
    pub previous_authority: Pubkey,
    /// The new master authority (formerly `pending_authority`).
    pub new_authority: Pubkey,
}
