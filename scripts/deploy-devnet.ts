/**
 * Devnet deployment script for Solana Stablecoin Standard.
 *
 * Usage:
 *   npx ts-node scripts/deploy-devnet.ts
 *
 * Prerequisites:
 *   - `solana config set --url devnet`
 *   - Fund your wallet: `solana airdrop 2`
 *   - Programs deployed: `anchor deploy --provider.cluster devnet`
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const MINTER_QUOTA_SEED = Buffer.from("minter_quota");

const ROLE_MINTER = 0;
const ROLE_BURNER = 1;
const ROLE_PAUSER = 2;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Sss as Program;
  const authority = provider.wallet;

  console.log("=== Solana Stablecoin Standard — Devnet Deployment ===\n");
  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`Authority:  ${authority.publicKey.toBase58()}`);
  console.log(`Cluster:    ${provider.connection.rpcEndpoint}\n`);

  // --- Step 1: Initialize SSS-1 Stablecoin ---
  console.log("--- Step 1: Initialize SSS-1 Stablecoin ---");

  const mintKeypair = Keypair.generate();
  const mintKey = mintKeypair.publicKey;

  const [configPda] = PublicKey.findProgramAddressSync(
    [STABLECOIN_SEED, mintKey.toBuffer()],
    program.programId
  );

  const initParams = {
    name: "SSS Demo USD",
    symbol: "sUSD",
    uri: "https://sss.example.com/metadata.json",
    decimals: 6,
    enablePermanentDelegate: false,
    enableTransferHook: false,
    defaultAccountFrozen: false,
    enableConfidentialTransfer: false,
    transferHookProgramId: null,
    supplyCap: new anchor.BN(0),
  };

  const tx1 = await program.methods
    .initialize(initParams)
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      mint: mintKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([mintKeypair])
    .rpc();

  console.log(`  Mint:   ${mintKey.toBase58()}`);
  console.log(`  Config: ${configPda.toBase58()}`);
  console.log(`  Tx:     ${tx1}\n`);

  // --- Step 2: Assign Roles ---
  console.log("--- Step 2: Assign Roles ---");

  for (const [roleName, roleType] of [
    ["Minter", ROLE_MINTER],
    ["Burner", ROLE_BURNER],
    ["Pauser", ROLE_PAUSER],
  ] as const) {
    const [rolePda] = PublicKey.findProgramAddressSync(
      [
        ROLE_SEED,
        configPda.toBuffer(),
        Buffer.from([roleType]),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );

    const roleTx = await program.methods
      .assignRole(roleType, authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: rolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`  ${roleName} role assigned: ${roleTx}`);
  }

  // --- Step 3: Set Minter Quota ---
  console.log("\n--- Step 3: Set Minter Quota ---");

  const [minterQuotaPda] = PublicKey.findProgramAddressSync(
    [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
    program.programId
  );

  const quotaTx = await program.methods
    .updateMinter(authority.publicKey, new anchor.BN(1_000_000_000_000)) // 1M tokens
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      minterQuota: minterQuotaPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`  Quota set (1M tokens): ${quotaTx}`);

  // --- Step 4: Mint Tokens ---
  console.log("\n--- Step 4: Mint Tokens ---");

  const recipientAta = getAssociatedTokenAddressSync(
    mintKey,
    authority.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Create ATA first
  const createAtaTx = new anchor.web3.Transaction().add(
    createAssociatedTokenAccountInstruction(
      authority.publicKey,
      recipientAta,
      authority.publicKey,
      mintKey,
      TOKEN_2022_PROGRAM_ID
    )
  );
  await provider.sendAndConfirm(createAtaTx);

  const [minterRolePda] = PublicKey.findProgramAddressSync(
    [
      ROLE_SEED,
      configPda.toBuffer(),
      Buffer.from([ROLE_MINTER]),
      authority.publicKey.toBuffer(),
    ],
    program.programId
  );

  const mintAmount = new anchor.BN(100_000_000); // 100 tokens (6 decimals)
  const mintTx = await program.methods
    .mintTokens(mintAmount)
    .accountsStrict({
      minter: authority.publicKey,
      config: configPda,
      roleAccount: minterRolePda,
      minterQuota: minterQuotaPda,
      mint: mintKey,
      recipientTokenAccount: recipientAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  console.log(`  Minted 100 tokens: ${mintTx}`);

  // --- Step 5: Burn Tokens ---
  console.log("\n--- Step 5: Burn Tokens ---");

  const [burnerRolePda] = PublicKey.findProgramAddressSync(
    [
      ROLE_SEED,
      configPda.toBuffer(),
      Buffer.from([ROLE_BURNER]),
      authority.publicKey.toBuffer(),
    ],
    program.programId
  );

  const burnTx = await program.methods
    .burnTokens(new anchor.BN(10_000_000)) // 10 tokens
    .accountsStrict({
      burner: authority.publicKey,
      config: configPda,
      roleAccount: burnerRolePda,
      mint: mintKey,
      fromTokenAccount: recipientAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  console.log(`  Burned 10 tokens: ${burnTx}`);

  // --- Step 6: Freeze / Thaw Account ---
  console.log("\n--- Step 6: Freeze and Thaw ---");

  const [pauserRolePda] = PublicKey.findProgramAddressSync(
    [
      ROLE_SEED,
      configPda.toBuffer(),
      Buffer.from([ROLE_PAUSER]),
      authority.publicKey.toBuffer(),
    ],
    program.programId
  );

  const freezeTx = await program.methods
    .freezeTokenAccount()
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: pauserRolePda,
      mint: mintKey,
      tokenAccount: recipientAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  console.log(`  Froze account:   ${freezeTx}`);

  const thawTx = await program.methods
    .thawTokenAccount()
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: pauserRolePda,
      mint: mintKey,
      tokenAccount: recipientAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  console.log(`  Thawed account:  ${thawTx}`);

  // --- Step 7: Pause / Unpause ---
  console.log("\n--- Step 7: Pause and Unpause ---");

  const pauseTx = await program.methods
    .pause()
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: pauserRolePda,
    })
    .rpc();

  console.log(`  Paused system:   ${pauseTx}`);

  const unpauseTx = await program.methods
    .unpause()
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: pauserRolePda,
    })
    .rpc();

  console.log(`  Unpaused system: ${unpauseTx}`);

  // --- Step 8: Final Status ---
  console.log("\n--- Step 8: Final Status ---");
  const config = await (program.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>> }>).stablecoinConfig.fetch(configPda);
  console.log(`  Name:         ${config.name}`);
  console.log(`  Symbol:       ${config.symbol}`);
  console.log(`  Decimals:     ${config.decimals}`);
  console.log(`  Total Minted: ${String(config.totalMinted)}`);
  console.log(`  Total Burned: ${String(config.totalBurned)}`);
  console.log(`  Paused:       ${config.paused}`);
  console.log(`  PD Enabled:   ${config.enablePermanentDelegate}`);
  console.log(`  Hook Enabled: ${config.enableTransferHook}`);

  // --- Summary ---
  const cluster = provider.connection.rpcEndpoint.includes("devnet") ? "devnet" : "custom";
  const explorerBase = cluster === "devnet"
    ? "https://explorer.solana.com"
    : "https://explorer.solana.com";
  const clusterParam = cluster === "devnet" ? "?cluster=devnet" : "?cluster=custom&customUrl=" + encodeURIComponent(provider.connection.rpcEndpoint);

  console.log("\n=== SSS-1 Deployment Complete! ===");
  console.log("\nProgram IDs:");
  console.log(`  SSS Program:    ${program.programId.toBase58()}`);
  console.log("\nAddresses:");
  console.log(`  Mint:           ${mintKey.toBase58()}`);
  console.log(`  Config PDA:     ${configPda.toBase58()}`);
  console.log(`  Authority:      ${authority.publicKey.toBase58()}`);
  console.log("\nTransaction Signatures:");
  console.log(`  Initialize:     ${tx1}`);
  console.log(`  Mint:           ${mintTx}`);
  console.log(`  Burn:           ${burnTx}`);
  console.log(`  Freeze:         ${freezeTx}`);
  console.log(`  Thaw:           ${thawTx}`);
  console.log(`  Pause:          ${pauseTx}`);
  console.log(`  Unpause:        ${unpauseTx}`);
  console.log("\nExplorer Links:");
  console.log(`  Program:        ${explorerBase}/address/${program.programId.toBase58()}${clusterParam}`);
  console.log(`  Mint:           ${explorerBase}/address/${mintKey.toBase58()}${clusterParam}`);
  console.log(`  Initialize Tx:  ${explorerBase}/tx/${tx1}${clusterParam}`);
  console.log(`  Mint Tx:        ${explorerBase}/tx/${mintTx}${clusterParam}`);
}

main().catch(console.error);
