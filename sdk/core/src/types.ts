import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// ---------------------------------------------------------------------------
// Role types — mirrors the on-chain u8 constants
// ---------------------------------------------------------------------------
export enum RoleType {
  Minter = 0,
  Burner = 1,
  Pauser = 2,
  Blacklister = 3,
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
// Event types (emitted on-chain)
// ---------------------------------------------------------------------------

export interface StablecoinInitializedEvent {
  config: PublicKey;
  mint: PublicKey;
  authority: PublicKey;
  name: string;
  symbol: string;
  decimals: number;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
}

export interface TokensMintedEvent {
  config: PublicKey;
  minter: PublicKey;
  recipient: PublicKey;
  amount: BN;
  minterTotalMinted: BN;
}

export interface TokensBurnedEvent {
  config: PublicKey;
  burner: PublicKey;
  from: PublicKey;
  amount: BN;
}

export interface AccountFrozenEvent {
  config: PublicKey;
  authority: PublicKey;
  account: PublicKey;
}

export interface AccountThawedEvent {
  config: PublicKey;
  authority: PublicKey;
  account: PublicKey;
}

export interface StablecoinPausedEvent {
  config: PublicKey;
  authority: PublicKey;
}

export interface StablecoinUnpausedEvent {
  config: PublicKey;
  authority: PublicKey;
}

export interface RoleUpdatedEvent {
  config: PublicKey;
  user: PublicKey;
  roleType: number;
  active: boolean;
  updatedBy: PublicKey;
}

export interface MinterQuotaUpdatedEvent {
  config: PublicKey;
  minter: PublicKey;
  newQuota: BN;
  updatedBy: PublicKey;
}

export interface AuthorityTransferredEvent {
  config: PublicKey;
  previousAuthority: PublicKey;
  newAuthority: PublicKey;
}

export interface AddressBlacklistedEvent {
  config: PublicKey;
  address: PublicKey;
  reason: string;
  blacklistedBy: PublicKey;
}

export interface AddressUnblacklistedEvent {
  config: PublicKey;
  address: PublicKey;
  removedBy: PublicKey;
}

export interface TokensSeizedEvent {
  config: PublicKey;
  from: PublicKey;
  to: PublicKey;
  amount: BN;
  seizedBy: PublicKey;
}
