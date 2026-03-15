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

// ── SSS-1: Token Transfers ──────────────────────────────────────────────────

describe("SSS-1: Token Transfers", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.Sss as Program<Sss>;
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

  let minterRolePda: PublicKey;
  let pauserRolePda: PublicKey;
  let minterQuotaPda: PublicKey;

  before(async () => {
    // Fund Alice and Bob so they can sign transactions
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

    // Derive role PDAs
    [minterRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_MINTER]), authority.publicKey.toBuffer()],
      program.programId
    );
    [pauserRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_PAUSER]), authority.publicKey.toBuffer()],
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

    // Initialize SSS-1 stablecoin
    await program.methods
      .initialize({
        name: "Transfer Test",
        symbol: "XFER",
        uri: "https://test.com/meta.json",
        decimals: 6,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        defaultAccountFrozen: false,
        enableConfidentialTransfer: false,
        transferHookProgramId: null,
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
      .rpc();

    // Assign Minter role
    await program.methods
      .assignRole(ROLE_MINTER, authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: minterRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Assign Pauser role (needed for freeze/thaw)
    await program.methods
      .assignRole(ROLE_PAUSER, authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: pauserRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Set minter quota
    await program.methods
      .createMinter(authority.publicKey, new anchor.BN(1_000_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: minterQuotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Create ATAs for authority, Alice, and Bob
    const createAtasTx = new anchor.web3.Transaction();
    for (const [owner, ata] of [
      [authority.publicKey, authorityAta],
      [alice.publicKey, aliceAta],
      [bob.publicKey, bobAta],
    ] as [PublicKey, PublicKey][]) {
      createAtasTx.add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          ata,
          owner,
          mintKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }
    await provider.sendAndConfirm(createAtasTx);

    // Mint 500 tokens (500_000_000 with 6 decimals) to authority
    await program.methods
      .mintTokens(new anchor.BN(500_000_000))
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
  });

  it("transfers tokens between users via transfer_checked", async () => {
    // Authority transfers 100 tokens to Alice
    const transferIx = createTransferCheckedInstruction(
      authorityAta,
      mintKey,
      aliceAta,
      authority.publicKey,
      BigInt(100_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    await provider.sendAndConfirm(tx);

    const authorityAccount = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(authorityAccount.amount)).to.equal(400_000_000);

    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAccount.amount)).to.equal(100_000_000);
  });

  it("Alice transfers tokens to Bob", async () => {
    // Alice sends 30 tokens to Bob
    const transferIx = createTransferCheckedInstruction(
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(30_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    await provider.sendAndConfirm(tx, [alice]);

    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAccount.amount)).to.equal(70_000_000);

    const bobAccount = await getAccount(connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(bobAccount.amount)).to.equal(30_000_000);
  });

  it("frozen account cannot send tokens", async () => {
    // Freeze Alice's account
    await program.methods
      .freezeTokenAccount()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: pauserRolePda,
        mint: mintKey,
        tokenAccount: aliceAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(aliceAccount.isFrozen).to.equal(true);

    // Try to transfer from frozen Alice to Bob — should fail
    const transferIx = createTransferCheckedInstruction(
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(10_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    try {
      await provider.sendAndConfirm(tx, [alice]);
      expect.fail("Should have thrown");
    } catch (err) {
      // Token-2022 returns 0x11 (AccountFrozen) when source account is frozen
      expect((err as Error).toString()).to.include("0x11");
    }
  });

  it("frozen account cannot receive tokens", async () => {
    // Alice is still frozen from previous test — try to send from Bob to frozen Alice
    const transferIx = createTransferCheckedInstruction(
      bobAta,
      mintKey,
      aliceAta,
      bob.publicKey,
      BigInt(5_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    try {
      await provider.sendAndConfirm(tx, [bob]);
      expect.fail("Should have thrown");
    } catch (err) {
      // Token-2022 returns 0x11 (AccountFrozen) when destination account is frozen
      expect((err as Error).toString()).to.include("0x11");
    }
  });

  it("thawed account can transfer again", async () => {
    // Thaw Alice's account
    await program.methods
      .thawTokenAccount()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: pauserRolePda,
        mint: mintKey,
        tokenAccount: aliceAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const aliceAccountBefore = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(aliceAccountBefore.isFrozen).to.equal(false);

    // Alice transfers 10 tokens to Bob — should succeed
    const transferIx = createTransferCheckedInstruction(
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(10_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    await provider.sendAndConfirm(tx, [alice]);

    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAccount.amount)).to.equal(60_000_000); // 70M - 10M

    const bobAccount = await getAccount(connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(bobAccount.amount)).to.equal(40_000_000); // 30M + 10M
  });
});

// ── SSS-2: Transfer Hook Enforcement ────────────────────────────────────────

describe("SSS-2: Transfer Hook Enforcement", () => {
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
  let blacklisterRolePda: PublicKey;
  let seizerRolePda: PublicKey;
  let minterQuotaPda: PublicKey;

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

    // Derive ATAs
    authorityAta = getAssociatedTokenAddressSync(mintKey, authority.publicKey, false, TOKEN_2022_PROGRAM_ID);
    aliceAta = getAssociatedTokenAddressSync(mintKey, alice.publicKey, false, TOKEN_2022_PROGRAM_ID);
    bobAta = getAssociatedTokenAddressSync(mintKey, bob.publicKey, false, TOKEN_2022_PROGRAM_ID);

    // Initialize SSS-2 stablecoin with permanent delegate + transfer hook
    await program.methods
      .initialize({
        name: "Hook Transfer Test",
        symbol: "HXFER",
        uri: "https://test.com/meta.json",
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

    // Assign all needed roles: Minter, Blacklister, Seizer
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

    // Store commonly used role PDAs
    [minterRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_MINTER]), authority.publicKey.toBuffer()],
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

    // Set minter quota
    await program.methods
      .createMinter(authority.publicKey, new anchor.BN(5_000_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: minterQuotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Create ATAs for authority, Alice, and Bob
    const createAtasTx = new anchor.web3.Transaction();
    for (const [owner, ata] of [
      [authority.publicKey, authorityAta],
      [alice.publicKey, aliceAta],
      [bob.publicKey, bobAta],
    ] as [PublicKey, PublicKey][]) {
      createAtasTx.add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          ata,
          owner,
          mintKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }
    await provider.sendAndConfirm(createAtasTx);

    // Mint 1000 tokens to authority
    await program.methods
      .mintTokens(new anchor.BN(1_000_000_000))
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
  });

  it("transfer succeeds with transfer hook resolved", async () => {
    // Transfer 200 tokens from authority to Alice with hook resolution
    const transferIx = createTransferCheckedInstruction(
      authorityAta,
      mintKey,
      aliceAta,
      authority.publicKey,
      BigInt(200_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection,
      transferIx,
      hookProgram.programId,
      authorityAta,
      mintKey,
      aliceAta,
      authority.publicKey,
      BigInt(200_000_000),
      "confirmed"
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    await provider.sendAndConfirm(tx);

    const authorityAccount = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(authorityAccount.amount)).to.equal(800_000_000);

    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAccount.amount)).to.equal(200_000_000);
  });

  it("transfer between non-blacklisted users succeeds", async () => {
    // Alice transfers 50 tokens to Bob with hook
    const transferIx = createTransferCheckedInstruction(
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(50_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection,
      transferIx,
      hookProgram.programId,
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(50_000_000),
      "confirmed"
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    await provider.sendAndConfirm(tx, [alice]);

    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAccount.amount)).to.equal(150_000_000);

    const bobAccount = await getAccount(connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(bobAccount.amount)).to.equal(50_000_000);
  });

  it("blacklisted sender cannot transfer", async () => {
    // Blacklist Alice
    const [aliceBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .addToBlacklist(alice.publicKey, "Suspicious activity", Array(32).fill(0), "")
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRolePda,
        blacklistEntry: aliceBlacklistEntry,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Try to transfer from blacklisted Alice to Bob — should fail
    const transferIx = createTransferCheckedInstruction(
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(10_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection,
      transferIx,
      hookProgram.programId,
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(10_000_000),
      "confirmed"
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    try {
      await provider.sendAndConfirm(tx, [alice]);
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as Error).toString()).to.include("Blacklisted");
    }
  });

  it("blacklisted receiver cannot receive transfers", async () => {
    // Unblacklist Alice first
    const [aliceBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .removeFromBlacklist(alice.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRolePda,
        blacklistEntry: aliceBlacklistEntry,
      })
      .rpc({ commitment: "confirmed" });

    // Blacklist Bob
    const [bobBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), bob.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .addToBlacklist(bob.publicKey, "Under investigation", Array(32).fill(0), "")
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRolePda,
        blacklistEntry: bobBlacklistEntry,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Try to transfer from Alice to blacklisted Bob — should fail
    const transferIx = createTransferCheckedInstruction(
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(10_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection,
      transferIx,
      hookProgram.programId,
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(10_000_000),
      "confirmed"
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    try {
      await provider.sendAndConfirm(tx, [alice]);
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as Error).toString()).to.include("Blacklisted");
    }
  });

  it("un-blacklisted user can transfer again", async () => {
    // Remove Bob from blacklist
    const [bobBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), bob.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .removeFromBlacklist(bob.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRolePda,
        blacklistEntry: bobBlacklistEntry,
      })
      .rpc({ commitment: "confirmed" });

    // Verify blacklist entry is closed
    const info = await connection.getAccountInfo(bobBlacklistEntry);
    expect(info).to.be.null;

    // Transfer from Alice to Bob should now succeed
    const transferIx = createTransferCheckedInstruction(
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(20_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection,
      transferIx,
      hookProgram.programId,
      aliceAta,
      mintKey,
      bobAta,
      alice.publicKey,
      BigInt(20_000_000),
      "confirmed"
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    await provider.sendAndConfirm(tx, [alice]);

    const aliceAccount = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(aliceAccount.amount)).to.equal(130_000_000); // 150M - 20M

    const bobAccount = await getAccount(connection, bobAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(bobAccount.amount)).to.equal(70_000_000); // 50M + 20M
  });

  it("seize tokens from blacklisted account", async () => {
    // Blacklist Alice
    const [aliceBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .addToBlacklist(alice.publicKey, "Sanctions compliance", Array(32).fill(0), "")
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRolePda,
        blacklistEntry: aliceBlacklistEntry,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Capture balances before seize
    const aliceBefore = await getAccount(connection, aliceAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const authorityBefore = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const seizeAmount = Number(aliceBefore.amount); // Seize all of Alice's tokens

    // Build dummy transfer_checked instruction for hook account resolution.
    // The config PDA is the permanent delegate.
    const dummyIx = createTransferCheckedInstruction(
      aliceAta,
      mintKey,
      authorityAta,
      configPda, // permanent delegate is the config PDA
      BigInt(seizeAmount),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection,
      dummyIx,
      hookProgram.programId,
      aliceAta,
      mintKey,
      authorityAta,
      configPda,
      BigInt(seizeAmount),
      "confirmed"
    );

    // Extract the extra accounts from the resolved instruction (after the 4 base accounts)
    const extraKeys = dummyIx.keys.slice(4);

    await program.methods
      .seize(new anchor.BN(seizeAmount))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: seizerRolePda,
        blacklistedOwner: alice.publicKey,
        blacklistEntry: aliceBlacklistEntry,
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
    expect(Number(authorityAfter.amount)).to.equal(
      Number(authorityBefore.amount) + seizeAmount
    );
  });
});
