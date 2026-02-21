import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  Program,
  AnchorProvider,
  BN,
  Idl,
  Wallet,
} from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  getConfigAddress,
  getRoleAddress,
  getMinterQuotaAddress,
  getBlacklistEntryAddress,
} from "./pda";
import {
  StablecoinConfig,
  RoleType,
  CreateStablecoinParams,
  MintParams,
  BurnParams,
  FreezeParams,
  ThawParams,
  PauseParams,
  UpdateRolesParams,
  UpdateMinterParams,
  TransferAuthorityParams,
  BlacklistAddParams,
  BlacklistRemoveParams,
  SeizeParams,
  BlacklistEntry,
  MinterQuota as MinterQuotaType,
} from "./types";
import {
  getAssociatedTokenAddress,
  getMintSupply,
  accountExists,
} from "./utils";

// ---------------------------------------------------------------------------
// IDL import — the Anchor-generated IDL for the SSS program
// ---------------------------------------------------------------------------
import sssIdl from "../../../target/idl/sss.json";

// ---------------------------------------------------------------------------
// Program IDs
// ---------------------------------------------------------------------------
const SSS_PROGRAM_ID = new PublicKey(
  "7CPH4PAWa9n4rizL8UGDi7h361NU5jMWGX7VjSBydgjd"
);
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "5UNDXpv8wM8beDKhW7Q7nTX7jtpVvTS5ECLxGHiYX4oV"
);

// ---------------------------------------------------------------------------
// ComplianceModule — nested module for SSS-2 compliance operations
// ---------------------------------------------------------------------------

/**
 * Provides compliance-specific operations (blacklisting, seizure).
 * Accessible via `stablecoin.compliance`.
 */
export class ComplianceModule {
  constructor(
    private readonly program: Program,
    private readonly connection: Connection,
    private readonly mint: PublicKey,
    private readonly configAddress: PublicKey
  ) {}

  /**
   * Add an address to the blacklist.
   *
   * @param params - BlacklistAddParams
   * @returns TransactionInstruction to include in a transaction
   */
  async blacklistAdd(
    params: BlacklistAddParams
  ): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Blacklister,
      params.authority
    );
    const [blacklistEntry] = getBlacklistEntryAddress(
      this.program.programId,
      this.configAddress,
      params.address
    );

    return await this.program.methods
      .addToBlacklist(params.address, params.reason)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
        blacklistEntry,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Remove an address from the blacklist.
   *
   * @param params - BlacklistRemoveParams
   * @returns TransactionInstruction to include in a transaction
   */
  async blacklistRemove(
    params: BlacklistRemoveParams
  ): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Blacklister,
      params.authority
    );
    const [blacklistEntry] = getBlacklistEntryAddress(
      this.program.programId,
      this.configAddress,
      params.address
    );

    return await this.program.methods
      .removeFromBlacklist(params.address)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
        blacklistEntry,
      })
      .instruction();
  }

  /**
   * Seize tokens from an account using the permanent delegate.
   *
   * @param params - SeizeParams
   * @returns TransactionInstruction to include in a transaction
   */
  async seize(params: SeizeParams): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Seizer,
      params.authority
    );

    return await this.program.methods
      .seize(params.amount)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
        mint: this.mint,
        fromTokenAccount: params.fromTokenAccount,
        toTokenAccount: params.toTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Check whether an address is currently blacklisted.
   *
   * @param address - The address to check
   * @returns true if a BlacklistEntry PDA exists for this address
   */
  async isBlacklisted(address: PublicKey): Promise<boolean> {
    const [blacklistEntry] = getBlacklistEntryAddress(
      this.program.programId,
      this.configAddress,
      address
    );
    return accountExists(this.connection, blacklistEntry);
  }

  /**
   * Fetch all blacklist entries for this stablecoin.
   *
   * @returns Array of BlacklistEntry account data
   */
  async getBlacklist(): Promise<BlacklistEntry[]> {
    const accounts = await (this.program.account as any).blacklistEntry.all([
      {
        memcmp: {
          offset: 8, // skip discriminator
          bytes: this.configAddress.toBase58(),
        },
      },
    ]);
    return accounts.map((a: any) => a.account as unknown as BlacklistEntry);
  }

  /**
   * Fetch a single blacklist entry for a given address.
   *
   * @param address - The address to look up
   * @returns BlacklistEntry data, or null if not blacklisted
   */
  async getBlacklistEntry(address: PublicKey): Promise<BlacklistEntry | null> {
    const [blacklistEntry] = getBlacklistEntryAddress(
      this.program.programId,
      this.configAddress,
      address
    );
    try {
      const data = await (this.program.account as any).blacklistEntry.fetch(
        blacklistEntry
      );
      return data as unknown as BlacklistEntry;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// SolanaStablecoin — main SDK entry point
// ---------------------------------------------------------------------------

/**
 * High-level SDK for interacting with a Solana Stablecoin Standard stablecoin.
 *
 * Use the static factory methods to instantiate:
 * - `SolanaStablecoin.create(connection, params)` — create a new stablecoin
 * - `SolanaStablecoin.load(connection, mintAddress)` — load an existing one
 */
export class SolanaStablecoin {
  /** The Anchor Program instance for the SSS program. */
  public readonly program: Program;
  /** The Token-2022 mint address. */
  public readonly mintAddress: PublicKey;
  /** The StablecoinConfig PDA address. */
  public readonly configAddress: PublicKey;
  /** The config PDA bump. */
  public readonly configBump: number;
  /** SSS-2 compliance module (blacklist, seize). */
  public readonly compliance: ComplianceModule;

  private readonly connection: Connection;

  // -------------------------------------------------------------------
  // Private constructor — use factory methods instead
  // -------------------------------------------------------------------

  private constructor(
    connection: Connection,
    program: Program,
    mint: PublicKey,
    configAddress: PublicKey,
    configBump: number
  ) {
    this.connection = connection;
    this.program = program;
    this.mintAddress = mint;
    this.configAddress = configAddress;
    this.configBump = configBump;
    this.compliance = new ComplianceModule(
      program,
      connection,
      mint,
      configAddress
    );
  }

  // -------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------

  /**
   * Build an Anchor Program instance for the SSS program connected to
   * the given RPC.
   */
  private static buildProgram(connection: Connection): Program {
    // Create a read-only provider (no wallet needed for instruction building)
    const dummyWallet: Wallet = {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any) => txs,
      payer: Keypair.generate(),
    };
    const provider = new AnchorProvider(
      connection,
      dummyWallet,
      AnchorProvider.defaultOptions()
    );
    return new Program(sssIdl as Idl, provider);
  }

  // -------------------------------------------------------------------
  // Factory methods
  // -------------------------------------------------------------------

  /**
   * Create a new stablecoin. Returns instructions + the mint keypair that
   * must be signed.
   *
   * @param connection - Solana RPC connection
   * @param params     - Creation parameters
   * @returns Object containing:
   *   - `stablecoin` — the loaded SolanaStablecoin instance
   *   - `mintKeypair` — the mint Keypair (must be a signer)
   *   - `instruction` — the initialize TransactionInstruction
   */
  static async create(
    connection: Connection,
    params: CreateStablecoinParams
  ): Promise<{
    stablecoin: SolanaStablecoin;
    mintKeypair: Keypair;
    instruction: TransactionInstruction;
  }> {
    const program = SolanaStablecoin.buildProgram(connection);
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;

    const [configAddress, configBump] = getConfigAddress(
      program.programId,
      mint
    );

    const initParams = {
      name: params.name,
      symbol: params.symbol,
      uri: params.uri,
      decimals: params.decimals,
      enablePermanentDelegate: params.enablePermanentDelegate,
      enableTransferHook: params.enableTransferHook,
      defaultAccountFrozen: params.defaultAccountFrozen,
      transferHookProgramId: params.transferHookProgramId ?? null,
    };

    const instruction = await program.methods
      .initialize(initParams)
      .accountsStrict({
        authority: params.authority,
        config: configAddress,
        mint: mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    const stablecoin = new SolanaStablecoin(
      connection,
      program,
      mint,
      configAddress,
      configBump
    );

    return { stablecoin, mintKeypair, instruction };
  }

  /**
   * Load an existing stablecoin by its mint address.
   *
   * @param connection  - Solana RPC connection
   * @param mintAddress - The Token-2022 mint pubkey
   * @returns A SolanaStablecoin instance
   */
  static async load(
    connection: Connection,
    mintAddress: PublicKey
  ): Promise<SolanaStablecoin> {
    const program = SolanaStablecoin.buildProgram(connection);
    const [configAddress, configBump] = getConfigAddress(
      program.programId,
      mintAddress
    );

    // Verify the config account exists
    const configAccount = await (program.account as any).stablecoinConfig.fetch(
      configAddress
    );
    if (!configAccount) {
      throw new Error(
        `StablecoinConfig not found for mint ${mintAddress.toBase58()}`
      );
    }

    return new SolanaStablecoin(
      connection,
      program,
      mintAddress,
      configAddress,
      configBump
    );
  }

  // -------------------------------------------------------------------
  // Read methods
  // -------------------------------------------------------------------

  /**
   * Fetch the current StablecoinConfig state.
   */
  async getConfig(): Promise<StablecoinConfig> {
    const data = await (this.program.account as any).stablecoinConfig.fetch(
      this.configAddress
    );
    return data as unknown as StablecoinConfig;
  }

  /**
   * Fetch the current circulating supply of the stablecoin.
   */
  async getSupply(): Promise<{
    amount: string;
    decimals: number;
    uiAmount: number | null;
  }> {
    return getMintSupply(this.connection, this.mintAddress);
  }

  /**
   * Fetch a MinterQuota account.
   *
   * @param minter - The minter's pubkey
   * @returns MinterQuota data or null if not found
   */
  async getMinterQuota(minter: PublicKey): Promise<MinterQuotaType | null> {
    const [quotaAddress] = getMinterQuotaAddress(
      this.program.programId,
      this.configAddress,
      minter
    );
    try {
      const data = await (this.program.account as any).minterQuota.fetch(quotaAddress);
      return data as unknown as MinterQuotaType;
    } catch {
      return null;
    }
  }

  /**
   * Fetch a RoleAccount.
   *
   * @param roleType - The role type
   * @param user     - The user's pubkey
   * @returns RoleAccount data or null if not found
   */
  async getRole(
    roleType: RoleType,
    user: PublicKey
  ): Promise<{
    config: PublicKey;
    user: PublicKey;
    roleType: number;
    active: boolean;
    bump: number;
  } | null> {
    const [roleAddress] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      roleType,
      user
    );
    try {
      const data = await (this.program.account as any).roleAccount.fetch(roleAddress);
      return data as unknown as {
        config: PublicKey;
        user: PublicKey;
        roleType: number;
        active: boolean;
        bump: number;
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------
  // Write methods — return TransactionInstructions
  // -------------------------------------------------------------------

  /**
   * Build a mint_tokens instruction.
   *
   * @param params - MintParams
   * @returns TransactionInstruction
   */
  async mint(params: MintParams): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Minter,
      params.minter
    );
    const [minterQuota] = getMinterQuotaAddress(
      this.program.programId,
      this.configAddress,
      params.minter
    );

    return await this.program.methods
      .mintTokens(params.amount)
      .accountsStrict({
        minter: params.minter,
        config: this.configAddress,
        roleAccount,
        minterQuota,
        mint: this.mintAddress,
        recipientTokenAccount: params.recipientTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a burn_tokens instruction.
   *
   * @param params - BurnParams
   * @returns TransactionInstruction
   */
  async burn(params: BurnParams): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Burner,
      params.burner
    );

    return await this.program.methods
      .burnTokens(params.amount)
      .accountsStrict({
        burner: params.burner,
        config: this.configAddress,
        roleAccount,
        mint: this.mintAddress,
        fromTokenAccount: params.fromTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a freeze_token_account instruction.
   *
   * @param params - FreezeParams
   * @returns TransactionInstruction
   */
  async freeze(params: FreezeParams): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Pauser,
      params.authority
    );

    return await this.program.methods
      .freezeTokenAccount()
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
        mint: this.mintAddress,
        tokenAccount: params.tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a thaw_token_account instruction.
   *
   * @param params - ThawParams
   * @returns TransactionInstruction
   */
  async thaw(params: ThawParams): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Pauser,
      params.authority
    );

    return await this.program.methods
      .thawTokenAccount()
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
        mint: this.mintAddress,
        tokenAccount: params.tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * Build a pause instruction.
   *
   * @param params - PauseParams
   * @returns TransactionInstruction
   */
  async pause(params: PauseParams): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Pauser,
      params.authority
    );

    return await this.program.methods
      .pause()
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
      })
      .instruction();
  }

  /**
   * Build an unpause instruction.
   *
   * @param params - PauseParams
   * @returns TransactionInstruction
   */
  async unpause(params: PauseParams): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      RoleType.Pauser,
      params.authority
    );

    return await this.program.methods
      .unpause()
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
      })
      .instruction();
  }

  /**
   * Build an update_roles instruction.
   *
   * @param params - UpdateRolesParams
   * @returns TransactionInstruction
   */
  async updateRoles(
    params: UpdateRolesParams
  ): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      params.roleType,
      params.user
    );

    return await this.program.methods
      .updateRoles(params.roleType, params.user, params.active)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build an update_minter instruction.
   *
   * @param params - UpdateMinterParams
   * @returns TransactionInstruction
   */
  async updateMinter(
    params: UpdateMinterParams
  ): Promise<TransactionInstruction> {
    const [minterQuota] = getMinterQuotaAddress(
      this.program.programId,
      this.configAddress,
      params.minter
    );

    return await this.program.methods
      .updateMinter(params.minter, params.quota)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        minterQuota,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build a transfer_authority instruction.
   *
   * @param params - TransferAuthorityParams
   * @returns TransactionInstruction
   */
  async transferAuthority(
    params: TransferAuthorityParams
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .transferAuthority(params.newAuthority)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
      })
      .instruction();
  }

  // -------------------------------------------------------------------
  // Convenience: get the ATA for a given owner
  // -------------------------------------------------------------------

  /**
   * Get the associated token account address for a given owner.
   *
   * @param owner - The wallet address
   * @returns The ATA public key
   */
  getTokenAccount(owner: PublicKey): PublicKey {
    return getAssociatedTokenAddress(this.mintAddress, owner);
  }
}
