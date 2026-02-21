import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  deriveRolePDA,
  getATA,
  success,
  info,
  error as logError,
  SSS_PROGRAM_ID,
  ROLE_SEIZER,
} from "../helpers";

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
        logError(err.message || err.toString());
      }
    });
}

async function handleSeize(
  fromStr: string,
  toStr: string,
  amountStr: string | undefined,
  globalOpts: any
): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const mintPubkey = new PublicKey(sssConfig.mintAddress);
  const fromPubkey = new PublicKey(fromStr);
  const toPubkey = new PublicKey(toStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_SEIZER, keypair.publicKey);
  const fromATA = getATA(mintPubkey, fromPubkey);
  const toATA = getATA(mintPubkey, toPubkey);

  // If no amount specified, we would need to query the balance.
  // For now, amount is required.
  if (!amountStr) {
    logError("Please specify --amount to seize.");
    return;
  }
  const amount = new anchor.BN(amountStr);

  info(`Seizing ${amountStr} tokens from ${fromPubkey.toBase58()}...`);
  info(`Destination: ${toPubkey.toBase58()}`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .seize(amount)
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
      mint: mintPubkey,
      fromTokenAccount: fromATA,
      toTokenAccount: toATA,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  success(`Tokens seized!`);
  console.log(chalk.cyan("  Transaction:"), tx);
  console.log(chalk.cyan("  From:       "), fromPubkey.toBase58());
  console.log(chalk.cyan("  To:         "), toPubkey.toBase58());
  console.log(chalk.cyan("  Amount:     "), amountStr);
}
