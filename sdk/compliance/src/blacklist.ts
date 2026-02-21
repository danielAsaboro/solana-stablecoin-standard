/**
 * @module blacklist
 *
 * Blacklist query helpers for SSS-2 stablecoins.
 *
 * Provides read-only access to the on-chain blacklist PDAs, including
 * single-address lookups and full blacklist enumeration. For write
 * operations (add/remove), use the core SDK's
 * {@link SolanaStablecoin.compliance} module.
 *
 * @packageDocumentation
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";

const BLACKLIST_SEED = Buffer.from("blacklist");

/**
 * Derives the blacklist entry PDA for a given address.
 *
 * Seeds: `["blacklist", config, address]`
 *
 * @param programId - The SSS program ID
 * @param config - The stablecoin config PDA
 * @param address - The wallet address to check
 * @returns A tuple of `[PDA, bump]`
 */
function deriveBlacklist(programId: PublicKey, config: PublicKey, address: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, config.toBuffer(), address.toBuffer()],
    programId
  );
}

/**
 * Deserialized on-chain blacklist entry data.
 *
 * Each blacklisted address has a corresponding PDA that stores the
 * reason, timestamp, and the authority who created the entry.
 */
export interface BlacklistEntryData {
  /** The stablecoin config this entry belongs to. */
  config: PublicKey;
  /** The blacklisted wallet address. */
  address: PublicKey;
  /** Human-readable reason for blacklisting (max 64 chars). */
  reason: string;
  /** Unix timestamp when the address was blacklisted. */
  blacklistedAt: BN;
  /** The Blacklister authority who created this entry. */
  blacklistedBy: PublicKey;
  /** PDA bump seed. */
  bump: number;
}

/**
 * BlacklistManager — high-level helper for querying blacklist state.
 *
 * Provides read-only access to check whether addresses are blacklisted,
 * retrieve individual entries, or enumerate the full blacklist.
 *
 * @example
 * ```ts
 * const manager = new BlacklistManager(program, connection, configAddress);
 * const isBlocked = await manager.isBlacklisted(suspectAddress);
 * const allEntries = await manager.getAll();
 * ```
 */
export class BlacklistManager {
  /**
   * @param program - The Anchor program instance for the SSS program
   * @param connection - Solana RPC connection
   * @param configAddress - The stablecoin config PDA address
   */
  constructor(
    private readonly program: Program,
    private readonly connection: Connection,
    private readonly configAddress: PublicKey
  ) {}

  /**
   * Check if an address is blacklisted.
   */
  async isBlacklisted(address: PublicKey): Promise<boolean> {
    const [entryPda] = deriveBlacklist(
      this.program.programId,
      this.configAddress,
      address
    );
    const info = await this.connection.getAccountInfo(entryPda);
    return info !== null && info.data.length > 0;
  }

  /**
   * Fetch a single blacklist entry.
   */
  async get(address: PublicKey): Promise<BlacklistEntryData | null> {
    const [entryPda] = deriveBlacklist(
      this.program.programId,
      this.configAddress,
      address
    );
    try {
      const data = await (this.program.account as any).blacklistEntry.fetch(entryPda);
      return data as unknown as BlacklistEntryData;
    } catch {
      return null;
    }
  }

  /**
   * Fetch all blacklist entries for this stablecoin.
   */
  async getAll(): Promise<{ pubkey: PublicKey; account: BlacklistEntryData }[]> {
    const accounts = await (this.program.account as any).blacklistEntry.all([
      {
        memcmp: {
          offset: 8,
          bytes: this.configAddress.toBase58(),
        },
      },
    ]);

    return accounts.map((a: any) => ({
      pubkey: a.publicKey,
      account: a.account as unknown as BlacklistEntryData,
    }));
  }
}
