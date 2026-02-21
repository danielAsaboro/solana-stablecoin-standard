// ---------------------------------------------------------------------------
// @stbr/sss-core-sdk — Solana Stablecoin Standard Core SDK
// ---------------------------------------------------------------------------

// PDA derivation helpers
export {
  getConfigAddress,
  getRoleAddress,
  getMinterQuotaAddress,
  getBlacklistEntryAddress,
  getExtraAccountMetasAddress,
} from "./pda";

// Type definitions and interfaces
export {
  RoleType,
  type StablecoinConfig,
  type RoleAccount,
  type MinterQuota,
  type BlacklistEntry,
  type PresetConfig,
  type CreateStablecoinParams,
  type MintParams,
  type BurnParams,
  type FreezeParams,
  type ThawParams,
  type PauseParams,
  type UpdateRolesParams,
  type UpdateMinterParams,
  type TransferAuthorityParams,
  type BlacklistAddParams,
  type BlacklistRemoveParams,
  type SeizeParams,
  type StablecoinInitializedEvent,
  type TokensMintedEvent,
  type TokensBurnedEvent,
  type AccountFrozenEvent,
  type AccountThawedEvent,
  type StablecoinPausedEvent,
  type StablecoinUnpausedEvent,
  type RoleUpdatedEvent,
  type MinterQuotaUpdatedEvent,
  type AuthorityTransferredEvent,
  type AddressBlacklistedEvent,
  type AddressUnblacklistedEvent,
  type TokensSeizedEvent,
} from "./types";

// Preset configurations
export { SSS_1, SSS_2 } from "./presets";

// Token-2022 utility helpers
export {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createATAInstruction,
  getTokenBalance,
  getMintSupply,
  accountExists,
} from "./utils";

// Main SDK class
export { SolanaStablecoin, ComplianceModule } from "./stablecoin";
