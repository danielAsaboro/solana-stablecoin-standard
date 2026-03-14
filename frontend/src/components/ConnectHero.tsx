"use client";

import { FC } from "react";
import { usePrivyLogin } from "@/hooks/usePrivySolana";

interface ConnectHeroProps {
  onSkip: () => void;
}

const loginMethods = [
  {
    label: "Email",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
      </svg>
    ),
    description: "Sign in with email link",
  },
  {
    label: "Google",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
    ),
    description: "Continue with Google",
  },
  {
    label: "X / Twitter",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    description: "Continue with X",
  },
  {
    label: "Wallet",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9m18 0V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3" />
      </svg>
    ),
    description: "Browser wallet extension",
  },
];

const ConnectHero: FC<ConnectHeroProps> = ({ onSkip }) => {
  const { login } = usePrivyLogin();

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-6">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-600 text-2xl font-bold text-white shadow-xl shadow-brand-900/40">
          SSS
        </div>

        <h1 className="text-3xl font-semibold text-white">
          Solana Stablecoin Standard
        </h1>
        <p className="mx-auto mt-3 max-w-md text-base text-slate-400">
          Create, manage, and monitor compliance-ready stablecoins on Solana with a unified operator console.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-3">
          {loginMethods.map((method) => (
            <button
              key={method.label}
              onClick={() => login()}
              className="hero-card flex flex-col items-center gap-2 text-slate-300 hover:text-white"
            >
              <span className="text-brand-400">{method.icon}</span>
              <span className="text-sm font-medium">{method.label}</span>
              <span className="text-xs text-slate-500">{method.description}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onSkip}
          className="mt-6 text-sm text-slate-500 transition-colors hover:text-slate-300"
        >
          Continue without signing in
        </button>
      </div>
    </div>
  );
};

export default ConnectHero;
