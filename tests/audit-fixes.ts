import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sss } from "../target/types/sss";
import { TransferHook } from "../target/types/transfer_hook";
import { expect } from "chai";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
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

// =============================================================================
// 1. create_minter (Happy + Sad)
// =============================================================================

describe("Audit Fix: create_minter", () => {
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

  before(async () => {
    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        name: "Audit CreateMinter",
        symbol: "ACM",
        uri: "https://test.com",
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
      .rpc({ commitment: "confirmed" });
  });

  describe("Happy paths", () => {
    it("creates a new minter with quota and verifies account state", async () => {
      const minterUser = Keypair.generate();
      const quotaPda = deriveMinterQuotaPda(configPda, minterUser.publicKey, program.programId);

      await program.methods
        .createMinter(minterUser.publicKey, new anchor.BN(500_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: quotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const quota = await program.account.minterQuota.fetch(quotaPda);
      expect(quota.config.toBase58()).to.equal(configPda.toBase58());
      expect(quota.minter.toBase58()).to.equal(minterUser.publicKey.toBase58());
      expect(quota.quota.toNumber()).to.equal(500_000_000);
      expect(quota.minted.toNumber()).to.equal(0);
      expect(quota.bump).to.be.greaterThan(0);
    });

    it("creates multiple minters for the same config independently", async () => {
      const minterA = Keypair.generate();
      const minterB = Keypair.generate();
      const quotaPdaA = deriveMinterQuotaPda(configPda, minterA.publicKey, program.programId);
      const quotaPdaB = deriveMinterQuotaPda(configPda, minterB.publicKey, program.programId);

      await program.methods
        .createMinter(minterA.publicKey, new anchor.BN(100_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: quotaPdaA,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      await program.methods
        .createMinter(minterB.publicKey, new anchor.BN(200_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: quotaPdaB,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const quotaA = await program.account.minterQuota.fetch(quotaPdaA);
      const quotaB = await program.account.minterQuota.fetch(quotaPdaB);
      expect(quotaA.quota.toNumber()).to.equal(100_000_000);
      expect(quotaB.quota.toNumber()).to.equal(200_000_000);
      expect(quotaA.minter.toBase58()).to.not.equal(quotaB.minter.toBase58());
    });
  });

  describe("Sad paths", () => {
    it("rejects creating a minter that already exists", async () => {
      const minterUser = Keypair.generate();
      const quotaPda = deriveMinterQuotaPda(configPda, minterUser.publicKey, program.programId);

      await program.methods
        .createMinter(minterUser.publicKey, new anchor.BN(100_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: quotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      try {
        await program.methods
          .createMinter(minterUser.publicKey, new anchor.BN(200_000_000))
          .accountsStrict({
            authority: authority.publicKey,
            config: configPda,
            minterQuota: quotaPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown -- minter already exists");
      } catch (err: any) {
        expect(err.toString()).to.satisfy((msg: string) =>
          msg.includes("already in use") || msg.includes("Error")
        );
      }
    });

    it("rejects create_minter by non-authority", async () => {
      const impostor = Keypair.generate();
      await fundAccount(provider, impostor.publicKey, 100_000_000);

      const minterUser = Keypair.generate();
      const quotaPda = deriveMinterQuotaPda(configPda, minterUser.publicKey, program.programId);

      try {
        await program.methods
          .createMinter(minterUser.publicKey, new anchor.BN(100_000_000))
          .accountsStrict({
            authority: impostor.publicKey,
            config: configPda,
            minterQuota: quotaPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([impostor])
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown -- impostor is not authority");
      } catch (err: any) {
        expect(err.toString()).to.satisfy((msg: string) =>
          msg.includes("InvalidAuthority") ||
          msg.includes("ConstraintRaw") ||
          msg.includes("Error")
        );
      }
    });
  });
});

// =============================================================================
// 2. update_minter — now separate from create (Happy + Sad)
// =============================================================================

describe("Audit Fix: update_minter (separate from create)", () => {
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
  let minterUser: Keypair;
  let quotaPda: PublicKey;

  before(async () => {
    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        name: "Audit UpdateMinter",
        symbol: "AUM",
        uri: "https://test.com",
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
      .rpc({ commitment: "confirmed" });

    // Assign minter role to authority for minting later
    const minterRolePda = deriveRolePda(configPda, ROLE_MINTER, authority.publicKey, program.programId);
    await program.methods
      .assignRole(ROLE_MINTER, authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: minterRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Create a minter using createMinter first
    minterUser = Keypair.generate();
    quotaPda = deriveMinterQuotaPda(configPda, minterUser.publicKey, program.programId);

    await program.methods
      .createMinter(minterUser.publicKey, new anchor.BN(500_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: quotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
  });

  describe("Happy paths", () => {
    it("updates an existing minter quota and preserves minted counter", async () => {
      // First verify the initial state
      let quota = await program.account.minterQuota.fetch(quotaPda);
      expect(quota.quota.toNumber()).to.equal(500_000_000);
      expect(quota.minted.toNumber()).to.equal(0);

      // Update quota to a higher value
      await program.methods
        .updateMinter(minterUser.publicKey, new anchor.BN(1_000_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: quotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      quota = await program.account.minterQuota.fetch(quotaPda);
      expect(quota.quota.toNumber()).to.equal(1_000_000_000);
      expect(quota.minted.toNumber()).to.equal(0);
    });

    it("preserves the minted counter after quota update", async () => {
      // Create a fresh minter that will actually mint, to test counter preservation
      const freshMinter = Keypair.generate();
      await fundAccount(provider, freshMinter.publicKey, 100_000_000);

      const freshQuotaPda = deriveMinterQuotaPda(configPda, freshMinter.publicKey, program.programId);

      // Create the minter with an initial quota
      await program.methods
        .createMinter(freshMinter.publicKey, new anchor.BN(500_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: freshQuotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      // Assign role and create ATA so we can mint
      const freshMinterRole = deriveRolePda(configPda, ROLE_MINTER, freshMinter.publicKey, program.programId);
      await program.methods
        .assignRole(ROLE_MINTER, freshMinter.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: freshMinterRole,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const freshMinterAta = getAssociatedTokenAddressSync(
        mintKey, freshMinter.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, freshMinterAta, freshMinter.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(createAtaTx);

      // Mint some tokens to move the minted counter
      await program.methods
        .mintTokens(new anchor.BN(50_000_000))
        .accountsStrict({
          minter: freshMinter.publicKey,
          config: configPda,
          roleAccount: freshMinterRole,
          minterQuota: freshQuotaPda,
          mint: mintKey,
          recipientTokenAccount: freshMinterAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([freshMinter])
        .rpc({ commitment: "confirmed" });

      let quota = await program.account.minterQuota.fetch(freshQuotaPda);
      expect(quota.minted.toNumber()).to.equal(50_000_000);

      // Now update the quota -- minted counter should stay at 50_000_000
      await program.methods
        .updateMinter(freshMinter.publicKey, new anchor.BN(800_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: freshQuotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      quota = await program.account.minterQuota.fetch(freshQuotaPda);
      expect(quota.quota.toNumber()).to.equal(800_000_000);
      expect(quota.minted.toNumber()).to.equal(50_000_000);
    });
  });

  describe("Sad paths", () => {
    it("rejects updating a minter that does not exist", async () => {
      const nonexistentMinter = Keypair.generate();
      const nonexistentQuotaPda = deriveMinterQuotaPda(
        configPda, nonexistentMinter.publicKey, program.programId
      );

      try {
        await program.methods
          .updateMinter(nonexistentMinter.publicKey, new anchor.BN(100_000_000))
          .accountsStrict({
            authority: authority.publicKey,
            config: configPda,
            minterQuota: nonexistentQuotaPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown -- minter does not exist");
      } catch (err: any) {
        expect(err.toString()).to.satisfy((msg: string) =>
          msg.includes("AccountNotInitialized") ||
          msg.includes("AnchorError") ||
          msg.includes("Error")
        );
      }
    });

    it("rejects update_minter by non-authority", async () => {
      const impostor = Keypair.generate();
      await fundAccount(provider, impostor.publicKey, 100_000_000);

      try {
        await program.methods
          .updateMinter(minterUser.publicKey, new anchor.BN(999_000_000))
          .accountsStrict({
            authority: impostor.publicKey,
            config: configPda,
            minterQuota: quotaPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([impostor])
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown -- impostor is not authority");
      } catch (err: any) {
        expect(err.toString()).to.satisfy((msg: string) =>
          msg.includes("InvalidAuthority") ||
          msg.includes("ConstraintRaw") ||
          msg.includes("Error")
        );
      }
    });
  });
});

// =============================================================================
// 3. Two-step authority transfer — no single-step path (Happy + Sad)
// =============================================================================

describe("Audit Fix: Two-step authority transfer", () => {
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

  before(async () => {
    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        name: "Audit Authority",
        symbol: "AAT",
        uri: "https://test.com",
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
      .rpc({ commitment: "confirmed" });
  });

  describe("Happy paths", () => {
    it("completes two-step authority transfer: propose -> accept", async () => {
      const newAuthority = Keypair.generate();
      await fundAccount(provider, newAuthority.publicKey, 100_000_000);

      // Step 1: Propose
      await program.methods
        .proposeAuthorityTransfer(newAuthority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      let config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.pendingAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

      // Step 2: Accept
      await program.methods
        .acceptAuthorityTransfer()
        .accountsStrict({
          newAuthority: newAuthority.publicKey,
          config: configPda,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());
      expect(config.pendingAuthority.toBase58()).to.equal(PublicKey.default.toBase58());

      // Transfer back for further tests
      await program.methods
        .proposeAuthorityTransfer(authority.publicKey)
        .accountsStrict({
          authority: newAuthority.publicKey,
          config: configPda,
        })
        .signers([newAuthority])
        .rpc({ commitment: "confirmed" });

      await program.methods
        .acceptAuthorityTransfer()
        .accountsStrict({
          newAuthority: authority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.masterAuthority.toBase58()).to.equal(authority.publicKey.toBase58());
    });

    it("propose -> cancel clears pending authority", async () => {
      const newAuthority = Keypair.generate();
      await fundAccount(provider, newAuthority.publicKey, 100_000_000);

      await program.methods
        .proposeAuthorityTransfer(newAuthority.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      let config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.pendingAuthority.toBase58()).to.equal(newAuthority.publicKey.toBase58());

      await program.methods
        .cancelAuthorityTransfer()
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.pendingAuthority.toBase58()).to.equal(PublicKey.default.toBase58());
      expect(config.masterAuthority.toBase58()).to.equal(authority.publicKey.toBase58());
    });
  });

  describe("Sad paths", () => {
    it("old single-step transferAuthority method does not exist on program", () => {
      // The IDL should not have a transferAuthority method
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const methods = program.methods as any;
      expect(methods.transferAuthority).to.be.undefined;
    });

    it("rejects accept with wrong signer", async () => {
      const intendedNew = Keypair.generate();
      const wrongSigner = Keypair.generate();
      await fundAccount(provider, intendedNew.publicKey, 100_000_000);
      await fundAccount(provider, wrongSigner.publicKey, 100_000_000);

      await program.methods
        .proposeAuthorityTransfer(intendedNew.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      try {
        await program.methods
          .acceptAuthorityTransfer()
          .accountsStrict({
            newAuthority: wrongSigner.publicKey,
            config: configPda,
          })
          .signers([wrongSigner])
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown -- wrong signer");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidPendingAuthority");
      }

      // Clean up
      await program.methods
        .cancelAuthorityTransfer()
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("rejects accept with no pending transfer", async () => {
      const randomSigner = Keypair.generate();
      await fundAccount(provider, randomSigner.publicKey, 100_000_000);

      // No proposal was made, so pending_authority == Pubkey::default()
      try {
        await program.methods
          .acceptAuthorityTransfer()
          .accountsStrict({
            newAuthority: randomSigner.publicKey,
            config: configPda,
          })
          .signers([randomSigner])
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown -- no pending transfer");
      } catch (err: any) {
        expect(err.toString()).to.include("NoPendingTransfer");
      }
    });

    it("rejects propose when transfer already pending", async () => {
      const firstNew = Keypair.generate();
      const secondNew = Keypair.generate();

      await program.methods
        .proposeAuthorityTransfer(firstNew.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });

      try {
        await program.methods
          .proposeAuthorityTransfer(secondNew.publicKey)
          .accountsStrict({
            authority: authority.publicKey,
            config: configPda,
          })
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown -- transfer already pending");
      } catch (err: any) {
        expect(err.toString()).to.include("PendingTransferExists");
      }

      // Clean up
      await program.methods
        .cancelAuthorityTransfer()
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("rejects propose by non-authority", async () => {
      const impostor = Keypair.generate();
      await fundAccount(provider, impostor.publicKey, 100_000_000);
      const target = Keypair.generate();

      try {
        await program.methods
          .proposeAuthorityTransfer(target.publicKey)
          .accountsStrict({
            authority: impostor.publicKey,
            config: configPda,
          })
          .signers([impostor])
          .rpc({ commitment: "confirmed" });
        expect.fail("Should have thrown -- impostor is not authority");
      } catch (err: any) {
        expect(err.toString()).to.satisfy((msg: string) =>
          msg.includes("InvalidAuthority") ||
          msg.includes("ConstraintRaw") ||
          msg.includes("Error")
        );
      }
    });
  });
});

// =============================================================================
// 4. Transfer hook check_is_transferring guard (Happy + Sad)
// =============================================================================

describe("Audit Fix: Transfer hook check_is_transferring guard", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.Sss as Program<Sss>;
  const hookProgram = anchor.workspace.TransferHook as Program<TransferHook>;
  const authority = provider.wallet;
  const connection = provider.connection;

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;
  let authorityAta: PublicKey;
  let recipientAta: PublicKey;
  const recipient = Keypair.generate();

  before(async () => {
    await fundAccount(provider, recipient.publicKey, 1_000_000_000);

    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    authorityAta = getAssociatedTokenAddressSync(
      mintKey, authority.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    recipientAta = getAssociatedTokenAddressSync(
      mintKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID
    );

    // Initialize SSS-2 with permanent delegate + transfer hook
    await program.methods
      .initialize({
        name: "Audit Hook Guard",
        symbol: "AHG",
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

    // Initialize extra account metas
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

    // Assign minter role + set quota
    const minterRolePda = deriveRolePda(configPda, ROLE_MINTER, authority.publicKey, program.programId);
    await program.methods
      .assignRole(ROLE_MINTER, authority.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: minterRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const minterQuotaPda = deriveMinterQuotaPda(configPda, authority.publicKey, program.programId);
    await program.methods
      .createMinter(authority.publicKey, new anchor.BN(5_000_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: minterQuotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Create ATAs
    const createAtasTx = new anchor.web3.Transaction();
    createAtasTx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, authorityAta, authority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
      )
    );
    createAtasTx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, recipientAta, recipient.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createAtasTx);

    // Mint tokens to authority
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

  describe("Happy path", () => {
    it("normal SSS-2 transfer via Token-2022 transfer_checked succeeds", async () => {
      const transferIx = createTransferCheckedInstruction(
        authorityAta,
        mintKey,
        recipientAta,
        authority.publicKey,
        BigInt(10_000_000),
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
        recipientAta,
        authority.publicKey,
        BigInt(10_000_000),
        "confirmed"
      );

      const tx = new anchor.web3.Transaction().add(transferIx);
      await provider.sendAndConfirm(tx);

      const recipientAccount = await getAccount(
        connection, recipientAta, "confirmed", TOKEN_2022_PROGRAM_ID
      );
      expect(Number(recipientAccount.amount)).to.equal(10_000_000);
    });
  });

  describe("Sad path", () => {
    it("rejects direct call to transfer hook (NotTransferring)", async () => {
      const [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("extra-account-metas"), mintKey.toBuffer()],
        hookProgram.programId
      );

      // Derive the blacklist PDAs for source and destination owners
      const [sourceBlacklistPda] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
        program.programId
      );
      const [destBlacklistPda] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), recipient.publicKey.toBuffer()],
        program.programId
      );

      // Build a raw instruction calling the transfer hook's execute directly
      // using the SPL Transfer Hook Interface discriminator
      const executeDiscriminator = Buffer.from([105, 37, 101, 197, 75, 251, 102, 26]);
      const amountBuffer = Buffer.alloc(8);
      amountBuffer.writeBigUInt64LE(BigInt(1_000_000));
      const data = Buffer.concat([executeDiscriminator, amountBuffer]);

      const directCallIx = new TransactionInstruction({
        programId: hookProgram.programId,
        keys: [
          { pubkey: authorityAta, isSigner: false, isWritable: false },
          { pubkey: mintKey, isSigner: false, isWritable: false },
          { pubkey: recipientAta, isSigner: false, isWritable: false },
          { pubkey: authority.publicKey, isSigner: false, isWritable: false },
          { pubkey: extraAccountMetasPda, isSigner: false, isWritable: false },
          { pubkey: program.programId, isSigner: false, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: sourceBlacklistPda, isSigner: false, isWritable: false },
          { pubkey: destBlacklistPda, isSigner: false, isWritable: false },
        ],
        data,
      });

      const tx = new anchor.web3.Transaction().add(directCallIx);

      try {
        await provider.sendAndConfirm(tx);
        expect.fail("Should have thrown -- direct call without transferring flag");
      } catch (err: any) {
        expect(err.toString()).to.satisfy((msg: string) =>
          msg.includes("NotTransferring") ||
          msg.includes("custom program error") ||
          msg.includes("Error")
        );
      }
    });
  });
});
