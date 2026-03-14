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
  createTransferCheckedInstruction,
  addExtraAccountMetasForExecute,
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

// ── Helper: fund a keypair with SOL ─────────────────────────────────────────

async function fundAccount(
  provider: anchor.AnchorProvider,
  target: PublicKey,
  lamports: number
): Promise<void> {
  const tx = new anchor.web3.Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: target,
      lamports,
    })
  );
  await provider.sendAndConfirm(tx);
}

// ── Helper: derive role PDA ─────────────────────────────────────────────────

function deriveRolePda(
  configPda: PublicKey,
  roleType: number,
  user: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [ROLE_SEED, configPda.toBuffer(), Buffer.from([roleType]), user.toBuffer()],
    programId
  );
  return pda;
}

// ── Helper: derive minter quota PDA ─────────────────────────────────────────

function deriveMinterQuotaPda(
  configPda: PublicKey,
  minter: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [MINTER_QUOTA_SEED, configPda.toBuffer(), minter.toBuffer()],
    programId
  );
  return pda;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSS-1 Authority Rotation Lifecycle
//
// Tests the full lifecycle of transferring master authority to a new keypair,
// verifying the security model:
//   - Master authority controls: update_roles, update_minter, transfer_authority
//   - Role-based operations: mint, burn, freeze, thaw, pause, unpause
//   - Roles persist after authority transfer until explicitly revoked
//   - Chain transfer: A → B → C → A proves the mechanism is repeatable
// ═══════════════════════════════════════════════════════════════════════════════

describe("Authority Rotation: SSS-1 Lifecycle", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.Sss as Program<Sss>;
  const originalAuthority = provider.wallet;
  const connection = provider.connection;

  const newAuthority = Keypair.generate();
  const thirdAuthority = Keypair.generate();

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;
  let originalMinterRolePda: PublicKey;
  let originalBurnerRolePda: PublicKey;
  let originalPauserRolePda: PublicKey;
  let originalMinterQuotaPda: PublicKey;
  let authorityAta: PublicKey;

  before(async () => {
    await fundAccount(provider, newAuthority.publicKey, 2_000_000_000);
    await fundAccount(provider, thirdAuthority.publicKey, 2_000_000_000);

    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    originalMinterRolePda = deriveRolePda(configPda, ROLE_MINTER, originalAuthority.publicKey, program.programId);
    originalBurnerRolePda = deriveRolePda(configPda, ROLE_BURNER, originalAuthority.publicKey, program.programId);
    originalPauserRolePda = deriveRolePda(configPda, ROLE_PAUSER, originalAuthority.publicKey, program.programId);
    originalMinterQuotaPda = deriveMinterQuotaPda(configPda, originalAuthority.publicKey, program.programId);

    // Initialize SSS-1 stablecoin
    await program.methods
      .initialize({
        name: "Auth Rotation Test",
        symbol: "ART",
        uri: "https://test.com",
        decimals: 6,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        defaultAccountFrozen: false,
        enableConfidentialTransfer: false,
        transferHookProgramId: null,
      })
      .accountsStrict({
        authority: originalAuthority.publicKey,
        config: configPda,
        mint: mintKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    // Assign all 3 SSS-1 roles to original authority
    for (const roleType of [ROLE_MINTER, ROLE_BURNER, ROLE_PAUSER]) {
      const rolePda = deriveRolePda(configPda, roleType, originalAuthority.publicKey, program.programId);
      await program.methods
        .updateRoles(roleType, originalAuthority.publicKey, true)
        .accountsStrict({
          authority: originalAuthority.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Set minter quota
    await program.methods
      .updateMinter(originalAuthority.publicKey, new anchor.BN(1_000_000_000))
      .accountsStrict({
        authority: originalAuthority.publicKey,
        config: configPda,
        minterQuota: originalMinterQuotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Create ATA and mint initial tokens
    authorityAta = getAssociatedTokenAddressSync(mintKey, originalAuthority.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        originalAuthority.publicKey, authorityAta, originalAuthority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createAtaTx);

    await program.methods
      .mintTokens(new anchor.BN(100_000_000))
      .accountsStrict({
        minter: originalAuthority.publicKey,
        config: configPda,
        roleAccount: originalMinterRolePda,
        minterQuota: originalMinterQuotaPda,
        mint: mintKey,
        recipientTokenAccount: authorityAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });
  });

  // ── Stage 1: Transfer authority ───────────────────────────────────────────

  describe("Stage 1: Transfer authority from original to new", () => {
    it("transfers master authority successfully", async () => {
      await program.methods
        .transferAuthority(newAuthority.publicKey)
        .accountsStrict({
          authority: originalAuthority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());
    });

    it("preserves all other config fields after transfer", async () => {
      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.name).to.equal("Auth Rotation Test");
      expect(config.symbol).to.equal("ART");
      expect(config.decimals).to.equal(6);
      expect(config.paused).to.equal(false);
      expect(config.mint.toBase58()).to.equal(mintKey.toBase58());
      expect(config.totalMinted.toNumber()).to.equal(100_000_000);
    });
  });

  // ── Stage 2: Old authority blocked from admin operations ──────────────────

  describe("Stage 2: Old authority loses admin (master-authority) privileges", () => {
    it("old authority cannot update roles", async () => {
      const dummyUser = Keypair.generate();
      const dummyRolePda = deriveRolePda(configPda, ROLE_MINTER, dummyUser.publicKey, program.programId);
      try {
        await program.methods
          .updateRoles(ROLE_MINTER, dummyUser.publicKey, true)
          .accountsStrict({
            authority: originalAuthority.publicKey,
            config: configPda,
            roleAccount: dummyRolePda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown — old authority must be rejected");
      } catch (err: unknown) {
        expect((err as Error).toString()).to.include("InvalidAuthority");
      }
    });

    it("old authority cannot update minter quotas", async () => {
      const dummyMinter = Keypair.generate();
      const dummyQuotaPda = deriveMinterQuotaPda(configPda, dummyMinter.publicKey, program.programId);
      try {
        await program.methods
          .updateMinter(dummyMinter.publicKey, new anchor.BN(500_000))
          .accountsStrict({
            authority: originalAuthority.publicKey,
            config: configPda,
            minterQuota: dummyQuotaPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown — old authority must be rejected");
      } catch (err: unknown) {
        expect((err as Error).toString()).to.include("InvalidAuthority");
      }
    });

    it("old authority cannot transfer authority again", async () => {
      try {
        await program.methods
          .transferAuthority(originalAuthority.publicKey)
          .accountsStrict({
            authority: originalAuthority.publicKey,
            config: configPda,
          })
          .rpc();
        expect.fail("Should have thrown — old authority must be rejected");
      } catch (err: unknown) {
        expect((err as Error).toString()).to.include("InvalidAuthority");
      }
    });
  });

  // ── Stage 3: Roles persist — old authority retains granted roles ──────────

  describe("Stage 3: Old authority retains role-based operations until revoked", () => {
    it("old authority can still mint (minter role persists)", async () => {
      await program.methods
        .mintTokens(new anchor.BN(5_000_000))
        .accountsStrict({
          minter: originalAuthority.publicKey,
          config: configPda,
          roleAccount: originalMinterRolePda,
          minterQuota: originalMinterQuotaPda,
          mint: mintKey,
          recipientTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(105_000_000);
    });

    it("old authority can still burn (burner role persists)", async () => {
      await program.methods
        .burnTokens(new anchor.BN(5_000_000))
        .accountsStrict({
          burner: originalAuthority.publicKey,
          config: configPda,
          roleAccount: originalBurnerRolePda,
          mint: mintKey,
          fromTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(100_000_000);
    });

    it("old authority can still freeze (pauser role persists)", async () => {
      await program.methods
        .freezeTokenAccount()
        .accountsStrict({
          authority: originalAuthority.publicKey,
          config: configPda,
          roleAccount: originalPauserRolePda,
          mint: mintKey,
          tokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.isFrozen).to.equal(true);
    });

    it("old authority can still thaw (pauser role persists)", async () => {
      await program.methods
        .thawTokenAccount()
        .accountsStrict({
          authority: originalAuthority.publicKey,
          config: configPda,
          roleAccount: originalPauserRolePda,
          mint: mintKey,
          tokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.isFrozen).to.equal(false);
    });
  });

  // ── Stage 4: New authority revokes old roles, then they're blocked ────────

  describe("Stage 4: New authority revokes old roles — old authority fully blocked", () => {
    it("new authority revokes old authority's minter role", async () => {
      await program.methods
        .updateRoles(ROLE_MINTER, originalAuthority.publicKey, false)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: originalMinterRolePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const role = await program.account.roleAccount.fetch(originalMinterRolePda);
      expect(role.active).to.equal(false);
    });

    it("new authority revokes old authority's burner role", async () => {
      await program.methods
        .updateRoles(ROLE_BURNER, originalAuthority.publicKey, false)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: originalBurnerRolePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const role = await program.account.roleAccount.fetch(originalBurnerRolePda);
      expect(role.active).to.equal(false);
    });

    it("new authority revokes old authority's pauser role", async () => {
      await program.methods
        .updateRoles(ROLE_PAUSER, originalAuthority.publicKey, false)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: originalPauserRolePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const role = await program.account.roleAccount.fetch(originalPauserRolePda);
      expect(role.active).to.equal(false);
    });

    it("old authority cannot mint after minter role revocation", async () => {
      try {
        await program.methods
          .mintTokens(new anchor.BN(1_000_000))
          .accountsStrict({
            minter: originalAuthority.publicKey,
            config: configPda,
            roleAccount: originalMinterRolePda,
            minterQuota: originalMinterQuotaPda,
            mint: mintKey,
            recipientTokenAccount: authorityAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown — revoked minter cannot mint");
      } catch (err: unknown) {
        expect((err as Error).toString()).to.include("Unauthorized");
      }
    });

    it("old authority cannot burn after burner role revocation", async () => {
      try {
        await program.methods
          .burnTokens(new anchor.BN(1_000_000))
          .accountsStrict({
            burner: originalAuthority.publicKey,
            config: configPda,
            roleAccount: originalBurnerRolePda,
            mint: mintKey,
            fromTokenAccount: authorityAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .rpc();
        expect.fail("Should have thrown — revoked burner cannot burn");
      } catch (err: unknown) {
        expect((err as Error).toString()).to.include("Unauthorized");
      }
    });

    it("old authority cannot pause after pauser role revocation", async () => {
      try {
        await program.methods
          .pause()
          .accountsStrict({
            authority: originalAuthority.publicKey,
            config: configPda,
            roleAccount: originalPauserRolePda,
          })
          .rpc();
        expect.fail("Should have thrown — revoked pauser cannot pause");
      } catch (err: unknown) {
        expect((err as Error).toString()).to.include("Unauthorized");
      }
    });
  });

  // ── Stage 5: New authority exercises full control ─────────────────────────

  describe("Stage 5: New authority exercises full control", () => {
    let newMinterRole: PublicKey;
    let newBurnerRole: PublicKey;
    let newPauserRole: PublicKey;
    let newMinterQuota: PublicKey;
    let newAuthorityAta: PublicKey;

    it("new authority grants itself all roles", async () => {
      for (const roleType of [ROLE_MINTER, ROLE_BURNER, ROLE_PAUSER]) {
        const rolePda = deriveRolePda(configPda, roleType, newAuthority.publicKey, program.programId);
        await program.methods
          .updateRoles(roleType, newAuthority.publicKey, true)
          .accountsStrict({
            authority: newAuthority.publicKey,
            config: configPda,
            roleAccount: rolePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([newAuthority])
          .rpc({ commitment: "confirmed" });
      }

      newMinterRole = deriveRolePda(configPda, ROLE_MINTER, newAuthority.publicKey, program.programId);
      newBurnerRole = deriveRolePda(configPda, ROLE_BURNER, newAuthority.publicKey, program.programId);
      newPauserRole = deriveRolePda(configPda, ROLE_PAUSER, newAuthority.publicKey, program.programId);

      const minterRoleAccount = await program.account.roleAccount.fetch(newMinterRole);
      expect(minterRoleAccount.active).to.equal(true);
    });

    it("new authority sets its own minter quota", async () => {
      newMinterQuota = deriveMinterQuotaPda(configPda, newAuthority.publicKey, program.programId);
      await program.methods
        .updateMinter(newAuthority.publicKey, new anchor.BN(500_000_000))
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          minterQuota: newMinterQuota,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const quota = await program.account.minterQuota.fetch(newMinterQuota);
      expect(quota.quota.toNumber()).to.equal(500_000_000);
    });

    it("new authority can mint tokens", async () => {
      newAuthorityAta = getAssociatedTokenAddressSync(
        mintKey, newAuthority.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          newAuthority.publicKey, newAuthorityAta, newAuthority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(createAtaTx, [newAuthority]);

      await program.methods
        .mintTokens(new anchor.BN(50_000_000))
        .accountsStrict({
          minter: newAuthority.publicKey,
          config: configPda,
          roleAccount: newMinterRole,
          minterQuota: newMinterQuota,
          mint: mintKey,
          recipientTokenAccount: newAuthorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, newAuthorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(50_000_000);
    });

    it("new authority can burn tokens", async () => {
      await program.methods
        .burnTokens(new anchor.BN(10_000_000))
        .accountsStrict({
          burner: newAuthority.publicKey,
          config: configPda,
          roleAccount: newBurnerRole,
          mint: mintKey,
          fromTokenAccount: newAuthorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, newAuthorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(40_000_000);
    });

    it("new authority can freeze and thaw", async () => {
      await program.methods
        .freezeTokenAccount()
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newPauserRole,
          mint: mintKey,
          tokenAccount: newAuthorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      let account = await getAccount(connection, newAuthorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.isFrozen).to.equal(true);

      await program.methods
        .thawTokenAccount()
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newPauserRole,
          mint: mintKey,
          tokenAccount: newAuthorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      account = await getAccount(connection, newAuthorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(account.isFrozen).to.equal(false);
    });

    it("new authority can pause and unpause", async () => {
      await program.methods
        .pause()
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newPauserRole,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      let config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.paused).to.equal(true);

      await program.methods
        .unpause()
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newPauserRole,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.paused).to.equal(false);
    });
  });

  // ── Stage 6: Chain transfer (A → B → C → A) ──────────────────────────────

  describe("Stage 6: Chain transfer to third authority and back", () => {
    it("new authority transfers to third authority", async () => {
      await program.methods
        .transferAuthority(thirdAuthority.publicKey)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(thirdAuthority.publicKey.toBase58());
    });

    it("second authority is now blocked from admin operations", async () => {
      const dummyUser = Keypair.generate();
      const dummyRolePda = deriveRolePda(configPda, ROLE_MINTER, dummyUser.publicKey, program.programId);
      try {
        await program.methods
          .updateRoles(ROLE_MINTER, dummyUser.publicKey, true)
          .accountsStrict({
            authority: newAuthority.publicKey,
            config: configPda,
            roleAccount: dummyRolePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([newAuthority])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as Error).toString()).to.include("InvalidAuthority");
      }
    });

    it("third authority can grant roles and update quotas", async () => {
      const thirdMinterRole = deriveRolePda(configPda, ROLE_MINTER, thirdAuthority.publicKey, program.programId);
      await program.methods
        .updateRoles(ROLE_MINTER, thirdAuthority.publicKey, true)
        .accountsStrict({
          authority: thirdAuthority.publicKey,
          config: configPda,
          roleAccount: thirdMinterRole,
          systemProgram: SystemProgram.programId,
        })
        .signers([thirdAuthority])
        .rpc({ commitment: "confirmed" });

      const role = await program.account.roleAccount.fetch(thirdMinterRole);
      expect(role.active).to.equal(true);

      const thirdQuota = deriveMinterQuotaPda(configPda, thirdAuthority.publicKey, program.programId);
      await program.methods
        .updateMinter(thirdAuthority.publicKey, new anchor.BN(999_000_000))
        .accountsStrict({
          authority: thirdAuthority.publicKey,
          config: configPda,
          minterQuota: thirdQuota,
          systemProgram: SystemProgram.programId,
        })
        .signers([thirdAuthority])
        .rpc({ commitment: "confirmed" });

      const quota = await program.account.minterQuota.fetch(thirdQuota);
      expect(quota.quota.toNumber()).to.equal(999_000_000);
    });

    it("third authority transfers back to original (full A→B→C→A cycle)", async () => {
      await program.methods
        .transferAuthority(originalAuthority.publicKey)
        .accountsStrict({
          authority: thirdAuthority.publicKey,
          config: configPda,
        })
        .signers([thirdAuthority])
        .rpc({ commitment: "confirmed" });

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(originalAuthority.publicKey.toBase58());
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SSS-2 Authority Rotation with Compliance Features
//
// Tests authority rotation on an SSS-2 stablecoin, verifying that the new
// authority can perform all compliance operations (blacklist, seize) and
// that compliance feature flags persist across authority transfers.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Authority Rotation: SSS-2 Compliance", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.Sss as Program<Sss>;
  const hookProgram = anchor.workspace.TransferHook as Program;
  const originalAuthority = provider.wallet;
  const connection = provider.connection;

  const newAuthority = Keypair.generate();
  const targetUser = Keypair.generate();

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;
  let authorityAta: PublicKey;

  before(async () => {
    await fundAccount(provider, newAuthority.publicKey, 2_000_000_000);
    await fundAccount(provider, targetUser.publicKey, 1_000_000_000);

    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    // Initialize SSS-2 stablecoin
    await program.methods
      .initialize({
        name: "Auth Rotation SSS2",
        symbol: "ARS2",
        uri: "https://test.com",
        decimals: 6,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        defaultAccountFrozen: false,
        enableConfidentialTransfer: false,
        transferHookProgramId: hookProgram.programId,
      })
      .accountsStrict({
        authority: originalAuthority.publicKey,
        config: configPda,
        mint: mintKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc({ commitment: "confirmed" });

    // Assign all 5 roles to original authority
    for (const roleType of [ROLE_MINTER, ROLE_BURNER, ROLE_PAUSER, ROLE_BLACKLISTER, ROLE_SEIZER]) {
      const rolePda = deriveRolePda(configPda, roleType, originalAuthority.publicKey, program.programId);
      await program.methods
        .updateRoles(roleType, originalAuthority.publicKey, true)
        .accountsStrict({
          authority: originalAuthority.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    }

    // Set minter quota and mint tokens
    const quotaPda = deriveMinterQuotaPda(configPda, originalAuthority.publicKey, program.programId);
    await program.methods
      .updateMinter(originalAuthority.publicKey, new anchor.BN(1_000_000_000_000))
      .accountsStrict({
        authority: originalAuthority.publicKey,
        config: configPda,
        minterQuota: quotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Initialize transfer hook extra account metas
    const [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), mintKey.toBuffer()],
      hookProgram.programId
    );
    await hookProgram.methods
      .initializeExtraAccountMetas()
      .accountsStrict({
        payer: originalAuthority.publicKey,
        extraAccountMetas: extraAccountMetasPda,
        mint: mintKey,
        sssProgram: program.programId,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Create ATAs and mint tokens
    authorityAta = getAssociatedTokenAddressSync(mintKey, originalAuthority.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        originalAuthority.publicKey, authorityAta, originalAuthority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createAtaTx);

    const minterRole = deriveRolePda(configPda, ROLE_MINTER, originalAuthority.publicKey, program.programId);
    await program.methods
      .mintTokens(new anchor.BN(500_000_000))
      .accountsStrict({
        minter: originalAuthority.publicKey,
        config: configPda,
        roleAccount: minterRole,
        minterQuota: quotaPda,
        mint: mintKey,
        recipientTokenAccount: authorityAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    // Mint tokens to target user for seize test
    const targetAta = getAssociatedTokenAddressSync(mintKey, targetUser.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const createTargetAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        originalAuthority.publicKey, targetAta, targetUser.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createTargetAtaTx);

    await program.methods
      .mintTokens(new anchor.BN(100_000_000))
      .accountsStrict({
        minter: originalAuthority.publicKey,
        config: configPda,
        roleAccount: minterRole,
        minterQuota: quotaPda,
        mint: mintKey,
        recipientTokenAccount: targetAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });
  });

  describe("Transfer authority and verify compliance operations", () => {
    it("transfers authority and preserves compliance feature flags", async () => {
      await program.methods
        .transferAuthority(newAuthority.publicKey)
        .accountsStrict({
          authority: originalAuthority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());
      expect(config.enablePermanentDelegate).to.equal(true);
      expect(config.enableTransferHook).to.equal(true);
    });

    it("new authority can assign blacklister role to itself", async () => {
      const newBlacklisterRole = deriveRolePda(configPda, ROLE_BLACKLISTER, newAuthority.publicKey, program.programId);
      await program.methods
        .updateRoles(ROLE_BLACKLISTER, newAuthority.publicKey, true)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newBlacklisterRole,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const role = await program.account.roleAccount.fetch(newBlacklisterRole);
      expect(role.active).to.equal(true);
      expect(role.roleType).to.equal(ROLE_BLACKLISTER);
    });

    it("new authority can blacklist an address", async () => {
      const newBlacklisterRole = deriveRolePda(configPda, ROLE_BLACKLISTER, newAuthority.publicKey, program.programId);
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), targetUser.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .addToBlacklist(targetUser.publicKey, "Post-rotation blacklist")
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newBlacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const entry = await program.account.blacklistEntry.fetch(blacklistEntry);
      expect(entry.address.toBase58()).to.equal(targetUser.publicKey.toBase58());
      expect(entry.reason).to.equal("Post-rotation blacklist");
    });

    it("new authority can seize tokens via permanent delegate", async () => {
      const newSeizerRole = deriveRolePda(configPda, ROLE_SEIZER, newAuthority.publicKey, program.programId);
      await program.methods
        .updateRoles(ROLE_SEIZER, newAuthority.publicKey, true)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newSeizerRole,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      // Create new authority's ATA for receiving seized tokens
      const newAuthorityAta = getAssociatedTokenAddressSync(
        mintKey, newAuthority.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          newAuthority.publicKey, newAuthorityAta, newAuthority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(createAtaTx, [newAuthority]);

      // Build extra accounts for seize CPI (transfer hook resolution)
      const targetAta = getAssociatedTokenAddressSync(mintKey, targetUser.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const dummyIx = createTransferCheckedInstruction(
        targetAta,
        mintKey,
        newAuthorityAta,
        configPda,
        BigInt(50_000_000),
        6,
        [],
        TOKEN_2022_PROGRAM_ID
      );
      await addExtraAccountMetasForExecute(
        connection,
        dummyIx,
        hookProgram.programId,
        targetAta,
        mintKey,
        newAuthorityAta,
        configPda,
        BigInt(50_000_000),
        "confirmed"
      );
      const extraKeys = dummyIx.keys.slice(4);

      const [targetBlacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), targetUser.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .seize(new anchor.BN(50_000_000))
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newSeizerRole,
          blacklistedOwner: targetUser.publicKey,
          blacklistEntry: targetBlacklistEntry,
          mint: mintKey,
          fromTokenAccount: targetAta,
          toTokenAccount: newAuthorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(extraKeys)
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const targetAccount = await getAccount(connection, targetAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(targetAccount.amount)).to.equal(50_000_000);

      const newAuthAccount = await getAccount(connection, newAuthorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(newAuthAccount.amount)).to.equal(50_000_000);
    });

    it("new authority can remove from blacklist", async () => {
      const newBlacklisterRole = deriveRolePda(configPda, ROLE_BLACKLISTER, newAuthority.publicKey, program.programId);
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), targetUser.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .removeFromBlacklist(targetUser.publicKey)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
          roleAccount: newBlacklisterRole,
          blacklistEntry,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      const info = await connection.getAccountInfo(blacklistEntry);
      expect(info).to.be.null;
    });

    it("old authority cannot assign compliance roles after transfer", async () => {
      const dummyUser = Keypair.generate();
      const dummyBlacklisterRole = deriveRolePda(configPda, ROLE_BLACKLISTER, dummyUser.publicKey, program.programId);
      try {
        await program.methods
          .updateRoles(ROLE_BLACKLISTER, dummyUser.publicKey, true)
          .accountsStrict({
            authority: originalAuthority.publicKey,
            config: configPda,
            roleAccount: dummyBlacklisterRole,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown — old authority must not assign compliance roles");
      } catch (err: unknown) {
        expect((err as Error).toString()).to.include("InvalidAuthority");
      }
    });
  });
});
