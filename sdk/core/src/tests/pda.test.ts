import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getConfigAddress,
  getRoleAddress,
  getMinterQuotaAddress,
  getBlacklistEntryAddress,
  getExtraAccountMetasAddress,
} from "../pda";

// Known program IDs from the project
const SSS_PROGRAM_ID = new PublicKey(
  "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu",
);
const HOOK_PROGRAM_ID = new PublicKey(
  "Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH",
);

describe("PDA Derivation", () => {
  const mint = Keypair.generate().publicKey;
  const user = Keypair.generate().publicKey;

  describe("getConfigAddress", () => {
    it("returns a valid PDA and bump", () => {
      const [address, bump] = getConfigAddress(SSS_PROGRAM_ID, mint);
      expect(address).to.be.instanceOf(PublicKey);
      expect(bump).to.be.a("number");
      expect(bump).to.be.gte(0).and.lte(255);
    });

    it("is deterministic (same inputs produce same output)", () => {
      const [addr1] = getConfigAddress(SSS_PROGRAM_ID, mint);
      const [addr2] = getConfigAddress(SSS_PROGRAM_ID, mint);
      expect(addr1.toBase58()).to.equal(addr2.toBase58());
    });

    it("different mints produce different addresses", () => {
      const mint2 = Keypair.generate().publicKey;
      const [addr1] = getConfigAddress(SSS_PROGRAM_ID, mint);
      const [addr2] = getConfigAddress(SSS_PROGRAM_ID, mint2);
      expect(addr1.toBase58()).to.not.equal(addr2.toBase58());
    });

    it("matches manual findProgramAddressSync derivation", () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from("stablecoin"), mint.toBuffer()],
        SSS_PROGRAM_ID,
      );
      const [actual] = getConfigAddress(SSS_PROGRAM_ID, mint);
      expect(actual.toBase58()).to.equal(expected.toBase58());
    });
  });

  describe("getRoleAddress", () => {
    it("returns valid PDAs for all 5 role types", () => {
      const config = Keypair.generate().publicKey;
      for (let roleType = 0; roleType <= 4; roleType++) {
        const [address, bump] = getRoleAddress(
          SSS_PROGRAM_ID,
          config,
          roleType,
          user,
        );
        expect(address).to.be.instanceOf(PublicKey);
        expect(bump).to.be.gte(0).and.lte(255);
      }
    });

    it("different role types produce different PDAs", () => {
      const config = Keypair.generate().publicKey;
      const addresses = new Set<string>();
      for (let roleType = 0; roleType <= 4; roleType++) {
        const [address] = getRoleAddress(
          SSS_PROGRAM_ID,
          config,
          roleType,
          user,
        );
        addresses.add(address.toBase58());
      }
      expect(addresses.size).to.equal(5);
    });

    it("different users produce different PDAs for same role", () => {
      const config = Keypair.generate().publicKey;
      const user2 = Keypair.generate().publicKey;
      const [addr1] = getRoleAddress(SSS_PROGRAM_ID, config, 0, user);
      const [addr2] = getRoleAddress(SSS_PROGRAM_ID, config, 0, user2);
      expect(addr1.toBase58()).to.not.equal(addr2.toBase58());
    });

    it("matches manual derivation", () => {
      const config = Keypair.generate().publicKey;
      const [expected] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("role"),
          config.toBuffer(),
          Buffer.from([2]),
          user.toBuffer(),
        ],
        SSS_PROGRAM_ID,
      );
      const [actual] = getRoleAddress(SSS_PROGRAM_ID, config, 2, user);
      expect(actual.toBase58()).to.equal(expected.toBase58());
    });
  });

  describe("getMinterQuotaAddress", () => {
    it("returns a valid PDA and bump", () => {
      const config = Keypair.generate().publicKey;
      const [address, bump] = getMinterQuotaAddress(
        SSS_PROGRAM_ID,
        config,
        user,
      );
      expect(address).to.be.instanceOf(PublicKey);
      expect(bump).to.be.gte(0).and.lte(255);
    });

    it("different minters produce different PDAs", () => {
      const config = Keypair.generate().publicKey;
      const minter2 = Keypair.generate().publicKey;
      const [addr1] = getMinterQuotaAddress(SSS_PROGRAM_ID, config, user);
      const [addr2] = getMinterQuotaAddress(SSS_PROGRAM_ID, config, minter2);
      expect(addr1.toBase58()).to.not.equal(addr2.toBase58());
    });

    it("matches manual derivation", () => {
      const config = Keypair.generate().publicKey;
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from("minter_quota"), config.toBuffer(), user.toBuffer()],
        SSS_PROGRAM_ID,
      );
      const [actual] = getMinterQuotaAddress(SSS_PROGRAM_ID, config, user);
      expect(actual.toBase58()).to.equal(expected.toBase58());
    });
  });

  describe("getBlacklistEntryAddress", () => {
    it("returns a valid PDA and bump", () => {
      const config = Keypair.generate().publicKey;
      const [address, bump] = getBlacklistEntryAddress(
        SSS_PROGRAM_ID,
        config,
        user,
      );
      expect(address).to.be.instanceOf(PublicKey);
      expect(bump).to.be.gte(0).and.lte(255);
    });

    it("matches manual derivation", () => {
      const config = Keypair.generate().publicKey;
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from("blacklist"), config.toBuffer(), user.toBuffer()],
        SSS_PROGRAM_ID,
      );
      const [actual] = getBlacklistEntryAddress(SSS_PROGRAM_ID, config, user);
      expect(actual.toBase58()).to.equal(expected.toBase58());
    });
  });

  describe("getExtraAccountMetasAddress", () => {
    it("returns a valid PDA and bump", () => {
      const [address, bump] = getExtraAccountMetasAddress(
        HOOK_PROGRAM_ID,
        mint,
      );
      expect(address).to.be.instanceOf(PublicKey);
      expect(bump).to.be.gte(0).and.lte(255);
    });

    it("matches manual derivation", () => {
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from("extra-account-metas"), mint.toBuffer()],
        HOOK_PROGRAM_ID,
      );
      const [actual] = getExtraAccountMetasAddress(HOOK_PROGRAM_ID, mint);
      expect(actual.toBase58()).to.equal(expected.toBase58());
    });

    it("uses hook program ID, not SSS program ID", () => {
      const [hookAddr] = getExtraAccountMetasAddress(HOOK_PROGRAM_ID, mint);
      const [sssAddr] = getExtraAccountMetasAddress(SSS_PROGRAM_ID, mint);
      expect(hookAddr.toBase58()).to.not.equal(sssAddr.toBase58());
    });
  });
});
