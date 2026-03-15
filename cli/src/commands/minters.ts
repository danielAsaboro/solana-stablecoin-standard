import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  loadSssProgram,
  deriveRolePDA,
  deriveMinterQuotaPDA,
  SSS_PROGRAM_ID,
  ROLE_MINTER,
} from "../helpers";
import {
  spin,
  infoMsg,
  errorMsg,
  getOutputFormat,
  isDryRun,
  printCsv,
  printDryRunPlan,
  printJson,
  printTxResult,
  printHeader,
  printField,
} from "../output";

interface MinterListEntry {
  minter: string;
  quota: string;
  minted: string;
  remaining: string;
  usedPercent: number;
}

interface MinterInfoEntry {
  address: string;
  active: boolean;
  quota: string;
  minted: string;
  remaining: string;
}

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
    .description("List all minters and their quotas, or query a specific minter")
    .argument("[address]", "Minter wallet address (optional — omit to list all minters)")
    .action(async (address?: string) => {
      try {
        if (address) {
          await handleMintersInfo(address, program.opts());
        } else {
          await handleMintersListAll(program.opts());
        }
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleMintersAdd(addressStr: string, quotaStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const minterPubkey = new PublicKey(addressStr);
  const quota = new anchor.BN(quotaStr);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "minters.add", {
      minter: minterPubkey.toBase58(),
      quota: quotaStr,
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  infoMsg(`Adding minter ${minterPubkey.toBase58()} with quota ${quotaStr}...`);

  const program = await loadSssProgram(provider);

  // First assign the minter role
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, minterPubkey);

  // Check if role PDA already exists to choose the right instruction
  const roleAccountInfo = await connection.getAccountInfo(rolePDA);
  const roleExists = roleAccountInfo !== null;

  const spinner = spin("Assigning minter role...");

  let tx1: string;
  try {
    if (roleExists) {
      tx1 = await program.methods
        .updateRole(ROLE_MINTER, minterPubkey, true)
        .accounts({
          authority: keypair.publicKey,
          config: configPDA,
          roleAccount: rolePDA,
        })
        .rpc();
    } else {
      tx1 = await program.methods
        .assignRole(ROLE_MINTER, minterPubkey)
        .accounts({
          authority: keypair.publicKey,
          config: configPDA,
          roleAccount: rolePDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
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
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const minterPubkey = new PublicKey(addressStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, minterPubkey);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "minters.remove", {
      minter: minterPubkey.toBase58(),
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  infoMsg(`Removing minter ${minterPubkey.toBase58()}...`);

  const program = await loadSssProgram(provider);

  const spinner = spin("Removing minter...");

  let tx: string;
  try {
    // updateRole — the RoleAccount must already exist for removal
    tx = await program.methods
      .updateRole(ROLE_MINTER, minterPubkey, false)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
      })
      .rpc();
  } catch (err) {
    spinner.fail("Failed to remove minter");
    throw err;
  }

  spinner.succeed("Minter removed!");
  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx], ["Minter", minterPubkey.toBase58()]]);
}

async function handleMintersListAll(globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);

  const program = await loadSssProgram(provider);

  const spinner = spin("Fetching all minters...");

  try {
    const accounts = await (program.account as any).minterQuota.all([
      {
        memcmp: {
          offset: 8,
          bytes: configPDA.toBase58(),
        },
      },
    ]);

    const minterPayload: Array<MinterListEntry> = accounts.map(({ account }: { account: any }) => {
      const remaining = account.quota.sub(account.minted);
      const pct = account.quota.isZero()
        ? 0
        : Math.floor(account.minted.muln(100).div(account.quota).toNumber());
      return {
        minter: account.minter.toBase58(),
        quota: account.quota.toString(),
        minted: account.minted.toString(),
        remaining: remaining.toString(),
        usedPercent: pct,
      };
    });

    const outputFormat = getOutputFormat(globalOpts);
    if (outputFormat === "json") {
      spinner.stop();
      printJson({ minters: minterPayload });
      return;
    }
    if (outputFormat === "csv") {
      spinner.stop();
      printCsv<MinterListEntry>(minterPayload, [
        { header: "minter", value: (row) => row.minter },
        { header: "quota", value: (row) => row.quota },
        { header: "minted", value: (row) => row.minted },
        { header: "remaining", value: (row) => row.remaining },
        { header: "used_percent", value: (row) => row.usedPercent },
      ]);
      return;
    }

    spinner.stop();
    printHeader("All Minters");

    if (minterPayload.length === 0) {
      console.log(chalk.gray("  No minters registered for this stablecoin."));
      console.log();
      return;
    }

    for (const minter of minterPayload) {
      printField("Minter", minter.minter);
      printField("Quota", minter.quota);
      printField("Minted", minter.minted);
      printField("Remaining", minter.remaining);
      printField("Used", `${minter.usedPercent}%`);
      console.log();
    }
  } catch (err) {
    spinner.fail("Failed to list minters");
    throw err;
  }
}

async function handleMintersInfo(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const minterPubkey = new PublicKey(addressStr);

  const program = await loadSssProgram(provider);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, minterPubkey);
  const [quotaPDA] = deriveMinterQuotaPDA(configPDA, minterPubkey);

  const spinner = spin("Fetching minter info...");

  try {
    const role = await (program.account as any).roleAccount.fetch(rolePDA);
    const quota = await (program.account as any).minterQuota.fetch(quotaPDA);
    const payload: MinterInfoEntry = {
      address: minterPubkey.toBase58(),
      active: Boolean(role.active),
      quota: quota.quota.toString(),
      minted: quota.minted.toString(),
      remaining: quota.quota.sub(quota.minted).toString(),
    };

    const outputFormat = getOutputFormat(globalOpts);
    if (outputFormat === "json") {
      spinner.stop();
      printJson(payload);
      return;
    }
    if (outputFormat === "csv") {
      spinner.stop();
      printCsv<MinterInfoEntry>([payload], [
        { header: "address", value: (row) => row.address },
        { header: "active", value: (row) => row.active },
        { header: "quota", value: (row) => row.quota },
        { header: "minted", value: (row) => row.minted },
        { header: "remaining", value: (row) => row.remaining },
      ]);
      return;
    }

    spinner.stop();
    printHeader("Minter Info");
    printField("Address", payload.address);
    printField("Active", payload.active ? chalk.green("YES") : chalk.red("NO"));
    printField("Quota", payload.quota);
    printField("Minted", payload.minted);
    printField("Remaining", payload.remaining);
    console.log();
  } catch {
    spinner.fail(`Minter account not found for ${minterPubkey.toBase58()}`);
    errorMsg(`Minter account not found for ${minterPubkey.toBase58()}`);
  }
}
