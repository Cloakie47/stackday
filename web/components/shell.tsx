"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN_ID } from "@/lib/contracts";
import { shortAddr } from "@/lib/format";
import { useNames } from "@/lib/useAccount";
import { useViewer } from "./providers";
import { Button, cx } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/pay", label: "Get paid", icon: "M12 3v18M7 8h7.5a2.5 2.5 0 010 5H9.5a2.5 2.5 0 000 5H17" },
  { href: "/invest", label: "Invest", icon: "M4 19V5M4 19h16M8 15l4-5 3 3 5-7" },
  { href: "/borrow", label: "Borrow", icon: "M4 9h16v10H4zM8 9V6a4 4 0 018 0v3M12 13v2" },
  { href: "/risk", label: "Risk", icon: "M12 3l9 16H3zM12 10v4M12 17h.01" },
  { href: "/employer", label: "Run payroll", icon: "M4 20v-2a5 5 0 0110 0v2M9 9a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6M20 20v-2a4 4 0 00-3-3.9" },
  { href: "/demo", label: "Demo panel", icon: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={cx("flex items-center gap-2.5 font-display text-2xl leading-none tracking-tight", light ? "text-canvas" : "text-ink")}>
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round">
          <path d="M5 17h14M7 12h10M9 7h6" />
        </svg>
      </span>
      Stackday
    </Link>
  );
}

export function WalletButton({ light = false }: { light?: boolean }) {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { display } = useNames([address]);

  if (isConnected && chainId !== CHAIN_ID)
    return (
      <Button variant="danger" size="sm" onClick={() => switchChain({ chainId: CHAIN_ID })}>
        Switch to Base Sepolia
      </Button>
    );
  if (isConnected)
    return (
      <button
        onClick={() => disconnect()}
        title="Disconnect"
        className={cx(
          "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors duration-200",
          light ? "border-white/20 text-canvas hover:bg-white/10" : "border-line-strong bg-surface text-ink hover:border-ink",
        )}
      >
        <span className="h-2 w-2 rounded-full bg-grow" aria-hidden />
        {display(address)}
      </button>
    );
  const connector = connectors[0];
  return (
    <div className="text-right">
      <Button size="sm" disabled={isPending || !connector} onClick={() => connector && connect({ connector })}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
      {error && <p className="mt-1 max-w-48 text-xs text-danger">No wallet found. Install a browser wallet.</p>}
    </div>
  );
}

export function TestnetBanner() {
  const viewer = useViewer();
  return (
    <div className="bg-warn-soft px-4 py-1.5 text-center text-xs text-warn">
      Testnet demo on Base Sepolia. Asset tokens, prices and the exchange are mocks. No real money.
      {viewer.readOnly && <strong> Read-only view of {shortAddr(viewer.address)}.</strong>}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-ink px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo light />
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cx(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                isActive(item.href) ? "bg-white/10 text-canvas" : "text-canvas/55 hover:bg-white/5 hover:text-canvas",
              )}
            >
              <Icon d={item.icon} />
              {item.label}
              {isActive(item.href) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />}
            </Link>
          ))}
        </nav>
        <p className="px-3 text-[11px] leading-relaxed text-canvas/40">
          Salary maxxing on Base. Hackathon demo, not audited, test network only.
        </p>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur-md">
        <TestnetBanner />
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="hidden text-sm text-muted lg:block">
            {NAV.find((n) => isActive(n.href))?.label ?? "Stackday"}
          </div>
          <WalletButton />
        </div>
        {/* Mobile and tablet navigation */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2.5 lg:hidden" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cx(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors duration-200",
                isActive(item.href) ? "bg-ink text-canvas" : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main key={pathname} className="stagger mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        {children}
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs leading-relaxed text-muted sm:px-8">
        Stackday is a hackathon demo on a test network. It is not deployed to Base mainnet and has not had an
        independent security audit. Coinbase tokenized stocks are only available to eligible persons outside the United
        States and carry no voting rights. Not financial advice.
      </footer>
    </div>
  );
}
