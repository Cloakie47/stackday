"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Card, Empty, PageHeader, Segmented, Skeleton, cx } from "@/components/ui";
import type { ChartInterval, ChartReadSection, Fact, TrendStructure, WeeklyAssetSection, WeeklyReport, WeeklyScenario } from "@/lib/research/types";
import { CHART_INTERVALS, CHART_INTERVAL_LABEL, isDisplayable } from "@/lib/research/types";
import { UNIVERSE, universeAsset } from "@/lib/research/universe";
import { getScores } from "./api";
import {
  AiLabel,
  AsOf,
  BetaBanner,
  ConvictionMeter,
  DataLabel,
  Disclaimer,
  FactLine,
  LevelsRow,
  LoadError,
  NOT_COVERED,
  ReasonList,
  ResearchAssetIcon,
  ResearchTabs,
  SampleBanner,
  httpsUrl,
  SubHead,
  UniverseWarning,
  ViewChip,
  fmtDate,
  fmtPct,
  fmtTime,
  fmtUsd,
  useLoad,
  useWeekly,
} from "./bits";
import { Calibration, ScorecardTable } from "./weekly-report";

const TREND: Record<TrendStructure, { label: string; cls: string }> = {
  "higher-highs-higher-lows": { label: "Higher highs and higher lows", cls: "text-grow" },
  "lower-highs-lower-lows": { label: "Lower highs and lower lows", cls: "text-danger" },
  range: { label: "Range", cls: "text-ink-soft" },
};

const patternName = (k: string) => k.replace(/^rsi/, "RSI").replace(/^macd/, "MACD").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

function ChartRead({ c, facts, at }: { c: ChartReadSection; facts: Fact[]; at: string }) {
  const pos = c.positionInRange;
  const dataTip = `Computed in code from ${CHART_INTERVAL_LABEL[c.interval].toLowerCase()} price bars, data as of ${fmtTime(at)}. The AI only describes it.`;
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="min-w-0">
          <SubHead data dataTip={dataTip}>
            Trend structure
          </SubHead>
          <p className={cx("text-[14px] font-medium", TREND[c.trend].cls)}>{TREND[c.trend].label}</p>
          <div className="mt-4">
            <SubHead data dataTip={dataTip}>
              Volatility regime
            </SubHead>
          </div>
          <p className="text-[13px]">
            <span className="font-medium capitalize">{c.volatility.regime}</span>
            {c.volatility.atrPercentile !== undefined && (
              <span className="text-muted"> · ATR at the {Math.round(c.volatility.atrPercentile * 100)}th percentile of its last year</span>
            )}
            {c.volatility.volPercentile !== undefined && (
              <span className="text-muted"> · realized volatility at the {Math.round(c.volatility.volPercentile * 100)}th percentile</span>
            )}
          </p>
        </div>
        <div className="min-w-0">
          <SubHead data dataTip={dataTip}>
            Support and resistance
          </SubHead>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <p className="text-xs text-muted">Support, nearest first</p>
              <ul className="mt-1 space-y-0.5 tabular-nums">
                {c.support.length ? c.support.map((v) => <li key={v}>{fmtUsd(v)}</li>) : <li className="text-muted">none found</li>}
              </ul>
            </div>
            <div>
              <p className="text-xs text-muted">Resistance, nearest first</p>
              <ul className="mt-1 space-y-0.5 tabular-nums">
                {c.resistance.length ? c.resistance.map((v) => <li key={v}>{fmtUsd(v)}</li>) : <li className="text-muted">none found</li>}
              </ul>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs text-muted">Where price sits</p>
            {pos === null ? (
              <p className="text-[13px] text-muted">Not available: one side has no level.</p>
            ) : (
              <>
                <div className="relative mt-2 h-1.5 rounded-full bg-press" role="meter" aria-label="Price between nearest support and resistance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)}>
                  <span aria-hidden className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink" style={{ left: `${Math.min(100, Math.max(0, pos * 100))}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-muted">
                  <span>Support</span>
                  <span>{Math.round(pos * 100)}% of the way up</span>
                  <span>Resistance</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div>
        <SubHead data dataTip="Patterns are found in code from swing points, ranges, moving averages and divergences. The AI may describe them, never invent one.">
          Patterns
        </SubHead>
        {c.patterns.length === 0 ? (
          <p className="text-[13px] text-muted">No pattern detected on {CHART_INTERVAL_LABEL[c.interval].toLowerCase()} bars.</p>
        ) : (
          <ul className="grid gap-2">
            {c.patterns.map((p) => (
              <li key={p.id} className="rounded-xl border border-line-soft bg-popover px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{patternName(p.kind)}</span>
                  <Badge tone={p.direction === "bullish" ? "grow" : p.direction === "bearish" ? "danger" : "neutral"}>{p.direction}</Badge>
                  <ConvictionMeter conviction={p.confidence} label="Confidence" />
                  <span className="text-xs text-muted">
                    Invalidated at <span className="font-medium tabular-nums text-ink">{fmtUsd(p.invalidation)}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{p.detail}</p>
                <p className="mt-0.5 text-xs text-faint">Confirmed {fmtTime(p.asOf)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <SubHead ai>What it means</SubHead>
        <ReasonList items={c.text} facts={facts} empty="No description for this timeframe." />
      </div>
    </div>
  );
}

const SCEN: { key: "bull" | "base" | "bear"; name: string; cls: string; bar: string }[] = [
  { key: "bull", name: "Bull case", cls: "text-grow", bar: "bg-grow" },
  { key: "base", name: "Base case", cls: "text-ink", bar: "bg-ink-soft" },
  { key: "bear", name: "Bear case", cls: "text-danger", bar: "bg-danger" },
];

function Scenarios({ s, facts }: { s: WeeklyAssetSection["scenarios"]; facts: Fact[] }) {
  const total = SCEN.reduce((n, x) => n + s[x.key].probability, 0);
  return (
    <>
      <div className="flex h-2 overflow-hidden rounded-full bg-press" role="img" aria-label={SCEN.map((x) => `${x.name} ${s[x.key].probability}%`).join(", ")}>
        {SCEN.map((x) => (
          <span key={x.key} className={x.bar} style={{ width: `${total > 0 ? (s[x.key].probability / total) * 100 : 0}%` }} />
        ))}
      </div>
      {total !== 100 && <p className="mt-2 text-xs text-warn">These probabilities add up to {total}%, not 100%.</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {SCEN.map((x) => {
          const sc: WeeklyScenario = s[x.key];
          return (
            <div key={x.key} className="min-w-0 rounded-[14px] border border-line bg-popover px-4 py-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className={cx("text-[13px] font-semibold", x.cls)}>{x.name}</h3>
                <span className="text-[13px] font-medium tabular-nums">{sc.probability}%</span>
              </div>
              <ReasonList items={[sc]} facts={facts} />
              <dl className="mt-3 grid gap-1 border-t border-line-soft pt-2.5 text-xs">
                <div>
                  <dt className="inline text-muted">Levels: </dt>
                  <dd className="inline tabular-nums">{sc.levels.length ? sc.levels.map(fmtUsd).join(", ") : "none"}</dd>
                </div>
                <div>
                  <dt className="inline text-muted">Trigger: </dt>
                  <dd className="inline">{sc.trigger}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">Rough probabilities for this week, not promises. Levels come from the code chart read.</p>
    </>
  );
}

function Scores({ assetId, report }: { assetId: string; report: WeeklyReport }) {
  const sc = useLoad(() => getScores(assetId), `scores-${assetId}`);
  return (
    <>
      {report.scorecard && (
        <div className="mb-5">
          <h3 className="mb-2 text-[13px] font-semibold text-ink">Last week&apos;s call, week of {fmtDate(report.scorecard.weekOf)}</h3>
          <ScorecardTable card={report.scorecard} only={assetId} />
        </div>
      )}
      <h3 className="mb-2 text-[13px] font-semibold text-ink">Daily track record</h3>
      {sc.status === "loading" ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : sc.status === "error" ? (
        <LoadError error={sc.error} />
      ) : (
        <>
          {sc.from === "sample" && <p className="mb-3 text-xs text-warn">Sample scores for the demo, not a real track record.</p>}
          {sc.data.scores.length === 0 ? (
            <Empty>No scored calls yet. The record starts with the first daily run.</Empty>
          ) : (
            <div className="-mx-4 overflow-x-auto border-t border-line-soft sm:-mx-5">
              <table className="dtable min-w-[40rem]">
                <caption className="sr-only">Automatic scores for {universeAsset(assetId)?.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">View</th>
                    <th scope="col" className="r">
                      Price then
                    </th>
                    <th scope="col" className="r">
                      1 day
                    </th>
                    <th scope="col" className="r">
                      5 days
                    </th>
                    <th scope="col">Levels</th>
                    <th scope="col" className="r">
                      Facts sourced
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...sc.data.scores]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((s) => (
                      <tr key={s.date}>
                        <td className="whitespace-nowrap">{fmtDate(s.date)}</td>
                        <td>
                          <ViewChip view={s.view} conviction={s.conviction} />
                        </td>
                        <td className="r">{fmtUsd(s.priceAtNote)}</td>
                        <ScoreCell change={s.change1d} right={s.direction1d} />
                        <ScoreCell change={s.change5d} right={s.direction5d} />
                        <td>{s.levelsHeld === undefined ? <span className="text-muted">pending</span> : s.levelsHeld ? "Held" : <span className="text-danger">Broke</span>}</td>
                        <td className={cx("r", s.factsShare < 1 && "text-warn")}>{Math.round(s.factsShare * 100)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-5">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Calibration</h3>
            <Calibration rows={sc.data.calibration} />
          </div>
        </>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Every call is scored in code after 1 and 5 trading days, right or wrong, and all of them stay here. A change is the price move since the call, not a
        return anyone made. No claim is made that these views beat plain regular buying.
      </p>
    </>
  );
}

function ScoreCell({ change, right }: { change?: number; right?: boolean }) {
  if (change === undefined) return <td className="r text-muted">pending</td>;
  return (
    <td className="r">
      <span className={change >= 0 ? "text-grow" : "text-danger"}>{fmtPct(change, true)}</span>
      {right !== undefined && <span className={cx("block text-xs", right ? "text-ink-soft" : "text-danger")}>{right ? "as the view said" : "against the view"}</span>}
    </td>
  );
}

function Section({ s, r }: { s: WeeklyAssetSection; r: WeeklyReport }) {
  const [tf, setTf] = useState<ChartInterval>("1d");
  // Facts marked not for display (licence) are never shown or cited on the page.
  const facts = [...s.facts, ...r.market.facts].filter(isDisplayable);
  const shownFacts = s.facts.filter(isDisplayable);
  const c = s.chart[tf];
  const v = s.view;
  return (
    <>
      <Card title="Last week" badge={<AiLabel />}>
        <ReasonList items={s.recap} facts={facts} empty="No recap this week." />
      </Card>

      <Card title="Chart read" tip="Daily, weekly and monthly bars. Every level and pattern is computed in code; the AI only describes them.">
        <div className="max-w-sm">
          <Segmented ariaLabel="Timeframe" value={tf} onChange={setTf} options={CHART_INTERVALS.map((t) => ({ value: t, label: CHART_INTERVAL_LABEL[t] }))} />
        </div>
        <div className="mt-5" aria-live="polite">
          {c ? <ChartRead c={c} facts={facts} at={r.generatedAt} /> : <p className="text-[13px] text-muted">No reading on {CHART_INTERVAL_LABEL[tf].toLowerCase()} bars this week.</p>}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Market conditions" badge={<AiLabel />}>
          <ReasonList items={s.market} facts={facts} empty="Nothing specific to this asset this week." />
        </Card>
        <Card title="Geopolitics and news" badge={<AiLabel />} tip="Every item cites a dated source. Company press releases count as one side, never the only source.">
          <ReasonList items={s.news} facts={facts} empty="No news item cleared the source check this week." />
        </Card>
      </div>

      <Card title="Week ahead" badge={<DataLabel />} tip="From official calendars, gathered in code.">
        {s.weekAhead.length === 0 ? (
          <p className="text-[13px] text-muted">No scheduled event found for this asset.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {[...s.weekAhead]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
                  <span className="text-[13px]">
                    <span className="font-medium tabular-nums">{fmtDate(e.date)}</span>
                    {e.timeUtc && <span className="text-muted"> {e.timeUtc} UTC</span>}
                    <span className="text-ink"> · {e.name}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {httpsUrl(e.source.url) ? (
                      <a href={httpsUrl(e.source.url)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                        {e.source.name}
                      </a>
                    ) : (
                      e.source.name
                    )}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card title="Scenarios for the week" badge={<AiLabel />}>
        <Scenarios s={s.scenarios} facts={facts} />
      </Card>

      <Card title="This week's view" badge={<AiLabel />} tip="General research for everyone who reads the report, never a personal instruction.">
        <ViewChip view={v.view} conviction={v.conviction} withTip />
        <div className="mt-4 border-t border-line-soft pt-3">
          <SubHead data dataTip="Buy zone and invalidation are computed in code from support, resistance and ATR.">
            Levels
          </SubHead>
          {v.levels ? (
            <>
              <LevelsRow levels={v.levels} at={r.generatedAt} />
              <p className="mt-1.5 text-xs text-muted">{v.levels.basis}</p>
            </>
          ) : (
            <p className="text-[13px] text-muted">No buy zone or invalidation this week: not enough price data.</p>
          )}
        </div>
        <div className="mt-4 border-t border-line-soft pt-3">
          <SubHead ai>The reasons that matter most</SubHead>
          <ReasonList items={v.reasons} facts={facts} />
        </div>
        {s.debate && (s.debate.bull.length > 0 || s.debate.bear.length > 0) && (
          <details className="mt-4 border-t border-line-soft pt-3">
            <summary className="cursor-pointer text-[13px] font-medium text-ink">Strongest case each way</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <SubHead ai>Bull</SubHead>
                <ReasonList items={s.debate.bull} facts={facts} />
              </div>
              <div>
                <SubHead ai>Bear</SubHead>
                <ReasonList items={s.debate.bear} facts={facts} />
              </div>
            </div>
          </details>
        )}
      </Card>

      <Card title="Borrowing note" badge={<DataLabel tip="Computed in code from the lending market's liquidation limit (LLTV)." />}>
        <p className="max-w-3xl text-[13px] leading-relaxed text-ink">{s.borrowing.text}</p>
        {s.borrowing.examples.length > 0 && (
          <div className="-mx-4 mt-3 overflow-x-auto border-t border-line-soft sm:-mx-5">
            <table className="dtable min-w-[24rem]">
              <caption className="sr-only">What a fall in price does to a loan</caption>
              <thead>
                <tr>
                  <th scope="col">Price fall</th>
                  <th scope="col" className="r">
                    Loan at, of the limit
                  </th>
                  <th scope="col" className="r">
                    Moves to
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.borrowing.examples.map((e) => (
                  <tr key={e.drop}>
                    <td>{fmtPct(e.drop)}</td>
                    <td className="r">{fmtPct(e.fromLimitUse)}</td>
                    <td className={cx("r font-medium", e.toLimitUse >= 1 ? "text-danger" : e.toLimitUse >= 0.85 ? "text-warn" : "")}>
                      {e.toLimitUse >= 1 ? "Can be liquidated" : fmtPct(e.toLimitUse)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="All facts used" badge={<DataLabel />} tip="Fetched by code, never written by the AI. Each shows its source and time.">
        {shownFacts.length === 0 ? (
          <p className="text-[13px] text-muted">No facts.</p>
        ) : (
          <details>
            <summary className="cursor-pointer text-[13px] text-ink-soft">Show {shownFacts.length} facts</summary>
            <ul className="mt-3 space-y-1.5">
              {shownFacts.map((f) => (
                <FactLine key={f.id} fact={f} />
              ))}
            </ul>
          </details>
        )}
      </Card>
    </>
  );
}

/** Asset page for a research-universe asset. The route checks coverage before rendering this. */
export function AssetResearch({ assetId }: { assetId: string }) {
  const u = universeAsset(assetId)!;
  const w = useWeekly();
  const r = w.status === "ready" ? w.data.report : null;
  const s = r?.assets.find((a) => a.assetId === assetId);
  const ok = s && s.status === "ok";

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/research" className="inline-flex min-h-11 items-center hover:text-ink sm:min-h-0">
              Research
            </Link>
            <span aria-hidden>/</span>
            <span>{u.name}</span>
          </>
        }
        title={
          <span className="inline-flex items-center gap-3">
            <ResearchAssetIcon assetId={assetId} size={40} />
            {u.name}
          </span>
        }
        lead={`${u.underlying} · ${u.sector} · borrowable at ${fmtPct(u.lltv)} · testnet token ${u.assetId} (mock)`}
        aside={ok ? <ViewChip view={s.view.view} conviction={s.view.conviction} withTip /> : undefined}
      />
      <ResearchTabs />
      <BetaBanner show={!r || r.beta} />
      {w.status === "error" && <LoadError error={w.error} />}
      <SampleBanner show={r?.kind === "sample"} what="report" why={w.status === "ready" && w.from === "sample" ? w.why : undefined} />
      <UniverseWarning assetId={assetId} />
      {r && (
        <p className="text-xs text-muted">
          From the report for the week of {fmtDate(r.weekOf)} · <AsOf at={r.generatedAt} label="written" />
        </p>
      )}

      {w.status === "loading" ? (
        <Card>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </Card>
      ) : r && w.status === "ready" && !w.data.access.allowed ? (
        <Card title="This week's report">
          <Empty>This week&apos;s report is not open for this wallet. See Plans.</Empty>
        </Card>
      ) : r && ok ? (
        <Section s={s} r={r} />
      ) : r ? (
        <Card title="This week">
          <Empty>No reading this week for {u.name}. When data or the analysis fails, nothing is filled in to cover the gap.</Empty>
        </Card>
      ) : null}

      {r && (
        <Card title="Scorecard and track record" badge={<DataLabel />}>
          <Scores assetId={assetId} report={r} />
        </Card>
      )}

      <Disclaimer />
    </>
  );
}

/** Shown for any asset outside the research universe. */
export function NotCovered({ asset }: { asset: string }) {
  return (
    <>
      <PageHeader
        crumb={
          <Link href="/research" className="inline-flex min-h-11 items-center hover:text-ink sm:min-h-0">
            Research
          </Link>
        }
        title={asset}
        lead={NOT_COVERED}
      />
      <ResearchTabs />
      <Card title="Not covered">
        <p className="text-[13px] leading-relaxed text-ink">
          {NOT_COVERED} Covered now: {UNIVERSE.map((a) => a.name).join(", ")}, each with a lending market on Stackday.
        </p>
        <Link href="/research" className="mt-3 inline-flex min-h-11 items-center text-[13px] font-medium text-ink underline underline-offset-2 sm:min-h-0">
          Back to this week&apos;s report
        </Link>
      </Card>
      <Disclaimer />
    </>
  );
}
