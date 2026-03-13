import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  loadSssProgram,
  deriveRolePDA,
  parseRoleType,
  roleName,
  SSS_PROGRAM_ID,
  ROLE_MINTER,
  ROLE_BURNER,
  ROLE_PAUSER,
  ROLE_BLACKLISTER,
  ROLE_SEIZER,
} from "../helpers";
import {
  spin,
  infoMsg,
  errorMsg,
  getOutputFormat,
  isDryRun,
  printCsv,
  printDryRunPlan,
  printJson,
  printTxResult,
  printHeader,
  printField,
  printDivider,
} from "../output";

export function registerRolesCommand(program: Command): void {
  const roles = program
    .command("roles")
    .description("Manage roles (master authority only)");

  roles
    .command("add")
    .description("Assign a role to an address")
    .argument("<role>", "Role type: minter, burner, pauser, blacklister, seizer")
    .argument("<address>", "Wallet address to assign the role to")
    .action(async (role: string, address: string) => {
      try {
        await handleRolesUpdate(role, address, true, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  roles
    .command("remove")
    .description("Revoke a role from an address")
    .argument("<role>", "Role type: minter, burner, pauser, blacklister, seizer")
    .argument("<address>", "Wallet address to revoke the role from")
    .action(async (role: string, address: string) => {
      try {
        await handleRolesUpdate(role, address, false, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });

  roles
    .command("list")
    .description("Check roles for a specific address")
    .argument("<address>", "Wallet address to check")
    .action(async (address: string) => {
      try {
        await handleRolesList(address, program.opts());
      } catch (err: any) {
        errorMsg((err as Error).message || String(err));
      }
    });
}

async function handleRolesUpdate(
  roleStr: string,
  addressStr: string,
  active: boolean,
  globalOpts: any
): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const configPDA = new PublicKey(sssConfig.configAddress);
  const userPubkey = new PublicKey(addressStr);
  const roleType = parseRoleType(roleStr);

  const [rolePDA] = deriveRolePDA(configPDA, roleType, userPubkey);

  if (isDryRun(globalOpts)) {
    printDryRunPlan(globalOpts, "roles.update", {
      role: roleName(roleType),
      user: userPubkey.toBase58(),
      active,
      config: configPDA.toBase58(),
    });
    return;
  }

  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const action = active ? "Assigning" : "Revoking";
  infoMsg(`${action} ${roleName(roleType)} role ${active ? "to" : "from"} ${userPubkey.toBase58()}...`);

  const program = await loadSssProgram(provider);

  const spinner = spin("Sending role update transaction...");

  let tx: string;
  try {
    tx = await program.methods
      .updateRoles(roleType, userPubkey, active)
      .accounts({
        authority: keypair.publicKey,
        config: configPDA,
        roleAccount: rolePDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } catch (err) {
    spinner.fail("Role update failed");
    throw err;
  }

  spinner.succeed(`Role ${active ? "assigned" : "revoked"}!`);
  printTxResult(tx, connection.rpcEndpoint, [["Transaction", tx], ["Role", roleName(roleType)], ["User", userPubkey.toBase58()], ["Active", active ? "YES" : "NO"]]);
}

async function handleRolesList(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config, globalOpts.profile);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const userPubkey = new PublicKey(addressStr);

  const program = await loadSssProgram(provider);

  const spinner = spin("Fetching roles...");

  const allRoles = [ROLE_MINTER, ROLE_BURNER, ROLE_PAUSER, ROLE_BLACKLISTER, ROLE_SEIZER];

  const results: Array<{ rt: number; status: string }> = [];
  for (const rt of allRoles) {
    const [rolePDA] = deriveRolePDA(configPDA, rt, userPubkey);
    try {
      const roleAcct = await (program.account as any).roleAccount.fetch(rolePDA);
      const status = roleAcct.active ? chalk.green("ACTIVE") : chalk.red("INACTIVE");
      results.push({ rt, status });
    } catch {
      results.push({ rt, status: chalk.gray("NOT ASSIGNED") });
    }
  }

  const rolePayload = results.map(({ rt, status }) => ({
    address: userPubkey.toBase58(),
    role: roleName(rt),
    status: status.replace(/\u001b\[[0-9;]*m/g, ""),
  }));

  const outputFormat = getOutputFormat(globalOpts);
  if (outputFormat === "json") {
    printJson({
      address: userPubkey.toBase58(),
      roles: rolePayload,
    });
    return;
  }
  if (outputFormat === "csv") {
    printCsv(rolePayload, [
      { header: "address", value: (row) => row.address },
      { header: "role", value: (row) => row.role },
      { header: "status", value: (row) => row.status },
    ]);
    return;
  }

  spinner.stop();
  printHeader(`Roles for ${userPubkey.toBase58()}`);
  for (const { rt, status } of results) {
    printField(roleName(rt), status);
  }
  console.log();
}
