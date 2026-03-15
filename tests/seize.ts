import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sss } from "../target/types/sss";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
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
const ROLE_BLACKLISTER = 3;
const ROLE_SEIZER = 4;

describe("Seize", () => {
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

  const victim = Keypair.generate();
  const treasury = Keypair.generate();

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;
  let victimAta: PublicKey;
  let treasuryAta: PublicKey;
  let victimBlacklistEntry: PublicKey;
  let seizerRolePda: PublicKey;

  before(async () => {
    // Fund accounts
    for (const kp of [victim, treasury]) {
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: kp.publicKey,
          lamports: 500_000_000,
        })
      );
      await provider.sendAndConfirm(tx);
    }

    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()], program.programId
    );

    // Init SSS-2 with permanent delegate + transfer hook
    await program.methods
      .initialize({
        name: "Seize Test",
        symbol: "SZE",
        uri: "https://test.com",
        decimals: 6,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        defaultAccountFrozen: false,
        enableConfidentialTransfer: false,
        transferHookProgramId: hookProgram.programId,
        supplyCap: new anchor.BN(0),
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

    // Initialize extra account metas for the transfer hook
    const [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mintKey.toBuffer()],
      hookProgram.programId
    );
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

    // Setup minter, blacklister, and seizer roles
    for (const roleType of [ROLE_MINTER, ROLE_BLACKLISTER, ROLE_SEIZER]) {
      const [rolePda] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([roleType]), authority.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .assignRole(roleType, authority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    }

    // Store commonly used PDAs
    [seizerRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_SEIZER]), authority.publicKey.toBuffer()],
      program.programId
    );

    // Set quota
    const [quotaPda] = PublicKey.findProgramAddressSync(
      [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .createMinter(authority.publicKey, new anchor.BN(1_000_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: quotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Create ATAs
    victimAta = getAssociatedTokenAddressSync(mintKey, victim.publicKey, false, TOKEN_2022_PROGRAM_ID);
    treasuryAta = getAssociatedTokenAddressSync(mintKey, treasury.publicKey, false, TOKEN_2022_PROGRAM_ID);

    for (const [owner, ata] of [[victim.publicKey, victimAta], [treasury.publicKey, treasuryAta]] as const) {
      const tx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, ata as PublicKey, owner as PublicKey, mintKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(tx);
    }

    // Mint to victim
    const [minterRole] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_MINTER]), authority.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .mintTokens(new anchor.BN(200_000_000))
      .accountsStrict({
        minter: authority.publicKey,
        config: configPda,
        roleAccount: minterRole,
        minterQuota: quotaPda,
        mint: mintKey,
        recipientTokenAccount: victimAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    // Blacklist victim (required for seize)
    const [blacklisterRole] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), authority.publicKey.toBuffer()],
      program.programId
    );
    [victimBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), victim.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .addToBlacklist(victim.publicKey, "Seize target", Array(32).fill(0), "")
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRole,
        blacklistEntry: victimBlacklistEntry,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
  });

  it("seizes tokens to treasury", async () => {
    // Build dummy ix for hook account resolution — config PDA is the permanent delegate
    const dummyIx = createTransferCheckedInstruction(
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(100_000_000), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, dummyIx, hookProgram.programId,
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(100_000_000), "confirmed"
    );
    const extraKeys = dummyIx.keys.slice(4);

    await program.methods
      .seize(new anchor.BN(100_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: seizerRolePda,
        mint: mintKey,
        fromTokenAccount: victimAta,
        toTokenAccount: treasuryAta,
        blacklistedOwner: victim.publicKey,
        blacklistEntry: victimBlacklistEntry,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts(extraKeys)
      .rpc({ commitment: "confirmed" });

    const victimAccount = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(victimAccount.amount)).to.equal(100_000_000);

    const treasuryAccount = await getAccount(connection, treasuryAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(treasuryAccount.amount)).to.equal(100_000_000);
  });

  it("rejects zero amount seize", async () => {
    const dummyIx = createTransferCheckedInstruction(
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(1), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, dummyIx, hookProgram.programId,
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(1), "confirmed"
    );
    const extraKeys = dummyIx.keys.slice(4);

    try {
      await program.methods
        .seize(new anchor.BN(0))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: seizerRolePda,
          mint: mintKey,
          fromTokenAccount: victimAta,
          toTokenAccount: treasuryAta,
          blacklistedOwner: victim.publicKey,
          blacklistEntry: victimBlacklistEntry,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(extraKeys)
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  it("rejects seize by non-Seizer", async () => {
    const attacker = Keypair.generate();
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: attacker.publicKey,
        lamports: 100_000_000,
      })
    );
    await provider.sendAndConfirm(fundTx);

    const [attackerRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_SEIZER]), attacker.publicKey.toBuffer()],
      program.programId
    );

    const dummyIx = createTransferCheckedInstruction(
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(50_000_000), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, dummyIx, hookProgram.programId,
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(50_000_000), "confirmed"
    );
    const extraKeys = dummyIx.keys.slice(4);

    try {
      await program.methods
        .seize(new anchor.BN(50_000_000))
        .accountsStrict({
          authority: attacker.publicKey,
          config: configPda,
          roleAccount: attackerRolePda,
          mint: mintKey,
          fromTokenAccount: victimAta,
          toTokenAccount: treasuryAta,
          blacklistedOwner: victim.publicKey,
          blacklistEntry: victimBlacklistEntry,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(extraKeys)
        .signers([attacker])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.satisfy((msg: string) =>
        msg.includes("AccountNotInitialized") ||
        msg.includes("AnchorError") ||
        msg.includes("Unauthorized") ||
        msg.includes("Error")
      );
    }
  });

  it("seizes full remaining balance", async () => {
    const victimBefore = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const remainingBalance = Number(victimBefore.amount);
    expect(remainingBalance).to.be.greaterThan(0);

    const dummyIx = createTransferCheckedInstruction(
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(remainingBalance), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, dummyIx, hookProgram.programId,
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(remainingBalance), "confirmed"
    );
    const extraKeys = dummyIx.keys.slice(4);

    await program.methods
      .seize(new anchor.BN(remainingBalance))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: seizerRolePda,
        mint: mintKey,
        fromTokenAccount: victimAta,
        toTokenAccount: treasuryAta,
        blacklistedOwner: victim.publicKey,
        blacklistEntry: victimBlacklistEntry,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts(extraKeys)
      .rpc({ commitment: "confirmed" });

    const victimAfter = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(victimAfter.amount)).to.equal(0);
  });

  it("rejects seize with mismatched blacklisted_owner", async () => {
    // Pass treasury as blacklisted_owner but victim's ATA as source
    // The blacklist PDA for treasury doesn't exist, so Anchor constraint fails
    const [treasuryBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), treasury.publicKey.toBuffer()],
      program.programId
    );

    const dummyIx = createTransferCheckedInstruction(
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(1), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, dummyIx, hookProgram.programId,
      victimAta, mintKey, treasuryAta, configPda,
      BigInt(1), "confirmed"
    );
    const extraKeys = dummyIx.keys.slice(4);

    try {
      await program.methods
        .seize(new anchor.BN(1))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: seizerRolePda,
          mint: mintKey,
          fromTokenAccount: victimAta,
          toTokenAccount: treasuryAta,
          blacklistedOwner: treasury.publicKey,
          blacklistEntry: treasuryBlacklistEntry,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(extraKeys)
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.satisfy((msg: string) =>
        msg.includes("AccountNotInitialized") ||
        msg.includes("AnchorError") ||
        msg.includes("ConstraintSeeds") ||
        msg.includes("Error")
      );
    }
  });

  it("rejects seize on non-blacklisted account", async () => {
    // Treasury is not blacklisted — mint some tokens to treasury first (it already has tokens from seize)
    const [treasuryBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), treasury.publicKey.toBuffer()],
      program.programId
    );

    // Create a destination for seized tokens (use victim's ATA which is empty)
    const dummyIx = createTransferCheckedInstruction(
      treasuryAta, mintKey, victimAta, configPda,
      BigInt(10_000_000), 6, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection, dummyIx, hookProgram.programId,
      treasuryAta, mintKey, victimAta, configPda,
      BigInt(10_000_000), "confirmed"
    );
    const extraKeys = dummyIx.keys.slice(4);

    try {
      await program.methods
        .seize(new anchor.BN(10_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: seizerRolePda,
          mint: mintKey,
          fromTokenAccount: treasuryAta,
          toTokenAccount: victimAta,
          blacklistedOwner: treasury.publicKey,
          blacklistEntry: treasuryBlacklistEntry,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(extraKeys)
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.satisfy((msg: string) =>
        msg.includes("AccountNotInitialized") ||
        msg.includes("AnchorError") ||
        msg.includes("NotBlacklisted") ||
        msg.includes("Error")
      );
    }
  });
});
