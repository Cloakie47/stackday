"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnect } from "wagmi";
import { Logo, NetworkChip, SiteNotices, WalletButton } from "@/components/shell";
import { Button, Field, LabelTip, Notice, Spinner, cx } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { homeFor, rememberMode, saveAccountType, saveBusiness, useAccountState, type Mode } from "@/lib/useAccount";

type BusinessRole = "owner" | "employee";

const MODES: { id: Mode; title: string; text: string; points: string[] }[] = [
  {
    id: "personal",
    title: "Personal",
    text: "Invest for yourself. No employer needed.",
    points: ["Buy tokenized stocks, cbBTC or Ether on a schedule", "Everything sits in a vault only you control", "Borrow against it instead of selling"],
  },
  {
    id: "business",
    title: "Business",
    text: "Payroll in USDC, for the people who run it and the people it pays.",
    points: ["Pay a team once or on a schedule", "Each person sends a share of their pay into assets", "Claim to any wallet you choose"],
  },
];

const BUSINESS_ROLES: { id: BusinessRole; title: string; text: string }[] = [
  { id: "owner", title: "I run the business", text: `Fund a treasury, add your team by their ${BRAND.name} ID, set a payday rhythm.` },
  { id: "employee", title: "I get paid by a business", text: `Claim your salary and send a share of it to work. Give your employer your ${BRAND.name} ID.` },
];

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }) {
  return (
    <section className={cx("rounded-[18px] border p-4 transition-colors duration-300 sm:p-5", active ? "border-line bg-surface shadow-card" : "border-line-soft bg-transparent")}>
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-300",
            done ? "bg-grow-soft text-grow" : active ? "bg-ink text-canvas" : "bg-press text-muted",
          )}
        >
          {done ? "✓" : n}
        </span>
        <h2 className={cx("text-sm font-semibold", !active && !done && "text-muted")}>{title}</h2>
      </div>
      {active && <div className="mt-4 animate-[var(--animate-fade)]">{children}</div>}
    </section>
  );
}

function Option({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  /** Kept for callers; both options use the one blue now. */
  tone: "grow" | "brand";
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cx(
        "flex flex-col rounded-[14px] border p-4 text-left transition-[border-color,background-color,box-shadow] duration-150",
        selected
          ? "border-[color-mix(in_srgb,var(--brand)_55%,transparent)] bg-brand-soft shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_10%,transparent)]"
          : "border-line bg-popover hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

export default function StartPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { connectors, connect, isPending } = useConnect();
  const account = useAccountState();
  const { session, me, mode: savedMode, role: savedRole } = account;
  const [mode, setMode] = useState<Mode>();
  const [businessRole, setBusinessRole] = useState<BusinessRole>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Returning wallets see their current choice pre-selected.
  useEffect(() => {
    if (savedMode && !mode) setMode(savedMode);
    if (savedRole === "owner" && !businessRole) setBusinessRole("owner");
    if (savedRole === "employee" && !businessRole) setBusinessRole("employee");
    if (me?.business && !name) {
      setName(me.business.name);
      setDescription(me.business.description);
    }
  }, [savedMode, savedRole, me, mode, businessRole, name]);

  const connected = account.isConnected;
  const database = session.configured;
  const signedIn = database ? session.signedIn : connected;
  const step = !connected ? 1 : !signedIn ? 2 : 3;
  const ownerNeedsName = mode === "business" && businessRole === "owner" && database;
  const canFinish = !!mode && (mode === "personal" || !!businessRole) && (!ownerNeedsName || name.trim().length >= 2);

  async function finish() {
    if (!mode) return;
    setError(undefined);
    setBusy(true);
    try {
      if (database) {
        if (mode === "business" && businessRole === "owner") await saveBusiness(name, description);
        else await saveAccountType(mode === "personal" ? "individual" : "business");
      }
      rememberMode(account.address, mode, mode === "business" ? businessRole : undefined);
      await queryClient.invalidateQueries();
      router.push(homeFor(mode, mode === "personal" ? "individual" : businessRole));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-[52px] max-w-3xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-7">
        <Logo />
        <div className="flex items-center gap-2.5">
          <NetworkChip short />
          <WalletButton />
        </div>
      </header>

      <main id="main" className="stagger mx-auto max-w-3xl space-y-3 px-4 pb-12 pt-4 sm:px-7">
        <div className="pb-2">
          <h1 className="font-display text-[34px] font-light leading-none tracking-[-0.025em] sm:text-[44px]">Let&apos;s set you up</h1>
          <p className="mt-2.5 max-w-xl text-sm text-muted">Three short steps. Nothing here costs anything or moves any money.</p>
        </div>

        <Step n={1} title="Connect your wallet" done={connected} active={step === 1}>
          <p className="text-[13px] text-muted">
            <LabelTip label="Your wallet is your account." tip="What you buy sits in a vault only your wallet controls." />
          </p>
          <Button className="mt-3" size="lg" disabled={isPending || !connectors[0]} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            {isPending ? "Connecting…" : "Connect wallet"}
          </Button>
          {!connectors[0] && <p className="mt-2 text-[13px] text-danger">No wallet found. Install a browser wallet such as Coinbase Wallet or MetaMask.</p>}
        </Step>

        <Step n={2} title="Prove it is yours" done={signedIn} active={step === 2}>
          <p className="text-[13px] text-muted">Sign one message to create your profile and your {BRAND.name} ID. One free signature, no transaction.</p>
          <Button className="mt-3" size="lg" disabled={session.busy} onClick={session.signIn}>
            {session.busy ? (
              <>
                <Spinner /> Check your wallet…
              </>
            ) : (
              "Sign in with wallet"
            )}
          </Button>
          {session.error && <p className="mt-2 text-[13px] text-danger">{session.error}</p>}
        </Step>

        <Step n={3} title={`Choose how you use ${BRAND.name}`} done={false} active={step === 3}>
          {me && (
            <p className="mb-4 text-[13px] text-muted">
              Your {BRAND.name} ID is <strong className="font-mono font-medium text-ink">{me.profile.uid}</strong>.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Interface">
            {MODES.map((m) => (
              <Option key={m.id} selected={mode === m.id} onSelect={() => setMode(m.id)} tone={m.id === "personal" ? "grow" : "brand"}>
                                <span className="font-display text-[22px] font-normal tracking-[-0.01em]">{m.title}</span>
                <span className="mt-1 text-[13px] text-muted">{m.text}</span>
                <ul className="mt-3 space-y-1.5 text-[13px] leading-snug text-ink-soft">
                  {m.points.map((pt) => (
                    <li key={pt} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-icon-quiet" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </Option>
            ))}
          </div>

          {mode === "business" && (
            <div className="mt-5 animate-[var(--animate-fade)]">
              <h3 className="text-[13px] font-semibold">Which side are you on?</h3>
              <div className="mt-2.5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Business role">
                {BUSINESS_ROLES.map((r) => (
                  <Option key={r.id} selected={businessRole === r.id} onSelect={() => setBusinessRole(r.id)} tone="brand">
                    <span className="text-sm font-semibold">{r.title}</span>
                    <span className="mt-1 text-[13px] text-muted">{r.text}</span>
                  </Option>
                ))}
              </div>
            </div>
          )}

          {ownerNeedsName && (
            <div className="mt-5 grid animate-[var(--animate-fade)] gap-4">
              <Field label="Business name" placeholder="Northwind Studio" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <label className="block">
                <span className="text-[13px] text-ink-soft">What does it do? (optional)</span>
                <textarea
                  value={description}
                  maxLength={400}
                  rows={3}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short description your team will see."
                  className="mt-1.5 w-full rounded-xl border border-line bg-popover px-3.5 py-2.5 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_12%,transparent)]"
                />
              </label>
            </div>
          )}

          {!database && (
            <div className="mt-4">
              <Notice>Your choice is saved on this device.</Notice>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={!canFinish || busy} onClick={finish}>
              {busy ? "Saving…" : mode === "business" ? (businessRole === "owner" ? "Open Business: payroll" : "Open Business: my pay") : "Open Personal"}
            </Button>
            <p className="text-xs text-muted">You can switch between Personal and Business at any time.</p>
          </div>
          {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
        </Step>
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 sm:px-7">
        <SiteNotices />
      </footer>
    </div>
  );
}
