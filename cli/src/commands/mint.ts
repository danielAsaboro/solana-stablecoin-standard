import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  loadSssProgram,
  deriveRolePDA,
  deriveMinterQuotaPDA,
  getATA,
  SSS_PROGRAM_ID,
  ROLE_MINTER,
} from "../helpers";
import {
  spin,
  infoMsg,
  errorMsg,
  isDryRun,
  printDryRunPlan,
  printTxResult,
} from "../output";

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
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleMint(recipientStr: string, amountStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const mintPubkey = new PublicKey(sssConfig.mintAddress);
  const recipientPubkey = new PublicKey(recipientStr);
  const amount = new anchor.BN(amountStr);
  const recipientATA = getATA(mintPubkey, recipientPubkey);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "mint", {
      recipient: recipientPubkey.toBase58(),
      recipientTokenAccount: recipientATA.toBase58(),
      amount: amountStr,
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_MINTER, keypair.publicKey);
  const [quotaPDA] = deriveMinterQuotaPDA(configPDA, keypair.publicKey);
  infoMsg(`Minting ${amountStr} tokens to ${recipientPubkey.toBase58()}...`);
  infoMsg(`Recipient ATA: ${recipientATA.toBase58()}`);

  const program = await loadSssProgram(provider);

  const spinner = spin("Sending mint transaction...");

  let tx: string;
  try {
    tx = await program.methods
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
    spinner.succeed("Tokens minted successfully!");
  } catch (err) {
    spinner.fail("Mint transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx], ["Recipient", recipientPubkey.toBase58()], ["Amount", amountStr]]);
}
