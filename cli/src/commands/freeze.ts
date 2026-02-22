import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  deriveRolePDA,
  getATA,
  SSS_PROGRAM_ID,
  ROLE_PAUSER,
} from "../helpers";
import { spin, infoMsg, errorMsg, printTxResult } from "../output";

export function registerFreezeCommand(program: Command): void {
  program
    .command("freeze")
    .description("Freeze a token account")
    .argument("<address>", "Wallet address whose token account to freeze")
    .action(async (address: string) => {
      try {
        await handleFreeze(address, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  program
    .command("thaw")
    .description("Thaw a frozen token account")
    .argument("<address>", "Wallet address whose token account to thaw")
    .action(async (address: string) => {
      try {
        await handleThaw(address, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleFreeze(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const mintPubkey = new PublicKey(sssConfig.mintAddress);
  const targetPubkey = new PublicKey(addressStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_PAUSER, keypair.publicKey);
  const targetATA = getATA(mintPubkey, targetPubkey);

  infoMsg(`Freezing token account for ${targetPubkey.toBase58()}...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Sending freeze transaction...");
  let tx: string;
  try {
    tx = await program.methods
      .freezeTokenAccount()
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        mint: mintPubkey,
        tokenAccount: targetATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    spinner.succeed("Token account frozen!");
  } catch (err) {
    spinner.fail("Freeze transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx], ["Token Account", targetATA.toBase58()], ["Owner", targetPubkey.toBase58()]]);
}

async function handleThaw(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const mintPubkey = new PublicKey(sssConfig.mintAddress);
  const targetPubkey = new PublicKey(addressStr);

  const [rolePDA] = deriveRolePDA(configPDA, ROLE_PAUSER, keypair.publicKey);
  const targetATA = getATA(mintPubkey, targetPubkey);

  infoMsg(`Thawing token account for ${targetPubkey.toBase58()}...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    errorMsg("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const spinner = spin("Sending thaw transaction...");
  let tx: string;
  try {
    tx = await program.methods
      .thawTokenAccount()
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        mint: mintPubkey,
        tokenAccount: targetATA,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
    spinner.succeed("Token account thawed!");
  } catch (err) {
    spinner.fail("Thaw transaction failed");
    throw err;
  }

  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx], ["Token Account", targetATA.toBase58()], ["Owner", targetPubkey.toBase58()]]);
}
