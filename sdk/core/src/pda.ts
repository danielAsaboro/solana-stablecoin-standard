import { PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Seed constants (must match on-chain constants.rs)
// ---------------------------------------------------------------------------

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const MINTER_QUOTA_SEED = Buffer.from("minter_quota");
const BLACKLIST_SEED = Buffer.from("blacklist");
const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

/**
 * Derive the StablecoinConfig PDA address.
 *
 * Seeds: ["stablecoin", mint]
 *
 * @param programId - The SSS program ID
 * @param mint      - The Token-2022 mint pubkey
 * @returns [configAddress, bump]
 */
export function getConfigAddress(
  programId: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STABLECOIN_SEED, mint.toBuffer()],
    programId
  );
}

/**
 * Derive a RoleAccount PDA address.
 *
 * Seeds: ["role", config, role_type_u8, user]
 *
 * @param programId - The SSS program ID
 * @param config    - The StablecoinConfig PDA pubkey
 * @param roleType  - Role type as u8 (0=Minter, 1=Burner, 2=Pauser, 3=Blacklister, 4=Seizer)
 * @param user      - The user pubkey
 * @returns [roleAddress, bump]
 */
export function getRoleAddress(
  programId: PublicKey,
  config: PublicKey,
  roleType: number,
  user: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      ROLE_SEED,
      config.toBuffer(),
      Buffer.from([roleType]),
      user.toBuffer(),
    ],
    programId
  );
}

/**
 * Derive the MinterQuota PDA address.
 *
 * Seeds: ["minter_quota", config, minter]
 *
 * @param programId - The SSS program ID
 * @param config    - The StablecoinConfig PDA pubkey
 * @param minter    - The minter pubkey
 * @returns [minterQuotaAddress, bump]
 */
export function getMinterQuotaAddress(
  programId: PublicKey,
  config: PublicKey,
  minter: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_QUOTA_SEED, config.toBuffer(), minter.toBuffer()],
    programId
  );
}

/**
 * Derive the BlacklistEntry PDA address.
 *
 * Seeds: ["blacklist", config, address]
 *
 * @param programId - The SSS program ID
 * @param config    - The StablecoinConfig PDA pubkey
 * @param address   - The address being blacklisted
 * @returns [blacklistEntryAddress, bump]
 */
export function getBlacklistEntryAddress(
  programId: PublicKey,
  config: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, config.toBuffer(), address.toBuffer()],
    programId
  );
}

/**
 * Derive the ExtraAccountMetas PDA address (for the Transfer Hook program).
 *
 * Seeds: ["extra-account-metas", mint]
 *
 * @param hookProgramId - The Transfer Hook program ID
 * @param mint          - The Token-2022 mint pubkey
 * @returns [extraAccountMetasAddress, bump]
 */
export function getExtraAccountMetasAddress(
  hookProgramId: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()],
    hookProgramId
  );
}
