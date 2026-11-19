"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Chip, Empty, Field, PageHeader, Skeleton } from "@/components/ui";
import { ACTIONS, type Action, type AssetClass, type ResearchNote } from "@/lib/research/types";
import { UNIVERSE, searchUniverse, type UniverseAsset } from "@/lib/research/universe";
import {
  ACTION_LABEL,
  ActionBadge,
  AiLabel,
  AsOf,
  ConfidenceMeter,
  DataLabel,
  Disclaimer,
  LevelsRow,
  LoadError,
  ReasonList,
  ResearchAssetIcon,
  ResearchTabs,
  SampleBanner,
  StatusBadge,
  fmtDate,
  useSnapshot,
} from "./bits";

const CLASSES: { value: AssetClass | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stock", label: "Stocks" },
  { value: "fund", label: "Funds" },
  { value: "commodity", label: "Gold" },
  { value: "crypto", label: "Crypto" },
];

function AssetCard({ asset, note }: { asset: UniverseAsset; note?: ResearchNote }) {
  const href = `/research/${asset.assetId}`;
  const changed = note?.previousAction && note.previousAction !== note.action;
  return (
    <article className="relative flex min-w-0 flex-col rounded-[14px] border border-line bg-popover px-4 py-3.5 transition-colors duration-150 focus-within:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] hover:bg-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ResearchAssetIcon assetId={asset.assetId} size={32} />
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-medium text-ink">
              {/* The link covers the whole card; buttons inside sit above it. */}
              <Link href={href} className="after:absolute after:inset-0 after:rounded-[14px] after:content-[''] focus-visible:outline-none">
                {asset.name}
              </Link>
            </h3>
            <p className="truncate text-xs text-muted">
              {asset.underlying} · {asset.sector}
            </p>
          </div>
        </div>
        {note && note.status !== "no-reading" ? (
          <div className="relative z-10 flex shrink-0 flex-col items-end gap-1">
            <ActionBadge action={note.action} />
            <ConfidenceMeter confidence={note.confidence} />
          </div>
        ) : null}
      </div>

      {!note || note.status === "no-reading" ? (
        <p className="mt-3 text-[13px] text-muted">No reading today. Nothing is filled in to cover the gap.</p>
      ) : (
        <>
          <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-soft">{note.summary}</p>
          {changed && (
            <p className="mt-1.5 text-xs text-muted">
              Changed from {ACTION_LABEL[note.previousAction!]} to {ACTION_LABEL[note.action]}
            </p>
          )}
          <div className="relative z-10 mt-3 min-h-5">
            {note.levels ? (
              <LevelsRow levels={note.levels} compact />
            ) : (
              <p className="text-xs text-muted">{asset.publicPrice ? (asset.risk === "cash-like" ? "No levels: cash-like fund." : "No levels today.") : "No levels: no public price."}</p>
            )}
          </div>
          <div className="relative z-10 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line-soft pt-2.5">
            <AiLabel />
            {note.levels && <DataLabel />}
            <StatusBadge status={note.status} />
            <span className="ml-auto">
              <AsOf at={note.dataAsOf} label="Data as of" />
            </span>
          </div>
        </>
      )}
    </article>
  );
}

export function ResearchList() {
  const snap = useSnapshot();
  const [q, setQ] = useState("");
  const [cls, setCls] = useState<AssetClass | "all">("all");
  const [act, setAct] = useState<Action | "all">("all");

  const notes = useMemo(() => {
    const m = new Map<string, ResearchNote>();
    if (snap.status === "ready") for (const n of snap.data.notes) m.set(n.assetId, n);
    return m;
  }, [snap]);

  const shown = searchUniverse(q).filter(
    (a) => (cls === "all" || a.assetClass === cls) && (act === "all" || (notes.get(a.assetId)?.action === act && notes.get(a.assetId)?.status !== "no-reading")),
  );

  return (
    <>
      <PageHeader
        title="Research"
        lead="A daily note on every Stackday asset, with a suggested action and the facts behind it."
        aside={snap.status === "ready" ? <AsOf at={snap.data.generatedAt} label="Updated" /> : undefined}
      />
      <ResearchTabs />

      {snap.status === "error" && <LoadError error={snap.error} />}
      <SampleBanner show={snap.status === "ready" && snap.data.kind === "sample"} />

      <Card title={snap.status === "ready" ? `Market overview, ${fmtDate(snap.data.market.date)}` : "Market overview"} badge={<AiLabel />}>
        {snap.status === "loading" ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : snap.status === "ready" ? (
          <>
            <p className="max-w-3xl text-[14px] leading-relaxed text-ink">{snap.data.market.summary}</p>
            {snap.data.market.developments.length > 0 && (
              <div className="mt-4">
                <ReasonList items={snap.data.market.developments} facts={snap.data.market.facts} />
              </div>
            )}
          </>
        ) : (
          <p className="text-[13px] text-muted">The market overview could not be loaded.</p>
        )}
      </Card>

      <Card title="All assets" tip="Research is done on the real market each token stands in for. The tokens you can buy here are testnet mocks.">
        <div className="grid gap-4">
          <div className="max-w-md">
            <Field label="Search" type="search" placeholder="Name, ticker or sector" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:gap-6">
            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-[13px] text-ink-soft">Asset class</legend>
              <div className="flex flex-wrap gap-2">
                {CLASSES.map((c) => (
                  <Chip key={c.value} active={cls === c.value} onClick={() => setCls(c.value)}>
                    {c.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-[13px] text-ink-soft">Suggested action</legend>
              <div className="flex flex-wrap gap-2">
                <Chip active={act === "all"} onClick={() => setAct("all")}>
                  All
                </Chip>
                {ACTIONS.map((a) => (
                  <Chip key={a} active={act === a} onClick={() => setAct(a)}>
                    {ACTION_LABEL[a]}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            Showing {shown.length} of {UNIVERSE.length} assets
          </p>
        </div>

        <div className="mt-4">
          {snap.status === "loading" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-44 rounded-[14px]" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <Empty>No asset matches. Try another search or filter.</Empty>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((a) => (
                <li key={a.assetId} className="flex">
                  <div className="flex w-full flex-col [&>article]:flex-1">
                    <AssetCard asset={a} note={notes.get(a.assetId)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Disclaimer />
    </>
  );
}
