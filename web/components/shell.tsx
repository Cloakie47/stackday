"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { BRAND } from "@/lib/brand";
import { CHAIN_ID } from "@/lib/contracts";
import { shortAddr } from "@/lib/format";
import { homeFor, useAccountState, useNames, useSwitchMode, type Mode, type Role } from "@/lib/useAccount";
import { LearnMore } from "./learn-more";
import { useViewer } from "./providers";
import { ThemeToggle } from "./theme";
import { Button, cx } from "./ui";

type NavItem = { href: string; label: string; short?: string; icon: string };

/** Copy text to the clipboard and say "Copied" for a moment. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(key: string, text: string) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Clipboard API blocked (no permission, embedded view): fall back to a hidden text field.
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      el.remove();
    }
    if (!ok) return;
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }
  return { copied, copy };
}

const ICON = {
  home: "M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5",
  pay: "M12 3v18M16.5 7.5h-6.25a2.75 2.75 0 000 5.5h3.5a2.75 2.75 0 010 5.5H7.5",
  invest: "M4 19V5M4 19h16M8 15l4-5 3 3 5-7",
  borrow: "M4 9h16v10H4zM8 9V6a4 4 0 018 0v3M12 13v2",
  risk: "M12 3l9 16H3zM12 10v4M12 17h.01",
  payroll: "M4 20v-2a5 5 0 0110 0v2M9 9a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6M20 20v-2a4 4 0 00-3-3.9",
  holdings: "M4 7h16v12H4zM4 11h16M9 7V5h6v2",
  themes: "M4 6h16M4 12h10M4 18h6",
};
const DOCS_ICON = "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5";

/**
 * Personal and Business are two separate interfaces, each with its own pages.
 * Business splits again: the owner runs payroll, a team member gets paid.
 * Before a choice (or in read-only view) every page is listed.
 */
const NAVS: Record<Role | "all", NavItem[]> = {
  individual: [
    { href: "/dashboard", label: "Home", icon: ICON.home },
    { href: "/invest", label: "Invest", icon: ICON.invest },
    { href: "/themes", label: "Themes", icon: ICON.themes },
    { href: "/borrow", label: "Borrow", icon: ICON.borrow },
    { href: "/risk", label: "Risk", icon: ICON.risk },
  ],
  owner: [
    { href: "/employer", label: "Payroll", icon: ICON.payroll },
    { href: "/risk", label: "Risk", icon: ICON.risk },
  ],
  // In the order of the journey: overview, get paid, invest, borrow, check the risk.
  employee: [
    { href: "/dashboard", label: "Home", icon: ICON.home },
    { href: "/pay", label: "My pay", short: "Pay", icon: ICON.pay },
    { href: "/invest", label: "Invest", icon: ICON.invest },
    { href: "/themes", label: "Themes", icon: ICON.themes },
    { href: "/borrow", label: "Borrow", icon: ICON.borrow },
    { href: "/risk", label: "Risk", icon: ICON.risk },
  ],
  all: [
    { href: "/dashboard", label: "Home", icon: ICON.home },
    { href: "/pay", label: "My pay", short: "Pay", icon: ICON.pay },
    { href: "/invest", label: "Invest", icon: ICON.invest },
    { href: "/themes", label: "Themes", icon: ICON.themes },
    { href: "/borrow", label: "Borrow", icon: ICON.borrow },
    { href: "/risk", label: "Risk", icon: ICON.risk },
    { href: "/employer", label: "Payroll", icon: ICON.payroll },
  ],
};
/** Every page, for the header title. */
const ALL_PAGES: NavItem[] = [...NAVS.all, { href: "/demo", label: "Testnet tools", icon: "" }];
/** Pages that belong to both interfaces. */
const SHARED = ["/risk", "/demo", "/docs", "/start"];

const MODE_LABEL: Record<Mode, string> = { personal: "Personal", business: "Business" };
const ROLE_LABEL: Record<Role, string> = {
  individual: "Personal",
  owner: "Business · owner",
  employee: "Business · team member",
};

function navFor(role: Role | undefined) {
  const items = NAVS[role ?? "all"];
  return { items, tabs: items.slice(0, 4), more: items.slice(4) };
}

/** Switch between the Personal and Business interfaces. */
function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const account = useAccountState();
  const router = useRouter();
  const switchMode = useSwitchMode();
  const [busy, setBusy] = useState(false);
  if (!account.isConnected || !account.mode) return null;

  async function go(next: Mode) {
    if (next === account.mode || busy) return;
    setBusy(true);
    try {
      await switchMode(account.address, next, account.session.signedIn);
      // A business owner opens Payroll; everyone else in Business opens My pay.
      const nextRole: Role = next === "personal" ? "individual" : account.businessRole;
      router.push(homeFor(next, nextRole));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="radiogroup" aria-label="Interface" className={cx("relative grid grid-cols-2 rounded-full bg-sunken p-1", compact ? "w-44" : "w-full")}>
      <span
        aria-hidden
        className={cx(
          "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full shadow-sm transition-transform duration-200 ease-[var(--ease-out)]",
          account.mode === "business" ? "translate-x-full bg-brand" : "translate-x-0 bg-grow",
        )}
      />
      {(["personal", "business"] as Mode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={account.mode === m}
          disabled={busy}
          onClick={() => go(m)}
          className={cx(
            "relative z-10 rounded-full font-semibold transition-colors duration-200",
            compact ? "min-h-8 text-[12px]" : "min-h-9 text-[13px]",
            account.mode === m ? "text-white" : "text-muted hover:text-ink",
          )}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

/** Role, name and Stackday ID, linking to /start to change the account. */
function AccountChip({ className = "" }: { className?: string }) {
  const account = useAccountState();
  const { role, me } = account;
  if (!role || !me) return null;
  const name = (role === "owner" ? me.business?.name : null) ?? (me.profile.username ? `@${me.profile.username}` : "Your account");
  return (
    <div className={cx("rounded-2xl border border-line px-3 py-2.5", className)}>
      <Link href="/start" className="block rounded-lg transition-colors duration-150 hover:text-brand-ink">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
          {ROLE_LABEL[role]}
          <span className="normal-case tracking-normal text-brand-ink">Account</span>
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-ink">{name}</div>
      </Link>
      <CopyId uid={me.profile.uid} />
    </div>
  );
}

function CopyId({ uid }: { uid: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy("id", uid)}
      title="Copy your Stackday ID"
      aria-label={`Copy your Stackday ID ${uid}`}
      className="mt-0.5 flex w-full items-center justify-between rounded-md font-mono text-[11px] text-muted transition-colors duration-150 hover:text-ink"
    >
      {uid}
      <span className="font-sans font-semibold text-brand-ink">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** A page from the other interface: say so, and offer to switch. */
function WrongModeNotice({ pathname }: { pathname: string }) {
  const account = useAccountState();
  const router = useRouter();
  const switchMode = useSwitchMode();
  const { mode, role } = account;
  if (!mode || !role || SHARED.some((p) => pathname.startsWith(p))) return null;
  if (NAVS[role].some((i) => pathname === i.href || pathname.startsWith(i.href + "/"))) return null;
  const other: Mode = mode === "personal" ? "business" : "personal";
  return (
    <div className="border-b border-line bg-sunken">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-8">
        <p className="text-sm text-ink-soft">
          This page is part of the {MODE_LABEL[other]} interface. You are in {MODE_LABEL[mode]}.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => switchMode(account.address, other, account.session.signedIn)}>
            Switch to {MODE_LABEL[other]}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => router.push(homeFor(mode, role))}>
            Back to {MODE_LABEL[mode]}
          </Button>
        </div>
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
  const { switchChain } = useSwitchChain();
  const { display } = useNames([address]);

  if (isConnected && chainId !== CHAIN_ID)
    return (
      <Button variant="danger" size="sm" onClick={() => switchChain({ chainId: CHAIN_ID })}>
        Switch to Base Sepolia
      </Button>
    );
  if (isConnected && address) return <WalletMenu address={address} label={display(address)} light={light} />;
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

/** The connected wallet: copy the address or ID, switch interface, or disconnect. */
function WalletMenu({ address, label, light }: { address: string; label: string; light: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { disconnect } = useDisconnect();
  const account = useAccountState();
  const router = useRouter();
  const switchMode = useSwitchMode();
  const { copied, copy } = useCopy();
  const uid = account.me?.profile.uid;
  const other: Mode | null = account.mode === "personal" ? "business" : account.mode === "business" ? "personal" : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function switchTo(next: Mode) {
    setOpen(false);
    await switchMode(address, next, account.session.signedIn);
    router.push(homeFor(next, next === "personal" ? "individual" : account.businessRole));
  }

  const item =
    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-ink transition-colors duration-150 hover:bg-sunken";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Connected as ${label}. Open wallet menu`}
        className={cx(
          "inline-flex min-h-9 max-w-48 items-center gap-2 rounded-full px-3 text-[13px] font-semibold",
          light ? "border border-white/25 text-white transition-colors hover:bg-white/10 active:scale-[0.97]" : "key key-surface text-ink",
        )}
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-grow" />
          <span className="absolute -inset-1 rounded-full bg-grow/25" />
        </span>
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-lg">
          <div className="px-3 pb-2 pt-1.5 font-mono text-[11px] text-muted">{shortAddr(address)}</div>
          <button type="button" role="menuitem" className={item} onClick={() => copy("addr", address)}>
            Copy wallet address
            <span className="text-xs font-medium text-brand-ink">{copied === "addr" ? "Copied" : ""}</span>
          </button>
          {uid && (
            <button type="button" role="menuitem" className={item} onClick={() => copy("id", uid)}>
              <span>
                Copy Stackday ID <span className="font-mono text-xs font-normal text-muted">{uid}</span>
              </span>
              <span className="text-xs font-medium text-brand-ink">{copied === "id" ? "Copied" : ""}</span>
            </button>
          )}
          {other && (
            <button type="button" role="menuitem" className={item} onClick={() => switchTo(other)}>
              Switch to {MODE_LABEL[other]}
            </button>
          )}
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            className={cx(item, "text-danger")}
            onClick={() => {
              setOpen(false);
              disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function TestnetBanner() {
  const viewer = useViewer();
  return (
    <div className="border-b border-warn/15 bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn">
      Testnet. Test tokens and prices, no real money.
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
          <div className="mb-4">
            <ModeSwitch />
          </div>
          <nav aria-label="More pages" className="grid gap-1">
            {more.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cx(
                  "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold transition-colors duration-150",
                  isActive(item.href) ? "nav-active text-brand-ink" : "text-ink active:bg-sunken",
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
  const router = useRouter();
  const viewer = useViewer();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const account = useAccountState();
  const { role, mode } = account;
  const showMode = !!mode && !viewer.readOnly;
  const { items, tabs, more } = navFor(viewer.readOnly ? "individual" : role);
  const current = items.find((n) => isActive(n.href)) ?? ALL_PAGES.find((n) => isActive(n.href));

  // Choosing Personal or Business is required: a connected wallet without a choice goes to /start.
  useEffect(() => {
    if (account.needsSetup && !viewer.readOnly) router.replace("/start");
  }, [account.needsSetup, viewer.readOnly, router]);

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        {showMode && (
          <div className="mt-6 px-1">
            <ModeSwitch />
          </div>
        )}
        <nav className={cx("flex flex-1 flex-col gap-0.5", showMode ? "mt-5" : "mt-9")} aria-label="Main">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cx(
                "group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-150",
                isActive(item.href) ? "nav-active font-semibold text-brand-ink" : "text-muted hover:bg-sunken hover:text-ink",
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
          <p className="px-2 text-xs leading-relaxed text-muted">
            <Link href="/demo" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
              Testnet tools
            </Link>
          </p>
        </div>
      </aside>

      {/* Top bar */}
      <header className="glass sticky top-0 z-10 border-b border-line">
        <TestnetBanner />
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="hidden items-center gap-2 text-sm font-medium text-muted lg:flex">
            {showMode && (
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                  mode === "business" ? "bg-brand-soft text-brand-ink" : "bg-grow-soft text-grow",
                )}
              >
                {MODE_LABEL[mode!]}
              </span>
            )}
            {current?.label ?? BRAND.name}
          </div>
          <div className="flex items-center gap-2">
            {showMode && (
              <div className="hidden sm:block lg:hidden">
                <ModeSwitch compact />
              </div>
            )}
            <WalletButton />
          </div>
        </div>
      </header>

      <WrongModeNotice pathname={pathname} />

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
            <span className={cx("grid h-7 w-14 place-items-center rounded-full transition-colors duration-150", isActive(item.href) && "nav-active")}>
              <Icon d={item.icon} className="h-[22px] w-[22px]" />
            </span>
            {item.short ?? item.label}
          </Link>
        ))}
        <MoreSheet isActive={isActive} more={more} />
      </nav>
    </div>
  );
}
