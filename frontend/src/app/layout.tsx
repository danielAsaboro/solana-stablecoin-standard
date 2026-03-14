import type { Metadata } from "next";
import { PrivyProviderWrapper } from "@/contexts/PrivyProviderWrapper";
import { SolanaConnectionProvider } from "@/contexts/ConnectionContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "SSS Admin — Solana Stablecoin Standard",
  description:
    "Admin dashboard for managing Solana Stablecoin Standard stablecoins (SSS-1 / SSS-2)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <PrivyProviderWrapper>
          <SolanaConnectionProvider
            endpoint={process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899"}
          >
            {children}
          </SolanaConnectionProvider>
        </PrivyProviderWrapper>
      </body>
    </html>
  );
}
