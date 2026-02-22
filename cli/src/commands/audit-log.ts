/**
 * CLI command: `sss-token audit-log`
 *
 * Queries on-chain transaction history for the stablecoin config PDA,
 * parses Anchor event logs, and displays a formatted audit trail.
 * Supports filtering by event/action type and limiting results.
 *
 * Uses `getSignaturesForAddress` to find transactions, then
 * `getTransaction` to fetch logs and parse Anchor event data.
 */
import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  SSS_PROGRAM_ID,
} from "../helpers";
import {
  spin,
  errorMsg,
  printHeader,
  printField,
  printDivider,
  printSection,
  explorerUrl,
} from "../output";

/** All SSS program event names for filtering. */
const EVENT_NAMES = [
  "StablecoinInitialized",
  "TokensMinted",
  "TokensBurned",
  "AccountFrozen",
  "AccountThawed",
  "StablecoinPaused",
  "StablecoinUnpaused",
  "RoleUpdated",
  "MinterQuotaUpdated",
  "AuthorityTransferred",
  "AddedToBlacklist",
  "RemovedFromBlacklist",
  "TokensSeized",
] as const;

/** Mapping from action shorthand to event names for --action filter. */
const ACTION_MAP: Record<string, string[]> = {
  "mint": ["TokensMinted"],
  "burn": ["TokensBurned"],
  "freeze": ["AccountFrozen"],
  "thaw": ["AccountThawed"],
  "pause": ["StablecoinPaused", "StablecoinUnpaused"],
  "blacklist": ["AddedToBlacklist", "RemovedFromBlacklist"],
  "seize": ["TokensSeized"],
  "role": ["RoleUpdated"],
  "minter": ["MinterQuotaUpdated"],
  "authority": ["AuthorityTransferred"],
  "init": ["StablecoinInitialized"],
  "compliance": ["AddedToBlacklist", "RemovedFromBlacklist", "TokensSeized"],
  "all": [...EVENT_NAMES],
};

/** Parsed on-chain event. */
interface AuditEntry {
  /** Transaction signature. */
  signature: string;
  /** Block time (Unix timestamp), or null if unavailable. */
  blockTime: number | null;
  /** Anchor event name (e.g. "TokensMinted"). */
  eventName: string;
  /** Parsed event data fields. */
  data: Record<string, unknown>;
}

/** Compute the SHA-256 hash for an Anchor event discriminator. */
async function eventDiscriminator(eventName: string): Promise<Buffer> {
  const { createHash } = await import("crypto");
  const hash = createHash("sha256").update(`event:${eventName}`).digest();
  return Buffer.from(hash.subarray(0, 8));
}

/** Format a field value for display. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return chalk.gray("null");
  if (typeof value === "object" && "toBase58" in (value as Record<string, unknown>)) {
    const addr = (value as PublicKey).toBase58();
    return addr.length > 20 ? addr.slice(0, 8) + "..." + addr.slice(-8) : addr;
  }
  if (value instanceof anchor.BN) {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? chalk.green("true") : chalk.red("false");
  }
  return String(value);
}

/** Map event name to a colored category badge. */
function eventBadge(eventName: string): string {
  if (eventName.includes("Mint")) return chalk.green("MINT");
  if (eventName.includes("Burn")) return chalk.red("BURN");
  if (eventName.includes("Frozen")) return chalk.blue("FREEZE");
  if (eventName.includes("Thawed")) return chalk.cyan("THAW");
  if (eventName.includes("Paused")) return chalk.yellow("PAUSE");
  if (eventName.includes("Unpaused")) return chalk.green("UNPAUSE");
  if (eventName.includes("Blacklist") || eventName.includes("blacklist")) return chalk.red("BLACKLIST");
  if (eventName.includes("Seized")) return chalk.magenta("SEIZE");
  if (eventName.includes("Role")) return chalk.blue("ROLE");
  if (eventName.includes("Minter")) return chalk.cyan("MINTER");
  if (eventName.includes("Authority")) return chalk.yellow("AUTHORITY");
  if (eventName.includes("Init")) return chalk.green("INIT");
  return chalk.gray(eventName);
}

export function registerAuditLogCommand(program: Command): void {
  program
    .command("audit-log")
    .description("Query on-chain event history (audit trail)")
    .option("--action <type>", "Filter by action type: mint, burn, freeze, thaw, pause, blacklist, seize, role, minter, authority, init, compliance, all", "all")
    .option("--limit <count>", "Maximum number of entries to display", "25")
    .option("--before <signature>", "Fetch entries before this transaction signature (pagination)")
    .action(async (opts: { action?: string; limit?: string; before?: string }) => {
      try {
        await handleAuditLog(program.opts(), opts);
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleAuditLog(
  globalOpts: Record<string, string>,
  cmdOpts: { action?: string; limit?: string; before?: string }
): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const rpcUrl = globalOpts.rpc || sssConfig.rpcUrl || "http://localhost:8899";
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);

  // Resolve action filter to event names
  const actionFilter = cmdOpts.action || "all";
  const targetEvents = ACTION_MAP[actionFilter.toLowerCase()];
  if (!targetEvents) {
    errorMsg(
      `Unknown action type: ${actionFilter}\n` +
      `  Valid actions: ${Object.keys(ACTION_MAP).join(", ")}`
    );
    return;
  }

  const limit = parseInt(cmdOpts.limit || "25", 10);

  // Build event discriminator map
  const spinner = spin("Fetching on-chain event history...");

  const discriminatorMap = new Map<string, string>();
  for (const name of EVENT_NAMES) {
    const disc = await eventDiscriminator(name);
    discriminatorMap.set(disc.toString("hex"), name);
  }

  // Fetch the IDL for Anchor event parsing
  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  let eventParser: anchor.EventParser | null = null;
  if (idl) {
    const prog = new anchor.Program(idl, provider);
    eventParser = new anchor.EventParser(prog.programId, prog.coder);
  }

  // Fetch recent transaction signatures for the config PDA
  // We fetch more than `limit` because not all transactions will have matching events
  const fetchLimit = Math.min(limit * 4, 1000);
  const sigInfos = await connection.getSignaturesForAddress(configPDA, {
    limit: fetchLimit,
    before: cmdOpts.before || undefined,
  });

  if (sigInfos.length === 0) {
    spinner.succeed("No transactions found");
    printHeader("Audit Log");
    console.log(chalk.gray("    No on-chain activity found for this stablecoin"));
    console.log();
    return;
  }

  // Parse events from each transaction
  const entries: AuditEntry[] = [];

  for (const sigInfo of sigInfos) {
    if (entries.length >= limit) break;
    if (sigInfo.err) continue; // skip failed txs

    try {
      const tx = await connection.getTransaction(sigInfo.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx?.meta?.logMessages) continue;

      // Try Anchor EventParser first (most reliable)
      if (eventParser) {
        const events: Array<{ name: string; data: Record<string, unknown> }> = [];
        try {
          const generator = eventParser.parseLogs(tx.meta.logMessages);
          for (const event of generator) {
            events.push({ name: event.name, data: event.data as Record<string, unknown> });
          }
        } catch {
          // EventParser can fail on some logs; fall through to manual parsing
        }

        for (const event of events) {
          // Apply action filter
          if (!targetEvents.includes(event.name)) continue;

          entries.push({
            signature: sigInfo.signature,
            blockTime: tx.blockTime ?? null,
            eventName: event.name,
            data: event.data,
          });

          if (entries.length >= limit) break;
        }

        if (events.length > 0) continue; // skip manual parsing if Anchor parser worked
      }

      // Fallback: manual log parsing for "Program data:" lines
      for (const log of tx.meta.logMessages) {
        if (!log.startsWith("Program data: ")) continue;

        const b64 = log.slice("Program data: ".length);
        let buf: Buffer;
        try {
          buf = Buffer.from(b64, "base64");
        } catch {
          continue;
        }

        if (buf.length < 8) continue;

        const discHex = buf.subarray(0, 8).toString("hex");
        const eventName = discriminatorMap.get(discHex);
        if (!eventName) continue;

        // Apply action filter
        if (!targetEvents.includes(eventName)) continue;

        entries.push({
          signature: sigInfo.signature,
          blockTime: tx.blockTime ?? null,
          eventName,
          data: {}, // raw data without Anchor IDL decoding
        });

        if (entries.length >= limit) break;
      }
    } catch {
      // Skip transactions that fail to fetch
      continue;
    }
  }

  spinner.succeed(`Found ${entries.length} event${entries.length === 1 ? "" : "s"}`);

  // Display
  printHeader("Audit Log");
  printField("Config PDA", configPDA.toBase58());
  printField("Action Filter", actionFilter === "all" ? chalk.gray("(all events)") : chalk.cyan(actionFilter));
  printField("Events Found", String(entries.length));

  if (entries.length === 0) {
    console.log();
    console.log(chalk.gray("    No matching events found"));
    console.log();
    return;
  }

  printSection("Events");

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Timestamp
    const timeStr = entry.blockTime
      ? new Date(entry.blockTime * 1000).toISOString().replace("T", " ").replace(/\.000Z$/, " UTC")
      : chalk.gray("(no timestamp)");

    // Header line
    const badge = eventBadge(entry.eventName).padEnd(20);
    const sigShort = entry.signature.slice(0, 12) + "...";
    console.log(
      `  ${chalk.gray(`${String(i + 1).padStart(3)}.`)} ${badge} ${chalk.white(entry.eventName)}`
    );
    console.log(
      `       ${chalk.gray("Time:")} ${timeStr}`
    );
    console.log(
      `       ${chalk.gray("Tx:")}   ${chalk.gray(sigShort)}  ${chalk.underline.gray(explorerUrl(entry.signature, rpcUrl))}`
    );

    // Event data fields (if decoded by Anchor)
    const dataKeys = Object.keys(entry.data);
    if (dataKeys.length > 0) {
      // Show key fields inline (skip config PDA which is always the same)
      const interestingKeys = dataKeys.filter((k) => k !== "config" && k !== "stablecoinConfig");
      if (interestingKeys.length > 0) {
        const fieldPairs = interestingKeys
          .slice(0, 6) // max 6 fields per event
          .map((k) => `${chalk.gray(k + ":")} ${formatValue(entry.data[k])}`);
        console.log(`       ${fieldPairs.join("  ")}`);
      }
    }

    // Separator between entries
    if (i < entries.length - 1) {
      console.log();
    }
  }

  // Pagination hint
  console.log();
  printDivider();
  if (sigInfos.length >= fetchLimit && entries.length >= limit) {
    const lastSig = entries[entries.length - 1].signature;
    console.log(
      chalk.gray(`  More events available. Paginate with: sss-token audit-log --before ${lastSig.slice(0, 20)}...`)
    );
  }
  console.log(
    chalk.gray(`  Showing ${entries.length} of ${sigInfos.length} transactions scanned`)
  );
  console.log();
}
