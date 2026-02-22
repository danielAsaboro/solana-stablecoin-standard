/**
 * @module types
 *
 * Type definitions for the Solana Stablecoin Standard SDK.
 *
 * This module contains:
 * - {@link RoleType} — Enum of on-chain role identifiers
 * - Account interfaces — TypeScript mirrors of Anchor-deserialized on-chain accounts
 * - Parameter interfaces — Typed inputs for every SDK operation
 * - Event interfaces — Typed representations of program log events
 *
 * @packageDocumentation
 */

import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// ---------------------------------------------------------------------------
// Role types — mirrors the on-chain u8 constants
// ---------------------------------------------------------------------------

/**
 * Role-based access control identifiers.
 *
 * Each role maps to a `u8` discriminator stored on-chain in the
 * `RoleAccount` PDA. Roles are assigned by the master authority via
 * {@link UpdateRolesParams}.
 *
 * @example
 * ```ts
 * import { RoleType } from "@stbr/sss-core-sdk";
 *
 * await stablecoin.updateRoles({
 *   roleType: RoleType.Minter,
 *   user: minterPubkey,
 *   active: true,
 *   authority: masterAuthority,
 * });
 * ```
 */
export enum RoleType {
  /** Can mint tokens up to their assigned quota. */
  Minter = 0,
  /** Can burn tokens from any token account. */
  Burner = 1,
  /** Can pause/unpause the stablecoin and freeze/thaw individual accounts. */
  Pauser = 2,
  /** Can add/remove addresses from the on-chain blacklist (SSS-2 only). */
  Blacklister = 3,
  /** Can seize tokens from blacklisted accounts via permanent delegate (SSS-2 only). */
  Seizer = 4,
}

// ---------------------------------------------------------------------------
// On-chain account shapes (deserialized by Anchor)
// ---------------------------------------------------------------------------

/** Mirrors the on-chain `StablecoinConfig` account. */
export interface StablecoinConfig {
  /** The Token-2022 mint address */
  mint: PublicKey;
  /** Human-readable name (max 32 chars) */
  name: string;
  /** Token symbol (max 10 chars) */
  symbol: string;
  /** Metadata URI (max 200 chars) */
  uri: string;
  /** Token decimals */
  decimals: number;
  /** Master authority that can assign roles */
  masterAuthority: PublicKey;

  // Feature flags (immutable after init)
  /** Whether permanent delegate is enabled (required for seize) */
  enablePermanentDelegate: boolean;
  /** Whether transfer hook is enabled (required for blacklist enforcement) */
  enableTransferHook: boolean;
  /** Whether new token accounts default to frozen state */
  defaultAccountFrozen: boolean;
  /** Whether confidential transfers are enabled (SSS-3) */
  enableConfidentialTransfer: boolean;

  // Runtime state
  /** Whether the stablecoin is paused */
  paused: boolean;
  /** Total tokens minted over lifetime */
  totalMinted: BN;
  /** Total tokens burned over lifetime */
  totalBurned: BN;
  /** Transfer hook program ID (if enabled) */
  transferHookProgram: PublicKey;

  /** PDA bump seed */
  bump: number;
}

/** Mirrors the on-chain `RoleAccount`. */
export interface RoleAccount {
  /** The stablecoin config this role belongs to */
  config: PublicKey;
  /** The user who has this role */
  user: PublicKey;
  /** Role type (0=Minter, 1=Burner, 2=Pauser, 3=Blacklister, 4=Seizer) */
  roleType: number;
  /** Whether the role is currently active */
  active: boolean;
  /** PDA bump seed */
  bump: number;
}

/** Mirrors the on-chain `MinterQuota`. */
export interface MinterQuota {
  /** The stablecoin config */
  config: PublicKey;
  /** The minter address */
  minter: PublicKey;
  /** Maximum amount the minter can mint */
  quota: BN;
  /** Amount already minted */
  minted: BN;
  /** PDA bump seed */
  bump: number;
}

/** Mirrors the on-chain `BlacklistEntry`. */
export interface BlacklistEntry {
  /** The stablecoin config */
  config: PublicKey;
  /** The blacklisted address */
  address: PublicKey;
  /** Reason for blacklisting (max 64 chars) */
  reason: string;
  /** Timestamp when blacklisted */
  blacklistedAt: BN;
  /** Authority who blacklisted the address */
  blacklistedBy: PublicKey;
  /** PDA bump seed */
  bump: number;
}

// ---------------------------------------------------------------------------
// Preset configuration
// ---------------------------------------------------------------------------

/** Static preset config describing which Token-2022 extensions to enable. */
export interface PresetConfig {
  /** Whether to enable permanent delegate (for seize capability) */
  permanentDelegate: boolean;
  /** Whether to enable transfer hook (for blacklist enforcement) */
  transferHook: boolean;
  /** Whether new token accounts default to frozen */
  defaultAccountFrozen: boolean;
  /** Whether to enable confidential transfers (SSS-3 privacy preset) */
  confidentialTransfer?: boolean;
}

// ---------------------------------------------------------------------------
// Parameter types for SDK methods
// ---------------------------------------------------------------------------

/** Parameters for creating a new stablecoin. */
export interface CreateStablecoinParams {
  /** Human-readable name (max 32 chars) */
  name: string;
  /** Token symbol (max 10 chars) */
  symbol: string;
  /** Metadata URI (max 200 chars) */
  uri: string;
  /** Token decimals (0-9) */
  decimals: number;
  /** Whether to enable permanent delegate */
  enablePermanentDelegate: boolean;
  /** Whether to enable transfer hook */
  enableTransferHook: boolean;
  /** Whether new token accounts default to frozen */
  defaultAccountFrozen: boolean;
  /** Whether to enable confidential transfers (SSS-3) */
  enableConfidentialTransfer: boolean;
  /** Transfer hook program ID (required when enableTransferHook = true) */
  transferHookProgramId?: PublicKey;
  /** The authority (payer + master authority) */
  authority: PublicKey;
}

/** Parameters for minting tokens. */
export interface MintParams {
  /** Amount to mint (in smallest unit) */
  amount: BN;
  /** Recipient token account */
  recipientTokenAccount: PublicKey;
  /** The minter keypair (must have Minter role) */
  minter: PublicKey;
}

/** Parameters for burning tokens. */
export interface BurnParams {
  /** Amount to burn (in smallest unit) */
  amount: BN;
  /** Token account to burn from */
  fromTokenAccount: PublicKey;
  /** The burner keypair (must have Burner role) */
  burner: PublicKey;
}

/** Parameters for freezing a token account. */
export interface FreezeParams {
  /** Token account to freeze */
  tokenAccount: PublicKey;
  /** The authority keypair (must have Pauser role) */
  authority: PublicKey;
}

/** Parameters for thawing a token account. */
export interface ThawParams {
  /** Token account to thaw */
  tokenAccount: PublicKey;
  /** The authority keypair (must have Pauser role) */
  authority: PublicKey;
}

/** Parameters for pausing/unpausing. */
export interface PauseParams {
  /** The authority keypair (must have Pauser role) */
  authority: PublicKey;
}

/** Parameters for updating roles. */
export interface UpdateRolesParams {
  /** Role type to assign/revoke */
  roleType: RoleType;
  /** The user to assign/revoke the role for */
  user: PublicKey;
  /** Whether the role should be active */
  active: boolean;
  /** The master authority */
  authority: PublicKey;
}

/** Parameters for updating minter quota. */
export interface UpdateMinterParams {
  /** The minter address */
  minter: PublicKey;
  /** New quota amount */
  quota: BN;
  /** The master authority */
  authority: PublicKey;
}

/** Parameters for transferring authority. */
export interface TransferAuthorityParams {
  /** New master authority */
  newAuthority: PublicKey;
  /** Current master authority */
  authority: PublicKey;
}

/** Parameters for adding to blacklist (SSS-2 only). */
export interface BlacklistAddParams {
  /** Address to blacklist */
  address: PublicKey;
  /** Reason for blacklisting (max 64 chars) */
  reason: string;
  /** The authority (must have Blacklister role) */
  authority: PublicKey;
}

/** Parameters for removing from blacklist (SSS-2 only). */
export interface BlacklistRemoveParams {
  /** Address to remove from blacklist */
  address: PublicKey;
  /** The authority (must have Blacklister role) */
  authority: PublicKey;
}

/** Parameters for seizing tokens (SSS-2 only). */
export interface SeizeParams {
  /** Source token account to seize from */
  fromTokenAccount: PublicKey;
  /** Destination token account (e.g., treasury) */
  toTokenAccount: PublicKey;
  /** Amount to seize */
  amount: BN;
  /** The authority (must have Seizer role) */
  authority: PublicKey;
}

// ---------------------------------------------------------------------------
// Event types (emitted on-chain via Anchor's `emit!` macro)
// ---------------------------------------------------------------------------

/**
 * Emitted when a new stablecoin is initialized via the `initialize` instruction.
 *
 * Contains the newly created config PDA, mint address, and the chosen
 * feature flags. This is the first event in a stablecoin's lifecycle.
 *
 * @see {@link CreateStablecoinParams}
 */
export interface StablecoinInitializedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The Token-2022 mint address. */
  mint: PublicKey;
  /** The master authority who initialized the stablecoin. */
  authority: PublicKey;
  /** Human-readable name. */
  name: string;
  /** Token symbol. */
  symbol: string;
  /** Token decimals. */
  decimals: number;
  /** Whether permanent delegate was enabled. */
  enablePermanentDelegate: boolean;
  /** Whether transfer hook was enabled. */
  enableTransferHook: boolean;
  /** Whether confidential transfers were enabled (SSS-3). */
  enableConfidentialTransfer: boolean;
}

/**
 * Emitted when tokens are minted via the `mint_tokens` instruction.
 *
 * Includes the minter's cumulative total to support quota tracking off-chain.
 *
 * @see {@link MintParams}
 */
export interface TokensMintedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The minter who executed the mint. */
  minter: PublicKey;
  /** The recipient token account. */
  recipient: PublicKey;
  /** Amount minted (in smallest unit). */
  amount: BN;
  /** Minter's cumulative minted total after this operation. */
  minterTotalMinted: BN;
}

/**
 * Emitted when tokens are burned via the `burn_tokens` instruction.
 *
 * @see {@link BurnParams}
 */
export interface TokensBurnedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The burner who executed the burn. */
  burner: PublicKey;
  /** The token account tokens were burned from. */
  from: PublicKey;
  /** Amount burned (in smallest unit). */
  amount: BN;
}

/**
 * Emitted when a token account is frozen via the `freeze_account` instruction.
 *
 * A frozen account cannot send or receive tokens until thawed.
 *
 * @see {@link FreezeParams}
 */
export interface AccountFrozenEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The authority (Pauser) who froze the account. */
  authority: PublicKey;
  /** The token account that was frozen. */
  account: PublicKey;
}

/**
 * Emitted when a token account is thawed via the `thaw_account` instruction.
 *
 * @see {@link ThawParams}
 */
export interface AccountThawedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The authority (Pauser) who thawed the account. */
  authority: PublicKey;
  /** The token account that was thawed. */
  account: PublicKey;
}

/**
 * Emitted when the stablecoin is globally paused via the `pause` instruction.
 *
 * While paused, all mint and burn operations are rejected.
 */
export interface StablecoinPausedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The authority (Pauser) who paused the stablecoin. */
  authority: PublicKey;
}

/**
 * Emitted when the stablecoin is unpaused via the `unpause` instruction.
 */
export interface StablecoinUnpausedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The authority (Pauser) who unpaused the stablecoin. */
  authority: PublicKey;
}

/**
 * Emitted when a role is granted or revoked via the `update_roles` instruction.
 *
 * @see {@link UpdateRolesParams}
 */
export interface RoleUpdatedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The user whose role was changed. */
  user: PublicKey;
  /** The role type (see {@link RoleType}). */
  roleType: number;
  /** Whether the role is now active (`true`) or revoked (`false`). */
  active: boolean;
  /** The master authority who made the change. */
  updatedBy: PublicKey;
}

/**
 * Emitted when a minter's quota is updated via the `update_minter` instruction.
 *
 * @see {@link UpdateMinterParams}
 */
export interface MinterQuotaUpdatedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The minter whose quota was updated. */
  minter: PublicKey;
  /** The new quota limit. */
  newQuota: BN;
  /** The master authority who made the change. */
  updatedBy: PublicKey;
}

/**
 * Emitted when the master authority is transferred via the
 * `transfer_authority` instruction.
 *
 * @see {@link TransferAuthorityParams}
 */
export interface AuthorityTransferredEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The previous master authority. */
  previousAuthority: PublicKey;
  /** The new master authority. */
  newAuthority: PublicKey;
}

/**
 * Emitted when an address is added to the blacklist via the
 * `add_to_blacklist` instruction (SSS-2 only).
 *
 * Once blacklisted, all transfers to/from this address are blocked by the
 * transfer hook program.
 *
 * @see {@link BlacklistAddParams}
 */
export interface AddressBlacklistedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The address that was blacklisted. */
  address: PublicKey;
  /** Human-readable reason for blacklisting. */
  reason: string;
  /** The authority (Blacklister) who added the entry. */
  blacklistedBy: PublicKey;
}

/**
 * Emitted when an address is removed from the blacklist via the
 * `remove_from_blacklist` instruction (SSS-2 only).
 *
 * @see {@link BlacklistRemoveParams}
 */
export interface AddressUnblacklistedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The address that was removed from the blacklist. */
  address: PublicKey;
  /** The authority (Blacklister) who removed the entry. */
  removedBy: PublicKey;
}

/**
 * Emitted when tokens are seized from a blacklisted account via the
 * `seize` instruction (SSS-2 only).
 *
 * Seizure uses the permanent delegate extension to transfer tokens
 * without the account owner's signature.
 *
 * @see {@link SeizeParams}
 */
export interface TokensSeizedEvent {
  /** The stablecoin config PDA address. */
  config: PublicKey;
  /** The token account tokens were seized from. */
  from: PublicKey;
  /** The destination token account (typically a treasury). */
  to: PublicKey;
  /** Amount seized (in smallest unit). */
  amount: BN;
  /** The authority (Seizer) who executed the seizure. */
  seizedBy: PublicKey;
}
