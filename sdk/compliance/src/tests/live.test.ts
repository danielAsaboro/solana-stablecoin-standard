import { expect } from "chai";
import { readFileSync } from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import {
  Presets,
  RoleType,
  SolanaStablecoin,
  createATAInstruction,
} from "@stbr/sss-core-sdk";
import { ComplianceModule } from "../compliance";

const describeLive = process.env.SSS_LIVE_TESTS === "1" ? describe : describe.skip;
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH"
);

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

describeLive("Compliance SDK Live Tests", function () {
  this.timeout(120_000);

  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899",
    "confirmed"
  );
  const authority = loadWalletKeypair();
  const blockedUser = Keypair.generate();

  let stablecoin: SolanaStablecoin;
  let compliance: ComplianceModule;

  before(async () => {
    const { stablecoin: createdStablecoin, mintKeypair, instruction } =
      await SolanaStablecoin.create(connection, {
        preset: Presets.SSS_2,
        name: `Compliance USD ${Date.now()}`,
        symbol: `CU${Date.now().toString().slice(-4)}`,
        decimals: 6,
        authority: authority.publicKey,
        transferHookProgramId: TRANSFER_HOOK_PROGRAM_ID,
      });

    await sendInstructions(connection, authority, [instruction], [mintKeypair]);
    stablecoin = createdStablecoin;
    compliance = new ComplianceModule(
      stablecoin.program,
      connection,
      stablecoin.mintAddress,
      stablecoin.configAddress
    );

    await sendInstructions(connection, authority, [
      createATAInstruction(authority.publicKey, blockedUser.publicKey, stablecoin.mintAddress),
    ]);

    await sendInstructions(connection, authority, [
      await stablecoin.assignRole({
        roleType: RoleType.Minter,
        user: authority.publicKey,
        authority: authority.publicKey,
      }),
      await stablecoin.assignRole({
        roleType: RoleType.Blacklister,
        user: authority.publicKey,
        authority: authority.publicKey,
      }),
    ]);

    await sendInstructions(connection, authority, [
      await stablecoin.updateMinter({
        minter: authority.publicKey,
        quota: new BN(5_000_000),
        authority: authority.publicKey,
      }),
    ]);

    await sendInstructions(connection, authority, [
      await stablecoin.mint({
        amount: new BN(2_000_000),
        recipient: blockedUser.publicKey,
        minter: authority.publicKey,
      }),
    ]);
  });

  it("reports enabled compliance features and minted supply", async () => {
    const summary = await compliance.getSummary();

    expect(await compliance.isComplianceEnabled()).to.equal(true);
    expect(await compliance.isSeizeEnabled()).to.equal(true);
    expect(summary.complianceEnabled).to.equal(true);
    expect(summary.seizeEnabled).to.equal(true);
    expect(summary.totalMinted).to.equal("2000000");
  });

  it("tracks blacklist add and remove operations against Surfpool", async () => {
    await sendInstructions(connection, authority, [
      await stablecoin.compliance.blacklistAdd({
        address: blockedUser.publicKey,
        reason: "Live compliance test",
        authority: authority.publicKey,
      }),
    ]);

    expect(await compliance.blacklist.isBlacklisted(blockedUser.publicKey)).to.equal(true);

    const entry = await compliance.blacklist.get(blockedUser.publicKey);
    const entries = await compliance.blacklist.getAll();
    const auditEntries = await compliance.audit.getEntries({
      action: "blacklist_add",
      limit: 20,
    });

    expect(entry?.reason).to.equal("Live compliance test");
    expect(entries.some((candidate) =>
      candidate.account.address.toBase58() === blockedUser.publicKey.toBase58()
    )).to.equal(true);
    expect(auditEntries.some((candidate) => candidate.action === "blacklist_add")).to.equal(true);

    await sendInstructions(connection, authority, [
      await stablecoin.compliance.blacklistRemove({
        address: blockedUser.publicKey,
        authority: authority.publicKey,
      }),
    ]);

    expect(await compliance.blacklist.isBlacklisted(blockedUser.publicKey)).to.equal(false);
  });
});
