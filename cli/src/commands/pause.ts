import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  deriveRolePDA,
  success,
  info,
  error as logError,
  SSS_PROGRAM_ID,
  ROLE_PAUSER,
} from "../helpers";

export function registerPauseCommand(program: Command): void {
  program
    .command("pause")
    .description("Pause the stablecoin (blocks minting and burning)")
    .action(async () => {
      try {
        await handlePause(program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });

  program
    .command("unpause")
    .description("Unpause the stablecoin")
    .action(async () => {
      try {
        await handleUnpause(program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });
}

async function handlePause(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_PAUSER, keypair.publicKey);

  info("Pausing stablecoin...");

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .pause()
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
    })
    .rpc();

  success("Stablecoin paused!");
  console.log(chalk.cyan("  Transaction:"), tx);
}

async function handleUnpause(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_PAUSER, keypair.publicKey);

  info("Unpausing stablecoin...");

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .unpause()
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
    })
    .rpc();

  success("Stablecoin unpaused!");
  console.log(chalk.cyan("  Transaction:"), tx);
}
