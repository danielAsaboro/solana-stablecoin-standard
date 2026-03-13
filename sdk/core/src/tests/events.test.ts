import { expect } from "chai";
import { SSSEventName } from "../events";

describe("Event System", () => {
  describe("SSSEventName enum", () => {
    it("has all 13 event names", () => {
      const names = Object.values(SSSEventName);
      expect(names).to.have.lengthOf(13);
    });

    it("event names match on-chain event names", () => {
      expect(SSSEventName.StablecoinInitialized).to.equal("StablecoinInitialized");
      expect(SSSEventName.TokensMinted).to.equal("TokensMinted");
      expect(SSSEventName.TokensBurned).to.equal("TokensBurned");
      expect(SSSEventName.AccountFrozen).to.equal("AccountFrozen");
      expect(SSSEventName.AccountThawed).to.equal("AccountThawed");
      expect(SSSEventName.StablecoinPaused).to.equal("StablecoinPaused");
      expect(SSSEventName.StablecoinUnpaused).to.equal("StablecoinUnpaused");
      expect(SSSEventName.RoleUpdated).to.equal("RoleUpdated");
      expect(SSSEventName.MinterQuotaUpdated).to.equal("MinterQuotaUpdated");
      expect(SSSEventName.AuthorityTransferred).to.equal("AuthorityTransferred");
      expect(SSSEventName.AddressBlacklisted).to.equal("AddressBlacklisted");
      expect(SSSEventName.AddressUnblacklisted).to.equal("AddressUnblacklisted");
      expect(SSSEventName.TokensSeized).to.equal("TokensSeized");
    });

    it("SSS-1 events are a subset (first 10)", () => {
      const sss1Events = [
        SSSEventName.StablecoinInitialized,
        SSSEventName.TokensMinted,
        SSSEventName.TokensBurned,
        SSSEventName.AccountFrozen,
        SSSEventName.AccountThawed,
        SSSEventName.StablecoinPaused,
        SSSEventName.StablecoinUnpaused,
        SSSEventName.RoleUpdated,
        SSSEventName.MinterQuotaUpdated,
        SSSEventName.AuthorityTransferred,
      ];
      expect(sss1Events).to.have.lengthOf(10);
      for (const name of sss1Events) {
        expect(Object.values(SSSEventName)).to.include(name);
      }
    });

    it("SSS-2 compliance events include blacklist and seize", () => {
      const complianceEvents = [
        SSSEventName.AddressBlacklisted,
        SSSEventName.AddressUnblacklisted,
        SSSEventName.TokensSeized,
      ];
      expect(complianceEvents).to.have.lengthOf(3);
      for (const name of complianceEvents) {
        expect(Object.values(SSSEventName)).to.include(name);
      }
    });
  });
});
