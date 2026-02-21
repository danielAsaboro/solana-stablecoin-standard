import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  info,
  error as logError,
  SSS_PROGRAM_ID,
} from "../helpers";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show stablecoin config status")
    .action(async () => {
      try {
        await handleStatus(program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });

  program
    .command("supply")
    .description("Show stablecoin supply statistics")
    .action(async () => {
      try {
        await handleSupply(program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });
}

async function handleStatus(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const config = await (program.account as any).stablecoinConfig.fetch(configPDA);

  console.log(chalk.bold("\n  Stablecoin Status"));
  console.log(chalk.gray("  " + "-".repeat(50)));
  console.log(chalk.cyan("  Name:                   "), config.name);
  console.log(chalk.cyan("  Symbol:                 "), config.symbol);
  console.log(chalk.cyan("  URI:                    "), config.uri || "(none)");
  console.log(chalk.cyan("  Decimals:               "), config.decimals);
  console.log(chalk.cyan("  Mint:                   "), config.mint.toBase58());
  console.log(chalk.cyan("  Master Authority:       "), config.masterAuthority.toBase58());
  console.log(chalk.cyan("  Paused:                 "), config.paused ? chalk.red("YES") : chalk.green("NO"));
  console.log(chalk.cyan("  Permanent Delegate:     "), config.enablePermanentDelegate ? chalk.green("Enabled") : chalk.gray("Disabled"));
  console.log(chalk.cyan("  Transfer Hook:          "), config.enableTransferHook ? chalk.green("Enabled") : chalk.gray("Disabled"));
  console.log(chalk.cyan("  Default Account Frozen: "), config.defaultAccountFrozen ? chalk.yellow("YES") : "NO");
  if (config.enableTransferHook) {
    console.log(chalk.cyan("  Hook Program:           "), config.transferHookProgram.toBase58());
  }
  console.log(chalk.cyan("  Total Minted:           "), config.totalMinted.toString());
  console.log(chalk.cyan("  Total Burned:           "), config.totalBurned.toString());
  const netSupply = config.totalMinted.sub(config.totalBurned);
  console.log(chalk.cyan("  Net Supply:             "), netSupply.toString());
  console.log();
}

async function handleSupply(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const config = await (program.account as any).stablecoinConfig.fetch(configPDA);

  console.log(chalk.bold("\n  Supply Statistics"));
  console.log(chalk.gray("  " + "-".repeat(40)));
  console.log(chalk.cyan("  Total Minted:  "), config.totalMinted.toString());
  console.log(chalk.cyan("  Total Burned:  "), config.totalBurned.toString());
  const netSupply = config.totalMinted.sub(config.totalBurned);
  console.log(chalk.cyan("  Net Supply:    "), netSupply.toString());
  console.log();
}
