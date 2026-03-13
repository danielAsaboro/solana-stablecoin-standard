import { expect } from "chai";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

const describeLive = process.env.CLI_LIVE_TESTS === "1" ? describe : describe.skip;
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const WALLET_PATH = process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = resolve(__dirname, "../dist/bin/sss-token.js");

function loadWalletKeypair(): Keypair {
  const secretKey = JSON.parse(readFileSync(WALLET_PATH, "utf-8")) as Array<number>;
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function stripAnsi(output: string): string {
  return output.replace(/\u001b\[[0-9;]*m/g, "");
}

function runCli(args: Array<string>, cwd: string): string {
  return execFileSync(
    process.execPath,
    [CLI_PATH, "--keypair", WALLET_PATH, "--rpc", RPC_URL, ...args],
    {
      cwd,
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 60_000,
    }
  );
}

function readConfig(cwd: string): { mintAddress: string; configAddress: string } {
  return JSON.parse(readFileSync(join(cwd, ".sss-token.json"), "utf-8")) as {
    mintAddress: string;
    configAddress: string;
  };
}

async function createAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<void> {
  const ataAddress = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      ataAddress,
      owner,
      mint,
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: "confirmed",
  });
}

describeLive("CLI Live Tests", function () {
  this.timeout(180_000);

  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadWalletKeypair();

  it("runs an SSS-1 lifecycle through the real CLI", async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), "sss-cli-live-"));

    const initOutput = stripAnsi(
      runCli(
        [
          "init",
          "--preset",
          "sss-1",
          "--name",
          "CLI Live USD",
          "--symbol",
          "CL1",
          "--decimals",
          "6",
        ],
        workingDirectory
      )
    );
    expect(initOutput).to.include("Config saved");

    const { mintAddress } = readConfig(workingDirectory);
    const mint = new PublicKey(mintAddress);

    await createAta(connection, payer, mint, payer.publicKey);

    runCli(["minters", "add", payer.publicKey.toBase58(), "--quota", "5000000"], workingDirectory);
    runCli(["roles", "add", "burner", payer.publicKey.toBase58()], workingDirectory);
    runCli(["roles", "add", "pauser", payer.publicKey.toBase58()], workingDirectory);
    runCli(["mint", payer.publicKey.toBase58(), "1500000"], workingDirectory);

    let statusOutput = stripAnsi(runCli(["status"], workingDirectory));
    expect(statusOutput).to.include("CLI Live USD");
    expect(statusOutput).to.include("1.500000");
    expect(statusOutput).to.include("Active");

    runCli(["pause"], workingDirectory);
    statusOutput = stripAnsi(runCli(["status"], workingDirectory));
    expect(statusOutput).to.include("PAUSED");

    runCli(["unpause"], workingDirectory);
    runCli(["burn", "500000"], workingDirectory);

    const payerAta = getAssociatedTokenAddressSync(
      mint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const account = await getAccount(connection, payerAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    expect(account.amount.toString()).to.equal("1000000");
  });

  it("runs blacklist and seize operations through the real CLI", async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), "sss-cli-live-"));
    const blockedUser = Keypair.generate();
    const treasury = Keypair.generate();

    const initOutput = stripAnsi(
      runCli(
        [
          "init",
          "--preset",
          "sss-2",
          "--name",
          "CLI Compliant USD",
          "--symbol",
          "CL2",
          "--decimals",
          "6",
        ],
        workingDirectory
      )
    );
    expect(initOutput).to.include("Config saved");

    const { mintAddress } = readConfig(workingDirectory);
    const mint = new PublicKey(mintAddress);

    await createAta(connection, payer, mint, blockedUser.publicKey);
    await createAta(connection, payer, mint, treasury.publicKey);

    runCli(["minters", "add", payer.publicKey.toBase58(), "--quota", "5000000"], workingDirectory);
    runCli(["roles", "add", "blacklister", payer.publicKey.toBase58()], workingDirectory);
    runCli(["roles", "add", "seizer", payer.publicKey.toBase58()], workingDirectory);
    runCli(["mint", blockedUser.publicKey.toBase58(), "1200000"], workingDirectory);

    const blacklistOutput = stripAnsi(
      runCli(
        [
          "blacklist",
          "add",
          blockedUser.publicKey.toBase58(),
          "--reason",
          "CLI live compliance test",
        ],
        workingDirectory
      )
    );
    expect(blacklistOutput).to.include("Reason");

    const statusOutput = stripAnsi(runCli(["status"], workingDirectory));
    expect(statusOutput).to.include("Blacklist (1 entry)");

    runCli(
      [
        "seize",
        blockedUser.publicKey.toBase58(),
        "--to",
        treasury.publicKey.toBase58(),
        "--amount",
        "1200000",
      ],
      workingDirectory
    );

    runCli(["blacklist", "remove", blockedUser.publicKey.toBase58()], workingDirectory);

    const blockedAta = getAssociatedTokenAddressSync(
      mint,
      blockedUser.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const treasuryAta = getAssociatedTokenAddressSync(
      mint,
      treasury.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const blockedAccount = await getAccount(
      connection,
      blockedAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    const treasuryAccount = await getAccount(
      connection,
      treasuryAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    expect(blockedAccount.amount.toString()).to.equal("0");
    expect(treasuryAccount.amount.toString()).to.equal("1200000");
  });
});
