import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  deriveConfigPDA,
  deriveExtraAccountMetasPDA,
  loadSssProgram,
  loadTransferHookProgram,
  saveConfig,
  TRANSFER_HOOK_PROGRAM_ID,
} from "../helpers";
import { spin, infoMsg, errorMsg, printTxResult, printDetail } from "../output";

interface InitOptions {
  preset?: string;
  custom?: string;
  name?: string;
  symbol?: string;
  uri?: string;
  decimals?: string;
  keypair?: string;
  rpc?: string;
}

interface CustomConfig {
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  enable_permanent_delegate: boolean;
  enable_transfer_hook: boolean;
  default_account_frozen: boolean;
  transfer_hook_program_id?: string;
}

/**
 * Minimal TOML parser for simple stablecoin config files.
 * Handles key = value pairs with string, integer, and boolean values.
 * Supports inline comments (#). Does not support tables or arrays.
 */
function parseTomlConfig(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const valRaw = line.slice(eqIdx + 1).trim().replace(/#.*$/, "").trim();
    if (valRaw === "true") {
      result[key] = true;
    } else if (valRaw === "false") {
      result[key] = false;
    } else if ((valRaw.startsWith('"') && valRaw.endsWith('"')) ||
               (valRaw.startsWith("'") && valRaw.endsWith("'"))) {
      result[key] = valRaw.slice(1, -1);
    } else if (/^\d+$/.test(valRaw)) {
      result[key] = parseInt(valRaw, 10);
    } else {
      result[key] = valRaw;
    }
  }
  return result;
}

/**
 * Validates a parsed custom config object, throwing with a descriptive error
 * for any missing or malformed field before we attempt an on-chain transaction.
 */
function validateCustomConfig(raw: Record<string, unknown>): CustomConfig {
  const required: (keyof CustomConfig)[] = ["name", "symbol", "uri", "decimals", "enable_permanent_delegate", "enable_transfer_hook", "default_account_frozen"];
  for (const field of required) {
    if (raw[field] === undefined || raw[field] === null) {
      throw new Error(`Custom config missing required field: "${field}"`);
    }
  }
  if (typeof raw.name !== "string" || raw.name.length === 0 || raw.name.length > 32) {
    throw new Error(`Custom config "name" must be a non-empty string of at most 32 characters`);
  }
  if (typeof raw.symbol !== "string" || raw.symbol.length === 0 || raw.symbol.length > 10) {
    throw new Error(`Custom config "symbol" must be a non-empty string of at most 10 characters`);
  }
  if (typeof raw.uri !== "string" || raw.uri.length > 200) {
    throw new Error(`Custom config "uri" must be a string of at most 200 characters`);
  }
  if (typeof raw.decimals !== "number" || !Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 9) {
    throw new Error(`Custom config "decimals" must be an integer between 0 and 9`);
  }
  if (typeof raw.enable_transfer_hook !== "boolean") {
    throw new Error(`Custom config "enable_transfer_hook" must be a boolean`);
  }
  if (raw.enable_transfer_hook && !raw.transfer_hook_program_id) {
    throw new Error(`Custom config "transfer_hook_program_id" is required when "enable_transfer_hook" is true`);
  }
  if (typeof raw.enable_permanent_delegate !== "boolean") {
    throw new Error(`Custom config "enable_permanent_delegate" must be a boolean`);
  }
  if (typeof raw.default_account_frozen !== "boolean") {
    throw new Error(`Custom config "default_account_frozen" must be a boolean`);
  }
  return raw as unknown as CustomConfig;
}

/**
 * Load a custom config file in JSON or TOML format.
 * Format is determined by file extension (.toml → TOML, otherwise → JSON).
 */
function loadCustomConfig(filePath: string): CustomConfig {
  const content = fs.readFileSync(filePath, "utf-8");
  const isToml = filePath.toLowerCase().endsWith(".toml");
  const raw = isToml ? parseTomlConfig(content) : JSON.parse(content) as Record<string, unknown>;
  return validateCustomConfig(raw);
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a new stablecoin")
    .option("--preset <preset>", 'Preset to use: "sss-1" or "sss-2"')
    .option("--custom <path>", "Path to custom TOML/JSON config file")
    .option("--name <name>", "Token name (max 32 chars)")
    .option("--symbol <symbol>", "Token symbol (max 10 chars)")
    .option("--uri <uri>", "Metadata URI (max 200 chars)", "")
    .option("--decimals <n>", "Token decimals (0-9)", "6")
    .action(async (opts: InitOptions) => {
      try {
        await handleInit(opts, program.opts());
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleInit(opts: InitOptions, globalOpts: any): Promise<void> {
  const keypair = loadKeypair(globalOpts.keypair || opts.keypair);
  const connection = getConnection(globalOpts.rpc || opts.rpc);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  let enablePermanentDelegate = false;
  let enableTransferHook = false;
  let defaultAccountFrozen = false;
  let transferHookProgramId: PublicKey | null = null;
  let name = opts.name || "My Stablecoin";
  let symbol = opts.symbol || "MUSD";
  let uri = opts.uri || "";
  let decimals = parseInt(opts.decimals || "6", 10);
  let presetLabel = "custom";

  if (opts.custom) {
    // Load custom config from TOML or JSON file
    if (!fs.existsSync(opts.custom)) {
      errorMsg(`Custom config file not found: ${opts.custom}`);
      return;
    }
    const isToml = opts.custom.toLowerCase().endsWith(".toml");
    infoMsg(`Loading custom config from ${chalk.bold(opts.custom)} (${isToml ? "TOML" : "JSON"} format)`);
    const customConfig: CustomConfig = loadCustomConfig(opts.custom);
    name = customConfig.name;
    symbol = customConfig.symbol;
    uri = customConfig.uri;
    decimals = customConfig.decimals;
    enablePermanentDelegate = customConfig.enable_permanent_delegate;
    enableTransferHook = customConfig.enable_transfer_hook;
    defaultAccountFrozen = customConfig.default_account_frozen;
    if (customConfig.transfer_hook_program_id) {
      transferHookProgramId = new PublicKey(customConfig.transfer_hook_program_id);
    }
  } else if (opts.preset === "sss-1") {
    presetLabel = "SSS-1";
    enablePermanentDelegate = false;
    enableTransferHook = false;
    defaultAccountFrozen = false;
    infoMsg(`Using SSS-1 preset: basic stablecoin (no permanent delegate, no transfer hook)`);
  } else if (opts.preset === "sss-2") {
    presetLabel = "SSS-2";
    enablePermanentDelegate = true;
    enableTransferHook = true;
    defaultAccountFrozen = false;
    transferHookProgramId = TRANSFER_HOOK_PROGRAM_ID;
    infoMsg(`Using SSS-2 preset: compliance stablecoin (permanent delegate + transfer hook)`);
  } else {
    errorMsg('Must specify --preset sss-1|sss-2 or --custom <path>');
    return;
  }

  if (enableTransferHook && !transferHookProgramId) {
    transferHookProgramId = TRANSFER_HOOK_PROGRAM_ID;
  }

  infoMsg(`Initializing stablecoin "${name}" (${symbol}) with ${decimals} decimals...`);
  infoMsg(`Authority: ${keypair.publicKey.toBase58()}`);

  // Generate a new mint keypair
  const mintKeypair = Keypair.generate();
  const [configPDA] = deriveConfigPDA(mintKeypair.publicKey);

  infoMsg(`Mint: ${mintKeypair.publicKey.toBase58()}`);
  infoMsg(`Config PDA: ${configPDA.toBase58()}`);

  // Build the initialize instruction
  // Note: In a full implementation this would use the IDL-generated program client.
  // For now we construct the transaction manually using anchor Program with IDL.
  const program = await loadSssProgram(provider);

  const spinner = spin("Submitting initialize transaction...");

  let tx: string;
  try {
    tx = await program.methods
      .initialize({
        name,
        symbol,
        uri,
        decimals,
        enablePermanentDelegate,
        enableTransferHook,
        defaultAccountFrozen,
        transferHookProgramId: transferHookProgramId || null,
      })
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();
    spinner.succeed("Stablecoin initialized!");
  } catch (err) {
    spinner.fail("Initialization failed");
    throw err;
  }

  let hookTx: string | undefined;
  if (enableTransferHook) {
    const [extraAccountMetas] = deriveExtraAccountMetasPDA(mintKeypair.publicKey);
    const hookProgram = await loadTransferHookProgram(provider);
    const hookSpinner = spin("Initializing transfer hook accounts...");

    try {
      hookTx = await hookProgram.methods
        .initializeExtraAccountMetas()
        .accounts({
          payer: keypair.publicKey,
          extraAccountMetas,
          mint: mintKeypair.publicKey,
          sssProgram: program.programId,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      hookSpinner.succeed("Transfer hook accounts initialized!");
    } catch (err) {
      hookSpinner.fail("Transfer hook setup failed");
      throw err;
    }

    printDetail("Transfer Hook", hookTx);
    printDetail("ExtraAccountMetas", extraAccountMetas.toBase58());
  }

  printTxResult(tx, connection.rpcEndpoint, [
    ["Transaction", tx],
    ["Config PDA", configPDA.toBase58()],
    ["Mint", mintKeypair.publicKey.toBase58()],
    ["Preset", presetLabel],
  ]);

  // Save config
  saveConfig({
    configAddress: configPDA.toBase58(),
    mintAddress: mintKeypair.publicKey.toBase58(),
    rpcUrl: connection.rpcEndpoint,
    preset: presetLabel,
  }, globalOpts.config, globalOpts.profile);

  infoMsg(`Config saved to ${chalk.bold(globalOpts.config || ".sss-token.json")}`);
}
