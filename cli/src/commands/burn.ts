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
  ROLE_BURNER,
} from "../helpers";

export function registerBurnCommand(program: Command): void {
  program
    .command("burn")
    .description("Burn tokens from your own token account")
    .argument("<amount>", "Amount of tokens to burn (in smallest unit)")
    .action(async (amount: string) => {
      try {
        await handleBurn(amount, program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });
}

async function handleBurn(amountStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const mintPubkey = new PublicKey(sssConfig.mintAddress);
  const amount = new anchor.BN(amountStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_BURNER, keypair.publicKey);
  const fromATA = getATA(mintPubkey, keypair.publicKey);

  info(`Burning ${amountStr} tokens from ${fromATA.toBase58()}...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .burnTokens(amount)
    .accounts({
      burner: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
      mint: mintPubkey,
      fromTokenAccount: fromATA,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  success(`Burned ${amountStr} tokens!`);
  console.log(chalk.cyan("  Transaction:"), tx);
  console.log(chalk.cyan("  Amount:     "), amountStr);
}
