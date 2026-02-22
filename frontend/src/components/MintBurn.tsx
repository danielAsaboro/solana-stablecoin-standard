"use client";

import { useState, FormEvent } from "react";
import { PublicKey } from "@solana/web3.js";

interface MintBurnProps {
  config: { decimals: number; paused: boolean; symbol: string } | null;
  mintAddress: PublicKey | null;
  onMint: (recipient: string, amount: string) => Promise<string>;
  onBurn: (fromAccount: string, amount: string) => Promise<string>;
}

interface FormResult {
  type: "success" | "error";
  message: string;
}

function truncateSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-8)}`;
}

export default function MintBurn({
  config,
  mintAddress,
  onMint,
  onBurn,
}: MintBurnProps) {
  const [mintRecipient, setMintRecipient] = useState("");
  const [mintAmount, setMintAmount] = useState("");
  const [mintLoading, setMintLoading] = useState(false);
  const [mintResult, setMintResult] = useState<FormResult | null>(null);

  const [burnAccount, setBurnAccount] = useState("");
  const [burnAmount, setBurnAmount] = useState("");
  const [burnLoading, setBurnLoading] = useState(false);
  const [burnResult, setBurnResult] = useState<FormResult | null>(null);

  const isDisabled = !config || config.paused;

  async function handleMint(e: FormEvent) {
    e.preventDefault();
    setMintLoading(true);
    setMintResult(null);

    try {
      const sig = await onMint(mintRecipient, mintAmount);
      setMintResult({
        type: "success",
        message: `Minted successfully. Tx: ${truncateSig(sig)}`,
      });
      setMintRecipient("");
      setMintAmount("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Mint transaction failed";
      setMintResult({ type: "error", message });
    } finally {
      setMintLoading(false);
    }
  }

  async function handleBurn(e: FormEvent) {
    e.preventDefault();
    setBurnLoading(true);
    setBurnResult(null);

    try {
      const sig = await onBurn(burnAccount, burnAmount);
      setBurnResult({
        type: "success",
        message: `Burned successfully. Tx: ${truncateSig(sig)}`,
      });
      setBurnAccount("");
      setBurnAmount("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Burn transaction failed";
      setBurnResult({ type: "error", message });
    } finally {
      setBurnLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Mint Tokens Card */}
      <div className="card">
        <h2 className="card-header">Mint Tokens</h2>
        <form onSubmit={handleMint} className="space-y-4">
          <div>
            <input
              type="text"
              className="input-field"
              placeholder="Recipient wallet address"
              value={mintRecipient}
              onChange={(e) => setMintRecipient(e.target.value)}
              disabled={isDisabled || mintLoading}
            />
          </div>
          <div>
            <input
              type="number"
              className="input-field"
              placeholder="Amount in base units"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              disabled={isDisabled || mintLoading}
              min="0"
            />
          </div>
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={
              isDisabled || mintLoading || !mintRecipient || !mintAmount
            }
          >
            {mintLoading ? "Minting..." : "Mint Tokens"}
          </button>
          <p className="text-xs text-gray-500">
            Tokens will be minted to the recipient&apos;s associated token
            account
          </p>
          {mintResult && (
            <p
              className={
                mintResult.type === "success"
                  ? "text-sm text-green-400"
                  : "text-sm text-red-400"
              }
            >
              {mintResult.message}
            </p>
          )}
        </form>
      </div>

      {/* Burn Tokens Card */}
      <div className="card">
        <h2 className="card-header">Burn Tokens</h2>
        <form onSubmit={handleBurn} className="space-y-4">
          <div>
            <input
              type="text"
              className="input-field"
              placeholder="Token account to burn from"
              value={burnAccount}
              onChange={(e) => setBurnAccount(e.target.value)}
              disabled={isDisabled || burnLoading}
            />
          </div>
          <div>
            <input
              type="number"
              className="input-field"
              placeholder="Amount in base units"
              value={burnAmount}
              onChange={(e) => setBurnAmount(e.target.value)}
              disabled={isDisabled || burnLoading}
              min="0"
            />
          </div>
          <button
            type="submit"
            className="btn-danger w-full"
            disabled={
              isDisabled || burnLoading || !burnAccount || !burnAmount
            }
          >
            {burnLoading ? "Burning..." : "Burn Tokens"}
          </button>
          <p className="text-xs text-gray-500">
            Burns tokens from the specified token account
          </p>
          {burnResult && (
            <p
              className={
                burnResult.type === "success"
                  ? "text-sm text-green-400"
                  : "text-sm text-red-400"
              }
            >
              {burnResult.message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
