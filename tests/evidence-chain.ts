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
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "crypto";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const BLACKLIST_SEED = Buffer.from("blacklist");

const ROLE_BLACKLISTER = 3;

describe("Evidence Chain: On-chain blacklist evidence", () => {
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

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;

  const blacklister = Keypair.generate();

  // Simulate a SHA-256 hash of a court order document
  const courtOrderDoc = Buffer.from("FBI Case #2024-1847 — Court Order for asset freeze, signed Judge Smith");
  const evidenceHash = Array.from(createHash("sha256").update(courtOrderDoc).digest());
  const evidenceUri = "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

  before(async () => {
    // Fund blacklister
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: blacklister.publicKey,
        lamports: 2_000_000_000,
      })
    );
    await provider.sendAndConfirm(fundTx);

    // Initialize SSS-2
    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        name: "Evidence Test",
        symbol: "EVID",
        uri: "",
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

    // Assign blacklister role
    const [blacklisterRole] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .assignRole(ROLE_BLACKLISTER, blacklister.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRole,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
  });

  // ---------------------------------------------------------------------------
  // Happy paths
  // ---------------------------------------------------------------------------

  describe("Happy path", () => {
    it("blacklists with evidence hash and URI stored on-chain", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      await program.methods
        .addToBlacklist(target, "OFAC SDN Match", evidenceHash, evidenceUri)
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      const entry = await program.account.blacklistEntry.fetch(blacklistEntry);
      expect(entry.reason).to.equal("OFAC SDN Match");
      expect(entry.evidenceHash).to.deep.equal(evidenceHash);
      expect(entry.evidenceUri).to.equal(evidenceUri);
      expect(entry.address.toBase58()).to.equal(target.toBase58());
      expect(entry.blacklistedBy.toBase58()).to.equal(blacklister.publicKey.toBase58());
    });

    it("blacklists without evidence (backward compatible)", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      await program.methods
        .addToBlacklist(target, "no evidence needed", Array(32).fill(0), "")
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      const entry = await program.account.blacklistEntry.fetch(blacklistEntry);
      expect(entry.evidenceHash).to.deep.equal(Array(32).fill(0));
      expect(entry.evidenceUri).to.equal("");
    });

    it("updates evidence on an existing blacklist entry", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      // First: blacklist without evidence
      await program.methods
        .addToBlacklist(target, "pending evidence", Array(32).fill(0), "")
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      // Verify no evidence
      let entry = await program.account.blacklistEntry.fetch(blacklistEntry);
      expect(entry.evidenceHash).to.deep.equal(Array(32).fill(0));

      // Now attach evidence via update_blacklist_evidence
      await program.methods
        .updateBlacklistEvidence(target, evidenceHash, evidenceUri)
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      entry = await program.account.blacklistEntry.fetch(blacklistEntry);
      expect(entry.evidenceHash).to.deep.equal(evidenceHash);
      expect(entry.evidenceUri).to.equal(evidenceUri);
      // Original fields preserved
      expect(entry.reason).to.equal("pending evidence");
      expect(entry.blacklistedBy.toBase58()).to.equal(blacklister.publicKey.toBase58());
    });

    it("overwrites evidence with a new document hash", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      // Blacklist with first evidence
      await program.methods
        .addToBlacklist(target, "fraud case", evidenceHash, "ipfs://QmFirst")
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      // Overwrite with second evidence (e.g., updated court order)
      const newDoc = Buffer.from("Updated court order with additional charges");
      const newHash = Array.from(createHash("sha256").update(newDoc).digest());

      await program.methods
        .updateBlacklistEvidence(target, newHash, "ar://UpdatedCourtOrder")
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      const entry = await program.account.blacklistEntry.fetch(blacklistEntry);
      expect(entry.evidenceHash).to.deep.equal(newHash);
      expect(entry.evidenceUri).to.equal("ar://UpdatedCourtOrder");
    });

    it("verifies evidence hash matches document off-chain", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      await program.methods
        .addToBlacklist(target, "verifiable evidence", evidenceHash, evidenceUri)
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      // Fetch on-chain and verify against the original document
      const entry = await program.account.blacklistEntry.fetch(blacklistEntry);
      const recomputedHash = Array.from(createHash("sha256").update(courtOrderDoc).digest());
      expect(entry.evidenceHash).to.deep.equal(recomputedHash);

      // Tampered document should NOT match
      const tamperedDoc = Buffer.from("TAMPERED court order");
      const tamperedHash = Array.from(createHash("sha256").update(tamperedDoc).digest());
      expect(entry.evidenceHash).to.not.deep.equal(tamperedHash);
    });
  });

  // ---------------------------------------------------------------------------
  // Sad paths
  // ---------------------------------------------------------------------------

  describe("Sad path", () => {
    it("rejects update_evidence with zero hash", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      await program.methods
        .addToBlacklist(target, "test", Array(32).fill(0), "")
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      try {
        await program.methods
          .updateBlacklistEvidence(target, Array(32).fill(0), "ipfs://QmSomething")
          .accountsStrict({
            authority: blacklister.publicKey,
            config: configPda,
            roleAccount: blacklisterRole,
            blacklistEntry,
            systemProgram: SystemProgram.programId,
          })
          .signers([blacklister])
          .rpc({ commitment: "confirmed" });
        expect.fail("should have thrown — zero hash");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidEvidenceHash");
      }
    });

    it("rejects evidence URI exceeding 128 bytes", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      await program.methods
        .addToBlacklist(target, "test", Array(32).fill(0), "")
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      const longUri = "x".repeat(129);
      try {
        await program.methods
          .updateBlacklistEvidence(target, evidenceHash, longUri)
          .accountsStrict({
            authority: blacklister.publicKey,
            config: configPda,
            roleAccount: blacklisterRole,
            blacklistEntry,
            systemProgram: SystemProgram.programId,
          })
          .signers([blacklister])
          .rpc({ commitment: "confirmed" });
        expect.fail("should have thrown — URI too long");
      } catch (err: any) {
        expect(err.toString()).to.include("EvidenceUriTooLong");
      }
    });

    it("rejects non-blacklister from updating evidence", async () => {
      const impostor = Keypair.generate();
      const fundTx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: impostor.publicKey,
          lamports: 1_000_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      // Blacklist legitimately
      await program.methods
        .addToBlacklist(target, "legit", Array(32).fill(0), "")
        .accountsStrict({
          authority: blacklister.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([blacklister])
        .rpc({ commitment: "confirmed" });

      // Impostor tries to attach evidence
      const [impostorRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), impostor.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .updateBlacklistEvidence(target, evidenceHash, "ipfs://QmEvil")
          .accountsStrict({
            authority: impostor.publicKey,
            config: configPda,
            roleAccount: impostorRole,
            blacklistEntry,
            systemProgram: SystemProgram.programId,
          })
          .signers([impostor])
          .rpc({ commitment: "confirmed" });
        expect.fail("should have thrown — unauthorized");
      } catch (err: any) {
        expect(err.toString()).to.include("AccountNotInitialized");
      }
    });

    it("rejects updating evidence on nonexistent blacklist entry", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .updateBlacklistEvidence(target, evidenceHash, evidenceUri)
          .accountsStrict({
            authority: blacklister.publicKey,
            config: configPda,
            roleAccount: blacklisterRole,
            blacklistEntry,
            systemProgram: SystemProgram.programId,
          })
          .signers([blacklister])
          .rpc({ commitment: "confirmed" });
        expect.fail("should have thrown — entry doesn't exist");
      } catch (err: any) {
        // Account doesn't exist, so Anchor can't deserialize it
        expect(err).to.exist;
      }
    });

    it("rejects add_to_blacklist with URI exceeding 128 bytes", async () => {
      const target = Keypair.generate().publicKey;
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), blacklister.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), target.toBuffer()],
        program.programId
      );

      const longUri = "y".repeat(129);
      try {
        await program.methods
          .addToBlacklist(target, "test", evidenceHash, longUri)
          .accountsStrict({
            authority: blacklister.publicKey,
            config: configPda,
            roleAccount: blacklisterRole,
            blacklistEntry,
            systemProgram: SystemProgram.programId,
          })
          .signers([blacklister])
          .rpc({ commitment: "confirmed" });
        expect.fail("should have thrown — URI too long on add");
      } catch (err: any) {
        expect(err.toString()).to.include("EvidenceUriTooLong");
      }
    });
  });
});
