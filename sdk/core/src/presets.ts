import { PresetConfig } from "./types";

/**
 * SSS-1 preset: Basic stablecoin.
 *
 * - No permanent delegate (no seize)
 * - No transfer hook (no blacklist enforcement on transfers)
 * - Token accounts are not frozen by default
 *
 * Use this preset for simple stablecoins that only need
 * mint/burn/pause/freeze/thaw capabilities.
 */
export const SSS_1: PresetConfig = {
  permanentDelegate: false,
  transferHook: false,
  defaultAccountFrozen: false,
};

/**
 * SSS-2 preset: Compliance stablecoin.
 *
 * - Permanent delegate enabled (allows seizing tokens)
 * - Transfer hook enabled (enforces blacklist on every transfer)
 * - Token accounts are not frozen by default
 *
 * Use this preset for regulated stablecoins that require
 * full compliance capabilities: blacklisting, seizure,
 * and transfer-level enforcement.
 */
export const SSS_2: PresetConfig = {
  permanentDelegate: true,
  transferHook: true,
  defaultAccountFrozen: false,
};

/**
 * SSS-3 preset: Privacy stablecoin (experimental / proof-of-concept).
 *
 * - Confidential transfers enabled (Token-2022 ConfidentialTransferMint extension)
 * - No permanent delegate (no seize)
 * - No transfer hook (no blacklist enforcement)
 * - Token accounts are not frozen by default
 *
 * SSS-3 adds ElGamal-encrypted balances and zero-knowledge range proofs
 * for private on-chain transfers. Use alongside the companion Privacy Program
 * for scoped allowlist management.
 *
 * Note: Token-2022 confidential transfer tooling is still maturing.
 * This preset is provided as a proof-of-concept. See docs/SSS-3.md for details.
 */
export const SSS_3: PresetConfig = {
  permanentDelegate: false,
  transferHook: false,
  defaultAccountFrozen: false,
  confidentialTransfer: true,
};
