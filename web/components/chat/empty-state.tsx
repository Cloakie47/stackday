"use client";

import type { ReactNode } from "react";
import { useConnect } from "wagmi";
import { Button } from "@/components/ui";
import { ChatChip, type StarterChip } from "./chips";

/**
 * What the dock shows before the first message: a greeting and four capability tiles (Invest, Borrow,
 * Earn, Send), each with two starter chips. Every chip text is fixed here in code; a chip only sends
 * its text, the same as typing it. Signed out, in a read-only view, or before sign-in, the tiles are
 * shown disabled with the one step that unlocks them.
 */

type Tile = { key: string; title: string; blurb: string; icon: ReactNode; chips: [StarterChip, StarterChip] };

const svg = (d: ReactNode) => (
  <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const TILES: Tile[] = [
  {
    key: "invest",
    title: "Invest",
    blurb: "Buy once or on a schedule",
    icon: svg(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />),
    chips: [
      { label: "Buy $20 of Apple", text: "Buy $20 of Apple", kind: "action" },
      { label: "Set up a weekly buy", text: "Set up a weekly buy", kind: "action" },
    ],
  },
  {
    key: "borrow",
    title: "Borrow",
    blurb: "Borrow, repay, loan health",
    icon: svg(
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </>,
    ),
    chips: [
      { label: "How is my loan?", text: "How is my loan?", kind: "question" },
      { label: "Borrow against my holdings", text: "Borrow against my holdings", kind: "action" },
    ],
  },
  {
    key: "earn",
    title: "Earn",
    blurb: "Interest on idle USDC",
    icon: svg(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.5c0-1 1-1.8 2.5-1.8s2.5.8 2.5 1.8-1 1.5-2.5 1.8-2.5.8-2.5 1.9 1 1.8 2.5 1.8 2.5-.8 2.5-1.8" />
      </>,
    ),
    chips: [
      { label: "Earn on my idle USDC", text: "Earn interest on my idle USDC", kind: "action" },
      { label: "How does earning work?", text: "How does earning interest work?", kind: "question" },
    ],
  },
  {
    key: "send",
    title: "Send",
    blurb: "By Stackday ID, address or gift box",
    icon: svg(<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />),
    chips: [
      { label: "Send to a Stackday ID", text: "I want to send USDC to a Stackday ID", kind: "action" },
      { label: "How do gift boxes work?", text: "How do gift boxes work?", kind: "question" },
    ],
  },
];

export type EmptyMode =
  | { kind: "ready" }
  | { kind: "signed_out" }
  | { kind: "view_only" }
  | { kind: "no_database" }
  | { kind: "sign_in"; busy: boolean; error?: string; onSignIn: () => void };

export function EmptyState({ mode, disabled, onPick }: { mode: EmptyMode; disabled?: boolean; onPick: (text: string) => void }) {
  const locked = mode.kind !== "ready";
  return (
    <div className="space-y-4 pb-1">
      <div>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">What would you like to do?</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Ask about your balances and loans, or let me prepare an action. You check and sign every one in your own wallet. General information,
          not financial advice.
        </p>
      </div>

      <Gate mode={mode} />

      <ul className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2" aria-label="What the assistant can do">
        {TILES.map((t) => (
          <li
            key={t.key}
            className={`flex flex-col rounded-2xl border border-line-soft bg-sunken/60 p-3 ${locked ? "opacity-80" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-popover text-ink shadow-pill">{t.icon}</span>
              <span className="text-[13px] font-semibold text-ink">{t.title}</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">{t.blurb}</p>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {t.chips.map((c) => (
                <ChatChip key={c.label} chip={c} disabled={locked || disabled} onPick={onPick} block />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The one step that unlocks the chat, above the tiles. Nothing when the person can already chat. */
function Gate({ mode }: { mode: EmptyMode }) {
  if (mode.kind === "ready") return null;
  if (mode.kind === "signed_out") return <ConnectBox />;
  if (mode.kind === "view_only")
    return (
      <div className="space-y-2.5 rounded-2xl border border-line bg-popover p-3">
        <p className="text-[13px] text-ink">Read-only view: connect your own wallet to chat.</p>
        <ConnectButton />
      </div>
    );
  if (mode.kind === "no_database")
    return <p className="rounded-2xl border border-line bg-popover p-3 text-[13px] text-muted">The assistant needs the account database, which is not connected on this site.</p>;
  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-popover p-3">
      <p className="text-[13px] leading-relaxed text-ink">Sign in once with your wallet so the assistant can read your own balances.</p>
      <Button size="sm" disabled={mode.busy} onClick={mode.onSignIn}>
        Sign in (1 free signature, no transaction)
      </Button>
      {mode.error && <p className="text-xs text-danger">{mode.error}</p>}
    </div>
  );
}

function ConnectBox() {
  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-popover p-3">
      <p className="text-[13px] text-ink">Connect your wallet to chat about your own balances and loans.</p>
      <ConnectButton />
    </div>
  );
}

function ConnectButton() {
  const { connectors, connect, isPending } = useConnect();
  const first = connectors[0];
  return (
    <>
      <Button size="sm" disabled={isPending || !first} onClick={() => first && connect({ connector: first })}>
        {isPending ? "Connecting..." : "Connect wallet"}
      </Button>
      {!first && <p className="text-xs text-danger">No wallet found. Install a browser wallet such as Coinbase Wallet or MetaMask.</p>}
    </>
  );
}
