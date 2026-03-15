import { expect } from "chai";
import { readFileSync } from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";

import {
  Presets,
  RoleType,
  SolanaStablecoin,
  createATAInstruction,
  getTokenBalance,
} from "../index";
import transferHookIdl from "../../../../target/idl/transfer_hook.json";

const describeLive = process.env.SSS_LIVE_TESTS === "1" ? describe : describe.skip;

function loadWalletKeypair(): Keypair {
  const walletPath = process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(readFileSync(walletPath, "utf-8")) as Array<number>;
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

async function sendInstructions(
  connection: Connection,
  payer: Keypair,
  instructions: Array<Parameters<Transaction["add"]>[0]>,
  extraSigners: Array<Keypair> = []
): Promise<string> {
  const transaction = new Transaction();
  transaction.add(...instructions);
  return sendAndConfirmTransaction(connection, transaction, [payer, ...extraSigners], {
    commitment: "confirmed",
  });
}

describeLive("SDK Live Tests", function () {
  this.timeout(120_000);

  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899",
    "confirmed"
  );
  const authority = loadWalletKeypair();

  let stablecoin: SolanaStablecoin;

  it("creates and loads an SSS-1 stablecoin against Surfpool", async () => {
    const { stablecoin: createdStablecoin, mintKeypair, instruction } =
      await SolanaStablecoin.create(connection, {
        preset: Presets.SSS_1,
        name: `Live Test USD ${Date.now()}`,
        symbol: `LT${Date.now().toString().slice(-4)}`,
        decimals: 6,
        authority: authority.publicKey,
      });

    await sendInstructions(connection, authority, [instruction], [mintKeypair]);

    stablecoin = createdStablecoin;

    const loadedStablecoin = await SolanaStablecoin.load(
      connection,
      stablecoin.mintAddress
    );
    const config = await loadedStablecoin.getConfig();

    expect(loadedStablecoin.program.programId.toBase58()).to.equal(
      "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
    );
    expect(config.masterAuthority.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(config.enablePermanentDelegate).to.equal(false);
    expect(config.enableTransferHook).to.equal(false);
  });

  it("updates roles and quota, mints, and pauses/unpauses", async () => {
    const recipient = Keypair.generate();
    const mintAmount = new BN(1_500_000);
    const quota = new BN(5_000_000);

    await sendInstructions(connection, authority, [
      createATAInstruction(authority.publicKey, recipient.publicKey, stablecoin.mintAddress),
    ]);

    await sendInstructions(connection, authority, [
      await stablecoin.assignRole({
        roleType: RoleType.Minter,
        user: authority.publicKey,
        authority: authority.publicKey,
      }),
      await stablecoin.assignRole({
        roleType: RoleType.Pauser,
        user: authority.publicKey,
        authority: authority.publicKey,
      }),
    ]);

    await sendInstructions(connection, authority, [
      await stablecoin.updateMinter({
        minter: authority.publicKey,
        quota,
        authority: authority.publicKey,
      }),
    ]);

    await sendInstructions(connection, authority, [
      await stablecoin.mint({
        amount: mintAmount,
        recipient: recipient.publicKey,
        minter: authority.publicKey,
      }),
    ]);

    const recipientBalance = await getTokenBalance(
      connection,
      stablecoin.mintAddress,
      recipient.publicKey
    );
    const supply = await stablecoin.getSupply();
    expect(recipientBalance).to.equal(1.5);
    expect(supply.amount).to.equal(mintAmount.toString());

    await sendInstructions(connection, authority, [
      await stablecoin.pause({ authority: authority.publicKey }),
    ]);

    let config = await stablecoin.getConfig();
    expect(config.paused).to.equal(true);

    await sendInstructions(connection, authority, [
      await stablecoin.unpause({ authority: authority.publicKey }),
    ]);

    config = await stablecoin.getConfig();
    expect(config.paused).to.equal(false);
  });

  it("seizes blacklisted funds through the SDK compliance builder on SSS-2", async () => {
    const blockedUser = Keypair.generate();
    const treasury = Keypair.generate();
    const mintAmount = new BN(1_200_000);

    const { stablecoin: compliantStablecoin, mintKeypair, instruction } =
      await SolanaStablecoin.create(connection, {
        preset: Presets.SSS_2,
        name: "Live Compliance USD",
        symbol: `LC${Date.now().toString().slice(-4)}`,
        decimals: 6,
        authority: authority.publicKey,
        transferHookProgramId: new PublicKey(transferHookIdl.address),
      });

    await sendInstructions(connection, authority, [instruction], [mintKeypair]);

    const hookProgram = new Program(
      transferHookIdl as Idl,
      compliantStablecoin.program.provider as AnchorProvider
    );
    const [extraAccountMetas] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), compliantStablecoin.mintAddress.toBuffer()],
      hookProgram.programId
    );
    const initHookIx = await hookProgram.methods
      .initializeExtraAccountMetas()
      .accountsStrict({
        payer: authority.publicKey,
        extraAccountMetas,
        mint: compliantStablecoin.mintAddress,
        sssProgram: compliantStablecoin.program.programId,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    await sendInstructions(connection, authority, [initHookIx]);

    await sendInstructions(connection, authority, [
      createATAInstruction(
        authority.publicKey,
        blockedUser.publicKey,
        compliantStablecoin.mintAddress
      ),
      createATAInstruction(
        authority.publicKey,
        treasury.publicKey,
        compliantStablecoin.mintAddress
      ),
    ]);

    await sendInstructions(connection, authority, [
      await compliantStablecoin.assignRole({
        roleType: RoleType.Minter,
        user: authority.publicKey,
        authority: authority.publicKey,
      }),
      await compliantStablecoin.assignRole({
        roleType: RoleType.Blacklister,
        user: authority.publicKey,
        authority: authority.publicKey,
      }),
      await compliantStablecoin.assignRole({
        roleType: RoleType.Seizer,
        user: authority.publicKey,
        authority: authority.publicKey,
      }),
    ]);

    await sendInstructions(connection, authority, [
      await compliantStablecoin.updateMinter({
        minter: authority.publicKey,
        quota: new BN(5_000_000),
        authority: authority.publicKey,
      }),
    ]);

    await sendInstructions(connection, authority, [
      await compliantStablecoin.mint({
        amount: mintAmount,
        recipient: blockedUser.publicKey,
        minter: authority.publicKey,
      }),
    ]);

    await compliantStablecoin.compliance
      .blacklistAdd(blockedUser.publicKey, "SDK seize live test")
      .by(authority)
      .send(authority);

    await compliantStablecoin.compliance
      .seize(blockedUser.publicKey, treasury.publicKey)
      .amount(mintAmount)
      .by(authority)
      .send(authority);

    const blockedBalance = await getTokenBalance(
      connection,
      compliantStablecoin.mintAddress,
      blockedUser.publicKey
    );
    const treasuryBalance = await getTokenBalance(
      connection,
      compliantStablecoin.mintAddress,
      treasury.publicKey
    );

    expect(blockedBalance).to.equal(0);
    expect(treasuryBalance).to.equal(1.2);
  });
});
