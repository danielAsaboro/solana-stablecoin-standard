"use client";

import { useState, FormEvent } from "react";

interface PauseControlProps {
  config: { paused: boolean; symbol: string } | null;
  onPause: () => Promise<string>;
  onUnpause: () => Promise<string>;
}

interface FormResult {
  type: "success" | "error";
  message: string;
}

function truncateSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-8)}`;
}

export default function PauseControl({
  config,
  onPause,
  onUnpause,
}: PauseControlProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FormResult | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const isPaused = config?.paused ?? false;
  const symbol = config?.symbol ?? "";

  async function handlePause(e: FormEvent) {
    e.preventDefault();

    if (confirmText !== symbol) {
      setResult({
        type: "error",
        message: `Type "${symbol}" to confirm pause`,
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const sig = await onPause();
      setResult({
        type: "success",
        message: `Stablecoin paused. Tx: ${truncateSig(sig)}`,
      });
      setConfirmText("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Pause transaction failed";
      setResult({ type: "error", message });
    } finally {
      setLoading(false);
    }
  }

  async function handleUnpause(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const sig = await onUnpause();
      setResult({
        type: "success",
        message: `Stablecoin unpaused. Tx: ${truncateSig(sig)}`,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unpause transaction failed";
      setResult({ type: "error", message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel max-w-xl">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Emergency Controls</p>
          <h2 className="panel-title">Pause Control</h2>
        </div>
      </div>

      {/* Current Status */}
      <div className="mb-6 flex items-center gap-4">
        <span className="text-sm text-slate-400">Current Status</span>
        {isPaused ? (
          <span className="badge-red px-4 py-1.5 text-lg">PAUSED</span>
        ) : (
          <span className="badge-green px-4 py-1.5 text-lg">ACTIVE</span>
        )}
      </div>

      <p className="mb-6 text-sm text-slate-400">
        When paused, all minting and burning operations are blocked across the
        entire stablecoin. Freeze, thaw, and role management operations remain
        available. Use this as an emergency measure when the stablecoin needs to
        be temporarily halted.
      </p>

      {/* Unpause Form */}
      {isPaused ? (
        <form onSubmit={handleUnpause} className="space-y-4">
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={!config || loading}
          >
            {loading ? "Unpausing..." : "Unpause"}
          </button>
        </form>
      ) : (
        <form onSubmit={handlePause} className="space-y-4">
          <div className="alert-panel alert-critical">
            <div>
              <p className="text-sm font-medium text-rose-300">
                This will block ALL minting and burning
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Type <span className="font-mono font-semibold text-white">{symbol}</span> below
                to confirm you want to pause the stablecoin.
              </p>
            </div>
          </div>
          <input
            type="text"
            className="input-field"
            placeholder={`Type "${symbol}" to confirm`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={!config || loading}
          />
          <button
            type="submit"
            className="btn-danger w-full"
            disabled={!config || loading || confirmText !== symbol}
          >
            {loading ? "Pausing..." : "Pause"}
          </button>
        </form>
      )}

      {/* Result Message */}
      {result && (
        <div className={`mt-4 alert-panel ${result.type === "success" ? "alert-success" : "alert-critical"}`}>
          <p className={`text-sm ${result.type === "success" ? "text-emerald-200" : "text-rose-200"}`}>
            {result.message}
          </p>
        </div>
      )}
    </div>
  );
}
