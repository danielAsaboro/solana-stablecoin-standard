/**
 * @stbr/sss-compliance-sdk — Solana Stablecoin Standard Compliance Extensions
 *
 * Standalone compliance utilities for SSS-2 stablecoins. Provides read-only
 * access to blacklist state and on-chain audit logs without requiring the
 * full core SDK.
 *
 * ## Quick Start
 * ```ts
 * import { ComplianceModule } from "@stbr/sss-compliance-sdk";
 *
 * const compliance = new ComplianceModule(program, connection, mint, config);
 * const summary = await compliance.getSummary();
 * const isBlocked = await compliance.blacklist.isBlacklisted(address);
 * const history = await compliance.audit.getEntries({ action: "seize" });
 * ```
 *
 * @module @stbr/sss-compliance-sdk
 * @packageDocumentation
 */

export { ComplianceModule } from "./compliance";
export { BlacklistManager } from "./blacklist";
export { AuditLog, AuditEntry, AuditFilter } from "./audit";
