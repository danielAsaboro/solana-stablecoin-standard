"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Connection } from "@solana/web3.js";

interface ConnectionContextValue {
  connection: Connection;
}

const ConnectionContext = createContext<ConnectionContextValue>({
  connection: new Connection("http://127.0.0.1:8899", "confirmed"),
});

export function useSolanaConnection(): ConnectionContextValue {
  return useContext(ConnectionContext);
}

interface Props {
  endpoint: string;
  children: ReactNode;
}

export function SolanaConnectionProvider({ endpoint, children }: Props) {
  const connection = useMemo(
    () => new Connection(endpoint, "confirmed"),
    [endpoint]
  );

  return (
    <ConnectionContext.Provider value={{ connection }}>
      {children}
    </ConnectionContext.Provider>
  );
}
