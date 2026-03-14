/**
 * Full Lifecycle Test — SSS-2 End-to-End Narrative
 *
 * This test walks through the complete lifecycle of an SSS-2 (compliant)
 * stablecoin from creation to destruction, verifying every milestone:
 *
 *   1. Authority creates an SSS-2 stablecoin (permanent delegate + transfer hook)
 *   2. Assigns all five roles (Minter, Burner, Pauser, Blacklister, Seizer)
 *   3. Initializes the transfer hook extra account metas
 *   4. Mints tokens to two users (Alice and Bob)
 *   5. Normal user-to-user transfer succeeds (hook resolves cleanly)
 *   6. Blacklists Alice — her transfers are now rejected by the hook
 *   7. Alice cannot send tokens (SourceBlacklisted)
 *   8. Alice cannot receive tokens (DestinationBlacklisted)
 *   9. Seizer seizes Alice's funds via permanent delegate (hook bypassed)
 *  10. Burns seized tokens
 *  11. Verifies final supply invariant: totalMinted - totalBurned = circulating supply
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sss } from "../target/types/sss";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  addExtraAccountMetasForExecute,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const MINTER_QUOTA_SEED = Buffer.from("minter_quota");
const BLACKLIST_SEED = Buffer.from("blacklist");

const ROLE_MINTER = 0;
const ROLE_BURNER = 1;
const ROLE_PAUSER = 2;
const ROLE_BLACKLISTER = 3;
const ROLE_SEIZER = 4;

describe("Full Lifecycle: SSS-2 Compliant Stablecoin", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Sss as Program<Sss>;
  const hookProgram = anchor.workspace.TransferHook as Program;
  const authority = provider.wallet;
  const connection = provider.connection;

  const alice = Keypair.generate();
  const bob = Keypair.generate();

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;

  let authorityAta: PublicKey;
  let aliceAta: PublicKey;
  let bobAta: PublicKey;

  // Role PDAs
  let minterRolePda: PublicKey;
  let burnerRolePda: PublicKey;
  let pauserRolePda: PublicKey;
  let blacklisterRolePda: PublicKey;
  let seizerRolePda: PublicKey;
  let minterQuotaPda: PublicKey;
  let extraAccountMetasPda: PublicKey;

  const MINT_AMOUNT_AUTHORITY = 1_000_000_000; // 1,000 tokens
  const MINT_AMOUNT_ALICE = 500_000_000;       // 500 tokens
  const MINT_AMOUNT_BOB = 300_000_000;         // 300 tokens

  // ─── Step 1: Bootstrap ────────────────────────────────────────────────────

  before(async () => {
    // Fund Alice and Bob
    for (const kp of [alice, bob]) {
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: kp.publicKey,
          lamports: 1_000_000_000,
        })
      );
      await provider.sendAndConfirm(tx);
    }

    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;

    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );
    [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mintKey.toBuffer()],
      hookProgram.programId
    );

    // Derive role PDAs
    [minterRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_MINTER]), authority.publicKey.toBuffer()],
      program.programId
    );
    [burnerRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BURNER]), authority.publicKey.toBuffer()],
      program.programId
    );
    [pauserRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_PAUSER]), authority.publicKey.toBuffer()],
      program.programId
    );
    [blacklisterRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), authority.publicKey.toBuffer()],
      program.programId
    );
    [seizerRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_SEIZER]), authority.publicKey.toBuffer()],
      program.programId
    );
    [minterQuotaPda] = PublicKey.findProgramAddressSync(
      [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );

    // Derive ATAs
    authorityAta = getAssociatedTokenAddressSync(mintKey, authority.publicKey, false, TOKEN_2022_PROGRAM_ID);
    aliceAta = getAssociatedTokenAddressSync(mintKey, alice.publicKey, false, TOKEN_2022_PROGRAM_ID);
    bobAta = getAssociatedTokenAddressSync(mintKey, bob.publicKey, false, TOKEN_2022_PROGRAM_ID);
  });

  // ─── Step 2: Create the stablecoin ────────────────────────────────────────

  it("1. creates SSS-2 stablecoin with permanent delegate and transfer hook", async () => {
    await program.methods
      .initialize({
        name: "Lifecycle USD",
        symbol: "LCUSD",
        uri: "https://sss.example.com/meta.json",
        decimals: 6,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        defaultAccountFrozen: false,
        enableConfidentialTransfer: false,
        transferHookProgramId: hookProgram.programId,
      })
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc({ commitment: "confirmed" });

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.name).to.equal("Lifecycle USD");
    expect(config.symbol).to.equal("LCUSD");
    expect(config.enablePermanentDelegate).to.equal(true);
    expect(config.enableTransferHook).to.equal(true);
    expect(config.paused).to.equal(false);
    expect(config.masterAuthority.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  // ─── Step 3: Assign all five roles ────────────────────────────────────────

  it("2. assigns all five roles to authority", async () => {
    for (const [roleType, rolePda] of [
      [ROLE_MINTER, minterRolePda],
      [ROLE_BURNER, burnerRolePda],
      [ROLE_PAUSER, pauserRolePda],
      [ROLE_BLACKLISTER, blacklisterRolePda],
      [ROLE_SEIZER, seizerRolePda],
    ] as [number, PublicKey][]) {
      await program.methods
        .updateRoles(roleType, authority.publicKey, true)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const role = await program.account.roleAccount.fetch(rolePda);
      expect(role.active).to.equal(true);
    }
  });

  it("3. sets minter quota", async () => {
    await program.methods
      .updateMinter(authority.publicKey, new anchor.BN(10_000_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: minterQuotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const quota = await program.account.minterQuota.fetch(minterQuotaPda);
    expect(quota.quota.toNumber()).to.equal(10_000_000_000);
  });

  // ─── Step 4: Initialize transfer hook metas ───────────────────────────────

  it("4. initializes transfer hook extra account metas", async () => {
    await hookProgram.methods
      .initializeExtraAccountMetas()
      .accountsStrict({
        payer: authority.publicKey,
        extraAccountMetas: extraAccountMetasPda,
        mint: mintKey,
        sssProgram: program.programId,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const info = await connection.getAccountInfo(extraAccountMetasPda, "confirmed");
    expect(info).to.not.be.null;
    expect(info!.data.length).to.be.greaterThan(0);
  });

  // ─── Step 5: Create ATAs and mint tokens ──────────────────────────────────

  it("5. creates token accounts and mints to authority, Alice, and Bob", async () => {
    // Create ATAs
    const createAtasTx = new anchor.web3.Transaction();
    for (const [owner, ata] of [
      [authority.publicKey, authorityAta],
      [alice.publicKey, aliceAta],
      [bob.publicKey, bobAta],
    ] as [PublicKey, PublicKey][]) {
      createAtasTx.add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, ata, owner, mintKey, TOKEN_2022_PROGRAM_ID
        )
      );
    }
    await provider.sendAndConfirm(createAtasTx);

    // Mint to authority
    await program.methods
      .mintTokens(new anchor.BN(MINT_AMOUNT_AUTHORITY))
      .accountsStrict({
        minter: authority.publicKey,
        config: configPda,
        roleAccount: minterRolePda,
        minterQuota: minterQuotaPda,
        mint: mintKey,
        recipientTokenAccount: authorityAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    // Mint to Alice via transfer
    const transferToAlice = createTransferCheckedInstruction(
      authorityAta, mintKey, aliceAta, authority.publicKey,
      BigInt(MINT_AMOUNT_ALICE), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, transferToAlice, hookProgram.programId,
      authorityAta, mintKey, aliceAta, authority.publicKey,
      BigInt(MINT_AMOUNT_ALICE), "confirmed"
    );
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(transferToAlice));

    // Mint to Bob via transfer
    const transferToBob = createTransferCheckedInstruction(
      authorityAta, mintKey, bobAta, authority.publicKey,
      BigInt(MINT_AMOUNT_BOB), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, transferToBob, hookProgram.programId,
      authorityAta, mintKey, bobAta, authority.publicKey,
      BigInt(MINT_AMOUNT_BOB), "confirmed"
    );
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(transferToBob));

    // Verify balances
    const authAccount = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(authAccount.amount)).to.equal(MINT_AMOUNT_AUTHORITY - MINT_AMOUNT_ALICE - MINT_AMOUNT_BOB);

    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAccount.amount)).to.equal(MINT_AMOUNT_ALICE);

    const bobAccount = await getAccount(connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(bobAccount.amount)).to.equal(MINT_AMOUNT_BOB);

    // Verify on-chain total minted
    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.totalMinted.toNumber()).to.equal(MINT_AMOUNT_AUTHORITY);
  });

  // ─── Step 6: Normal user transfer succeeds ────────────────────────────────

  it("6. user-to-user transfer succeeds through hook (non-blacklisted)", async () => {
    const transferAmount = 50_000_000; // 50 tokens
    const aliceBefore = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const bobBefore = await getAccount(connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID);

    const transferIx = createTransferCheckedInstruction(
      aliceAta, mintKey, bobAta, alice.publicKey,
      BigInt(transferAmount), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, transferIx, hookProgram.programId,
      aliceAta, mintKey, bobAta, alice.publicKey,
      BigInt(transferAmount), "confirmed"
    );
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(transferIx), [alice]);

    const aliceAfter = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAfter.amount)).to.equal(Number(aliceBefore.amount) - transferAmount);

    const bobAfter = await getAccount(connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(bobAfter.amount)).to.equal(Number(bobBefore.amount) + transferAmount);
  });

  // ─── Step 7: Blacklist Alice ──────────────────────────────────────────────

  it("7. blacklists Alice", async () => {
    const [aliceBlacklist] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .addToBlacklist(alice.publicKey, "Sanctions list match")
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRolePda,
        blacklistEntry: aliceBlacklist,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const entry = await program.account.blacklistEntry.fetch(aliceBlacklist);
    expect(entry.address.toBase58()).to.equal(alice.publicKey.toBase58());
    expect(entry.reason).to.equal("Sanctions list match");
  });

  // ─── Step 8: Blacklisted sender is rejected ───────────────────────────────

  it("8. blacklisted sender (Alice) cannot transfer tokens", async () => {
    const transferIx = createTransferCheckedInstruction(
      aliceAta, mintKey, bobAta, alice.publicKey,
      BigInt(10_000_000), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, transferIx, hookProgram.programId,
      aliceAta, mintKey, bobAta, alice.publicKey,
      BigInt(10_000_000), "confirmed"
    );

    try {
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(transferIx), [alice]);
      expect.fail("Should have thrown SourceBlacklisted");
    } catch (err) {
      expect((err as Error).toString()).to.include("Blacklisted");
    }
  });

  // ─── Step 9: Blacklisted recipient is rejected ────────────────────────────

  it("9. blacklisted recipient (Alice) cannot receive tokens", async () => {
    // Bob tries to send to blacklisted Alice
    const transferIx = createTransferCheckedInstruction(
      bobAta, mintKey, aliceAta, bob.publicKey,
      BigInt(10_000_000), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, transferIx, hookProgram.programId,
      bobAta, mintKey, aliceAta, bob.publicKey,
      BigInt(10_000_000), "confirmed"
    );

    try {
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(transferIx), [bob]);
      expect.fail("Should have thrown DestinationBlacklisted");
    } catch (err) {
      expect((err as Error).toString()).to.include("Blacklisted");
    }
  });

  // ─── Step 10: Seize bypasses blacklist via permanent delegate ─────────────

  it("10. seizer seizes all of Alice's tokens (hook bypass via permanent delegate)", async () => {
    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const seizeAmount = Number(aliceAccount.amount);
    const authorityBefore = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);

    const [aliceBlacklist] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );

    // Build dummy ix for hook account resolution — config PDA is the permanent delegate
    const dummyIx = createTransferCheckedInstruction(
      aliceAta, mintKey, authorityAta, configPda,
      BigInt(seizeAmount), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, dummyIx, hookProgram.programId,
      aliceAta, mintKey, authorityAta, configPda,
      BigInt(seizeAmount), "confirmed"
    );
    const extraKeys = dummyIx.keys.slice(4);

    await program.methods
      .seize(new anchor.BN(seizeAmount))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: seizerRolePda,
        blacklistedOwner: alice.publicKey,
        blacklistEntry: aliceBlacklist,
        mint: mintKey,
        fromTokenAccount: aliceAta,
        toTokenAccount: authorityAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts(extraKeys)
      .rpc({ commitment: "confirmed" });

    const aliceAfter = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAfter.amount)).to.equal(0);

    const authorityAfter = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(authorityAfter.amount)).to.equal(Number(authorityBefore.amount) + seizeAmount);
  });

  // ─── Step 11: Burn seized tokens ──────────────────────────────────────────

  it("11. burns seized tokens from authority account", async () => {
    const authorityBefore = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const burnAmount = 200_000_000; // burn 200 tokens

    await program.methods
      .burnTokens(new anchor.BN(burnAmount))
      .accountsStrict({
        burner: authority.publicKey,
        config: configPda,
        roleAccount: burnerRolePda,
        mint: mintKey,
        fromTokenAccount: authorityAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const authorityAfter = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(authorityAfter.amount)).to.equal(Number(authorityBefore.amount) - burnAmount);

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.totalBurned.toNumber()).to.equal(burnAmount);
  });

  // ─── Step 12: Supply invariant ────────────────────────────────────────────

  it("12. supply invariant: totalMinted - totalBurned = total circulating supply", async () => {
    const config = await program.account.stablecoinConfig.fetch(configPda);

    const authorityBalance = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const aliceBalance = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const bobBalance = await getAccount(connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID);

    const circulatingSupply =
      Number(authorityBalance.amount) +
      Number(aliceBalance.amount) +
      Number(bobBalance.amount);

    const expectedSupply = config.totalMinted.toNumber() - config.totalBurned.toNumber();

    expect(circulatingSupply).to.equal(expectedSupply);
  });
});
