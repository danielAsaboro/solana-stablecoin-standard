/**
 * CLI command: `sss-token holders`
 *
 * Lists all token holders of the stablecoin mint, showing wallet addresses
 * and their balances. Supports filtering by minimum balance.
 *
 * Uses Token-2022 `getProgramAccounts` with a memcmp filter on the mint
 * address to find all token accounts, then decodes their balance and owner.
 */
import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
} from "../helpers";
import {
  spin,
  errorMsg,
  printHeader,
  printField,
  printDivider,
  printSection,
} from "../output";

/** Parsed token account holder. */
interface HolderEntry {
  /** Token account address. */
  tokenAccount: string;
  /** Owner (wallet) address. */
  owner: string;
  /** Raw token balance as bigint. */
  balance: bigint;
}

/**
 * Token-2022 token account data layout offsets:
 * - offset 0:   mint (32 bytes)
 * - offset 32:  owner (32 bytes)
 * - offset 64:  amount (8 bytes, little-endian u64)
 * - offset 72:  delegate option (4 bytes)
 * - offset 76:  delegate (32 bytes)
 * - offset 108: state (1 byte) — 0=Uninitialized, 1=Initialized, 2=Frozen
 */
const OWNER_OFFSET = 32;
const AMOUNT_OFFSET = 64;
const STATE_OFFSET = 108;

/** Truncate an address for display (first 8 + last 8 chars). */
function truncateAddress(addr: string): string {
  if (addr.length <= 20) return addr;
  return addr.slice(0, 8) + "..." + addr.slice(-8);
}

/** Format a large number with comma separators. */
function formatNumber(n: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format a raw amount with decimals. */
function formatAmount(raw: string, decimals: number): string {
  if (decimals === 0) return formatNumber(raw);
  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  return formatNumber(intPart) + "." + fracPart;
}

/** Read a little-endian u64 from a buffer. */
function readU64LE(buf: Buffer, offset: number): bigint {
  let val = BigInt(0);
  for (let i = 0; i < 8; i++) {
    val |= BigInt(buf[offset + i]) << BigInt(i * 8);
  }
  return val;
}

export function registerHoldersCommand(program: Command): void {
  program
    .command("holders")
    .description("List all token holders with balances")
    .option("--min-balance <amount>", "Minimum balance filter (in human-readable units, e.g. 100.5)")
    .option("--sort <field>", "Sort by: balance (default), address", "balance")
    .option("--limit <count>", "Maximum number of holders to display")
    .option("--show-frozen", "Include frozen accounts in the output")
    .action(async (opts: { minBalance?: string; sort?: string; limit?: string; showFrozen?: boolean }) => {
      try {
        await handleHolders(program.opts(), opts);
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleHolders(
  globalOpts: Record<string, string>,
  cmdOpts: { minBalance?: string; sort?: string; limit?: string; showFrozen?: boolean }
): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);

  const mintAddress = new PublicKey(sssConfig.mintAddress);

  const spinner = spin("Scanning all token accounts...");

  // Fetch all Token-2022 accounts for this mint using memcmp filter on mint field (offset 0)
  const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: mintAddress.toBase58(),
        },
      },
    ],
  });

  // Fetch config to get decimals
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const configPDA = new PublicKey(sssConfig.configAddress);
  const idl = await anchor.Program.fetchIdl(
    new PublicKey("7CPH4PAWa9n4rizL8UGDi7h361NU5jMWGX7VjSBydgjd"),
    provider
  );
  let decimals = 6; // default
  if (idl) {
    try {
      const prog = new anchor.Program(idl, provider);
      const config = await (prog.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>> }>).stablecoinConfig.fetch(configPDA);
      decimals = config.decimals as number;
    } catch {
      // Fall back to default
    }
  }

  // Parse each token account
  const holders: HolderEntry[] = [];
  let frozenCount = 0;

  for (const { pubkey, account } of accounts) {
    const data = account.data as Buffer;
    if (data.length < 109) continue; // too short to be a valid token account

    const owner = new PublicKey(data.subarray(OWNER_OFFSET, OWNER_OFFSET + 32));
    const balance = readU64LE(data, AMOUNT_OFFSET);
    const state = data[STATE_OFFSET];

    // state 0 = uninitialized, skip
    if (state === 0) continue;

    // state 2 = frozen
    if (state === 2) frozenCount++;

    // Skip frozen accounts unless --show-frozen
    if (state === 2 && !cmdOpts.showFrozen) continue;

    holders.push({
      tokenAccount: pubkey.toBase58(),
      owner: owner.toBase58(),
      balance,
    });
  }

  // Apply min-balance filter
  let filtered = holders;
  if (cmdOpts.minBalance) {
    // Convert human-readable amount to raw
    const parts = cmdOpts.minBalance.split(".");
    const intPart = parts[0] || "0";
    const fracPart = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
    const minRaw = BigInt(intPart + fracPart);
    filtered = holders.filter((h) => h.balance >= minRaw);
  }

  // Sort
  if (cmdOpts.sort === "address") {
    filtered.sort((a, b) => a.owner.localeCompare(b.owner));
  } else {
    // Sort by balance descending (default)
    filtered.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  }

  // Apply limit
  const displayLimit = cmdOpts.limit ? parseInt(cmdOpts.limit, 10) : filtered.length;
  const displayed = filtered.slice(0, displayLimit);

  spinner.succeed(`Found ${holders.length} holder${holders.length === 1 ? "" : "s"}`);

  // Display
  printHeader("Token Holders");
  printField("Mint", mintAddress.toBase58());
  printField("Total Accounts", String(accounts.length));
  printField("Active Holders", String(holders.length));
  if (frozenCount > 0) {
    printField("Frozen Accounts", chalk.yellow(String(frozenCount)));
  }
  if (cmdOpts.minBalance) {
    printField("Min Balance Filter", `${cmdOpts.minBalance} tokens`);
    printField("Matching Holders", String(filtered.length));
  }

  printSection("Holders");

  if (displayed.length === 0) {
    console.log(chalk.gray("    No holders found matching the criteria"));
  } else {
    // Table header
    console.log(
      chalk.gray("    ") +
      chalk.gray("Owner".padEnd(22)) +
      chalk.gray("  ") +
      chalk.gray("Balance".padStart(24)) +
      chalk.gray("  ") +
      chalk.gray("Token Account")
    );
    printDivider();

    // Calculate total for percentage
    let totalBalance = BigInt(0);
    for (const h of filtered) {
      totalBalance += h.balance;
    }

    for (const holder of displayed) {
      const ownerStr = truncateAddress(holder.owner);
      const balanceStr = formatAmount(holder.balance.toString(), decimals);

      // Calculate percentage of total
      let pctStr = "";
      if (totalBalance > BigInt(0)) {
        const pct = Number((holder.balance * BigInt(10000)) / totalBalance) / 100;
        pctStr = pct >= 0.01 ? chalk.gray(` (${pct.toFixed(2)}%)`) : chalk.gray(" (<0.01%)");
      }

      const tokenAccountStr = truncateAddress(holder.tokenAccount);

      console.log(
        `    ${chalk.white(ownerStr.padEnd(22))}  ${chalk.bold(balanceStr.padStart(24))}${pctStr}  ${chalk.gray(tokenAccountStr)}`
      );
    }

    if (filtered.length > displayLimit) {
      console.log(chalk.gray(`\n    ... and ${filtered.length - displayLimit} more (use --limit to show more)`));
    }
  }

  // Summary
  console.log();
  printDivider();
  if (filtered.length > 0) {
    let totalFiltered = BigInt(0);
    for (const h of filtered) {
      totalFiltered += h.balance;
    }
    console.log(
      `  ${chalk.gray("Total balance:")} ${chalk.bold(formatAmount(totalFiltered.toString(), decimals))} tokens across ${filtered.length} account${filtered.length === 1 ? "" : "s"}`
    );
  }
  console.log();
}
