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
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const MINTER_QUOTA_SEED = Buffer.from("minter_quota");

const ROLE_MINTER = 0;
const ROLE_BURNER = 1;
const ROLE_PAUSER = 2;

describe("SSS-1: Minimal Stablecoin Lifecycle", () => {
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

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;
  let configBump: number;

  // Role PDAs
  let minterRolePda: PublicKey;
  let burnerRolePda: PublicKey;
  let pauserRolePda: PublicKey;
  let minterQuotaPda: PublicKey;

  // Token accounts
  let authorityAta: PublicKey;

  before(async () => {
    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

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
    [minterQuotaPda] = PublicKey.findProgramAddressSync(
      [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );

    authorityAta = getAssociatedTokenAddressSync(
      mintKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
  });

  describe("Initialize", () => {
    it("creates an SSS-1 stablecoin", async () => {
      const initParams = {
        name: "Test USD",
        symbol: "tUSD",
        uri: "https://test.com/meta.json",
        decimals: 6,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        defaultAccountFrozen: false,
        enableConfidentialTransfer: false,
        transferHookProgramId: null,
        supplyCap: new anchor.BN(0),
      };

      await program.methods
        .initialize(initParams)
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

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.name).to.equal("Test USD");
      expect(config.symbol).to.equal("tUSD");
      expect(config.decimals).to.equal(6);
      expect(config.paused).to.equal(false);
      expect(config.enablePermanentDelegate).to.equal(false);
      expect(config.enableTransferHook).to.equal(false);
      expect(config.masterAuthority.toBase58()).to.equal(authority.publicKey.toBase58());
    });
  });

  describe("Roles", () => {
    it("assigns Minter role", async () => {
      await program.methods
        .assignRole(ROLE_MINTER, authority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: minterRolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const role = await program.account.roleAccount.fetch(minterRolePda);
      expect(role.roleType).to.equal(ROLE_MINTER);
      expect(role.active).to.equal(true);
    });

    it("assigns Burner role", async () => {
      await program.methods
        .assignRole(ROLE_BURNER, authority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: burnerRolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const role = await program.account.roleAccount.fetch(burnerRolePda);
      expect(role.active).to.equal(true);
    });

    it("assigns Pauser role", async () => {
      await program.methods
        .assignRole(ROLE_PAUSER, authority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: pauserRolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("sets minter quota", async () => {
      await program.methods
        .updateMinter(authority.publicKey, new anchor.BN(1_000_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: minterQuotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const quota = await program.account.minterQuota.fetch(minterQuotaPda);
      expect(quota.quota.toNumber()).to.equal(1_000_000_000);
      expect(quota.minted.toNumber()).to.equal(0);
    });
  });

  describe("Mint", () => {
    before(async () => {
      // Create ATA for authority
      const tx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          authorityAta,
          authority.publicKey,
          mintKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(tx);
    });

    it("mints tokens to recipient", async () => {
      const mintAmount = new anchor.BN(100_000_000); // 100 tokens

      await program.methods
        .mintTokens(mintAmount)
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

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(100_000_000);

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.totalMinted.toNumber()).to.equal(100_000_000);

      const quota = await program.account.minterQuota.fetch(minterQuotaPda);
      expect(quota.minted.toNumber()).to.equal(100_000_000);
    });
  });

  describe("Freeze / Thaw", () => {
    it("freezes a token account", async () => {
      await program.methods
        .freezeTokenAccount()
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: pauserRolePda,
          mint: mintKey,
          tokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.isFrozen).to.equal(true);
    });

    it("thaws a frozen token account", async () => {
      await program.methods
        .thawTokenAccount()
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: pauserRolePda,
          mint: mintKey,
          tokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.isFrozen).to.equal(false);
    });
  });

  describe("Pause / Unpause", () => {
    it("pauses the stablecoin", async () => {
      await program.methods
        .pause()
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: pauserRolePda,
        })
        .rpc();

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.paused).to.equal(true);
    });

    it("blocks minting when paused", async () => {
      try {
        await program.methods
          .mintTokens(new anchor.BN(1_000_000))
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
        expect(err.toString()).to.include("Paused");
      }
    });

    it("unpauses the stablecoin", async () => {
      await program.methods
        .unpause()
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: pauserRolePda,
        })
        .rpc();

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.paused).to.equal(false);
    });
  });

  describe("Burn", () => {
    it("burns tokens", async () => {
      const burnAmount = new anchor.BN(50_000_000); // 50 tokens

      await program.methods
        .burnTokens(burnAmount)
        .accountsStrict({
          burner: authority.publicKey,
          config: configPda,
          roleAccount: burnerRolePda,
          mint: mintKey,
          fromTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(50_000_000);

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.totalBurned.toNumber()).to.equal(50_000_000);
    });
  });

  describe("Quota Enforcement", () => {
    it("rejects minting over quota", async () => {
      // quota = 1_000_000_000, already minted = 100_000_000 → remaining = 900_000_000
      // Attempt to mint 901_000_000 (1M over remaining quota)
      try {
        await program.methods
          .mintTokens(new anchor.BN(901_000_000))
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
        expect.fail("Should have thrown QuotaExceeded");
      } catch (err: any) {
        expect(err.toString()).to.include("QuotaExceeded");
      }
    });
  });

  describe("Role Removal", () => {
    it("deactivates a role", async () => {
      const testUser = Keypair.generate();
      const [testUserMinterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_MINTER]), testUser.publicKey.toBuffer()],
        program.programId
      );

      // Assign the role
      await program.methods
        .assignRole(ROLE_MINTER, testUser.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: testUserMinterRole,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      let role = await program.account.roleAccount.fetch(testUserMinterRole);
      expect(role.active).to.equal(true);

      // Deactivate the role
      await program.methods
        .updateRole(ROLE_MINTER, testUser.publicKey, false)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: testUserMinterRole,
        })
        .rpc({ commitment: "confirmed" });

      role = await program.account.roleAccount.fetch(testUserMinterRole);
      expect(role.active).to.equal(false);
    });

    it("deactivated minter cannot mint", async () => {
      const testUser = Keypair.generate();
      const [testUserMinterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_MINTER]), testUser.publicKey.toBuffer()],
        program.programId
      );
      const [testUserQuotaPda] = PublicKey.findProgramAddressSync(
        [MINTER_QUOTA_SEED, configPda.toBuffer(), testUser.publicKey.toBuffer()],
        program.programId
      );

      // Fund test user so they can sign
      const fundTx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: testUser.publicKey,
          lamports: 100_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      // Assign role + quota
      await program.methods
        .assignRole(ROLE_MINTER, testUser.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: testUserMinterRole,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      await program.methods
        .updateMinter(testUser.publicKey, new anchor.BN(500_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: testUserQuotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      // Deactivate role
      await program.methods
        .updateRole(ROLE_MINTER, testUser.publicKey, false)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: testUserMinterRole,
        })
        .rpc({ commitment: "confirmed" });

      // Try to mint with deactivated role — should fail
      try {
        await program.methods
          .mintTokens(new anchor.BN(1_000_000))
          .accountsStrict({
            minter: testUser.publicKey,
            config: configPda,
            roleAccount: testUserMinterRole,
            minterQuota: testUserQuotaPda,
            mint: mintKey,
            recipientTokenAccount: authorityAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([testUser])
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown Unauthorized");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });

  describe("Transfer Authority", () => {
    it("transfers master authority", async () => {
      const newAuthority = Keypair.generate();

      await program.methods
        .transferAuthority(newAuthority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc();

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

      // Transfer back for further tests
      // Fund new authority
      const tx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: newAuthority.publicKey,
          lamports: 100_000_000,
        })
      );
      await provider.sendAndConfirm(tx);

      await program.methods
        .transferAuthority(authority.publicKey)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
        })
        .signers([newAuthority])
        .rpc();
    });
  });
});
