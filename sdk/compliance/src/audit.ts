import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export interface AuditEntry {
  signature: string;
  timestamp: number;
  action: string;
  details: Record<string, any>;
}

export interface AuditFilter {
  action?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
}

/**
 * AuditLog — queries on-chain transaction history for compliance events.
 *
 * Parses program logs and transaction data to reconstruct an audit trail
 * of all compliance-relevant actions (mint, burn, blacklist, seize, etc.).
 */
export class AuditLog {
  constructor(
    private readonly connection: Connection,
    private readonly programId: PublicKey,
    private readonly configAddress: PublicKey
  ) {}

  /**
   * Fetch recent audit entries for this stablecoin.
   *
   * @param filter - Optional filter criteria
   * @returns Array of audit entries sorted by timestamp (newest first)
   */
  async getEntries(filter?: AuditFilter): Promise<AuditEntry[]> {
    const limit = filter?.limit ?? 100;

    // Fetch recent signatures for the config account
    const signatures = await this.connection.getSignaturesForAddress(
      this.configAddress,
      { limit }
    );

    const entries: AuditEntry[] = [];

    for (const sig of signatures) {
      // Apply time filters
      if (filter?.fromTimestamp && sig.blockTime && sig.blockTime < filter.fromTimestamp) {
        continue;
      }
      if (filter?.toTimestamp && sig.blockTime && sig.blockTime > filter.toTimestamp) {
        continue;
      }

      // Parse the transaction to extract event data
      const tx = await this.connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx?.meta?.logMessages) continue;

      const action = this.parseAction(tx.meta.logMessages);
      if (!action) continue;

      // Apply action filter
      if (filter?.action && action !== filter.action) continue;

      entries.push({
        signature: sig.signature,
        timestamp: sig.blockTime ?? 0,
        action,
        details: this.parseDetails(tx.meta.logMessages, action),
      });
    }

    return entries;
  }

  /**
   * Parse the action type from transaction logs.
   */
  private parseAction(logs: string[]): string | null {
    for (const log of logs) {
      if (log.includes("Instruction: Initialize")) return "initialize";
      if (log.includes("Instruction: MintTokens")) return "mint";
      if (log.includes("Instruction: BurnTokens")) return "burn";
      if (log.includes("Instruction: FreezeTokenAccount")) return "freeze";
      if (log.includes("Instruction: ThawTokenAccount")) return "thaw";
      if (log.includes("Instruction: Pause")) return "pause";
      if (log.includes("Instruction: Unpause")) return "unpause";
      if (log.includes("Instruction: UpdateRoles")) return "update_roles";
      if (log.includes("Instruction: UpdateMinter")) return "update_minter";
      if (log.includes("Instruction: TransferAuthority")) return "transfer_authority";
      if (log.includes("Instruction: AddToBlacklist")) return "blacklist_add";
      if (log.includes("Instruction: RemoveFromBlacklist")) return "blacklist_remove";
      if (log.includes("Instruction: Seize")) return "seize";
    }
    return null;
  }

  /**
   * Parse additional details from transaction logs.
   */
  private parseDetails(
    logs: string[],
    action: string
  ): Record<string, any> {
    const details: Record<string, any> = {};

    // Extract program data (Anchor event emission)
    for (const log of logs) {
      if (log.startsWith("Program data:")) {
        details.eventData = log.replace("Program data: ", "");
      }
    }

    return details;
  }
}
