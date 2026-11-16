"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isAddress } from "viem";
import { WagmiProvider, useAccount } from "wagmi";
import { config } from "@/lib/wagmi";
import type { Address } from "@/lib/contracts";
import { ThemeSync } from "./theme";

type Viewer = {
  /** Address whose data is shown: the connected wallet, or a read-only "?view=0x…" address. */
  address?: Address;
  /** True when the shown address is the connected wallet, so actions are allowed. */
  canAct: boolean;
  readOnly: boolean;
};

const ViewerContext = createContext<Viewer>({ canAct: false, readOnly: false });
export const useViewer = () => useContext(ViewerContext);

function ViewerProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const [viewParam, setViewParam] = useState<Address>();

  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v && isAddress(v)) setViewParam(v as Address);
  }, []);

  const value: Viewer = address
    ? { address, canAct: true, readOnly: false }
    : { address: viewParam, canAct: false, readOnly: !!viewParam };
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeSync />
        <ViewerProvider>{children}</ViewerProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
