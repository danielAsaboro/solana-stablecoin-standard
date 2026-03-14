#!/usr/bin/env npx ts-node

import { Command } from "commander";
import { registerInitCommand } from "../src/commands/init";
import { registerMintCommand } from "../src/commands/mint";
import { registerBurnCommand } from "../src/commands/burn";
import { registerFreezeCommand } from "../src/commands/freeze";
import { registerPauseCommand } from "../src/commands/pause";
import { registerStatusCommand } from "../src/commands/status";
import { registerBlacklistCommand } from "../src/commands/blacklist";
import { registerSeizeCommand } from "../src/commands/seize";
import { registerMintersCommand } from "../src/commands/minters";
import { registerRolesCommand } from "../src/commands/roles";
import { registerHoldersCommand } from "../src/commands/holders";
import { registerAuditLogCommand } from "../src/commands/audit-log";
import { registerConfigCommand } from "../src/commands/config";
import { registerWebhookCommand } from "../src/commands/webhook";
import { registerAuthorityCommand } from "../src/commands/authority";

const program = new Command();

program
  .name("sss-token")
  .description("Solana Stablecoin Standard CLI — manage SSS-1 and SSS-2 stablecoins")
  .version("0.1.0")
  .option("-k, --keypair <path>", "Path to keypair file (default: ~/.config/solana/id.json)")
  .option("-u, --rpc <url>", "RPC URL", "http://localhost:8899")
  .option("-c, --config <path>", "Path to the CLI config file (defaults to .sss-token.json)")
  .option("-p, --profile <name>", "Named config profile to use")
  .option(
    "-o, --output <format>",
    "Output format: table, json, csv (audit-log also accepts jsonl)",
    "table"
  )
  .option("--dry-run", "Preview the action without submitting a transaction")
  .option("-y, --yes", "Skip interactive confirmations when supported");

registerConfigCommand(program);
registerWebhookCommand(program);
registerInitCommand(program);
registerMintCommand(program);
registerBurnCommand(program);
registerFreezeCommand(program);
registerPauseCommand(program);
registerStatusCommand(program);
registerBlacklistCommand(program);
registerSeizeCommand(program);
registerAuthorityCommand(program);
registerMintersCommand(program);
registerRolesCommand(program);
registerHoldersCommand(program);
registerAuditLogCommand(program);

program.parse(process.argv);
