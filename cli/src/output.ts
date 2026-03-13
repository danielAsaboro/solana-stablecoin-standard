/**
 * CLI output utilities — spinners, explorer links, and formatted output.
 *
 * Provides consistent, polished terminal output for all CLI commands
 * including loading spinners during async operations, Solana Explorer
 * links for transaction signatures, and formatted result tables.
 */
import ora, { Ora } from "ora";
import chalk from "chalk";

export type OutputFormat = "table" | "json" | "csv";

type Primitive = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => Primitive;
}

// ─── Symbols ────────────────────────────────────────────────────────

const SYMBOLS = {
  success: chalk.green("✔"),
  error: chalk.red("✖"),
  warning: chalk.yellow("⚠"),
  info: chalk.blue("ℹ"),
  arrow: chalk.gray("→"),
  bullet: chalk.gray("•"),
  link: chalk.gray("🔗"),
} as const;

// ─── Explorer URL ───────────────────────────────────────────────────

/**
 * Detect the Solana cluster from an RPC URL.
 * Returns the cluster query param for Solana Explorer, or undefined for mainnet.
 */
function detectCluster(rpcUrl: string): string | undefined {
  const lower = rpcUrl.toLowerCase();
  if (lower.includes("devnet")) return "devnet";
  if (lower.includes("testnet")) return "testnet";
  if (lower.includes("mainnet") || lower.includes("api.mainnet-beta")) return undefined;
  // Custom (localnet or other)
  return `custom&customUrl=${encodeURIComponent(rpcUrl)}`;
}

/**
 * Generate a Solana Explorer URL for a transaction signature.
 *
 * Automatically detects the cluster from the RPC URL:
 * - devnet → `?cluster=devnet`
 * - testnet → `?cluster=testnet`
 * - mainnet → no cluster param
 * - localhost/custom → `?cluster=custom&customUrl=...`
 */
export function explorerUrl(signature: string, rpcUrl: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  const cluster = detectCluster(rpcUrl);
  return cluster ? `${base}?cluster=${cluster}` : base;
}

/**
 * Generate a Solana Explorer URL for an account/address.
 */
export function explorerAccountUrl(address: string, rpcUrl: string): string {
  const base = `https://explorer.solana.com/address/${address}`;
  const cluster = detectCluster(rpcUrl);
  return cluster ? `${base}?cluster=${cluster}` : base;
}

// ─── Spinners ───────────────────────────────────────────────────────

/**
 * Create and start a spinner with the given message.
 * Uses the "dots" animation for a clean, professional look.
 *
 * @example
 * ```ts
 * const spinner = spin("Minting tokens...");
 * try {
 *   const tx = await program.methods.mintTokens(amount).rpc();
 *   spinner.succeed("Tokens minted!");
 * } catch (err) {
 *   spinner.fail("Mint failed");
 * }
 * ```
 */
export function spin(text: string): Ora {
  return ora({
    text,
    color: "cyan",
    spinner: "dots",
  }).start();
}

// ─── Formatted Output ───────────────────────────────────────────────

/**
 * Print a transaction result with a formatted table and explorer link.
 *
 * @param signature - The transaction signature
 * @param rpcUrl - The RPC URL (for explorer link cluster detection)
 * @param fields - Key-value pairs to display in the result table
 */
export function printTxResult(
  signature: string,
  rpcUrl: string,
  fields: Array<[string, string]>
): void {
  // Find max label width for alignment
  const maxLabel = Math.max(
    ...fields.map(([label]) => label.length),
    "Explorer".length
  );

  console.log();
  for (const [label, value] of fields) {
    const paddedLabel = label.padEnd(maxLabel);
    console.log(`  ${chalk.cyan(paddedLabel)}  ${value}`);
  }

  // Explorer link
  const url = explorerUrl(signature, rpcUrl);
  const paddedExplorer = "Explorer".padEnd(maxLabel);
  console.log(`  ${chalk.cyan(paddedExplorer)}  ${chalk.underline.gray(url)}`);
  console.log();
}

/**
 * Print a header/title with a separator line.
 */
export function printHeader(title: string): void {
  console.log();
  console.log(`  ${chalk.bold(title)}`);
  console.log(`  ${chalk.gray("─".repeat(56))}`);
}

/**
 * Print a labeled field in a status display.
 */
export function printField(label: string, value: string, maxWidth = 24): void {
  const paddedLabel = label.padEnd(maxWidth);
  console.log(`  ${chalk.cyan(paddedLabel)} ${value}`);
}

/**
 * Print a divider line.
 */
export function printDivider(): void {
  console.log(`  ${chalk.gray("─".repeat(56))}`);
}

// ─── Message Helpers ────────────────────────────────────────────────

/**
 * Print a success message with a green checkmark.
 */
export function successMsg(msg: string): void {
  console.log(`\n  ${SYMBOLS.success} ${chalk.green(msg)}`);
}

/**
 * Print an info message with a blue info icon.
 */
export function infoMsg(msg: string): void {
  console.log(`  ${SYMBOLS.info} ${msg}`);
}

/**
 * Print a warning message with a yellow warning icon.
 */
export function warnMsg(msg: string): void {
  console.log(`  ${SYMBOLS.warning} ${chalk.yellow(msg)}`);
}

/**
 * Print an error message with a red X and exit.
 */
export function errorMsg(msg: string): void {
  console.error(`\n  ${SYMBOLS.error} ${chalk.red(msg)}`);
  process.exit(1);
}

/**
 * Print a key-value detail line (indented, with arrow).
 */
export function printDetail(label: string, value: string): void {
  console.log(`    ${chalk.gray(label + ":")} ${value}`);
}

// ─── Enhanced Status Output ────────────────────────────────────────

/**
 * Print a section header within a status display.
 * Smaller than printHeader — used for subsections.
 */
export function printSection(title: string): void {
  console.log();
  console.log(`  ${chalk.bold.cyan(title)}`);
}

/**
 * Print an indented sub-field (for nested data like role entries).
 */
export function printSubField(label: string, value: string, maxWidth = 20): void {
  const paddedLabel = label.padEnd(maxWidth);
  console.log(`    ${chalk.gray(paddedLabel)} ${value}`);
}

/**
 * Print a table row for role/minter entries.
 * Shows address (truncated), role/status, and optional details.
 */
export function printRoleEntry(
  address: string,
  role: string,
  active: boolean
): void {
  const truncated = address.length > 20
    ? address.slice(0, 8) + "..." + address.slice(-8)
    : address;
  const status = active ? chalk.green("ACTIVE") : chalk.red("INACTIVE");
  console.log(`    ${chalk.white(truncated)}  ${chalk.cyan(role.padEnd(12))}  ${status}`);
}

/**
 * Print a minter quota entry with usage bar.
 */
export function printMinterEntry(
  address: string,
  minted: string,
  quota: string,
  active: boolean
): void {
  const truncated = address.length > 20
    ? address.slice(0, 8) + "..." + address.slice(-8)
    : address;
  const status = active ? chalk.green("ACTIVE") : chalk.red("INACTIVE");
  const usage = `${minted} / ${quota}`;
  console.log(`    ${chalk.white(truncated)}  ${usage}  ${status}`);
}

/**
 * Print a preset badge based on feature flags.
 */
export function printPresetBadge(
  enablePermanentDelegate: boolean,
  enableTransferHook: boolean
): string {
  if (enablePermanentDelegate && enableTransferHook) {
    return chalk.bgBlue.white(" SSS-2 ") + " " + chalk.gray("Compliant Stablecoin");
  }
  if (!enablePermanentDelegate && !enableTransferHook) {
    return chalk.bgGreen.white(" SSS-1 ") + " " + chalk.gray("Minimal Stablecoin");
  }
  return chalk.bgYellow.black(" CUSTOM ") + " " + chalk.gray("Custom Configuration");
}

function escapeCsv(value: Primitive): string {
  if (value === null || value === undefined) {
    return "";
  }

  const rendered = String(value);
  if (/[",\n]/.test(rendered)) {
    return `"${rendered.replace(/"/g, "\"\"")}"`;
  }

  return rendered;
}

export function getOutputFormat(globalOpts: Record<string, unknown>): OutputFormat {
  const candidate = String(globalOpts.output ?? "table").toLowerCase();
  if (candidate === "json" || candidate === "csv") {
    return candidate;
  }
  return "table";
}

export function isDryRun(globalOpts: Record<string, unknown>): boolean {
  return Boolean(globalOpts.dryRun);
}

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function printCsv<T>(rows: Array<T>, columns: Array<CsvColumn<T>>): void {
  const header = columns.map((column) => escapeCsv(column.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsv(column.value(row))).join(",")
  );
  console.log([header, ...lines].join("\n"));
}

export function printDryRunPlan(
  globalOpts: Record<string, unknown>,
  action: string,
  details: Record<string, Primitive>
): void {
  const format = getOutputFormat(globalOpts);
  const payload = {
    mode: "dry-run",
    action,
    details,
  };

  if (format === "json") {
    printJson(payload);
    return;
  }

  if (format === "csv") {
    printCsv(
      [details],
      Object.keys(details).map((key) => ({
        header: key,
        value: (row: Record<string, Primitive>) => row[key],
      }))
    );
    return;
  }

  printHeader(`Dry Run: ${action}`);
  for (const [label, value] of Object.entries(details)) {
    printField(label, String(value ?? ""));
  }
  console.log();
}
