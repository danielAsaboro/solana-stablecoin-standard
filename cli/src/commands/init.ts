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
  saveConfig,
  SSS_PROGRAM_ID,
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
    // Load custom config from JSON file
    if (!fs.existsSync(opts.custom)) {
      errorMsg(`Custom config file not found: ${opts.custom}`);
      return;
    }
    const customConfig: CustomConfig = JSON.parse(fs.readFileSync(opts.custom, "utf-8"));
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
  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL for the SSS program. Make sure the program is deployed.");
    return;
  }

  const program = new anchor.Program(idl, provider);

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
  });

  infoMsg(`Config saved to ${chalk.bold(".sss-token.json")}`);
}
