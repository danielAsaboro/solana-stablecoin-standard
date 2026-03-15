/**
 * @module batch
 *
 * Batch transaction builders for the Solana Stablecoin Standard SDK.
 *
 * Allows composing multiple stablecoin operations into a single Solana
 * transaction, reducing round-trips and ensuring atomic execution.
 *
 * Two usage patterns are supported:
 *
 * 1. **General batch** — mix any operations:
 * ```ts
 * await stablecoin.batch()
 *   .add(stablecoin.mint(1_000_000).to(alice).by(minterKp))
 *   .add(stablecoin.mint(2_000_000).to(bob).by(minterKp))
 *   .add(stablecoin.freeze(suspect).by(pauserKp))
 *   .withMemo("Batch issuance + freeze")
 *   .send(payerKp);
 * ```
 *
 * 2. **Typed batch helpers** — streamlined APIs for common batch patterns:
 * ```ts
 * await stablecoin.batchMint([
 *   { amount: 1_000_000, to: alice },
 *   { amount: 2_000_000, to: bob },
 * ]).by(minterKp).createAccountsIfNeeded().send(payerKp);
 *
 * await stablecoin.batchFreeze([alice, bob, carol])
 *   .by(pauserKp).send(payerKp);
 * ```
 *
 * @packageDocumentation
 */

import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  ConfirmOptions,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  getRoleAddress,
  getMinterQuotaAddress,
  getBlacklistEntryAddress,
} from "./pda";
import { getAssociatedTokenAddress, createATAInstruction } from "./utils";
import { RoleType } from "./types";
import { type BuilderContext, OperationBuilder } from "./builder";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve a PublicKey or Keypair to its PublicKey. */
function toPublicKey(value: PublicKey | Keypair): PublicKey {
  return value instanceof Keypair ? value.publicKey : value;
}

/** Extract a Keypair if provided, otherwise null. */
function collectKeypair(value: PublicKey | Keypair): Keypair | null {
  return value instanceof Keypair ? value : null;
}

// ---------------------------------------------------------------------------
// BatchBuilder — compose arbitrary operations into one transaction
// ---------------------------------------------------------------------------

/**
 * Compose multiple stablecoin operations into a single atomic transaction.
 *
 * Accepts any {@link OperationBuilder} subclass and combines their
 * instructions in order. All transaction modifiers (memo, compute budget,
 * priority fee) are applied to the combined transaction.
 *
 * Signers collected by sub-builders (via `.by(keypair)`) are automatically
 * included when calling `.send()`.
 *
 * @example
 * ```ts
 * const sig = await stablecoin.batch()
 *   .add(stablecoin.mint(1_000_000).to(alice).by(minterKp))
 *   .add(stablecoin.mint(2_000_000).to(bob).by(minterKp))
 *   .add(stablecoin.freeze(suspect).by(pauserKp))
 *   .withMemo("Batch #42")
 *   .withComputeBudget(400_000)
 *   .send(payerKp);
 * ```
 */
export class BatchBuilder extends OperationBuilder {
  private readonly _operations: OperationBuilder[] = [];

  /** @internal */
  constructor(ctx: BuilderContext) {
    super(ctx);
  }

  /**
   * Add an operation to the batch.
   *
   * Operations execute in the order they are added. Each operation's
   * core instructions are concatenated into the final transaction.
   *
   * @param operation - Any fluent operation builder (MintBuilder, BurnBuilder, etc.)
   * @returns this for chaining
   */
  add(operation: OperationBuilder): this {
    this._operations.push(operation);
    return this;
  }

  /**
   * The number of operations currently in this batch.
   */
  get size(): number {
    return this._operations.length;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (this._operations.length === 0) {
      throw new Error(
        "BatchBuilder: no operations added. Call .add(operation)",
      );
    }

    const allInstructions: TransactionInstruction[] = [];
    for (const op of this._operations) {
      const ixs = await op.instruction();
      allInstructions.push(...ixs);
    }
    return allInstructions;
  }

  /**
   * Build, sign, send, and confirm the batched transaction.
   *
   * Automatically collects signers from all sub-operations. Keypairs
   * passed via `.by(keypair)` in sub-builders are included as signers.
   *
   * @param payer - The transaction payer Keypair
   * @param signers - Additional signers beyond auto-collected ones
   * @param opts - Transaction confirmation options
   * @returns Transaction signature
   */
  async send(
    payer: Keypair,
    signers?: Keypair[],
    opts?: ConfirmOptions,
  ): Promise<string> {
    // Collect signers from all sub-builders via the public accessor
    for (const op of this._operations) {
      this._additionalSigners.push(...op.getCollectedSigners());
    }
    return super.send(payer, signers, opts);
  }
}

// ---------------------------------------------------------------------------
// BatchMintEntry — describes one mint in a batch
// ---------------------------------------------------------------------------

/**
 * Describes a single mint operation within a batch.
 *
 * Use `to` for wallet addresses (ATA derived automatically) or
 * `toAccount` for direct token account addresses.
 */
export interface BatchMintEntry {
  /** Amount to mint (in smallest unit). */
  amount: BN | number;
  /** Recipient wallet address — ATA will be derived. Mutually exclusive with `toAccount`. */
  to?: PublicKey;
  /** Recipient token account address — used directly. Mutually exclusive with `to`. */
  toAccount?: PublicKey;
}

/**
 * Batch builder for minting tokens to multiple recipients in one transaction.
 *
 * Optimizes instruction ordering: all ATA-creation instructions come first,
 * followed by all mint instructions. This ensures accounts exist before
 * tokens are minted to them.
 *
 * @example
 * ```ts
 * const sig = await stablecoin.batchMint([
 *   { amount: 1_000_000, to: alice },
 *   { amount: 2_000_000, to: bob },
 *   { amount: 500_000, toAccount: carolTokenAccount },
 * ])
 *   .by(minterKeypair)
 *   .createAccountsIfNeeded()
 *   .withMemo("Monthly distribution")
 *   .send(payerKeypair);
 * ```
 */
export class BatchMintBuilder extends OperationBuilder {
  private readonly _entries: BatchMintEntry[];
  private _minter?: PublicKey;
  private _createATAs = false;
  private _ataPayer?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, entries: BatchMintEntry[]) {
    super(ctx);
    if (entries.length === 0) {
      throw new Error("BatchMintBuilder: entries array must not be empty");
    }
    this._entries = entries;
  }

  /**
   * Set the minter for all operations. Accepts PublicKey or Keypair.
   * @param minter - Minter authority (must have Minter role + sufficient quota)
   */
  by(minter: PublicKey | Keypair): this {
    this._minter = toPublicKey(minter);
    const kp = collectKeypair(minter);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  /**
   * Automatically create recipient ATAs if they don't exist (idempotent).
   * Only applies to entries using `to` (wallet address). Duplicate ATAs
   * are deduplicated automatically.
   *
   * @param payer - Account paying for ATA rent (defaults to minter)
   */
  createAccountsIfNeeded(payer?: PublicKey): this {
    this._createATAs = true;
    this._ataPayer = payer;
    return this;
  }

  /**
   * The number of mint entries in this batch.
   */
  get size(): number {
    return this._entries.length;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._minter) {
      throw new Error("BatchMintBuilder: minter not set. Call .by(minter)");
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Minter,
      this._minter,
    );
    const [minterQuota] = getMinterQuotaAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      this._minter,
    );

    const instructions: TransactionInstruction[] = [];

    // Phase 1: Create ATAs (all at once, before any mints, deduplicated)
    if (this._createATAs) {
      const payer = this._ataPayer ?? this._minter;
      const seenATAs = new Set<string>();
      for (const entry of this._entries) {
        if (entry.to) {
          const ata = getAssociatedTokenAddress(this.ctx.mintAddress, entry.to);
          const key = ata.toBase58();
          if (!seenATAs.has(key)) {
            seenATAs.add(key);
            instructions.push(
              createATAInstruction(payer, entry.to, this.ctx.mintAddress),
            );
          }
        }
      }
    }

    // Phase 2: Build mint instructions
    for (const entry of this._entries) {
      let recipientTokenAccount: PublicKey;
      if (entry.toAccount) {
        recipientTokenAccount = entry.toAccount;
      } else if (entry.to) {
        recipientTokenAccount = getAssociatedTokenAddress(
          this.ctx.mintAddress,
          entry.to,
        );
      } else {
        throw new Error(
          "BatchMintBuilder: each entry must specify either `to` or `toAccount`",
        );
      }

      const ix = await this.ctx.program.methods
        .mintTokens(new BN(entry.amount.toString()))
        .accountsStrict({
          minter: this._minter,
          config: this.ctx.configAddress,
          roleAccount,
          minterQuota,
          mint: this.ctx.mintAddress,
          recipientTokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      instructions.push(ix);
    }

    return instructions;
  }
}

// ---------------------------------------------------------------------------
// BatchBurnEntry — describes one burn in a batch
// ---------------------------------------------------------------------------

/**
 * Describes a single burn operation within a batch.
 */
export interface BatchBurnEntry {
  /** Amount to burn (in smallest unit). */
  amount: BN | number;
  /** Source wallet address — ATA will be derived. Mutually exclusive with `fromAccount`. */
  from?: PublicKey;
  /** Source token account address — used directly. Mutually exclusive with `from`. */
  fromAccount?: PublicKey;
}

/**
 * Batch builder for burning tokens from multiple accounts in one transaction.
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
 */
export class BatchBurnBuilder extends OperationBuilder {
  private readonly _entries: BatchBurnEntry[];
  private _burner?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, entries: BatchBurnEntry[]) {
    super(ctx);
    if (entries.length === 0) {
      throw new Error("BatchBurnBuilder: entries array must not be empty");
    }
    this._entries = entries;
  }

  /**
   * Set the burner for all operations. Accepts PublicKey or Keypair.
   * @param burner - Burner authority (must have Burner role)
   */
  by(burner: PublicKey | Keypair): this {
    this._burner = toPublicKey(burner);
    const kp = collectKeypair(burner);
    if (kp) this._additionalSigners.push(kp);
    return this;
  }

  /**
   * The number of burn entries in this batch.
   */
  get size(): number {
    return this._entries.length;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._burner) {
      throw new Error("BatchBurnBuilder: burner not set. Call .by(burner)");
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Burner,
      this._burner,
    );

    const instructions: TransactionInstruction[] = [];

    for (const entry of this._entries) {
      let fromTokenAccount: PublicKey;
      if (entry.fromAccount) {
        fromTokenAccount = entry.fromAccount;
      } else if (entry.from) {
        fromTokenAccount = getAssociatedTokenAddress(
          this.ctx.mintAddress,
          entry.from,
        );
      } else {
        throw new Error(
          "BatchBurnBuilder: each entry must specify either `from` or `fromAccount`",
        );
      }

      const ix = await this.ctx.program.methods
        .burnTokens(new BN(entry.amount.toString()))
        .accountsStrict({
          burner: this._burner,
          config: this.ctx.configAddress,
          roleAccount,
          mint: this.ctx.mintAddress,
          fromTokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      instructions.push(ix);
    }

    return instructions;
  }
}

// ---------------------------------------------------------------------------
// BatchFreezeBuilder
// ---------------------------------------------------------------------------

/**
 * Batch builder for freezing multiple token accounts in one transaction.
 *
 * Accepts wallet addresses — ATAs are derived automatically.
 *
 * @example
 * ```ts
 * const sig = await stablecoin.batchFreeze([alice, bob, carol])
 *   .by(pauserKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class BatchFreezeBuilder extends OperationBuilder {
  private readonly _wallets: PublicKey[];
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, wallets: PublicKey[]) {
    super(ctx);
    if (wallets.length === 0) {
      throw new Error("BatchFreezeBuilder: wallets array must not be empty");
    }
    this._wallets = wallets;
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

  /**
   * The number of accounts to freeze.
   */
  get size(): number {
    return this._wallets.length;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error(
        "BatchFreezeBuilder: authority not set. Call .by(authority)",
      );
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Pauser,
      this._authority,
    );

    const instructions: TransactionInstruction[] = [];

    for (const wallet of this._wallets) {
      const tokenAccount = getAssociatedTokenAddress(
        this.ctx.mintAddress,
        wallet,
      );

      const ix = await this.ctx.program.methods
        .freezeTokenAccount()
        .accountsStrict({
          authority: this._authority,
          config: this.ctx.configAddress,
          roleAccount,
          mint: this.ctx.mintAddress,
          tokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      instructions.push(ix);
    }

    return instructions;
  }
}

// ---------------------------------------------------------------------------
// BatchThawBuilder
// ---------------------------------------------------------------------------

/**
 * Batch builder for thawing multiple frozen token accounts in one transaction.
 *
 * @example
 * ```ts
 * const sig = await stablecoin.batchThaw([alice, bob])
 *   .by(pauserKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class BatchThawBuilder extends OperationBuilder {
  private readonly _wallets: PublicKey[];
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, wallets: PublicKey[]) {
    super(ctx);
    if (wallets.length === 0) {
      throw new Error("BatchThawBuilder: wallets array must not be empty");
    }
    this._wallets = wallets;
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

  /**
   * The number of accounts to thaw.
   */
  get size(): number {
    return this._wallets.length;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error(
        "BatchThawBuilder: authority not set. Call .by(authority)",
      );
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Pauser,
      this._authority,
    );

    const instructions: TransactionInstruction[] = [];

    for (const wallet of this._wallets) {
      const tokenAccount = getAssociatedTokenAddress(
        this.ctx.mintAddress,
        wallet,
      );

      const ix = await this.ctx.program.methods
        .thawTokenAccount()
        .accountsStrict({
          authority: this._authority,
          config: this.ctx.configAddress,
          roleAccount,
          mint: this.ctx.mintAddress,
          tokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      instructions.push(ix);
    }

    return instructions;
  }
}

// ---------------------------------------------------------------------------
// BatchBlacklistEntry
// ---------------------------------------------------------------------------

/**
 * Describes a single blacklist-add operation within a batch.
 */
export interface BatchBlacklistEntry {
  /** Address to blacklist. */
  address: PublicKey;
  /** Reason for blacklisting (max 64 chars). Defaults to empty string. */
  reason?: string;
}

/**
 * Batch builder for blacklisting multiple addresses in one transaction (SSS-2).
 *
 * @example
 * ```ts
 * const sig = await stablecoin.compliance.batchBlacklistAdd([
 *   { address: alice, reason: "OFAC SDN match" },
 *   { address: bob, reason: "Suspicious activity" },
 * ])
 *   .by(blacklisterKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class BatchBlacklistAddBuilder extends OperationBuilder {
  private readonly _entries: BatchBlacklistEntry[];
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, entries: BatchBlacklistEntry[]) {
    super(ctx);
    if (entries.length === 0) {
      throw new Error(
        "BatchBlacklistAddBuilder: entries array must not be empty",
      );
    }
    this._entries = entries;
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

  /**
   * The number of addresses to blacklist.
   */
  get size(): number {
    return this._entries.length;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error(
        "BatchBlacklistAddBuilder: authority not set. Call .by(authority)",
      );
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Blacklister,
      this._authority,
    );

    const instructions: TransactionInstruction[] = [];

    for (const entry of this._entries) {
      const [blacklistEntry] = getBlacklistEntryAddress(
        this.ctx.program.programId,
        this.ctx.configAddress,
        entry.address,
      );

      const ix = await this.ctx.program.methods
        .addToBlacklist(entry.address, entry.reason ?? "", Array(32).fill(0), "")
        .accountsStrict({
          authority: this._authority,
          config: this.ctx.configAddress,
          roleAccount,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      instructions.push(ix);
    }

    return instructions;
  }
}

// ---------------------------------------------------------------------------
// BatchBlacklistRemoveBuilder
// ---------------------------------------------------------------------------

/**
 * Batch builder for removing multiple addresses from the blacklist (SSS-2).
 *
 * @example
 * ```ts
 * const sig = await stablecoin.compliance.batchBlacklistRemove([alice, bob])
 *   .by(blacklisterKeypair)
 *   .send(payerKeypair);
 * ```
 */
export class BatchBlacklistRemoveBuilder extends OperationBuilder {
  private readonly _addresses: PublicKey[];
  private _authority?: PublicKey;

  /** @internal */
  constructor(ctx: BuilderContext, addresses: PublicKey[]) {
    super(ctx);
    if (addresses.length === 0) {
      throw new Error(
        "BatchBlacklistRemoveBuilder: addresses array must not be empty",
      );
    }
    this._addresses = addresses;
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

  /**
   * The number of addresses to remove from the blacklist.
   */
  get size(): number {
    return this._addresses.length;
  }

  protected async buildCoreInstructions(): Promise<TransactionInstruction[]> {
    if (!this._authority) {
      throw new Error(
        "BatchBlacklistRemoveBuilder: authority not set. Call .by(authority)",
      );
    }

    const [roleAccount] = getRoleAddress(
      this.ctx.program.programId,
      this.ctx.configAddress,
      RoleType.Blacklister,
      this._authority,
    );

    const instructions: TransactionInstruction[] = [];

    for (const address of this._addresses) {
      const [blacklistEntry] = getBlacklistEntryAddress(
        this.ctx.program.programId,
        this.ctx.configAddress,
        address,
      );

      const ix = await this.ctx.program.methods
        .removeFromBlacklist(address)
        .accountsStrict({
          authority: this._authority,
          config: this.ctx.configAddress,
          roleAccount,
          blacklistEntry,
        })
        .instruction();

      instructions.push(ix);
    }

    return instructions;
  }
}
