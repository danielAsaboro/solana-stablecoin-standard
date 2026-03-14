"use client";

import { FC } from "react";
import { type DemoStep } from "@/hooks/useDemoWizard";
import { truncateAddress } from "@/lib/constants";

interface DemoStepCardProps {
  step: DemoStep;
  isCurrent: boolean;
  onExecute: () => void;
  onAdvance: () => void;
  isLast: boolean;
}

const DemoStepCard: FC<DemoStepCardProps> = ({
  step,
  isCurrent,
  onExecute,
  onAdvance,
  isLast,
}) => {
  return (
    <div
      className={`rounded-2xl border p-6 transition-all ${
        isCurrent
          ? "border-brand-500/40 bg-brand-500/5 shadow-lg shadow-brand-500/10"
          : step.status === "success"
            ? "border-emerald-500/20 bg-emerald-500/5"
            : step.status === "error"
              ? "border-rose-500/20 bg-rose-500/5"
              : "border-slate-800 bg-slate-900/50"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
              step.status === "success"
                ? "bg-emerald-500/20 text-emerald-300"
                : step.status === "error"
                  ? "bg-rose-500/20 text-rose-300"
                  : step.status === "running"
                    ? "bg-brand-500/20 text-brand-300"
                    : isCurrent
                      ? "bg-brand-500/20 text-brand-300"
                      : "bg-slate-800 text-slate-500"
            }`}
          >
            {step.status === "success"
              ? "\u2713"
              : step.status === "error"
                ? "!"
                : step.status === "running"
                  ? "\u25CF"
                  : step.title.charAt(0)}
          </div>
          <h3 className="text-base font-semibold text-white">{step.title}</h3>
        </div>
        {step.onChain && (
          <span className="badge-blue flex-shrink-0 text-[10px]">on-chain</span>
        )}
      </div>

      <p className="mb-4 text-sm leading-relaxed text-slate-400">
        {step.description}
      </p>

      <div className="code-block mb-4">
        <pre className="overflow-x-auto text-xs leading-5 text-brand-200/80">
          {step.codeSnippet}
        </pre>
      </div>

      {step.status === "running" && (
        <div className="flex items-center gap-2 text-sm text-brand-300">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Executing...
        </div>
      )}

      {step.status === "success" && step.result && (
        <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium text-emerald-300">{step.result}</p>
          {step.signature && (
            <p className="mt-1 font-mono text-[10px] text-emerald-400/60">
              tx: {truncateAddress(step.signature, 12)}
            </p>
          )}
        </div>
      )}

      {step.status === "error" && step.error && (
        <div className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
          <p className="text-xs text-rose-300">{step.error}</p>
        </div>
      )}

      {step.events && step.events.length > 0 && (
        <div className="mb-3 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Events emitted
          </p>
          <div className="flex flex-wrap gap-1">
            {step.events.map((event, i) => (
              <span key={i} className="badge-muted text-[10px]">
                {event.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {isCurrent && step.status !== "running" && (
        <div className="flex gap-2">
          {(step.status === "pending" || step.status === "error") && (
            <button onClick={onExecute} className="btn-primary text-sm">
              {step.status === "error" ? "Retry" : "Execute"}
            </button>
          )}
          {step.status === "success" && !isLast && (
            <button onClick={onAdvance} className="btn-primary text-sm">
              Next Step
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DemoStepCard;
