import { Command } from "commander";
import { PublicKey } from "@solana/web3.js";
import {
  configExists,
  listConfigProfiles,
  loadConfig,
  resolveConfigPath,
  saveConfig,
  setActiveProfile,
  type SssTokenConfig,
} from "../helpers";
import {
  errorMsg,
  getOutputFormat,
  printCsv,
  printField,
  printHeader,
  printJson,
} from "../output";

interface ConfigRow extends SssTokenConfig {
  path: string;
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Inspect or manage the local CLI config file");

  config
    .command("show")
    .description("Show the current CLI config")
    .action(() => {
      try {
        handleConfigShow(program.opts() as Record<string, string>);
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });

  config
    .command("path")
    .description("Print the resolved CLI config path")
    .action(() => {
      try {
        handleConfigPath(program.opts() as Record<string, string>);
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });

  config
    .command("profiles")
    .description("List named config profiles")
    .action(() => {
      try {
        handleConfigProfiles(program.opts() as Record<string, string>);
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });

  config
    .command("use")
    .description("Set the active config profile")
    .argument("<name>", "Profile name")
    .action((name: string) => {
      try {
        handleConfigUse(program.opts() as Record<string, string>, name);
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });

  config
    .command("set")
    .description("Write or update the local CLI config")
    .requiredOption("--mint <address>", "Token-2022 mint address")
    .requiredOption("--config-address <address>", "Stablecoin config PDA address")
    .requiredOption("--preset <preset>", "Preset label, e.g. SSS-1 or SSS-2")
    .option("--rpc-url <url>", "RPC URL to store in the config")
    .option("--profile <name>", "Profile name to write")
    .action((opts: {
      mint: string;
      configAddress: string;
      preset: string;
      rpcUrl?: string;
      profile?: string;
    }) => {
      try {
        handleConfigSet(program.opts() as Record<string, string>, opts);
      } catch (err: unknown) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

function handleConfigShow(globalOpts: Record<string, string>): void {
  const path = resolveConfigPath(globalOpts.config);
  const config = loadConfig(globalOpts.config, globalOpts.profile);
  const row: ConfigRow = {
    ...config,
    path,
  };

  const outputFormat = getOutputFormat(globalOpts);
  if (outputFormat === "json") {
    printJson(row);
    return;
  }
  if (outputFormat === "csv") {
    printCsv<ConfigRow>([row], [
      { header: "path", value: (item) => item.path },
      { header: "config_address", value: (item) => item.configAddress },
      { header: "mint_address", value: (item) => item.mintAddress },
      { header: "rpc_url", value: (item) => item.rpcUrl },
      { header: "preset", value: (item) => item.preset },
    ]);
    return;
  }

  printHeader("CLI Config");
  printField("Path", row.path);
  printField("Config PDA", row.configAddress);
  printField("Mint", row.mintAddress);
  printField("RPC URL", row.rpcUrl);
  printField("Preset", row.preset);
  console.log();
}

function handleConfigPath(globalOpts: Record<string, string>): void {
  const path = resolveConfigPath(globalOpts.config);
  const payload = {
    path,
    exists: configExists(globalOpts.config),
  };

  const outputFormat = getOutputFormat(globalOpts);
  if (outputFormat === "json") {
    printJson(payload);
    return;
  }
  if (outputFormat === "csv") {
    printCsv([payload], [
      { header: "path", value: (item) => item.path },
      { header: "exists", value: (item) => item.exists },
    ]);
    return;
  }

  console.log(path);
}

function handleConfigSet(
  globalOpts: Record<string, string>,
  opts: {
    mint: string;
    configAddress: string;
    preset: string;
    rpcUrl?: string;
    profile?: string;
  }
): void {
  const path = resolveConfigPath(globalOpts.config);
  new PublicKey(opts.mint);
  new PublicKey(opts.configAddress);

  const nextConfig: SssTokenConfig = {
    mintAddress: opts.mint,
    configAddress: opts.configAddress,
    rpcUrl: opts.rpcUrl || globalOpts.rpc || "http://localhost:8899",
    preset: opts.preset,
  };

  saveConfig(nextConfig, globalOpts.config, opts.profile || globalOpts.profile);

  const payload: ConfigRow = {
    ...nextConfig,
    path,
  };

  const outputFormat = getOutputFormat(globalOpts);
  if (outputFormat === "json") {
    printJson(payload);
    return;
  }
  if (outputFormat === "csv") {
    printCsv<ConfigRow>([payload], [
      { header: "path", value: (item) => item.path },
      { header: "config_address", value: (item) => item.configAddress },
      { header: "mint_address", value: (item) => item.mintAddress },
      { header: "rpc_url", value: (item) => item.rpcUrl },
      { header: "preset", value: (item) => item.preset },
    ]);
    return;
  }

  printHeader("Config Saved");
  printField("Path", payload.path);
  printField("Config PDA", payload.configAddress);
  printField("Mint", payload.mintAddress);
  printField("RPC URL", payload.rpcUrl);
  printField("Preset", payload.preset);
  console.log();
}

function handleConfigProfiles(globalOpts: Record<string, string>): void {
  const data = listConfigProfiles(globalOpts.config);
  const rows = Object.entries(data.profiles).map(([name, profile]) => ({
    name,
    active: data.activeProfile === name,
    ...profile,
  }));

  const outputFormat = getOutputFormat(globalOpts);
  if (outputFormat === "json") {
    printJson({
      path: data.path,
      activeProfile: data.activeProfile,
      profiles: rows,
    });
    return;
  }
  if (outputFormat === "csv") {
    printCsv(rows, [
      { header: "name", value: (item) => item.name },
      { header: "active", value: (item) => item.active },
      { header: "config_address", value: (item) => item.configAddress },
      { header: "mint_address", value: (item) => item.mintAddress },
      { header: "rpc_url", value: (item) => item.rpcUrl },
      { header: "preset", value: (item) => item.preset },
    ]);
    return;
  }

  printHeader("Config Profiles");
  printField("Path", data.path);
  for (const row of rows) {
    printField(row.active ? `* ${row.name}` : row.name, `${row.preset}  ${row.mintAddress}`);
  }
  console.log();
}

function handleConfigUse(globalOpts: Record<string, string>, profileName: string): void {
  setActiveProfile(globalOpts.config, profileName);

  const payload = {
    path: resolveConfigPath(globalOpts.config),
    activeProfile: profileName,
  };

  const outputFormat = getOutputFormat(globalOpts);
  if (outputFormat === "json") {
    printJson(payload);
    return;
  }
  if (outputFormat === "csv") {
    printCsv([payload], [
      { header: "path", value: (item) => item.path },
      { header: "active_profile", value: (item) => item.activeProfile },
    ]);
    return;
  }

  printHeader("Active Profile Updated");
  printField("Path", payload.path);
  printField("Active Profile", payload.activeProfile);
  console.log();
}
