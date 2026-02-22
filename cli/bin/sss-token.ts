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

const program = new Command();

program
  .name("sss-token")
  .description("Solana Stablecoin Standard CLI — manage SSS-1 and SSS-2 stablecoins")
  .version("0.1.0")
  .option("-k, --keypair <path>", "Path to keypair file", "~/.config/solana/id.json")
  .option("-u, --rpc <url>", "RPC URL", "http://localhost:8899")
  .option("-c, --config <address>", "Stablecoin config address (overrides .sss-token.json)");

registerInitCommand(program);
registerMintCommand(program);
registerBurnCommand(program);
registerFreezeCommand(program);
registerPauseCommand(program);
registerStatusCommand(program);
registerBlacklistCommand(program);
registerSeizeCommand(program);
registerMintersCommand(program);
registerRolesCommand(program);
registerHoldersCommand(program);
registerAuditLogCommand(program);

program.parse(process.argv);
