"use client";

import Link from "next/link";
import { Badge, Card, Notice, PageHeader, Skeleton, SplitBar, cx, splitColor } from "@/components/ui";
import type { ExampleSplit, Fact, Scorecard, WeeklyAssetSection, WeeklyReport } from "@/lib/research/types";
import { VIEW_LABEL } from "@/lib/research/types";
import { UNIVERSE, universeAsset } from "@/lib/research/universe";
import {
  AiLabel,
  AsOf,
  BetaBanner,
  CitedFacts,
  ConvictionMeter,
  DataLabel,
  Disclaimer,
  LevelsRow,
  LoadError,
  ReasonList,
  ResearchAssetIcon,
  ResearchTabs,
  SampleBanner,
  ViewBadge,
  ViewChip,
  assetName,
  fmtDate,
  fmtPct,
  fmtUsd,
  useWeekly,
} from "./bits";

const REFUSAL: Record<string, string> = {
  "sign-in": "Sign in with your wallet to open this week's report.",
  "payment-required": "This week's report needs a plan or a single Monday purchase. See Plans.",
  "rate-limited": "Too many requests in a short time. Try again in a minute.",
};

/**
 * Every fact in the report, so ideas and market text can cite asset facts too. Ideas cite
 * "assetId:factId" (for example "mPAXG:px.1d.last" or "mPAXG:macro.dgs10"), so each asset's facts
 * and the market facts are also listed under that qualified id.
 */
export function allFacts(r: WeeklyReport): Fact[] {
  // Asset and market news are both numbered news.0, news.1, ... and CitedFacts keeps the last fact
  // with an id: a qualified id ("mPAXG:news.1") means the section's own fact, and a plain id (market
  // text) means the market fact, so each one is listed last where it must win.
  const qualified = r.assets.flatMap((a) => [...r.market.facts, ...a.facts].map((f) => ({ ...f, id: `${a.assetId}:${f.id}` })));
  return [...r.assets.flatMap((a) => a.facts), ...r.market.facts, ...qualified];
}

function AssetCard({ assetId, s, at }: { assetId: string; s?: WeeklyAssetSection; at: string }) {
  const u = universeAsset(assetId)!;
  const href = `/research/${assetId}`;
  const ok = s && s.status === "ok";
  return (
    <article className="relative flex h-full min-w-0 flex-col rounded-[14px] border border-line bg-popover px-4 py-3.5 transition-colors duration-150 focus-within:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] hover:bg-hover">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ResearchAssetIcon assetId={assetId} size={32} />
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-medium text-ink">
              {/* The link covers the whole card; controls inside sit above it. */}
              <Link href={href} className="after:absolute after:inset-0 after:rounded-[14px] after:content-[''] focus-visible:outline-none">
                {u.name}
              </Link>
            </h3>
            <p className="truncate text-xs text-muted">
              {u.underlying} · borrowable at {fmtPct(u.lltv)}
            </p>
          </div>
        </div>
        {ok && (
          <div className="relative z-10 flex shrink-0 flex-col items-end gap-1">
            <ViewBadge view={s.view.view} />
            <ConvictionMeter conviction={s.view.conviction} />
          </div>
        )}
      </div>
      {!ok ? (
        <p className="mt-3 text-[13px] text-muted">No reading this week. Nothing is filled in to cover the gap.</p>
      ) : (
        <>
          <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-soft">{s.view.reasons[0]?.text ?? "No reason given."}</p>
          <div className="relative z-10 mt-3 min-h-5">
            {s.view.levels ? <LevelsRow levels={s.view.levels} compact at={at} /> : <p className="text-xs text-muted">No levels this week: not enough price data.</p>}
          </div>
          <div aria-hidden className="flex-1" />
          <div className="relative z-10 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line-soft pt-2.5">
            <AiLabel />
            {s.view.levels && <DataLabel />}
            <span className="ml-auto text-xs font-medium text-ink">Full read →</span>
          </div>
        </>
      )}
    </article>
  );
}

function Split({ split }: { split: ExampleSplit }) {
  const n = split.slices.length;
  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-popover px-4 py-3.5">
      <h4 className="mb-2 text-[13px] font-semibold capitalize text-ink">{split.profile === "cautious" ? "Cautious example" : "Growth-minded example"}</h4>
      <SplitBar parts={split.slices.map((x, i) => ({ key: x.assetId, value: x.share, color: splitColor(i, n), label: assetName(x.assetId) }))} height={8} />
      <ul className="mt-3 space-y-1.5">
        {split.slices.map((x, i) => (
          <li key={x.assetId} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <i aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: splitColor(i, n) }} />
              <span className="truncate">{assetName(x.assetId)}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink-soft">{Math.round(x.share * 100)}%</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-muted">{split.why.text}</p>
    </div>
  );
}

const RESULT: Record<Scorecard["rows"][number]["result"], { label: string; tone: "grow" | "danger" | "warn" | "neutral" }> = {
  right: { label: "Right", tone: "grow" },
  wrong: { label: "Wrong", tone: "danger" },
  mixed: { label: "Mixed", tone: "warn" },
  "no-data": { label: "No data", tone: "neutral" },
};

export function Calibration({ rows }: { rows: Scorecard["calibration"] }) {
  if (rows.length === 0) return <p className="text-[13px] text-muted">No scored calls yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {rows.map((c) => {
        const share = c.calls > 0 ? c.right / c.calls : 0;
        return (
          <li key={c.conviction} className="rounded-xl border border-line-soft bg-popover px-3.5 py-2.5">
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="font-medium capitalize">{c.conviction} conviction</span>
              <span className="tabular-nums">{c.calls > 0 ? `${Math.round(share * 100)}%` : "-"}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-press" role="meter" aria-label={`${c.conviction} conviction calls that came true`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
              <span className="block h-full rounded-full bg-ink-soft" style={{ width: `${Math.max(2, share * 100)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {c.right} of {c.calls} calls came true
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function ScorecardTable({ card, only }: { card: Scorecard; only?: string }) {
  const rows = only ? card.rows.filter((r) => r.assetId === only) : card.rows;
  if (rows.length === 0) return <p className="text-[13px] text-muted">No call to score for this week.</p>;
  return (
    <div className="-mx-4 overflow-x-auto border-t border-line-soft sm:-mx-5">
      <table className="dtable min-w-[40rem]">
        <caption className="sr-only">Views from the week of {fmtDate(card.weekOf)} and what happened</caption>
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">View</th>
            <th scope="col" className="r">
              Price then
            </th>
            <th scope="col" className="r">
              After
            </th>
            <th scope="col">Result</th>
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.assetId}>
              <td className="whitespace-nowrap font-medium">{assetName(r.assetId)}</td>
              <td>
                <ViewChip view={r.view} conviction={r.conviction} />
              </td>
              <td className="r">{fmtUsd(r.priceAtCall)}</td>
              <td className={cx("r", r.change === null ? "text-muted" : r.change >= 0 ? "text-grow" : "text-danger")}>
                {r.priceAfter === null ? "-" : fmtUsd(r.priceAfter)}
                {r.change !== null && <span className="block text-xs">{fmtPct(r.change, true)}</span>}
              </td>
              <td>
                <span className="inline-flex flex-wrap items-center gap-1">
                  <Badge tone={RESULT[r.result].tone}>{RESULT[r.result].label}</Badge>
                  {r.invalidated && <Badge tone="danger">Invalidated</Badge>}
                </span>
              </td>
              <td className="min-w-[14rem] text-xs text-ink-soft">{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ r, sample }: { r: WeeklyReport; sample: boolean }) {
  const facts = allFacts(r);
  const by = new Map(r.assets.map((a) => [a.assetId, a]));
  return (
    <>
      {!r.review.approved && (
        <Notice tone="warn">
          <Badge tone="warn">Not published</Badge> This report is waiting for review. Only reviewers can see it until it is approved.
        </Notice>
      )}

      <Card title={`Market conditions, week of ${fmtDate(r.weekOf)}`} badge={<AiLabel />} action={<AsOf at={r.generatedAt} label="Written" />}>
        <p className="max-w-3xl text-[14px] leading-relaxed text-ink">{r.market.summary}</p>
        {r.market.developments.length > 0 && (
          <div className="mt-4">
            <ReasonList items={r.market.developments} facts={facts} />
          </div>
        )}
      </Card>

      <Card title="The six assets" tip="Research covers borrowable assets only. It is done on the real market each token stands in for; the tokens you can buy here are testnet mocks.">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {UNIVERSE.map((u) => (
            <li key={u.assetId} className="min-w-0">
              <AssetCard assetId={u.assetId} s={by.get(u.assetId)} at={r.generatedAt} />
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="This week's investment ideas"
        badge={<AiLabel />}
        tip="General allocation ideas for every reader of this report, ranked across the six assets. Not an order or a recommendation for any one person."
      >
        {r.ideas.ranked.length === 0 ? (
          <p className="text-[13px] text-muted">No ideas this week.</p>
        ) : (
          <ol className="divide-y divide-line-soft">
            {[...r.ideas.ranked]
              .sort((a, b) => a.rank - b.rank)
              .map((idea) => (
                <li key={`${idea.rank}-${idea.assetId}`} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-press text-xs font-semibold tabular-nums">{idea.rank}</span>
                    <ResearchAssetIcon assetId={idea.assetId} size={20} />
                    <Link href={`/research/${idea.assetId}`} className="text-[14px] font-medium text-ink hover:underline">
                      {VIEW_LABEL[idea.view]} {assetName(idea.assetId)}
                    </Link>
                    <ViewBadge view={idea.view} />
                  </div>
                  <div className="mt-2 grid gap-2 pl-0 sm:pl-[34px]">
                    {idea.reasons.map((x, i) => (
                      <div key={i}>
                        <p className="text-[13px] leading-relaxed text-ink">{x.text}</p>
                        <CitedFacts ids={x.factIds} facts={facts} />
                      </div>
                    ))}
                    <div>
                      <p className="text-[13px] leading-relaxed text-ink-soft">
                        <span className="text-muted">Depends on: </span>
                        {idea.dependsOn.text}
                      </p>
                      <CitedFacts ids={idea.dependsOn.factIds} facts={facts} />
                    </div>
                    <div>
                      <p className="text-[13px] leading-relaxed text-ink-soft">
                        <span className="text-muted">Main risk: </span>
                        {idea.mainRisk.text}
                      </p>
                      <CitedFacts ids={idea.mainRisk.factIds} facts={facts} />
                    </div>
                  </div>
                </li>
              ))}
          </ol>
        )}
        {r.ideas.exampleSplits.length > 0 && (
          <div className="mt-5 border-t border-line-soft pt-4">
            <h3 className="text-[13px] font-semibold text-ink">Example splits</h3>
            <p className="mb-3 mt-1 text-xs text-muted">
              General examples of how a cautious and a growth-minded investor might spread money across these assets. Not an order for anyone.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {r.ideas.exampleSplits.map((s) => (
                <Split key={s.profile} split={s} />
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Reports approved before this section existed have no list: the card is left out. */}
      {r.wrongAbout && r.wrongAbout.length > 0 && (
        <Card
          title="What could we be wrong about?"
          badge={<AiLabel />}
          tip="The things most likely to make this week's views wrong, written after the views were final. Each one cites its facts and names the assets it affects."
        >
          <ol className="divide-y divide-line-soft">
            {r.wrongAbout.map((w, i) => (
              <li key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-press text-xs font-semibold tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-relaxed text-ink">{w.text}</p>
                    {w.assetIds.length > 0 && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span>Affects</span>
                        {w.assetIds.map((id) => (
                          <Link key={id} href={`/research/${id}`} className="inline-flex items-center gap-1 text-ink-soft hover:text-ink hover:underline">
                            <ResearchAssetIcon assetId={id} size={16} />
                            {assetName(id)}
                          </Link>
                        ))}
                      </p>
                    )}
                    <CitedFacts ids={w.factIds} facts={facts} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card
        title={r.scorecard ? `Last week's scorecard, week of ${fmtDate(r.scorecard.weekOf)}` : "Last week's scorecard"}
        badge={<DataLabel />}
        tip="Every view from last week's report and what happened, worked out in code. Wrong calls stay visible."
      >
        {r.scorecard ? (
          <>
            <ScorecardTable card={r.scorecard} />
            <div className="mt-5">
              <h3 className="mb-1 text-[13px] font-semibold text-ink">Calibration so far</h3>
              <p className="mb-3 text-xs text-muted">How often calls at each conviction level came true. Higher conviction should come true more often.</p>
              <Calibration rows={r.scorecard.calibration} />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted">No scorecard yet: this is the first report.</p>
        )}
      </Card>

      <p className="text-xs text-muted">
        Written by {r.model.editor}, analysis by {r.model.analysts}. Risk review: {r.review.removedClaims} unsupported claims removed, {r.review.sentBack} sections sent
        back. Run {r.runId}
        {sample ? " (sample)" : ""}.
      </p>
    </>
  );
}

export function WeeklyReportPage() {
  const w = useWeekly();
  const ready = w.status === "ready";
  const r = ready ? w.data.report : null;
  const access = ready ? w.data.access : null;
  return (
    <>
      <PageHeader
        title="Research"
        lead="The Monday report on six assets you can borrow against: Bitcoin, Ether, Gold, NVIDIA, Apple and the S&P 500. Open one for its chart read and scenarios."
        aside={r ? <Badge tone="neutral">Week of {fmtDate(r.weekOf)}</Badge> : undefined}
      />
      <ResearchTabs />
      <BetaBanner show={!r || r.beta} />
      {w.status === "error" && <LoadError error={w.error} />}
      <SampleBanner show={r?.kind === "sample"} what="report" why={ready && w.from === "sample" ? w.why : undefined} />

      {w.status === "loading" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-[14px]" />
          ))}
        </div>
      ) : access && !access.allowed ? (
        <Notice>{REFUSAL[access.reason] ?? "This report is not available right now."}</Notice>
      ) : r ? (
        <Report r={r} sample={r.kind === "sample"} />
      ) : null}

      <Disclaimer />
      <p className="text-xs text-muted">
        Reviewers: <Link href="/research/review" className="underline underline-offset-2 hover:text-ink">daily notes and grading</Link> (internal while testing).
      </p>
    </>
  );
}
