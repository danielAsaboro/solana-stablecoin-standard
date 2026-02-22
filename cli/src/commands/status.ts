import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  SSS_PROGRAM_ID,
  ROLE_NAMES,
} from "../helpers";
import {
  spin,
  errorMsg,
  printHeader,
  printField,
  printDivider,
  printSection,
  printSubField,
  printMinterEntry,
  printPresetBadge,
  explorerAccountUrl,
} from "../output";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show full stablecoin state: config, supply, roles, minters, blacklist")
    .action(async () => {
      try {
        await handleStatus(program.opts());
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });

  program
    .command("supply")
    .description("Show stablecoin supply statistics")
    .action(async () => {
      try {
        await handleSupply(program.opts());
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

/** Truncate an address for display (first 8 + last 8 chars). */
function truncateAddress(addr: string): string {
  if (addr.length <= 20) return addr;
  return addr.slice(0, 8) + "..." + addr.slice(-8);
}

/** Format a large number with comma separators. */
function formatNumber(n: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format a raw amount with decimals (e.g. 1000000 with 6 decimals → "1.000000"). */
function formatAmount(raw: string, decimals: number): string {
  if (decimals === 0) return formatNumber(raw);
  const padded = raw.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  return formatNumber(intPart) + "." + fracPart;
}

async function handleStatus(globalOpts: Record<string, string>): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const rpcUrl = globalOpts.rpc || sssConfig.rpcUrl || "http://localhost:8899";

  const configPDA = new PublicKey(sssConfig.configAddress);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL. Is the program deployed?");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Fetching full stablecoin state...");

  // ─── Fetch config ────────────────────────────────────────────────
  const config = await (program.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>>; all: (filters?: Array<{ memcmp: { offset: number; bytes: string } }>) => Promise<Array<{ account: Record<string, unknown> }>> }>).stablecoinConfig.fetch(configPDA);

  const mintAddress = config.mint as PublicKey;
  const decimals = config.decimals as number;

  // ─── Fetch on-chain mint supply ──────────────────────────────────
  let actualSupply = "(unavailable)";
  try {
    const mintInfo = await getMint(connection, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID);
    actualSupply = formatAmount(mintInfo.supply.toString(), decimals);
  } catch {
    // mint account might not exist yet
  }

  // ─── Fetch all role accounts ─────────────────────────────────────
  type RoleAccountData = { user: PublicKey; roleType: number; active: boolean };
  let roles: RoleAccountData[] = [];
  try {
    const roleAccounts = await (program.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>>; all: (filters?: Array<{ memcmp: { offset: number; bytes: string } }>) => Promise<Array<{ account: Record<string, unknown> }>> }>).roleAccount.all([
      {
        memcmp: {
          offset: 8, // skip discriminator
          bytes: configPDA.toBase58(),
        },
      },
    ]);
    roles = roleAccounts.map((a) => a.account as unknown as RoleAccountData);
  } catch {
    // Role accounts might not exist
  }

  // ─── Fetch all minter quotas ─────────────────────────────────────
  type MinterQuotaData = { minter: PublicKey; quota: anchor.BN; minted: anchor.BN };
  let minterQuotas: MinterQuotaData[] = [];
  try {
    const quotaAccounts = await (program.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>>; all: (filters?: Array<{ memcmp: { offset: number; bytes: string } }>) => Promise<Array<{ account: Record<string, unknown> }>> }>).minterQuota.all([
      {
        memcmp: {
          offset: 8, // skip discriminator
          bytes: configPDA.toBase58(),
        },
      },
    ]);
    minterQuotas = quotaAccounts.map((a) => a.account as unknown as MinterQuotaData);
  } catch {
    // Minter quota accounts might not exist
  }

  // ─── Fetch blacklist count (SSS-2 only) ──────────────────────────
  let blacklistCount = 0;
  const isSSS2 = Boolean(config.enableTransferHook) && Boolean(config.enablePermanentDelegate);
  if (isSSS2) {
    try {
      const blacklistAccounts = await (program.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>>; all: (filters?: Array<{ memcmp: { offset: number; bytes: string } }>) => Promise<Array<{ account: Record<string, unknown> }>> }>).blacklistEntry.all([
        {
          memcmp: {
            offset: 8, // skip discriminator
            bytes: configPDA.toBase58(),
          },
        },
      ]);
      blacklistCount = blacklistAccounts.length;
    } catch {
      // Blacklist entries might not exist
    }
  }

  spinner.succeed("Stablecoin state loaded");

  // ─── Display: Header ─────────────────────────────────────────────
  printHeader(`${config.name as string} (${config.symbol as string})`);
  printField("Preset", printPresetBadge(Boolean(config.enablePermanentDelegate), Boolean(config.enableTransferHook)));

  // ─── Display: Identity ───────────────────────────────────────────
  printSection("Identity");
  printField("Name", config.name as string);
  printField("Symbol", config.symbol as string);
  printField("URI", (config.uri as string) || chalk.gray("(none)"));
  printField("Decimals", String(config.decimals));

  // ─── Display: Addresses ──────────────────────────────────────────
  printSection("Addresses");
  printField("Mint", (mintAddress).toBase58());
  printField("", chalk.underline.gray(explorerAccountUrl(mintAddress.toBase58(), rpcUrl)));
  printField("Config PDA", configPDA.toBase58());
  printField("", chalk.underline.gray(explorerAccountUrl(configPDA.toBase58(), rpcUrl)));
  printField("Master Authority", (config.masterAuthority as PublicKey).toBase58());
  printField("", chalk.underline.gray(explorerAccountUrl((config.masterAuthority as PublicKey).toBase58(), rpcUrl)));

  // ─── Display: Feature Flags ──────────────────────────────────────
  printSection("Feature Flags");
  printField("Permanent Delegate", config.enablePermanentDelegate ? chalk.green("Enabled") : chalk.gray("Disabled"));
  printField("Transfer Hook", config.enableTransferHook ? chalk.green("Enabled") : chalk.gray("Disabled"));
  printField("Default Frozen", config.defaultAccountFrozen ? chalk.yellow("YES") : chalk.gray("NO"));
  if (config.enableTransferHook) {
    printField("Hook Program", (config.transferHookProgram as PublicKey).toBase58());
  }

  // ─── Display: Runtime State ──────────────────────────────────────
  printSection("Runtime State");
  printField("Paused", (config.paused as boolean) ? chalk.bgRed.white(" PAUSED ") : chalk.green("Active"));

  // ─── Display: Supply ─────────────────────────────────────────────
  printSection("Supply");
  const totalMinted = (config.totalMinted as anchor.BN).toString();
  const totalBurned = (config.totalBurned as anchor.BN).toString();
  const netSupply = (config.totalMinted as anchor.BN).sub(config.totalBurned as anchor.BN).toString();
  printField("Circulating Supply", chalk.bold(actualSupply));
  printField("Total Minted", formatAmount(totalMinted, decimals));
  printField("Total Burned", formatAmount(totalBurned, decimals));
  printField("Net Supply (config)", formatAmount(netSupply, decimals));

  // ─── Display: Roles ──────────────────────────────────────────────
  const activeRoles = roles.filter((r) => r.active);
  const inactiveRoles = roles.filter((r) => !r.active);

  printSection(`Roles (${activeRoles.length} active, ${inactiveRoles.length} inactive)`);

  if (roles.length === 0) {
    console.log(chalk.gray("    No roles assigned yet"));
  } else {
    // Group by user
    const byUser = new Map<string, RoleAccountData[]>();
    for (const role of roles) {
      const key = role.user.toBase58();
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(role);
    }

    for (const [user, userRoles] of byUser) {
      const activeForUser = userRoles.filter((r) => r.active);
      const inactiveForUser = userRoles.filter((r) => !r.active);

      const roleList = [
        ...activeForUser.map((r) => chalk.green(ROLE_NAMES[r.roleType] || `Role(${r.roleType})`)),
        ...inactiveForUser.map((r) => chalk.gray.strikethrough(ROLE_NAMES[r.roleType] || `Role(${r.roleType})`)),
      ].join(", ");

      console.log(`    ${chalk.white(truncateAddress(user))}  ${roleList}`);
    }
  }

  // ─── Display: Minter Quotas ──────────────────────────────────────
  if (minterQuotas.length > 0) {
    printSection(`Minter Quotas (${minterQuotas.length})`);
    console.log(chalk.gray("    Address              Minted / Quota                Status"));
    printDivider();

    // Cross-reference with role data for active status
    const minterRoles = new Map<string, boolean>();
    for (const role of roles) {
      if (role.roleType === 0) { // Minter
        minterRoles.set(role.user.toBase58(), role.active);
      }
    }

    for (const mq of minterQuotas) {
      const minterAddr = mq.minter.toBase58();
      const isActive = minterRoles.get(minterAddr) ?? false;
      printMinterEntry(
        minterAddr,
        formatAmount(mq.minted.toString(), decimals),
        formatAmount(mq.quota.toString(), decimals),
        isActive
      );

      // Show remaining capacity
      const remaining = mq.quota.sub(mq.minted);
      const pctUsed = mq.quota.isZero()
        ? 0
        : mq.minted.muln(100).div(mq.quota).toNumber();
      const bar = pctUsed >= 90
        ? chalk.red(`${pctUsed}% used`)
        : pctUsed >= 50
          ? chalk.yellow(`${pctUsed}% used`)
          : chalk.green(`${pctUsed}% used`);
      printSubField("  Remaining", `${formatAmount(remaining.toString(), decimals)}  (${bar})`);
    }
  }

  // ─── Display: Blacklist (SSS-2 only) ─────────────────────────────
  if (isSSS2) {
    printSection(`Blacklist (${blacklistCount} ${blacklistCount === 1 ? "entry" : "entries"})`);
    if (blacklistCount === 0) {
      console.log(chalk.gray("    No addresses blacklisted"));
    } else {
      console.log(`    ${chalk.yellow(String(blacklistCount))} address${blacklistCount === 1 ? "" : "es"} currently blacklisted`);
      console.log(chalk.gray("    Run `sss-token blacklist list` for details"));
    }
  }

  // ─── Display: Footer ────────────────────────────────────────────
  console.log();
  printDivider();
  const preset = isSSS2 ? "SSS-2" : "SSS-1";
  console.log(chalk.gray(`  ${preset} stablecoin on ${rpcUrl}`));
  console.log();
}

async function handleSupply(globalOpts: Record<string, string>): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Fetching supply statistics...");

  const config = await (program.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>> }>).stablecoinConfig.fetch(configPDA);
  const mintAddress = config.mint as PublicKey;
  const decimals = config.decimals as number;

  // Also fetch actual on-chain supply from the mint
  let actualSupply = "(unavailable)";
  try {
    const mintInfo = await getMint(connection, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID);
    actualSupply = formatAmount(mintInfo.supply.toString(), decimals);
  } catch {
    // mint might not exist
  }

  spinner.succeed("Supply data loaded");
  printHeader("Supply Statistics");

  const totalMinted = (config.totalMinted as anchor.BN).toString();
  const totalBurned = (config.totalBurned as anchor.BN).toString();
  const netSupply = (config.totalMinted as anchor.BN).sub(config.totalBurned as anchor.BN).toString();

  printField("Circulating Supply", chalk.bold(actualSupply));
  printField("Total Minted", formatAmount(totalMinted, decimals));
  printField("Total Burned", formatAmount(totalBurned, decimals));
  printField("Net Supply (config)", formatAmount(netSupply, decimals));
  console.log();
}
