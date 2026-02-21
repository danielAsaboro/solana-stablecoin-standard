/**
 * @stbr/sss-core-sdk — Solana Stablecoin Standard Core SDK
 *
 * The primary entry point for interacting with SSS stablecoins on Solana.
 *
 * ## Quick Start
 * ```ts
 * import { SolanaStablecoin, Presets } from "@stbr/sss-core-sdk";
 *
 * // Create an SSS-2 compliant stablecoin
 * const stable = await SolanaStablecoin.create(connection, {
 *   ...Presets.SSS_2,
 *   name: "My Stablecoin",
 *   symbol: "MYUSD",
 *   decimals: 6,
 *   authority: wallet.publicKey,
 * });
 *
 * // Or load an existing one by mint address
 * const existing = await SolanaStablecoin.load(connection, mintAddress);
 * ```
 *
 * ## Exports
 * - {@link SolanaStablecoin} — Main SDK class (create, load, mint, burn, freeze, etc.)
 * - {@link ComplianceModule} — SSS-2 compliance operations (blacklist, seize)
 * - PDA helpers — `getConfigAddress`, `getRoleAddress`, etc.
 * - {@link SSS_1}, {@link SSS_2} — Preset configurations
 * - Utility functions — Token-2022 helpers (ATA, balances, supply)
 *
 * @module @stbr/sss-core-sdk
 * @packageDocumentation
 */

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

// Fluent operation builders
export {
  type BuilderContext,
  OperationBuilder,
  MintBuilder,
  BurnBuilder,
  FreezeBuilder,
  ThawBuilder,
  PauseBuilder,
  UpdateRolesBuilder,
  UpdateMinterBuilder,
  TransferAuthorityBuilder,
  BlacklistAddBuilder,
  BlacklistRemoveBuilder,
  SeizeBuilder,
} from "./builder";
