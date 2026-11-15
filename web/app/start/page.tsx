"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnect } from "wagmi";
import { Logo, TestnetBanner, WalletButton } from "@/components/shell";
import { Button, Field, Notice, Spinner, cx } from "@/components/ui";
import { saveAccountType, saveBusiness, useAccountState } from "@/lib/useAccount";

type Choice = "individual" | "owner" | "employee";

const CHOICES: { id: Choice; group: string; title: string; text: string; points: string[] }[] = [
  {
    id: "individual",
    group: "Individual",
    title: "I invest for myself",
    text: "No employer needed. Set a regular buy from your own wallet.",
    points: ["Buy tokenized stocks, Bitcoin or Ether on a schedule", "Everything sits in a vault only you control", "Borrow against it instead of selling"],
  },
  {
    id: "owner",
    group: "Business",
    title: "I run a business",
    text: "Pay your team in USDC, once or on a schedule.",
    points: ["Fund a treasury once, set a payday rhythm", "Find and add people by their Stackday ID", "Each person decides what part of their pay goes to work"],
  },
  {
    id: "employee",
    group: "Business",
    title: "I get paid by a business",
    text: "Claim your salary and put a share of it to work.",
    points: ["Claim to any wallet you choose", "Send 10% or 20% of each payday into assets", "Give your employer your Stackday ID to be added"],
  },
];

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }) {
  return (
    <section className={cx("rounded-3xl border p-5 transition-colors duration-300 sm:p-6", active ? "border-ink bg-surface" : "border-line bg-surface/60")}>
      <div className="flex items-center gap-3">
        <span
          className={cx(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors duration-300",
            done ? "bg-grow text-white" : active ? "bg-ink text-canvas" : "bg-sunken text-muted",
          )}
        >
          {done ? "✓" : n}
        </span>
        <h2 className={cx("text-base font-semibold tracking-tight", !active && !done && "text-muted")}>{title}</h2>
      </div>
      {active && <div className="mt-4 animate-[var(--animate-rise)]">{children}</div>}
    </section>
  );
}

export default function StartPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { connectors, connect, isPending } = useConnect();
  const account = useAccountState();
  const { session, me, role } = account;
  const [choice, setChoice] = useState<Choice>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Pre-select what this wallet already is, so returning users just confirm.
  useEffect(() => {
    if (role && !choice) setChoice(role);
    if (me?.business && !name) {
      setName(me.business.name);
      setDescription(me.business.description);
    }
  }, [role, me, choice, name]);

  const connected = account.isConnected;
  const database = session.configured;
  const signedIn = database ? session.signedIn : connected;
  const step = !connected ? 1 : !signedIn ? 2 : 3;
  const destination = choice === "owner" ? "/employer" : "/dashboard";

  async function finish() {
    if (!choice) return;
    setError(undefined);
    if (!database) return router.push(destination); // no account database: nothing to save
    setBusy(true);
    try {
      if (choice === "owner") {
        await saveBusiness(name, description);
      } else {
        await saveAccountType(choice === "individual" ? "individual" : "business");
      }
      await queryClient.invalidateQueries();
      router.push(destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <TestnetBanner />
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <WalletButton />
      </header>

      <main className="stagger mx-auto max-w-3xl space-y-4 px-5 pb-16 pt-4 sm:px-8">
        <div className="pb-2">
          <h1 className="font-display text-5xl leading-none tracking-tight sm:text-6xl">Let&apos;s set you up</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
            Three short steps. Nothing here costs anything or moves any money.
          </p>
        </div>

        <Step n={1} title="Connect your wallet" done={connected} active={step === 1}>
          <p className="text-sm leading-relaxed text-muted">
            Your wallet is your account. Stackday never holds your money: what you buy sits in a vault only your wallet controls.
          </p>
          <Button className="mt-4" size="lg" disabled={isPending || !connectors[0]} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            {isPending ? "Connecting…" : "Connect wallet"}
          </Button>
          {!connectors[0] && <p className="mt-2 text-sm text-danger">No wallet found. Install a browser wallet such as Coinbase Wallet or MetaMask.</p>}
        </Step>

        <Step n={2} title="Prove it is yours" done={signedIn} active={step === 2}>
          <p className="text-sm leading-relaxed text-muted">
            Sign one message so we can create your profile and your unique Stackday ID. It is a free signature, not a transaction.
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

        <Step n={3} title="Choose your account" done={false} active={step === 3}>
          {database && me && (
            <p className="mb-4 text-sm text-muted">
              Your Stackday ID is <strong className="font-mono text-ink">{me.profile.uid}</strong>. It is how others find you.
            </p>
          )}
          {!database && (
            <div className="mb-4">
              <Notice>Profiles are switched off on this copy of the site, so your choice is not saved. Everything else works.</Notice>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Account type">
            {CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={choice === c.id}
                onClick={() => setChoice(c.id)}
                className={cx(
                  "flex flex-col rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.98]",
                  choice === c.id ? "border-ink bg-surface shadow-sm" : "border-line bg-surface/60 hover:border-line-strong",
                )}
              >
                <span className={cx("self-start rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", c.group === "Business" ? "bg-brand-soft text-brand-dark" : "bg-grow-soft text-grow")}>
                  {c.group}
                </span>
                <span className="mt-3 text-base font-semibold tracking-tight">{c.title}</span>
                <span className="mt-1 text-sm leading-relaxed text-muted">{c.text}</span>
                <ul className="mt-3 space-y-1.5 text-[13px] leading-snug text-ink-soft">
                  {c.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-line-strong" />
                      {p}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>

          {choice === "owner" && database && (
            <div className="mt-5 grid animate-[var(--animate-rise)] gap-4">
              <Field label="Business name" placeholder="Northwind Studio" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <label className="block">
                <span className="text-[13px] font-medium text-ink-soft">What does it do? (optional)</span>
                <textarea
                  value={description}
                  maxLength={400}
                  rows={3}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short description your team will see."
                  className="mt-1.5 w-full rounded-2xl border border-line-strong bg-surface px-3.5 py-2.5 text-base text-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-line-strong focus:border-brand focus:shadow-[0_0_0_4px_var(--color-brand-soft)]"
                />
              </label>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={!choice || busy || (choice === "owner" && database && name.trim().length < 2)} onClick={finish}>
              {busy ? "Saving…" : choice === "owner" ? "Open my business" : "Open my dashboard"}
            </Button>
            <p className="text-xs text-muted">You can switch at any time. One wallet can be both.</p>
          </div>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </Step>
      </main>
    </div>
  );
}
