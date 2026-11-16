"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useViewer } from "@/components/providers";
import { Button, Card, Chip, Field, MockBadge, Notice, PageHeader, Segmented, Select, SplitBar, TxStatus } from "@/components/ui";
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
    <Link href="/docs#themes" className="text-[13px] font-semibold text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand">
      Learn more
    </Link>
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
    <Card title={`Market mood, reading of ${SNAPSHOT.asOf.slice(0, 10)}`} badge={<MockBadge>Snapshot, not live</MockBadge>} action={<LearnMore />}>
      <p className="text-xs text-muted">{SNAPSHOT.label}</p>
      <p className="mt-1 text-xs text-muted">Mood summarises recent news. It does not predict prices and does not change your split.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {picked.map((id) => {
          const t = THEMES.find((x) => x.id === id)!;
          const m = themeMood(SNAPSHOT, id);
          const risky = t.tickers.filter((x) => SNAPSHOT.assets[x]?.materialRisk);
          return (
            <div key={id} className="rounded-2xl border border-line p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{t.name}</span>
                <span className="text-sm font-semibold">
                  {moodWord(m)} <span className="font-normal tabular-nums text-muted">({m.toFixed(2)})</span>
                </span>
              </div>
              {risky.length > 0 && (
                <p className="mt-1.5 text-xs text-danger">Open event: {risky.map((x) => assetOf(x)?.name ?? x).join(", ")}</p>
              )}
            </div>
          );
        })}
      </div>
      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {items.map((it) => (
            <li key={it.url + it.ticker} className="py-3 first:pt-0 last:pb-0">
              <a href={it.url} target="_blank" rel="noreferrer" className="text-sm font-semibold underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                {it.title}
              </a>
              <div className="mt-0.5 text-xs text-muted">
                {it.source} · {it.publishedAt.slice(0, 10)} · {assetOf(it.ticker)?.name ?? it.ticker} · materiality {it.materiality.toFixed(2)}
                {it.is_opinion ? " · opinion" : ""}
              </div>
              <p className="mt-1 text-xs italic leading-relaxed text-ink-soft">&ldquo;{it.evidence_quote}&rdquo;</p>
            </li>
          ))}
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
    const calls: Call[] = [...(await tx.withApproval(ADDR.usdc, ADDR.router, total, "Allow Stackday to take the USDC"))];
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
    <Card title="5. Rebalance with new money">
      <p className="text-sm text-muted">New money tops up what is below target. Nothing is sold.</p>
      {drifted.length > 0 && (
        <div className="mt-3">
          <Notice tone="warn">
            Above target:{" "}
            {drifted.map((d) => `${d.label} is ${(d.now * 100).toFixed(0)}% of your vault (target ${(d.target * 100).toFixed(0)}%)`).join("; ")}. New
            buys go elsewhere first, but Stackday cannot sell for you, so this can last.
          </Notice>
        </div>
      )}
      {invested === 0 ? (
        <div className="mt-4">
          <Notice>Nothing to rebalance yet.</Notice>
        </div>
      ) : (
        <>
          <div className="mt-4 max-w-sm">
            <Field label="New money to place" inputMode="decimal" placeholder="0.00" suffix="USDC" value={amt} onChange={(e) => setAmt(e.target.value)} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Holding</th>
                  <th className="py-2 text-right font-medium">Target</th>
                  <th className="py-2 text-right font-medium">Now</th>
                  {newMoney > 0 && <th className="py-2 text-right font-medium">After</th>}
                  <th className="py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.ticker}>
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-right tabular-nums">{(r.targetShare * 100).toFixed(1)}%</td>
                    <td className="py-2 text-right tabular-nums">{((before[r.ticker]?.currentShare ?? 0) * 100).toFixed(1)}%</td>
                    {newMoney > 0 && <td className="py-2 text-right tabular-nums">{(r.currentShare * 100).toFixed(1)}%</td>}
                    <td className={`py-2 text-right text-xs font-semibold ${before[r.ticker]?.outOfBand ? "text-warn" : "text-grow"}`}>
                      {before[r.ticker]?.outOfBand ? "Off target" : "In range"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {newMoney > 0 && (
            <>
              <ul className="mt-4 space-y-1 text-sm">
                {proposal.buys.map((b) => (
                  <li key={b.ticker}>
                    <span className="font-semibold tabular-nums">{b.usd.toFixed(2)} USDC</span> into {assetOf(b.ticker)?.name ?? b.ticker}:{" "}
                    <span className="text-muted">{b.reason}</span>
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
const CUSHION_COLOR = "#cbd5e1";
const PREVIEW_COLOR = "#94a3b8";

function colorOf(ticker: string) {
  return assetFor(ticker)?.color ?? PREVIEW_COLOR;
}

function ThemePicker({ picked, toggle }: { picked: string[]; toggle: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {THEMES.map((t) => {
        const on = picked.includes(t.id);
        const live = t.tickers.filter((x) => AVAILABLE.includes(x));
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(t.id)}
            className={`rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.99] ${
              on ? "border-ink bg-surface" : "border-line bg-surface/60 hover:border-line-strong"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t.name}</span>
              <span className={`text-xs font-semibold ${on ? "text-brand" : "text-muted"}`}>{on ? "Picked" : "Pick"}</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{t.thesis}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.tickers.map((x) => (
                <span
                  key={x}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    live.includes(x) ? "bg-ink text-canvas" : "bg-sunken text-muted"
                  }`}
                  title={live.includes(x) ? "Can be bought here" : "Preview only on this network"}
                >
                  {x}
                </span>
              ))}
            </div>
          </button>
        );
      })}
      {COMING_SOON.map((name) => (
        <div key={name} className="rounded-2xl border border-dashed border-line p-4 text-left opacity-70" aria-disabled>
          <div className="text-sm font-semibold">{name}</div>
          <p className="mt-1.5 text-xs text-muted">When tokenized on Base</p>
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
    ...plan.holdings.map((h) => ({ key: h.ticker, value: h.bps, color: colorOf(h.ticker), label: `${h.name} ${fmtPct(h.bps)}` })),
    { key: "USDC", value: plan.usdcBps, color: CUSHION_COLOR, label: `USDC cushion ${fmtPct(plan.usdcBps)}` },
  ];
  return (
    <div>
      <SplitBar parts={parts} height={14} />
      <ul className="mt-5 divide-y divide-line">
        {plan.holdings.map((h) => {
          const a = assetFor(h.ticker);
          return (
            <li key={h.ticker} className="flex items-start justify-between gap-4 py-3 first:pt-0">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(h.ticker) }} aria-hidden />
                <div>
                  <div className="text-sm font-semibold">
                    {h.name} <span className="font-normal text-muted">{h.ticker}</span>
                    {a && <span className="ml-1.5 text-xs font-normal text-muted">(testnet: {a.symbol}, mock)</span>}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{shortWhy(h.why)}</p>
                </div>
              </div>
              <span className="text-sm font-semibold tabular-nums">{fmtPct(h.bps, 1)}</span>
            </li>
          );
        })}
        <li className="flex items-start justify-between gap-4 py-3 last:pb-0">
          <div className="flex items-start gap-3">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: CUSHION_COLOR }} aria-hidden />
            <div>
              <div className="text-sm font-semibold">USDC cushion</div>
              <p className="mt-1 text-xs text-muted">Kept as cash, not bought</p>
            </div>
          </div>
          <span className="text-sm font-semibold tabular-nums">{fmtPct(plan.usdcBps, 1)}</span>
        </li>
      </ul>
      {plan.notes.length > 0 && (
        <div className="mt-4 space-y-2">
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
    const calls: Call[] = [...(await tx.withApproval(ADDR.usdc, ADDR.router, total, "Allow Stackday to take the USDC"))];
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
        args: [a.token, b.usdc, Number(interval) * 86400, 100],
      });
    }
    if (await tx.run(calls, "Recurring plans saved, one per asset. They show on the Invest page.")) setPerBuy("");
  }

  return (
    <>
      <PageHeader
        title="Themes"
        lead="Pick themes and a risk level. Get a split for your next buys."
        aside={<LearnMore />}
      />

      {!viewer.address && <Notice>Connect a wallet to use a plan.</Notice>}

      <Card title="1. Pick your themes" badge={<MockBadge>Mock tokens on testnet</MockBadge>}>
        <ThemePicker picked={picked} toggle={toggle} />
        <p className="mt-3 text-xs text-muted">Dark: buyable here (mock). Grey: preview only.</p>
      </Card>

      <Card title="2. Your risk level">
        <Segmented
          value={risk}
          onChange={setRisk}
          options={(Object.keys(RISK_LEVELS) as RiskLevel[]).map((k) => ({ value: k, label: RISK_LEVELS[k].label }))}
        />
        <p className="mt-3 text-sm text-muted">{RISK_LEVELS[risk].blurb}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
          <span className="font-semibold">Targets for new buys:</span>
          <span>No stock above 15%</span>
          <span aria-hidden>·</span>
          <span>No theme above 40%</span>
          <span aria-hidden>·</span>
          <span>Crypto at most {fmtPct(RISK_LEVELS[risk].cryptoCap * 10_000)}</span>
          <span aria-hidden>·</span>
          <span>Cash cushion at least {fmtPct(RISK_LEVELS[risk].usdcFloor * 10_000)}</span>
        </div>
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
              <ul className="mt-4 divide-y divide-line text-sm">
                {legAssets.map((a, i) => (
                  <li key={a.symbol} className="flex justify-between py-2">
                    <span>
                      {a.name} <span className="text-muted">({a.symbol}, mock)</span>
                    </span>
                    <span className="tabular-nums">{fmtPct(legs.bps[i])} of each salary</span>
                  </li>
                ))}
                <li className="flex justify-between py-2">
                  <span>Paid to you as USDC</span>
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
              <div className="rounded-2xl border border-line p-4">
                <h3 className="text-sm font-semibold">Buy the split once</h3>
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

              <div className="rounded-2xl border border-line p-4">
                <h3 className="text-sm font-semibold">Buy the split on a schedule</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Each time" inputMode="decimal" placeholder="0.00" suffix="USDC" value={perBuy} onChange={(e) => setPerBuy(e.target.value)} />
                  <Select
                    label="How often"
                    value={interval}
                    onChange={setIntervalDays}
                    options={[
                      { value: "1", label: "Daily" },
                      { value: "7", label: "Weekly" },
                      { value: "14", label: "Every 2 weeks" },
                      { value: "30", label: "Monthly" },
                    ]}
                  />
                </div>
                <Button
                  variant="ink"
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

      <Notice tone="warn">
        <strong>Information, not advice.</strong> Prices can fall. Not for people in the United States. No voting rights. Mock
        tokens on testnet.
      </Notice>
    </>
  );
}
