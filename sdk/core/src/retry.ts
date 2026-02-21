/**
 * @module retry
 *
 * Automatic retry with exponential backoff for transient Solana RPC failures.
 *
 * Provides configurable retry logic that distinguishes between transient
 * errors (rate limits, timeouts, network issues) and permanent errors
 * (program failures, insufficient funds, invalid accounts). Only transient
 * errors trigger retries — permanent errors propagate immediately.
 *
 * @example
 * ```ts
 * import { withRetry, DEFAULT_RETRY_CONFIG } from "@stbr/sss-core-sdk";
 *
 * // Standalone usage
 * const result = await withRetry(
 *   () => connection.getLatestBlockhash(),
 *   { maxRetries: 5, initialDelayMs: 200 }
 * );
 *
 * // Via builder pattern
 * const sig = await stablecoin.mint(1_000_000)
 *   .to(recipient)
 *   .by(minter)
 *   .withRetry({ maxRetries: 3 })
 *   .send(payer);
 * ```
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// RetryConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for automatic retry with exponential backoff.
 *
 * All fields are optional when passed to `withRetry()` or `.withRetry()` —
 * missing fields are filled from {@link DEFAULT_RETRY_CONFIG}.
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts after the initial call.
   * Total attempts = 1 (initial) + maxRetries.
   * @default 3
   */
  maxRetries: number;

  /**
   * Initial delay in milliseconds before the first retry.
   * Subsequent delays are multiplied by {@link backoffMultiplier}.
   * @default 500
   */
  initialDelayMs: number;

  /**
   * Maximum delay between retries in milliseconds.
   * Prevents exponential growth from producing unreasonably long waits.
   * @default 10000
   */
  maxDelayMs: number;

  /**
   * Multiplier applied to the delay after each retry.
   * A value of 2.0 produces classic exponential backoff (500, 1000, 2000, …).
   * @default 2.0
   */
  backoffMultiplier: number;

  /**
   * When true, adds random jitter (0–50% of delay) to each wait period
   * to avoid the thundering herd problem when many clients retry simultaneously.
   * @default true
   */
  jitter: boolean;

  /**
   * Optional callback invoked before each retry attempt.
   * Useful for logging, metrics, or user feedback.
   *
   * @param error   - The error that triggered the retry
   * @param attempt - The upcoming retry number (1-based)
   * @param delayMs - The delay before the retry starts
   */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

/**
 * Sensible default retry configuration.
 *
 * - 3 retries (4 total attempts)
 * - 500ms initial delay with 2x exponential backoff (500 → 1000 → 2000)
 * - 10s maximum delay cap
 * - Jitter enabled to prevent thundering herd
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  backoffMultiplier: 2.0,
  jitter: true,
};

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Message patterns that indicate a transient RPC or network failure.
 *
 * These errors are safe to retry because they don't indicate a logic
 * error in the transaction — the same transaction may succeed on the
 * next attempt with a fresh blockhash or a different RPC node.
 *
 * @internal
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  // HTTP transport errors
  /429/,
  /too many requests/i,
  /rate limit/i,
  /502/,
  /503/,
  /504/,
  /bad gateway/i,
  /service unavailable/i,
  /gateway timeout/i,

  // Node.js / network-level errors
  /ECONNREFUSED/,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /EPIPE/,
  /ENOTFOUND/,
  /socket hang up/i,
  /network request failed/i,
  /fetch failed/i,

  // Solana RPC transient failures
  /blockhash not found/i,
  /was not confirmed in/i,
  /block height exceeded/i,
  /Node is behind/i,
  /node is unhealthy/i,
  /server responded with/i,

  // JSON-RPC internal errors (often transient server-side issues)
  /-32603/,
  /-32005/, // Node behind / slot behind
  /internal error/i,
];

/**
 * Message patterns that indicate a permanent (non-retryable) failure.
 *
 * Checked before transient patterns — if an error matches a permanent
 * pattern, it is never retried regardless of other matches.
 *
 * @internal
 */
const PERMANENT_PATTERNS: RegExp[] = [
  // Insufficient funds / balance issues
  /insufficient funds/i,
  /insufficient lamports/i,
  /0x1/, // InsufficientFunds in Token program

  // Account issues
  /account not found/i,
  /already in use/i,
  /already initialized/i,

  // Signature / authorization
  /signature verification/i,
  /missing signature/i,
  /unauthorized/i,

  // Program errors (Anchor custom errors are 6xxx)
  /custom program error/i,
  /program error/i,

  // Simulation failures indicate logic errors
  /simulation failed/i,
  /transaction precompile verification failure/i,

  // Invalid input
  /invalid instruction data/i,
  /invalid account data/i,
  /invalid program id/i,
  /account data too small/i,
];

/**
 * Determine whether an error is a transient RPC/network failure
 * that is safe to retry.
 *
 * The classification logic:
 * 1. If the error message matches any permanent pattern → not transient
 * 2. If the error message matches any transient pattern → transient
 * 3. Otherwise → not transient (unknown errors are not retried)
 *
 * @param error - The caught error (any type)
 * @returns `true` if the error is transient and should be retried
 *
 * @example
 * ```ts
 * try {
 *   await connection.sendTransaction(tx, signers);
 * } catch (err) {
 *   if (isTransientError(err)) {
 *     console.log("Transient failure, will retry...");
 *   } else {
 *     throw err; // Permanent failure
 *   }
 * }
 * ```
 */
export function isTransientError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  if (!message) return false;

  // Permanent patterns take priority — never retry these
  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(message)) return false;
  }

  // Check transient patterns
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(message)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// SSSTransactionError
// ---------------------------------------------------------------------------

/**
 * Enhanced error class for stablecoin transaction failures.
 *
 * Wraps the original error with retry context: how many attempts were
 * made, whether the error was classified as transient, and the original
 * error for inspection.
 */
export class SSSTransactionError extends Error {
  /** The original error that caused the failure. */
  public readonly cause: Error;
  /** Number of attempts made (including the initial call). */
  public readonly attempts: number;
  /** Whether the final error was classified as transient. */
  public readonly wasTransient: boolean;

  constructor(message: string, cause: Error, attempts: number, wasTransient: boolean) {
    super(message);
    this.name = "SSSTransactionError";
    this.cause = cause;
    this.attempts = attempts;
    this.wasTransient = wasTransient;
  }
}

// ---------------------------------------------------------------------------
// Core retry logic
// ---------------------------------------------------------------------------

/**
 * Execute an async operation with automatic retry and exponential backoff.
 *
 * Only retries when the error is classified as transient by
 * {@link isTransientError}. Permanent errors propagate immediately
 * without consuming retry attempts.
 *
 * On exhaustion of all retries, throws an {@link SSSTransactionError}
 * wrapping the last error with context about the retry history.
 *
 * @typeParam T - The return type of the operation
 * @param fn     - The async operation to execute
 * @param config - Partial retry configuration (merged with {@link DEFAULT_RETRY_CONFIG})
 * @returns The result of the operation
 * @throws {SSSTransactionError} After all retries are exhausted
 * @throws The original error if it is not transient
 *
 * @example
 * ```ts
 * const blockhash = await withRetry(
 *   () => connection.getLatestBlockhash(),
 *   {
 *     maxRetries: 5,
 *     onRetry: (err, attempt, delay) => {
 *       console.log(`Retry ${attempt} in ${delay}ms: ${err.message}`);
 *     },
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<T> {
  const resolved: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;
  let delay = resolved.initialDelayMs;

  for (let attempt = 0; attempt <= resolved.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = toError(err);

      // Don't retry permanent errors — fail fast
      if (!isTransientError(err)) {
        throw lastError;
      }

      // If this was the last allowed attempt, break and throw below
      if (attempt === resolved.maxRetries) {
        break;
      }

      // Calculate delay with optional jitter
      let waitMs = Math.min(delay, resolved.maxDelayMs);
      if (resolved.jitter) {
        // Add 0–50% random jitter
        waitMs += Math.floor(Math.random() * waitMs * 0.5);
      }

      // Notify callback before waiting
      if (resolved.onRetry) {
        resolved.onRetry(lastError, attempt + 1, waitMs);
      }

      await sleep(waitMs);
      delay *= resolved.backoffMultiplier;
    }
  }

  // All retries exhausted
  throw new SSSTransactionError(
    `Operation failed after ${resolved.maxRetries + 1} attempts: ${lastError?.message ?? "unknown error"}`,
    lastError ?? new Error("unknown error"),
    resolved.maxRetries + 1,
    true
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a string message from an unknown error value.
 * @internal
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error !== null && error !== undefined && typeof error === "object") {
    // Handle Solana SendTransactionError which has `message` and `logs`
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    // Some RPC errors put the message in `error.message`
    if (
      obj.error !== null &&
      obj.error !== undefined &&
      typeof obj.error === "object" &&
      typeof (obj.error as Record<string, unknown>).message === "string"
    ) {
      return (obj.error as Record<string, unknown>).message as string;
    }
  }
  return String(error);
}

/**
 * Coerce an unknown value to an Error instance.
 * @internal
 */
function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : String(err));
}

/**
 * Promise-based sleep.
 * @internal
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
