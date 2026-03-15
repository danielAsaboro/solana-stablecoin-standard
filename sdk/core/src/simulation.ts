/**
 * @module simulation
 *
 * Transaction simulation and pre-flight validation for the Solana Stablecoin Standard SDK.
 *
 * Provides a simulation layer that dry-runs transactions against the Solana
 * runtime and translates raw error codes into human-readable messages. This
 * module is used internally by the builder pattern's `.withSimulation()` and
 * `.dryRun()` methods, but can also be used standalone.
 *
 * @example
 * ```ts
 * import { simulateTransaction, formatSimulationError } from "@stbr/sss-core-sdk";
 *
 * // Simulate a transaction and inspect the result
 * const result = await simulateTransaction(connection, tx);
 * if (!result.success) {
 *   console.error(result.error);        // Human-readable message
 *   console.error(result.programError); // Parsed program error details
 *   console.error(result.logs);         // Full simulation logs
 * } else {
 *   console.log(`Compute units: ${result.unitsConsumed}`);
 * }
 * ```
 *
 * @packageDocumentation
 */

import {
  Connection,
  Transaction,
  SimulatedTransactionResponse,
  RpcResponseAndContext,
} from "@solana/web3.js";

// ---------------------------------------------------------------------------
// SSS program error codes (Anchor offset = 6000)
// ---------------------------------------------------------------------------

/**
 * Maps SSS program custom error codes to human-readable messages.
 *
 * Anchor custom errors start at offset 6000. The order must match the
 * `StablecoinError` enum in `programs/sss/src/error.rs`.
 *
 * @internal
 */
const SSS_ERROR_CODES: Record<number, { name: string; message: string }> = {
  6000: {
    name: "Unauthorized",
    message: "Caller lacks the required role for this operation",
  },
  6001: {
    name: "Paused",
    message: "Stablecoin is paused — mint and burn operations are blocked",
  },
  6002: {
    name: "NotPaused",
    message: "Stablecoin is not paused — cannot unpause",
  },
  6003: {
    name: "QuotaExceeded",
    message:
      "Minter quota exceeded — request a higher quota from the master authority",
  },
  6004: { name: "ZeroAmount", message: "Amount must be greater than zero" },
  6005: {
    name: "NameTooLong",
    message: "Name exceeds maximum length (32 characters)",
  },
  6006: {
    name: "SymbolTooLong",
    message: "Symbol exceeds maximum length (10 characters)",
  },
  6007: {
    name: "UriTooLong",
    message: "URI exceeds maximum length (200 characters)",
  },
  6008: {
    name: "ReasonTooLong",
    message: "Blacklist reason exceeds maximum length (64 characters)",
  },
  6009: {
    name: "InvalidRole",
    message:
      "Invalid role type — must be 0-4 (Minter, Burner, Pauser, Blacklister, Seizer)",
  },
  6010: {
    name: "ComplianceNotEnabled",
    message:
      "Compliance features not enabled — this stablecoin uses SSS-1 preset (no blacklist/seize)",
  },
  6011: {
    name: "PermanentDelegateNotEnabled",
    message: "Permanent delegate not enabled — required for seize operations",
  },
  6012: {
    name: "AlreadyBlacklisted",
    message: "Address is already blacklisted",
  },
  6013: {
    name: "NotBlacklisted",
    message: "Address is not blacklisted — cannot remove",
  },
  6014: {
    name: "MathOverflow",
    message: "Arithmetic overflow — amount too large",
  },
  6015: {
    name: "InvalidAuthority",
    message: "Invalid authority — signer is not the master authority",
  },
  6016: {
    name: "SameAuthority",
    message: "Cannot transfer authority to the same address",
  },
  6017: {
    name: "InvalidDecimals",
    message: "Invalid decimals — must be between 0 and 9",
  },
};

/**
 * Maps transfer hook program error codes to human-readable messages.
 *
 * @internal
 */
const HOOK_ERROR_CODES: Record<number, { name: string; message: string }> = {
  6000: {
    name: "SourceBlacklisted",
    message:
      "Source address is blacklisted — transfer blocked by compliance hook",
  },
  6001: {
    name: "DestinationBlacklisted",
    message:
      "Destination address is blacklisted — transfer blocked by compliance hook",
  },
  6002: {
    name: "InvalidExtraAccountMetas",
    message: "Invalid extra account metas — transfer hook misconfigured",
  },
};

/**
 * Common Anchor framework error codes.
 *
 * @internal
 */
const ANCHOR_ERROR_CODES: Record<number, { name: string; message: string }> = {
  2000: {
    name: "ConstraintMut",
    message: "Account constraint violated: account is not mutable",
  },
  2001: {
    name: "ConstraintHasOne",
    message: "Account constraint violated: has_one check failed",
  },
  2003: {
    name: "ConstraintSeeds",
    message: "Account constraint violated: PDA seeds mismatch",
  },
  2006: {
    name: "ConstraintOwner",
    message: "Account constraint violated: wrong program owner",
  },
  2009: {
    name: "ConstraintAddress",
    message: "Account constraint violated: address mismatch",
  },
  2012: {
    name: "ConstraintSpace",
    message: "Account constraint violated: insufficient space",
  },
  2019: {
    name: "ConstraintTokenMint",
    message: "Token account mint does not match expected mint",
  },
  2020: {
    name: "ConstraintTokenOwner",
    message: "Token account owner does not match expected owner",
  },
  3000: {
    name: "AccountDiscriminatorMismatch",
    message: "Account discriminator mismatch — wrong account type",
  },
  3001: {
    name: "AccountDiscriminatorNotFound",
    message: "Account discriminator not found — account may not be initialized",
  },
  3002: {
    name: "AccountNotEnoughKeys",
    message: "Not enough account keys provided",
  },
  3003: {
    name: "AccountNotMutable",
    message: "Account is not marked as mutable",
  },
  3004: {
    name: "AccountOwnedByWrongProgram",
    message: "Account owned by wrong program",
  },
  3007: {
    name: "AccountDidNotSerialize",
    message: "Account data failed to serialize",
  },
  3008: {
    name: "AccountDidNotDeserialize",
    message:
      "Account data failed to deserialize — account may not exist or is corrupted",
  },
  3012: {
    name: "AccountNotInitialized",
    message: "Account not initialized — may need to create it first",
  },
};

/**
 * Token program error codes (SPL Token / Token-2022).
 *
 * @internal
 */
const TOKEN_ERROR_CODES: Record<number, { name: string; message: string }> = {
  0: { name: "NotRentExempt", message: "Token account is not rent-exempt" },
  1: {
    name: "InsufficientFunds",
    message: "Insufficient token balance for this operation",
  },
  2: {
    name: "InvalidMint",
    message: "Invalid mint — token account mint does not match",
  },
  3: { name: "MintMismatch", message: "Mint mismatch between accounts" },
  4: { name: "OwnerMismatch", message: "Token account owner mismatch" },
  5: {
    name: "FixedSupply",
    message: "Token has a fixed supply — minting not allowed",
  },
  6: { name: "AlreadyInUse", message: "Account already in use" },
  10: {
    name: "AccountFrozen",
    message: "Token account is frozen — thaw it before transferring",
  },
  13: {
    name: "MintCannotFreeze",
    message: "Mint cannot freeze — freeze authority not set",
  },
  14: {
    name: "AccountBusy",
    message: "Token account has a pending transaction",
  },
  17: { name: "MintDecimalsMismatch", message: "Mint decimals mismatch" },
};

// ---------------------------------------------------------------------------
// SimulationResult
// ---------------------------------------------------------------------------

/**
 * Parsed program-specific error from a simulation failure.
 */
export interface ProgramError {
  /** The program that raised the error (e.g., "SSS", "TransferHook", "Token", "Anchor"). */
  program: string;
  /** The numeric error code. */
  code: number;
  /** The error name (e.g., "QuotaExceeded", "SourceBlacklisted"). */
  name: string;
  /** A human-readable explanation of what went wrong and how to fix it. */
  message: string;
}

/**
 * Result of a transaction simulation.
 *
 * Provides both the raw Solana simulation response and a parsed,
 * human-readable interpretation of any errors.
 */
export interface SimulationResult {
  /** Whether the simulation succeeded (no errors). */
  success: boolean;
  /** Human-readable error message, or `null` on success. */
  error: string | null;
  /** Parsed program error details, or `null` if the error wasn't from a known program. */
  programError: ProgramError | null;
  /** Compute units consumed by the simulation. */
  unitsConsumed: number;
  /** Full simulation logs. */
  logs: string[];
  /** The raw simulation response from the RPC node. */
  raw: RpcResponseAndContext<SimulatedTransactionResponse>;
}

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

/**
 * Extract an Anchor custom error code from simulation logs.
 *
 * Anchor logs errors as:
 * `Program <id> failed: custom program error: 0x<hex>`
 *
 * @internal
 */
function extractCustomErrorCode(
  logs: string[],
): { code: number; programId: string } | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i];

    // Anchor / BPF custom program error pattern
    const customMatch = line.match(
      /Program (\w+) failed: custom program error: 0x([0-9a-fA-F]+)/,
    );
    if (customMatch) {
      return {
        programId: customMatch[1],
        code: parseInt(customMatch[2], 16),
      };
    }
  }
  return null;
}

/**
 * Extract a Token program error code from simulation logs.
 *
 * Token program errors appear as:
 * `Program TokenkegQ... failed: Error processing Instruction 0: custom program error: 0x<hex>`
 *
 * @internal
 */
function extractTokenError(logs: string[]): number | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i];
    // Token-2022 or Token program
    if (
      (line.includes("TokenkegQ") || line.includes("TokenzQd")) &&
      line.includes("custom program error")
    ) {
      const match = line.match(/custom program error: 0x([0-9a-fA-F]+)/);
      if (match) {
        return parseInt(match[1], 16);
      }
    }
  }
  return null;
}

/**
 * Extract a human-readable error from the simulation logs.
 *
 * Looks for common Solana runtime error patterns beyond custom program errors.
 *
 * @internal
 */
function extractRuntimeError(logs: string[]): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i];

    // Account not found
    if (line.includes("AccountNotFound")) {
      return "Account not found — the specified account does not exist on-chain";
    }

    // Missing signer
    if (line.includes("missing required signature")) {
      return "Missing required signature — ensure all required signers are included";
    }

    // Insufficient lamports
    if (line.includes("insufficient lamports")) {
      const match = line.match(/insufficient lamports (\d+), need (\d+)/);
      if (match) {
        return `Insufficient SOL balance: have ${Number(match[1]) / 1e9} SOL, need ${Number(match[2]) / 1e9} SOL`;
      }
      return "Insufficient SOL balance for this transaction";
    }

    // Already in use (init collision)
    if (line.includes("already in use")) {
      return "Account already exists — it may have been initialized in a previous transaction";
    }

    // Instruction error with index
    if (line.includes("Error processing Instruction")) {
      const ixMatch = line.match(/Error processing Instruction (\d+)/);
      if (ixMatch) {
        // Find the specific error after
        const errorDetail = line.split(": ").slice(1).join(": ");
        if (errorDetail && !errorDetail.includes("custom program error")) {
          return `Instruction ${ixMatch[1]} failed: ${errorDetail}`;
        }
      }
    }
  }
  return null;
}

/**
 * Parse a program error from the error code and program ID.
 *
 * Checks SSS program errors, transfer hook errors, Anchor framework errors,
 * and Token program errors in order.
 *
 * @internal
 */
function parseProgramError(
  code: number,
  programId: string,
  logs: string[],
): ProgramError | null {
  // Check SSS program errors first (most common for this SDK)
  const sssError = SSS_ERROR_CODES[code];
  if (sssError) {
    return { program: "SSS", code, ...sssError };
  }

  // Check if it's from a transfer hook program
  const isHook =
    logs.some((l) => l.includes(programId) && l.includes("transfer_hook")) ||
    programId !==
      logs.find((l) => l.includes("Program log: Instruction:"))?.split(" ")[1];

  // If the code is in the hook range and it looks like a hook invocation
  const hookError = HOOK_ERROR_CODES[code];
  if (hookError && isHook) {
    return { program: "TransferHook", code, ...hookError };
  }

  // Check Anchor framework errors
  const anchorError = ANCHOR_ERROR_CODES[code];
  if (anchorError) {
    return { program: "Anchor", code, ...anchorError };
  }

  // Check Token program errors
  const tokenError = TOKEN_ERROR_CODES[code];
  if (tokenError) {
    return { program: "Token", code, ...tokenError };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Simulate a transaction and return a structured result with parsed errors.
 *
 * This function dry-runs the transaction against the Solana runtime without
 * sending it. If the simulation fails, it parses the error into a
 * human-readable message and identifies the failing program.
 *
 * @param connection - Solana RPC connection
 * @param transaction - The transaction to simulate
 * @returns A structured {@link SimulationResult}
 *
 * @example
 * ```ts
 * const tx = await stablecoin.mint(1_000_000)
 *   .to(recipient)
 *   .by(minter)
 *   .transaction(payer.publicKey);
 *
 * const result = await simulateTransaction(connection, tx);
 *
 * if (!result.success) {
 *   console.error(`Simulation failed: ${result.error}`);
 *   if (result.programError) {
 *     console.error(`  Program: ${result.programError.program}`);
 *     console.error(`  Code: ${result.programError.code} (${result.programError.name})`);
 *   }
 *   console.error("Logs:", result.logs);
 * } else {
 *   console.log(`Will consume ~${result.unitsConsumed} compute units`);
 * }
 * ```
 */
export async function simulateTransaction(
  connection: Connection,
  transaction: Transaction,
): Promise<SimulationResult> {
  const raw = await connection.simulateTransaction(transaction);
  const logs = raw.value.logs ?? [];
  const unitsConsumed = raw.value.unitsConsumed ?? 0;

  // Success case
  if (!raw.value.err) {
    return {
      success: true,
      error: null,
      programError: null,
      unitsConsumed,
      logs,
      raw,
    };
  }

  // Parse the error
  let programError: ProgramError | null = null;
  let error: string | null = null;

  // Try to extract a custom program error code
  const extracted = extractCustomErrorCode(logs);
  if (extracted) {
    programError = parseProgramError(extracted.code, extracted.programId, logs);
    if (programError) {
      error = `${programError.program} error: ${programError.message} (${programError.name}, code ${programError.code})`;
    } else {
      error = `Program ${extracted.programId} failed with custom error code ${extracted.code} (0x${extracted.code.toString(16)})`;
    }
  }

  // Try Token program errors if no custom error was found
  if (!error) {
    const tokenCode = extractTokenError(logs);
    if (tokenCode !== null) {
      const tokenError = TOKEN_ERROR_CODES[tokenCode];
      if (tokenError) {
        programError = { program: "Token", code: tokenCode, ...tokenError };
        error = `Token error: ${tokenError.message} (${tokenError.name})`;
      } else {
        error = `Token program error code ${tokenCode}`;
      }
    }
  }

  // Try runtime errors if no program error was found
  if (!error) {
    error = extractRuntimeError(logs);
  }

  // Fallback to raw error
  if (!error) {
    error = `Simulation failed: ${JSON.stringify(raw.value.err)}`;
  }

  return {
    success: false,
    error,
    programError,
    unitsConsumed,
    logs,
    raw,
  };
}

/**
 * Format a simulation error into a multi-line diagnostic string.
 *
 * Useful for logging or displaying detailed simulation failure information
 * to operators or developers.
 *
 * @param result - A failed simulation result
 * @returns A formatted diagnostic string
 *
 * @example
 * ```ts
 * const result = await simulateTransaction(connection, tx);
 * if (!result.success) {
 *   console.error(formatSimulationError(result));
 *   // Output:
 *   // Transaction Simulation Failed
 *   // ─────────────────────────────
 *   // Error: SSS error: Minter quota exceeded (QuotaExceeded, code 6003)
 *   // Program: SSS
 *   // Code: 6003 (QuotaExceeded)
 *   // Compute Units: 12345
 *   // Logs:
 *   //   Program log: ...
 *   //   Program log: ...
 *   // ─────────────────────────────
 * }
 * ```
 */
export function formatSimulationError(result: SimulationResult): string {
  if (result.success) return "Simulation succeeded.";

  const lines: string[] = [
    "Transaction Simulation Failed",
    "─────────────────────────────",
    `Error: ${result.error}`,
  ];

  if (result.programError) {
    lines.push(`Program: ${result.programError.program}`);
    lines.push(
      `Code: ${result.programError.code} (${result.programError.name})`,
    );
  }

  lines.push(`Compute Units: ${result.unitsConsumed}`);

  if (result.logs.length > 0) {
    lines.push("Logs:");
    // Show the last 20 log lines to keep output manageable
    const displayLogs = result.logs.slice(-20);
    if (result.logs.length > 20) {
      lines.push(`  ... (${result.logs.length - 20} earlier lines omitted)`);
    }
    for (const log of displayLogs) {
      lines.push(`  ${log}`);
    }
  }

  lines.push("─────────────────────────────");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// SSSSimulationError
// ---------------------------------------------------------------------------

/**
 * Error thrown when a pre-flight simulation detects a transaction failure.
 *
 * Contains the full {@link SimulationResult} for inspection, plus a
 * human-readable message. Thrown by `.dryRun()` and `.withSimulation()`
 * on the builder pattern.
 */
export class SSSSimulationError extends Error {
  /** The full simulation result with logs, error details, and raw response. */
  public readonly simulationResult: SimulationResult;
  /** The parsed program error, if one was identified. */
  public readonly programError: ProgramError | null;
  /** Compute units consumed before the failure. */
  public readonly unitsConsumed: number;

  constructor(result: SimulationResult) {
    super(result.error ?? "Transaction simulation failed");
    this.name = "SSSSimulationError";
    this.simulationResult = result;
    this.programError = result.programError;
    this.unitsConsumed = result.unitsConsumed;
  }
}
