import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  deriveRolePDA,
  deriveBlacklistPDA,
  success,
  info,
  error as logError,
  SSS_PROGRAM_ID,
  ROLE_BLACKLISTER,
} from "../helpers";

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
        logError(err.message || err.toString());
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
        logError(err.message || err.toString());
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

  info(`Adding ${addressPubkey.toBase58()} to blacklist...`);
  info(`Reason: ${reason}`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .addToBlacklist(addressPubkey, reason)
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
      blacklistEntry: blacklistPDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  success(`Address blacklisted!`);
  console.log(chalk.cyan("  Transaction:"), tx);
  console.log(chalk.cyan("  Address:    "), addressPubkey.toBase58());
  console.log(chalk.cyan("  Reason:     "), reason);
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

  info(`Removing ${addressPubkey.toBase58()} from blacklist...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .removeFromBlacklist(addressPubkey)
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
      blacklistEntry: blacklistPDA,
    })
    .rpc();

  success(`Address removed from blacklist!`);
  console.log(chalk.cyan("  Transaction:"), tx);
  console.log(chalk.cyan("  Address:    "), addressPubkey.toBase58());
}
