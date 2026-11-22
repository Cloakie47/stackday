"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AssetIcon, Badge, InfoTip, Notice, cx } from "@/components/ui";
import { ASSETS } from "@/lib/contracts";
import type {
  Confidence,
  Fact,
  Levels,
  Reasoned,
  View,
} from "@/lib/research/types";
import {
  BETA_LABEL,
  RESEARCH_DISCLAIMER,
  VIEW_LABEL,
} from "@/lib/research/types";
import { universeAsset } from "@/lib/research/universe";
import { getWeekly, type Loaded } from "./api";

/* ---------------------------------------------------------------------------------------------
   Data loading
--------------------------------------------------------------------------------------------- */


/**
 * A source link only when it is a well-formed https URL. Sources are already cleaned upstream and
 * React escapes attributes; this is a second line of defence against javascript: or data: links.
 */
export function httpsUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready" } & Loaded<T>);

/** Runs a loader once (and again when `key` changes). */
export function useLoad<T>(
  load: () => Promise<Loaded<T>>,
  key: string,
): LoadState<T> {
  const [state, setState] = useState<{ key: string; s: LoadState<T> } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    load()
      .then((r) => live && setState({ key, s: { status: "ready", ...r } }))
      .catch(
        (e: unknown) =>
          live &&
          setState({
            key,
            s: {
              status: "error",
              error:
                e instanceof Error ? e.message : "Could not load the research.",
            },
          }),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state.s : { status: "loading" };
}

/** The latest approved Monday report (or the labelled sample). */
export const useWeekly = () => useLoad(() => getWeekly(), "weekly");

/* ---------------------------------------------------------------------------------------------
   Navigation inside Research
--------------------------------------------------------------------------------------------- */

const TABS = [
  { href: "/research", label: "Weekly report" },
  { href: "/research/portfolio", label: "Portfolio check" },
  { href: "/research/plans", label: "Plans" },
];

export function ResearchTabs() {
  const path = usePathname();
  // "Weekly report" stays active on asset pages (/research/mAAPL).
  const active = (href: string) =>
    href === "/research"
      ? !TABS.slice(1).some((t) => path.startsWith(t.href)) &&
        !path.startsWith("/research/review")
      : path.startsWith(href);
  return (
    <nav
      aria-label="Research sections"
      className="-mx-1 overflow-x-auto px-1 print:hidden"
    >
      <ul className="inline-flex gap-1">
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={active(t.href) ? "page" : undefined}
              className={cx(
                "inline-flex min-h-11 items-center whitespace-nowrap rounded-[10px] border px-3.5 text-[13px] transition-colors duration-150 sm:min-h-9",
                active(t.href)
                  ? "border-line bg-popover text-ink shadow-pill"
                  : "border-transparent text-ink-soft hover:bg-hover",
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
export function SampleBanner({
  show,
  what = "research",
  why,
  children,
}: {
  show: boolean;
  what?: string;
  why?: string;
  children?: ReactNode;
}) {
  if (!show) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-warn-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-warn"
    >
      <Badge tone="warn">Sample data</Badge>
      {children ? (
        <span>{children}</span>
      ) : (
        <span>
          This {what} is hand-made demo data, not a real report. Prices in it
          are testnet mock prices, not market prices, and every level, pattern
          and event is made up for the demo.{why ? ` ${why}` : ""}
        </span>
      )}
    </div>
  );
}

/** Shown on the weekly report and asset pages until the quality bar has held for four Mondays. */
export function BetaBanner({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <div
      role="note"
      className="flex items-start gap-2.5 rounded-xl border border-line bg-popover px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft"
    >
      <Badge tone="brand">Beta</Badge>
      <span>
        {BETA_LABEL.replace(/^Beta: (.)/, (_, c: string) => c.toUpperCase())}
      </span>
    </div>
  );
}

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={cx("text-xs leading-relaxed text-muted", className)}>
      {/* The shared wording, with its first sentence picked out. */}
      <span className="font-medium text-warn">
        {RESEARCH_DISCLAIMER.split(". ")[0]}.
      </span>{" "}
      {RESEARCH_DISCLAIMER.split(". ").slice(1).join(". ")}
    </p>
  );
}

/** Marks text written by the model. */
export function AiLabel() {
  return <Badge tone="brand">AI analysis</Badge>;
}

/** Marks numbers made by code, each with a source and time. */
export function DataLabel({ tip }: { tip?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="neutral">Data</Badge>
      {tip && <InfoTip label="Where this data comes from">{tip}</InfoTip>}
    </span>
  );
}

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : `${TIME_FMT.format(d)} UTC`;
}
export function fmtDate(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}
export const fmtPct = (x: number, signed = false) =>
  `${signed && x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export function AsOf({ at, label = "As of" }: { at: string; label?: string }) {
  return (
    <span className="text-xs text-muted">
      {label} <time dateTime={at}>{fmtTime(at)}</time>
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------
   Views and conviction
--------------------------------------------------------------------------------------------- */

const VIEW_TONE: Record<View, "grow" | "neutral" | "warn" | "danger"> = {
  accumulate: "grow",
  hold: "neutral",
  reduce: "danger",
  "avoid-new-buys": "warn",
};
const VIEW_TIP: Record<View, string> = {
  accumulate:
    "The research sees this as a place where regular buying fits this week. General research for every reader, not an instruction.",
  hold: "No change in the research view this week.",
  reduce:
    "The research leans against adding and sees more downside than upside this week. It is not an instruction to sell.",
  "avoid-new-buys":
    "The research sees no case for new money this week. It never says to sell what anyone holds.",
};

export function ViewBadge({
  view,
  withTip = false,
}: {
  view: View;
  withTip?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={VIEW_TONE[view]}>
        <span className="sr-only">This week&apos;s view: </span>
        {VIEW_LABEL[view]}
      </Badge>
      {withTip && (
        <InfoTip label={`${VIEW_LABEL[view]} view`}>{VIEW_TIP[view]}</InfoTip>
      )}
    </span>
  );
}

const CONF_N: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };
export function ConvictionMeter({
  conviction,
  label = "Conviction",
}: {
  conviction: Confidence;
  label?: string;
}) {
  const n = CONF_N[conviction];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      role="img"
      aria-label={`${label} ${conviction}`}
    >
      <span aria-hidden className="inline-flex gap-[3px]">
        {[1, 2, 3].map((i) => (
          <i
            key={i}
            className={cx(
              "h-2.5 w-1.5 rounded-[2px]",
              i <= n ? "bg-ink-soft" : "bg-press",
            )}
          />
        ))}
      </span>
      <span aria-hidden className="capitalize">
        {conviction}
      </span>
    </span>
  );
}

/** View chip plus conviction, the compact form used on cards and tables. */
export function ViewChip({
  view,
  conviction,
  withTip = false,
}: {
  view: View;
  conviction: Confidence;
  withTip?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <ViewBadge view={view} withTip={withTip} />
      <ConvictionMeter conviction={conviction} />
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------
   Assets
--------------------------------------------------------------------------------------------- */

export function ResearchAssetIcon({
  assetId,
  size = 32,
}: {
  assetId: string;
  size?: number;
}) {
  const a = ASSETS.find((x) => x.symbol === assetId);
  if (a) return <AssetIcon asset={a} size={size} />;
  const u = universeAsset(assetId);
  return <AssetIcon icon={u?.underlying ?? assetId} size={size} />;
}

export function assetName(assetId: string) {
  return (
    universeAsset(assetId)?.name ??
    ASSETS.find((a) => a.symbol === assetId)?.name ??
    assetId
  );
}

export const fmtUsd = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: v >= 1000 ? 0 : 2, maximumFractionDigits: v < 10 ? 4 : v >= 1000 ? 0 : 2 })}`;

/** Buy zone and invalidation, computed in code. */
export function LevelsRow({
  levels,
  compact = false,
  at,
}: {
  levels: Levels;
  compact?: boolean;
  at?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-x-4 gap-y-1",
        compact ? "text-xs" : "text-[13px]",
      )}
    >
      <span className="whitespace-nowrap">
        <span className="text-muted">Buy zone</span>{" "}
        {levels.buyZone ? (
          <span className="font-medium tabular-nums text-grow">
            {fmtUsd(levels.buyZone.low)} to {fmtUsd(levels.buyZone.high)}
          </span>
        ) : (
          <span className="text-muted">none this week</span>
        )}
      </span>
      <span className="whitespace-nowrap">
        <span className="text-muted">Invalidation</span>{" "}
        <span className="font-medium tabular-nums text-danger">
          {fmtUsd(levels.invalidation)}
        </span>
      </span>
      <InfoTip label="How the levels were computed">
        {levels.basis} Computed in code from price data, not by the AI.
        {at ? ` Data as of ${fmtTime(at)}.` : ""}
      </InfoTip>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
   Facts and reasons
--------------------------------------------------------------------------------------------- */

function factValue(f: Fact) {
  if (typeof f.value === "number")
    return f.unit === "USD"
      ? fmtUsd(f.value)
      : `${f.value.toLocaleString("en-US")}${f.unit ? ` ${f.unit}` : ""}`;
  return `${f.value}${f.unit ? ` ${f.unit}` : ""}`;
}

/** One fact with its value, source (linked when there is a link) and time. */
export function FactLine({ fact }: { fact: Fact }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted">
      <span className="text-ink-soft">{fact.label}:</span>
      <span className="font-medium tabular-nums text-ink">
        {factValue(fact)}
      </span>
      <span aria-hidden>·</span>
      {httpsUrl(fact.source.url) ? (
        <a
          href={httpsUrl(fact.source.url)}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-line underline-offset-2 hover:text-ink hover:decoration-ink"
        >
          {fact.source.name}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <span>{fact.source.name}</span>
      )}
      <span aria-hidden>·</span>
      <time dateTime={fact.asOf}>{fmtTime(fact.asOf)}</time>
      {fact.quote && (
        <span className="w-full italic">&ldquo;{fact.quote}&rdquo;</span>
      )}
    </li>
  );
}

/** Cited facts behind a "Data" toggle, so each point can be checked against its source and time. */
export function CitedFacts({ ids, facts }: { ids: string[]; facts: Fact[] }) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const cited = ids
    .map((id) => byId.get(id))
    .filter((f): f is Fact => Boolean(f));
  if (cited.length === 0)
    return ids.length > 0 ? (
      <p className="mt-1 text-xs text-faint">
        The cited facts are missing from this report.
      </p>
    ) : null;
  return (
    <details className="group mt-1.5">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <Badge tone="neutral">Data</Badge>
        <span>
          {cited.length} {cited.length === 1 ? "source" : "sources"}
        </span>
        <span aria-hidden className="transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <ul className="mt-1.5 space-y-1" aria-label="Cited facts">
        {cited.map((f) => (
          <FactLine key={f.id} fact={f} />
        ))}
      </ul>
    </details>
  );
}

/** A list of AI-written points, each with the facts it cites behind a "Data" toggle. */
export function ReasonList({
  items,
  facts,
  empty = "Nothing here this week.",
}: {
  items: Reasoned[];
  facts: Fact[];
  empty?: string;
}) {
  if (items.length === 0)
    return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((r, i) => (
        <li key={i} className="py-3 first:pt-0 last:pb-0">
          <p className="text-[13px] leading-relaxed text-ink">{r.text}</p>
          <CitedFacts ids={r.factIds} facts={facts} />
        </li>
      ))}
    </ul>
  );
}

/** A small heading row inside a card: title, then the AI or Data label. */
export function SubHead({
  children,
  ai = false,
  data = false,
  dataTip,
}: {
  children: ReactNode;
  ai?: boolean;
  data?: boolean;
  dataTip?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <h3 className="text-[13px] font-semibold text-ink">{children}</h3>
      {ai && <AiLabel />}
      {data && <DataLabel tip={dataTip} />}
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

export const NOT_COVERED =
  "Not covered: research covers borrowable assets only.";

export function NotCoveredBadge() {
  return <Badge tone="neutral">Not covered</Badge>;
}

/** Monday of the current week (UTC), "YYYY-MM-DD". */
export function thisMonday(now = new Date()) {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
