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
