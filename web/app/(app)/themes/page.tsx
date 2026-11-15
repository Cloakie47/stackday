"use client";

import { useMemo, useState } from "react";
import { useViewer } from "@/components/providers";
import { Button, Card, Chip, Field, MockBadge, Notice, PageHeader, Segmented, Select, SplitBar, TxStatus } from "@/components/ui";
import { payrollAbi, routerAbi } from "@/lib/abis";
import { ADDR, ASSETS, CHAIN_ID, SIP_FEE_BPS, type Asset } from "@/lib/contracts";
import { assetForUsdc, fmtPct, fmtUsdc, parseUsdc } from "@/lib/format";
import {
  assetOf,
  buildPlan,
  COMING_SOON,
  RISK_LEVELS,
  splitAmount,
  THEMES,
  toSipLegs,
  type Plan,
  type RiskLevel,
} from "@/lib/themes";
import { dcaFor, themeMood, validateSnapshot } from "@/lib/themes/mood";
import snapshotJson from "@/lib/themes/mood-snapshot.json";
import { proposalToSipLegs, proposeNewMoney } from "@/lib/themes/rebalance";
import { usePortfolio, type Portfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";

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
  const dca = dcaFor(SNAPSHOT, picked);
  const items = dca.tickers
    .flatMap((t) => SNAPSHOT.assets[t]?.items ?? [])
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.materiality - a.materiality)
    .slice(0, 6);
  return (
    <Card title="Market mood" badge={<MockBadge>Snapshot, not live</MockBadge>}>
      <p className="max-w-3xl text-xs leading-relaxed text-muted">{SNAPSHOT.label}</p>
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
                <p className="mt-1.5 text-xs text-danger">Open material event: {risky.map((x) => assetOf(x)?.name ?? x).join(", ")}. No faster buying for it.</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl bg-sunken p-4">
        <div className="text-sm font-semibold">This week&apos;s buying pace: {dca.multiplier.toFixed(2)}x your usual amount</div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Mood changes how fast to buy, never what to buy. Cheap plus calm news means buy more (up to 1.5x); hype means buy less
          (down to 0.5x, the rest stays as USDC).
          {dca.materialRisk && ` Capped at 1x because of an open material event (${dca.riskTickers.map((x) => assetOf(x)?.name ?? x).join(", ")}).`}
          {dca.value === 0 && " Value scores are not measured in this snapshot, so the pace only reacts to the news."} It is a suggestion; nothing changes
          unless you change your amounts.
        </p>
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

function RebalanceCard({ plan, p, share }: { plan: Plan; p: Portfolio; share: number }) {
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
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        Stackday never sells for you. When your vault drifts away from the split, new money (a payday share or a buy from your
        wallet) goes to what is below target first. You see the proposal and sign it, or ignore it.
      </p>
      {invested === 0 ? (
        <Notice>Nothing in your vault yet, so there is nothing to rebalance. Your first buy is simply the split above.</Notice>
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
                  <li className="text-muted">{proposal.cashUsd.toFixed(2)} USDC is not spent (amounts too small to buy, or no room under target).</li>
                )}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={!viewer.canAct || proposal.buys.length === 0 || parseUsdc(amt) > p.walletUsdc || tx.state.busy} onClick={buyNow}>
                  Buy these now from my wallet
                </Button>
                <Button variant="secondary" disabled={!viewer.canAct || legAssets.length === 0 || tx.state.busy} onClick={useForPayday}>
                  Use for my next paydays ({fmtPct(share)} of salary)
                </Button>
              </div>
            </>
          )}
          <p className="mt-3 text-xs text-muted">Values use the reference prices shown on the site (mock prices on testnet). A holding is off target when it is more than 5 points, or more than a quarter of its target, away.</p>
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
          <p className="mt-1.5 text-xs text-muted">Unlocks when these stocks are tokenized on Base and supported here.</p>
        </div>
      ))}
    </div>
  );
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
                  <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-muted">
                    {h.why.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
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
              <p className="mt-1 text-xs text-muted">Kept as cash, not bought. Dry powder for cheaper weeks and a buffer for price gaps.</p>
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
          Preview only on this network (no testnet token, never bought here):{" "}
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
  const pricesReady = plan.holdings.every((h) => {
    const a = assetFor(h.ticker);
    return !a || p.positions.find((x) => x.asset.symbol === a.symbol)?.price;
  });

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
        lead="Pick the themes you care about and how much risk you want. Stackday suggests a split with hard limits, explains every line, and you decide whether to use it. Information, not advice."
      />

      {!viewer.address && <Notice>Connect your wallet (top right) to put a plan to work. You can explore themes without it.</Notice>}

      <Card title="1. Pick your themes" badge={<MockBadge>Mock tokens on testnet</MockBadge>}>
        <ThemePicker picked={picked} toggle={toggle} />
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Themes only use tokenized stocks that really exist on Base, plus Bitcoin and Ether. Dark tags can be bought on this
          test network (as mock tokens); grey tags are a preview.
        </p>
      </Card>

      <Card title="2. Your risk level">
        <Segmented
          value={risk}
          onChange={setRisk}
          options={(Object.keys(RISK_LEVELS) as RiskLevel[]).map((k) => ({ value: k, label: RISK_LEVELS[k].label }))}
        />
        <p className="mt-3 text-sm text-muted">{RISK_LEVELS[risk].blurb}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
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
              <p className="max-w-2xl text-sm leading-relaxed text-muted">
                Save this split as your every-payday plan. Before each claim, the share you pick is bought into your own
                vault; the rest of the salary, including the cushion part, is paid to you as USDC. Payday plans hold at most 6
                assets.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
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
                <p className="mt-2 text-xs text-muted">Left out (only 6 fit, their part is paid as USDC): {legs.dropped.join(", ")}.</p>
              )}
              <Button className="mt-4" disabled={!viewer.canAct || legAssets.length === 0 || samePlan || tx.state.busy} onClick={savePaydayPlan}>
                {samePlan ? "This is already your payday plan" : "Use this split on every payday"}
              </Button>
              <p className="mt-2 text-xs text-muted">One signature. It replaces any every-payday plan you had; you can change or turn it off on Get paid.</p>
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
                        ? `${onceSplit.buys.length} buys, ${fmtUsdc(onceSplit.cash)} USDC stays in your wallet as the cushion. Fee ${fmtPct(SIP_FEE_BPS)} per buy.`
                        : `Fee: ${fmtPct(SIP_FEE_BPS)} of each buy.`
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
                <p className="mt-2 text-xs text-muted">One signature per asset (plus one approval). Each buy refuses a price more than 1% worse than the reference price.</p>
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
                <p className="mt-2 text-xs text-muted">
                  One recurring plan per asset ({recurringSplit.buys.map((b) => `${fmtUsdc(b.usdc)} USDC ${b.ticker}`).join(", ") || "set an amount"}).
                  It replaces an existing plan for the same asset.
                </p>
              </div>
            </div>
          )}
          <TxStatus state={tx.state} />
        </Card>
      )}

      {plan.holdings.length > 0 && viewer.address && <RebalanceCard plan={plan} p={p} share={Number(share)} />}

      <Notice tone="warn">
        <strong>Information, not advice.</strong> The split comes from fixed, published rules applied to the themes and risk
        level you chose. It is not a recommendation to buy anything. Prices can fall. Tokenized stocks are for eligible
        people outside the United States and carry no voting rights. On this test network every asset is a mock token.
      </Notice>
    </>
  );
}
