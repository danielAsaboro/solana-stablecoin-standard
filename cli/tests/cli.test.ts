import { expect } from "chai";
import { execSync } from "child_process";
import { createHmac } from "crypto";
import { resolve } from "path";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  formatAuditRecordsAsJsonl,
  normalizeAuditRecord,
  resolveAuditOutputFormat,
} from "../src/commands/audit-log";
import { verifyWebhookSignature } from "../src/commands/webhook";

const CLI_PATH = resolve(__dirname, "../dist/bin/sss-token.js");

/**
 * Run the CLI and return stdout. Expects exit code 0 unless allowFailure is set.
 */
function runCli(args: string, allowFailure = false, cwd?: string): string {
  try {
    return execSync(`${process.execPath} ${CLI_PATH} ${args}`, {
      encoding: "utf-8",
      timeout: 15_000,
      cwd,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
  } catch (err: any) {
    if (allowFailure) {
      return err.stdout || err.stderr || err.message;
    }
    throw err;
  }
}

describe("CLI Smoke Tests", () => {
  describe("Version and Help", () => {
    it("shows version", () => {
      const output = runCli("--version");
      expect(output.trim()).to.equal("0.1.0");
    });

    it("shows help text with all commands", () => {
      const output = runCli("--help");
      expect(output).to.include("sss-token");
      expect(output).to.include("Solana Stablecoin Standard");
    });
  });

  describe("Subcommand Help", () => {
    const subcommands = [
      "init",
      "mint",
      "burn",
      "freeze",
      "pause",
      "status",
      "blacklist",
      "seize",
      "minters",
      "roles",
      "holders",
      "audit-log",
      "webhook",
      "supply",
      "config",
    ];

    for (const cmd of subcommands) {
      it(`"${cmd} --help" parses without error`, () => {
        const output = runCli(`${cmd} --help`);
        expect(output).to.include(cmd);
      });
    }
  });

  describe("Global Options", () => {
    it("accepts --keypair option", () => {
      const output = runCli("--help");
      expect(output).to.include("--keypair");
      expect(output).to.include("-k");
    });

    it("accepts --rpc option", () => {
      const output = runCli("--help");
      expect(output).to.include("--rpc");
      expect(output).to.include("-u");
    });

    it("accepts --config option", () => {
      const output = runCli("--help");
      expect(output).to.include("--config");
      expect(output).to.include("-c");
    });

    it("accepts --output option", () => {
      const output = runCli("--help");
      expect(output).to.include("--output");
      expect(output).to.include("-o");
    });

    it("accepts --dry-run option", () => {
      const output = runCli("--help");
      expect(output).to.include("--dry-run");
    });
  });

  describe("Blacklist Subcommands", () => {
    it("includes blacklist list help", () => {
      const output = runCli("blacklist --help");
      expect(output).to.include("list");
    });
  });

  describe("Config Commands", () => {
    it("includes config command help", () => {
      const output = runCli("config --help");
      expect(output).to.include("show");
      expect(output).to.include("path");
      expect(output).to.include("set");
    });

    it("prints a custom config path without requiring the file to exist", () => {
      const output = runCli("--config ./custom-config.json config path");
      expect(output.trim()).to.equal("./custom-config.json");
    });

    it("writes and reads config data in json mode", () => {
      const cwd = mkdtempSync(resolve(tmpdir(), "sss-cli-config-"));
      runCli(
        "--config ./ops.json --output json config set --mint 11111111111111111111111111111111 --config-address 11111111111111111111111111111111 --preset SSS-1 --rpc-url http://127.0.0.1:8899",
        false,
        cwd
      );

      const raw = JSON.parse(readFileSync(resolve(cwd, "ops.json"), "utf-8")) as {
        mintAddress: string;
        configAddress: string;
        rpcUrl: string;
        preset: string;
      };
      expect(raw.mintAddress).to.equal("11111111111111111111111111111111");
      expect(raw.configAddress).to.equal("11111111111111111111111111111111");
      expect(raw.preset).to.equal("SSS-1");

      const output = runCli("--config ./ops.json --output json config show", false, cwd);
      const parsed = JSON.parse(output) as { path: string; preset: string };
      expect(parsed.path).to.include("ops.json");
      expect(parsed.preset).to.equal("SSS-1");
    });

    it("supports dry-run role updates in json mode", () => {
      const cwd = mkdtempSync(resolve(tmpdir(), "sss-cli-config-"));
      runCli(
        "--config ./ops.json config set --mint 11111111111111111111111111111111 --config-address 11111111111111111111111111111111 --preset SSS-1",
        false,
        cwd
      );

      const output = runCli(
        "--config ./ops.json --output json --dry-run roles add minter 11111111111111111111111111111111",
        false,
        cwd
      );
      const parsed = JSON.parse(output) as {
        mode: string;
        action: string;
        details: { role: string; active: boolean };
      };
      expect(parsed.mode).to.equal("dry-run");
      expect(parsed.action).to.equal("roles.update");
      expect(parsed.details.role).to.equal("Minter");
      expect(parsed.details.active).to.equal(true);
    });

    it("supports named config profiles", () => {
      const cwd = mkdtempSync(resolve(tmpdir(), "sss-cli-config-"));
      runCli(
        "--config ./profiles.json config set --profile issuer-a --mint 11111111111111111111111111111111 --config-address 11111111111111111111111111111111 --preset SSS-1 --rpc-url http://localhost:8899",
        false,
        cwd
      );
      runCli(
        "--config ./profiles.json config set --profile issuer-b --mint So11111111111111111111111111111111111111112 --config-address 11111111111111111111111111111111 --preset SSS-2 --rpc-url http://127.0.0.1:8899",
        false,
        cwd
      );

      const profilesOutput = runCli(
        "--config ./profiles.json --output json config profiles",
        false,
        cwd
      );
      const profiles = JSON.parse(profilesOutput) as {
        activeProfile: string;
        profiles: Array<{ name: string }>;
      };
      expect(profiles.activeProfile).to.equal("issuer-a");
      expect(profiles.profiles.map((item) => item.name)).to.include("issuer-a");
      expect(profiles.profiles.map((item) => item.name)).to.include("issuer-b");

      const useOutput = runCli(
        "--config ./profiles.json --output json config use issuer-b",
        false,
        cwd
      );
      const useResult = JSON.parse(useOutput) as { activeProfile: string };
      expect(useResult.activeProfile).to.equal("issuer-b");

      const showOutput = runCli(
        "--config ./profiles.json --profile issuer-b --output json config show",
        false,
        cwd
      );
      const showResult = JSON.parse(showOutput) as { preset: string; rpcUrl: string };
      expect(showResult.preset).to.equal("SSS-2");
      expect(showResult.rpcUrl).to.equal("http://127.0.0.1:8899");
    });
  });

  describe("Audit Log Formatting", () => {
    it("supports jsonl audit output via the global output option", () => {
      const format = resolveAuditOutputFormat(
        { output: "jsonl" },
        {}
      );
      expect(format).to.equal("jsonl");
    });

    it("normalizes audit records into stable operator fields", () => {
      const record = normalizeAuditRecord({
        signature: "5JtW4LT9JzwzGW2bmmXVQy2Ksxx6a1o3GKpLfQYrK6KXznz5U",
        blockTime: 1_710_000_000,
        eventName: "AddressBlacklisted",
        data: {
          config: new PublicKey("11111111111111111111111111111111"),
          address: new PublicKey("So11111111111111111111111111111111111111112"),
          blacklistedBy: new PublicKey("4Nd1mY4bP9RTpV1ZVYzX4t1f34Fq3KZgY7uTW6R1YB3R"),
          amount: new BN(42),
          reason: "Manual review",
        },
      });

      expect(record.action).to.equal("blacklist.add");
      expect(record.severity).to.equal("critical");
      expect(record.status).to.equal("restricted");
      expect(record.targetAddress).to.equal("So11111111111111111111111111111111111111112");
      expect(record.authority).to.equal("4Nd1mY4bP9RTpV1ZVYzX4t1f34Fq3KZgY7uTW6R1YB3R");
      expect(record.details.amount).to.equal("42");
    });

    it("renders newline-delimited json without wrapper objects", () => {
      const jsonl = formatAuditRecordsAsJsonl([
        {
          timestamp: "2026-03-12T10:00:00.000Z",
          unixTimestamp: 1_710_000_000,
          eventType: "TokensMinted",
          action: "mint",
          status: "confirmed",
          severity: "success",
          authority: "11111111111111111111111111111111",
          targetAddress: "So11111111111111111111111111111111111111112",
          targetMint: null,
          configAddress: "11111111111111111111111111111111",
          signature: "5JtW4LT9JzwzGW2bmmXVQy2Ksxx6a1o3GKpLfQYrK6KXznz5U",
          details: { amount: "1000" },
        },
      ]);

      const lines = jsonl.split("\n");
      expect(lines).to.have.length(1);
      expect(JSON.parse(lines[0])).to.have.property("eventType", "TokensMinted");
    });
  });

  describe("Webhook Tooling", () => {
    it("includes webhook verification help", () => {
      const output = runCli("webhook verify --help");
      expect(output).to.include("X-SSS-Signature");
      expect(output).to.include("--secret");
      expect(output).to.include("--payload-file");
    });

    it("verifies a matching webhook signature", () => {
      const payload = "{\"event_type\":\"TokensMinted\"}";
      const signature = `sha256=${createHmac("sha256", "shared-secret")
        .update(payload)
        .digest("hex")}`;
      const result = verifyWebhookSignature(
        "shared-secret",
        payload,
        signature
      );
      expect(result.valid).to.equal(true);
      expect(result.expected).to.equal(signature);
    });
  });
});
