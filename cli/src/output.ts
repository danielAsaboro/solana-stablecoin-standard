/**
 * CLI output utilities — spinners, explorer links, and formatted output.
 *
 * Provides consistent, polished terminal output for all CLI commands
 * including loading spinners during async operations, Solana Explorer
 * links for transaction signatures, and formatted result tables.
 */
import ora, { Ora } from "ora";
import chalk from "chalk";

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
