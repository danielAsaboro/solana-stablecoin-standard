"use client";

import { type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

const solanaConnectors = toSolanaWalletConnectors();

interface Props {
  children: ReactNode;
}

export function PrivyProviderWrapper({ children }: Props) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div style={{ padding: 40, color: "#f87171", fontFamily: "monospace" }}>
        <h2>Missing NEXT_PUBLIC_PRIVY_APP_ID</h2>
        <p>
          Create a Privy app at{" "}
          <a href="https://dashboard.privy.io" style={{ color: "#38bdf8" }}>
            dashboard.privy.io
          </a>{" "}
          and add <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to your{" "}
          <code>.env.local</code>.
        </p>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          walletChainType: "solana-only",
          theme: "dark",
        },
        loginMethods: ["email", "wallet", "google", "twitter"],
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
