import { expect } from "chai";
import { SSS_PROGRAM_ID, TRANSFER_HOOK_PROGRAM_ID } from "../src/helpers";

describe("CLI Program IDs", () => {
  it("matches the SSS on-chain program ID", () => {
    expect(SSS_PROGRAM_ID.toBase58()).to.equal(
      "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
    );
  });

  it("matches the transfer hook on-chain program ID", () => {
    expect(TRANSFER_HOOK_PROGRAM_ID.toBase58()).to.equal(
      "Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH"
    );
  });
});
