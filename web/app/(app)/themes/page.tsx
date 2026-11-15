"use client";

import { useMemo, useState } from "react";
import { useViewer } from "@/components/providers";
import { Button, Card, Chip, Field, MockBadge, Notice, PageHeader, Segmented, Select, SplitBar, TxStatus } from "@/components/ui";
import { payrollAbi, routerAbi } from "@/lib/abis";
import { ADDR, ASSETS, SIP_FEE_BPS, type Asset } from "@/lib/contracts";
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
import { usePortfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";

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

      <Notice tone="warn">
        <strong>Information, not advice.</strong> The split comes from fixed, published rules applied to the themes and risk
        level you chose. It is not a recommendation to buy anything. Prices can fall. Tokenized stocks are for eligible
        people outside the United States and carry no voting rights. On this test network every asset is a mock token.
      </Notice>
    </>
  );
}
