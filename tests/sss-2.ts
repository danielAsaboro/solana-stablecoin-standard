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

describe("SSS-2: Compliant Stablecoin Lifecycle", () => {
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
  const targetUser = Keypair.generate();

  before(async () => {
    // Fund target user
    const fundTx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: targetUser.publicKey,
        lamports: 1_000_000_000,
      })
    );
    await provider.sendAndConfirm(fundTx);

    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;
    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      program.programId
    );

    authorityAta = getAssociatedTokenAddressSync(
      mintKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
  });

  describe("Initialize SSS-2", () => {
    it("creates stablecoin with permanent delegate and transfer hook", async () => {
      await program.methods
        .initialize({
          name: "Compliant USD",
          symbol: "cUSD",
          uri: "https://test.com",
          decimals: 6,
          enablePermanentDelegate: true,
          enableTransferHook: true,
          defaultAccountFrozen: false,
          transferHookProgramId: hookProgram.programId,
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

      const config = await program.account.stablecoinConfig.fetch(configPda);
      expect(config.enablePermanentDelegate).to.equal(true);
      expect(config.enableTransferHook).to.equal(true);
      expect(config.transferHookProgram.toBase58()).to.equal(hookProgram.programId.toBase58());
    });
  });

  describe("Assign All Roles", () => {
    it("assigns all 5 role types", async () => {
      for (const roleType of [ROLE_MINTER, ROLE_BURNER, ROLE_PAUSER, ROLE_BLACKLISTER, ROLE_SEIZER]) {
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
          .rpc({ commitment: "confirmed" });
      }
    });

    it("sets minter quota", async () => {
      const [quotaPda] = PublicKey.findProgramAddressSync(
        [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
        program.programId
      );
      await program.methods
        .updateMinter(authority.publicKey, new anchor.BN(1_000_000_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          minterQuota: quotaPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("initializes extra account metas for the transfer hook", async () => {
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
    });
  });

  describe("Mint & Blacklist", () => {
    it("mints tokens", async () => {
      const tx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, authorityAta, authority.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(tx);

      const [minterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_MINTER]), authority.publicKey.toBuffer()],
        program.programId
      );
      const [quota] = PublicKey.findProgramAddressSync(
        [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .mintTokens(new anchor.BN(500_000_000))
        .accountsStrict({
          minter: authority.publicKey,
          config: configPda,
          roleAccount: minterRole,
          minterQuota: quota,
          mint: mintKey,
          recipientTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      const account = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(account.amount)).to.equal(500_000_000);
    });

    it("blacklists an address", async () => {
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), authority.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), targetUser.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .addToBlacklist(targetUser.publicKey, "Suspicious activity")
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const entry = await program.account.blacklistEntry.fetch(blacklistEntry);
      expect(entry.address.toBase58()).to.equal(targetUser.publicKey.toBase58());
      expect(entry.reason).to.equal("Suspicious activity");
    });

    it("removes from blacklist", async () => {
      const [blacklisterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_BLACKLISTER]), authority.publicKey.toBuffer()],
        program.programId
      );
      const [blacklistEntry] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, configPda.toBuffer(), targetUser.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .removeFromBlacklist(targetUser.publicKey)
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: blacklisterRole,
          blacklistEntry,
        })
        .rpc({ commitment: "confirmed" });

      // Account should be closed
      const info = await connection.getAccountInfo(blacklistEntry);
      expect(info).to.be.null;
    });
  });

  describe("Seize", () => {
    it("seizes tokens from an account using permanent delegate", async () => {
      // Mint to target user first
      const targetAta = getAssociatedTokenAddressSync(
        mintKey, targetUser.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      const createAtaTx = new anchor.web3.Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey, targetAta, targetUser.publicKey, mintKey, TOKEN_2022_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(createAtaTx);

      const [minterRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_MINTER]), authority.publicKey.toBuffer()],
        program.programId
      );
      const [quota] = PublicKey.findProgramAddressSync(
        [MINTER_QUOTA_SEED, configPda.toBuffer(), authority.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .mintTokens(new anchor.BN(100_000_000))
        .accountsStrict({
          minter: authority.publicKey,
          config: configPda,
          roleAccount: minterRole,
          minterQuota: quota,
          mint: mintKey,
          recipientTokenAccount: targetAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: "confirmed" });

      // Now seize 50M from target
      const [seizerRole] = PublicKey.findProgramAddressSync(
        [ROLE_SEED, configPda.toBuffer(), Buffer.from([ROLE_SEIZER]), authority.publicKey.toBuffer()],
        program.programId
      );

      // Use SDK to resolve the correct extra accounts for the transfer hook.
      // Build a dummy transfer_checked instruction and let the SDK resolve extra accounts.
      const dummyIx = createTransferCheckedInstruction(
        targetAta,        // source
        mintKey,           // mint
        authorityAta,      // destination
        configPda,         // owner/delegate (config PDA is the permanent delegate)
        BigInt(50_000_000),
        6,                 // decimals
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

      // The SDK appends resolved extra accounts + hook_program + extra_account_metas_pda
      // to dummyIx.keys after the 4 base accounts.
      // Extract those as remaining accounts for our seize CPI.
      const extraKeys = dummyIx.keys.slice(4);

      await program.methods
        .seize(new anchor.BN(50_000_000))
        .accountsStrict({
          authority: authority.publicKey,
          config: configPda,
          roleAccount: seizerRole,
          mint: mintKey,
          fromTokenAccount: targetAta,
          toTokenAccount: authorityAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .remainingAccounts(extraKeys)
        .rpc({ commitment: "confirmed" });

      const targetAccount = await getAccount(connection, targetAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(targetAccount.amount)).to.equal(50_000_000);

      const authorityAccount = await getAccount(connection, authorityAta, "confirmed", TOKEN_2022_PROGRAM_ID);
      expect(Number(authorityAccount.amount)).to.equal(550_000_000); // 500M + 50M seized
    });
  });
});
