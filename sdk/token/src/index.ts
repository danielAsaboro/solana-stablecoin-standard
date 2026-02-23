/**
 * @stbr/sss-token — Solana Stablecoin Standard
 *
 * Primary consumer entrypoint for the Solana Stablecoin Standard SDK.
 * This package re-exports everything from `@stbr/sss-core-sdk`.
 *
 * ## Usage (matches bounty spec exactly)
 * ```ts
 * import { SolanaStablecoin, Presets } from "@stbr/sss-token";
 *
 * // Create an SSS-2 compliant stablecoin
 * const stable = await SolanaStablecoin.create(connection, {
 *   preset: Presets.SSS_2,
 *   name: "My Stablecoin",
 *   symbol: "MYUSD",
 *   decimals: 6,
 *   authority: adminKeypair,
 * });
 *
 * // Or custom config
 * const custom = await SolanaStablecoin.create(connection, {
 *   name: "Custom Stable",
 *   symbol: "CUSD",
 *   extensions: { permanentDelegate: true, transferHook: false },
 * });
 *
 * // Operations
 * await stable.mint({ recipient, amount: 1_000_000, minter });
 * await stable.compliance.blacklistAdd(address, "Sanctions match"); // SSS-2
 * await stable.compliance.seize(frozenAccount, treasury);           // SSS-2
 * const supply = await stable.getTotalSupply();
 * ```
 *
 * @module @stbr/sss-token
 * @packageDocumentation
 */

// Re-export the entire core SDK surface — everything available from
// @stbr/sss-core-sdk is available here as @stbr/sss-token.
export * from "@stbr/sss-core-sdk";
