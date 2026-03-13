/**
 * CLI command: `sss-token audit-log`
 *
 * Queries on-chain transaction history for the stablecoin config PDA,
 * parses Anchor event logs, and renders a stable audit stream for
 * operators or automation.
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
  errorMsg,
  explorerUrl,
  printCsv,
  printDivider,
  printField,
  printHeader,
  printJson,
  printSection,
  spin,
} from "../output";

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
  "AddressBlacklisted",
  "AddressUnblacklisted",
  "TokensSeized",
] as const;

const ACTION_MAP: Record<string, Array<string>> = {
  mint: ["TokensMinted"],
  burn: ["TokensBurned"],
  freeze: ["AccountFrozen"],
  thaw: ["AccountThawed"],
  pause: ["StablecoinPaused", "StablecoinUnpaused"],
  blacklist: ["AddressBlacklisted", "AddressUnblacklisted"],
  seize: ["TokensSeized"],
  role: ["RoleUpdated"],
  minter: ["MinterQuotaUpdated"],
  authority: ["AuthorityTransferred"],
  init: ["StablecoinInitialized"],
  compliance: ["AddressBlacklisted", "AddressUnblacklisted", "TokensSeized"],
  all: [...EVENT_NAMES],
};

export type AuditOutputFormat = "table" | "json" | "csv" | "jsonl";

export interface AuditEntry {
  signature: string;
  blockTime: number | null;
  eventName: string;
  data: Record<string, unknown>;
}

export interface AuditRecord {
  timestamp: string | null;
  unixTimestamp: number | null;
  eventType: string;
  action: string;
  status: string;
  severity: string;
  authority: string | null;
  targetAddress: string | null;
  targetMint: string | null;
  configAddress: string | null;
  signature: string;
  details: Record<string, unknown>;
}

interface AuditCommandOptions {
  action?: string;
  limit?: string;
  before?: string;
  format?: string;
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof anchor.BN) {
    return value.toString();
  }

  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  if (typeof value === "object" && value !== null && "toBase58" in value) {
    const candidate = value as { toBase58?: () => string };
    if (typeof candidate.toBase58 === "function") {
      return candidate.toBase58();
    }
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [
        key,
        serializeValue(innerValue),
      ])
    );
  }

  return value;
}

function asAddress(value: unknown): string | null {
  const serialized = serializeValue(value);
  return typeof serialized === "string" ? serialized : null;
}

function actionForEvent(eventName: string): string {
  switch (eventName) {
    case "StablecoinInitialized":
      return "initialize";
    case "TokensMinted":
      return "mint";
    case "TokensBurned":
      return "burn";
    case "AccountFrozen":
      return "freeze";
    case "AccountThawed":
      return "thaw";
    case "StablecoinPaused":
      return "pause";
    case "StablecoinUnpaused":
      return "unpause";
    case "RoleUpdated":
      return "role.update";
    case "MinterQuotaUpdated":
      return "minter.update";
    case "AuthorityTransferred":
      return "authority.transfer";
    case "AddressBlacklisted":
      return "blacklist.add";
    case "AddressUnblacklisted":
      return "blacklist.remove";
    case "TokensSeized":
      return "seize";
    default:
      return eventName.toLowerCase();
  }
}

function severityForEvent(
  eventName: string,
  details: Record<string, unknown>
): string {
  if (eventName === "StablecoinPaused" || eventName === "AccountFrozen") {
    return "warning";
  }

  if (
    eventName === "AddressBlacklisted" ||
    eventName === "AddressUnblacklisted" ||
    eventName === "TokensSeized"
  ) {
    return "critical";
  }

  if (eventName === "RoleUpdated" && details.active === false) {
    return "warning";
  }

  return "success";
}

function statusForEvent(
  eventName: string,
  details: Record<string, unknown>
): string {
  if (eventName === "StablecoinPaused") {
    return "paused";
  }

  if (eventName === "StablecoinUnpaused") {
    return "active";
  }

  if (eventName === "AccountFrozen") {
    return "frozen";
  }

  if (eventName === "AccountThawed") {
    return "thawed";
  }

  if (eventName === "AddressBlacklisted") {
    return "restricted";
  }

  if (eventName === "AddressUnblacklisted") {
    return "cleared";
  }

  if (eventName === "RoleUpdated") {
    return details.active === false ? "revoked" : "active";
  }

  return "confirmed";
}

function authorityForEvent(
  eventName: string,
  details: Record<string, unknown>
): string | null {
  switch (eventName) {
    case "StablecoinInitialized":
    case "AccountFrozen":
    case "AccountThawed":
    case "StablecoinPaused":
    case "StablecoinUnpaused":
      return asAddress(details.authority);
    case "TokensMinted":
      return asAddress(details.minter);
    case "TokensBurned":
      return asAddress(details.burner);
    case "RoleUpdated":
    case "MinterQuotaUpdated":
      return asAddress(details.updatedBy);
    case "AddressBlacklisted":
      return asAddress(details.blacklistedBy);
    case "AddressUnblacklisted":
      return asAddress(details.removedBy);
    case "TokensSeized":
      return asAddress(details.seizedBy);
    default:
      return null;
  }
}

function targetForEvent(
  eventName: string,
  details: Record<string, unknown>
): string | null {
  switch (eventName) {
    case "TokensMinted":
      return asAddress(details.recipient);
    case "TokensBurned":
    case "TokensSeized":
      return asAddress(details.from);
    case "AccountFrozen":
    case "AccountThawed":
      return asAddress(details.account);
    case "RoleUpdated":
      return asAddress(details.user);
    case "MinterQuotaUpdated":
      return asAddress(details.minter);
    case "AuthorityTransferred":
      return asAddress(details.newAuthority);
    case "AddressBlacklisted":
    case "AddressUnblacklisted":
      return asAddress(details.address);
    case "StablecoinInitialized":
      return asAddress(details.authority);
    default:
      return null;
  }
}

export function normalizeAuditRecord(entry: AuditEntry): AuditRecord {
  const details = serializeValue(entry.data) as Record<string, unknown>;
  const unixTimestamp = entry.blockTime ?? null;

  return {
    timestamp:
      unixTimestamp === null ? null : new Date(unixTimestamp * 1000).toISOString(),
    unixTimestamp,
    eventType: entry.eventName,
    action: actionForEvent(entry.eventName),
    status: statusForEvent(entry.eventName, details),
    severity: severityForEvent(entry.eventName, details),
    authority: authorityForEvent(entry.eventName, details),
    targetAddress: targetForEvent(entry.eventName, details),
    targetMint: asAddress(details.mint),
    configAddress: asAddress(details.config),
    signature: entry.signature,
    details,
  };
}

export function resolveAuditOutputFormat(
  globalOpts: Record<string, unknown>,
  cmdOpts: AuditCommandOptions
): AuditOutputFormat {
  const candidate = String(cmdOpts.format ?? globalOpts.output ?? "table").toLowerCase();
  if (
    candidate === "json" ||
    candidate === "csv" ||
    candidate === "jsonl"
  ) {
    return candidate;
  }

  return "table";
}

export function formatAuditRecordsAsJsonl(records: Array<AuditRecord>): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

async function eventDiscriminator(eventName: string): Promise<Buffer> {
  const { createHash } = await import("crypto");
  const hash = createHash("sha256").update(`event:${eventName}`).digest();
  return Buffer.from(hash.subarray(0, 8));
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray("null");
  }

  const serialized = serializeValue(value);
  if (typeof serialized === "boolean") {
    return serialized ? chalk.green("true") : chalk.red("false");
  }

  return String(serialized);
}

function eventBadge(record: AuditRecord): string {
  if (record.severity === "critical") {
    return chalk.bgRed.white(` ${record.action.toUpperCase()} `);
  }

  if (record.severity === "warning") {
    return chalk.bgYellow.black(` ${record.action.toUpperCase()} `);
  }

  return chalk.bgGreen.black(` ${record.action.toUpperCase()} `);
}

function renderTable(records: Array<AuditRecord>, rpcUrl: string, scannedCount: number): void {
  if (records.length === 0) {
    console.log(chalk.gray("  No matching events found"));
    console.log();
    return;
  }

  printSection("Events");

  records.forEach((record, index) => {
    console.log(
      `  ${chalk.gray(`${String(index + 1).padStart(3)}.`)} ${eventBadge(record)} ${chalk.white(record.eventType)}`
    );
    console.log(
      `       ${chalk.gray("Time:")} ${record.timestamp ?? chalk.gray("(no timestamp)")}`
    );
    console.log(
      `       ${chalk.gray("State:")} ${record.status}  ${chalk.gray("Severity:")} ${record.severity}`
    );

    if (record.authority) {
      console.log(`       ${chalk.gray("Authority:")} ${record.authority}`);
    }

    if (record.targetAddress) {
      console.log(`       ${chalk.gray("Target:")} ${record.targetAddress}`);
    }

    console.log(
      `       ${chalk.gray("Tx:")} ${record.signature.slice(0, 12)}...  ${chalk.underline.gray(explorerUrl(record.signature, rpcUrl))}`
    );

    const interestingDetails = Object.entries(record.details)
      .filter(([key]) => !["config", "authority", "updatedBy", "mint"].includes(key))
      .slice(0, 5);

    if (interestingDetails.length > 0) {
      console.log(
        `       ${interestingDetails
          .map(([key, value]) => `${chalk.gray(`${key}:`)} ${formatValue(value)}`)
          .join("  ")}`
      );
    }

    if (index < records.length - 1) {
      console.log();
    }
  });

  console.log();
  printDivider();
  console.log(chalk.gray(`  Showing ${records.length} events from ${scannedCount} transactions scanned`));
  console.log();
}

function emitMachineReadable(
  format: AuditOutputFormat,
  configAddress: string,
  actionFilter: string,
  records: Array<AuditRecord>
): void {
  if (format === "json") {
    printJson({
      configAddress,
      actionFilter,
      count: records.length,
      events: records,
    });
    return;
  }

  if (format === "jsonl") {
    const rendered = formatAuditRecordsAsJsonl(records);
    if (rendered.length > 0) {
      console.log(rendered);
    }
    return;
  }

  printCsv(records, [
    { header: "timestamp", value: (row) => row.timestamp },
    { header: "event_type", value: (row) => row.eventType },
    { header: "action", value: (row) => row.action },
    { header: "status", value: (row) => row.status },
    { header: "severity", value: (row) => row.severity },
    { header: "authority", value: (row) => row.authority },
    { header: "target_address", value: (row) => row.targetAddress },
    { header: "target_mint", value: (row) => row.targetMint },
    { header: "config_address", value: (row) => row.configAddress },
    { header: "signature", value: (row) => row.signature },
  ]);
}

export function registerAuditLogCommand(program: Command): void {
  program
    .command("audit-log")
    .description("Query on-chain event history (audit trail)")
    .option(
      "--action <type>",
      "Filter by action type: mint, burn, freeze, thaw, pause, blacklist, seize, role, minter, authority, init, compliance, all",
      "all"
    )
    .option("--limit <count>", "Maximum number of entries to display", "25")
    .option("--before <signature>", "Fetch entries before this transaction signature (pagination)")
    .option(
      "--format <format>",
      "Override output format for this command: table, json, csv, jsonl"
    )
    .action(async (cmdOpts: AuditCommandOptions) => {
      try {
        await handleAuditLog(program.opts(), cmdOpts);
      } catch (error: unknown) {
        errorMsg(error instanceof Error ? error.message : String(error));
      }
    });
}

async function handleAuditLog(
  globalOpts: Record<string, unknown>,
  cmdOpts: AuditCommandOptions
): Promise<void> {
  const configPath = typeof globalOpts.config === "string" ? globalOpts.config : undefined;
  const profileName = typeof globalOpts.profile === "string" ? globalOpts.profile : undefined;
  const keypairPath = typeof globalOpts.keypair === "string" ? globalOpts.keypair : undefined;
  const rpcOverride = typeof globalOpts.rpc === "string" ? globalOpts.rpc : undefined;
  const sssConfig = loadConfig(configPath, profileName);
  const keypair = loadKeypair(keypairPath);
  const connection = getConnection(rpcOverride || sssConfig.rpcUrl);
  const rpcUrl = rpcOverride || sssConfig.rpcUrl || "http://localhost:8899";
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const outputFormat = resolveAuditOutputFormat(globalOpts, cmdOpts);
  const showTable = outputFormat === "table";

  const configPDA = new PublicKey(sssConfig.configAddress);
  const actionFilter = cmdOpts.action || "all";
  const targetEvents = ACTION_MAP[actionFilter.toLowerCase()];
  if (!targetEvents) {
    errorMsg(
      `Unknown action type: ${actionFilter}\n  Valid actions: ${Object.keys(ACTION_MAP).join(", ")}`
    );
    return;
  }

  const limit = parseInt(cmdOpts.limit || "25", 10);
  const spinner = showTable ? spin("Fetching on-chain event history...") : null;

  const discriminatorMap = new Map<string, string>();
  for (const name of EVENT_NAMES) {
    const discriminator = await eventDiscriminator(name);
    discriminatorMap.set(discriminator.toString("hex"), name);
  }

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  let eventParser: anchor.EventParser | null = null;
  if (idl) {
    const programInstance = new anchor.Program(idl, provider);
    eventParser = new anchor.EventParser(programInstance.programId, programInstance.coder);
  }

  const fetchLimit = Math.min(limit * 4, 1000);
  const signatureInfos = await connection.getSignaturesForAddress(configPDA, {
    limit: fetchLimit,
    before: cmdOpts.before || undefined,
  });

  if (signatureInfos.length === 0) {
    spinner?.succeed("No transactions found");
    if (showTable) {
      printHeader("Audit Log");
      console.log(chalk.gray("  No on-chain activity found for this stablecoin"));
      console.log();
    } else if (outputFormat === "json") {
      printJson({
        configAddress: configPDA.toBase58(),
        actionFilter,
        count: 0,
        events: [],
      });
    }
    return;
  }

  const entries: Array<AuditEntry> = [];

  for (const signatureInfo of signatureInfos) {
    if (entries.length >= limit) {
      break;
    }

    if (signatureInfo.err) {
      continue;
    }

    try {
      const transaction = await connection.getTransaction(signatureInfo.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!transaction?.meta?.logMessages) {
        continue;
      }

      if (eventParser) {
        const parsedEvents: Array<{ name: string; data: Record<string, unknown> }> = [];
        try {
          const generator = eventParser.parseLogs(transaction.meta.logMessages);
          for (const parsedEvent of generator) {
            parsedEvents.push({
              name: parsedEvent.name,
              data: parsedEvent.data as Record<string, unknown>,
            });
          }
        } catch {
          // Ignore parser failures and continue with manual event matching.
        }

        for (const parsedEvent of parsedEvents) {
          if (!targetEvents.includes(parsedEvent.name)) {
            continue;
          }

          entries.push({
            signature: signatureInfo.signature,
            blockTime: transaction.blockTime ?? null,
            eventName: parsedEvent.name,
            data: parsedEvent.data,
          });
        }

        if (parsedEvents.length > 0) {
          continue;
        }
      }

      for (const log of transaction.meta.logMessages) {
        if (!log.startsWith("Program data: ")) {
          continue;
        }

        const base64Payload = log.slice("Program data: ".length);
        let buffer: Buffer;
        try {
          buffer = Buffer.from(base64Payload, "base64");
        } catch {
          continue;
        }

        if (buffer.length < 8) {
          continue;
        }

        const eventName = discriminatorMap.get(buffer.subarray(0, 8).toString("hex"));
        if (!eventName || !targetEvents.includes(eventName)) {
          continue;
        }

        entries.push({
          signature: signatureInfo.signature,
          blockTime: transaction.blockTime ?? null,
          eventName,
          data: {},
        });
      }
    } catch {
      continue;
    }
  }

  const records = entries.map(normalizeAuditRecord);
  spinner?.succeed(`Found ${records.length} event${records.length === 1 ? "" : "s"}`);

  if (showTable) {
    printHeader("Audit Log");
    printField("Config PDA", configPDA.toBase58());
    printField(
      "Action Filter",
      actionFilter === "all" ? chalk.gray("(all events)") : chalk.cyan(actionFilter)
    );
    printField("Events Found", String(records.length));
    renderTable(records, rpcUrl, signatureInfos.length);
    if (signatureInfos.length >= fetchLimit && records.length >= limit) {
      const lastSignature = records[records.length - 1]?.signature;
      if (lastSignature) {
        console.log(
          chalk.gray(
            `  More events available. Paginate with: sss-token audit-log --before ${lastSignature.slice(0, 20)}...`
          )
        );
        console.log();
      }
    }
    return;
  }

  emitMachineReadable(outputFormat, configPDA.toBase58(), actionFilter, records);
}
