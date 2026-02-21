import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sss } from "../target/types/sss";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const MINTER_QUOTA_SEED = Buffer.from("minter_quota");

describe("Seize", () => {
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

  const victim = Keypair.generate();
  const treasury = Keypair.generate();

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;
  let victimAta: PublicKey;
  let treasuryAta: PublicKey;

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

    // Init SSS-2
    await program.methods
      .initialize({
        name: "Seize Test",
        symbol: "SZE",
        uri: "https://test.com",
        decimals: 6,
        enablePermanentDelegate: true,
        enableTransferHook: false,
        defaultAccountFrozen: false,
        transferHookProgramId: null,
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

    // Setup minter + seizer roles
    for (const [roleType] of [[0], [4]]) {
      const [rolePda] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([roleType]), authority.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .updateRoles(roleType, authority.publicKey, true)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Set quota
    const [quotaPda] = PublicKey.findProgramAddressSync(
      [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .updateMinter(authority.publicKey, new anchor.BN(1_000_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: quotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

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
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([0]), authority.publicKey.toBuffer()],
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
      .rpc();
  });

  it("seizes tokens to treasury", async () => {
    const [seizerRole] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([4]), authority.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .seize(new anchor.BN(100_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: seizerRole,
        mint: mintKey,
        fromTokenAccount: victimAta,
        toTokenAccount: treasuryAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const victimAccount = await getAccount(connection, victimAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(victimAccount.amount)).to.equal(100_000_000);

    const treasuryAccount = await getAccount(connection, treasuryAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(treasuryAccount.amount)).to.equal(100_000_000);
  });

  it("rejects zero amount seize", async () => {
    const [seizerRole] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([4]), authority.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .seize(new anchor.BN(0))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: seizerRole,
          mint: mintKey,
          fromTokenAccount: victimAta,
          toTokenAccount: treasuryAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });
});
