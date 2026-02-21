import { Command } from "commander";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import chalk from "chalk";
import {
  loadKeypair,
  getConnection,
  loadConfig,
  deriveRolePDA,
  success,
  info,
  error as logError,
  parseRoleType,
  roleName,
  SSS_PROGRAM_ID,
  ROLE_MINTER,
  ROLE_BURNER,
  ROLE_PAUSER,
  ROLE_BLACKLISTER,
  ROLE_SEIZER,
} from "../helpers";

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
        logError(err.message || err.toString());
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
        logError(err.message || err.toString());
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
        logError(err.message || err.toString());
      }
    });
}

async function handleRolesUpdate(
  roleStr: string,
  addressStr: string,
  active: boolean,
  globalOpts: any
): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const userPubkey = new PublicKey(addressStr);
  const roleType = parseRoleType(roleStr);

  const [rolePDA] = deriveRolePDA(configPDA, roleType, userPubkey);

  const action = active ? "Assigning" : "Revoking";
  info(`${action} ${roleName(roleType)} role ${active ? "to" : "from"} ${userPubkey.toBase58()}...`);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  const tx = await program.methods
    .updateRoles(roleType, userPubkey, active)
    .accounts({
      authority: keypair.publicKey,
      config: configPDA,
      roleAccount: rolePDA,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  success(`Role ${active ? "assigned" : "revoked"}!`);
  console.log(chalk.cyan("  Transaction:"), tx);
  console.log(chalk.cyan("  Role:       "), roleName(roleType));
  console.log(chalk.cyan("  User:       "), userPubkey.toBase58());
  console.log(chalk.cyan("  Active:     "), active ? chalk.green("YES") : chalk.red("NO"));
}

async function handleRolesList(addressStr: string, globalOpts: any): Promise<void> {
  const sssConfig = loadConfig(globalOpts.config);
  const keypair = loadKeypair(globalOpts.keypair);
  const connection = getConnection(globalOpts.rpc || sssConfig.rpcUrl);
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const configPDA = new PublicKey(sssConfig.configAddress);
  const userPubkey = new PublicKey(addressStr);

  const idl = await anchor.Program.fetchIdl(SSS_PROGRAM_ID, provider);
  if (!idl) {
    logError("Could not fetch IDL.");
    return;
  }
  const program = new anchor.Program(idl, provider);

  console.log(chalk.bold(`\n  Roles for ${userPubkey.toBase58()}`));
  console.log(chalk.gray("  " + "-".repeat(50)));

  const allRoles = [ROLE_MINTER, ROLE_BURNER, ROLE_PAUSER, ROLE_BLACKLISTER, ROLE_SEIZER];

  for (const rt of allRoles) {
    const [rolePDA] = deriveRolePDA(configPDA, rt, userPubkey);
    try {
      const roleAcct = await (program.account as any).roleAccount.fetch(rolePDA);
      const status = roleAcct.active ? chalk.green("ACTIVE") : chalk.red("INACTIVE");
      console.log(`  ${chalk.cyan(roleName(rt).padEnd(15))} ${status}`);
    } catch {
      console.log(`  ${chalk.cyan(roleName(rt).padEnd(15))} ${chalk.gray("NOT ASSIGNED")}`);
    }
  }
  console.log();
}
