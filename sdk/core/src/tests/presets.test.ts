import { expect } from "chai";
import { Presets, SSS_1, SSS_2, SSS_3 } from "../presets";

describe("Preset Configurations", () => {
  describe("SSS-1 (Minimal)", () => {
    it("disables permanent delegate", () => {
      expect(SSS_1.permanentDelegate).to.equal(false);
    });

    it("disables transfer hook", () => {
      expect(SSS_1.transferHook).to.equal(false);
    });

    it("does not freeze accounts by default", () => {
      expect(SSS_1.defaultAccountFrozen).to.equal(false);
    });

    it("does not enable confidential transfers", () => {
      expect(SSS_1.confidentialTransfer).to.be.undefined;
    });
  });

  describe("SSS-2 (Compliance)", () => {
    it("enables permanent delegate for seizure", () => {
      expect(SSS_2.permanentDelegate).to.equal(true);
    });

    it("enables transfer hook for blacklist enforcement", () => {
      expect(SSS_2.transferHook).to.equal(true);
    });

    it("does not freeze accounts by default", () => {
      expect(SSS_2.defaultAccountFrozen).to.equal(false);
    });
  });

  describe("SSS-3 (Privacy)", () => {
    it("disables permanent delegate", () => {
      expect(SSS_3.permanentDelegate).to.equal(false);
    });

    it("disables transfer hook", () => {
      expect(SSS_3.transferHook).to.equal(false);
    });

    it("enables confidential transfers", () => {
      expect(SSS_3.confidentialTransfer).to.equal(true);
    });
  });

  describe("Presets namespace", () => {
    it("exports all three presets", () => {
      expect(Presets).to.have.property("SSS_1");
      expect(Presets).to.have.property("SSS_2");
      expect(Presets).to.have.property("SSS_3");
    });

    it("SSS_1 and SSS_2 differ in compliance features", () => {
      expect(Presets.SSS_1.permanentDelegate).to.not.equal(
        Presets.SSS_2.permanentDelegate,
      );
      expect(Presets.SSS_1.transferHook).to.not.equal(
        Presets.SSS_2.transferHook,
      );
    });

    it("SSS_2 and SSS_3 have different feature profiles", () => {
      // SSS-2: compliance (delegate + hook), no privacy
      expect(Presets.SSS_2.permanentDelegate).to.equal(true);
      expect(Presets.SSS_2.confidentialTransfer).to.be.undefined;
      // SSS-3: privacy (confidential), no compliance
      expect(Presets.SSS_3.permanentDelegate).to.equal(false);
      expect(Presets.SSS_3.confidentialTransfer).to.equal(true);
    });
  });
});
