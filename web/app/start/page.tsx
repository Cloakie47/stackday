"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnect } from "wagmi";
import { Logo, TestnetBanner, WalletButton } from "@/components/shell";
import { Button, Field, Notice, Responsive, Spinner, cx } from "@/components/ui";
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
    text: "USDC payroll for owners and their teams.",
    points: ["Pay a team once or on a schedule", "Each person can invest a share of their pay", "Claim to any wallet"],
  },
];

const BUSINESS_ROLES: { id: BusinessRole; title: string; text: string }[] = [
  { id: "owner", title: "I run the business", text: `Fund a treasury, add your team by ${BRAND.name} ID, choose how often you pay.` },
  { id: "employee", title: "I get paid by a business", text: `Claim your salary and invest a share. Share your ${BRAND.name} ID with your employer.` },
];

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }) {
  return (
    <section className={cx("rounded-3xl p-4 transition-colors duration-200 sm:p-5", active ? "card" : "border border-line")}>
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-200",
            done ? "bg-grow-soft text-grow" : active ? "bg-ink text-canvas" : "border border-line-strong text-muted",
          )}
        >
          {done ? (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Done">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          ) : (
            n
          )}
        </span>
        <h2 className={cx("text-base font-semibold tracking-[-0.01em]", !active && !done && "text-muted")}>{title}</h2>
      </div>
      {active && <div className="mt-4 animate-[var(--animate-fade)] sm:pl-9">{children}</div>}
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
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="tile flex flex-col rounded-2xl p-4 text-left"
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
    // Existing behaviour, unchanged in the redesign: prefill once the saved account loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <TestnetBanner />
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <WalletButton variant="secondary" />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-2xl space-y-3 px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <div className="pb-3">
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.02em] sm:text-[28px] sm:leading-[34px]">Let&apos;s set you up</h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">Three steps. Free, and no money moves.</p>
        </div>

        <Step n={1} title="Connect your wallet" done={connected} active={step === 1}>
          <p className="text-sm leading-relaxed text-muted">
            <Responsive m="Your wallet is your account." d="Your wallet is your account. Only it can move funds out of your vault." />
          </p>
          <Button className="mt-4" size="lg" disabled={isPending || !connectors[0]} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            {isPending ? "Connecting…" : "Connect wallet"}
          </Button>
          {!connectors[0] && <p className="mt-2 text-sm text-danger">No wallet found. Install Coinbase Wallet or MetaMask.</p>}
        </Step>

        <Step n={2} title="Sign in" done={signedIn} active={step === 2}>
          <p className="text-sm leading-relaxed text-muted">
            <Responsive m="Free signature, not a transaction." d={`Sign a message to create your ${BRAND.name} ID. It's free and not a transaction.`} />
          </p>
          <Button className="mt-4" size="lg" variant="ink" disabled={session.busy} onClick={session.signIn}>
            {session.busy ? (
              <>
                <Spinner /> Check your wallet…
              </>
            ) : (
              "Sign in with wallet"
            )}
          </Button>
          {session.error && <p className="mt-2 text-sm text-danger">{session.error}</p>}
        </Step>

        <Step n={3} title={`Choose how to use ${BRAND.name}`} done={false} active={step === 3}>
          {me && (
            <p className="mb-4 text-sm text-muted">
              Your {BRAND.name} ID is <strong className="font-mono font-medium text-ink">{me.profile.uid}</strong>.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Interface">
            {MODES.map((m) => (
              <Option key={m.id} selected={mode === m.id} onSelect={() => setMode(m.id)}>
                <span className="text-base font-semibold tracking-[-0.01em] text-ink">{m.title}</span>
                <span className="mt-1 text-sm leading-relaxed text-muted">{m.text}</span>
                <ul className="mt-3 space-y-1.5 text-[13px] leading-snug text-ink-soft">
                  {m.points.map((pt) => (
                    <li key={pt} className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </Option>
            ))}
          </div>

          {mode === "business" && (
            <div className="mt-5 animate-[var(--animate-fade)]">
              <h3 className="text-sm font-semibold">Your role</h3>
              <div className="mt-2.5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Business role">
                {BUSINESS_ROLES.map((r) => (
                  <Option key={r.id} selected={businessRole === r.id} onSelect={() => setBusinessRole(r.id)}>
                    <span className="text-[15px] font-semibold text-ink">{r.title}</span>
                    <span className="mt-1 text-sm leading-relaxed text-muted">{r.text}</span>
                  </Option>
                ))}
              </div>
            </div>
          )}

          {ownerNeedsName && (
            <div className="mt-5 grid animate-[var(--animate-fade)] gap-4">
              <Field label="Business name" placeholder="Northwind Studio" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <label className="block">
                <span className="text-[13px] font-medium text-ink-soft">Description (optional)</span>
                <textarea
                  value={description}
                  maxLength={400}
                  rows={3}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short description your team will see."
                  className="well mt-1.5 w-full rounded-xl px-3.5 py-2.5 text-base text-ink outline-none placeholder:text-muted"
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
              {busy ? "Saving…" : mode === "business" ? (businessRole === "owner" ? "Open Payroll" : "Open My pay") : "Open Personal"}
            </Button>
            <p className="text-xs text-muted">
              <Responsive m="Switch any time." d="Switch between Personal and Business any time." />
            </p>
          </div>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </Step>
      </main>
    </div>
  );
}
