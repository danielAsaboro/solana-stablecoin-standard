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
import {
  type BuilderContext,
  MintBuilder,
  BurnBuilder,
  FreezeBuilder,
  ThawBuilder,
  PauseBuilder,
  UpdateRolesBuilder,
  UpdateMinterBuilder,
  TransferAuthorityBuilder,
  BlacklistAddBuilder,
  BlacklistRemoveBuilder,
  SeizeBuilder,
} from "./builder";
import {
  BatchBuilder,
  BatchMintBuilder,
  BatchBurnBuilder,
  BatchFreezeBuilder,
  BatchThawBuilder,
  BatchBlacklistAddBuilder,
  BatchBlacklistRemoveBuilder,
  type BatchMintEntry,
  type BatchBurnEntry,
  type BatchBlacklistEntry,
} from "./batch";

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

  /** @internal Create a BuilderContext from this module's state. */
  private builderCtx(): BuilderContext {
    return {
      program: this.program,
      mintAddress: this.mint,
      configAddress: this.configAddress,
    };
  }

  /**
   * Add an address to the blacklist.
   *
   * **Overloaded:**
   * - `blacklistAdd(params)` — returns a TransactionInstruction (original API)
   * - `blacklistAdd(address)` — returns a {@link BlacklistAddBuilder} (fluent API)
   *
   * @example
   * ```ts
   * // Fluent API
   * await stablecoin.compliance.blacklistAdd(suspectAddress)
   *   .reason("OFAC SDN match")
   *   .by(blacklisterKeypair)
   *   .send(payerKeypair);
   *
   * // Original API
   * const ix = await stablecoin.compliance.blacklistAdd({
   *   address: suspect, reason: "OFAC", authority: blacklister,
   * });
   * ```
   */
  blacklistAdd(params: BlacklistAddParams): Promise<TransactionInstruction>;
  blacklistAdd(address: PublicKey): BlacklistAddBuilder;
  blacklistAdd(
    paramsOrAddress: BlacklistAddParams | PublicKey
  ): Promise<TransactionInstruction> | BlacklistAddBuilder {
    if (paramsOrAddress instanceof PublicKey) {
      return new BlacklistAddBuilder(this.builderCtx(), paramsOrAddress);
    }
    return this._blacklistAddImpl(paramsOrAddress);
  }

  private async _blacklistAddImpl(
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
   * **Overloaded:**
   * - `blacklistRemove(params)` — returns a TransactionInstruction
   * - `blacklistRemove(address)` — returns a {@link BlacklistRemoveBuilder}
   */
  blacklistRemove(params: BlacklistRemoveParams): Promise<TransactionInstruction>;
  blacklistRemove(address: PublicKey): BlacklistRemoveBuilder;
  blacklistRemove(
    paramsOrAddress: BlacklistRemoveParams | PublicKey
  ): Promise<TransactionInstruction> | BlacklistRemoveBuilder {
    if (paramsOrAddress instanceof PublicKey) {
      return new BlacklistRemoveBuilder(this.builderCtx(), paramsOrAddress);
    }
    return this._blacklistRemoveImpl(paramsOrAddress);
  }

  private async _blacklistRemoveImpl(
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
   * **Overloaded:**
   * - `seize(params)` — returns a TransactionInstruction
   * - `seize(amount)` — returns a {@link SeizeBuilder}
   *
   * @example
   * ```ts
   * await stablecoin.compliance.seize(1_000_000)
   *   .from(blacklistedWallet)
   *   .to(treasuryWallet)
   *   .by(seizerKeypair)
   *   .send(payerKeypair);
   * ```
   */
  seize(params: SeizeParams): Promise<TransactionInstruction>;
  seize(amount: number | BN): SeizeBuilder;
  seize(
    paramsOrAmount: SeizeParams | number | BN
  ): Promise<TransactionInstruction> | SeizeBuilder {
    if (typeof paramsOrAmount === "number" || BN.isBN(paramsOrAmount)) {
      return new SeizeBuilder(
        this.builderCtx(),
        new BN(paramsOrAmount.toString())
      );
    }
    return this._seizeImpl(paramsOrAmount);
  }

  private async _seizeImpl(
    params: SeizeParams
  ): Promise<TransactionInstruction> {
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

  // -------------------------------------------------------------------
  // Batch compliance operations
  // -------------------------------------------------------------------

  /**
   * Batch-add multiple addresses to the blacklist in one transaction.
   *
   * @example
   * ```ts
   * await stablecoin.compliance.batchBlacklistAdd([
   *   { address: alice, reason: "OFAC SDN match" },
   *   { address: bob, reason: "Suspicious activity" },
   * ])
   *   .by(blacklisterKeypair)
   *   .send(payerKeypair);
   * ```
   *
   * @param entries - Array of addresses + reasons to blacklist
   * @returns A {@link BatchBlacklistAddBuilder}
   */
  batchBlacklistAdd(entries: BatchBlacklistEntry[]): BatchBlacklistAddBuilder {
    return new BatchBlacklistAddBuilder(this.builderCtx(), entries);
  }

  /**
   * Batch-remove multiple addresses from the blacklist in one transaction.
   *
   * @example
   * ```ts
   * await stablecoin.compliance.batchBlacklistRemove([alice, bob])
   *   .by(blacklisterKeypair)
   *   .send(payerKeypair);
   * ```
   *
   * @param addresses - Array of addresses to remove
   * @returns A {@link BatchBlacklistRemoveBuilder}
   */
  batchBlacklistRemove(addresses: PublicKey[]): BatchBlacklistRemoveBuilder {
    return new BatchBlacklistRemoveBuilder(this.builderCtx(), addresses);
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
   * Build a mint_tokens instruction, or start a fluent {@link MintBuilder}.
   *
   * **Overloaded:**
   * - `mint(params)` — returns a TransactionInstruction (original API)
   * - `mint(amount)` — returns a {@link MintBuilder} (fluent API)
   *
   * @example
   * ```ts
   * // Fluent API
   * await stablecoin.mint(1_000_000)
   *   .to(recipientWallet)
   *   .by(minterKeypair)
   *   .withMemo("Issuance #42")
   *   .send(payerKeypair);
   *
   * // Original API
   * const ix = await stablecoin.mint({ amount, recipientTokenAccount, minter });
   * ```
   */
  mint(params: MintParams): Promise<TransactionInstruction>;
  mint(amount: number | BN): MintBuilder;
  mint(
    paramsOrAmount: MintParams | number | BN
  ): Promise<TransactionInstruction> | MintBuilder {
    if (typeof paramsOrAmount === "number" || BN.isBN(paramsOrAmount)) {
      return new MintBuilder(this, new BN(paramsOrAmount.toString()));
    }
    return this._mintImpl(paramsOrAmount);
  }

  private async _mintImpl(
    params: MintParams
  ): Promise<TransactionInstruction> {
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
   * Build a burn_tokens instruction, or start a fluent {@link BurnBuilder}.
   *
   * **Overloaded:**
   * - `burn(params)` — returns a TransactionInstruction
   * - `burn(amount)` — returns a {@link BurnBuilder}
   */
  burn(params: BurnParams): Promise<TransactionInstruction>;
  burn(amount: number | BN): BurnBuilder;
  burn(
    paramsOrAmount: BurnParams | number | BN
  ): Promise<TransactionInstruction> | BurnBuilder {
    if (typeof paramsOrAmount === "number" || BN.isBN(paramsOrAmount)) {
      return new BurnBuilder(this, new BN(paramsOrAmount.toString()));
    }
    return this._burnImpl(paramsOrAmount);
  }

  private async _burnImpl(
    params: BurnParams
  ): Promise<TransactionInstruction> {
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
   * Build a freeze_token_account instruction, or start a fluent {@link FreezeBuilder}.
   *
   * **Overloaded:**
   * - `freeze(params)` — returns a TransactionInstruction
   * - `freeze(wallet)` — returns a {@link FreezeBuilder} (ATA derived automatically)
   */
  freeze(params: FreezeParams): Promise<TransactionInstruction>;
  freeze(wallet: PublicKey): FreezeBuilder;
  freeze(
    paramsOrWallet: FreezeParams | PublicKey
  ): Promise<TransactionInstruction> | FreezeBuilder {
    if (paramsOrWallet instanceof PublicKey) {
      return new FreezeBuilder(this, paramsOrWallet);
    }
    return this._freezeImpl(paramsOrWallet);
  }

  private async _freezeImpl(
    params: FreezeParams
  ): Promise<TransactionInstruction> {
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
   * Build a thaw_token_account instruction, or start a fluent {@link ThawBuilder}.
   *
   * **Overloaded:**
   * - `thaw(params)` — returns a TransactionInstruction
   * - `thaw(wallet)` — returns a {@link ThawBuilder} (ATA derived automatically)
   */
  thaw(params: ThawParams): Promise<TransactionInstruction>;
  thaw(wallet: PublicKey): ThawBuilder;
  thaw(
    paramsOrWallet: ThawParams | PublicKey
  ): Promise<TransactionInstruction> | ThawBuilder {
    if (paramsOrWallet instanceof PublicKey) {
      return new ThawBuilder(this, paramsOrWallet);
    }
    return this._thawImpl(paramsOrWallet);
  }

  private async _thawImpl(
    params: ThawParams
  ): Promise<TransactionInstruction> {
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
   * Build a pause instruction, or start a fluent {@link PauseBuilder}.
   *
   * **Overloaded:**
   * - `pause(params)` — returns a TransactionInstruction
   * - `pause()` — returns a {@link PauseBuilder}
   */
  pause(params: PauseParams): Promise<TransactionInstruction>;
  pause(): PauseBuilder;
  pause(params?: PauseParams): Promise<TransactionInstruction> | PauseBuilder {
    if (params) return this._pauseImpl(params);
    return new PauseBuilder(this, false);
  }

  private async _pauseImpl(
    params: PauseParams
  ): Promise<TransactionInstruction> {
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
   * Build an unpause instruction, or start a fluent {@link PauseBuilder}.
   *
   * **Overloaded:**
   * - `unpause(params)` — returns a TransactionInstruction
   * - `unpause()` — returns a {@link PauseBuilder}
   */
  unpause(params: PauseParams): Promise<TransactionInstruction>;
  unpause(): PauseBuilder;
  unpause(
    params?: PauseParams
  ): Promise<TransactionInstruction> | PauseBuilder {
    if (params) return this._unpauseImpl(params);
    return new PauseBuilder(this, true);
  }

  private async _unpauseImpl(
    params: PauseParams
  ): Promise<TransactionInstruction> {
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
   * Build an update_roles instruction, or start a fluent {@link UpdateRolesBuilder}.
   *
   * **Overloaded:**
   * - `updateRoles(params)` — returns a TransactionInstruction
   * - `updateRoles(roleType, user)` — returns an {@link UpdateRolesBuilder}
   */
  updateRoles(params: UpdateRolesParams): Promise<TransactionInstruction>;
  updateRoles(roleType: RoleType, user: PublicKey): UpdateRolesBuilder;
  updateRoles(
    paramsOrRole: UpdateRolesParams | RoleType,
    user?: PublicKey
  ): Promise<TransactionInstruction> | UpdateRolesBuilder {
    if (typeof paramsOrRole === "number" && user) {
      return new UpdateRolesBuilder(this, paramsOrRole, user);
    }
    return this._updateRolesImpl(paramsOrRole as UpdateRolesParams);
  }

  private async _updateRolesImpl(
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
   * Build an update_minter instruction, or start a fluent {@link UpdateMinterBuilder}.
   *
   * **Overloaded:**
   * - `updateMinter(params)` — returns a TransactionInstruction
   * - `updateMinter(minter)` — returns an {@link UpdateMinterBuilder}
   */
  updateMinter(params: UpdateMinterParams): Promise<TransactionInstruction>;
  updateMinter(minter: PublicKey): UpdateMinterBuilder;
  updateMinter(
    paramsOrMinter: UpdateMinterParams | PublicKey
  ): Promise<TransactionInstruction> | UpdateMinterBuilder {
    if (paramsOrMinter instanceof PublicKey) {
      return new UpdateMinterBuilder(this, paramsOrMinter);
    }
    return this._updateMinterImpl(paramsOrMinter);
  }

  private async _updateMinterImpl(
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
   * Build a transfer_authority instruction, or start a fluent {@link TransferAuthorityBuilder}.
   *
   * **Overloaded:**
   * - `transferAuthority(params)` — returns a TransactionInstruction
   * - `transferAuthority(newAuthority)` — returns a {@link TransferAuthorityBuilder}
   */
  transferAuthority(params: TransferAuthorityParams): Promise<TransactionInstruction>;
  transferAuthority(newAuthority: PublicKey): TransferAuthorityBuilder;
  transferAuthority(
    paramsOrNewAuth: TransferAuthorityParams | PublicKey
  ): Promise<TransactionInstruction> | TransferAuthorityBuilder {
    if (paramsOrNewAuth instanceof PublicKey) {
      return new TransferAuthorityBuilder(this, paramsOrNewAuth);
    }
    return this._transferAuthorityImpl(paramsOrNewAuth);
  }

  private async _transferAuthorityImpl(
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
  // Batch operations — multiple actions in a single transaction
  // -------------------------------------------------------------------

  /**
   * Start a general-purpose batch builder for composing multiple
   * operations into a single atomic transaction.
   *
   * @example
   * ```ts
   * const sig = await stablecoin.batch()
   *   .add(stablecoin.mint(1_000_000).to(alice).by(minterKp))
   *   .add(stablecoin.mint(2_000_000).to(bob).by(minterKp))
   *   .add(stablecoin.freeze(suspect).by(pauserKp))
   *   .withMemo("Batch issuance + freeze")
   *   .send(payerKp);
   * ```
   *
   * @returns A {@link BatchBuilder}
   */
  batch(): BatchBuilder {
    return new BatchBuilder(this);
  }

  /**
   * Batch-mint tokens to multiple recipients in one transaction.
   *
   * Optimizes instruction ordering: ATA-creation instructions (if enabled)
   * come first, followed by all mint instructions. Duplicate ATAs are
   * deduplicated automatically.
   *
   * @example
   * ```ts
   * const sig = await stablecoin.batchMint([
   *   { amount: 1_000_000, to: alice },
   *   { amount: 2_000_000, to: bob },
   *   { amount: 500_000, toAccount: carolATA },
   * ])
   *   .by(minterKeypair)
   *   .createAccountsIfNeeded()
   *   .withMemo("Monthly distribution")
   *   .send(payerKeypair);
   * ```
   *
   * @param entries - Array of mint targets with amounts
   * @returns A {@link BatchMintBuilder}
   */
  batchMint(entries: BatchMintEntry[]): BatchMintBuilder {
    return new BatchMintBuilder(this, entries);
  }

  /**
   * Batch-burn tokens from multiple accounts in one transaction.
   *
   * @example
   * ```ts
   * const sig = await stablecoin.batchBurn([
   *   { amount: 500_000, from: alice },
   *   { amount: 1_000_000, from: bob },
   * ])
   *   .by(burnerKeypair)
   *   .send(payerKeypair);
   * ```
   *
   * @param entries - Array of burn sources with amounts
   * @returns A {@link BatchBurnBuilder}
   */
  batchBurn(entries: BatchBurnEntry[]): BatchBurnBuilder {
    return new BatchBurnBuilder(this, entries);
  }

  /**
   * Batch-freeze multiple token accounts in one transaction.
   *
   * Accepts wallet addresses — ATAs are derived automatically.
   *
   * @example
   * ```ts
   * const sig = await stablecoin.batchFreeze([alice, bob, carol])
   *   .by(pauserKeypair)
   *   .send(payerKeypair);
   * ```
   *
   * @param wallets - Array of wallet addresses to freeze
   * @returns A {@link BatchFreezeBuilder}
   */
  batchFreeze(wallets: PublicKey[]): BatchFreezeBuilder {
    return new BatchFreezeBuilder(this, wallets);
  }

  /**
   * Batch-thaw multiple frozen token accounts in one transaction.
   *
   * @example
   * ```ts
   * const sig = await stablecoin.batchThaw([alice, bob])
   *   .by(pauserKeypair)
   *   .send(payerKeypair);
   * ```
   *
   * @param wallets - Array of wallet addresses to thaw
   * @returns A {@link BatchThawBuilder}
   */
  batchThaw(wallets: PublicKey[]): BatchThawBuilder {
    return new BatchThawBuilder(this, wallets);
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
