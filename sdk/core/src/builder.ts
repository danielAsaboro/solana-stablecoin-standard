/**
 * @module builder
 *
 * Fluent transaction builder for the Solana Stablecoin Standard SDK.
 *
 * Provides a chainable API for building, simulating, and sending
 * stablecoin operations. Each operation builder collects parameters
 * step-by-step, then produces instructions or full transactions.
 *
 * @example
 * ```ts
 * // Fluent mint
 * const sig = await stablecoin.mint(1_000_000)
 *   .to(recipientWallet)
 *   .by(minterKeypair)
 *   .withMemo("Monthly issuance")
 *   .send(payerKeypair);
 *
 * // Build instruction for external signing (e.g. wallet adapter)
 * const [ix] = await stablecoin.mint(1_000_000)
 *   .to(recipientWallet)
 *   .by(minterPubkey)
 *   .instruction();
 * ```
 *
 * @packageDocumentation
 */

import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ConfirmOptions,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SimulatedTransactionResponse,
  RpcResponseAndContext,
} from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  getRoleAddress,
  getMinterQuotaAddress,
  getBlacklistEntryAddress,
} from "./pda";
import { getAssociatedTokenAddress, createATAInstruction } from "./utils";
import { RoleType } from "./types";
import { type RetryConfig, withRetry } from "./retry";

/** SPL Memo Program v2 address. */
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

// ---------------------------------------------------------------------------
// BuilderContext — minimal interface to avoid circular imports
// ---------------------------------------------------------------------------

/**
 * Minimal context required by operation builders.
 *
 * {@link SolanaStablecoin} satisfies this interface, so you can pass
 * a stablecoin instance directly as the context.
 */
export interface BuilderContext {
  /** The Anchor Program instance for the SSS program. */
  readonly program: Program;
  /** The Token-2022 mint address. */
  readonly mintAddress: PublicKey;
  /** The StablecoinConfig PDA address. */
  readonly configAddress: PublicKey;
  /**
   * Default retry configuration applied to all builders created from
   * this context. Individual builders can override via `.withRetry()`.
   */
  readonly retryConfig?: Partial<RetryConfig>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve a PublicKey or Keypair to its PublicKey. */
function toPublicKey(value: PublicKey | Keypair): PublicKey {
  return value instanceof Keypair ? value.publicKey : value;
}

/** Extract a Keypair if one was provided, otherwise null. */
function collectKeypair(value: PublicKey | Keypair): Keypair | null {
  return value instanceof Keypair ? value : null;
}

/** Deduplicate signers by public key, preserving order. */
function deduplicateSigners(signers: Keypair[]): Keypair[] {
  const seen = new Set<string>();
  return signers.filter((s) => {
    const key = s.publicKey.toBase58();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// OperationBuilder — abstract base
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all fluent operation builders.
 *
 * Provides common transaction modifiers (memo, compute budget, priority fee)
 * and execution methods (instruction, transaction, send, simulate).
 */
export abstract class OperationBuilder {
  /** @internal */ protected readonly ctx: BuilderContext;
  /** @internal */ protected _memo?: string;
  /** @internal */ protected _computeUnits?: number;
  /** @internal */ protected _priorityFee?: number;
  /** @internal */ protected _preInstructions: TransactionInstruction[] = [];
  /** @internal */ protected _postInstructions: TransactionInstruction[] = [];
  /** @internal */ protected _additionalSigners: Keypair[] = [];
  /** @internal */ protected _retryConfig?: Partial<RetryConfig>;

  /** @internal */
  constructor(ctx: BuilderContext) {
    this.ctx = ctx;
  }

  /**
   * Add a memo to the transaction via the SPL Memo program.
   * @param memo - Human-readable memo text
   */
  withMemo(memo: string): this {
    this._memo = memo;
    return this;
  }

  /**
   * Set the compute unit limit for the transaction.
   * @param units - Number of compute units to request
   */
  withComputeBudget(units: number): this {
    this._computeUnits = units;
    return this;
  }

  /**
   * Set the priority fee in micro-lamports per compute unit.
   * @param microLamports - Priority fee rate
   */
  withPriorityFee(microLamports: number): this {
    this._priorityFee = microLamports;
    return this;
  }

  /**
   * Enable automatic retry with exponential backoff for transient RPC failures.
   *
   * When enabled, `send()` and `simulate()` will automatically retry on
   * transient errors (rate limits, timeouts, network issues). Permanent
   * errors (program failures, insufficient funds) propagate immediately.
   *
   * Call with no arguments to use {@link DEFAULT_RETRY_CONFIG}, or pass
   * a partial config to customize.
   *
   * @param config - Optional partial retry configuration
   *
   * @example
   * ```ts
   * // Use defaults (3 retries, 500ms initial delay, 2x backoff)
   * await stablecoin.mint(1_000_000)
   *   .to(recipient)
   *   .by(minter)
   *   .withRetry()
   *   .send(payer);
   *
   * // Custom config with logging
   * await stablecoin.mint(1_000_000)
   *   .to(recipient)
   *   .by(minter)
   *   .withRetry({
   *     maxRetries: 5,
   *     initialDelayMs: 200,
   *     onRetry: (err, attempt, delay) => {
   *       console.log(`Retry ${attempt} in ${delay}ms: ${err.message}`);
   *     },
   *   })
   *   .send(payer);
   * ```
   */
  withRetry(config?: Partial<RetryConfig>): this {
    this._retryConfig = config ?? {};
    return this;
  }

  /**
   * Prepend additional instructions before the main operation.
   * @param instructions - Instructions to prepend
   */
  prepend(...instructions: TransactionInstruction[]): this {
    this._preInstructions.push(...instructions);
    return this;
  }

  /**
   * Append additional instructions after the main operation.
   * @param instructions - Instructions to append
   */
  append(...instructions: TransactionInstruction[]): this {
    this._postInstructions.push(...instructions);
    return this;
  }

  /**
   * Returns signers collected by fluent methods like `.by(keypair)`.
   *
   * Used internally by {@link BatchBuilder} to gather signers from
   * sub-operations into the combined transaction.
   *
   * @internal
   */
  getCollectedSigners(): Keypair[] {
    return [...this._additionalSigners];
  }

  /**
   * Build the core operation instruction(s). Subclasses must implement this.
   * @internal
   */
  protected abstract buildCoreInstructions(): Promise<TransactionInstruction[]>;

  /**
   * Get the core instruction(s) without transaction wrapping.
   * Use this when composing instructions into your own transaction.
   * @returns Array of TransactionInstructions
   */
  async instruction(): Promise<TransactionInstruction[]> {
    return this.buildCoreInstructions();
  }

  /**
   * Build a complete Transaction with all modifiers applied.
   *
   * Includes compute budget, priority fee, pre/post instructions, and memo.
   * @param feePayer - The transaction fee payer public key
   * @returns A ready-to-sign Transaction
   */
  async transaction(feePayer: PublicKey): Promise<Transaction> {
    const tx = new Transaction();

    if (this._computeUnits !== undefined) {
      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: this._computeUnits })
      );
    }
    if (this._priorityFee !== undefined) {
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this._priorityFee,
        })
      );
    }

    for (const ix of this._preInstructions) {
      tx.add(ix);
    }

    const coreIxs = await this.buildCoreInstructions();
    for (const ix of coreIxs) {
      tx.add(ix);
    }

    for (const ix of this._postInstructions) {
      tx.add(ix);
    }

    if (this._memo) {
      tx.add(
        new TransactionInstruction({
          keys: [{ pubkey: feePayer, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: Buffer.from(this._memo, "utf-8"),
        })
      );
    }

    tx.feePayer = feePayer;
    const connection = this.ctx.program.provider.connection;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    return tx;
  }

  /**
   * Build, sign, send, and confirm the transaction.
   *
   * Keypairs passed to builder methods (e.g. `.by(keypair)`) are
   * automatically included as signers. Pass additional signers if
   * you used PublicKeys in builder methods.
   *
   * When retry is enabled (via `.withRetry()` or context-level
   * {@link BuilderContext.retryConfig}), transient RPC failures
   * trigger automatic retries with exponential backoff. Each retry
   * rebuilds the transaction with a fresh blockhash.
   *
   * @param payer - The transaction payer Keypair
   * @param signers - Additional signers beyond payer and auto-collected ones
   * @param opts - Transaction confirmation options
   * @returns Transaction signature
   */
  async send(
    payer: Keypair,
    signers?: Keypair[],
    opts?: ConfirmOptions
  ): Promise<string> {
    const executeSend = async (): Promise<string> => {
      // Rebuild transaction on each attempt to get a fresh blockhash
      const tx = await this.transaction(payer.publicKey);
      const allSigners = deduplicateSigners([
        payer,
        ...this._additionalSigners,
        ...(signers ?? []),
      ]);
      const connection = this.ctx.program.provider.connection;
      return sendAndConfirmTransaction(
        connection,
        tx,
        allSigners,
        opts ?? { commitment: "confirmed" }
      );
    };

    // Use per-builder config, fall back to context-level config
    const retryConfig = this._retryConfig ?? this.ctx.retryConfig;
    if (retryConfig) {
      return withRetry(executeSend, retryConfig);
    }
    return executeSend();
  }

  /**
   * Simulate the transaction without sending.
   *
   * When retry is enabled, transient RPC failures during simulation
   * trigger automatic retries (e.g. rate limits, timeouts).
   *
   * @param feePayer - The fee payer public key
   * @returns Simulation result with logs and error info
   */
  async simulate(
    feePayer: PublicKey
  ): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
    const executeSimulate = async (): Promise<
      RpcResponseAndContext<SimulatedTransactionResponse>
    > => {
      const tx = await this.transaction(feePayer);
      const connection = this.ctx.program.provider.connection;
      return connection.simulateTransaction(tx);
    };

    const retryConfig = this._retryConfig ?? this.ctx.retryConfig;
    if (retryConfig) {
      return withRetry(executeSimulate, retryConfig);
    }
    return executeSimulate();
  }
}

// ---------------------------------------------------------------------------
// MintBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for mint operations.
 *
 * @example
 * ```ts
 * const sig = await stablecoin.mint(1_000_000)
 *   .to(recipientWallet)
 *   .by(minterKeypair)
 *   .createAccountIfNeeded()
 *   .withMemo("Monthly issuance")
 *   .send(payerKeypair);
 * ```
 */
export class MintBuilder extends OperationBuilder {
  private readonly _amount: BN;
  private _recipientWallet?: PublicKey;
  private _recipientTokenAccount?: PublicKey;
  private _minter?: PublicKey;
  private _createATA = false;
  private _ataPayer?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, amount: BN) {
    super(ctx);
    this._amount = amount;
  }

  /**
   * Set the recipient by wallet address. The ATA is derived automatically.
   * @param wallet - Recipient wallet public key
   */
  to(wallet: PublicKey): this {
    this._recipientWallet = wallet;
    this._recipientTokenAccount = getAssociatedTokenAddress(
      this.ctx.mintAddress,
      wallet
    );
    return this;
  }

  /**
   * Set the recipient by token account address directly (skip ATA derivation).
   * @param tokenAccount - The recipient's token account
   */
  toAccount(tokenAccount: PublicKey): this {
    this._recipientTokenAccount = tokenAccount;
    return this;
  }

  /**
   * Set the minter. Accepts a PublicKey or Keypair.
   * If a Keypair is provided, it is automatically added as a signer.
   * @param minter - Minter public key or keypair (must have Minter role)
   */
  by(minter: PublicKey | Keypair): this {
    this._minter = toPublicKey(minter);
    const kp = collectKeypair(minter);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  /**
   * Automatically create the recipient's ATA if it doesn't exist.
   * @param payer - Account paying for ATA rent (defaults to minter)
   */
  createAccountIfNeeded(payer?: PublicKey): this {
    this._createATA = true;
    this._ataPayer = payer;
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._recipientTokenAccount) {
      throw new Error(
        "MintBuilder: recipient not set. Call .to(wallet) or .toAccount(ata)"
      );
    }
    if (!this._minter) {
      throw new Error("MintBuilder: minter not set. Call .by(minter)");
    }

    const instructions: TransactionInstruction[] = [];

    if (this._createATA && this._recipientWallet) {
      const payer = this._ataPayer ?? this._minter;
      instructions.push(
        createATAInstruction(payer, this._recipientWallet, this.ctx.mintAddress)
      );
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Minter,
      this._minter
    );
    const [minterQuota] = getMinterQuotaAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      this._minter
    );

    const ix = await this.ctx.program.methods
      .mintTokens(this._amount)
      .accountsStrict({
        minter: this._minter,
        config: this.ctx.configAddress,
        roleAccount,
        minterQuota,
        mint: this.ctx.mintAddress,
        recipientTokenAccount: this._recipientTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    instructions.push(ix);
    return instructions;
  }
}

// ---------------------------------------------------------------------------
// BurnBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for burn operations.
 *
 * @example
 * ```ts
 * const sig = await stablecoin.burn(500_000)
 *   .from(holderWallet)
 *   .by(burnerKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class BurnBuilder extends OperationBuilder {
  private readonly _amount: BN;
  private _fromTokenAccount?: PublicKey;
  private _burner?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, amount: BN) {
    super(ctx);
    this._amount = amount;
  }

  /**
   * Set the source by wallet address. The ATA is derived automatically.
   * @param wallet - Source wallet public key
   */
  from(wallet: PublicKey): this {
    this._fromTokenAccount = getAssociatedTokenAddress(
      this.ctx.mintAddress,
      wallet
    );
    return this;
  }

  /**
   * Set the source by token account address directly.
   * @param tokenAccount - Source token account
   */
  fromAccount(tokenAccount: PublicKey): this {
    this._fromTokenAccount = tokenAccount;
    return this;
  }

  /**
   * Set the burner. Accepts PublicKey or Keypair.
   * @param burner - Burner public key or keypair (must have Burner role)
   */
  by(burner: PublicKey | Keypair): this {
    this._burner = toPublicKey(burner);
    const kp = collectKeypair(burner);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._fromTokenAccount) {
      throw new Error(
        "BurnBuilder: source not set. Call .from(wallet) or .fromAccount(ata)"
      );
    }
    if (!this._burner) {
      throw new Error("BurnBuilder: burner not set. Call .by(burner)");
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Burner,
      this._burner
    );

    const ix = await this.ctx.program.methods
      .burnTokens(this._amount)
      .accountsStrict({
        burner: this._burner,
        config: this.ctx.configAddress,
        roleAccount,
        mint: this.ctx.mintAddress,
        fromTokenAccount: this._fromTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// FreezeBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for freeze operations.
 *
 * @example
 * ```ts
 * const sig = await stablecoin.freeze(suspectWallet)
 *   .by(pauserKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class FreezeBuilder extends OperationBuilder {
  private _tokenAccount: PublicKey;
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, wallet: PublicKey) {
    super(ctx);
    this._tokenAccount = getAssociatedTokenAddress(ctx.mintAddress, wallet);
  }

  /**
   * Override the token account directly (skip ATA derivation).
   * @param tokenAccount - The token account to freeze
   */
  account(tokenAccount: PublicKey): this {
    this._tokenAccount = tokenAccount;
    return this;
  }

  /**
   * Set the freeze authority. Accepts PublicKey or Keypair.
   * @param authority - Authority with Pauser role
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error("FreezeBuilder: authority not set. Call .by(authority)");
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Pauser,
      this._authority
    );

    const ix = await this.ctx.program.methods
      .freezeTokenAccount()
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
        roleAccount,
        mint: this.ctx.mintAddress,
        tokenAccount: this._tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// ThawBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for thaw operations.
 *
 * @example
 * ```ts
 * const sig = await stablecoin.thaw(accountWallet)
 *   .by(pauserKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class ThawBuilder extends OperationBuilder {
  private _tokenAccount: PublicKey;
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, wallet: PublicKey) {
    super(ctx);
    this._tokenAccount = getAssociatedTokenAddress(ctx.mintAddress, wallet);
  }

  /**
   * Override the token account directly (skip ATA derivation).
   * @param tokenAccount - The token account to thaw
   */
  account(tokenAccount: PublicKey): this {
    this._tokenAccount = tokenAccount;
    return this;
  }

  /**
   * Set the thaw authority. Accepts PublicKey or Keypair.
   * @param authority - Authority with Pauser role
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error("ThawBuilder: authority not set. Call .by(authority)");
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Pauser,
      this._authority
    );

    const ix = await this.ctx.program.methods
      .thawTokenAccount()
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
        roleAccount,
        mint: this.ctx.mintAddress,
        tokenAccount: this._tokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// PauseBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for pause/unpause operations.
 *
 * @example
 * ```ts
 * await stablecoin.pause().by(pauserKeypair).send(payerKeypair);
 * await stablecoin.unpause().by(pauserKeypair).send(payerKeypair);
 * ```
 */
export class PauseBuilder extends OperationBuilder {
  private _authority?: PublicKey;
  private readonly _unpause: boolean;

  /** @internal */
  constructor(ctx: BuilderContext, unpause = false) {
    super(ctx);
    this._unpause = unpause;
  }

  /**
   * Set the pause/unpause authority. Accepts PublicKey or Keypair.
   * @param authority - Authority with Pauser role
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error("PauseBuilder: authority not set. Call .by(authority)");
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Pauser,
      this._authority
    );

    const method = this._unpause
      ? this.ctx.program.methods.unpause()
      : this.ctx.program.methods.pause();

    const ix = await method
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
        roleAccount,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// UpdateRolesBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for role management operations.
 *
 * @example
 * ```ts
 * await stablecoin.updateRoles(RoleType.Minter, userPubkey)
 *   .activate()
 *   .by(masterKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class UpdateRolesBuilder extends OperationBuilder {
  private readonly _roleType: RoleType;
  private readonly _user: PublicKey;
  private _active = true;
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, roleType: RoleType, user: PublicKey) {
    super(ctx);
    this._roleType = roleType;
    this._user = user;
  }

  /** Grant the role (default). */
  activate(): this {
    this._active = true;
    return this;
  }

  /** Revoke the role. */
  deactivate(): this {
    this._active = false;
    return this;
  }

  /**
   * Set the master authority. Accepts PublicKey or Keypair.
   * @param authority - The master authority
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error(
        "UpdateRolesBuilder: authority not set. Call .by(authority)"
      );
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      this._roleType,
      this._user
    );

    const ix = await this.ctx.program.methods
      .updateRoles(this._roleType, this._user, this._active)
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
        roleAccount,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// UpdateMinterBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for minter quota management.
 *
 * @example
 * ```ts
 * await stablecoin.updateMinter(minterPubkey)
 *   .quota(new BN(10_000_000))
 *   .by(masterKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class UpdateMinterBuilder extends OperationBuilder {
  private readonly _minter: PublicKey;
  private _quota?: BN;
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, minter: PublicKey) {
    super(ctx);
    this._minter = minter;
  }

  /**
   * Set the minter's new quota.
   * @param amount - Maximum mint amount
   */
  quota(amount: BN | number): this {
    this._quota = new BN(amount.toString());
    return this;
  }

  /**
   * Set the master authority. Accepts PublicKey or Keypair.
   * @param authority - The master authority
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (this._quota === undefined) {
      throw new Error(
        "UpdateMinterBuilder: quota not set. Call .quota(amount)"
      );
    }
    if (!this._authority) {
      throw new Error(
        "UpdateMinterBuilder: authority not set. Call .by(authority)"
      );
    }

    const [minterQuota] = getMinterQuotaAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      this._minter
    );

    const ix = await this.ctx.program.methods
      .updateMinter(this._minter, this._quota)
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
        minterQuota,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// TransferAuthorityBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for authority transfer.
 *
 * @example
 * ```ts
 * await stablecoin.transferAuthority(newAuthorityPubkey)
 *   .by(currentAuthorityKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class TransferAuthorityBuilder extends OperationBuilder {
  private readonly _newAuthority: PublicKey;
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, newAuthority: PublicKey) {
    super(ctx);
    this._newAuthority = newAuthority;
  }

  /**
   * Set the current master authority. Accepts PublicKey or Keypair.
   * @param authority - The current master authority
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error(
        "TransferAuthorityBuilder: authority not set. Call .by(authority)"
      );
    }

    const ix = await this.ctx.program.methods
      .transferAuthority(this._newAuthority)
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// BlacklistAddBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for adding an address to the blacklist (SSS-2).
 *
 * @example
 * ```ts
 * await stablecoin.compliance.blacklistAdd(suspectAddress)
 *   .reason("OFAC SDN match")
 *   .by(blacklisterKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class BlacklistAddBuilder extends OperationBuilder {
  private readonly _address: PublicKey;
  private _reason = "";
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, address: PublicKey) {
    super(ctx);
    this._address = address;
  }

  /**
   * Set the reason for blacklisting.
   * @param reason - Human-readable reason (max 64 chars)
   */
  reason(reason: string): this {
    this._reason = reason;
    return this;
  }

  /**
   * Set the blacklister authority. Accepts PublicKey or Keypair.
   * @param authority - Authority with Blacklister role
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error(
        "BlacklistAddBuilder: authority not set. Call .by(authority)"
      );
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Blacklister,
      this._authority
    );
    const [blacklistEntry] = getBlacklistEntryAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      this._address
    );

    const ix = await this.ctx.program.methods
      .addToBlacklist(this._address, this._reason)
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
        roleAccount,
        blacklistEntry,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// BlacklistRemoveBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for removing an address from the blacklist (SSS-2).
 *
 * @example
 * ```ts
 * await stablecoin.compliance.blacklistRemove(address)
 *   .by(blacklisterKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class BlacklistRemoveBuilder extends OperationBuilder {
  private readonly _address: PublicKey;
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, address: PublicKey) {
    super(ctx);
    this._address = address;
  }

  /**
   * Set the blacklister authority. Accepts PublicKey or Keypair.
   * @param authority - Authority with Blacklister role
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error(
        "BlacklistRemoveBuilder: authority not set. Call .by(authority)"
      );
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Blacklister,
      this._authority
    );
    const [blacklistEntry] = getBlacklistEntryAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      this._address
    );

    const ix = await this.ctx.program.methods
      .removeFromBlacklist(this._address)
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
        roleAccount,
        blacklistEntry,
      })
      .instruction();

    return [ix];
  }
}

// ---------------------------------------------------------------------------
// SeizeBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for token seizure via permanent delegate (SSS-2).
 *
 * @example
 * ```ts
 * await stablecoin.compliance.seize(1_000_000)
 *   .from(blacklistedWallet)
 *   .toAccount(treasuryATA)
 *   .by(seizerKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class SeizeBuilder extends OperationBuilder {
  private readonly _amount: BN;
  private _fromTokenAccount?: PublicKey;
  private _toTokenAccount?: PublicKey;
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, amount: BN) {
    super(ctx);
    this._amount = amount;
  }

  /**
   * Set the source by wallet address. The ATA is derived automatically.
   * @param wallet - Wallet to seize tokens from
   */
  from(wallet: PublicKey): this {
    this._fromTokenAccount = getAssociatedTokenAddress(
      this.ctx.mintAddress,
      wallet
    );
    return this;
  }

  /**
   * Set the source by token account address directly.
   * @param tokenAccount - Source token account
   */
  fromAccount(tokenAccount: PublicKey): this {
    this._fromTokenAccount = tokenAccount;
    return this;
  }

  /**
   * Set the destination by wallet address. The ATA is derived automatically.
   * @param wallet - Treasury/destination wallet
   */
  to(wallet: PublicKey): this {
    this._toTokenAccount = getAssociatedTokenAddress(
      this.ctx.mintAddress,
      wallet
    );
    return this;
  }

  /**
   * Set the destination by token account address directly.
   * @param tokenAccount - Destination token account
   */
  toAccount(tokenAccount: PublicKey): this {
    this._toTokenAccount = tokenAccount;
    return this;
  }

  /**
   * Set the seizer authority. Accepts PublicKey or Keypair.
   * @param authority - Authority with Seizer role
   */
  by(authority: PublicKey | Keypair): this {
    this._authority = toPublicKey(authority);
    const kp = collectKeypair(authority);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._fromTokenAccount) {
      throw new Error(
        "SeizeBuilder: source not set. Call .from(wallet) or .fromAccount(ata)"
      );
    }
    if (!this._toTokenAccount) {
      throw new Error(
        "SeizeBuilder: destination not set. Call .to(wallet) or .toAccount(ata)"
      );
    }
    if (!this._authority) {
      throw new Error("SeizeBuilder: authority not set. Call .by(authority)");
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Seizer,
      this._authority
    );

    const ix = await this.ctx.program.methods
      .seize(this._amount)
      .accountsStrict({
        authority: this._authority,
        config: this.ctx.configAddress,
        roleAccount,
        mint: this.ctx.mintAddress,
        fromTokenAccount: this._fromTokenAccount,
        toTokenAccount: this._toTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .instruction();

    return [ix];
  }
}
