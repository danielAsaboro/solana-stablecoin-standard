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
    <div className="card max-w-xl">
      <h2 className="card-header">Pause Control</h2>

      {/* Current Status */}
      <div className="mb-6 flex items-center gap-4">
        <span className="text-sm text-gray-400">Current Status</span>
        {isPaused ? (
          <span className="badge-red text-lg px-4 py-1.5">PAUSED</span>
        ) : (
          <span className="badge-green text-lg px-4 py-1.5">ACTIVE</span>
        )}
      </div>

      {/* Description */}
      <p className="mb-6 text-sm text-gray-400">
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
        /* Pause Form with confirmation */
        <form onSubmit={handlePause} className="space-y-4">
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4">
            <p className="text-sm font-medium text-red-400">
              This will block ALL minting and burning
            </p>
            <p className="mt-2 text-xs text-gray-400">
              Type <span className="font-mono font-semibold text-white">{symbol}</span> below
              to confirm you want to pause the stablecoin.
            </p>
          </div>
          <div>
            <input
              type="text"
              className="input-field"
              placeholder={`Type "${symbol}" to confirm`}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={!config || loading}
            />
          </div>
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
        <p
          className={
            result.type === "success"
              ? "mt-4 text-sm text-green-400"
              : "mt-4 text-sm text-red-400"
          }
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
