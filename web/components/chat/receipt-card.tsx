"use client";

import { useState } from "react";
import { EXPLORER } from "@/lib/contracts";

/** What a finished card leaves behind in the chat: a receipt with every transaction hash. */
export type ChatReceipt = {
  title: string;
  rows: { label: string; value: string }[];
  hashes: `0x${string}`[];
  at: number;
  /** The card's one-sentence headline, when it had one. Older receipts only have the title. */
  headline?: string;
  /** The Stackday fee line of the card. Older receipts do not have it. */
  fee?: string;
};

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/** Copies a hash; says "Copied" for a moment. Quietly does nothing where the clipboard is blocked. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => {});
      }}
      className="hit inline-grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
      aria-label={done ? "Copied" : "Copy transaction hash"}
      title={done ? "Copied" : "Copy"}
    >
      {done ? (
        <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      ) : (
        <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}

/** One line per hash: short hash, copy button and a BaseScan link. Numbered when there is more than one. */
export function TxLinks({ hashes }: { hashes: `0x${string}`[] }) {
  if (hashes.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs">
      {hashes.map((h, i) => (
        <li key={h} className="flex items-center gap-1">
          <span className="font-mono text-ink-soft">
            {hashes.length > 1 ? `${i + 1}. ` : ""}
            {short(h)}
          </span>
          <CopyButton text={h} />
          <a href={`${EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2 hover:text-brand-ink">
            BaseScan
          </a>
        </li>
      ))}
    </ul>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** A finished action: check icon, headline, the key rows and fee, then its transactions. */
export function ReceiptCard({ r, showTime = true }: { r: ChatReceipt; showTime?: boolean }) {
  const rows = r.rows.slice(0, 2);
  return (
    <div className="rounded-2xl border border-line-soft bg-popover px-3 py-2.5 text-xs shadow-pill">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-grow-soft text-grow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold leading-snug text-ink">
              <span className="sr-only">Done: </span>
              {r.headline ?? r.title}
            </span>
            {showTime && <span className="shrink-0 tabular-nums text-muted">{time(r.at)}</span>}
          </div>
          {(rows.length > 0 || r.fee) && (
            <dl className="mt-1 space-y-0.5">
              {rows.map((row) => (
                <div key={row.label} className="flex gap-1.5">
                  <dt className="shrink-0 text-muted">{row.label}</dt>
                  <dd className="min-w-0 break-words text-ink-soft">{row.value}</dd>
                </div>
              ))}
              {r.fee && (
                <div className="flex gap-1.5">
                  <dt className="shrink-0 text-muted">Fee</dt>
                  <dd className="min-w-0 break-words text-ink-soft">{r.fee}</dd>
                </div>
              )}
            </dl>
          )}
          <TxLinks hashes={r.hashes} />
        </div>
      </div>
    </div>
  );
}

/** "Today", "Yesterday" or a date, for grouping the Activity list. */
export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date(now)) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

/** Every action this wallet finished through the chat on this device, newest first, grouped by day. */
export function ActivityList({ receipts }: { receipts: ChatReceipt[] }) {
  if (receipts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        No buys, sells or loans from the chat yet. When you confirm one, it shows here with its transaction links.
      </div>
    );
  }
  const groups: { label: string; items: ChatReceipt[] }[] = [];
  for (const r of [...receipts].sort((a, b) => b.at - a.at)) {
    const label = dayLabel(r.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(r);
    else groups.push({ label, items: [r] });
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Actions you confirmed through the chat, kept on this device. Every transaction links to BaseScan.</p>
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="space-y-2">
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">{g.label}</h3>
          {g.items.map((r) => (
            <ReceiptCard key={`${r.at}-${r.title}`} r={r} />
          ))}
        </section>
      ))}
    </div>
  );
}
