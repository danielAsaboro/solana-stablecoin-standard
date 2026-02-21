import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import chalk from "chalk";

// Program IDs
export const SSS_PROGRAM_ID = new PublicKey("7CPH4PAWa9n4rizL8UGDi7h361NU5jMWGX7VjSBydgjd");
export const TRANSFER_HOOK_PROGRAM_ID = new PublicKey("5UNDXpv8wM8beDKhW7Q7nTX7jtpVvTS5ECLxGHiYX4oV");

// Seeds
export const STABLECOIN_SEED = Buffer.from("stablecoin");
export const ROLE_SEED = Buffer.from("role");
export const MINTER_QUOTA_SEED = Buffer.from("minter_quota");
export const BLACKLIST_SEED = Buffer.from("blacklist");
export const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");

// Role constants
export const ROLE_MINTER = 0;
export const ROLE_BURNER = 1;
export const ROLE_PAUSER = 2;
export const ROLE_BLACKLISTER = 3;
export const ROLE_SEIZER = 4;

export const ROLE_NAMES: Record<number, string> = {
  [ROLE_MINTER]: "Minter",
  [ROLE_BURNER]: "Burner",
  [ROLE_PAUSER]: "Pauser",
  [ROLE_BLACKLISTER]: "Blacklister",
  [ROLE_SEIZER]: "Seizer",
};

export const CONFIG_FILE = ".sss-token.json";

export interface SssTokenConfig {
  configAddress: string;
  mintAddress: string;
  rpcUrl: string;
  preset: string;
}

/**
 * Load the keypair from the given path, or from the default Solana config.
 */
export function loadKeypair(keypairPath?: string): Keypair {
  const resolvedPath = keypairPath || path.join(os.homedir(), ".config", "solana", "id.json");
  const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

/**
 * Get a connection object for the specified RPC URL or default to localhost.
 */
export function getConnection(rpcUrl?: string): Connection {
  const url = rpcUrl || "http://localhost:8899";
  return new Connection(url, "confirmed");
}

/**
 * Derive the StablecoinConfig PDA.
 */
export function deriveConfigPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STABLECOIN_SEED, mint.toBuffer()],
    SSS_PROGRAM_ID
  );
}

/**
 * Derive a RoleAccount PDA.
 */
export function deriveRolePDA(config: PublicKey, roleType: number, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ROLE_SEED, config.toBuffer(), Buffer.from([roleType]), user.toBuffer()],
    SSS_PROGRAM_ID
  );
}

/**
 * Derive a MinterQuota PDA.
 */
export function deriveMinterQuotaPDA(config: PublicKey, minter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_QUOTA_SEED, config.toBuffer(), minter.toBuffer()],
    SSS_PROGRAM_ID
  );
}

/**
 * Derive a BlacklistEntry PDA.
 */
export function deriveBlacklistPDA(config: PublicKey, address: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, config.toBuffer(), address.toBuffer()],
    SSS_PROGRAM_ID
  );
}

/**
 * Derive the ExtraAccountMetas PDA for the transfer hook.
 */
export function deriveExtraAccountMetasPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mint.toBuffer()],
    TRANSFER_HOOK_PROGRAM_ID
  );
}

/**
 * Get the Token-2022 associated token address.
 */
export function getATA(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
}

/**
 * Save the SSS token config to .sss-token.json in the current directory.
 */
export function saveConfig(config: SssTokenConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Load the SSS token config from .sss-token.json.
 */
export function loadConfig(configPath?: string): SssTokenConfig {
  const file = configPath || CONFIG_FILE;
  if (!fs.existsSync(file)) {
    console.error(chalk.red(`Config file not found: ${file}`));
    console.error(chalk.yellow('Run "sss-token init" first to initialize a stablecoin.'));
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * Format a role type number to its name.
 */
export function roleName(roleType: number): string {
  return ROLE_NAMES[roleType] || `Unknown(${roleType})`;
}

/**
 * Print a success message.
 */
export function success(msg: string): void {
  console.log(chalk.green("SUCCESS") + " " + msg);
}

/**
 * Print an info message.
 */
export function info(msg: string): void {
  console.log(chalk.blue("INFO") + " " + msg);
}

/**
 * Print a warning message.
 */
export function warn(msg: string): void {
  console.log(chalk.yellow("WARN") + " " + msg);
}

/**
 * Print an error and exit.
 */
export function error(msg: string): void {
  console.error(chalk.red("ERROR") + " " + msg);
  process.exit(1);
}

/**
 * Parse a role name string to its numeric type.
 */
export function parseRoleType(role: string): number {
  const lower = role.toLowerCase();
  switch (lower) {
    case "minter":
      return ROLE_MINTER;
    case "burner":
      return ROLE_BURNER;
    case "pauser":
      return ROLE_PAUSER;
    case "blacklister":
      return ROLE_BLACKLISTER;
    case "seizer":
      return ROLE_SEIZER;
    default:
      throw new Error(`Unknown role type: ${role}. Valid roles: minter, burner, pauser, blacklister, seizer`);
  }
}
