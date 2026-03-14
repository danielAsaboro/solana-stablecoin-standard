"use client";

import { useState, FormEvent } from "react";

interface FreezeThawProps {
  config: { symbol: string } | null;
  onFreeze: (wallet: string) => Promise<string>;
  onThaw: (wallet: string) => Promise<string>;
}

interface FormResult {
  type: "success" | "error";
  message: string;
}

function truncateSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-8)}`;
}

export default function FreezeThaw({
  config,
  onFreeze,
  onThaw,
}: FreezeThawProps) {
  const [freezeWallet, setFreezeWallet] = useState("");
  const [freezeLoading, setFreezeLoading] = useState(false);
  const [freezeResult, setFreezeResult] = useState<FormResult | null>(null);

  const [thawWallet, setThawWallet] = useState("");
  const [thawLoading, setThawLoading] = useState(false);
  const [thawResult, setThawResult] = useState<FormResult | null>(null);

  const isDisabled = !config;

  async function handleFreeze(e: FormEvent) {
    e.preventDefault();
    setFreezeLoading(true);
    setFreezeResult(null);

    try {
      const sig = await onFreeze(freezeWallet);
      setFreezeResult({
        type: "success",
        message: `Account frozen. Tx: ${truncateSig(sig)}`,
      });
      setFreezeWallet("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Freeze transaction failed";
      setFreezeResult({ type: "error", message });
    } finally {
      setFreezeLoading(false);
    }
  }

  async function handleThaw(e: FormEvent) {
    e.preventDefault();
    setThawLoading(true);
    setThawResult(null);

    try {
      const sig = await onThaw(thawWallet);
      setThawResult({
        type: "success",
        message: `Account thawed. Tx: ${truncateSig(sig)}`,
      });
      setThawWallet("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Thaw transaction failed";
      setThawResult({ type: "error", message });
    } finally {
      setThawLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Account Restriction</p>
            <h2 className="panel-title">Freeze Account</h2>
          </div>
        </div>
        <form onSubmit={handleFreeze} className="space-y-4">
          <input
            type="text"
            className="input-field"
            placeholder="Wallet address to freeze"
            value={freezeWallet}
            onChange={(e) => setFreezeWallet(e.target.value)}
            disabled={isDisabled || freezeLoading}
          />
          <button
            type="submit"
            className="btn-danger w-full"
            disabled={isDisabled || freezeLoading || !freezeWallet}
          >
            {freezeLoading ? "Freezing..." : "Freeze"}
          </button>
          <p className="text-xs text-slate-500">
            Freezes the wallet&apos;s associated token account
          </p>
          {freezeResult && (
            <div className={`alert-panel ${freezeResult.type === "success" ? "alert-success" : "alert-critical"}`}>
              <p className={`text-sm ${freezeResult.type === "success" ? "text-emerald-200" : "text-rose-200"}`}>
                {freezeResult.message}
              </p>
            </div>
          )}
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Account Restoration</p>
            <h2 className="panel-title">Thaw Account</h2>
          </div>
        </div>
        <form onSubmit={handleThaw} className="space-y-4">
          <input
            type="text"
            className="input-field"
            placeholder="Wallet address to thaw"
            value={thawWallet}
            onChange={(e) => setThawWallet(e.target.value)}
            disabled={isDisabled || thawLoading}
          />
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={isDisabled || thawLoading || !thawWallet}
          >
            {thawLoading ? "Thawing..." : "Thaw"}
          </button>
          <p className="text-xs text-slate-500">
            Unfreezes a previously frozen token account
          </p>
          {thawResult && (
            <div className={`alert-panel ${thawResult.type === "success" ? "alert-success" : "alert-critical"}`}>
              <p className={`text-sm ${thawResult.type === "success" ? "text-emerald-200" : "text-rose-200"}`}>
                {thawResult.message}
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
