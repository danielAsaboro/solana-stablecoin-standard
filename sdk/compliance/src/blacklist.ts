import { Connection, PublicKey } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";

const BLACKLIST_SEED = Buffer.from("blacklist");

function deriveBlacklist(programId: PublicKey, config: PublicKey, address: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, config.toBuffer(), address.toBuffer()],
    programId
  );
}

export interface BlacklistEntryData {
  config: PublicKey;
  address: PublicKey;
  reason: string;
  blacklistedAt: BN;
  blacklistedBy: PublicKey;
  bump: number;
}

/**
 * BlacklistManager — high-level helper for querying blacklist state.
 */
export class BlacklistManager {
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
