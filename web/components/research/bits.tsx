"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AssetIcon, Badge, InfoTip, Notice, cx } from "@/components/ui";
import { ASSETS } from "@/lib/contracts";
import type { Action, Confidence, Fact, Levels, NoteStatus, Reasoned, ResearchSnapshot, Stance } from "@/lib/research/types";
import { RESEARCH_DISCLAIMER } from "@/lib/research/types";
import { universeAsset } from "@/lib/research/universe";
import { getSnapshot, type Loaded } from "./api";

/* ---------------------------------------------------------------------------------------------
   Data loading
--------------------------------------------------------------------------------------------- */

export type LoadState<T> = { status: "loading" } | { status: "error"; error: string } | ({ status: "ready" } & Loaded<T>);

/** Runs a loader once (and again when `key` changes). */
export function useLoad<T>(load: () => Promise<Loaded<T>>, key: string): LoadState<T> {
  const [state, setState] = useState<{ key: string; s: LoadState<T> } | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((r) => live && setState({ key, s: { status: "ready", ...r } }))
      .catch((e: unknown) => live && setState({ key, s: { status: "error", error: e instanceof Error ? e.message : "Could not load the research." } }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state.s : { status: "loading" };
}

export const useSnapshot = () => useLoad<ResearchSnapshot>(getSnapshot, "snapshot");

/* ---------------------------------------------------------------------------------------------
   Navigation inside Research
--------------------------------------------------------------------------------------------- */

const TABS = [
  { href: "/research", label: "Research" },
  { href: "/research/portfolio", label: "Portfolio" },
  { href: "/research/reports", label: "Reports" },
  { href: "/research/plans", label: "Plans" },
];

export function ResearchTabs() {
  const path = usePathname();
  // "Research" stays active on asset pages (/research/mAAPL or /research/aapl).
  const active = (href: string) => (href === "/research" ? !TABS.slice(1).some((t) => path.startsWith(t.href)) : path.startsWith(href));
  return (
    <nav aria-label="Research sections" className="-mx-1 overflow-x-auto px-1 print:hidden">
      <ul className="inline-flex gap-1">
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={active(t.href) ? "page" : undefined}
              className={cx(
                "inline-flex min-h-11 items-center rounded-[10px] border px-3.5 text-[13px] transition-colors duration-150 sm:min-h-9",
                active(t.href) ? "border-line bg-popover text-ink shadow-pill" : "border-transparent text-ink-soft hover:bg-hover",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ---------------------------------------------------------------------------------------------
   Honesty labels
--------------------------------------------------------------------------------------------- */

/** Shown on every Research page whenever the data is the labelled sample, not a live run. */
export function SampleBanner({ show, what = "research" }: { show: boolean; what?: string }) {
  if (!show) return null;
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-warn-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-warn">
      <Badge tone="warn">Sample data</Badge>
      <span>
        This {what} is hand-made demo data, not today&apos;s research. Prices in it are testnet mock prices, not market prices. Live research
        appears here once the daily run is switched on.
      </span>
    </div>
  );
}

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={cx("text-xs leading-relaxed text-muted", className)}>
      <span className="font-medium text-warn">Not investment advice.</span> {RESEARCH_DISCLAIMER}
    </p>
  );
}

/** Marks text written by the model. */
export function AiLabel() {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="brand">AI analysis</Badge>
    </span>
  );
}

/** Marks numbers fetched by code, each with a source and time. */
export function DataLabel() {
  return <Badge tone="neutral">Data</Badge>;
}

const TIME_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : `${TIME_FMT.format(d)} UTC`;
}
export function fmtDate(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

export function AsOf({ at, label = "As of" }: { at: string; label?: string }) {
  return (
    <span className="text-xs text-muted">
      {label} <time dateTime={at}>{fmtTime(at)}</time>
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------
   Actions, confidence, status
--------------------------------------------------------------------------------------------- */

export const ACTION_LABEL: Record<Action, string> = { buy: "Buy", hold: "Hold", sell: "Sell", watch: "Watch" };
const ACTION_TONE: Record<Action, "grow" | "neutral" | "danger" | "brand"> = { buy: "grow", hold: "neutral", sell: "danger", watch: "brand" };
const ACTION_TIP: Record<Action, string> = {
  buy: "The research suggests new money could go here. It never moves money for you.",
  hold: "Keep what you have. No change suggested.",
  sell: "The research leans against holding this. Stackday cannot sell for you.",
  watch: "No change yet. Keep an eye on the trigger named in the note.",
};

export function ActionBadge({ action, withTip = false }: { action: Action; withTip?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={ACTION_TONE[action]}>
        <span className="sr-only">Suggested action: </span>
        {ACTION_LABEL[action]}
      </Badge>
      {withTip && <InfoTip label={`${ACTION_LABEL[action]} suggestion`}>{ACTION_TIP[action]}</InfoTip>}
    </span>
  );
}

const CONF_N: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };
export function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const n = CONF_N[confidence];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="img" aria-label={`Confidence ${confidence}`}>
      <span aria-hidden className="inline-flex gap-[3px]">
        {[1, 2, 3].map((i) => (
          <i key={i} className={cx("h-2.5 w-1.5 rounded-[2px]", i <= n ? "bg-ink-soft" : "bg-press")} />
        ))}
      </span>
      <span aria-hidden className="capitalize">
        {confidence}
      </span>
    </span>
  );
}

export function StatusBadge({ status }: { status: NoteStatus }) {
  if (status === "ok") return null;
  return status === "carried" ? <Badge tone="neutral">Market closed, last note</Badge> : <Badge tone="warn">No reading today</Badge>;
}

const STANCE: Record<Stance, { label: string; cls: string }> = {
  positive: { label: "Leaning up", cls: "text-grow" },
  neutral: { label: "No clear direction", cls: "text-ink-soft" },
  negative: { label: "Leaning down", cls: "text-danger" },
  "no-view": { label: "No view", cls: "text-muted" },
};
export function StanceText({ stance }: { stance: Stance }) {
  return <span className={cx("font-medium", STANCE[stance].cls)}>{STANCE[stance].label}</span>;
}

/* ---------------------------------------------------------------------------------------------
   Assets
--------------------------------------------------------------------------------------------- */

export function ResearchAssetIcon({ assetId, size = 32 }: { assetId: string; size?: number }) {
  const a = ASSETS.find((x) => x.symbol === assetId);
  if (a) return <AssetIcon asset={a} size={size} />;
  const u = universeAsset(assetId);
  return <AssetIcon icon={u?.underlying ?? assetId} size={size} />;
}

export function assetName(assetId: string) {
  return universeAsset(assetId)?.name ?? assetId;
}

const usd = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: v < 10 ? 2 : 2, maximumFractionDigits: v < 10 ? 4 : 2 })}`;
export const fmtUsd = usd;

export function LevelsRow({ levels, compact = false }: { levels: Levels; compact?: boolean }) {
  const items = [
    { k: "Entry", v: levels.entry, cls: "text-ink" },
    { k: "Target", v: levels.target, cls: "text-grow" },
    { k: "Stop", v: levels.stop, cls: "text-danger" },
  ];
  return (
    <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-1", compact ? "text-xs" : "text-[13px]")}>
      {items.map((i) => (
        <span key={i.k} className="whitespace-nowrap">
          <span className="text-muted">{i.k}</span> <span className={cx("font-medium tabular-nums", i.cls)}>{usd(i.v)}</span>
        </span>
      ))}
      <InfoTip label="How the levels were computed">{levels.basis} Computed in code from price data, not by the AI.</InfoTip>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
   Facts and reasons
--------------------------------------------------------------------------------------------- */

function factValue(f: Fact) {
  if (typeof f.value === "number") return f.unit === "USD" ? usd(f.value) : `${f.value.toLocaleString("en-US")}${f.unit ? ` ${f.unit}` : ""}`;
  return `${f.value}${f.unit ? ` ${f.unit}` : ""}`;
}

/** One fact with its value, source (linked when there is a link) and time. */
export function FactLine({ fact }: { fact: Fact }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted">
      <span className="text-ink-soft">{fact.label}:</span>
      <span className="font-medium tabular-nums text-ink">{factValue(fact)}</span>
      <span aria-hidden>·</span>
      {fact.source.url ? (
        <a href={fact.source.url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink hover:decoration-ink">
          {fact.source.name}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span>{fact.source.name}</span>
      )}
      <span aria-hidden>·</span>
      <time dateTime={fact.asOf}>{fmtTime(fact.asOf)}</time>
      {fact.quote && <span className="w-full italic">&ldquo;{fact.quote}&rdquo;</span>}
    </li>
  );
}

/** A list of AI-written points, each followed by the facts it cites. Points without valid facts say so. */
export function ReasonList({ items, facts, empty = "Nothing here today." }: { items: Reasoned[]; facts: Fact[]; empty?: string }) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  if (items.length === 0) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((r, i) => {
        const cited = r.factIds.map((id) => byId.get(id)).filter((f): f is Fact => Boolean(f));
        return (
          <li key={i} className="py-3 first:pt-0 last:pb-0">
            <p className="text-[13px] leading-relaxed text-ink">{r.text}</p>
            {cited.length > 0 ? (
              <ul className="mt-1.5 space-y-1" aria-label="Cited facts">
                {cited.map((f) => (
                  <FactLine key={f.id} fact={f} />
                ))}
              </ul>
            ) : r.factIds.length > 0 ? (
              <p className="mt-1 text-xs text-faint">The cited facts are missing from this note.</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A small heading row inside a card: title, then the AI or Data label. */
export function SubHead({ children, ai = false, data = false }: { children: ReactNode; ai?: boolean; data?: boolean }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <h3 className="text-[13px] font-semibold text-ink">{children}</h3>
      {ai && <AiLabel />}
      {data && <DataLabel />}
    </div>
  );
}

export function UniverseWarning({ assetId }: { assetId: string }) {
  const note = universeAsset(assetId)?.note;
  if (!note) return null;
  return <Notice tone="warn">{note}</Notice>;
}

export function LoadError({ error }: { error: string }) {
  return (
    <Notice tone="danger">
      <span role="alert">{error}</span>
    </Notice>
  );
}
