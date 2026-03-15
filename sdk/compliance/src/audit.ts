/**
 * @module audit
 *
 * On-chain audit log for SSS stablecoins.
 *
 * Reconstructs a compliance audit trail by parsing transaction history
 * and program logs for the stablecoin config account. Supports filtering
 * by action type, time range, and result limit.
 *
 * @packageDocumentation
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

/**
 * A single audit log entry parsed from an on-chain transaction.
 *
 * Each entry corresponds to one program instruction execution and
 * includes the transaction signature for on-chain verification.
 */
export interface AuditEntry {
  /** The transaction signature (base-58 encoded). */
  signature: string;
  /** Unix timestamp of the block containing this transaction. */
  timestamp: number;
  /** The action type (e.g., `"mint"`, `"burn"`, `"blacklist_add"`, `"seize"`). */
  action: string;
  /** Additional details extracted from program logs (e.g., base-64 event data). */
  details: Record<string, unknown>;
}

/**
 * Filter criteria for querying audit log entries.
 *
 * All fields are optional — omit a field to skip that filter.
 *
 * @example
 * ```ts
 * const recentMints = await audit.getEntries({
 *   action: "mint",
 *   fromTimestamp: Math.floor(Date.now() / 1000) - 86400,
 *   limit: 50,
 * });
 * ```
 */
export interface AuditFilter {
  /** Filter by action type (e.g., `"mint"`, `"burn"`, `"seize"`). */
  action?: string;
  /** Only include entries at or after this Unix timestamp. */
  fromTimestamp?: number;
  /** Only include entries at or before this Unix timestamp. */
  toTimestamp?: number;
  /** Maximum number of entries to return (default: 100). */
  limit?: number;
}

/**
 * AuditLog — queries on-chain transaction history for compliance events.
 *
 * Parses program logs and transaction data to reconstruct an audit trail
 * of all compliance-relevant actions (mint, burn, blacklist, seize, etc.).
 *
 * @example
 * ```ts
 * const audit = new AuditLog(connection, programId, configAddress);
 * const entries = await audit.getEntries({ action: "seize", limit: 10 });
 * for (const entry of entries) {
 *   console.log(`${entry.action} at ${entry.timestamp}: ${entry.signature}`);
 * }
 * ```
 */
export class AuditLog {
  /**
   * @param connection - Solana RPC connection
   * @param programId - The SSS program ID
   * @param configAddress - The stablecoin config PDA address
   */
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
   *
   * Scans log lines for Anchor instruction markers (e.g., `"Instruction: MintTokens"`)
   * and maps them to normalized action strings used in {@link AuditEntry.action}.
   *
   * @param logs - Array of program log messages from the transaction
   * @returns The normalized action string, or `null` if no SSS instruction was found
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
      if (log.includes("Instruction: AssignRole")) return "assign_role";
      if (log.includes("Instruction: UpdateRole")) return "update_role";
      if (log.includes("Instruction: UpdateMinter")) return "update_minter";
      if (log.includes("Instruction: ProposeAuthorityTransfer")) return "propose_authority_transfer";
      if (log.includes("Instruction: AcceptAuthorityTransfer")) return "accept_authority_transfer";
      if (log.includes("Instruction: AddToBlacklist")) return "blacklist_add";
      if (log.includes("Instruction: RemoveFromBlacklist")) return "blacklist_remove";
      if (log.includes("Instruction: Seize")) return "seize";
    }
    return null;
  }

  /**
   * Parse additional details from transaction logs.
   *
   * Extracts base-64 encoded Anchor event data from `"Program data:"` log lines.
   *
   * @param logs - Array of program log messages from the transaction
   * @param action - The parsed action type for context
   * @returns Key-value map of extracted details
   */
  private parseDetails(
    logs: string[],
    action: string
  ): Record<string, unknown> {
    const details: Record<string, unknown> = {};

    // Extract program data (Anchor event emission)
    for (const log of logs) {
      if (log.startsWith("Program data:")) {
        details.eventData = log.replace("Program data: ", "");
      }
    }

    return details;
  }
}
