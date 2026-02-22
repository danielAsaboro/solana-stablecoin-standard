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
import { spin, errorMsg, printHeader, printField } from "../output";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show stablecoin config status")
    .action(async () => {
      try {
        await handleStatus(program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  program
    .command("supply")
    .description("Show stablecoin supply statistics")
    .action(async () => {
      try {
        await handleSupply(program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
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
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Fetching stablecoin status...");

  const config = await (program.account as any).stablecoinConfig.fetch(configPDA);

  spinner.stop();
  printHeader("Stablecoin Status");
  printField("Name", config.name);
  printField("Symbol", config.symbol);
  printField("URI", config.uri || "(none)");
  printField("Decimals", config.decimals);
  printField("Mint", config.mint.toBase58());
  printField("Master Authority", config.masterAuthority.toBase58());
  printField("Paused", config.paused ? chalk.red("YES") : chalk.green("NO"));
  printField("Permanent Delegate", config.enablePermanentDelegate ? chalk.green("Enabled") : chalk.gray("Disabled"));
  printField("Transfer Hook", config.enableTransferHook ? chalk.green("Enabled") : chalk.gray("Disabled"));
  printField("Default Account Frozen", config.defaultAccountFrozen ? chalk.yellow("YES") : "NO");
  if (config.enableTransferHook) {
    printField("Hook Program", config.transferHookProgram.toBase58());
  }
  printField("Total Minted", config.totalMinted.toString());
  printField("Total Burned", config.totalBurned.toString());
  const netSupply = config.totalMinted.sub(config.totalBurned);
  printField("Net Supply", netSupply.toString());
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
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Fetching supply statistics...");

  const config = await (program.account as any).stablecoinConfig.fetch(configPDA);

  spinner.stop();
  printHeader("Supply Statistics");
  printField("Total Minted", config.totalMinted.toString());
  printField("Total Burned", config.totalBurned.toString());
  const netSupply = config.totalMinted.sub(config.totalBurned);
  printField("Net Supply", netSupply.toString());
  console.log();
}
