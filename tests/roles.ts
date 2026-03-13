import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sss } from "../target/types/sss";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

const STABLECOIN_SEED = Buffer.from("stablecoin");
const ROLE_SEED = Buffer.from("role");
const MINTER_QUOTA_SEED = Buffer.from("minter_quota");

describe("Roles", () => {
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
        name: "Roles Test",
        symbol: "ROLE",
        uri: "https://test.com",
        decimals: 6,
        enablePermanentDelegate: false,
        enableTransferHook: false,
        defaultAccountFrozen: false,
        enableConfidentialTransfer: false,
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
  });

  it("assigns all SSS-1 role types", async () => {
    for (const roleType of [0, 1, 2]) {
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

      const role = await program.account.roleAccount.fetch(rolePda);
      expect(role.active).to.equal(true);
      expect(role.roleType).to.equal(roleType);
    }
  });

  it("revokes a role", async () => {
    const [rolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([0]), authority.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .updateRoles(0, authority.publicKey, false)
      .accountsStrict({
        authority: authority.publicKey,
        config: configPda,
        roleAccount: rolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const role = await program.account.roleAccount.fetch(rolePda);
    expect(role.active).to.equal(false);
  });

  it("rejects unauthorized role assignment", async () => {
    const unauthorizedUser = Keypair.generate();
    // Fund
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: unauthorizedUser.publicKey,
        lamports: 100_000_000,
      })
    );
    await provider.sendAndConfirm(tx);

    const [rolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([0]), unauthorizedUser.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .updateRoles(0, unauthorizedUser.publicKey, true)
        .accountsStrict({
          authority: unauthorizedUser.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorizedUser])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidAuthority");
    }
  });

  it("rejects SSS-2 roles on SSS-1 config", async () => {
    const [rolePda] = PublicKey.findProgramAddressSync(
      [ROLE_SEED, configPda.toBuffer(), Buffer.from([3]), authority.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .updateRoles(3, authority.publicKey, true)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("ComplianceNotEnabled");
    }
  });

  it("multiple users can hold the same role concurrently", async () => {
    // Each user gets their own RoleAccount PDA (keyed by user pubkey)
    const user1 = Keypair.generate();
    const user2 = Keypair.generate();

    for (const user of [user1, user2]) {
      const [rolePda] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([1]), user.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .updateRoles(1, user.publicKey, true)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const role = await program.account.roleAccount.fetch(rolePda);
      expect(role.active).to.equal(true);
      expect(role.roleType).to.equal(1);
      expect(role.user.toBase58()).to.equal(user.publicKey.toBase58());
    }
  });

  it("assigns SSS-2 compliance roles on SSS-2 config", async () => {
    const sss2Mint = Keypair.generate();
    const [sss2Config] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, sss2Mint.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        name: "Roles SSS2",
        symbol: "RS2",
        uri: "https://test.com",
        decimals: 6,
        enablePermanentDelegate: true,
        enableTransferHook: true,
        defaultAccountFrozen: false,
        enableConfidentialTransfer: false,
        transferHookProgramId: hookProgram.programId,
      })
      .accountsStrict({
        authority: authority.publicKey,
        config: sss2Config,
        mint: sss2Mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([sss2Mint])
      .rpc();

    // Blacklister (3) and Seizer (4) are only valid on SSS-2
    for (const roleType of [3, 4]) {
      const [rolePda] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, sss2Config.toBuffer(), Buffer.from([roleType]), authority.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .updateRoles(roleType, authority.publicKey, true)
        .accountsStrict({
          authority: authority.publicKey,
          config: sss2Config,
          roleAccount: rolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const role = await program.account.roleAccount.fetch(rolePda);
      expect(role.active).to.equal(true);
      expect(role.roleType).to.equal(roleType);
    }
  });
});
