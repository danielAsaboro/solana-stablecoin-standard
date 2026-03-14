"use client";

import { FC } from "react";
import { useDemoWizard } from "@/hooks/useDemoWizard";
import { useSolanaWallet } from "@/hooks/usePrivySolana";
import DemoStepCard from "./DemoStepCard";
import { truncateAddress } from "@/lib/constants";

interface DemoWizardProps {
  onComplete: (mintAddress: string) => void;
}

const DemoWizard: FC<DemoWizardProps> = ({ onComplete }) => {
  const { state, executeStep, advanceStep, reset, isComplete } = useDemoWizard();
  const { connected } = useSolanaWallet();

  const completedCount = state.steps.filter((s) => s.status === "success").length;
  const progress = (completedCount / state.steps.length) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">SSS-2 Enforcement Scenario</p>
            <h2 className="panel-title">Live Demo</h2>
            <p className="mt-2 text-sm text-slate-400">
              Walk through the complete enforcement workflow: initialize, mint,
              blacklist, seize, burn, remint, and audit — all on-chain.
            </p>
          </div>
          <button onClick={reset} className="btn-secondary text-sm">
            Reset
          </button>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {completedCount} / {state.steps.length} steps complete
            </span>
            <span className="text-xs text-slate-500">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Wallet participants */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Alice
            </p>
            <p className="mt-0.5 font-mono text-xs text-slate-300">
              {truncateAddress(state.alice.publicKey.toBase58())}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Bob
            </p>
            <p className="mt-0.5 font-mono text-xs text-slate-300">
              {truncateAddress(state.bob.publicKey.toBase58())}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Victim
            </p>
            <p className="mt-0.5 font-mono text-xs text-slate-300">
              {truncateAddress(state.victim.publicKey.toBase58())}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Treasury
            </p>
            <p className="mt-0.5 font-mono text-xs text-slate-300">
              {truncateAddress(state.treasury.publicKey.toBase58())}
            </p>
          </div>
        </div>

        {state.mintAddress && (
          <div className="mt-3 rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-2">
            <span className="text-xs text-brand-300/70">Mint: </span>
            <span className="font-mono text-xs text-brand-200">
              {state.mintAddress.toBase58()}
            </span>
          </div>
        )}

        {!connected && (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <p className="text-sm text-amber-200">
              Connect a wallet to run the demo. The connected wallet will be the
              master authority for all operations.
            </p>
          </div>
        )}
      </div>

      {/* Step list */}
      <div className="flex flex-col gap-3 lg:flex-row lg:gap-6">
        {/* Left: step indicators (desktop) */}
        <div className="hidden w-56 flex-shrink-0 lg:block">
          <div className="sticky top-28 space-y-1">
            {state.steps.map((step, idx) => (
              <button
                key={step.id}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                  idx === state.currentStepIndex
                    ? "bg-brand-500/10 text-brand-200"
                    : step.status === "success"
                      ? "text-emerald-300/70"
                      : step.status === "error"
                        ? "text-rose-300/70"
                        : "text-slate-500"
                }`}
                disabled
              >
                <span
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    step.status === "success"
                      ? "bg-emerald-500/20"
                      : step.status === "error"
                        ? "bg-rose-500/20"
                        : idx === state.currentStepIndex
                          ? "bg-brand-500/20"
                          : "bg-slate-800"
                  }`}
                >
                  {step.status === "success" ? "\u2713" : idx + 1}
                </span>
                <span className="truncate">{step.title.replace(/^\d+\.\s*/, "")}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right: step cards */}
        <div className="flex-1 space-y-4">
          {state.steps.map((step, idx) => (
            <DemoStepCard
              key={step.id}
              step={step}
              isCurrent={idx === state.currentStepIndex}
              onExecute={() => void executeStep(idx)}
              onAdvance={advanceStep}
              isLast={idx === state.steps.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Completion */}
      {isComplete && state.mintAddress && (
        <div className="alert-panel alert-success">
          <div>
            <p className="text-lg font-semibold text-emerald-200">
              Demo Complete
            </p>
            <p className="mt-1 text-sm text-emerald-300/80">
              All 10 steps executed successfully. The stablecoin is live on-chain.
            </p>
          </div>
          <button
            onClick={() => onComplete(state.mintAddress!.toBase58())}
            className="btn-primary"
          >
            Load in Admin Dashboard
          </button>
        </div>
      )}
    </div>
  );
};

export default DemoWizard;
