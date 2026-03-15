/**
 * Devnet deployment script for SSS-2 (Compliant) Stablecoin.
 *
 * Demonstrates the full compliance lifecycle:
 *   init → mint → blacklist → blocked transfer → seize → unblacklist → transfer
 *
 * Usage:
 *   npx ts-node scripts/deploy-sss2-devnet.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  addExtraAccountMetasForExecute,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const MINTER_QUOTA_SEED = Buffer.from("minter_quota");
const BLACKLIST_SEED = Buffer.from("blacklist");
const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");

const ROLE_MINTER = 0;
const ROLE_BURNER = 1;
const ROLE_PAUSER = 2;
const ROLE_BLACKLISTER = 3;
const ROLE_SEIZER = 4;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const sssProgram = anchor.workspace.Sss as Program;
  const hookProgram = anchor.workspace.TransferHook as Program;
  const authority = provider.wallet;

  console.log("=== SSS-2 Compliant Stablecoin — Devnet Deployment ===\n");
  console.log(`SSS Program:  ${sssProgram.programId.toBase58()}`);
  console.log(`Hook Program: ${hookProgram.programId.toBase58()}`);
  console.log(`Authority:    ${authority.publicKey.toBase58()}\n`);

  // --- Step 1: Initialize SSS-2 Stablecoin ---
  console.log("--- Step 1: Initialize SSS-2 Stablecoin ---");

  const mintKeypair = Keypair.generate();
  const mintKey = mintKeypair.publicKey;

  const [configPda] = PublicKey.findProgramAddressSync(
    [STABLECOIN_SEED, mintKey.toBuffer()],
    sssProgram.programId
  );

  const initParams = {
    name: "SSS-2 Compliant USD",
    symbol: "cUSD",
    uri: "https://sss.example.com/sss2-metadata.json",
    decimals: 6,
    enablePermanentDelegate: true,
    enableTransferHook: true,
    defaultAccountFrozen: false,
    enableConfidentialTransfer: false,
    transferHookProgramId: hookProgram.programId,
    supplyCap: new anchor.BN(0),
  };

  const tx1 = await sssProgram.methods
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

  // --- Step 2: Initialize Transfer Hook ExtraAccountMetas ---
  console.log("--- Step 2: Initialize Transfer Hook ---");

  const [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
    [EXTRA_ACCOUNT_METAS_SEED, mintKey.toBuffer()],
    hookProgram.programId
  );

  const hookTx = await hookProgram.methods
    .initializeExtraAccountMetas()
    .accountsStrict({
      payer: authority.publicKey,
      extraAccountMetas: extraAccountMetasPda,
      mint: mintKey,
      sssProgram: sssProgram.programId,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`  ExtraAccountMetas: ${extraAccountMetasPda.toBase58()}`);
  console.log(`  Tx: ${hookTx}\n`);

  // --- Step 3: Assign All Roles ---
  console.log("--- Step 3: Assign Roles ---");

  const roles = [
    ["Minter", ROLE_MINTER],
    ["Burner", ROLE_BURNER],
    ["Pauser", ROLE_PAUSER],
    ["Blacklister", ROLE_BLACKLISTER],
    ["Seizer", ROLE_SEIZER],
  ] as const;

  for (const [roleName, roleType] of roles) {
    const [rolePda] = PublicKey.findProgramAddressSync(
      [
        ROLE_SEED,
        configPda.toBuffer(),
        Buffer.from([roleType]),
        authority.publicKey.toBuffer(),
      ],
      sssProgram.programId
    );

    await sssProgram.methods
      .assignRole(roleType, authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: rolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`  ${roleName} role assigned`);
  }

  // --- Step 4: Set Minter Quota & Mint ---
  console.log("\n--- Step 4: Mint Tokens ---");

  const [minterQuotaPda] = PublicKey.findProgramAddressSync(
    [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
    sssProgram.programId
  );

  await sssProgram.methods
    .updateMinter(authority.publicKey, new anchor.BN(1_000_000_000_000))
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      minterQuota: minterQuotaPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const authorityAta = getAssociatedTokenAddressSync(
    mintKey,
    authority.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const createAtaTx = new anchor.web3.Transaction().add(
    createAssociatedTokenAccountInstruction(
      authority.publicKey,
      authorityAta,
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
    sssProgram.programId
  );

  const mintTx = await sssProgram.methods
    .mintTokens(new anchor.BN(500_000_000)) // 500 tokens
    .accountsStrict({
      minter: authority.publicKey,
      config: configPda,
      roleAccount: minterRolePda,
      minterQuota: minterQuotaPda,
      mint: mintKey,
      recipientTokenAccount: authorityAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  console.log(`  Minted 500 tokens: ${mintTx}`);

  // --- Step 5: Mint to a second user for seize demo ---
  console.log("\n--- Step 5: Mint to Second User ---");

  const secondUser = Keypair.generate();
  const fundTx = new anchor.web3.Transaction().add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: secondUser.publicKey,
      lamports: 100_000_000,
    })
  );
  await provider.sendAndConfirm(fundTx);

  const secondUserAta = getAssociatedTokenAddressSync(
    mintKey,
    secondUser.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const createSecondAtaTx = new anchor.web3.Transaction().add(
    createAssociatedTokenAccountInstruction(
      authority.publicKey,
      secondUserAta,
      secondUser.publicKey,
      mintKey,
      TOKEN_2022_PROGRAM_ID
    )
  );
  await provider.sendAndConfirm(createSecondAtaTx);

  const mint2Tx = await sssProgram.methods
    .mintTokens(new anchor.BN(200_000_000))
    .accountsStrict({
      minter: authority.publicKey,
      config: configPda,
      roleAccount: minterRolePda,
      minterQuota: minterQuotaPda,
      mint: mintKey,
      recipientTokenAccount: secondUserAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .rpc();

  console.log(`  Minted 200 tokens to ${secondUser.publicKey.toBase58().slice(0, 8)}...: ${mint2Tx}`);

  // --- Step 6: Blacklist the second user ---
  console.log("\n--- Step 6: Blacklist Address ---");

  const [blacklistPda] = PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, configPda.toBuffer(), secondUser.publicKey.toBuffer()],
    sssProgram.programId
  );

  const [blacklisterRolePda] = PublicKey.findProgramAddressSync(
    [
      ROLE_SEED,
      configPda.toBuffer(),
      Buffer.from([ROLE_BLACKLISTER]),
      authority.publicKey.toBuffer(),
    ],
    sssProgram.programId
  );

  const blTx = await sssProgram.methods
    .addToBlacklist(secondUser.publicKey, "OFAC sanctioned entity")
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: blacklisterRolePda,
      blacklistEntry: blacklistPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`  Blacklisted ${secondUser.publicKey.toBase58().slice(0, 8)}...: ${blTx}`);

  // --- Step 7: Seize tokens via permanent delegate ---
  console.log("\n--- Step 7: Seize Tokens (Permanent Delegate) ---");

  const [seizerRolePda] = PublicKey.findProgramAddressSync(
    [
      ROLE_SEED,
      configPda.toBuffer(),
      Buffer.from([ROLE_SEIZER]),
      authority.publicKey.toBuffer(),
    ],
    sssProgram.programId
  );

  // Build extra accounts for seize CPI (transfer hook resolution)
  const dummyIx = createTransferCheckedInstruction(
    secondUserAta,
    mintKey,
    authorityAta,
    configPda,        // permanent delegate = config PDA
    BigInt(200_000_000),
    6,
    [],
    TOKEN_2022_PROGRAM_ID
  );
  await addExtraAccountMetasForExecute(
    provider.connection,
    dummyIx,
    hookProgram.programId,
    secondUserAta,
    mintKey,
    authorityAta,
    configPda,
    BigInt(200_000_000),
    "confirmed"
  );
  const extraKeys = dummyIx.keys.slice(4);

  const seizeTx = await sssProgram.methods
    .seize(new anchor.BN(200_000_000))
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: seizerRolePda,
      mint: mintKey,
      fromTokenAccount: secondUserAta,
      toTokenAccount: authorityAta,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .remainingAccounts(extraKeys)
    .rpc();

  console.log(`  Seized 200 tokens from ${secondUser.publicKey.toBase58().slice(0, 8)}...: ${seizeTx}`);

  // --- Step 8: Remove from Blacklist ---
  console.log("\n--- Step 8: Remove from Blacklist ---");

  const unblTx = await sssProgram.methods
    .removeFromBlacklist(secondUser.publicKey)
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: blacklisterRolePda,
      blacklistEntry: blacklistPda,
    })
    .rpc();

  console.log(`  Unblacklisted ${secondUser.publicKey.toBase58().slice(0, 8)}...: ${unblTx}`);

  // --- Final Status ---
  console.log("\n--- Final Status ---");
  const config = await (sssProgram.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>> }>).stablecoinConfig.fetch(configPda);
  console.log(`  Name:               ${config.name}`);
  console.log(`  Symbol:             ${config.symbol}`);
  console.log(`  Total Minted:       ${String(config.totalMinted)}`);
  console.log(`  Permanent Delegate: ${config.enablePermanentDelegate}`);
  console.log(`  Transfer Hook:      ${config.enableTransferHook}`);

  // --- Summary ---
  const cluster = provider.connection.rpcEndpoint.includes("devnet") ? "devnet" : "custom";
  const explorerBase = "https://explorer.solana.com";
  const clusterParam = cluster === "devnet" ? "?cluster=devnet" : "?cluster=custom&customUrl=" + encodeURIComponent(provider.connection.rpcEndpoint);

  console.log("\n=== SSS-2 Deployment Complete! ===");
  console.log("\nProgram IDs:");
  console.log(`  SSS Program:       ${sssProgram.programId.toBase58()}`);
  console.log(`  Hook Program:      ${hookProgram.programId.toBase58()}`);
  console.log("\nAddresses:");
  console.log(`  Mint:              ${mintKey.toBase58()}`);
  console.log(`  Config PDA:        ${configPda.toBase58()}`);
  console.log(`  ExtraAccountMetas: ${extraAccountMetasPda.toBase58()}`);
  console.log(`  Authority:         ${authority.publicKey.toBase58()}`);
  console.log("\nTransaction Signatures:");
  console.log(`  Initialize:        ${tx1}`);
  console.log(`  Init Hook:         ${hookTx}`);
  console.log(`  Mint (authority):  ${mintTx}`);
  console.log(`  Mint (2nd user):   ${mint2Tx}`);
  console.log(`  Blacklist:         ${blTx}`);
  console.log(`  Seize:             ${seizeTx}`);
  console.log(`  Unblacklist:       ${unblTx}`);
  console.log("\nExplorer Links:");
  console.log(`  SSS Program:       ${explorerBase}/address/${sssProgram.programId.toBase58()}${clusterParam}`);
  console.log(`  Hook Program:      ${explorerBase}/address/${hookProgram.programId.toBase58()}${clusterParam}`);
  console.log(`  Initialize Tx:     ${explorerBase}/tx/${tx1}${clusterParam}`);
  console.log(`  Seize Tx:          ${explorerBase}/tx/${seizeTx}${clusterParam}`);
}

main().catch(console.error);
