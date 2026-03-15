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
  AssignRoleParams,
  UpdateRoleParams,
  UpdateRolesParams,
  UpdateMinterParams,
  TransferAuthorityParams,
  BlacklistAddParams,
  BlacklistRemoveParams,
  SeizeParams,
  BlacklistEntry,
  MinterQuota as MinterQuotaType,
  ExtensionsConfig,
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
  AssignRoleBuilder,
  UpdateRoleBuilder,
  UpdateMinterBuilder,
  TransferAuthorityBuilder,
  ProposeAuthorityBuilder,
  AcceptAuthorityBuilder,
  CancelAuthorityBuilder,
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
  "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
);
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH"
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
    private readonly configAddress: PublicKey,
    private readonly _isSSS2 = false,
  ) {}

  /** @internal Create a BuilderContext from this module's state. */
  private builderCtx(): BuilderContext {
    return {
      program: this.program,
      mintAddress: this.mint,
      configAddress: this.configAddress,
      isSSS2: this._isSSS2,
    };
  }

  /**
   * Add an address to the blacklist.
   *
   * **Overloaded:**
   * - `blacklistAdd(params)` — returns a TransactionInstruction (original API)
   * - `blacklistAdd(address)` — returns a {@link BlacklistAddBuilder} (fluent API)
   * - `blacklistAdd(address, reason)` — returns a {@link BlacklistAddBuilder} with reason pre-set
   *
   * @example
   * ```ts
   * // Shorthand (matches bounty spec example)
   * await stable.compliance.blacklistAdd(address, "Sanctions match")
   *   .by(blacklisterKeypair)
   *   .send(payerKeypair);
   *
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
  blacklistAdd(address: PublicKey, reason?: string): BlacklistAddBuilder;
  blacklistAdd(
    paramsOrAddress: BlacklistAddParams | PublicKey,
    reason?: string
  ): Promise<TransactionInstruction> | BlacklistAddBuilder {
    if (paramsOrAddress instanceof PublicKey) {
      const builder = new BlacklistAddBuilder(this.builderCtx(), paramsOrAddress);
      return reason !== undefined ? builder.reason(reason) : builder;
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
   * - `seize(fromWallet, toWallet)` — returns a {@link SeizeBuilder} with source and destination pre-set
   *
   * @example
   * ```ts
   * // Shorthand (matches bounty spec example)
   * await stable.compliance.seize(frozenAccount, treasury)
   *   .amount(1_000_000)
   *   .by(seizerKeypair)
   *   .send(payerKeypair);
   *
   * // Fluent API (specify amount first)
   * await stablecoin.compliance.seize(1_000_000)
   *   .from(blacklistedWallet)
   *   .to(treasuryWallet)
   *   .by(seizerKeypair)
   *   .send(payerKeypair);
   * ```
   */
  seize(params: SeizeParams): Promise<TransactionInstruction>;
  seize(amount: number | BN): SeizeBuilder;
  seize(fromWallet: PublicKey, toWallet: PublicKey): SeizeBuilder;
  seize(
    paramsOrAmountOrFrom: SeizeParams | number | BN | PublicKey,
    toWallet?: PublicKey
  ): Promise<TransactionInstruction> | SeizeBuilder {
    if (paramsOrAmountOrFrom instanceof PublicKey && toWallet !== undefined) {
      // seize(fromWallet, toWallet) shorthand — returns builder with from/to pre-set
      return new SeizeBuilder(this.builderCtx(), new BN(0))
        .from(paramsOrAmountOrFrom)
        .to(toWallet);
    }
    if (typeof paramsOrAmountOrFrom === "number" || BN.isBN(paramsOrAmountOrFrom)) {
      return new SeizeBuilder(
        this.builderCtx(),
        new BN(paramsOrAmountOrFrom.toString())
      );
    }
    return this._seizeImpl(paramsOrAmountOrFrom as SeizeParams);
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

    // Resolve the blacklisted owner from the token account on chain
    const accountInfo = await this.connection.getAccountInfo(params.fromTokenAccount);
    if (!accountInfo) {
      throw new Error("Source token account not found on chain");
    }
    const blacklistedOwner = new PublicKey(accountInfo.data.subarray(32, 64));

    const [blacklistEntry] = getBlacklistEntryAddress(
      this.program.programId,
      this.configAddress,
      blacklistedOwner
    );

    return await this.program.methods
      .seize(params.amount)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
        blacklistedOwner,
        blacklistEntry,
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
  private _configCache?: { enableTransferHook: boolean };

  /** Whether this stablecoin uses SSS-2 features (transfer hook enabled). */
  get isSSS2(): boolean {
    return this._configCache?.enableTransferHook === true;
  }

  // -------------------------------------------------------------------
  // Private constructor — use factory methods instead
  // -------------------------------------------------------------------

  private constructor(
    connection: Connection,
    program: Program,
    mint: PublicKey,
    configAddress: PublicKey,
    configBump: number,
    isSSS2 = false,
  ) {
    this.connection = connection;
    this.program = program;
    this.mintAddress = mint;
    this.configAddress = configAddress;
    this.configBump = configBump;
    this._configCache = isSSS2 ? { enableTransferHook: true } : undefined;
    this.compliance = new ComplianceModule(
      program,
      connection,
      mint,
      configAddress,
      isSSS2,
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

    // Extract authority PublicKey (accept both PublicKey and Keypair)
    const authorityPubkey =
      params.authority instanceof PublicKey
        ? params.authority
        : params.authority.publicKey;

    // Resolve feature flags: preset → individual flags → extensions → defaults
    const preset = params.preset;
    const ext: ExtensionsConfig = params.extensions ?? {};
    const enablePermanentDelegate =
      params.enablePermanentDelegate ??
      preset?.permanentDelegate ??
      ext.permanentDelegate ??
      false;
    const enableTransferHook =
      params.enableTransferHook ??
      preset?.transferHook ??
      ext.transferHook ??
      false;
    const defaultAccountFrozen =
      params.defaultAccountFrozen ??
      preset?.defaultAccountFrozen ??
      ext.defaultFrozen ??
      false;
    const enableConfidentialTransfer =
      params.enableConfidentialTransfer ??
      preset?.confidentialTransfer ??
      ext.confidentialTransfer ??
      false;

    const initParams = {
      name: params.name,
      symbol: params.symbol,
      uri: params.uri ?? "",
      decimals: params.decimals ?? 6,
      enablePermanentDelegate,
      enableTransferHook,
      defaultAccountFrozen,
      enableConfidentialTransfer,
      transferHookProgramId: params.transferHookProgramId ?? null,
      supplyCap: new BN(params.supplyCap ?? 0),
    };

    const instruction = await program.methods
      .initialize(initParams)
      .accountsStrict({
        authority: authorityPubkey,
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
      configBump,
      configAccount.enableTransferHook as boolean,
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
   * Fetch the total circulating supply of the stablecoin.
   * Alias for {@link getSupply}.
   */
  async getTotalSupply(): Promise<{
    amount: string;
    decimals: number;
    uiAmount: number | null;
  }> {
    return this.getSupply();
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
    // Resolve recipient: wallet address → ATA, or use direct token account
    const recipientTokenAccount = params.recipientTokenAccount
      ? params.recipientTokenAccount
      : params.recipient
        ? getAssociatedTokenAddress(this.mintAddress, params.recipient)
        : (() => { throw new Error("MintParams requires either `recipient` (wallet) or `recipientTokenAccount`"); })();

    // Normalize amount to BN
    const amount = BN.isBN(params.amount)
      ? params.amount
      : new BN(params.amount.toString());

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
      .mintTokens(amount)
      .accountsStrict({
        minter: params.minter,
        config: this.configAddress,
        roleAccount,
        minterQuota,
        mint: this.mintAddress,
        recipientTokenAccount,
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
   * Build an assign_role instruction (creates a new RoleAccount PDA),
   * or start a fluent {@link AssignRoleBuilder}.
   *
   * **Overloaded:**
   * - `assignRole(params)` — returns a TransactionInstruction
   * - `assignRole(roleType, user)` — returns an {@link AssignRoleBuilder}
   */
  assignRole(params: AssignRoleParams): Promise<TransactionInstruction>;
  assignRole(roleType: RoleType, user: PublicKey): AssignRoleBuilder;
  assignRole(
    paramsOrRole: AssignRoleParams | RoleType,
    user?: PublicKey
  ): Promise<TransactionInstruction> | AssignRoleBuilder {
    if (typeof paramsOrRole === "number" && user) {
      return new AssignRoleBuilder(this, paramsOrRole, user);
    }
    return this._assignRoleImpl(paramsOrRole as AssignRoleParams);
  }

  private async _assignRoleImpl(
    params: AssignRoleParams
  ): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      params.roleType,
      params.user
    );

    return await this.program.methods
      .assignRole(params.roleType, params.user)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build an update_role instruction (modifies an existing RoleAccount PDA),
   * or start a fluent {@link UpdateRoleBuilder}.
   *
   * **Overloaded:**
   * - `updateRole(params)` — returns a TransactionInstruction
   * - `updateRole(roleType, user)` — returns an {@link UpdateRoleBuilder}
   */
  updateRole(params: UpdateRoleParams): Promise<TransactionInstruction>;
  updateRole(roleType: RoleType, user: PublicKey): UpdateRoleBuilder;
  updateRole(
    paramsOrRole: UpdateRoleParams | RoleType,
    user?: PublicKey
  ): Promise<TransactionInstruction> | UpdateRoleBuilder {
    if (typeof paramsOrRole === "number" && user) {
      return new UpdateRoleBuilder(this, paramsOrRole, user);
    }
    return this._updateRoleImpl(paramsOrRole as UpdateRoleParams);
  }

  private async _updateRoleImpl(
    params: UpdateRoleParams
  ): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      params.roleType,
      params.user
    );

    return await this.program.methods
      .updateRole(params.roleType, params.user, params.active)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
        roleAccount,
      })
      .instruction();
  }

  /**
   * @deprecated Use {@link assignRole} or {@link updateRole} instead.
   *
   * Backward-compatible facade that checks whether the RoleAccount PDA
   * exists on-chain and routes to `assignRole` (if missing) or
   * `updateRole` (if present).
   */
  updateRoles(params: UpdateRolesParams): Promise<TransactionInstruction>;
  updateRoles(roleType: RoleType, user: PublicKey): AssignRoleBuilder;
  updateRoles(
    paramsOrRole: UpdateRolesParams | RoleType,
    user?: PublicKey
  ): Promise<TransactionInstruction> | AssignRoleBuilder {
    if (typeof paramsOrRole === "number" && user) {
      return new AssignRoleBuilder(this, paramsOrRole, user);
    }
    return this._updateRolesCompat(paramsOrRole as UpdateRolesParams);
  }

  private async _updateRolesCompat(
    params: UpdateRolesParams
  ): Promise<TransactionInstruction> {
    const [roleAccount] = getRoleAddress(
      this.program.programId,
      this.configAddress,
      params.roleType,
      params.user
    );

    const exists = await accountExists(
      this.program.provider.connection,
      roleAccount
    );

    if (exists) {
      return this._updateRoleImpl({
        roleType: params.roleType,
        user: params.user,
        active: params.active,
        authority: params.authority,
      });
    }

    return this._assignRoleImpl({
      roleType: params.roleType,
      user: params.user,
      authority: params.authority,
    });
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

  /**
   * Propose an authority transfer (two-step: propose then accept).
   *
   * **Overloaded:**
   * - `proposeAuthority(params)` — returns a TransactionInstruction
   * - `proposeAuthority(newAuthority)` — returns a {@link ProposeAuthorityBuilder}
   */
  proposeAuthority(params: TransferAuthorityParams): Promise<TransactionInstruction>;
  proposeAuthority(newAuthority: PublicKey): ProposeAuthorityBuilder;
  proposeAuthority(
    paramsOrNewAuth: TransferAuthorityParams | PublicKey
  ): Promise<TransactionInstruction> | ProposeAuthorityBuilder {
    if (paramsOrNewAuth instanceof PublicKey) {
      return new ProposeAuthorityBuilder(this, paramsOrNewAuth);
    }
    return this._proposeAuthorityImpl(paramsOrNewAuth);
  }

  private async _proposeAuthorityImpl(
    params: TransferAuthorityParams
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .proposeAuthorityTransfer(params.newAuthority)
      .accountsStrict({
        authority: params.authority,
        config: this.configAddress,
      })
      .instruction();
  }

  /**
   * Accept a pending authority transfer (must be called by the proposed new authority).
   *
   * **Overloaded:**
   * - `acceptAuthority(params)` — returns a TransactionInstruction
   * - `acceptAuthority()` — returns an {@link AcceptAuthorityBuilder}
   */
  acceptAuthority(params: PauseParams): Promise<TransactionInstruction>;
  acceptAuthority(): AcceptAuthorityBuilder;
  acceptAuthority(
    params?: PauseParams
  ): Promise<TransactionInstruction> | AcceptAuthorityBuilder {
    if (params) return this._acceptAuthorityImpl(params);
    return new AcceptAuthorityBuilder(this);
  }

  private async _acceptAuthorityImpl(
    params: PauseParams
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .acceptAuthorityTransfer()
      .accountsStrict({
        newAuthority: params.authority,
        config: this.configAddress,
      })
      .instruction();
  }

  /**
   * Cancel a pending authority transfer (must be called by the current authority).
   *
   * **Overloaded:**
   * - `cancelAuthority(params)` — returns a TransactionInstruction
   * - `cancelAuthority()` — returns a {@link CancelAuthorityBuilder}
   */
  cancelAuthority(params: PauseParams): Promise<TransactionInstruction>;
  cancelAuthority(): CancelAuthorityBuilder;
  cancelAuthority(
    params?: PauseParams
  ): Promise<TransactionInstruction> | CancelAuthorityBuilder {
    if (params) return this._cancelAuthorityImpl(params);
    return new CancelAuthorityBuilder(this);
  }

  private async _cancelAuthorityImpl(
    params: PauseParams
  ): Promise<TransactionInstruction> {
    return await this.program.methods
      .cancelAuthorityTransfer()
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

  /**
   * Fetch all token holders for this stablecoin.
   *
   * Uses `getProgramAccounts` with a memcmp filter on the mint address
   * to find all Token-2022 accounts, then decodes owner, balance, and
   * frozen state.
   *
   * @param opts - Optional filters
   * @returns Array of holder entries
   */
  async getHolders(opts?: {
    minBalance?: BN;
    includeFrozen?: boolean;
    limit?: number;
  }): Promise<
    Array<{
      owner: PublicKey;
      tokenAccount: PublicKey;
      balance: BN;
      frozen: boolean;
    }>
  > {
    const accounts = await this.connection.getProgramAccounts(
      TOKEN_2022_PROGRAM_ID,
      {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: this.mintAddress.toBase58(),
            },
          },
        ],
      }
    );

    const holders: Array<{
      owner: PublicKey;
      tokenAccount: PublicKey;
      balance: BN;
      frozen: boolean;
    }> = [];

    for (const { pubkey, account } of accounts) {
      const data = account.data as Buffer;
      if (data.length < 109) continue;

      const state = data[108];
      if (state === 0) continue; // uninitialized

      const frozen = state === 2;
      if (frozen && !opts?.includeFrozen) continue;

      const owner = new PublicKey(data.subarray(32, 64));

      // Read u64 LE at offset 64
      let rawBalance = BigInt(0);
      for (let i = 0; i < 8; i++) {
        rawBalance |= BigInt(data[64 + i]) << BigInt(i * 8);
      }
      const balance = new BN(rawBalance.toString());

      if (opts?.minBalance && balance.lt(opts.minBalance)) continue;

      holders.push({ owner, tokenAccount: pubkey, balance, frozen });
    }

    // Sort by balance descending
    holders.sort((a, b) => (b.balance.gt(a.balance) ? 1 : b.balance.lt(a.balance) ? -1 : 0));

    if (opts?.limit) {
      return holders.slice(0, opts.limit);
    }

    return holders;
  }
}
