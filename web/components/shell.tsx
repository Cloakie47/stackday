"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { BRAND } from "@/lib/brand";
import { GUIDE } from "@/lib/guide";
import { CHAIN_ID } from "@/lib/contracts";
import { shortAddr } from "@/lib/format";
import { homeFor, useAccountState, useNames, useSwitchMode, type Mode, type Role } from "@/lib/useAccount";
import { GiftBadge } from "./gifts/gift-waiting";
import { LearnMore } from "./learn-more";
import { useViewer } from "./providers";
import { ThemeToggle } from "./theme";
import { Button, InfoTip, cx } from "./ui";

type NavItem = { href: string; label: string; short?: string };

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

const P = {
  portfolio: { href: "/dashboard", label: "Portfolio" },
  pay: { href: "/pay", label: "Payday" },
  invest: { href: "/invest", label: "Invest" },
  borrow: { href: "/borrow", label: "Borrow" },
  research: { href: "/research", label: "Research" },
  gifts: { href: "/gifts", label: "Gifts" },
  risk: { href: "/risk", label: "Risk" },
  payroll: { href: "/employer", label: "Payroll" },
} satisfies Record<string, NavItem>;

/**
 * Personal and Business are two separate interfaces, each with its own pages.
 * Business splits again: the owner runs payroll, a team member gets paid.
 * Before a choice every page is listed. Risk lives under Borrow (its tab bar and the menu).
 * Themes is a tab inside Research ("My themes"), so it has no bar item of its own.
 */
const NAVS: Record<Role | "all", NavItem[]> = {
  individual: [P.portfolio, P.invest, P.borrow, P.research, P.gifts],
  // An owner runs payroll and can still invest and borrow for themselves.
  owner: [P.payroll, P.portfolio, P.invest, P.borrow, P.gifts],
  // In the order of the journey: overview, get paid, invest, borrow.
  employee: [P.portfolio, P.pay, P.invest, P.borrow, P.research, P.gifts],
  all: [P.portfolio, P.pay, P.invest, P.borrow, P.research, P.gifts, P.payroll],
};
/** The phone's section switch: the mode's two or three main pages. Everything else is in the menu. */
const SEGMENTS: Record<Role | "all", NavItem[]> = {
  individual: [P.portfolio, P.invest, P.borrow],
  owner: [P.payroll, P.portfolio, P.borrow],
  employee: [P.portfolio, P.borrow, P.pay],
  all: [P.portfolio, P.invest, P.borrow],
};
/** Pages that belong to both interfaces. */
const SHARED = ["/risk", "/demo", "/docs", "/start", "/gifts", "/research", "/themes"];
/** Pages that only live in the menu (each is left out when the bar already shows it). */
const EXTRA: NavItem[] = [
  { href: "/gifts", label: "Gifts" },
  { href: "/demo", label: "Testnet tools" },
  { href: "/start", label: "Account" },
];

const MODE_LABEL: Record<Mode, string> = { personal: "Personal", business: "Business" };
const ROLE_LABEL: Record<Role, string> = {
  individual: "Personal",
  owner: "Business · owner",
  employee: "Business · team member",
};

function useIsActive() {
  const pathname = usePathname();
  // My themes (/themes) is a tab inside Research, so Research stays lit there.
  return (href: string) => pathname === href || pathname.startsWith(href + "/") || (href === "/research" && pathname.startsWith("/themes"));
}

/** Switch between the Personal and Business interfaces. */
function ModeSwitch() {
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
    <div role="radiogroup" aria-label="Interface" className="grid grid-cols-2 rounded-[11px] bg-press p-[3px]">
      {(["personal", "business"] as Mode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={account.mode === m}
          disabled={busy}
          onClick={() => go(m)}
          className={cx(
            "min-h-11 rounded-[8px] text-[13px] font-medium transition-colors duration-150 sm:min-h-9",
            account.mode === m ? "bg-popover text-ink shadow-[0_1px_2px_rgb(16_24_40/0.08),0_0_0_0.5px_var(--line)]" : "text-muted hover:text-ink",
          )}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
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
    <div className="mx-auto max-w-[1120px] px-4 pt-4 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2.5">
        <p className="text-[13px] text-ink-soft">
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

/** The mark: three stacked bars in a ring, one more each payday. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full border-[1.5px] border-current" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 24 24" style={{ width: size * 0.6, height: size * 0.6 }} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M6 17h12M8 12h8M10 7h4" />
      </svg>
    </span>
  );
}

export function Logo({ light = false, size = 26 }: { light?: boolean; size?: number }) {
  return (
    <Link
      href="/"
      translate="no"
      className={cx(
        "flex shrink-0 items-center gap-[9px] rounded-lg font-display font-medium leading-none tracking-[-0.01em]",
        size < 26 ? "text-[17px]" : "text-lg",
        light ? "text-white" : "text-ink",
      )}
    >
      <LogoMark size={size} />
      {BRAND.name}
    </Link>
  );
}

/** "Base Sepolia · Testnet" with an (i). Required on every screen of the testnet demo. */
export function NetworkChip({ short = false }: { short?: boolean }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-[7px] rounded-[10px] bg-warn-soft pl-3 pr-2 font-medium text-warn", short ? "h-7 text-[11.5px]" : "h-8 text-xs")}>
      <i className="h-1.5 w-1.5 rounded-full bg-warn-dot" aria-hidden />
      {short ? "Testnet" : "Base Sepolia · Testnet"}
      <InfoTip label="Testnet" side="bottom">
        Test network. Mock tokens and prices, no real money.
      </InfoTip>
    </span>
  );
}

function Avatar({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="shrink-0 rounded-full"
      style={{ width: size, height: size, background: "conic-gradient(from 200deg, #cfd6e6, #e8e2d4, #d4e2dc, #cfd6e6)", boxShadow: "inset 0 0 0 1px var(--line)" }}
    />
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** Account, pages, theme. The same list in the desktop menu and the phone sheet. */
function MenuBody({ pages, bar = [], onNavigate }: { pages: NavItem[]; bar?: NavItem[]; onNavigate?: () => void }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const account = useAccountState();
  const viewer = useViewer();
  const { display } = useNames([address]);
  const { copied, copy } = useCopy();
  const isActive = useIsActive();
  const uid = account.me?.profile.uid;
  const name =
    account.role && account.me
      ? ((account.role === "owner" ? account.me.business?.name : null) ?? (account.me.profile.username ? `@${account.me.profile.username}` : null))
      : null;

  const row =
    "flex min-h-11 w-full items-center justify-between gap-3 rounded-[10px] px-3 text-left text-[13px] text-ink transition-colors duration-150 hover:bg-hover";

  return (
    <div className="grid gap-1">
      {isConnected && address ? (
        <div className="flex items-center gap-3 px-3 pb-2 pt-1.5">
          <Avatar size={32} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-ink">{name ?? display(address)}</div>
            <div className="truncate text-xs text-muted">
              {account.role ? ROLE_LABEL[account.role] : "Connected"} · <span className="font-mono">{shortAddr(address)}</span>
            </div>
          </div>
        </div>
      ) : viewer.readOnly && viewer.address ? (
        <div className="px-3 pb-2 pt-1.5 text-xs text-muted">
          Viewing <span className="font-mono text-ink">{shortAddr(viewer.address)}</span> (read-only)
        </div>
      ) : null}

      {isConnected && account.mode && (
        <div className="px-1.5 pb-1">
          <ModeSwitch />
        </div>
      )}

      {isConnected && address && (
        <button type="button" className={row} onClick={() => copy("addr", address)}>
          Copy wallet address
          <span className="text-xs text-brand-ink">{copied === "addr" ? "Copied" : ""}</span>
        </button>
      )}
      {uid && (
        <button type="button" className={row} onClick={() => copy("id", uid)} aria-label={`Copy your ${BRAND.name} ID ${uid}`}>
          <span>
            Copy {BRAND.name} ID <span className="font-mono text-xs text-muted">{uid}</span>
          </span>
          <span className="text-xs text-brand-ink">{copied === "id" ? "Copied" : ""}</span>
        </button>
      )}

      <div className="my-1 border-t border-line-soft" />
      <nav aria-label="More pages" className="grid gap-0.5">
        {[...pages, ...EXTRA.filter((e) => ![...pages, ...bar].some((p) => p.href === e.href))].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cx(row, isActive(item.href) && "bg-press font-medium")}
          >
            {item.label}
            {item.href === "/gifts" && <GiftBadge address={address} />}
            <span className="text-faint" aria-hidden>
              ›
            </span>
          </Link>
        ))}
        {/* Docs: the guide is a static site in public/guide (built from docs-site/), so a plain link. */}
        <a href={GUIDE} onClick={onNavigate} className={row}>
          Docs
          <span className="text-faint" aria-hidden>
            ›
          </span>
        </a>
      </nav>

      <div className="my-1 border-t border-line-soft" />
      <div className="flex items-center justify-between gap-3 px-3 py-1.5">
        <span className="text-[13px] text-muted">Theme</span>
        <ThemeToggle withLabels />
      </div>

      {isConnected && (
        <>
          <div className="my-1 border-t border-line-soft" />
          <button
            type="button"
            className={cx(row, "text-danger")}
            onClick={() => {
              onNavigate?.();
              disconnect();
            }}
          >
            Disconnect
          </button>
        </>
      )}
    </div>
  );
}

/** Desktop account menu: a popover under the account chip (or a menu button when no wallet is connected). */
function AccountMenu({ pages, bar, trigger }: { pages: NavItem[]; bar?: NavItem[]; trigger: "chip" | "icon" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { address } = useAccount();
  const { display } = useNames([address]);
  const { mode } = useAccountState();

  useEffect(() => {
    if (!open) return;
    // Move focus into the panel so keyboard users land on its first control.
    panelRef.current?.querySelector<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger === "chip" && address ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Connected as ${display(address)}${mode ? `, ${MODE_LABEL[mode]}` : ""}. Account menu`}
          className="inline-flex h-9 max-w-64 items-center gap-2 rounded-[10px] border border-line bg-popover pl-1.5 pr-2 text-[13px] text-ink shadow-pill transition-colors duration-150 hover:bg-hover"
        >
          <Avatar />
          <span className="truncate">{display(address)}</span>
          {mode && <span className="rounded-[5px] bg-press px-1.5 text-[11px] leading-[18px] text-muted">{MODE_LABEL[mode]}</span>}
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label="Menu"
          className="grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-popover text-ink shadow-pill transition-colors duration-150 hover:bg-hover"
        >
          <MenuIcon />
        </button>
      )}
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="absolute right-0 z-50 mt-2 w-80 animate-[var(--animate-pop)] rounded-[14px] border border-line bg-popover p-1.5 shadow-pop"
        >
          <MenuBody pages={pages} bar={bar} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Phone menu: the avatar opens a native <dialog> bottom sheet, so focus trapping and Escape come for free. */
function PhoneMenu({ pages }: { pages: NavItem[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const close = () => ref.current?.close();

  useEffect(() => {
    ref.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        aria-haspopup="dialog"
        aria-label="Open menu"
        className="grid h-11 w-11 place-items-center rounded-full text-ink"
      >
        {isConnected ? (
          <Avatar size={32} />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full border border-line bg-popover">
            <MenuIcon />
          </span>
        )}
      </button>
      <dialog
        ref={ref}
        className="sheet"
        aria-label="Menu"
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
      >
        <div className="px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-2.5">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" aria-hidden />
          {!isConnected ? (
            <div className="px-1.5 pb-2">
              <WalletButton block />
            </div>
          ) : (
            <div className="px-1.5 pb-2 empty:hidden">
              <ChainSwitch block />
            </div>
          )}
          <MenuBody pages={pages} onNavigate={close} />
          <form method="dialog" className="mt-2 px-1.5">
            <Button variant="secondary" className="w-full">
              Close
            </Button>
          </form>
        </div>
      </dialog>
    </>
  );
}

export function WalletButton({ light = false, block = false }: { light?: boolean; block?: boolean }) {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { switchChain } = useSwitchChain();
  const { display } = useNames([address]);

  if (isConnected && chainId !== CHAIN_ID)
    return (
      <Button variant="danger" size="sm" className={block ? "w-full" : ""} onClick={() => switchChain({ chainId: CHAIN_ID })}>
        Switch to Base Sepolia
      </Button>
    );
  if (isConnected && address) {
    if (block) return null;
    return (
      <span
        className={cx(
          "inline-flex h-9 max-w-48 items-center gap-2 rounded-[10px] border pl-1.5 pr-3 text-[13px]",
          light ? "border-white/25 text-white" : "border-line bg-popover text-ink shadow-pill",
        )}
      >
        <Avatar />
        <span className="truncate">{display(address)}</span>
      </span>
    );
  }
  const connector = connectors[0];
  return (
    <div className={block ? "" : "text-right"}>
      <Button size="sm" className={block ? "w-full" : ""} disabled={isPending || !connector} onClick={() => connector && connect({ connector })}>
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

/** "Switch to Base Sepolia" while a connected wallet is on another network. Renders nothing otherwise. */
export function ChainSwitch({ block = false, compact = false }: { block?: boolean; compact?: boolean }) {
  const { chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  if (!isConnected || chainId === CHAIN_ID) return null;
  return (
    <Button variant="danger" size="sm" className={block ? "w-full" : ""} onClick={() => switchChain({ chainId: CHAIN_ID })}>
      {compact ? "Switch network" : "Switch to Base Sepolia"}
    </Button>
  );
}

/** Older full-width testnet strip. Pages now show the network chip and the footer line instead. */
export function TestnetBanner() {
  const viewer = useViewer();
  return (
    <div className="border-b border-line-soft bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn">
      Testnet. Mock tokens and prices, no real money.
      {viewer.readOnly && <strong> Read-only view of {shortAddr(viewer.address)}.</strong>}
    </div>
  );
}

/** Required notices, compact: testnet, not investment advice, who tokenized stocks are for. */
export function SiteNotices({ className = "" }: { className?: string }) {
  return (
    <div className={cx("text-xs leading-4 text-muted", className)}>
      <div className="hidden justify-between gap-6 sm:flex">
        <p>Testnet. Mock tokens and prices, no real money.</p>
        <p className="text-right">
          Not investment advice. Tokenized stocks are for eligible persons outside the US and carry no voting rights.{" "}
          <LearnMore href="/docs#notices">Full notices</LearnMore>
        </p>
      </div>
      <p className="text-center sm:hidden">
        Testnet, mock tokens. Not investment advice. Tokenized stocks: eligible non-US persons only, no voting rights.{" "}
        <LearnMore href="/docs#notices">Notices</LearnMore>
      </p>
    </div>
  );
}

function DesktopNav({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();
  const pathname = usePathname();
  const riskUnderBorrow = !items.some((i) => i.href === "/risk");
  const { address } = useAccount();
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {items.map((item) => {
        const active = isActive(item.href) || (item.href === "/borrow" && riskUnderBorrow && pathname.startsWith("/risk"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex h-9 items-center rounded-[10px] border px-2.5 text-[13px] transition-colors duration-150 xl:px-3.5",
              active ? "border-line bg-popover text-ink shadow-pill" : "border-transparent text-ink-soft hover:bg-hover hover:text-ink",
            )}
          >
            {item.label}
            {item.href === "/gifts" && (
              <span className="ml-1.5 flex">
                <GiftBadge address={address} />
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function PhoneSections({ items }: { items: NavItem[] }) {
  const isActive = useIsActive();
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sections"
      className="mx-4 mb-2 mt-1.5 grid rounded-[11px] bg-press p-[3px]"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const active = isActive(item.href) || (item.href === "/borrow" && pathname.startsWith("/risk") && !items.some((i) => i.href === "/risk"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "hit flex h-[34px] items-center justify-center rounded-[8px] text-[13px] font-medium transition-colors duration-150",
              active ? "bg-popover text-ink shadow-[0_1px_2px_rgb(16_24_40/0.08),0_0_0_0.5px_var(--line)]" : "text-muted",
            )}
          >
            {item.short ?? item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const viewer = useViewer();
  const { isConnected } = useAccount();
  const account = useAccountState();
  const { role } = account;
  const key: Role | "all" = viewer.readOnly ? "individual" : (role ?? "all");
  const items = NAVS[key];
  const segments = SEGMENTS[key];
  const [scrolled, setScrolled] = useState(false);

  // Choosing Personal or Business is required: a connected wallet without a choice goes to /start.
  useEffect(() => {
    if (account.needsSetup && !viewer.readOnly) router.replace("/start");
  }, [account.needsSetup, viewer.readOnly, router]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Pages for the menus: whatever the bar (desktop) or the section switch (phone) does not show.
  const deskMore = items.some((i) => i.href === "/risk") ? [] : [P.risk];
  const phoneMore = [...items, P.risk].filter((i, n, a) => !segments.some((s) => s.href === i.href) && a.findIndex((x) => x.href === i.href) === n);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={cx("glass sticky top-0 z-30 border-b transition-colors duration-150", scrolled ? "border-line-soft" : "border-transparent")}>
        {/* Desktop and tablet bar */}
        <div className="mx-auto hidden h-16 max-w-[1280px] items-center gap-5 px-7 lg:flex xl:gap-7">
          <Logo />
          <DesktopNav items={items} />
          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden xl:inline-flex">
              <NetworkChip />
            </span>
            <span className="xl:hidden">
              <NetworkChip short />
            </span>
            {viewer.readOnly && viewer.address && (
              <span className="hidden h-8 items-center rounded-[10px] border border-line px-3 text-xs text-muted xl:inline-flex">
                Viewing&nbsp;<span className="font-mono text-ink">{shortAddr(viewer.address)}</span>&nbsp;(read-only)
              </span>
            )}
            {isConnected ? (
              <>
                <ChainSwitch />
                <AccountMenu pages={deskMore} bar={items} trigger="chip" />
              </>
            ) : (
              <>
                <WalletButton />
                <AccountMenu pages={deskMore} bar={items} trigger="icon" />
              </>
            )}
          </div>
        </div>

        {/* Phone bar and section switch */}
        <div className="lg:hidden">
          <div className="flex h-[52px] items-center gap-2.5 pl-4 pr-2.5">
            <Logo size={24} />
            <div className="ml-auto flex items-center gap-1.5">
              {viewer.readOnly && <span className="text-[11.5px] text-muted">Read-only</span>}
              <ChainSwitch compact />
              <NetworkChip short />
              <PhoneMenu pages={phoneMore} />
            </div>
          </div>
          <PhoneSections items={segments} />
        </div>
      </header>

      <WrongModeNotice pathname={pathname} />

      <main id="main" key={pathname} className="stagger mx-auto w-full max-w-[1120px] flex-1 space-y-6 px-4 pb-10 pt-3 sm:px-7 sm:pt-5">
        {children}
      </main>

      <footer className="site-footer mx-auto w-full max-w-[1120px] px-4 pb-[calc(1.75rem+env(safe-area-inset-bottom,0px))] pt-2 sm:px-7 sm:pb-8">
        <SiteNotices />
      </footer>
    </div>
  );
}
