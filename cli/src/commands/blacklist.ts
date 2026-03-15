import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  loadSssProgram,
  deriveRolePDA,
  deriveBlacklistPDA,
  SSS_PROGRAM_ID,
  ROLE_BLACKLISTER,
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
} from "../output";

interface BlacklistEntryView {
  address: string;
  reason: string;
  active: boolean;
}

export function registerBlacklistCommand(program: Command): void {
  const blacklist = program
    .command("blacklist")
    .description("Manage the blacklist (SSS-2 only)");

  blacklist
    .command("add")
    .description("Add an address to the blacklist")
    .argument("<address>", "Address to blacklist")
    .option("--reason <reason>", "Reason for blacklisting", "Compliance action")
    .option("--evidence-hash <hex>", "SHA-256 hash of evidence document (hex string)")
    .option("--evidence-uri <uri>", "URI pointing to evidence document")
    .action(async (address: string, opts: { reason: string; evidenceHash?: string; evidenceUri?: string }) => {
      try {
        const evidenceHash = opts.evidenceHash
          ? Array.from(Buffer.from(opts.evidenceHash, "hex"))
          : Array(32).fill(0);
        const evidenceUri = opts.evidenceUri ?? "";
        await handleBlacklistAdd(address, opts.reason, evidenceHash, evidenceUri, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  blacklist
    .command("list")
    .description("List blacklist entries or inspect a specific address")
    .argument("[address]", "Blacklisted address (optional)")
    .action(async (address?: string) => {
      try {
        await handleBlacklistList(address, program.opts());
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

  blacklist
    .command("evidence")
    .description("Update evidence on an existing blacklist entry")
    .argument("<address>", "Blacklisted address")
    .requiredOption("--hash <hex>", "SHA-256 hash of evidence document (hex string)")
    .requiredOption("--uri <uri>", "URI pointing to evidence document")
    .action(async (address: string, opts: { hash: string; uri: string }) => {
      try {
        const evidenceHash = Array.from(Buffer.from(opts.hash, "hex"));
        await handleUpdateEvidence(address, evidenceHash, opts.uri, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleBlacklistAdd(addressStr: string, reason: string, evidenceHash: number[], evidenceUri: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const addressPubkey = new PublicKey(addressStr);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "blacklist.add", {
      address: addressPubkey.toBase58(),
      reason,
      evidenceUri: evidenceUri || "(none)",
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_BLACKLISTER, keypair.publicKey);
  const [blacklistPDA] = deriveBlacklistPDA(configPDA, addressPubkey);
  infoMsg(`Adding ${addressPubkey.toBase58()} to blacklist...`);
  infoMsg(`Reason: ${reason}`);

  const program = await loadSssProgram(provider);

  const spinner = spin("Sending blacklist transaction...");
  let tx: string;
  try {
    tx = await program.methods
      .addToBlacklist(addressPubkey, reason, evidenceHash, evidenceUri)
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

async function handleUpdateEvidence(addressStr: string, evidenceHash: number[], evidenceUri: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const addressPubkey = new PublicKey(addressStr);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "blacklist.evidence", {
      address: addressPubkey.toBase58(),
      evidenceUri,
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_BLACKLISTER, keypair.publicKey);
  const [blacklistPDA] = deriveBlacklistPDA(configPDA, addressPubkey);
  infoMsg(`Updating evidence for ${addressPubkey.toBase58()}...`);
  infoMsg(`URI: ${evidenceUri}`);

  const program = await loadSssProgram(provider);

  const spinner = spin("Sending update evidence transaction...");
  let tx: string;
  try {
    tx = await program.methods
      .updateBlacklistEvidence(addressPubkey, evidenceHash, evidenceUri)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        blacklistEntry: blacklistPDA,
      })
      .rpc();
    spinner.succeed("Evidence updated!");
  } catch (err) {
    spinner.fail("Update evidence transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [
    ["Transaction", tx],
    ["Address", addressPubkey.toBase58()],
    ["Evidence URI", evidenceUri],
  ]);
}

async function handleBlacklistRemove(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const addressPubkey = new PublicKey(addressStr);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "blacklist.remove", {
      address: addressPubkey.toBase58(),
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_BLACKLISTER, keypair.publicKey);
  const [blacklistPDA] = deriveBlacklistPDA(configPDA, addressPubkey);
  infoMsg(`Removing ${addressPubkey.toBase58()} from blacklist...`);

  const program = await loadSssProgram(provider);

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

async function handleBlacklistList(addressStr: string | undefined, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const configPDA = new PublicKey(sssConfig.configAddress);
  const program = await loadSssProgram(provider);

  const spinner = spin(addressStr ? "Fetching blacklist entry..." : "Fetching blacklist entries...");

  if (addressStr) {
    const target = new PublicKey(addressStr);
    const [blacklistPDA] = deriveBlacklistPDA(configPDA, target);
    try {
      const entry = await (program.account as any).blacklistEntry.fetch(blacklistPDA);
      const payload: BlacklistEntryView = {
        address: target.toBase58(),
        reason: String(entry.reason),
        active: true,
      };
      const outputFormat = getOutputFormat(globalOpts);
      spinner.stop();
      if (outputFormat === "json") {
        printJson(payload);
        return;
      }
      if (outputFormat === "csv") {
        printCsv<BlacklistEntryView>([payload], [
          { header: "address", value: (row) => row.address },
          { header: "reason", value: (row) => row.reason },
          { header: "active", value: (row) => row.active },
        ]);
        return;
      }
      console.log(`Address: ${payload.address}`);
      console.log(`Reason: ${payload.reason}`);
      console.log(`Active: YES`);
      return;
    } catch {
      spinner.fail("Blacklist entry not found");
      throw new Error(`Address is not blacklisted: ${target.toBase58()}`);
    }
  }

  const accounts = await (program.account as any).blacklistEntry.all([
    {
      memcmp: {
        offset: 8,
        bytes: configPDA.toBase58(),
      },
    },
  ]);

  const payload: Array<BlacklistEntryView> = accounts.map(({ account }: { account: any }) => ({
    address: account.address.toBase58(),
    reason: String(account.reason),
    active: true,
  }));

  const outputFormat = getOutputFormat(globalOpts);
  spinner.stop();
  if (outputFormat === "json") {
    printJson({ entries: payload });
    return;
  }
  if (outputFormat === "csv") {
    printCsv<BlacklistEntryView>(payload, [
      { header: "address", value: (row) => row.address },
      { header: "reason", value: (row) => row.reason },
      { header: "active", value: (row) => row.active },
    ]);
    return;
  }

  if (payload.length === 0) {
    console.log("No blacklist entries found.");
    return;
  }

  for (const entry of payload) {
    console.log(`${entry.address}  ${entry.reason}`);
  }
}
