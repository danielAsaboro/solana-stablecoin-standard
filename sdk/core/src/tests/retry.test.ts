import { expect } from "chai";
import {
  isTransientError,
  withRetry,
  SSSTransactionError,
  DEFAULT_RETRY_CONFIG,
} from "../retry";
import { RoleType } from "../types";

describe("Retry & Error Classification", () => {
  describe("isTransientError", () => {
    it("classifies rate limit errors as transient", () => {
      expect(isTransientError(new Error("429 Too Many Requests"))).to.equal(
        true,
      );
      expect(isTransientError(new Error("rate limit exceeded"))).to.equal(true);
    });

    it("classifies network errors as transient", () => {
      expect(isTransientError(new Error("ECONNREFUSED"))).to.equal(true);
      expect(isTransientError(new Error("ECONNRESET"))).to.equal(true);
      expect(isTransientError(new Error("ETIMEDOUT"))).to.equal(true);
      expect(isTransientError(new Error("socket hang up"))).to.equal(true);
    });

    it("classifies Solana blockhash errors as transient", () => {
      expect(isTransientError(new Error("blockhash not found"))).to.equal(true);
      expect(
        isTransientError(
          new Error("Transaction was not confirmed in 30 seconds"),
        ),
      ).to.equal(true);
    });

    it("classifies HTTP 5xx errors as transient", () => {
      expect(isTransientError(new Error("502 Bad Gateway"))).to.equal(true);
      expect(isTransientError(new Error("503 Service Unavailable"))).to.equal(
        true,
      );
      expect(isTransientError(new Error("504 Gateway Timeout"))).to.equal(true);
    });

    it("classifies program errors as permanent (not transient)", () => {
      expect(
        isTransientError(new Error("custom program error: 0x1770")),
      ).to.equal(false);
      expect(
        isTransientError(new Error("program error: InvalidAuthority")),
      ).to.equal(false);
    });

    it("classifies insufficient funds as permanent", () => {
      expect(
        isTransientError(new Error("insufficient funds for rent")),
      ).to.equal(false);
      expect(isTransientError(new Error("insufficient lamports"))).to.equal(
        false,
      );
    });

    it("classifies simulation failures as permanent", () => {
      expect(isTransientError(new Error("Simulation failed"))).to.equal(false);
    });

    it("classifies unknown errors as not transient", () => {
      expect(isTransientError(new Error("something unexpected"))).to.equal(
        false,
      );
    });

    it("handles non-Error values", () => {
      expect(isTransientError("429")).to.equal(true);
      expect(isTransientError(null)).to.equal(false);
      expect(isTransientError(undefined)).to.equal(false);
    });

    it("permanent patterns take priority over transient", () => {
      // "insufficient funds" + "502" — permanent should win
      expect(isTransientError(new Error("insufficient funds 502"))).to.equal(
        false,
      );
    });
  });

  describe("DEFAULT_RETRY_CONFIG", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).to.equal(3);
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).to.equal(500);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).to.equal(10_000);
      expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).to.equal(2.0);
      expect(DEFAULT_RETRY_CONFIG.jitter).to.equal(true);
    });
  });

  describe("SSSTransactionError", () => {
    it("captures error context", () => {
      const cause = new Error("blockhash not found");
      const err = new SSSTransactionError(
        "Failed after 4 attempts",
        cause,
        4,
        true,
      );
      expect(err.name).to.equal("SSSTransactionError");
      expect(err.cause).to.equal(cause);
      expect(err.attempts).to.equal(4);
      expect(err.wasTransient).to.equal(true);
      expect(err.message).to.include("4 attempts");
    });

    it("is an instance of Error", () => {
      const err = new SSSTransactionError("test", new Error("test"), 1, false);
      expect(err).to.be.instanceOf(Error);
    });
  });

  describe("withRetry", () => {
    it("returns result on first success", async () => {
      const result = await withRetry(async () => 42, { maxRetries: 0 });
      expect(result).to.equal(42);
    });

    it("retries on transient errors", async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 3) throw new Error("ECONNRESET");
          return "success";
        },
        { maxRetries: 5, initialDelayMs: 1, jitter: false },
      );
      expect(result).to.equal("success");
      expect(attempts).to.equal(3);
    });

    it("throws immediately on permanent errors", async () => {
      let attempts = 0;
      try {
        await withRetry(
          async () => {
            attempts++;
            throw new Error("custom program error");
          },
          { maxRetries: 5, initialDelayMs: 1 },
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(attempts).to.equal(1);
        expect(err.message).to.include("custom program error");
      }
    });

    it("throws SSSTransactionError after exhausting retries", async () => {
      try {
        await withRetry(
          async () => {
            throw new Error("ECONNREFUSED");
          },
          { maxRetries: 2, initialDelayMs: 1, jitter: false },
        );
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).to.be.instanceOf(SSSTransactionError);
        expect(err.attempts).to.equal(3); // 1 initial + 2 retries
        expect(err.wasTransient).to.equal(true);
      }
    });

    it("calls onRetry callback", async () => {
      const retryLog: number[] = [];
      try {
        await withRetry(
          async () => {
            throw new Error("ECONNRESET");
          },
          {
            maxRetries: 2,
            initialDelayMs: 1,
            jitter: false,
            onRetry: (_err, attempt) => retryLog.push(attempt),
          },
        );
      } catch {
        // Expected
      }
      expect(retryLog).to.deep.equal([1, 2]);
    });
  });

  describe("RoleType enum", () => {
    it("has correct numeric values", () => {
      expect(RoleType.Minter).to.equal(0);
      expect(RoleType.Burner).to.equal(1);
      expect(RoleType.Pauser).to.equal(2);
      expect(RoleType.Blacklister).to.equal(3);
      expect(RoleType.Seizer).to.equal(4);
    });
  });
});
