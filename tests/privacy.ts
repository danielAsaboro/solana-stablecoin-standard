import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SssPrivacy } from "../target/types/sss_privacy";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

const PRIVACY_CONFIG_SEED = Buffer.from("privacy_config");
const ALLOWLIST_SEED = Buffer.from("allowlist");

describe("Privacy Module", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.SssPrivacy as Program<SssPrivacy>;
  const authority = provider.wallet;

  // Use a fake stablecoin config (unchecked account in privacy program)
  const fakeStablecoinConfig = Keypair.generate();

  let privacyConfigPda: PublicKey;
  const allowlistedAddress = Keypair.generate();
  let allowlistEntryPda: PublicKey;

  before(async () => {
    [privacyConfigPda] = PublicKey.findProgramAddressSync(
      [PRIVACY_CONFIG_SEED, fakeStablecoinConfig.publicKey.toBuffer()],
      program.programId
    );
    [allowlistEntryPda] = PublicKey.findProgramAddressSync(
      [ALLOWLIST_SEED, privacyConfigPda.toBuffer(), allowlistedAddress.publicKey.toBuffer()],
      program.programId
    );
  });

  describe("Initialize Privacy", () => {
    it("initializes privacy config with auto_approve = false", async () => {
      await program.methods
        .initializePrivacy({ autoApprove: false })
        .accountsStrict({
          authority: authority.publicKey,
          privacyConfig: privacyConfigPda,
          stablecoinConfig: fakeStablecoinConfig.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.privacyConfig.fetch(privacyConfigPda);
      expect(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(config.stablecoinConfig.toBase58()).to.equal(fakeStablecoinConfig.publicKey.toBase58());
      expect(config.autoApprove).to.equal(false);
      expect(config.allowlistCount).to.equal(0);
    });
  });

  describe("Add to Allowlist", () => {
    it("adds an address to the allowlist", async () => {
      await program.methods
        .addToAllowlist({ label: "Treasury" })
        .accountsStrict({
          authority: authority.publicKey,
          privacyConfig: privacyConfigPda,
          allowlistEntry: allowlistEntryPda,
          address: allowlistedAddress.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const entry = await program.account.allowlistEntry.fetch(allowlistEntryPda);
      expect(entry.config.toBase58()).to.equal(privacyConfigPda.toBase58());
      expect(entry.address.toBase58()).to.equal(allowlistedAddress.publicKey.toBase58());
      expect(entry.label).to.equal("Treasury");
      expect(entry.addedBy.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(entry.addedAt.toNumber()).to.be.greaterThan(0);

      const config = await program.account.privacyConfig.fetch(privacyConfigPda);
      expect(config.allowlistCount).to.equal(1);
    });

    it("adds a second address to the allowlist", async () => {
      const secondAddress = Keypair.generate();
      const [secondEntryPda] = PublicKey.findProgramAddressSync(
        [ALLOWLIST_SEED, privacyConfigPda.toBuffer(), secondAddress.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .addToAllowlist({ label: "Market Maker A" })
        .accountsStrict({
          authority: authority.publicKey,
          privacyConfig: privacyConfigPda,
          allowlistEntry: secondEntryPda,
          address: secondAddress.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.privacyConfig.fetch(privacyConfigPda);
      expect(config.allowlistCount).to.equal(2);

      const entry = await program.account.allowlistEntry.fetch(secondEntryPda);
      expect(entry.label).to.equal("Market Maker A");
    });

    it("rejects label exceeding max length", async () => {
      const badAddress = Keypair.generate();
      const [badEntryPda] = PublicKey.findProgramAddressSync(
        [ALLOWLIST_SEED, privacyConfigPda.toBuffer(), badAddress.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .addToAllowlist({ label: "A".repeat(33) }) // > 32 bytes
          .accountsStrict({
            authority: authority.publicKey,
            privacyConfig: privacyConfigPda,
            allowlistEntry: badEntryPda,
            address: badAddress.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("LabelTooLong");
      }
    });

    it("rejects unauthorized caller", async () => {
      const unauthorized = Keypair.generate();
      const fundTx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: unauthorized.publicKey,
          lamports: 100_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      const badAddress = Keypair.generate();
      const [badEntryPda] = PublicKey.findProgramAddressSync(
        [ALLOWLIST_SEED, privacyConfigPda.toBuffer(), badAddress.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .addToAllowlist({ label: "Hacker" })
          .accountsStrict({
            authority: unauthorized.publicKey,
            privacyConfig: privacyConfigPda,
            allowlistEntry: badEntryPda,
            address: badAddress.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorized])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });

  describe("Update Privacy Config", () => {
    it("enables auto_approve", async () => {
      await program.methods
        .updatePrivacyConfig({ autoApprove: true })
        .accountsStrict({
          authority: authority.publicKey,
          privacyConfig: privacyConfigPda,
        })
        .rpc();

      const config = await program.account.privacyConfig.fetch(privacyConfigPda);
      expect(config.autoApprove).to.equal(true);
    });

    it("disables auto_approve", async () => {
      await program.methods
        .updatePrivacyConfig({ autoApprove: false })
        .accountsStrict({
          authority: authority.publicKey,
          privacyConfig: privacyConfigPda,
        })
        .rpc();

      const config = await program.account.privacyConfig.fetch(privacyConfigPda);
      expect(config.autoApprove).to.equal(false);
    });

    it("no-op update (null) preserves existing values", async () => {
      await program.methods
        .updatePrivacyConfig({ autoApprove: null })
        .accountsStrict({
          authority: authority.publicKey,
          privacyConfig: privacyConfigPda,
        })
        .rpc();

      const config = await program.account.privacyConfig.fetch(privacyConfigPda);
      expect(config.autoApprove).to.equal(false);
    });

    it("rejects unauthorized config update", async () => {
      const unauthorized = Keypair.generate();
      const fundTx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: unauthorized.publicKey,
          lamports: 100_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      try {
        await program.methods
          .updatePrivacyConfig({ autoApprove: true })
          .accountsStrict({
            authority: unauthorized.publicKey,
            privacyConfig: privacyConfigPda,
          })
          .signers([unauthorized])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });

  describe("Remove from Allowlist", () => {
    it("removes an address from the allowlist", async () => {
      await program.methods
        .removeFromAllowlist()
        .accountsStrict({
          authority: authority.publicKey,
          privacyConfig: privacyConfigPda,
          allowlistEntry: allowlistEntryPda,
        })
        .rpc();

      // Entry account should be closed
      const entryInfo = await provider.connection.getAccountInfo(allowlistEntryPda);
      expect(entryInfo).to.be.null;

      // Count should decrease
      const config = await program.account.privacyConfig.fetch(privacyConfigPda);
      expect(config.allowlistCount).to.equal(1); // was 2 (added 2), now 1
    });

    it("rejects removing non-existent entry", async () => {
      const nonExistent = Keypair.generate();
      const [nonExistentPda] = PublicKey.findProgramAddressSync(
        [ALLOWLIST_SEED, privacyConfigPda.toBuffer(), nonExistent.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .removeFromAllowlist()
          .accountsStrict({
            authority: authority.publicKey,
            privacyConfig: privacyConfigPda,
            allowlistEntry: nonExistentPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Account doesn't exist — Anchor should reject
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("AccountNotInitialized") || s.includes("does not exist")
        );
      }
    });
  });

  describe("Multiple Privacy Configs", () => {
    it("creates separate privacy configs for different stablecoins", async () => {
      const secondStablecoin = Keypair.generate();
      const [secondPda] = PublicKey.findProgramAddressSync(
        [PRIVACY_CONFIG_SEED, secondStablecoin.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .initializePrivacy({ autoApprove: true })
        .accountsStrict({
          authority: authority.publicKey,
          privacyConfig: secondPda,
          stablecoinConfig: secondStablecoin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.privacyConfig.fetch(secondPda);
      expect(config.autoApprove).to.equal(true);
      expect(config.allowlistCount).to.equal(0);

      // Original config should be unchanged
      const original = await program.account.privacyConfig.fetch(privacyConfigPda);
      expect(original.autoApprove).to.equal(false);
      expect(original.allowlistCount).to.equal(1);
    });
  });
});
