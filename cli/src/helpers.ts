import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import chalk from "chalk";

// Program IDs
export const SSS_PROGRAM_ID = new PublicKey("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu");
export const TRANSFER_HOOK_PROGRAM_ID = new PublicKey("Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH");

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

export interface SssTokenProfileStore {
  version: 1;
  activeProfile?: string;
  profiles: Record<string, SssTokenConfig>;
}

export function resolveConfigPath(configPath?: string): string {
  return configPath || CONFIG_FILE;
}

function isProfileStore(value: unknown): value is SssTokenProfileStore {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SssTokenProfileStore>;
  return candidate.version === 1 && typeof candidate.profiles === "object" && candidate.profiles !== null;
}

function readConfigFile(configPath?: string): SssTokenConfig | SssTokenProfileStore {
  return JSON.parse(fs.readFileSync(resolveConfigPath(configPath), "utf-8")) as
    | SssTokenConfig
    | SssTokenProfileStore;
}

function selectProfileName(
  store: SssTokenProfileStore,
  requestedProfile?: string
): string {
  if (requestedProfile) {
    if (!store.profiles[requestedProfile]) {
      throw new Error(`Config profile not found: ${requestedProfile}`);
    }
    return requestedProfile;
  }

  if (store.activeProfile && store.profiles[store.activeProfile]) {
    return store.activeProfile;
  }

  const firstProfile = Object.keys(store.profiles)[0];
  if (!firstProfile) {
    throw new Error("No config profiles found.");
  }

  return firstProfile;
}

function upsertProfile(
  existing: SssTokenConfig | SssTokenProfileStore | null,
  config: SssTokenConfig,
  profileName?: string
): SssTokenConfig | SssTokenProfileStore {
  if (!profileName) {
    if (existing && isProfileStore(existing)) {
      const activeProfile = existing.activeProfile || Object.keys(existing.profiles)[0] || "default";
      return {
        version: 1,
        activeProfile,
        profiles: {
          ...existing.profiles,
          [activeProfile]: config,
        },
      };
    }
    return config;
  }

  const profiles = existing && isProfileStore(existing)
    ? { ...existing.profiles, [profileName]: config }
    : { [profileName]: config };

  return {
    version: 1,
    activeProfile: existing && isProfileStore(existing)
      ? existing.activeProfile || profileName
      : profileName,
    profiles,
  };
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
export function saveConfig(config: SssTokenConfig, configPath?: string, profileName?: string): void {
  const resolvedPath = resolveConfigPath(configPath);
  const existing = fs.existsSync(resolvedPath)
    ? readConfigFile(resolvedPath)
    : null;
  const next = upsertProfile(existing, config, profileName);
  fs.writeFileSync(resolvedPath, JSON.stringify(next, null, 2));
}

/**
 * Load the SSS token config from .sss-token.json.
 */
export function loadConfig(configPath?: string, profileName?: string): SssTokenConfig {
  const file = resolveConfigPath(configPath);
  if (!fs.existsSync(file)) {
    console.error(chalk.red(`Config file not found: ${file}`));
    console.error(chalk.yellow('Run "sss-token init" first to initialize a stablecoin.'));
    process.exit(1);
  }
  const parsed = readConfigFile(file);
  if (isProfileStore(parsed)) {
    return parsed.profiles[selectProfileName(parsed, profileName)];
  }
  return parsed;
}

export function configExists(configPath?: string): boolean {
  return fs.existsSync(resolveConfigPath(configPath));
}

export function listConfigProfiles(configPath?: string): {
  path: string;
  activeProfile?: string;
  profiles: Record<string, SssTokenConfig>;
} {
  const file = resolveConfigPath(configPath);
  if (!fs.existsSync(file)) {
    throw new Error(`Config file not found: ${file}`);
  }

  const parsed = readConfigFile(file);
  if (isProfileStore(parsed)) {
    return {
      path: file,
      activeProfile: parsed.activeProfile,
      profiles: parsed.profiles,
    };
  }

  return {
    path: file,
    activeProfile: "default",
    profiles: {
      default: parsed,
    },
  };
}

export function setActiveProfile(configPath: string | undefined, profileName: string): void {
  const file = resolveConfigPath(configPath);
  const parsed = readConfigFile(file);
  if (!isProfileStore(parsed)) {
    throw new Error("Config file does not contain named profiles yet.");
  }
  if (!parsed.profiles[profileName]) {
    throw new Error(`Config profile not found: ${profileName}`);
  }

  const next: SssTokenProfileStore = {
    ...parsed,
    activeProfile: profileName,
  };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
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

export async function loadSssProgram(
  provider: anchor.AnchorProvider
): Promise<anchor.Program> {
  const idl =
    (await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider)) ??
    loadLocalIdl("sss");
  return new anchor.Program(idl, provider);
}

export async function loadTransferHookProgram(
  provider: anchor.AnchorProvider
): Promise<anchor.Program> {
  const idl =
    (await anchor.Program.fetchIdl(TRANSFER_HOOK_PROGRAM_ID, provider)) ??
    loadLocalIdl("transfer_hook");
  return new anchor.Program(idl, provider);
}

function loadLocalIdl(name: string): anchor.Idl {
  const candidatePaths = [
    path.resolve(__dirname, `../../target/idl/${name}.json`),
    path.resolve(__dirname, `../../../target/idl/${name}.json`),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return JSON.parse(fs.readFileSync(candidatePath, "utf-8")) as anchor.Idl;
    }
  }

  throw new Error(`Could not find local ${name} IDL in target/idl/${name}.json`);
}
