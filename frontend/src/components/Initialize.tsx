"use client";

import { FC, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useSDK } from "@/hooks/useSDK";
import { TRANSFER_HOOK_PROGRAM_ID } from "@/lib/constants";

interface InitializeProps {
  onCreated: (mintAddress: string) => void;
}

const presets = [
  {
    key: "SSS_1" as const,
    title: "SSS-1",
    subtitle: "Basic",
    description: "Mint, burn, freeze, pause. No compliance features.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
      </svg>
    ),
  },
  {
    key: "SSS_2" as const,
    title: "SSS-2",
    subtitle: "Compliance",
    description: "Permanent delegate + transfer hook. Blacklisting and seizure.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
];

const Initialize: FC<InitializeProps> = ({ onCreated }) => {
  const sdk = useSDK();
  const [preset, setPreset] = useState<"SSS_1" | "SSS_2">("SSS_2");
  const [name, setName] = useState("Demo USD");
  const [symbol, setSymbol] = useState("DUSD");
  const [uri, setUri] = useState("");
  const [decimals, setDecimals] = useState(6);
  const [hookProgram, setHookProgram] = useState(TRANSFER_HOOK_PROGRAM_ID.toBase58());

  const [status, setStatus] = useState<"idle" | "creating" | "success" | "error">("idle");
  const [result, setResult] = useState<{ mintAddress: string; signature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!sdk.ready) return;
    setStatus("creating");
    setError(null);

    try {
      const { mintAddress, signature } = await sdk.createStablecoin({
        name,
        symbol,
        uri: uri || undefined,
        decimals,
        preset,
        transferHookProgramId:
          preset === "SSS_2" ? new PublicKey(hookProgram) : undefined,
      });

      setResult({ mintAddress: mintAddress.toBase58(), signature });
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Create New Stablecoin</p>
            <h2 className="panel-title">Initialize</h2>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">Preset</label>
            <div className="grid grid-cols-2 gap-3">
              {presets.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    preset === p.key
                      ? "border-brand-500/40 bg-brand-500/5 shadow-lg shadow-brand-500/10"
                      : "border-slate-800 bg-slate-900/50 hover:border-slate-700"
                  }`}
                >
                  <div className={`mb-2 ${preset === p.key ? "text-brand-400" : "text-slate-500"}`}>
                    {p.icon}
                  </div>
                  <p className="text-sm font-semibold text-white">{p.title}</p>
                  <p className="text-xs text-slate-500">{p.subtitle}</p>
                  <p className="mt-1 text-xs text-slate-400">{p.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Stablecoin"
                className="input-field"
                maxLength={32}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="MUSD"
                className="input-field"
                maxLength={10}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">URI (optional)</label>
              <input
                type="text"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder="https://example.com/metadata.json"
                className="input-field"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Decimals</label>
              <input
                type="number"
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
                min={0}
                max={9}
                className="input-field"
              />
            </div>
          </div>

          {preset === "SSS_2" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">
                Transfer Hook Program ID
              </label>
              <input
                type="text"
                value={hookProgram}
                onChange={(e) => setHookProgram(e.target.value)}
                className="input-field font-mono text-xs"
              />
            </div>
          )}

          <button
            onClick={() => void handleCreate()}
            disabled={!sdk.ready || status === "creating" || !name || !symbol}
            className="btn-primary"
          >
            {status === "creating" ? "Creating..." : "Create Stablecoin"}
          </button>

          {!sdk.ready && (
            <p className="text-sm text-amber-200">Connect a wallet to initialize a stablecoin.</p>
          )}
        </div>
      </div>

      {error && (
        <div className="alert-panel alert-critical">
          <p className="text-sm text-rose-200">{error}</p>
        </div>
      )}

      {result && status === "success" && (
        <div className="alert-panel alert-success">
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-200">Stablecoin created successfully</p>
            <p className="text-xs text-emerald-300/80">
              Mint: <span className="font-mono">{result.mintAddress}</span>
            </p>
            <p className="text-xs text-emerald-300/80">
              Tx: <span className="font-mono">{result.signature}</span>
            </p>
          </div>
          <button
            onClick={() => onCreated(result.mintAddress)}
            className="btn-primary"
          >
            Load in Dashboard
          </button>
        </div>
      )}
    </div>
  );
};

export default Initialize;
