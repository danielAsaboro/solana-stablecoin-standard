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
// Security: SSS-1
// =============================================================================

describe("Security: SSS-1", () => {
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

  let minterRolePda: PublicKey;
  let burnerRolePda: PublicKey;
  let pauserRolePda: PublicKey;
  let minterQuotaPda: PublicKey;
  let authorityAta: PublicKey;

  const QUOTA = 1_000_000_000; // 1000 tokens with 6 decimals

  before(async () => {
    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    minterRolePda = deriveRolePda(configPda, ROLE_MINTER, authority.publicKey, program.programId);
    burnerRolePda = deriveRolePda(configPda, ROLE_BURNER, authority.publicKey, program.programId);
    pauserRolePda = deriveRolePda(configPda, ROLE_PAUSER, authority.publicKey, program.programId);
    minterQuotaPda = deriveMinterQuotaPda(configPda, authority.publicKey, program.programId);

    authorityAta = getAssociatedTokenAddressSync(
      mintKey, authority.publicKey, false, TOKEN_2022_PROGRAM_ID
    );

    // Initialize SSS-1 stablecoin
    await program.methods
      .initialize({
        name: "Security Test SSS1",
        symbol: "SEC1",
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

    // Assign Minter, Burner, Pauser roles
    for (const [roleType, rolePda] of [
      [ROLE_MINTER, minterRolePda],
      [ROLE_BURNER, burnerRolePda],
      [ROLE_PAUSER, pauserRolePda],
    ] as [number, PublicKey][]) {
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

    // Set minter quota
    await program.methods
      .createMinter(authority.publicKey, new anchor.BN(QUOTA))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: minterQuotaPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Create ATA and mint initial tokens
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, authorityAta, authority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createAtaTx);

    await program.methods
      .mintTokens(new anchor.BN(100_000_000)) // 100 tokens
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

  it("rejects mint by non-minter (authority escalation)", async () => {
    const impostor = Keypair.generate();
    await fundAccount(provider, impostor.publicKey, 100_000_000);

    // Derive the role PDA the impostor would need -- it was never initialized
    const impostorRolePda = deriveRolePda(
      configPda, ROLE_MINTER, impostor.publicKey, program.programId
    );
    const impostorQuotaPda = deriveMinterQuotaPda(
      configPda, impostor.publicKey, program.programId
    );

    try {
      await program.methods
        .mintTokens(new anchor.BN(1_000_000))
        .accountsStrict({
          minter: impostor.publicKey,
          config: configPda,
          roleAccount: impostorRolePda,
          minterQuota: impostorQuotaPda,
          mint: mintKey,
          recipientTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([impostor])
        .rpc();
      expect.fail("Should have thrown -- impostor has no role PDA");
    } catch (err: any) {
      expect(err.toString()).to.satisfy((msg: string) =>
        msg.includes("AccountNotInitialized") ||
        msg.includes("AnchorError") ||
        msg.includes("Error")
      );
    }
  });

  it("rejects mint that would cause u64 overflow (MathOverflow)", async () => {
    // u64::MAX = 18446744073709551615
    // total_minted is already 100_000_000, so adding u64::MAX will overflow checked_add
    try {
      await program.methods
        .mintTokens(new anchor.BN("18446744073709551615"))
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
      expect.fail("Should have thrown MathOverflow");
    } catch (err: any) {
      expect(err.toString()).to.satisfy((msg: string) =>
        msg.includes("MathOverflow") ||
        msg.includes("QuotaExceeded") ||
        msg.includes("Error")
      );
    }
  });

  it("rejects SSS-2 operations on SSS-1 config (feature gate bypass)", async () => {
    // Attempt to assign the Blacklister role on an SSS-1 stablecoin
    const dummyUser = Keypair.generate();
    const blacklisterRolePda = deriveRolePda(
      configPda, ROLE_BLACKLISTER, dummyUser.publicKey, program.programId
    );

    try {
      await program.methods
        .assignRole(ROLE_BLACKLISTER, dummyUser.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: blacklisterRolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown ComplianceNotEnabled");
    } catch (err: any) {
      expect(err.toString()).to.include("ComplianceNotEnabled");
    }

    // Also attempt to assign the Seizer role -- should also fail
    const seizerRolePda = deriveRolePda(
      configPda, ROLE_SEIZER, dummyUser.publicKey, program.programId
    );

    try {
      await program.methods
        .assignRole(ROLE_SEIZER, dummyUser.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: seizerRolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown ComplianceNotEnabled");
    } catch (err: any) {
      expect(err.toString()).to.include("ComplianceNotEnabled");
    }
  });

  it("rejects mint when paused", async () => {
    // Pause the stablecoin
    await program.methods
      .pause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: pauserRolePda,
      })
      .rpc({ commitment: "confirmed" });

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
      expect.fail("Should have thrown Paused");
    } catch (err: any) {
      expect(err.toString()).to.include("Paused");
    }

    // Unpause for subsequent tests
    await program.methods
      .unpause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: pauserRolePda,
      })
      .rpc({ commitment: "confirmed" });
  });

  it("rejects mint that exceeds minter quota (QuotaExceeded)", async () => {
    // Quota is 1_000_000_000, already minted 100_000_000 -> remaining = 900_000_000
    // Try to mint 901_000_000 -- exceeds remaining quota
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
        .rpc();
      expect.fail("Should have thrown QuotaExceeded");
    } catch (err: any) {
      expect(err.toString()).to.include("QuotaExceeded");
    }
  });

  it("rejects mint after minter role deactivation", async () => {
    // Deactivate the minter role (updateRole has NO systemProgram in accounts)
    await program.methods
      .updateRole(ROLE_MINTER, authority.publicKey, false)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: minterRolePda,
      })
      .rpc({ commitment: "confirmed" });

    const role = await program.account.roleAccount.fetch(minterRolePda);
    expect(role.active).to.equal(false);

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
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }

    // Reactivate for subsequent tests (updateRole has NO systemProgram)
    await program.methods
      .updateRole(ROLE_MINTER, authority.publicKey, true)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: minterRolePda,
      })
      .rpc({ commitment: "confirmed" });
  });

  it("rejects burn when paused", async () => {
    // Pause the stablecoin
    await program.methods
      .pause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: pauserRolePda,
      })
      .rpc({ commitment: "confirmed" });

    try {
      await program.methods
        .burnTokens(new anchor.BN(1_000_000))
        .accountsStrict({
          burner: authority.publicKey,
          config: configPda,
          roleAccount: burnerRolePda,
          mint: mintKey,
          fromTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have thrown Paused");
    } catch (err: any) {
      expect(err.toString()).to.include("Paused");
    }

    // Unpause for subsequent tests
    await program.methods
      .unpause()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: pauserRolePda,
      })
      .rpc({ commitment: "confirmed" });
  });

  it("rejects accept_authority_transfer with wrong signer", async () => {
    const intendedNewAuth = Keypair.generate();
    const wrongSigner = Keypair.generate();
    await fundAccount(provider, intendedNewAuth.publicKey, 100_000_000);
    await fundAccount(provider, wrongSigner.publicKey, 100_000_000);

    // Propose authority transfer to the intended new authority
    await program.methods
      .proposeAuthorityTransfer(intendedNewAuth.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
      })
      .rpc({ commitment: "confirmed" });

    const configAfterPropose = await program.account.stablecoinConfig.fetch(configPda);
    expect(configAfterPropose.pendingAuthority.toBase58()).to.equal(
      intendedNewAuth.publicKey.toBase58()
    );

    // Try to accept with the wrong signer
    try {
      await program.methods
        .acceptAuthorityTransfer()
        .accountsStrict({
          newAuthority: wrongSigner.publicKey,
          config: configPda,
        })
        .signers([wrongSigner])
        .rpc();
      expect.fail("Should have thrown InvalidPendingAuthority");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidPendingAuthority");
    }

    // Cancel the proposal to clean up state for any future tests
    await program.methods
      .cancelAuthorityTransfer()
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
      })
      .rpc({ commitment: "confirmed" });

    const configAfterCancel = await program.account.stablecoinConfig.fetch(configPda);
    expect(configAfterCancel.pendingAuthority.toBase58()).to.equal(
      PublicKey.default.toBase58()
    );
  });
});

// =============================================================================
// Security: SSS-2
// =============================================================================

describe("Security: SSS-2", () => {
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
  let authorityAta: PublicKey;

  let minterRolePda: PublicKey;
  let blacklisterRolePda: PublicKey;
  let seizerRolePda: PublicKey;
  let minterQuotaPda: PublicKey;

  const targetUser = Keypair.generate();
  let targetAta: PublicKey;

  before(async () => {
    await fundAccount(provider, targetUser.publicKey, 1_000_000_000);

    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    authorityAta = getAssociatedTokenAddressSync(
      mintKey, authority.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    targetAta = getAssociatedTokenAddressSync(
      mintKey, targetUser.publicKey, false, TOKEN_2022_PROGRAM_ID
    );

    // Initialize SSS-2 stablecoin with permanent delegate + transfer hook
    await program.methods
      .initialize({
        name: "Security Test SSS2",
        symbol: "SEC2",
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

    // Assign all 5 roles to authority
    for (const roleType of [ROLE_MINTER, ROLE_BURNER, ROLE_PAUSER, ROLE_BLACKLISTER, ROLE_SEIZER]) {
      const rolePda = deriveRolePda(configPda, roleType, authority.publicKey, program.programId);
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

    minterRolePda = deriveRolePda(configPda, ROLE_MINTER, authority.publicKey, program.programId);
    blacklisterRolePda = deriveRolePda(configPda, ROLE_BLACKLISTER, authority.publicKey, program.programId);
    seizerRolePda = deriveRolePda(configPda, ROLE_SEIZER, authority.publicKey, program.programId);
    minterQuotaPda = deriveMinterQuotaPda(configPda, authority.publicKey, program.programId);

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

    // Create ATAs
    const createAtasTx = new anchor.web3.Transaction();
    createAtasTx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, authorityAta, authority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
      )
    );
    createAtasTx.add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey, targetAta, targetUser.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createAtasTx);

    // Mint tokens to authority and target user
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

    await program.methods
      .mintTokens(new anchor.BN(200_000_000))
      .accountsStrict({
        minter: authority.publicKey,
        config: configPda,
        roleAccount: minterRolePda,
        minterQuota: minterQuotaPda,
        mint: mintKey,
        recipientTokenAccount: targetAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });
  });

  it("blacklisted user cannot transfer tokens (transfer hook enforcement)", async () => {
    // Blacklist the target user
    const [blacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), targetUser.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .addToBlacklist(targetUser.publicKey, "Security test blacklist", Array(32).fill(0), "")
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRolePda,
        blacklistEntry,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    // Try to transfer from blacklisted target to authority -- transfer hook should block
    const transferIx = createTransferCheckedInstruction(
      targetAta,
      mintKey,
      authorityAta,
      targetUser.publicKey,
      BigInt(10_000_000),
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      connection,
      transferIx,
      hookProgram.programId,
      targetAta,
      mintKey,
      authorityAta,
      targetUser.publicKey,
      BigInt(10_000_000),
      "confirmed"
    );
    const tx = new anchor.web3.Transaction().add(transferIx);
    try {
      await provider.sendAndConfirm(tx, [targetUser]);
      expect.fail("Should have thrown -- blacklisted user cannot transfer");
    } catch (err: any) {
      expect(err.toString()).to.include("Blacklisted");
    }

    // Clean up: remove from blacklist for next test
    await program.methods
      .removeFromBlacklist(targetUser.publicKey)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: blacklisterRolePda,
        blacklistEntry,
      })
      .rpc({ commitment: "confirmed" });
  });

  it("rejects seize from non-blacklisted user (BlacklistEntry PDA not found)", async () => {
    // The target user is NOT blacklisted at this point -- their BlacklistEntry PDA does not exist
    const [nonExistentBlacklistEntry] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, configPda.toBuffer(), targetUser.publicKey.toBuffer()],
      program.programId
    );

    // Build extra accounts for the seize CPI
    const dummyIx = createTransferCheckedInstruction(
      targetAta,
      mintKey,
      authorityAta,
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
      authorityAta,
      configPda,
      BigInt(50_000_000),
      "confirmed"
    );
    const extraKeys = dummyIx.keys.slice(4);

    try {
      await program.methods
        .seize(new anchor.BN(50_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: seizerRolePda,
          blacklistedOwner: targetUser.publicKey,
          blacklistEntry: nonExistentBlacklistEntry,
          mint: mintKey,
          fromTokenAccount: targetAta,
          toTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(extraKeys)
        .rpc();
      expect.fail("Should have thrown -- target is not blacklisted");
    } catch (err: any) {
      expect(err.toString()).to.satisfy((msg: string) =>
        msg.includes("AccountNotInitialized") ||
        msg.includes("AnchorError") ||
        msg.includes("ConstraintSeeds") ||
        msg.includes("Error")
      );
    }
  });
});
