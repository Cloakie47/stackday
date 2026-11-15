"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { BRAND } from "@/lib/brand";
import { CHAIN_ID } from "@/lib/contracts";
import { shortAddr } from "@/lib/format";
import { useAccountState, useNames, type Role } from "@/lib/useAccount";
import { LearnMore } from "./learn-more";
import { useViewer } from "./providers";
import { ThemeToggle } from "./theme";
import { Button, cx } from "./ui";

type NavItem = { href: string; label: string; short?: string; icon: string; hideFor?: Role[] };

// Each account type sees the pages that matter to it. Until someone has chosen (or when the
// account database is off) everything is shown. Pages stay reachable by address.
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", short: "Home", icon: "M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5" },
  { href: "/pay", label: "Get paid", hideFor: ["individual"], icon: "M12 3v18M16.5 7.5h-6.25a2.75 2.75 0 000 5.5h3.5a2.75 2.75 0 010 5.5H7.5" },
  { href: "/invest", label: "Invest", icon: "M4 19V5M4 19h16M8 15l4-5 3 3 5-7" },
  { href: "/borrow", label: "Borrow", icon: "M4 9h16v10H4zM8 9V6a4 4 0 018 0v3M12 13v2" },
  { href: "/risk", label: "Risk", icon: "M12 3l9 16H3zM12 10v4M12 17h.01" },
  { href: "/employer", label: "Run payroll", hideFor: ["individual", "employee"], icon: "M4 20v-2a5 5 0 0110 0v2M9 9a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6M20 20v-2a4 4 0 00-3-3.9" },
  { href: "/demo", label: "Demo panel", icon: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4" },
];
const DOCS_ICON = "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5";

const ROLE_LABEL: Record<Role, string> = {
  individual: "Individual account",
  owner: "Business account · owner",
  employee: "Business account · team member",
};

/** The nav for this account type. The first four sit in the phone tab bar, the rest under "More". */
function navFor(role: Role | undefined) {
  const items = NAV.filter((item) => !role || !item.hideFor?.includes(role));
  // Business owners mostly run payroll, so it earns a tab on phones.
  const ordered = role === "owner" ? [items[0], ...items.filter((i) => i.href === "/employer"), ...items.slice(1).filter((i) => i.href !== "/employer")] : items;
  return { items: ordered, tabs: ordered.slice(0, 4), more: ordered.slice(4) };
}

/** Role, name and Stackday ID, linking to /start to switch. */
function AccountChip({ className = "" }: { className?: string }) {
  const account = useAccountState();
  const { role, me } = account;
  if (!role || !me) return null;
  const name = (role === "owner" ? me.business?.name : null) ?? (me.profile.username ? `@${me.profile.username}` : "Your account");
  return (
    <Link
      href="/start"
      className={cx("block rounded-2xl border border-line px-3 py-2.5 transition-colors duration-150 hover:bg-sunken", className)}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{ROLE_LABEL[role]}</div>
      <div className="mt-1 truncate text-sm font-semibold text-ink">{name}</div>
      <div className="mt-0.5 flex items-center justify-between font-mono text-[11px] text-muted">
        {me.profile.uid}
        <span className="font-sans font-semibold text-brand-ink">Switch</span>
      </div>
    </Link>
  );
}

/** Shown to a connected wallet that has not finished /start yet. */
function SetupBanner() {
  const account = useAccountState();
  if (!account.needsSetup) return null;
  return (
    <div className="border-b border-line bg-brand-soft">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <p className="text-sm text-brand-ink">
          <strong>One step left.</strong> Choose an Individual or a Business account to get your Stackday ID.
        </p>
        <Link
          href="/start"
          className="inline-flex min-h-9 items-center rounded-full bg-brand px-4 text-[13px] font-semibold text-white transition-transform duration-150 active:scale-[0.97]"
        >
          Finish setting up
        </Link>
      </div>
    </div>
  );
}

function Icon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** The Stackday mark: three stacked bars, one more each payday. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[30%] bg-brand shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" style={{ width: size * 0.62, height: size * 0.62 }} fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round">
        <path d="M5 17h14M7 12h10M9 7h6" />
      </svg>
    </span>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      translate="no"
      className={cx(
        "flex items-center gap-2.5 rounded-lg font-display text-[1.375rem] font-semibold leading-none tracking-[-0.02em]",
        light ? "text-white" : "text-ink",
      )}
    >
      <LogoMark />
      {BRAND.name}
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
        aria-label={`Connected as ${display(address)}. Disconnect`}
        className={cx(
          "inline-flex min-h-9 max-w-48 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-[background-color,border-color] duration-150 active:scale-[0.97]",
          light ? "border-white/25 text-white hover:bg-white/10" : "border-line-strong bg-surface text-ink shadow-xs hover:bg-sunken",
        )}
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-grow" />
          <span className="absolute -inset-1 rounded-full bg-grow/25" />
        </span>
        <span className="truncate">{display(address)}</span>
      </button>
    );
  const connector = connectors[0];
  return (
    <div className="text-right">
      <Button size="sm" disabled={isPending || !connector} onClick={() => connector && connect({ connector })}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
      {error && (
        <p className="mt-1 max-w-48 text-xs text-danger" role="alert">
          No wallet found. Install a browser wallet.
        </p>
      )}
    </div>
  );
}

export function TestnetBanner() {
  const viewer = useViewer();
  return (
    <div className="border-b border-warn/15 bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn">
      Testnet demo on Base Sepolia. Tokens and prices are mocks. No real money.
      {viewer.readOnly && <strong> Read-only view of {shortAddr(viewer.address)}.</strong>}
    </div>
  );
}

/** "More" on phones: a native <dialog> bottom sheet, so focus trapping and Escape come for free. */
function MoreSheet({ isActive, more }: { isActive: (href: string) => boolean; more: NavItem[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const moreActive = more.some((m) => isActive(m.href)) || isActive("/start");

  useEffect(() => {
    ref.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-haspopup="dialog"
        className={cx(
          "flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition-colors duration-150 active:scale-[0.96]",
          moreActive ? "text-brand-ink" : "text-muted",
        )}
      >
        <Icon d="M5 12h.01M12 12h.01M19 12h.01" className="h-[22px] w-[22px]" />
        More
      </button>
      <dialog
        ref={ref}
        className="sheet"
        aria-label="More pages"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
          <nav aria-label="More pages" className="grid gap-1">
            {more.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cx(
                  "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold transition-colors duration-150",
                  isActive(item.href) ? "bg-brand-soft text-brand-ink" : "text-ink active:bg-sunken",
                )}
              >
                <Icon d={item.icon} />
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/docs"
            className="mt-1 flex min-h-12 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold text-ink active:bg-sunken"
          >
            <Icon d={DOCS_ICON} />
            Docs
          </Link>
          <AccountChip className="mt-4" />
          <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">Theme</span>
            <ThemeToggle />
          </div>
          <form method="dialog" className="mt-4">
            <Button variant="secondary" className="w-full">
              Close
            </Button>
          </form>
        </div>
      </dialog>
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const current = NAV.find((n) => isActive(n.href));
  const { role } = useAccountState();
  const { items, tabs, more } = navFor(role);

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <nav className="mt-9 flex flex-1 flex-col gap-0.5" aria-label="Main">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cx(
                "group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-150",
                isActive(item.href) ? "bg-brand-soft font-semibold text-brand-ink" : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              <Icon d={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
        <AccountChip className="mb-4" />
        <div className="space-y-4">
          <Link
            href="/docs"
            className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            <Icon d={DOCS_ICON} />
            Docs
          </Link>
          <div className="px-2">
            <ThemeToggle />
          </div>
          <p className="px-2 text-xs leading-relaxed text-muted">Testnet demo, not audited.</p>
        </div>
      </aside>

      {/* Top bar */}
      <header className="glass sticky top-0 z-10 border-b border-line">
        <TestnetBanner />
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="hidden text-sm font-medium text-muted lg:block">{current?.label ?? BRAND.name}</div>
          <WalletButton />
        </div>
      </header>

      <SetupBanner />

      <main
        id="main"
        key={pathname}
        className="stagger mx-auto w-full max-w-5xl space-y-6 px-4 pb-8 pt-6 sm:px-8 sm:pt-10 lg:pb-10"
      >
        {children}
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] text-xs leading-relaxed text-muted sm:px-8 lg:pb-10">
        Tokenized stocks are for eligible persons outside the US. Not investment advice.{" "}
        <LearnMore href="/docs#notices">Full notices</LearnMore>
      </footer>

      {/* Phone and tablet tab bar */}
      <nav
        aria-label="Main"
        className="glass fixed inset-x-0 bottom-0 z-20 flex border-t border-line px-2 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] pt-1.5 lg:hidden"
      >
        {tabs.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cx(
              "flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition-colors duration-150 active:scale-[0.96]",
              isActive(item.href) ? "text-brand-ink" : "text-muted",
            )}
          >
            <Icon d={item.icon} className="h-[22px] w-[22px]" />
            {item.short ?? item.label}
          </Link>
        ))}
        <MoreSheet isActive={isActive} more={more} />
      </nav>
    </div>
  );
}
