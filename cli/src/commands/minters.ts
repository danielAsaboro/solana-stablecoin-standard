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
  SSS_PROGRAM_ID,
  ROLE_MINTER,
} from "../helpers";
import { spin, infoMsg, errorMsg, printTxResult, printHeader, printField } from "../output";

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
        errorMsg((err as Error).message || String(err));
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
        errorMsg((err as Error).message || String(err));
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
        errorMsg((err as Error).message || String(err));
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

  infoMsg(`Adding minter ${minterPubkey.toBase58()} with quota ${quotaStr}...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  // First assign the minter role
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, minterPubkey);

  const spinner = spin("Assigning minter role...");

  let tx1: string;
  try {
    tx1 = await program.methods
      .updateRoles(ROLE_MINTER, minterPubkey, true)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (err) {
    spinner.fail("Failed to assign minter role");
    throw err;
  }

  spinner.text = "Setting minter quota...";

  // Then set the quota
  const [quotaPDA] = deriveMinterQuotaPDA(configPDA, minterPubkey);

  let tx2: string;
  try {
    tx2 = await program.methods
      .updateMinter(minterPubkey, quota)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        minterQuota: quotaPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (err) {
    spinner.fail("Failed to set minter quota");
    throw err;
  }

  spinner.succeed("Minter added with quota!");
  printTxResult(tx2, connection.rpcEndpoint, [["Role Tx", tx1], ["Quota Tx", tx2], ["Minter", minterPubkey.toBase58()], ["Quota", quotaStr]]);
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

  infoMsg(`Removing minter ${minterPubkey.toBase58()}...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Removing minter...");

  let tx: string;
  try {
    tx = await program.methods
      .updateRoles(ROLE_MINTER, minterPubkey, false)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (err) {
    spinner.fail("Failed to remove minter");
    throw err;
  }

  spinner.succeed("Minter removed!");
  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx], ["Minter", minterPubkey.toBase58()]]);
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
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, minterPubkey);
  const [quotaPDA] = deriveMinterQuotaPDA(configPDA, minterPubkey);

  const spinner = spin("Fetching minter info...");

  try {
    const role = await (program.account as any).roleAccount.fetch(rolePDA);
    const quota = await (program.account as any).minterQuota.fetch(quotaPDA);

    spinner.stop();
    printHeader("Minter Info");
    printField("Address", minterPubkey.toBase58());
    printField("Active", role.active ? chalk.green("YES") : chalk.red("NO"));
    printField("Quota", quota.quota.toString());
    printField("Minted", quota.minted.toString());
    const remaining = quota.quota.sub(quota.minted);
    printField("Remaining", remaining.toString());
    console.log();
  } catch {
    spinner.fail(`Minter account not found for ${minterPubkey.toBase58()}`);
    errorMsg(`Minter account not found for ${minterPubkey.toBase58()}`);
  }
}
