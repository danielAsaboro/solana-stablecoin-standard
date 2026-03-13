import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AuditFilter, AuditEntry } from "../audit";
import { BlacklistEntryData } from "../blacklist";

describe("Compliance SDK Types", () => {
  describe("AuditFilter interface", () => {
    it("allows empty filter (all optional)", () => {
      const filter: AuditFilter = {};
      expect(filter.action).to.be.undefined;
      expect(filter.fromTimestamp).to.be.undefined;
      expect(filter.toTimestamp).to.be.undefined;
      expect(filter.limit).to.be.undefined;
    });

    it("allows partial filter", () => {
      const filter: AuditFilter = {
        action: "mint",
        limit: 50,
      };
      expect(filter.action).to.equal("mint");
      expect(filter.limit).to.equal(50);
    });

    it("allows full filter", () => {
      const now = Math.floor(Date.now() / 1000);
      const filter: AuditFilter = {
        action: "seize",
        fromTimestamp: now - 86400,
        toTimestamp: now,
        limit: 100,
      };
      expect(filter.action).to.equal("seize");
      expect(filter.fromTimestamp).to.be.a("number");
      expect(filter.toTimestamp).to.be.a("number");
      expect(filter.limit).to.equal(100);
    });
  });

  describe("AuditEntry interface", () => {
    it("has correct shape", () => {
      const entry: AuditEntry = {
        signature: "5JtW4LT9JzwzGW2bmmXVQy2Ksxx6a1o3GKpLfQYrK6KXznz5U",
        timestamp: 1700000000,
        action: "mint",
        details: { amount: "1000000", recipient: "SomeBase58Key" },
      };
      expect(entry.signature).to.be.a("string");
      expect(entry.timestamp).to.be.a("number");
      expect(entry.action).to.equal("mint");
      expect(entry.details).to.have.property("amount");
    });
  });

  describe("BlacklistEntryData interface", () => {
    it("has correct shape", () => {
      const config = Keypair.generate().publicKey;
      const address = Keypair.generate().publicKey;
      const blacklistedBy = Keypair.generate().publicKey;

      const entry: BlacklistEntryData = {
        config,
        address,
        reason: "Sanctions violation",
        blacklistedAt: { toNumber: () => 1700000000 } as any,
        blacklistedBy,
        bump: 255,
      };
      expect(entry.config).to.be.instanceOf(PublicKey);
      expect(entry.address).to.be.instanceOf(PublicKey);
      expect(entry.reason).to.equal("Sanctions violation");
      expect(entry.bump).to.be.a("number");
    });
  });

  describe("Compliance action types", () => {
    it("defines standard action strings", () => {
      const validActions = [
        "initialize",
        "mint",
        "burn",
        "freeze",
        "thaw",
        "pause",
        "unpause",
        "role_update",
        "quota_update",
        "authority_transfer",
        "blacklist_add",
        "blacklist_remove",
        "seize",
      ];
      // These are the action types the audit log parser should recognize
      expect(validActions).to.have.lengthOf(13);
      expect(validActions).to.include("seize");
      expect(validActions).to.include("blacklist_add");
    });
  });
});
