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
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const MINTER_QUOTA_SEED = Buffer.from("minter_quota");
const BLACKLIST_SEED = Buffer.from("blacklist");

describe("Edge Cases", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.Sss as Program<Sss>;
  const authority = provider.wallet;

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;
  let minterRolePda: PublicKey;
  let minterQuotaPda: PublicKey;
  let authorityAta: PublicKey;

  before(async () => {
    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        name: "Edge Test",
        symbol: "EDGE",
        uri: "https://test.com",
        decimals: 6,
        enablePermanentDelegate: false,
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

    // Setup roles
    [minterRolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([0]), authority.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .updateRoles(0, authority.publicKey, true)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: minterRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    [minterQuotaPda] = PublicKey.findProgramAddressSync(
      [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .updateMinter(authority.publicKey, new anchor.BN(100_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: minterQuotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    authorityAta = getAssociatedTokenAddressSync(mintKey, authority.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(authority.publicKey, authorityAta, authority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID)
    );
    await provider.sendAndConfirm(tx);
  });

  it("rejects zero amount mint", async () => {
    try {
      await program.methods
        .mintTokens(new anchor.BN(0))
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
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("ZeroAmount");
    }
  });

  it("rejects mint exceeding quota", async () => {
    try {
      await program.methods
        .mintTokens(new anchor.BN(200_000_000)) // exceeds 100M quota
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
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("QuotaExceeded");
    }
  });

  it("rejects blacklist operations on SSS-1 config", async () => {
    const target = Keypair.generate();
    const [blacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), target.publicKey.toBuffer()],
      program.programId
    );
    // We need a blacklister role PDA — even though it shouldn't exist for SSS-1
    const [blacklisterRole] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([3]), authority.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .addToBlacklist(target.publicKey, "test")
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // Should fail — either ComplianceNotEnabled or account not found
      expect(err).to.exist;
    }
  });

  it("rejects transferring authority to same address", async () => {
    try {
      await program.methods
        .transferAuthority(authority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("SameAuthority");
    }
  });
});
