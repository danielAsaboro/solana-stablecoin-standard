/**
 * @module Oracle Integration Module
 *
 * SDK module for interacting with the SSS Oracle program, which provides
 * Switchboard V2 price feeds for non-USD stablecoin pegs (EUR, BRL, CPI, etc.).
 *
 * The oracle is a companion program — the SSS stablecoin program itself is
 * unchanged. The oracle stores verified, bounds-checked prices that the backend
 * or SDK reads when calculating mint/redeem amounts at the correct exchange rate.
 *
 * ## Quick Start
 * ```ts
 * import { OracleModule } from "@stbr/sss-core-sdk";
 *
 * // Load oracle for an existing stablecoin
 * const oracle = await OracleModule.load(connection, stablecoinConfigAddress);
 *
 * // Read the latest price
 * const price = await oracle.getPrice();
 * console.log(`1 token = ${price.formatted} ${price.baseCurrency}`);
 *
 * // Convert: how many tokens for 100 BRL?
 * const tokens = oracle.fiatToTokens(100, 6); // 6 = token decimals
 * ```
 *
 * @packageDocumentation
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl, Wallet } from "@coral-xyz/anchor";

import oracleIdl from "../../../target/idl/sss_oracle.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default oracle program ID (localnet/devnet). */
export const ORACLE_PROGRAM_ID = new PublicKey(
  "6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ"
);

const ORACLE_CONFIG_SEED = Buffer.from("oracle_config");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * On-chain oracle configuration and latest price data.
 *
 * @see {@link OracleModule.getConfig}
 */
export interface OracleConfigData {
  /** Authority who can update the oracle config. */
  authority: PublicKey;
  /** The SSS stablecoin config PDA this oracle is linked to. */
  stablecoinConfig: PublicKey;
  /** The Switchboard V2 aggregator account address. */
  aggregator: PublicKey;
  /** Base currency identifier (e.g., "USD", "BRL", "EUR"). */
  baseCurrency: string;
  /** Maximum acceptable age (seconds) of aggregator price data. */
  stalenessThreshold: BN;
  /** Number of decimal places for price values. */
  priceDecimals: number;
  /** Minimum acceptable price (scaled). */
  minPrice: BN;
  /** Maximum acceptable price (scaled). */
  maxPrice: BN;
  /** Whether manual price pushing is enabled. */
  manualOverride: boolean;
  /** Latest verified price (scaled by 10^priceDecimals). */
  lastPrice: BN;
  /** Unix timestamp of latest verified price. */
  lastTimestamp: BN;
  /** PDA bump seed. */
  bump: number;
}

/**
 * Human-friendly price reading from the oracle.
 *
 * @see {@link OracleModule.getPrice}
 */
export interface OraclePrice {
  /** Raw price value (scaled by 10^priceDecimals). */
  raw: BN;
  /** Price as a floating-point number. */
  value: number;
  /** Formatted price string (e.g., "1.085000"). */
  formatted: string;
  /** Base currency (e.g., "BRL"). */
  baseCurrency: string;
  /** Number of decimal places. */
  priceDecimals: number;
  /** Unix timestamp of the price data. */
  timestamp: number;
  /** Whether the price data is stale (older than staleness threshold). */
  isStale: boolean;
}

/**
 * Parameters for initializing an oracle configuration.
 *
 * @see {@link OracleModule.initialize}
 */
export interface InitOracleParams {
  /** Base currency identifier (max 8 chars). */
  baseCurrency: string;
  /** Max acceptable age of price data in seconds. */
  stalenessThreshold: number;
  /** Number of decimal places for price values. */
  priceDecimals: number;
  /** Minimum acceptable price (scaled by 10^priceDecimals). */
  minPrice: BN | number;
  /** Maximum acceptable price (scaled by 10^priceDecimals). */
  maxPrice: BN | number;
  /** Enable manual price pushing. */
  manualOverride: boolean;
}

/**
 * Parameters for updating oracle configuration. All fields are optional.
 *
 * @see {@link OracleModule.updateConfig}
 */
export interface UpdateOracleParams {
  /** New Switchboard aggregator address. */
  newAggregator?: PublicKey;
  /** New staleness threshold in seconds. */
  newStalenessThreshold?: number;
  /** New minimum price. */
  newMinPrice?: BN | number;
  /** New maximum price. */
  newMaxPrice?: BN | number;
  /** Enable or disable manual override. */
  newManualOverride?: boolean;
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

/**
 * Derive the OracleConfig PDA address.
 *
 * Seeds: `["oracle_config", stablecoin_config_pubkey]`
 *
 * @param oracleProgramId    - The Oracle program ID
 * @param stablecoinConfig   - The SSS StablecoinConfig PDA pubkey
 * @returns [oracleConfigAddress, bump]
 */
export function getOracleConfigAddress(
  oracleProgramId: PublicKey,
  stablecoinConfig: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORACLE_CONFIG_SEED, stablecoinConfig.toBuffer()],
    oracleProgramId
  );
}

// ---------------------------------------------------------------------------
// OracleModule
// ---------------------------------------------------------------------------

/**
 * SDK module for the SSS Oracle Integration program.
 *
 * Provides methods to initialize and manage oracle configurations, read prices
 * from Switchboard V2 feeds, push manual prices, and convert between fiat and
 * token amounts using the oracle price.
 *
 * @example
 * ```ts
 * // Load an existing oracle
 * const oracle = await OracleModule.load(connection, stablecoinConfigAddress);
 *
 * // Get current price
 * const price = await oracle.getPrice();
 * console.log(`Rate: ${price.formatted} ${price.baseCurrency}`);
 *
 * // Calculate token amount for 500 BRL at current rate
 * const tokenAmount = oracle.fiatToTokens(500, 6);
 * ```
 */
export class OracleModule {
  /** The Anchor Program instance for the oracle. */
  public readonly program: Program;
  /** The OracleConfig PDA address. */
  public readonly oracleConfigAddress: PublicKey;
  /** The SSS stablecoin config PDA this oracle is linked to. */
  public readonly stablecoinConfig: PublicKey;
  /** The Oracle program ID. */
  public readonly programId: PublicKey;

  private cachedConfig: OracleConfigData | null = null;

  private constructor(
    program: Program,
    oracleConfigAddress: PublicKey,
    stablecoinConfig: PublicKey
  ) {
    this.program = program;
    this.oracleConfigAddress = oracleConfigAddress;
    this.stablecoinConfig = stablecoinConfig;
    this.programId = program.programId;
  }

  /**
   * Load an existing oracle configuration.
   *
   * @param connection        - Solana RPC connection
   * @param stablecoinConfig  - The SSS StablecoinConfig PDA address
   * @param oracleProgramId   - The Oracle program ID (defaults to `ORACLE_PROGRAM_ID`)
   * @returns A configured OracleModule instance
   */
  static async load(
    connection: Connection,
    stablecoinConfig: PublicKey,
    oracleProgramId: PublicKey = ORACLE_PROGRAM_ID
  ): Promise<OracleModule> {
    const provider = new AnchorProvider(
      connection,
      { publicKey: PublicKey.default, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs } as Wallet,
      { commitment: "confirmed" }
    );
    const program = new Program(oracleIdl as Idl, provider);

    const [oracleConfigAddress] = getOracleConfigAddress(
      oracleProgramId,
      stablecoinConfig
    );

    return new OracleModule(program, oracleConfigAddress, stablecoinConfig);
  }

  /**
   * Create a new OracleModule from an existing Anchor Program instance.
   *
   * @param program           - An Anchor Program instance for the oracle IDL
   * @param stablecoinConfig  - The SSS StablecoinConfig PDA address
   * @returns A configured OracleModule instance
   */
  static fromProgram(
    program: Program,
    stablecoinConfig: PublicKey
  ): OracleModule {
    const [oracleConfigAddress] = getOracleConfigAddress(
      program.programId,
      stablecoinConfig
    );
    return new OracleModule(program, oracleConfigAddress, stablecoinConfig);
  }

  // ── Read methods ─────────────────────────────────────────────────────

  /**
   * Fetch the full oracle configuration from on-chain.
   *
   * @returns The oracle config data, or `null` if not initialized
   */
  async getConfig(): Promise<OracleConfigData | null> {
    try {
      const account = await (this.program.account as Record<string, { fetch: (addr: PublicKey) => Promise<Record<string, unknown>> }>)["oracleConfig"].fetch(this.oracleConfigAddress);
      const config: OracleConfigData = {
        authority: account.authority as PublicKey,
        stablecoinConfig: account.stablecoinConfig as PublicKey,
        aggregator: account.aggregator as PublicKey,
        baseCurrency: account.baseCurrency as string,
        stalenessThreshold: account.stalenessThreshold as BN,
        priceDecimals: account.priceDecimals as number,
        minPrice: account.minPrice as BN,
        maxPrice: account.maxPrice as BN,
        manualOverride: account.manualOverride as boolean,
        lastPrice: account.lastPrice as BN,
        lastTimestamp: account.lastTimestamp as BN,
        bump: account.bump as number,
      };
      this.cachedConfig = config;
      return config;
    } catch {
      return null;
    }
  }

  /**
   * Get the latest verified price in a human-friendly format.
   *
   * Fetches the oracle config and converts the raw price into a readable
   * format with staleness detection.
   *
   * @returns The current price, or `null` if oracle is not initialized or price is zero
   */
  async getPrice(): Promise<OraclePrice | null> {
    const config = await this.getConfig();
    if (!config || config.lastPrice.isZero()) return null;

    const priceDecimals = config.priceDecimals;
    const divisor = Math.pow(10, priceDecimals);
    const value = config.lastPrice.toNumber() / divisor;
    const formatted = value.toFixed(priceDecimals);
    const timestamp = config.lastTimestamp.toNumber();
    const now = Math.floor(Date.now() / 1000);
    const isStale =
      now - timestamp > config.stalenessThreshold.toNumber();

    return {
      raw: config.lastPrice,
      value,
      formatted,
      baseCurrency: config.baseCurrency,
      priceDecimals,
      timestamp,
      isStale,
    };
  }

  // ── Price conversion helpers ─────────────────────────────────────────

  /**
   * Convert a fiat amount to token base units using the cached oracle price.
   *
   * Formula: `tokens = fiatAmount * 10^tokenDecimals / oraclePrice * 10^priceDecimals`
   *
   * @param fiatAmount     - The fiat amount (e.g., 100 for 100 BRL)
   * @param tokenDecimals  - The stablecoin's decimal places (e.g., 6)
   * @returns Token amount in base units (e.g., 100_000_000 for 100 tokens with 6 decimals at rate 1.0)
   * @throws If oracle config is not loaded (call `getConfig()` or `getPrice()` first)
   */
  fiatToTokens(fiatAmount: number, tokenDecimals: number): BN {
    if (!this.cachedConfig) {
      throw new Error(
        "Oracle config not loaded. Call getConfig() or getPrice() first."
      );
    }

    const price = this.cachedConfig.lastPrice.toNumber();
    const priceDecimals = this.cachedConfig.priceDecimals;

    if (price === 0) {
      throw new Error("Oracle price is zero — cannot convert.");
    }

    // tokens = fiatAmount * 10^tokenDecimals * 10^priceDecimals / price
    const tokenScale = Math.pow(10, tokenDecimals);
    const priceScale = Math.pow(10, priceDecimals);
    const tokens = Math.floor((fiatAmount * tokenScale * priceScale) / price);
    return new BN(tokens);
  }

  /**
   * Convert a token amount (base units) to fiat using the cached oracle price.
   *
   * @param tokenAmount    - Token amount in base units
   * @param tokenDecimals  - The stablecoin's decimal places (e.g., 6)
   * @returns Fiat amount as a number (e.g., 100.50 for 100.50 BRL)
   * @throws If oracle config is not loaded
   */
  tokensToFiat(tokenAmount: BN | number, tokenDecimals: number): number {
    if (!this.cachedConfig) {
      throw new Error(
        "Oracle config not loaded. Call getConfig() or getPrice() first."
      );
    }

    const price = this.cachedConfig.lastPrice.toNumber();
    const priceDecimals = this.cachedConfig.priceDecimals;

    if (price === 0) {
      throw new Error("Oracle price is zero — cannot convert.");
    }

    const amount =
      typeof tokenAmount === "number" ? tokenAmount : tokenAmount.toNumber();
    const tokenScale = Math.pow(10, tokenDecimals);
    const priceScale = Math.pow(10, priceDecimals);
    return (amount * price) / (tokenScale * priceScale);
  }

  // ── Write methods (return TransactionInstruction) ────────────────────

  /**
   * Build an instruction to initialize a new oracle configuration.
   *
   * @param authority          - The authority (signer + payer)
   * @param aggregator         - Switchboard V2 aggregator account address
   * @param params             - Oracle initialization parameters
   * @returns TransactionInstruction
   */
  async initialize(
    authority: PublicKey,
    aggregator: PublicKey,
    params: InitOracleParams
  ): Promise<TransactionInstruction> {
    const minPrice =
      typeof params.minPrice === "number"
        ? new BN(params.minPrice)
        : params.minPrice;
    const maxPrice =
      typeof params.maxPrice === "number"
        ? new BN(params.maxPrice)
        : params.maxPrice;

    return await (this.program.methods as Record<string, (...args: unknown[]) => {
      accounts: (accts: Record<string, PublicKey>) => { instruction: () => Promise<TransactionInstruction> };
    }>)
      .initializeOracle({
        baseCurrency: params.baseCurrency,
        stalenessThreshold: new BN(params.stalenessThreshold),
        priceDecimals: params.priceDecimals,
        minPrice,
        maxPrice,
        manualOverride: params.manualOverride,
      })
      .accounts({
        authority,
        oracleConfig: this.oracleConfigAddress,
        stablecoinConfig: this.stablecoinConfig,
        aggregator,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build an instruction to update oracle configuration.
   *
   * @param authority  - The oracle config authority
   * @param params     - Fields to update (all optional)
   * @returns TransactionInstruction
   */
  async updateConfig(
    authority: PublicKey,
    params: UpdateOracleParams
  ): Promise<TransactionInstruction> {
    return await (this.program.methods as Record<string, (...args: unknown[]) => {
      accounts: (accts: Record<string, PublicKey>) => { instruction: () => Promise<TransactionInstruction> };
    }>)
      .updateOracleConfig({
        newAggregator: params.newAggregator ?? null,
        newStalenessThreshold: params.newStalenessThreshold
          ? new BN(params.newStalenessThreshold)
          : null,
        newMinPrice:
          params.newMinPrice !== undefined
            ? typeof params.newMinPrice === "number"
              ? new BN(params.newMinPrice)
              : params.newMinPrice
            : null,
        newMaxPrice:
          params.newMaxPrice !== undefined
            ? typeof params.newMaxPrice === "number"
              ? new BN(params.newMaxPrice)
              : params.newMaxPrice
            : null,
        newManualOverride: params.newManualOverride ?? null,
      })
      .accounts({
        authority,
        oracleConfig: this.oracleConfigAddress,
      })
      .instruction();
  }

  /**
   * Build an instruction to refresh the price from the Switchboard aggregator.
   *
   * This is permissionless — anyone can crank the price update.
   *
   * @param caller      - The signer triggering the refresh
   * @param aggregator  - The Switchboard aggregator account (must match config)
   * @returns TransactionInstruction
   */
  async refreshPrice(
    caller: PublicKey,
    aggregator: PublicKey
  ): Promise<TransactionInstruction> {
    return await (this.program.methods as Record<string, (...args: unknown[]) => {
      accounts: (accts: Record<string, PublicKey>) => { instruction: () => Promise<TransactionInstruction> };
    }>)
      .refreshPrice()
      .accounts({
        caller,
        oracleConfig: this.oracleConfigAddress,
        aggregator,
      })
      .instruction();
  }

  /**
   * Build an instruction to push a manual price.
   *
   * Requires `manualOverride` to be enabled on the oracle config.
   *
   * @param authority  - The oracle config authority
   * @param price      - Price value (scaled by 10^priceDecimals)
   * @returns TransactionInstruction
   */
  async pushManualPrice(
    authority: PublicKey,
    price: BN | number
  ): Promise<TransactionInstruction> {
    const priceBN = typeof price === "number" ? new BN(price) : price;

    return await (this.program.methods as Record<string, (...args: unknown[]) => {
      accounts: (accts: Record<string, PublicKey>) => { instruction: () => Promise<TransactionInstruction> };
    }>)
      .pushManualPrice(priceBN)
      .accounts({
        authority,
        oracleConfig: this.oracleConfigAddress,
      })
      .instruction();
  }
}
