import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SssOracle } from "../target/types/sss_oracle";
import { expect } from "chai";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

const ORACLE_CONFIG_SEED = Buffer.from("oracle_config");

describe("Oracle Module", () => {
  const _env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(_env.connection.rpcEndpoint, "confirmed"),
    _env.wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.SssOracle as Program<SssOracle>;
  const authority = provider.wallet;

  // Use a fake stablecoin config (unchecked account in oracle program)
  const fakeStablecoinConfig = Keypair.generate();
  const fakeAggregator = Keypair.generate();

  let oracleConfigPda: PublicKey;

  before(async () => {
    [oracleConfigPda] = PublicKey.findProgramAddressSync(
      [ORACLE_CONFIG_SEED, fakeStablecoinConfig.publicKey.toBuffer()],
      program.programId
    );
  });

  describe("Initialize Oracle", () => {
    it("initializes oracle config linked to a stablecoin", async () => {
      await program.methods
        .initializeOracle({
          baseCurrency: "EUR",
          stalenessThreshold: new anchor.BN(300),
          priceDecimals: 6,
          minPrice: new anchor.BN(800_000), // 0.80
          maxPrice: new anchor.BN(1_200_000), // 1.20
          manualOverride: true,
        })
        .accountsStrict({
          authority: authority.publicKey,
          oracleConfig: oracleConfigPda,
          stablecoinConfig: fakeStablecoinConfig.publicKey,
          aggregator: fakeAggregator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.oracleConfig.fetch(oracleConfigPda);
      expect(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(config.stablecoinConfig.toBase58()).to.equal(fakeStablecoinConfig.publicKey.toBase58());
      expect(config.aggregator.toBase58()).to.equal(fakeAggregator.publicKey.toBase58());
      expect(config.baseCurrency).to.equal("EUR");
      expect(config.stalenessThreshold.toNumber()).to.equal(300);
      expect(config.priceDecimals).to.equal(6);
      expect(config.minPrice.toNumber()).to.equal(800_000);
      expect(config.maxPrice.toNumber()).to.equal(1_200_000);
      expect(config.manualOverride).to.equal(true);
      expect(config.lastPrice.toNumber()).to.equal(0);
      expect(config.lastTimestamp.toNumber()).to.equal(0);
    });

    it("rejects currency exceeding max length", async () => {
      const badMint = Keypair.generate();
      const [badPda] = PublicKey.findProgramAddressSync(
        [ORACLE_CONFIG_SEED, badMint.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .initializeOracle({
            baseCurrency: "TOOLONGCUR", // > 8 bytes
            stalenessThreshold: new anchor.BN(300),
            priceDecimals: 6,
            minPrice: new anchor.BN(800_000),
            maxPrice: new anchor.BN(1_200_000),
            manualOverride: false,
          })
          .accountsStrict({
            authority: authority.publicKey,
            oracleConfig: badPda,
            stablecoinConfig: badMint.publicKey,
            aggregator: fakeAggregator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("CurrencyTooLong");
      }
    });

    it("rejects zero staleness threshold", async () => {
      const badMint = Keypair.generate();
      const [badPda] = PublicKey.findProgramAddressSync(
        [ORACLE_CONFIG_SEED, badMint.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .initializeOracle({
            baseCurrency: "USD",
            stalenessThreshold: new anchor.BN(0),
            priceDecimals: 6,
            minPrice: new anchor.BN(800_000),
            maxPrice: new anchor.BN(1_200_000),
            manualOverride: false,
          })
          .accountsStrict({
            authority: authority.publicKey,
            oracleConfig: badPda,
            stablecoinConfig: badMint.publicKey,
            aggregator: fakeAggregator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidStaleness");
      }
    });

    it("rejects invalid price bounds (min >= max)", async () => {
      const badMint = Keypair.generate();
      const [badPda] = PublicKey.findProgramAddressSync(
        [ORACLE_CONFIG_SEED, badMint.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .initializeOracle({
            baseCurrency: "USD",
            stalenessThreshold: new anchor.BN(300),
            priceDecimals: 6,
            minPrice: new anchor.BN(1_200_000),
            maxPrice: new anchor.BN(800_000), // min > max
            manualOverride: false,
          })
          .accountsStrict({
            authority: authority.publicKey,
            oracleConfig: badPda,
            stablecoinConfig: badMint.publicKey,
            aggregator: fakeAggregator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidPriceBounds");
      }
    });
  });

  describe("Push Manual Price", () => {
    it("pushes a manual price when override is enabled", async () => {
      await program.methods
        .pushManualPrice(new anchor.BN(1_050_000)) // 1.05
        .accountsStrict({
          authority: authority.publicKey,
          oracleConfig: oracleConfigPda,
        })
        .rpc();

      const config = await program.account.oracleConfig.fetch(oracleConfigPda);
      expect(config.lastPrice.toNumber()).to.equal(1_050_000);
      expect(config.lastTimestamp.toNumber()).to.be.greaterThan(0);
    });

    it("rejects zero price", async () => {
      try {
        await program.methods
          .pushManualPrice(new anchor.BN(0))
          .accountsStrict({
            authority: authority.publicKey,
            oracleConfig: oracleConfigPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidPrice");
      }
    });

    it("rejects price below min_price", async () => {
      try {
        await program.methods
          .pushManualPrice(new anchor.BN(100_000)) // 0.10 — below min of 0.80
          .accountsStrict({
            authority: authority.publicKey,
            oracleConfig: oracleConfigPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("PriceOutOfBounds");
      }
    });

    it("rejects price above max_price", async () => {
      try {
        await program.methods
          .pushManualPrice(new anchor.BN(2_000_000)) // 2.00 — above max of 1.20
          .accountsStrict({
            authority: authority.publicKey,
            oracleConfig: oracleConfigPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("PriceOutOfBounds");
      }
    });

    it("rejects unauthorized caller", async () => {
      const unauthorized = Keypair.generate();
      const fundTx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: unauthorized.publicKey,
          lamports: 100_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      try {
        await program.methods
          .pushManualPrice(new anchor.BN(1_000_000))
          .accountsStrict({
            authority: unauthorized.publicKey,
            oracleConfig: oracleConfigPda,
          })
          .signers([unauthorized])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });

  describe("Update Oracle Config", () => {
    it("updates staleness threshold", async () => {
      await program.methods
        .updateOracleConfig({
          newAggregator: null,
          newStalenessThreshold: new anchor.BN(600),
          newMinPrice: null,
          newMaxPrice: null,
          newManualOverride: null,
        })
        .accountsStrict({
          authority: authority.publicKey,
          oracleConfig: oracleConfigPda,
        })
        .rpc();

      const config = await program.account.oracleConfig.fetch(oracleConfigPda);
      expect(config.stalenessThreshold.toNumber()).to.equal(600);
      // Other fields should be unchanged
      expect(config.minPrice.toNumber()).to.equal(800_000);
      expect(config.maxPrice.toNumber()).to.equal(1_200_000);
    });

    it("updates price bounds", async () => {
      await program.methods
        .updateOracleConfig({
          newAggregator: null,
          newStalenessThreshold: null,
          newMinPrice: new anchor.BN(900_000),
          newMaxPrice: new anchor.BN(1_100_000),
          newManualOverride: null,
        })
        .accountsStrict({
          authority: authority.publicKey,
          oracleConfig: oracleConfigPda,
        })
        .rpc();

      const config = await program.account.oracleConfig.fetch(oracleConfigPda);
      expect(config.minPrice.toNumber()).to.equal(900_000);
      expect(config.maxPrice.toNumber()).to.equal(1_100_000);
    });

    it("updates aggregator address", async () => {
      const newAggregator = Keypair.generate();
      await program.methods
        .updateOracleConfig({
          newAggregator: newAggregator.publicKey,
          newStalenessThreshold: null,
          newMinPrice: null,
          newMaxPrice: null,
          newManualOverride: null,
        })
        .accountsStrict({
          authority: authority.publicKey,
          oracleConfig: oracleConfigPda,
        })
        .rpc();

      const config = await program.account.oracleConfig.fetch(oracleConfigPda);
      expect(config.aggregator.toBase58()).to.equal(newAggregator.publicKey.toBase58());
    });

    it("disables manual override", async () => {
      await program.methods
        .updateOracleConfig({
          newAggregator: null,
          newStalenessThreshold: null,
          newMinPrice: null,
          newMaxPrice: null,
          newManualOverride: false,
        })
        .accountsStrict({
          authority: authority.publicKey,
          oracleConfig: oracleConfigPda,
        })
        .rpc();

      const config = await program.account.oracleConfig.fetch(oracleConfigPda);
      expect(config.manualOverride).to.equal(false);
    });

    it("rejects manual push after override disabled", async () => {
      try {
        await program.methods
          .pushManualPrice(new anchor.BN(1_000_000))
          .accountsStrict({
            authority: authority.publicKey,
            oracleConfig: oracleConfigPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("ManualOverrideDisabled");
      }
    });

    it("rejects invalid staleness threshold in update", async () => {
      try {
        await program.methods
          .updateOracleConfig({
            newAggregator: null,
            newStalenessThreshold: new anchor.BN(0),
            newMinPrice: null,
            newMaxPrice: null,
            newManualOverride: null,
          })
          .accountsStrict({
            authority: authority.publicKey,
            oracleConfig: oracleConfigPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidStaleness");
      }
    });

    it("rejects unauthorized config update", async () => {
      const unauthorized = Keypair.generate();
      const fundTx = new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: unauthorized.publicKey,
          lamports: 100_000_000,
        })
      );
      await provider.sendAndConfirm(fundTx);

      try {
        await program.methods
          .updateOracleConfig({
            newAggregator: null,
            newStalenessThreshold: new anchor.BN(900),
            newMinPrice: null,
            newMaxPrice: null,
            newManualOverride: null,
          })
          .accountsStrict({
            authority: unauthorized.publicKey,
            oracleConfig: oracleConfigPda,
          })
          .signers([unauthorized])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });

  describe("Refresh Price (Aggregator)", () => {
    it("rejects aggregator mismatch", async () => {
      const wrongAggregator = Keypair.generate();
      try {
        await program.methods
          .refreshPrice()
          .accountsStrict({
            caller: authority.publicKey,
            oracleConfig: oracleConfigPda,
            aggregator: wrongAggregator.publicKey,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("AggregatorMismatch");
      }
    });
  });

  describe("Multiple Oracle Configs", () => {
    it("creates separate oracle configs for different stablecoins", async () => {
      const secondStablecoin = Keypair.generate();
      const secondAggregator = Keypair.generate();
      const [secondPda] = PublicKey.findProgramAddressSync(
        [ORACLE_CONFIG_SEED, secondStablecoin.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeOracle({
          baseCurrency: "BRL",
          stalenessThreshold: new anchor.BN(120),
          priceDecimals: 8,
          minPrice: new anchor.BN(15_000_000), // 0.15 BRL
          maxPrice: new anchor.BN(25_000_000), // 0.25 BRL
          manualOverride: true,
        })
        .accountsStrict({
          authority: authority.publicKey,
          oracleConfig: secondPda,
          stablecoinConfig: secondStablecoin.publicKey,
          aggregator: secondAggregator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.oracleConfig.fetch(secondPda);
      expect(config.baseCurrency).to.equal("BRL");
      expect(config.priceDecimals).to.equal(8);
      expect(config.minPrice.toNumber()).to.equal(15_000_000);

      // Original config should be unchanged
      const original = await program.account.oracleConfig.fetch(oracleConfigPda);
      expect(original.baseCurrency).to.equal("EUR");
    });
  });
});
