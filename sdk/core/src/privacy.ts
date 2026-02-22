/**
 * @module Privacy Module
 *
 * SDK module for interacting with the SSS Privacy program, which manages
 * scoped allowlists for Token-2022 confidential transfers on SSS-3 stablecoins.
 *
 * The privacy module is a companion program — the SSS stablecoin program enables
 * the ConfidentialTransferMint extension on the Token-2022 mint, and this program
 * manages which addresses are permitted to use confidential transfers via an
 * on-chain allowlist.
 *
 * ## Quick Start
 * ```ts
 * import { PrivacyModule } from "@stbr/sss-core-sdk";
 *
 * // Load privacy module for an existing stablecoin
 * const privacy = await PrivacyModule.load(connection, stablecoinConfigAddress);
 *
 * // Initialize privacy config (authority only, once per stablecoin)
 * const initIx = await privacy.initialize(authority, { autoApprove: true });
 *
 * // Manage allowlist
 * const addIx = await privacy.addToAllowlist(authority, userAddress, "KYC verified");
 * const removeIx = await privacy.removeFromAllowlist(authority, userAddress);
 *
 * // Read state
 * const config = await privacy.getConfig();
 * const isAllowed = await privacy.isOnAllowlist(userAddress);
 * ```
 *
 * @packageDocumentation
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN, Idl, Wallet } from "@coral-xyz/anchor";

import privacyIdl from "../../../target/idl/sss_privacy.json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default privacy program ID (localnet/devnet). */
export const PRIVACY_PROGRAM_ID = new PublicKey(
  "Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk"
);

const PRIVACY_CONFIG_SEED = Buffer.from("privacy_config");
const ALLOWLIST_SEED = Buffer.from("allowlist");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * On-chain privacy configuration data.
 *
 * @see {@link PrivacyModule.getConfig}
 */
export interface PrivacyConfigData {
  /** Authority who can manage this privacy config. */
  authority: PublicKey;
  /** The SSS stablecoin config PDA this privacy config is linked to. */
  stablecoinConfig: PublicKey;
  /** Whether new accounts are auto-approved for confidential transfers. */
  autoApprove: boolean;
  /** Total number of addresses on the allowlist. */
  allowlistCount: number;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain allowlist entry data.
 *
 * @see {@link PrivacyModule.getAllowlistEntry}
 */
export interface AllowlistEntryData {
  /** The privacy config this entry belongs to. */
  config: PublicKey;
  /** The allowed address. */
  address: PublicKey;
  /** Optional label for the entry (e.g., "KYC verified"). */
  label: string;
  /** Unix timestamp when the address was added. */
  addedAt: BN;
  /** Authority who added this entry. */
  addedBy: PublicKey;
  /** PDA bump seed. */
  bump: number;
}

/**
 * Parameters for initializing a privacy configuration.
 *
 * @see {@link PrivacyModule.initialize}
 */
export interface InitPrivacyParams {
  /** Whether new accounts should be auto-approved for confidential transfers. */
  autoApprove: boolean;
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

/**
 * Derive the PrivacyConfig PDA address.
 *
 * Seeds: `["privacy_config", stablecoin_config_pubkey]`
 *
 * @param privacyProgramId   - The Privacy program ID
 * @param stablecoinConfig   - The SSS StablecoinConfig PDA pubkey
 * @returns [privacyConfigAddress, bump]
 */
export function getPrivacyConfigAddress(
  privacyProgramId: PublicKey,
  stablecoinConfig: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PRIVACY_CONFIG_SEED, stablecoinConfig.toBuffer()],
    privacyProgramId
  );
}

/**
 * Derive an AllowlistEntry PDA address.
 *
 * Seeds: `["allowlist", privacy_config_pubkey, address_pubkey]`
 *
 * @param privacyProgramId   - The Privacy program ID
 * @param privacyConfig      - The PrivacyConfig PDA pubkey
 * @param address            - The address to check
 * @returns [allowlistEntryAddress, bump]
 */
export function getAllowlistEntryAddress(
  privacyProgramId: PublicKey,
  privacyConfig: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ALLOWLIST_SEED, privacyConfig.toBuffer(), address.toBuffer()],
    privacyProgramId
  );
}

// ---------------------------------------------------------------------------
// PrivacyModule
// ---------------------------------------------------------------------------

/**
 * SDK module for the SSS Privacy program (confidential transfer allowlist).
 *
 * Provides methods to initialize and manage a privacy configuration linked to
 * an SSS-3 stablecoin, including scoped allowlist management for controlling
 * which addresses may use Token-2022 confidential transfers.
 *
 * @example
 * ```ts
 * // Load privacy module
 * const privacy = await PrivacyModule.load(connection, stablecoinConfigAddress);
 *
 * // Initialize
 * const initIx = await privacy.initialize(authority, { autoApprove: true });
 *
 * // Add user to allowlist
 * const addIx = await privacy.addToAllowlist(authority, userPubkey, "KYC passed");
 *
 * // Check if user is allowed
 * const allowed = await privacy.isOnAllowlist(userPubkey);
 * ```
 */
export class PrivacyModule {
  /** The Anchor Program instance for the privacy module. */
  public readonly program: Program;
  /** The PrivacyConfig PDA address. */
  public readonly privacyConfigAddress: PublicKey;
  /** The SSS stablecoin config PDA this privacy module is linked to. */
  public readonly stablecoinConfig: PublicKey;
  /** The Privacy program ID. */
  public readonly programId: PublicKey;

  private constructor(
    program: Program,
    privacyConfigAddress: PublicKey,
    stablecoinConfig: PublicKey
  ) {
    this.program = program;
    this.privacyConfigAddress = privacyConfigAddress;
    this.stablecoinConfig = stablecoinConfig;
    this.programId = program.programId;
  }

  /**
   * Load an existing privacy module for a stablecoin.
   *
   * @param connection        - Solana RPC connection
   * @param stablecoinConfig  - The SSS StablecoinConfig PDA address
   * @param privacyProgramId  - The Privacy program ID (defaults to `PRIVACY_PROGRAM_ID`)
   * @returns A configured PrivacyModule instance
   */
  static async load(
    connection: Connection,
    stablecoinConfig: PublicKey,
    privacyProgramId: PublicKey = PRIVACY_PROGRAM_ID
  ): Promise<PrivacyModule> {
    const provider = new AnchorProvider(
      connection,
      {
        publicKey: PublicKey.default,
        signTransaction: async (tx) => tx,
        signAllTransactions: async (txs) => txs,
      } as Wallet,
      { commitment: "confirmed" }
    );
    const program = new Program(privacyIdl as Idl, provider);

    const [privacyConfigAddress] = getPrivacyConfigAddress(
      privacyProgramId,
      stablecoinConfig
    );

    return new PrivacyModule(program, privacyConfigAddress, stablecoinConfig);
  }

  /**
   * Create a new PrivacyModule from an existing Anchor Program instance.
   *
   * @param program           - An Anchor Program instance for the privacy IDL
   * @param stablecoinConfig  - The SSS StablecoinConfig PDA address
   * @returns A configured PrivacyModule instance
   */
  static fromProgram(
    program: Program,
    stablecoinConfig: PublicKey
  ): PrivacyModule {
    const [privacyConfigAddress] = getPrivacyConfigAddress(
      program.programId,
      stablecoinConfig
    );
    return new PrivacyModule(program, privacyConfigAddress, stablecoinConfig);
  }

  // ── Read methods ─────────────────────────────────────────────────────

  /**
   * Fetch the privacy configuration from on-chain.
   *
   * @returns The privacy config data, or `null` if not initialized
   */
  async getConfig(): Promise<PrivacyConfigData | null> {
    try {
      const account = await (
        this.program.account as Record<
          string,
          { fetch: (addr: PublicKey) => Promise<Record<string, unknown>> }
        >
      )["privacyConfig"].fetch(this.privacyConfigAddress);

      return {
        authority: account.authority as PublicKey,
        stablecoinConfig: account.stablecoinConfig as PublicKey,
        autoApprove: account.autoApprove as boolean,
        allowlistCount: account.allowlistCount as number,
        bump: account.bump as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch an allowlist entry for a specific address.
   *
   * @param address - The address to look up
   * @returns The allowlist entry data, or `null` if not on the allowlist
   */
  async getAllowlistEntry(
    address: PublicKey
  ): Promise<AllowlistEntryData | null> {
    const [entryAddress] = getAllowlistEntryAddress(
      this.programId,
      this.privacyConfigAddress,
      address
    );

    try {
      const account = await (
        this.program.account as Record<
          string,
          { fetch: (addr: PublicKey) => Promise<Record<string, unknown>> }
        >
      )["allowlistEntry"].fetch(entryAddress);

      return {
        config: account.config as PublicKey,
        address: account.address as PublicKey,
        label: account.label as string,
        addedAt: account.addedAt as BN,
        addedBy: account.addedBy as PublicKey,
        bump: account.bump as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if an address is on the allowlist.
   *
   * @param address - The address to check
   * @returns `true` if the address has an active allowlist entry
   */
  async isOnAllowlist(address: PublicKey): Promise<boolean> {
    const entry = await this.getAllowlistEntry(address);
    return entry !== null;
  }

  // ── Write methods (return TransactionInstruction) ────────────────────

  /**
   * Build an instruction to initialize a new privacy configuration.
   *
   * @param authority  - The authority (signer + payer)
   * @param params     - Privacy initialization parameters
   * @returns TransactionInstruction
   */
  async initialize(
    authority: PublicKey,
    params: InitPrivacyParams
  ): Promise<TransactionInstruction> {
    return await (
      this.program.methods as Record<
        string,
        (
          ...args: unknown[]
        ) => {
          accounts: (
            accts: Record<string, PublicKey>
          ) => { instruction: () => Promise<TransactionInstruction> };
        }
      >
    )
      .initializePrivacy({
        autoApprove: params.autoApprove,
      })
      .accounts({
        authority,
        privacyConfig: this.privacyConfigAddress,
        stablecoinConfig: this.stablecoinConfig,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build an instruction to update the privacy configuration.
   *
   * @param authority    - The privacy config authority
   * @param autoApprove  - New auto-approve setting (or `null` to leave unchanged)
   * @returns TransactionInstruction
   */
  async updateConfig(
    authority: PublicKey,
    autoApprove: boolean | null
  ): Promise<TransactionInstruction> {
    return await (
      this.program.methods as Record<
        string,
        (
          ...args: unknown[]
        ) => {
          accounts: (
            accts: Record<string, PublicKey>
          ) => { instruction: () => Promise<TransactionInstruction> };
        }
      >
    )
      .updatePrivacyConfig({
        autoApprove,
      })
      .accounts({
        authority,
        privacyConfig: this.privacyConfigAddress,
      })
      .instruction();
  }

  /**
   * Build an instruction to add an address to the allowlist.
   *
   * @param authority  - The privacy config authority (signer + payer)
   * @param address    - The address to add
   * @param label      - Optional label (max 32 chars, e.g., "KYC verified")
   * @returns TransactionInstruction
   */
  async addToAllowlist(
    authority: PublicKey,
    address: PublicKey,
    label: string = ""
  ): Promise<TransactionInstruction> {
    const [allowlistEntry] = getAllowlistEntryAddress(
      this.programId,
      this.privacyConfigAddress,
      address
    );

    return await (
      this.program.methods as Record<
        string,
        (
          ...args: unknown[]
        ) => {
          accounts: (
            accts: Record<string, PublicKey>
          ) => { instruction: () => Promise<TransactionInstruction> };
        }
      >
    )
      .addToAllowlist({
        label,
      })
      .accounts({
        authority,
        privacyConfig: this.privacyConfigAddress,
        allowlistEntry,
        address,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Build an instruction to remove an address from the allowlist.
   *
   * The AllowlistEntry PDA is closed and rent is returned to the authority.
   *
   * @param authority  - The privacy config authority
   * @param address    - The address to remove
   * @returns TransactionInstruction
   */
  async removeFromAllowlist(
    authority: PublicKey,
    address: PublicKey
  ): Promise<TransactionInstruction> {
    const [allowlistEntry] = getAllowlistEntryAddress(
      this.programId,
      this.privacyConfigAddress,
      address
    );

    return await (
      this.program.methods as Record<
        string,
        (
          ...args: unknown[]
        ) => {
          accounts: (
            accts: Record<string, PublicKey>
          ) => { instruction: () => Promise<TransactionInstruction> };
        }
      >
    )
      .removeFromAllowlist()
      .accounts({
        authority,
        privacyConfig: this.privacyConfigAddress,
        allowlistEntry,
      })
      .instruction();
  }
}
