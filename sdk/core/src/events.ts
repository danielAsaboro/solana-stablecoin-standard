/**
 * @module events
 *
 * Event parsing utilities for the Solana Stablecoin Standard.
 *
 * Provides strongly-typed event decoding from Anchor program logs,
 * transaction signatures, and real-time WebSocket subscriptions.
 *
 * ## Usage
 *
 * ```ts
 * import { SSSEventParser, SSSEventName } from "@stbr/sss-core-sdk";
 *
 * const parser = new SSSEventParser(program);
 *
 * // Parse from transaction logs
 * const events = parser.parseEvents(logs);
 * for (const event of events) {
 *   if (event.name === SSSEventName.TokensMinted) {
 *     console.log(`Minted ${event.data.amount} tokens`);
 *   }
 * }
 *
 * // Parse from a transaction signature
 * const events = await parser.parseTransaction(connection, signature);
 *
 * // Real-time subscription
 * const listenerId = parser.addEventListener(
 *   connection,
 *   SSSEventName.TokensMinted,
 *   (event, slot, signature) => {
 *     console.log(`Minted ${event.data.amount} at slot ${slot}`);
 *   },
 * );
 * // Later: await parser.removeEventListener(connection, listenerId);
 * ```
 *
 * @packageDocumentation
 */

import { Connection, Commitment, Finality, PublicKey } from "@solana/web3.js";
import {
  Program,
  EventParser as AnchorEventParser,
  BorshCoder,
} from "@coral-xyz/anchor";

import type {
  StablecoinInitializedEvent,
  TokensMintedEvent,
  TokensBurnedEvent,
  AccountFrozenEvent,
  AccountThawedEvent,
  StablecoinPausedEvent,
  StablecoinUnpausedEvent,
  RoleUpdatedEvent,
  MinterQuotaUpdatedEvent,
  AuthorityTransferredEvent,
  AddressBlacklistedEvent,
  AddressUnblacklistedEvent,
  TokensSeizedEvent,
} from "./types";

// ---------------------------------------------------------------------------
// Event name constants — type-safe string enum
// ---------------------------------------------------------------------------

/**
 * Enumeration of all SSS program event names.
 *
 * Use these constants for type-safe event filtering and `switch` narrowing
 * instead of raw string literals.
 *
 * @example
 * ```ts
 * const mints = events.filter(e => e.name === SSSEventName.TokensMinted);
 * ```
 */
export enum SSSEventName {
  StablecoinInitialized = "StablecoinInitialized",
  TokensMinted = "TokensMinted",
  TokensBurned = "TokensBurned",
  AccountFrozen = "AccountFrozen",
  AccountThawed = "AccountThawed",
  StablecoinPaused = "StablecoinPaused",
  StablecoinUnpaused = "StablecoinUnpaused",
  RoleUpdated = "RoleUpdated",
  MinterQuotaUpdated = "MinterQuotaUpdated",
  AuthorityTransferred = "AuthorityTransferred",
  AddressBlacklisted = "AddressBlacklisted",
  AddressUnblacklisted = "AddressUnblacklisted",
  TokensSeized = "TokensSeized",
}

// ---------------------------------------------------------------------------
// Discriminated union — enables TypeScript narrowing via `event.name`
// ---------------------------------------------------------------------------

/**
 * A parsed event with a specific name and its corresponding typed data.
 *
 * @typeParam N - The event name literal type
 * @typeParam D - The event data interface
 */
export interface TypedEvent<N extends SSSEventName, D> {
  /** The event name, usable as a discriminant in `switch` statements. */
  name: N;
  /** The decoded event data with fully typed fields. */
  data: D;
}

/**
 * Discriminated union of all SSS program events.
 *
 * TypeScript narrows the `data` type automatically when you check `event.name`:
 *
 * @example
 * ```ts
 * function handleEvent(event: SSSEvent) {
 *   switch (event.name) {
 *     case SSSEventName.TokensMinted:
 *       // event.data is TokensMintedEvent here
 *       console.log(event.data.amount.toString());
 *       break;
 *     case SSSEventName.AddressBlacklisted:
 *       // event.data is AddressBlacklistedEvent here
 *       console.log(event.data.reason);
 *       break;
 *   }
 * }
 * ```
 */
export type SSSEvent =
  | TypedEvent<SSSEventName.StablecoinInitialized, StablecoinInitializedEvent>
  | TypedEvent<SSSEventName.TokensMinted, TokensMintedEvent>
  | TypedEvent<SSSEventName.TokensBurned, TokensBurnedEvent>
  | TypedEvent<SSSEventName.AccountFrozen, AccountFrozenEvent>
  | TypedEvent<SSSEventName.AccountThawed, AccountThawedEvent>
  | TypedEvent<SSSEventName.StablecoinPaused, StablecoinPausedEvent>
  | TypedEvent<SSSEventName.StablecoinUnpaused, StablecoinUnpausedEvent>
  | TypedEvent<SSSEventName.RoleUpdated, RoleUpdatedEvent>
  | TypedEvent<SSSEventName.MinterQuotaUpdated, MinterQuotaUpdatedEvent>
  | TypedEvent<SSSEventName.AuthorityTransferred, AuthorityTransferredEvent>
  | TypedEvent<SSSEventName.AddressBlacklisted, AddressBlacklistedEvent>
  | TypedEvent<SSSEventName.AddressUnblacklisted, AddressUnblacklistedEvent>
  | TypedEvent<SSSEventName.TokensSeized, TokensSeizedEvent>;

// ---------------------------------------------------------------------------
// Type mapping — maps event name → event data interface
// ---------------------------------------------------------------------------

/**
 * Maps each {@link SSSEventName} to its corresponding event data interface.
 *
 * Useful for generic helpers that accept a specific event name and need
 * the matching data type:
 *
 * @example
 * ```ts
 * function logEvent<N extends SSSEventName>(
 *   name: N,
 *   data: SSSEventDataMap[N],
 * ) { ... }
 * ```
 */
export interface SSSEventDataMap {
  [SSSEventName.StablecoinInitialized]: StablecoinInitializedEvent;
  [SSSEventName.TokensMinted]: TokensMintedEvent;
  [SSSEventName.TokensBurned]: TokensBurnedEvent;
  [SSSEventName.AccountFrozen]: AccountFrozenEvent;
  [SSSEventName.AccountThawed]: AccountThawedEvent;
  [SSSEventName.StablecoinPaused]: StablecoinPausedEvent;
  [SSSEventName.StablecoinUnpaused]: StablecoinUnpausedEvent;
  [SSSEventName.RoleUpdated]: RoleUpdatedEvent;
  [SSSEventName.MinterQuotaUpdated]: MinterQuotaUpdatedEvent;
  [SSSEventName.AuthorityTransferred]: AuthorityTransferredEvent;
  [SSSEventName.AddressBlacklisted]: AddressBlacklistedEvent;
  [SSSEventName.AddressUnblacklisted]: AddressUnblacklistedEvent;
  [SSSEventName.TokensSeized]: TokensSeizedEvent;
}

/** Set of all valid SSS event names for fast membership checks. */
const VALID_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(SSSEventName)
);

// ---------------------------------------------------------------------------
// Event callback types
// ---------------------------------------------------------------------------

/**
 * Callback signature for {@link SSSEventParser.addEventListener}.
 *
 * @param event     - The parsed, strongly-typed event
 * @param slot      - The slot number in which the event was emitted
 * @param signature - The transaction signature containing the event
 */
export type SSSEventCallback<N extends SSSEventName = SSSEventName> = (
  event: TypedEvent<N, SSSEventDataMap[N]>,
  slot: number,
  signature: string,
) => void;

// ---------------------------------------------------------------------------
// SSSEventParser — main event parsing class
// ---------------------------------------------------------------------------

/**
 * Strongly-typed event parser for the Solana Stablecoin Standard program.
 *
 * Wraps Anchor's {@link AnchorEventParser} and produces {@link SSSEvent}
 * objects with full TypeScript type narrowing support.
 *
 * @example
 * ```ts
 * import { SSSEventParser, SSSEventName } from "@stbr/sss-core-sdk";
 *
 * // From a loaded SolanaStablecoin instance
 * const parser = new SSSEventParser(stablecoin.program);
 *
 * // Parse events from transaction logs
 * const events = parser.parseEvents(logs);
 *
 * // Filter to only mint events
 * const mints = parser.filterEvents(events, SSSEventName.TokensMinted);
 * // mints is TypedEvent<"TokensMinted", TokensMintedEvent>[]
 *
 * // Parse events from a confirmed transaction
 * const txEvents = await parser.parseTransaction(connection, txSignature);
 * ```
 */
export class SSSEventParser {
  /** @internal Anchor's underlying event parser. */
  private readonly anchorParser: AnchorEventParser;

  /** @internal The SSS program ID. */
  private readonly programId: PublicKey;

  /** @internal The Anchor Program reference for WebSocket subscriptions. */
  private readonly program: Program;

  /**
   * Create a new SSSEventParser.
   *
   * @param program - The Anchor Program instance for the SSS program.
   *                  Typically obtained via `stablecoin.program`.
   */
  constructor(program: Program) {
    this.program = program;
    this.programId = program.programId;
    this.anchorParser = new AnchorEventParser(
      program.programId,
      new BorshCoder(program.idl),
    );
  }

  // -----------------------------------------------------------------
  // Parsing from logs
  // -----------------------------------------------------------------

  /**
   * Parse SSS events from an array of transaction log strings.
   *
   * Anchor events appear in logs as `"Program data: <base64>"` entries.
   * This method decodes them into strongly-typed {@link SSSEvent} objects.
   *
   * @param logs - Array of log strings from a transaction
   *               (e.g., from `connection.getTransaction()` or simulation).
   * @returns Array of parsed events. Non-SSS log entries are silently skipped.
   *
   * @example
   * ```ts
   * const tx = await connection.getTransaction(sig, {
   *   commitment: "confirmed",
   *   maxSupportedTransactionVersion: 0,
   * });
   * const events = parser.parseEvents(tx.meta.logMessages ?? []);
   * ```
   */
  parseEvents(logs: string[]): SSSEvent[] {
    const events: SSSEvent[] = [];
    const generator = this.anchorParser.parseLogs(logs, false);
    for (const raw of generator) {
      if (VALID_EVENT_NAMES.has(raw.name)) {
        events.push({ name: raw.name as SSSEventName, data: raw.data });
      }
    }
    return events;
  }

  // -----------------------------------------------------------------
  // Parsing from transaction signature
  // -----------------------------------------------------------------

  /**
   * Fetch a confirmed transaction by signature and parse all SSS events from it.
   *
   * This is a convenience method that combines `connection.getTransaction()`
   * with {@link parseEvents}.
   *
   * @param connection - Solana RPC connection
   * @param signature  - The transaction signature (base-58 string)
   * @param finality   - Desired finality level (default: `"confirmed"`)
   * @returns Array of parsed events from the transaction.
   *          Returns an empty array if the transaction is not found or has no logs.
   *
   * @example
   * ```ts
   * const sig = await stablecoin.mint(1_000_000)
   *   .to(recipient)
   *   .by(minterKeypair)
   *   .send(payerKeypair);
   *
   * const events = await parser.parseTransaction(connection, sig);
   * // events[0].name === "TokensMinted"
   * ```
   */
  async parseTransaction(
    connection: Connection,
    signature: string,
    finality: Finality = "confirmed",
  ): Promise<SSSEvent[]> {
    const tx = await connection.getTransaction(signature, {
      commitment: finality,
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta?.logMessages) {
      return [];
    }
    return this.parseEvents(tx.meta.logMessages);
  }

  // -----------------------------------------------------------------
  // Type-safe event filtering
  // -----------------------------------------------------------------

  /**
   * Filter an array of events to only those matching a specific event name.
   *
   * TypeScript narrows the return type automatically based on the name:
   *
   * @typeParam N - The event name to filter by
   * @param events - Array of parsed events
   * @param name   - The event name to filter for
   * @returns Narrowed array containing only events of the specified type
   *
   * @example
   * ```ts
   * const allEvents = parser.parseEvents(logs);
   * const mints = parser.filterEvents(allEvents, SSSEventName.TokensMinted);
   * // TypeScript knows: mints[0].data.amount is BN
   * // TypeScript knows: mints[0].data.minterTotalMinted is BN
   * ```
   */
  filterEvents<N extends SSSEventName>(
    events: SSSEvent[],
    name: N,
  ): TypedEvent<N, SSSEventDataMap[N]>[] {
    const result: TypedEvent<N, SSSEventDataMap[N]>[] = [];
    for (const e of events) {
      if (e.name === name) {
        result.push(e as TypedEvent<N, SSSEventDataMap[N]>);
      }
    }
    return result;
  }

  // -----------------------------------------------------------------
  // Real-time event subscription
  // -----------------------------------------------------------------

  /**
   * Subscribe to SSS events in real-time via WebSocket.
   *
   * Listens for all program log events and invokes the callback for each
   * event matching the specified name. Returns a listener ID that can be
   * used with {@link removeEventListener} to unsubscribe.
   *
   * @typeParam N - The event name to listen for
   * @param connection - Solana RPC connection (must support WebSocket)
   * @param eventName  - The specific event name to subscribe to
   * @param callback   - Function invoked for each matching event
   * @param commitment - Desired commitment level (default: `"confirmed"`)
   * @returns A listener ID for later removal
   *
   * @example
   * ```ts
   * const listenerId = parser.addEventListener(
   *   connection,
   *   SSSEventName.TokensMinted,
   *   (event, slot, sig) => {
   *     console.log(`Minted ${event.data.amount} at slot ${slot}`);
   *     console.log(`Tx: ${sig}`);
   *   },
   * );
   *
   * // Later, to unsubscribe:
   * await parser.removeEventListener(connection, listenerId);
   * ```
   */
  addEventListener<N extends SSSEventName>(
    connection: Connection,
    eventName: N,
    callback: SSSEventCallback<N>,
    commitment: Commitment = "confirmed",
  ): number {
    // Cast required: Anchor's addEventListener is generic over IDL event names,
    // but our Program instance uses the base Idl type. The cast is safe because
    // SSSEventName values match the IDL event names exactly.
    const addListener = this.program.addEventListener.bind(this.program) as (
      name: string,
      cb: (data: unknown, slot: number, sig: string) => void,
      commitment?: Commitment,
    ) => number;

    return addListener(
      eventName,
      (data: unknown, slot: number, sig: string) => {
        const typedEvent: TypedEvent<N, SSSEventDataMap[N]> = {
          name: eventName,
          data: data as SSSEventDataMap[N],
        };
        callback(typedEvent, slot, sig);
      },
      commitment,
    );
  }

  /**
   * Subscribe to **all** SSS events in real-time via WebSocket.
   *
   * Unlike {@link addEventListener}, this subscribes to every event type
   * and invokes the callback with the full {@link SSSEvent} union.
   *
   * @param connection - Solana RPC connection (must support WebSocket)
   * @param callback   - Function invoked for each event
   * @param commitment - Desired commitment level (default: `"confirmed"`)
   * @returns Array of listener IDs (one per event type). Pass to
   *          {@link removeAllEventListeners} to unsubscribe.
   *
   * @example
   * ```ts
   * const listenerIds = parser.addAllEventListeners(
   *   connection,
   *   (event, slot, sig) => {
   *     console.log(`[${event.name}] at slot ${slot}`);
   *   },
   * );
   *
   * // Later:
   * await parser.removeAllEventListeners(connection, listenerIds);
   * ```
   */
  addAllEventListeners(
    connection: Connection,
    callback: SSSEventCallback,
    commitment: Commitment = "confirmed",
  ): number[] {
    const listenerIds: number[] = [];
    for (const name of Object.values(SSSEventName)) {
      const id = this.addEventListener(
        connection,
        name,
        callback as SSSEventCallback<typeof name>,
        commitment,
      );
      listenerIds.push(id);
    }
    return listenerIds;
  }

  /**
   * Remove an event listener by its ID.
   *
   * @param connection - The same connection used when subscribing (unused;
   *                     kept for API symmetry and future-proofing)
   * @param listenerId - The listener ID returned by {@link addEventListener}
   */
  async removeEventListener(
    _connection: Connection,
    listenerId: number,
  ): Promise<void> {
    await this.program.removeEventListener(listenerId);
  }

  /**
   * Remove multiple event listeners by their IDs.
   *
   * @param connection  - The same connection used when subscribing
   * @param listenerIds - Array of listener IDs (from {@link addAllEventListeners})
   */
  async removeAllEventListeners(
    _connection: Connection,
    listenerIds: number[],
  ): Promise<void> {
    await Promise.all(
      listenerIds.map((id) => this.program.removeEventListener(id)),
    );
  }
}

// ---------------------------------------------------------------------------
// Standalone helper functions
// ---------------------------------------------------------------------------

/**
 * Parse SSS events from transaction log strings without needing an
 * {@link SSSEventParser} instance.
 *
 * This is a convenience function for one-off parsing. For repeated use,
 * prefer creating an {@link SSSEventParser} instance to avoid re-creating
 * the Anchor coder on each call.
 *
 * @param program - The Anchor Program instance for the SSS program
 * @param logs    - Array of log strings from a transaction
 * @returns Array of parsed {@link SSSEvent} objects
 *
 * @example
 * ```ts
 * import { parseEvents } from "@stbr/sss-core-sdk";
 *
 * const events = parseEvents(stablecoin.program, logs);
 * ```
 */
export function parseEvents(program: Program, logs: string[]): SSSEvent[] {
  const parser = new SSSEventParser(program);
  return parser.parseEvents(logs);
}

/**
 * Fetch a transaction and parse SSS events from it.
 *
 * Convenience wrapper — equivalent to:
 * ```ts
 * new SSSEventParser(program).parseTransaction(connection, signature);
 * ```
 *
 * @param program    - The Anchor Program instance
 * @param connection - Solana RPC connection
 * @param signature  - Transaction signature (base-58)
 * @param finality   - Finality level (default: `"confirmed"`)
 * @returns Array of parsed events
 */
export async function parseTransaction(
  program: Program,
  connection: Connection,
  signature: string,
  finality: Finality = "confirmed",
): Promise<SSSEvent[]> {
  const parser = new SSSEventParser(program);
  return parser.parseTransaction(connection, signature, finality);
}
