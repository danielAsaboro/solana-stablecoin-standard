import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  deriveRolePDA,
  deriveBlacklistPDA,
  SSS_PROGRAM_ID,
  ROLE_BLACKLISTER,
} from "../helpers";
import { spin, infoMsg, errorMsg, printTxResult } from "../output";

export function registerBlacklistCommand(program: Command): void {
  const blacklist = program
    .command("blacklist")
    .description("Manage the blacklist (SSS-2 only)");

  blacklist
    .command("add")
    .description("Add an address to the blacklist")
    .argument("<address>", "Address to blacklist")
    .option("--reason <reason>", "Reason for blacklisting", "Compliance action")
    .action(async (address: string, opts: { reason: string }) => {
      try {
        await handleBlacklistAdd(address, opts.reason, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  blacklist
    .command("remove")
    .description("Remove an address from the blacklist")
    .argument("<address>", "Address to unblacklist")
    .action(async (address: string) => {
      try {
        await handleBlacklistRemove(address, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleBlacklistAdd(addressStr: string, reason: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const addressPubkey = new PublicKey(addressStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_BLACKLISTER, keypair.publicKey);
  const [blacklistPDA] = deriveBlacklistPDA(configPDA, addressPubkey);

  infoMsg(`Adding ${addressPubkey.toBase58()} to blacklist...`);
  infoMsg(`Reason: ${reason}`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Sending blacklist transaction...");
  let tx: string;
  try {
    tx = await program.methods
      .addToBlacklist(addressPubkey, reason)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        blacklistEntry: blacklistPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    spinner.succeed("Address blacklisted!");
  } catch (err) {
    spinner.fail("Blacklist transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [
    ["Transaction", tx],
    ["Address", addressPubkey.toBase58()],
    ["Reason", reason],
  ]);
}

async function handleBlacklistRemove(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const addressPubkey = new PublicKey(addressStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_BLACKLISTER, keypair.publicKey);
  const [blacklistPDA] = deriveBlacklistPDA(configPDA, addressPubkey);

  infoMsg(`Removing ${addressPubkey.toBase58()} from blacklist...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Removing from blacklist...");
  let tx: string;
  try {
    tx = await program.methods
      .removeFromBlacklist(addressPubkey)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        blacklistEntry: blacklistPDA,
      })
      .rpc();
    spinner.succeed("Address removed from blacklist!");
  } catch (err) {
    spinner.fail("Blacklist removal failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [
    ["Transaction", tx],
    ["Address", addressPubkey.toBase58()],
  ]);
}
