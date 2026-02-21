/**
 * @module compliance
 *
 * High-level compliance module for SSS-2 stablecoins.
 *
 * Wraps blacklist management, seizure operations, and audit log queries
 * into a single cohesive API. Use this module to check compliance feature
 * status and retrieve a compliance summary for dashboards or reports.
 *
 * @packageDocumentation
 */

import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { BlacklistManager } from "./blacklist";
import { AuditLog, AuditFilter, AuditEntry } from "./audit";

/**
 * ComplianceModule — wraps all SSS-2 compliance operations.
 *
 * Provides a higher-level API on top of the raw program instructions
 * for blacklist management, seizure, and audit log queries.
 *
 * @example
 * ```ts
 * import { ComplianceModule } from "@stbr/sss-compliance-sdk";
 *
 * const compliance = new ComplianceModule(program, connection, mint, config);
 * const summary = await compliance.getSummary();
 * console.log(`Blacklisted addresses: ${summary.blacklistedCount}`);
 * ```
 */
export class ComplianceModule {
  /** Blacklist query helper for checking and listing blacklisted addresses. */
  public readonly blacklist: BlacklistManager;
  /** Audit log helper for querying on-chain compliance event history. */
  public readonly audit: AuditLog;

  /**
   * @param program - The Anchor program instance for the SSS program
   * @param connection - Solana RPC connection
   * @param mint - The Token-2022 mint address
   * @param configAddress - The stablecoin config PDA address
   */
  constructor(
    private readonly program: Program,
    private readonly connection: Connection,
    private readonly mint: PublicKey,
    private readonly configAddress: PublicKey
  ) {
    this.blacklist = new BlacklistManager(program, connection, configAddress);
    this.audit = new AuditLog(connection, program.programId, configAddress);
  }

  /**
   * Check if compliance features are enabled for this stablecoin.
   */
  async isComplianceEnabled(): Promise<boolean> {
    const config = await (this.program.account as any).stablecoinConfig.fetch(
      this.configAddress
    );
    return (config as any).enableTransferHook === true;
  }

  /**
   * Check if permanent delegate (seize) is enabled.
   */
  async isSeizeEnabled(): Promise<boolean> {
    const config = await (this.program.account as any).stablecoinConfig.fetch(
      this.configAddress
    );
    return (config as any).enablePermanentDelegate === true;
  }

  /**
   * Get a compliance summary for this stablecoin.
   */
  async getSummary(): Promise<{
    complianceEnabled: boolean;
    seizeEnabled: boolean;
    blacklistedCount: number;
    totalMinted: string;
    totalBurned: string;
  }> {
    const config = await (this.program.account as any).stablecoinConfig.fetch(
      this.configAddress
    );
    const blacklisted = await this.blacklist.getAll();

    return {
      complianceEnabled: (config as any).enableTransferHook,
      seizeEnabled: (config as any).enablePermanentDelegate,
      blacklistedCount: blacklisted.length,
      totalMinted: (config as any).totalMinted.toString(),
      totalBurned: (config as any).totalBurned.toString(),
    };
  }
}
