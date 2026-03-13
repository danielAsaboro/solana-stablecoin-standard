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
  getATA,
  SSS_PROGRAM_ID,
  ROLE_BURNER,
} from "../helpers";
import {
  spin,
  infoMsg,
  errorMsg,
  isDryRun,
  printDryRunPlan,
  printTxResult,
} from "../output";

export function registerBurnCommand(program: Command): void {
  program
    .command("burn")
    .description("Burn tokens from your own token account")
    .argument("<amount>", "Amount of tokens to burn (in smallest unit)")
    .action(async (amount: string) => {
      try {
        await handleBurn(amount, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleBurn(amountStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const mintPubkey = new PublicKey(sssConfig.mintAddress);
  const amount = new anchor.BN(amountStr);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "burn", {
      amount: amountStr,
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const [rolePDA] = deriveRolePDA(configPDA, ROLE_BURNER, keypair.publicKey);
  const fromATA = getATA(mintPubkey, keypair.publicKey);
  infoMsg(`Burning ${amountStr} tokens from ${fromATA.toBase58()}...`);

  const program = await loadSssProgram(provider);

  const spinner = spin("Sending burn transaction...");

  let tx: string;
  try {
    tx = await program.methods
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
    spinner.succeed("Tokens burned successfully!");
  } catch (err) {
    spinner.fail("Burn transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx], ["From", fromATA.toBase58()], ["Amount", amountStr]]);
}
