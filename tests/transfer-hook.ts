import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

const EXTRA_ACCOUNT_METAS_SEED = Buffer.from("extra-account-metas");
const STABLECOIN_SEED = Buffer.from("stablecoin");

describe("Transfer Hook", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const sssProgram = anchor.workspace.Sss as Program;
  const hookProgram = anchor.workspace.TransferHook as Program;
  const authority = provider.wallet;
  const connection = provider.connection;

  let mintKeypair: Keypair;
  let mintKey: PublicKey;
  let configPda: PublicKey;
  let extraAccountMetasPda: PublicKey;

  before(async () => {
    mintKeypair = Keypair.generate();
    mintKey = mintKeypair.publicKey;

    [configPda] = PublicKey.findProgramAddressSync(
      [STABLECOIN_SEED, mintKey.toBuffer()],
      sssProgram.programId
    );

    [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
      [EXTRA_ACCOUNT_METAS_SEED, mintKey.toBuffer()],
      hookProgram.programId
    );

    // Initialize SSS-2 stablecoin with transfer hook
    await sssProgram.methods
      .initialize({
        name: "Hook Test",
        symbol: "HOOK",
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
      .rpc();
  });

  describe("ExtraAccountMetas Initialization", () => {
    it("initializes the extra account metas PDA", async () => {
      await hookProgram.methods
        .initializeExtraAccountMetas()
        .accountsStrict({
          payer: authority.publicKey,
          extraAccountMetas: extraAccountMetasPda,
          mint: mintKey,
          sssProgram: sssProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Verify the account was created
      const info = await connection.getAccountInfo(extraAccountMetasPda);
      expect(info).to.not.be.null;
      expect(info!.owner.toBase58()).to.equal(hookProgram.programId.toBase58());
      expect(info!.data.length).to.be.greaterThan(0);
    });
  });
});
