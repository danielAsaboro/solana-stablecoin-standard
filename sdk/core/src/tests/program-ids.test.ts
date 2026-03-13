import { expect } from "chai";
import { Connection, Keypair } from "@solana/web3.js";
import { SolanaStablecoin } from "../stablecoin";

describe("Program ID Wiring", () => {
  it("uses the on-chain SSS program ID for instruction building", async () => {
    const connection = new Connection("http://localhost:8899", "confirmed");
    const authority = Keypair.generate();

    const { stablecoin } = await SolanaStablecoin.create(connection, {
      name: "Test USD",
      symbol: "tUSD",
      decimals: 6,
      authority: authority.publicKey,
    });

    expect(stablecoin.program.programId.toBase58()).to.equal(
      "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
    );
  });
});
