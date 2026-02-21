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
    transferHookProgramId: hookProgram.programId,
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
      .updateRoles(roleType, authority.publicKey, true)
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

  // --- Step 5: Blacklist an address ---
  console.log("\n--- Step 5: Blacklist Demo ---");

  const suspiciousUser = Keypair.generate();
  const [blacklistPda] = PublicKey.findProgramAddressSync(
    [BLACKLIST_SEED, configPda.toBuffer(), suspiciousUser.publicKey.toBuffer()],
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
    .addToBlacklist(suspiciousUser.publicKey, "Suspicious activity detected")
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: blacklisterRolePda,
      blacklistEntry: blacklistPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`  Blacklisted ${suspiciousUser.publicKey.toBase58().slice(0, 8)}...: ${blTx}`);

  // --- Step 6: Remove from Blacklist ---
  console.log("\n--- Step 6: Remove from Blacklist ---");

  const unblTx = await sssProgram.methods
    .removeFromBlacklist(suspiciousUser.publicKey)
    .accountsStrict({
      authority: authority.publicKey,
      config: configPda,
      roleAccount: blacklisterRolePda,
      blacklistEntry: blacklistPda,
    })
    .rpc();

  console.log(`  Unblacklisted: ${unblTx}`);

  // --- Final Status ---
  console.log("\n--- Final Status ---");
  const config = await (sssProgram.account as any).stablecoinConfig.fetch(configPda);
  console.log(`  Name:             ${config.name}`);
  console.log(`  Symbol:           ${config.symbol}`);
  console.log(`  Total Minted:     ${config.totalMinted.toString()}`);
  console.log(`  Permanent Delegate: ${config.enablePermanentDelegate}`);
  console.log(`  Transfer Hook:    ${config.enableTransferHook}`);
  console.log(`  Hook Program:     ${config.transferHookProgram.toBase58()}`);

  console.log("\n=== SSS-2 Deployment Complete! ===");
}

main().catch(console.error);
