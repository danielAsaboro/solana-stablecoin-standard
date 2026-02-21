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
  deriveMinterQuotaPDA,
  getATA,
  success,
  info,
  error as logError,
  SSS_PROGRAM_ID,
  ROLE_MINTER,
} from "../helpers";

export function registerMintCommand(program: Command): void {
  program
    .command("mint")
    .description("Mint tokens to a recipient")
    .argument("<recipient>", "Recipient wallet address")
    .argument("<amount>", "Amount of tokens to mint (in smallest unit)")
    .action(async (recipient: string, amount: string) => {
      try {
        await handleMint(recipient, amount, program.opts());
      } catch (err: any) {
        logError(err.message || err.toString());
      }
    });
}

async function handleMint(recipientStr: string, amountStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const mintPubkey = new PublicKey(sssConfig.mintAddress);
  const recipientPubkey = new PublicKey(recipientStr);
  const amount = new anchor.BN(amountStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, keypair.publicKey);
  const [quotaPDA] = deriveMinterQuotaPDA(configPDA, keypair.publicKey);
  const recipientATA = getATA(mintPubkey, recipientPubkey);

  info(`Minting ${amountStr} tokens to ${recipientPubkey.toBase58()}...`);
  info(`Recipient ATA: ${recipientATA.toBase58()}`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .mintTokens(amount)
    .accounts({
      minter: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
      minterQuota: quotaPDA,
      mint: mintPubkey,
      recipientTokenAccount: recipientATA,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  success(`Minted ${amountStr} tokens!`);
  console.log(chalk.cyan("  Transaction:"), tx);
  console.log(chalk.cyan("  Recipient:  "), recipientPubkey.toBase58());
  console.log(chalk.cyan("  Amount:     "), amountStr);
}
