import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  loadSssProgram,
  deriveRolePDA,
  SSS_PROGRAM_ID,
  ROLE_PAUSER,
} from "../helpers";
import {
  spin,
  infoMsg,
  errorMsg,
  isDryRun,
  printDryRunPlan,
  printTxResult,
} from "../output";

export function registerPauseCommand(program: Command): void {
  program
    .command("pause")
    .description("Pause the stablecoin (blocks minting and burning)")
    .action(async () => {
      try {
        await handlePause(program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  program
    .command("unpause")
    .description("Unpause the stablecoin")
    .action(async () => {
      try {
        await handleUnpause(program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handlePause(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "pause", {
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_PAUSER, keypair.publicKey);
  infoMsg("Pausing stablecoin...");

  const program = await loadSssProgram(provider);

  const spinner = spin("Sending pause transaction...");
  let tx: string;
  try {
    tx = await program.methods
      .pause()
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
      })
      .rpc();
    spinner.succeed("Stablecoin paused!");
  } catch (err) {
    spinner.fail("Pause transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx]]);
}

async function handleUnpause(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "unpause", {
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_PAUSER, keypair.publicKey);
  infoMsg("Unpausing stablecoin...");

  const program = await loadSssProgram(provider);

  const spinner = spin("Sending unpause transaction...");
  let tx: string;
  try {
    tx = await program.methods
      .unpause()
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
      })
      .rpc();
    spinner.succeed("Stablecoin unpaused!");
  } catch (err) {
    spinner.fail("Unpause transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx]]);
}
