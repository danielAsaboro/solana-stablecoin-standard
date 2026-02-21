import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  deriveRolePDA,
  deriveMinterQuotaPDA,
  success,
  info,
  error as logError,
  SSS_PROGRAM_ID,
  ROLE_MINTER,
} from "../helpers";

export function registerMintersCommand(program: Command): void {
  const minters = program
    .command("minters")
    .description("Manage minters and their quotas");

  minters
    .command("add")
    .description("Add a minter with a quota")
    .argument("<address>", "Minter wallet address")
    .requiredOption("--quota <amount>", "Maximum mint quota")
    .action(async (address: string, opts: { quota: string }) => {
      try {
        await handleMintersAdd(address, opts.quota, program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });

  minters
    .command("remove")
    .description("Remove a minter (set role to inactive)")
    .argument("<address>", "Minter wallet address")
    .action(async (address: string) => {
      try {
        await handleMintersRemove(address, program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });

  minters
    .command("list")
    .description("List minter quota for a specific minter")
    .argument("<address>", "Minter wallet address to query")
    .action(async (address: string) => {
      try {
        await handleMintersInfo(address, program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });
}

async function handleMintersAdd(addressStr: string, quotaStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const minterPubkey = new PublicKey(addressStr);
  const quota = new anchor.BN(quotaStr);

  info(`Adding minter ${minterPubkey.toBase58()} with quota ${quotaStr}...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  // First assign the minter role
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, minterPubkey);

  const tx1 = await program.methods
    .updateRoles(ROLE_MINTER, minterPubkey, true)
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  info(`Minter role assigned (tx: ${tx1})`);

  // Then set the quota
  const [quotaPDA] = deriveMinterQuotaPDA(configPDA, minterPubkey);

  const tx2 = await program.methods
    .updateMinter(minterPubkey, quota)
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      minterQuota: quotaPDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  success(`Minter added with quota!`);
  console.log(chalk.cyan("  Role Tx:  "), tx1);
  console.log(chalk.cyan("  Quota Tx: "), tx2);
  console.log(chalk.cyan("  Minter:   "), minterPubkey.toBase58());
  console.log(chalk.cyan("  Quota:    "), quotaStr);
}

async function handleMintersRemove(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const minterPubkey = new PublicKey(addressStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, minterPubkey);

  info(`Removing minter ${minterPubkey.toBase58()}...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .updateRoles(ROLE_MINTER, minterPubkey, false)
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  success(`Minter removed!`);
  console.log(chalk.cyan("  Transaction:"), tx);
  console.log(chalk.cyan("  Minter:     "), minterPubkey.toBase58());
}

async function handleMintersInfo(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const minterPubkey = new PublicKey(addressStr);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, minterPubkey);
  const [quotaPDA] = deriveMinterQuotaPDA(configPDA, minterPubkey);

  try {
    const role = await (program.account as any).roleAccount.fetch(rolePDA);
    const quota = await (program.account as any).minterQuota.fetch(quotaPDA);

    console.log(chalk.bold("\n  Minter Info"));
    console.log(chalk.gray("  " + "-".repeat(40)));
    console.log(chalk.cyan("  Address:      "), minterPubkey.toBase58());
    console.log(chalk.cyan("  Active:       "), role.active ? chalk.green("YES") : chalk.red("NO"));
    console.log(chalk.cyan("  Quota:        "), quota.quota.toString());
    console.log(chalk.cyan("  Minted:       "), quota.minted.toString());
    const remaining = quota.quota.sub(quota.minted);
    console.log(chalk.cyan("  Remaining:    "), remaining.toString());
    console.log();
  } catch {
    logError(`Minter account not found for ${minterPubkey.toBase58()}`);
  }
}
