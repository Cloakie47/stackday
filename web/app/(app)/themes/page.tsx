"use client";

import { useEffect, useMemo, useState } from "react";
import { useViewer } from "@/components/providers";
import { DEFAULT_SLOT, nextSlot } from "@/lib/slots";
import { AssetIcon, Button, Card, Chip, Field, InfoTip, LabelTip, MockBadge, Notice, PageHeader, Segmented, Select, SplitBar, TxStatus, cx, splitColor } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { guideHref } from "@/lib/guide";
import { ResearchTabs } from "@/components/research/bits";
import { payrollAbi, routerAbi } from "@/lib/abis";
import { ADDR, ASSETS, CHAIN_ID, SIP_FEE_BPS, type Asset } from "@/lib/contracts";
import { assetForUsdc, fmtPct, fmtUsdc, parseUsdc } from "@/lib/format";
import {
  assetOf,
  buildPlan,
  CAPS,
  COMING_SOON,
  RISK_LEVELS,
  splitAmount,
  THEMES,
  toSipLegs,
  type Plan,
  type RiskLevel,
} from "@/lib/themes";
import { openEventsFor, themeMood, validateSnapshot } from "@/lib/themes/mood";
import snapshotJson from "@/lib/themes/mood-snapshot.json";
import { proposalToSipLegs, proposeNewMoney } from "@/lib/themes/rebalance";
import { usePortfolio, type Portfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";

/** Longer explanations live on the docs page (source text: docs/themes/for-the-docs-page.md). */
function LearnMore() {
  return (
    <a href={guideHref("themes")} className="inline-flex min-h-11 items-center text-xs font-semibold text-ink hover:text-brand-ink sm:min-h-0">
      How themes work
    </a>
  );
}

/** Market mood: a hand-built, labelled snapshot (lib/themes/mood-snapshot.json), not a live feed. */
const SNAPSHOT = validateSnapshot(snapshotJson);

function moodWord(m: number) {
  if (m <= -0.35) return "Fearful";
  if (m < -0.1) return "Uneasy";
  if (m <= 0.1) return "Calm";
  if (m < 0.35) return "Upbeat";
  return "Heated";
}

function MoodCard({ picked }: { picked: string[] }) {
  if (!SNAPSHOT || picked.length === 0) return null;
  const events = openEventsFor(SNAPSHOT, picked);
  const items = events.tickers
    .flatMap((t) => SNAPSHOT.assets[t]?.items ?? [])
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.materiality - a.materiality)
    .slice(0, 3);
  return (
    <Card
      title={`Market mood, ${SNAPSHOT.asOf.slice(0, 10)}`}
      tip={`${SNAPSHOT.label} Mood summarises recent news. It does not predict prices and does not change your split.`}
      badge={<MockBadge>Snapshot, not live</MockBadge>}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {picked.map((id) => {
          const t = THEMES.find((x) => x.id === id)!;
          const m = themeMood(SNAPSHOT, id);
          // Themes added after the snapshot was built have no news in it: say so instead of a made-up "Calm".
          const covered = t.tickers.some((x) => SNAPSHOT.assets[x]);
          const risky = t.tickers.filter((x) => SNAPSHOT.assets[x]?.materialRisk);
          return (
            <div key={id} className="rounded-xl border border-line-soft bg-popover px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-medium">{t.name}</span>
                {covered ? (
                  <span>
                    {moodWord(m)} <span className="tabular-nums text-muted">{m.toFixed(2)}</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted">Not in this snapshot</span>
                )}
              </div>
              {risky.length > 0 && (
                <p className="mt-1.5 text-xs text-danger">Open event: {risky.map((x) => assetOf(x)?.name ?? x).join(", ")}</p>
              )}
            </div>
          );
        })}
      </div>
      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-line-soft">
          {items.map((it) => {
            const a = assetFor(it.ticker);
            return (
              <li key={it.url + it.ticker} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                {a ? <AssetIcon asset={a} size={24} /> : <AssetIcon icon={it.ticker} size={24} />}
                <div className="min-w-0">
                  <a href={it.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
                    {it.title}
                  </a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
                    {it.source} · {it.publishedAt.slice(0, 10)} · {assetOf(it.ticker)?.name ?? it.ticker}
                    {it.is_opinion ? " · opinion" : ""}
                    <InfoTip label="Source quote">
                      &ldquo;{it.evidence_quote}&rdquo; Materiality {it.materiality.toFixed(2)}.
                    </InfoTip>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const usd = (v: bigint) => Number(v) / 1e6;
/** Policy: skip buys under $5. Testnet faucet amounts are tiny, so the demo uses 25 cents there. */
const MIN_TRADE_USD = CHAIN_ID === 84532 ? 0.25 : 5;
/** Oldest price a stock buy may use (policy: 2 hours). Testnet mock prices only move when the demo operator sets them, so age is not checked there. */
const MAX_PRICE_AGE_S = CHAIN_ID === 84532 ? Infinity : 2 * 3600;

/** Current unix time, ticking every 30 seconds. 0 until the page is in the browser (no clock during prerender). */
function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Holdings that must not be bought right now: frozen price feed, paused transfers, missing or stale price. */
function blockedHoldings(p: Portfolio, tickers: string[], now: number) {
  return tickers.filter((t) => {
    const a = ASSETS.find((x) => x.realTicker === t);
    const pos = a && p.positions.find((x) => x.asset.symbol === a.symbol);
    if (!pos) return false;
    if (pos.feedFrozen || pos.transfersPaused || !pos.price) return true;
    return now > 0 && pos.priceUpdatedAt !== undefined && now - Number(pos.priceUpdatedAt) > MAX_PRICE_AGE_S;
  });
}

function PriceBlock({ tickers }: { tickers: string[] }) {
  if (tickers.length === 0) return null;
  return (
    <div className="mt-3">
      <Notice tone="warn">Buying paused: no fresh price for {tickers.map((t) => assetOf(t)?.name ?? t).join(", ")}.</Notice>
    </div>
  );
}

/**
 * Holdings in the vault that are above their target. The targets shape new buys only: the contracts
 * cannot sell, so a holding that rises can drift above its target (docs/themes/research-agent.md).
 */
function overTarget(holdingsUsd: Record<string, number>, risk: RiskLevel) {
  const total = Object.values(holdingsUsd).reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  const share = (tickers: string[]) => tickers.reduce((s, t) => s + (holdingsUsd[t] ?? 0), 0) / total;
  const out: { label: string; now: number; target: number }[] = [];
  for (const t of Object.keys(holdingsUsd)) {
    const a = assetOf(t);
    if (a?.kind === "stock" && !a.cryptoLike && share([t]) > CAPS.singleStock + 0.005) out.push({ label: a.name, now: share([t]), target: CAPS.singleStock });
  }
  const crypto = Object.keys(holdingsUsd).filter((t) => assetOf(t)?.kind === "crypto" || assetOf(t)?.cryptoLike);
  if (share(crypto) > RISK_LEVELS[risk].cryptoCap + 0.005) out.push({ label: "Crypto together", now: share(crypto), target: RISK_LEVELS[risk].cryptoCap });
  const ai = Object.keys(holdingsUsd).filter((t) => assetOf(t)?.aiChips);
  if (share(ai) > CAPS.aiChips + 0.005) out.push({ label: "AI and chips group", now: share(ai), target: CAPS.aiChips });
  return out;
}

function RebalanceCard({ plan, p, share, risk }: { plan: Plan; p: Portfolio; share: number; risk: RiskLevel }) {
  const viewer = useViewer();
  const tx = useTx();
  const [amt, setAmt] = useState("");
  const newMoney = usd(parseUsdc(amt));
  const holdingsUsd: Record<string, number> = {};
  for (const x of p.positions) if (x.value > 0n) holdingsUsd[x.asset.realTicker] = usd(x.value);
  const invested = Object.values(holdingsUsd).reduce((s, v) => s + v, 0);
  // The cushion lives in the wallet, not the vault, so rebalance over the invested part only:
  // the same holdings, scaled up to 100 percent, and the new money is what the person wants to invest.
  const investedBps = plan.holdings.reduce((s, h) => s + h.bps, 0);
  const investedPlan: Plan = {
    ...plan,
    holdings: plan.holdings.map((h) => ({ ...h, bps: Math.floor((h.bps * 10_000) / Math.max(1, investedBps)) })),
  };
  investedPlan.usdcBps = 10_000 - investedPlan.holdings.reduce((s, h) => s + h.bps, 0);
  const proposal = proposeNewMoney({ plan: investedPlan, holdingsUsd, cashUsd: 0, newMoneyUsd: newMoney, minTradeUsd: MIN_TRADE_USD });
  const rows = (newMoney > 0 ? proposal.after : proposal.before).filter((r) => r.kind !== "cash" && (r.targetShare > 0 || r.valueUsd > 0));
  const before = Object.fromEntries(proposal.before.map((r) => [r.ticker, r]));

  const drifted = overTarget(holdingsUsd, risk);
  const now = useNow();
  const rebalanceBlocked = blockedHoldings(p, proposal.buys.map((b) => b.ticker), now);

  async function buyNow() {
    const buys = proposal.buys.map((b) => ({ a: assetFor(b.ticker)!, usdc: BigInt(Math.floor(b.usd * 1e6)) })).filter((b) => b.a && b.usdc > 0n);
    const total = buys.reduce((s, b) => s + b.usdc, 0n);
    const calls: Call[] = [...(await tx.withApproval(ADDR.usdc, ADDR.router, total, `Allow ${BRAND.name} to take the USDC`))];
    for (const b of buys) {
      const price = p.positions.find((x) => x.asset.symbol === b.a.symbol)?.price;
      const min = price ? (assetForUsdc(b.usdc - (b.usdc * SIP_FEE_BPS) / 10_000n, price, b.a.decimals) * 99n) / 100n : 0n;
      calls.push({ label: `Buy ${b.a.name}`, address: ADDR.router, abi: routerAbi, functionName: "invest", args: [b.a.token, b.usdc, min] });
    }
    if (await tx.run(calls, "Bought. The underweight holdings were topped up.")) setAmt("");
  }

  const legs = proposalToSipLegs(proposal, share);
  const legAssets = legs.tickers.map((t) => assetFor(t)!).filter(Boolean);
  const useForPayday = () =>
    tx.run(
      [{ label: "Point your next paydays at the underweight holdings", address: ADDR.payroll, abi: payrollAbi, functionName: "setSipPlanMany", args: [legAssets.map((a) => a.token), legs.bps] }],
      "Saved. Your payday share now goes to the underweight holdings. Switch back to the plain split any time.",
    );

  return (
    <Card title="5. Rebalance with new money" tip="New money tops up what is below target. Nothing is sold.">
      {drifted.length > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            Above target:{" "}
            {drifted.map((d) => `${d.label} is ${(d.now * 100).toFixed(0)}% of your vault (target ${(d.target * 100).toFixed(0)}%)`).join("; ")}. New
            buys go elsewhere first, but {BRAND.name} cannot sell for you, so this can last.
          </Notice>
        </div>
      )}
      {invested === 0 ? (
        <Notice>Nothing to rebalance yet.</Notice>
      ) : (
        <>
          <div className="max-w-sm">
            <Field label="New money to place" inputMode="decimal" placeholder="0.00" suffix="USDC" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </div>
          <div className="-mx-4 mt-4 overflow-x-auto border-t border-line-soft sm:-mx-5">
            <table className="dtable min-w-[28rem]">
              <thead>
                <tr>
                  <th scope="col">Holding</th>
                  <th scope="col" className="r">
                    Target
                  </th>
                  <th scope="col" className="r">
                    Now
                  </th>
                  {newMoney > 0 && (
                    <th scope="col" className="r">
                      After
                    </th>
                  )}
                  <th scope="col" className="r">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const a = assetFor(r.ticker);
                  return (
                    <tr key={r.ticker}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          {a ? <AssetIcon asset={a} size={24} /> : <AssetIcon icon={r.ticker} size={24} />}
                          <span className="truncate font-medium">{r.name}</span>
                        </span>
                      </td>
                      <td className="r">{(r.targetShare * 100).toFixed(1)}%</td>
                      <td className="r">{((before[r.ticker]?.currentShare ?? 0) * 100).toFixed(1)}%</td>
                      {newMoney > 0 && <td className="r">{(r.currentShare * 100).toFixed(1)}%</td>}
                      <td className={cx("r text-xs font-medium", before[r.ticker]?.outOfBand ? "text-warn" : "text-grow")}>
                        {before[r.ticker]?.outOfBand ? "Off target" : "In range"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {newMoney > 0 && (
            <>
              <ul className="mt-4 space-y-1.5 text-[13px]">
                {proposal.buys.map((b) => (
                  <li key={b.ticker} className="flex items-center gap-2">
                    <span className="font-medium tabular-nums">{b.usd.toFixed(2)} USDC</span> into {assetOf(b.ticker)?.name ?? b.ticker}
                    <InfoTip label={`Why ${assetOf(b.ticker)?.name ?? b.ticker}`}>{b.reason}</InfoTip>
                  </li>
                ))}
                {proposal.cashUsd > 0.005 && (
                  <li className="text-muted">{proposal.cashUsd.toFixed(2)} USDC not spent</li>
                )}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={!viewer.canAct || proposal.buys.length === 0 || rebalanceBlocked.length > 0 || parseUsdc(amt) > p.walletUsdc || tx.state.busy} onClick={buyNow}>
                  Buy these now from my wallet
                </Button>
                <Button variant="secondary" disabled={!viewer.canAct || legAssets.length === 0 || tx.state.busy} onClick={useForPayday}>
                  Use for my next paydays ({fmtPct(share)} of salary)
                </Button>
              </div>
              <PriceBlock tickers={rebalanceBlocked} />
            </>
          )}
        </>
      )}
      <TxStatus state={tx.state} />
    </Card>
  );
}

/** The real tickers that have a Stackday token on this network (on testnet: the mocks). */
const AVAILABLE = ASSETS.map((a) => a.realTicker);
const assetFor = (ticker: string): Asset | undefined => ASSETS.find((a) => a.realTicker === ticker);
const CUSHION_COLOR = "var(--press)";
function ThemePicker({ picked, toggle }: { picked: string[]; toggle: (id: string) => void }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {THEMES.map((t) => {
        const on = picked.includes(t.id);
        const live = t.tickers.filter((x) => AVAILABLE.includes(x));
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(t.id)}
            className={cx(
              "flex flex-col rounded-[14px] border px-4 py-3.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99]",
              on ? "border-[color-mix(in_srgb,var(--brand)_55%,transparent)] bg-brand-soft" : "border-line bg-popover hover:bg-hover",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-ink">{t.name}</span>
              <span
                aria-hidden
                className={cx("grid h-[18px] w-[18px] place-items-center rounded-full border", on ? "border-brand bg-brand text-white" : "border-line bg-surface")}
              >
                {on && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8.5l2.5 2.5L12 5.5" />
                  </svg>
                )}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{t.thesis}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {t.tickers.map((x) => {
                const a = assetFor(x);
                return live.includes(x) && a ? (
                  <span key={x} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-hover pl-0.5 pr-2 text-[11px] font-medium text-ink-soft">
                    <AssetIcon asset={a} size={20} />
                    {x}
                  </span>
                ) : (
                  <span key={x} className="inline-flex h-6 items-center rounded-full border border-dashed border-line px-2 text-[11px] text-muted">
                    {x}
                  </span>
                );
              })}
            </div>
          </button>
        );
      })}
      {COMING_SOON.map((name) => (
        <div key={name} className="rounded-[14px] border border-dashed border-line px-4 py-3.5 text-left" aria-disabled>
          <div className="text-[13px] font-medium text-muted">{name}</div>
          <p className="mt-1 text-xs text-muted">When tokenized on Base</p>
        </div>
      ))}
    </div>
  );
}

/** One line per holding: the themes it comes from, plus the last limit applied, which is the one that set its size (the engine keeps the full list). */
function shortWhy(why: string[]) {
  const themes = why.filter((w) => w.startsWith("In your ")).map((w) => w.replace(/^In your /, "").replace(/ theme$/, ""));
  const rest = why.filter((w) => !w.startsWith("In your "));
  const first = themes.length ? `In your ${themes.join(" and ")} theme${themes.length > 1 ? "s" : ""}` : rest.shift();
  return [first, rest[rest.length - 1]].filter(Boolean).join(". ");
}

function PlanView({ plan }: { plan: Plan }) {
  const parts = [
    ...plan.holdings.map((h, i) => ({ key: h.ticker, value: h.bps, color: splitColor(i, plan.holdings.length), label: `${h.name} ${fmtPct(h.bps)}` })),
    { key: "USDC", value: plan.usdcBps, color: CUSHION_COLOR, label: `USDC cushion ${fmtPct(plan.usdcBps)}` },
  ];
  return (
    <div>
      <SplitBar parts={parts} height={8} />
      <ul className="mt-4 divide-y divide-line-soft">
        {plan.holdings.map((h, i) => {
          const a = assetFor(h.ticker);
          return (
            <li key={h.ticker} className="flex min-h-[52px] items-center justify-between gap-4 py-2">
              <div className="flex min-w-0 items-center gap-3">
                {a ? <AssetIcon asset={a} size={24} /> : <AssetIcon icon={h.ticker} size={24} />}
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-[13px] font-medium">
                    <span className="truncate">{h.name}</span>
                    <InfoTip label={`Why ${h.name}`}>{shortWhy(h.why)}</InfoTip>
                  </div>
                  <div className="truncate text-xs text-muted">
                    {h.ticker}
                    {a && ` · testnet ${a.symbol}, mock`}
                  </div>
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-2 text-[13px] tabular-nums">
                <i className="h-2 w-2 rounded-[2px]" style={{ background: splitColor(i, plan.holdings.length) }} aria-hidden />
                {fmtPct(h.bps, 1)}
              </span>
            </li>
          );
        })}
        <li className="flex min-h-[52px] items-center justify-between gap-4 py-2 last:pb-0">
          <div className="flex items-center gap-3">
            <AssetIcon icon="USDC" size={24} />
            <div>
              <div className="text-[13px] font-medium">USDC cushion</div>
              <div className="text-xs text-muted">Kept as cash, not bought</div>
            </div>
          </div>
          <span className="flex items-center gap-2 text-[13px] tabular-nums">
            <i className="h-2 w-2 rounded-[2px]" style={{ background: CUSHION_COLOR }} aria-hidden />
            {fmtPct(plan.usdcBps, 1)}
          </span>
        </li>
      </ul>
      {plan.notes.length > 0 && (
        <div className="mt-3 space-y-2">
          {plan.notes.map((n) => (
            <Notice key={n}>{n}</Notice>
          ))}
        </div>
      )}
      {plan.previewOnly.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Preview only here:{" "}
          {plan.previewOnly.map((t) => `${assetOf(t)?.name ?? t} (${t})`).join(", ")}.
        </p>
      )}
    </div>
  );
}

export default function ThemesPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const tx = useTx();
  const [picked, setPicked] = useState<string[]>(["ai-chips", "big-tech"]);
  const [risk, setRisk] = useState<RiskLevel>("balanced");
  const [source, setSource] = useState<"salary" | "wallet">("salary");
  const [share, setShare] = useState("2000");
  const [amt, setAmt] = useState("");
  const [perBuy, setPerBuy] = useState("");
  const [interval, setIntervalDays] = useState("7");

  const plan = useMemo(() => buildPlan({ themes: picked, risk, available: AVAILABLE }), [picked, risk]);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // ---- From salary: one every-payday plan in Payroll (setSipPlanMany), no contract change.
  const legs = toSipLegs(plan, Number(share));
  const legAssets = legs.tickers.map((t) => assetFor(t)!).filter(Boolean);
  const current = p.sipPlan ?? [];
  const samePlan =
    current.length === legAssets.length &&
    current.every((leg, i) => leg.asset.toLowerCase() === legAssets[i].token.toLowerCase() && Number(leg.bps) === legs.bps[i]);

  const savePaydayPlan = () =>
    tx.run(
      [
        {
          label: "Save the theme split as your every-payday plan",
          address: ADDR.payroll,
          abi: payrollAbi,
          functionName: "setSipPlanMany",
          args: [legAssets.map((a) => a.token), legs.bps],
        },
      ],
      "Saved. From your next payday, this split is bought before you claim.",
    );

  // ---- From wallet: one-time buys or one recurring plan per asset in SipRouter.
  const once = parseUsdc(amt);
  const onceSplit = splitAmount(plan, once);
  const recurring = parseUsdc(perBuy);
  const recurringSplit = splitAmount(plan, recurring);
  const net = (v: bigint) => v - (v * SIP_FEE_BPS) / 10_000n;
  const minOut = (a: Asset, usdc: bigint) => {
    const price = p.positions.find((x) => x.asset.symbol === a.symbol)?.price;
    return price ? (assetForUsdc(net(usdc), price, a.decimals) * 99n) / 100n : 0n;
  };
  const now = useNow();
  const blocked = blockedHoldings(p, plan.holdings.map((h) => h.ticker), now);
  const pricesReady = blocked.length === 0;

  async function buyOnce() {
    const total = onceSplit.buys.reduce((s, b) => s + b.usdc, 0n);
    const calls: Call[] = [...(await tx.withApproval(ADDR.usdc, ADDR.router, total, `Allow ${BRAND.name} to take the USDC`))];
    for (const b of onceSplit.buys) {
      const a = assetFor(b.ticker)!;
      calls.push({ label: `Buy ${a.name}`, address: ADDR.router, abi: routerAbi, functionName: "invest", args: [a.token, b.usdc, minOut(a, b.usdc)] });
    }
    if (await tx.run(calls, "Bought. Everything is in your vault; the cushion stayed in your wallet.")) setAmt("");
  }

  async function startRecurring() {
    const total = recurringSplit.buys.reduce((s, b) => s + b.usdc, 0n);
    const calls: Call[] = [...(await tx.withApproval(ADDR.usdc, ADDR.router, total * 12n, "Allow up to 12 rounds of buys"))];
    for (const b of recurringSplit.buys) {
      const a = assetFor(b.ticker)!;
      calls.push({
        label: `Recurring plan for ${a.name}`,
        address: ADDR.router,
        abi: routerAbi,
        functionName: "setPlan",
        args: [a.token, b.usdc, Number(interval) * 86400, 100, nextSlot(DEFAULT_SLOT.day, DEFAULT_SLOT.time, Math.floor(Date.now() / 1000))],
      });
    }
    if (await tx.run(calls, "Recurring plans saved, one per asset. They show on the Invest page.")) setPerBuy("");
  }

  return (
    <>
      <PageHeader title="Research" lead="My themes: pick themes and a risk level. Get a split for your next buys." aside={<LearnMore />} />
      <ResearchTabs />

      {!viewer.address && <Notice>Connect a wallet to use a plan.</Notice>}

      <Card title="1. Pick your themes" badge={<MockBadge>Mock tokens on testnet</MockBadge>}>
        <ThemePicker picked={picked} toggle={toggle} />
        <p className="mt-3 text-xs text-muted">With a logo: buyable here (mock). Dashed: preview only.</p>
      </Card>

      <Card title="2. Your risk level">
        <Segmented
          value={risk}
          onChange={setRisk}
          options={(Object.keys(RISK_LEVELS) as RiskLevel[]).map((k) => ({ value: k, label: RISK_LEVELS[k].label }))}
        />
        <p className="mt-3 text-[13px] text-muted">{RISK_LEVELS[risk].blurb}</p>
        <p className="mt-2 text-xs text-muted">
          <LabelTip
            label="Targets for new buys"
            tip={`No stock above 15%. No theme above 40%. Crypto at most ${fmtPct(RISK_LEVELS[risk].cryptoCap * 10_000)}. Cash cushion at least ${fmtPct(RISK_LEVELS[risk].usdcFloor * 10_000)}.`}
          />
        </p>
      </Card>

      <Card title="3. Your suggested split">
        {plan.holdings.length === 0 ? <Notice>{plan.notes[0] ?? "Pick a theme to see a split."}</Notice> : <PlanView plan={plan} />}
      </Card>

      <MoodCard picked={picked} />

      {plan.holdings.length > 0 && (
        <Card title="4. Put it to work">
          <div className="max-w-sm">
            <Segmented
              value={source}
              onChange={setSource}
              options={[
                { value: "salary", label: "From my salary" },
                { value: "wallet", label: "From my wallet" },
              ]}
            />
          </div>

          {source === "salary" ? (
            <div className="mt-5">
              <div className="flex flex-wrap gap-2">
                {[
                  { v: "1000", l: "10% of salary" },
                  { v: "2000", l: "20% of salary" },
                  { v: "3000", l: "30% of salary" },
                ].map((o) => (
                  <Chip key={o.v} active={share === o.v} onClick={() => setShare(o.v)}>
                    {o.l}
                  </Chip>
                ))}
              </div>
              <ul className="mt-4 divide-y divide-line-soft text-[13px]">
                {legAssets.map((a, i) => (
                  <li key={a.symbol} className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <AssetIcon asset={a} size={20} />
                      <span className="truncate">
                        {a.name} <span className="text-muted">{a.symbol}, mock</span>
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{fmtPct(legs.bps[i])} of each salary</span>
                  </li>
                ))}
                <li className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                  <span className="flex items-center gap-2.5">
                    <AssetIcon icon="USDC" size={20} />
                    Paid to you as USDC
                  </span>
                  <span className="tabular-nums">{fmtPct(legs.cashBps)}</span>
                </li>
              </ul>
              {legs.dropped.length > 0 && (
                <p className="mt-2 text-xs text-muted">Left out (max 6 assets): {legs.dropped.join(", ")}</p>
              )}
              <Button className="mt-4" disabled={!viewer.canAct || legAssets.length === 0 || samePlan || tx.state.busy} onClick={savePaydayPlan}>
                {samePlan ? "This is already your payday plan" : "Use this split on every payday"}
              </Button>
              <p className="mt-2 text-xs text-muted">Replaces your current payday plan.</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-line bg-popover p-4">
                <h3 className="text-[13px] font-semibold">Buy the split once</h3>
                <div className="mt-3">
                  <Field
                    label="Amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    suffix="USDC"
                    value={amt}
                    onChange={(e) => setAmt(e.target.value)}
                    hint={
                      once > 0n
                        ? `${onceSplit.buys.length} buys, ${fmtUsdc(onceSplit.cash)} USDC stays in your wallet. Fee ${fmtPct(SIP_FEE_BPS)} each.`
                        : `Fee ${fmtPct(SIP_FEE_BPS)} per buy`
                    }
                  />
                </div>
                <Button
                  className="mt-3 w-full"
                  disabled={!viewer.canAct || once === 0n || once > p.walletUsdc || !pricesReady || onceSplit.buys.length === 0 || tx.state.busy}
                  onClick={buyOnce}
                >
                  Buy the split
                </Button>
                {once > p.walletUsdc && <p className="mt-2 text-xs text-danger">Your wallet does not hold that much USDC.</p>}
                <PriceBlock tickers={blocked} />
              </div>

              <div className="rounded-2xl border border-line bg-popover p-4">
                <h3 className="text-[13px] font-semibold">Buy the split on a schedule</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Each time" inputMode="decimal" placeholder="0.00" suffix="USDC" value={perBuy} onChange={(e) => setPerBuy(e.target.value)} />
                  <Select
                    label="How often"
                    value={interval}
                    onChange={setIntervalDays}
                    options={[
                      { value: "7", label: "Weekly" },
                      { value: "14", label: "Every 2 weeks" },
                      { value: "28", label: "Every 4 weeks" },
                    ]}
                  />
                </div>
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  disabled={!viewer.canAct || recurring === 0n || recurringSplit.buys.length === 0 || tx.state.busy}
                  onClick={startRecurring}
                >
                  Start the recurring plans
                </Button>
                {recurringSplit.buys.length > 0 && (
                  <p className="mt-2 text-xs text-muted">Per asset: {recurringSplit.buys.map((b) => `${fmtUsdc(b.usdc)} USDC ${b.ticker}`).join(", ")}</p>
                )}
              </div>
            </div>
          )}
          <TxStatus state={tx.state} />
        </Card>
      )}

      {plan.holdings.length > 0 && viewer.address && <RebalanceCard plan={plan} p={p} share={Number(share)} risk={risk} />}

      <p className="text-xs text-muted">
        <span className="font-medium text-warn">Information, not investment advice.</span> Prices can fall. Tokenized stocks are for eligible
        persons outside the US and carry no voting rights. Mock tokens on testnet.
      </p>
    </>
  );
}
