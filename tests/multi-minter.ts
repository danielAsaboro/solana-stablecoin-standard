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

describe("Multi-Minter", () => {
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

  const minter1 = Keypair.generate();
  const minter2 = Keypair.generate();

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;

  before(async () => {
    // Fund minters
    for (const minter of [minter1, minter2]) {
      const tx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: minter.publicKey,
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

    await program.methods
      .initialize({
        name: "Multi Minter",
        symbol: "MM",
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

    // Assign minter roles and quotas for both minters
    for (const minter of [minter1, minter2]) {
      const [rolePda] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([0]), minter.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .updateRoles(0, minter.publicKey, true)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const [quotaPda] = PublicKey.findProgramAddressSync(
        [MINTER_QUOTA_SEED, configPda.toBuffer(), minter.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .updateMinter(minter.publicKey, new anchor.BN(50_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: quotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

  it("minters have independent quotas", async () => {
    // Create ATAs for each minter
    for (const minter of [minter1, minter2]) {
      const ata = getAssociatedTokenAddressSync(mintKey, minter.publicKey, false, TOKEN_2022_PROGRAM_ID);
      const tx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, ata, minter.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(tx);
    }

    // Minter 1 mints 30M
    const ata1 = getAssociatedTokenAddressSync(mintKey, minter1.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const [role1] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([0]), minter1.publicKey.toBuffer()],
      program.programId
    );
    const [quota1] = PublicKey.findProgramAddressSync(
      [MINTER_QUOTA_SEED, configPda.toBuffer(), minter1.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .mintTokens(new anchor.BN(30_000_000))
      .accountsStrict({
        minter: minter1.publicKey,
        config: configPda,
        roleAccount: role1,
        minterQuota: quota1,
        mint: mintKey,
        recipientTokenAccount: ata1,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([minter1])
      .rpc({ commitment: "confirmed" });

    // Minter 2 mints full 50M (independent quota)
    const ata2 = getAssociatedTokenAddressSync(mintKey, minter2.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const [role2] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([0]), minter2.publicKey.toBuffer()],
      program.programId
    );
    const [quota2] = PublicKey.findProgramAddressSync(
      [MINTER_QUOTA_SEED, configPda.toBuffer(), minter2.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .mintTokens(new anchor.BN(50_000_000))
      .accountsStrict({
        minter: minter2.publicKey,
        config: configPda,
        roleAccount: role2,
        minterQuota: quota2,
        mint: mintKey,
        recipientTokenAccount: ata2,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([minter2])
      .rpc({ commitment: "confirmed" });

    // Verify balances
    const account1 = await getAccount(connection, ata1, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(account1.amount)).to.equal(30_000_000);

    const account2 = await getAccount(connection, ata2, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(Number(account2.amount)).to.equal(50_000_000);

    // Minter 1 should fail exceeding remaining quota (20M left, try 30M)
    try {
      await program.methods
        .mintTokens(new anchor.BN(30_000_000))
        .accountsStrict({
          minter: minter1.publicKey,
          config: configPda,
          roleAccount: role1,
          minterQuota: quota1,
          mint: mintKey,
          recipientTokenAccount: ata1,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([minter1])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("QuotaExceeded");
    }
  });

  it("quota can be reset by updating", async () => {
    const [quota1] = PublicKey.findProgramAddressSync(
      [MINTER_QUOTA_SEED, configPda.toBuffer(), minter1.publicKey.toBuffer()],
      program.programId
    );

    // Increase quota to 100M (existing minted stays at 30M)
    await program.methods
      .updateMinter(minter1.publicKey, new anchor.BN(100_000_000))
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        minterQuota: quota1,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const quota = await program.account.minterQuota.fetch(quota1);
    expect(quota.quota.toNumber()).to.equal(100_000_000);
    expect(quota.minted.toNumber()).to.equal(30_000_000); // preserved
  });
});
