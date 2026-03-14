"use client";

import { useState, FormEvent } from "react";

interface SeizeProps {
  config: { enablePermanentDelegate: boolean } | null;
  onSeize: (fromOwner: string, toOwner: string, amount: string) => Promise<string>;
}

interface FormResult {
  type: "success" | "error";
  message: string;
}

function truncateSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-8)}`;
}

export default function Seize({ config, onSeize }: SeizeProps) {
  const [fromOwner, setFromOwner] = useState("");
  const [toOwner, setToOwner] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FormResult | null>(null);

  if (!config || !config.enablePermanentDelegate) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Compliance</p>
            <h2 className="panel-title">Seize Tokens</h2>
          </div>
        </div>
        <div className="empty-state">
          <p className="text-center text-sm text-slate-400">
            Token seizure is only available on SSS-2 stablecoins with permanent delegate enabled
          </p>
        </div>
      </div>
    );
  }

  async function handleSeize(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const sig = await onSeize(fromOwner, toOwner, amount);
      setResult({
        type: "success",
        message: `Tokens seized successfully. Tx: ${truncateSig(sig)}`,
      });
      setFromOwner("");
      setToOwner("");
      setAmount("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Seize transaction failed";
      setResult({ type: "error", message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Regulatory Action</p>
            <h2 className="panel-title">Seize Tokens</h2>
          </div>
        </div>

        <p className="mb-6 text-sm text-slate-400">
          Seize tokens from a target account using the permanent delegate authority (SSS-2).
          Requires the Seizer role. Tokens are transferred to the specified treasury account.
        </p>

        <form onSubmit={handleSeize} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Target Wallet Address
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Wallet address to seize tokens from"
              value={fromOwner}
              onChange={(e) => setFromOwner(e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Treasury Wallet Address
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Destination treasury wallet address"
              value={toOwner}
              onChange={(e) => setToOwner(e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Amount (base units)
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Amount to seize in base units (e.g. 1000000 = 1.00 MUSD)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn-danger w-full"
            disabled={loading || !fromOwner || !toOwner || !amount}
          >
            {loading ? "Seizing..." : "Seize Tokens"}
          </button>

          {result && (
            <div className={`alert-panel ${result.type === "success" ? "alert-success" : "alert-critical"}`}>
              <p className={`text-sm ${result.type === "success" ? "text-emerald-200" : "text-rose-200"}`}>
                {result.message}
              </p>
            </div>
          )}
        </form>
      </div>

      <div className="alert-panel alert-warning">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-amber-300">
            Compliance Notice
          </h3>
          <p className="text-sm text-amber-200/70">
            Token seizure is an irreversible on-chain operation. Ensure you have
            proper legal authorization before seizing funds. All seizure operations
            emit a <code className="text-amber-300">TokensSeized</code> event to
            the immutable on-chain audit trail.
          </p>
        </div>
      </div>
    </div>
  );
}
