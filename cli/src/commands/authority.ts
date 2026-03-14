import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  loadSssProgram,
  deriveConfigPDA,
} from "../helpers";
import {
  spin,
  infoMsg,
  errorMsg,
  isDryRun,
  printDryRunPlan,
  printTxResult,
} from "../output";

export function registerAuthorityCommand(program: Command): void {
  const authority = program
    .command("authority")
    .description("Two-step authority transfer management");

  authority
    .command("propose")
    .description("Propose transferring master authority to a new address")
    .argument("<new-authority>", "Public key of the proposed new authority")
    .action(async (newAuth: string) => {
      try {
        await handlePropose(newAuth, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  authority
    .command("accept")
    .description("Accept a pending authority transfer (must be called by proposed authority)")
    .action(async () => {
      try {
        await handleAccept(program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  authority
    .command("cancel")
    .description("Cancel a pending authority transfer (must be called by current authority)")
    .action(async () => {
      try {
        await handleCancel(program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handlePropose(newAuthStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const newAuthority = new PublicKey(newAuthStr);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "authority propose", {
      newAuthority: newAuthority.toBase58(),
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const sssProgram = await loadSssProgram(provider);

  infoMsg(`Proposing authority transfer to ${newAuthority.toBase58()}...`);

  const spinner = spin("Sending propose authority transaction...");
  let tx: string;
  try {
    tx = await sssProgram.methods
      .proposeAuthorityTransfer(newAuthority)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
      })
      .rpc();
    spinner.succeed("Authority transfer proposed!");
  } catch (err) {
    spinner.fail("Propose authority transfer failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [
    ["Transaction", tx],
    ["New Authority", newAuthority.toBase58()],
  ]);
}

async function handleAccept(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "authority accept", {
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const sssProgram = await loadSssProgram(provider);

  infoMsg("Accepting authority transfer...");

  const spinner = spin("Sending accept authority transaction...");
  let tx: string;
  try {
    tx = await sssProgram.methods
      .acceptAuthorityTransfer()
      .accounts({
        newAuthority: keypair.publicKey,
        config: configPDA,
      })
      .rpc();
    spinner.succeed("Authority transfer accepted!");
  } catch (err) {
    spinner.fail("Accept authority transfer failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [
    ["Transaction", tx],
    ["New Authority", keypair.publicKey.toBase58()],
  ]);
}

async function handleCancel(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "authority cancel", {
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const sssProgram = await loadSssProgram(provider);

  infoMsg("Cancelling authority transfer...");

  const spinner = spin("Sending cancel authority transaction...");
  let tx: string;
  try {
    tx = await sssProgram.methods
      .cancelAuthorityTransfer()
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
      })
      .rpc();
    spinner.succeed("Authority transfer cancelled!");
  } catch (err) {
    spinner.fail("Cancel authority transfer failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [
    ["Transaction", tx],
  ]);
}
