import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  addExtraAccountMetasForExecute,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  loadSssProgram,
  deriveRolePDA,
  getATA,
  SSS_PROGRAM_ID,
  ROLE_SEIZER,
} from "../helpers";
import {
  spin,
  infoMsg,
  errorMsg,
  isDryRun,
  printDryRunPlan,
  printTxResult,
} from "../output";

export function registerSeizeCommand(program: Command): void {
  program
    .command("seize")
    .description("Seize tokens from an account using permanent delegate (SSS-2 only)")
    .argument("<address>", "Wallet address to seize tokens from")
    .requiredOption("--to <treasury>", "Destination treasury wallet address")
    .option("--amount <amount>", "Amount to seize (defaults to full balance)")
    .action(async (address: string, opts: { to: string; amount?: string }) => {
      try {
        await handleSeize(address, opts.to, opts.amount, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleSeize(
  fromStr: string,
  toStr: string,
  amountStr: string | undefined,
  globalOpts: any
): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const mintPubkey = new PublicKey(sssConfig.mintAddress);
  const fromPubkey = new PublicKey(fromStr);
  const toPubkey = new PublicKey(toStr);
  const fromATA = getATA(mintPubkey, fromPubkey);
  const toATA = getATA(mintPubkey, toPubkey);

  // If no amount specified, we would need to query the balance.
  // For now, amount is required.
  if (!amountStr) {
    errorMsg("Please specify --amount to seize.");
    return;
  }
  const amount = new anchor.BN(amountStr);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "seize", {
      from: fromPubkey.toBase58(),
      to: toPubkey.toBase58(),
      fromTokenAccount: fromATA.toBase58(),
      toTokenAccount: toATA.toBase58(),
      amount: amountStr,
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_SEIZER, keypair.publicKey);
  infoMsg(`Seizing ${amountStr} tokens from ${fromPubkey.toBase58()}...`);
  infoMsg(`Destination: ${toPubkey.toBase58()}`);

  const program = await loadSssProgram(provider);

  const spinner = spin("Sending seize transaction...");
  let tx: string;
  try {
    const stablecoinConfig =
      await (program.account as any).stablecoinConfig.fetch(configPDA);
    const seizeBuilder = program.methods
      .seize(amount)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        mint: mintPubkey,
        fromTokenAccount: fromATA,
        toTokenAccount: toATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });

    if (stablecoinConfig.enableTransferHook) {
      const hookProgramId = stablecoinConfig.transferHookProgram as PublicKey;
      const dummyIx = createTransferCheckedInstruction(
        fromATA,
        mintPubkey,
        toATA,
        configPDA,
        BigInt(amount.toString()),
        stablecoinConfig.decimals,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      await addExtraAccountMetasForExecute(
        connection,
        dummyIx,
        hookProgramId,
        fromATA,
        mintPubkey,
        toATA,
        configPDA,
        BigInt(amount.toString()),
        "confirmed"
      );

      tx = await seizeBuilder
        .remainingAccounts(dummyIx.keys.slice(4))
        .rpc();
    } else {
      tx = await seizeBuilder.rpc();
    }
    spinner.succeed("Tokens seized!");
  } catch (err) {
    spinner.fail("Seize transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [
    ["Transaction", tx],
    ["From", fromPubkey.toBase58()],
    ["To", toPubkey.toBase58()],
    ["Amount", amountStr],
  ]);
}
