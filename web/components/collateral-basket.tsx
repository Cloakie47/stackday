"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useViewer } from "@/components/providers";
import {
  AssetIcon,
  Badge,
  BeforeAfter,
  Button,
  Card,
  Chip,
  DimCents,
  FieldLabel,
  FillAmount,
  HealthMeter,
  LabelTip,
  PillTabs,
  RiskNote,
  Row,
  SplitBar,
  Stat,
  TxStatus,
  cx,
  splitColor,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { HIGH_CAP_BPS, LEVELS, borrowCalls, createVaultCall, legOf, lockCalls, repayApprovalAmount, repayCalls, type Level } from "@/lib/actions";
import { apyPpm, splitBorrow, splitRepay, summarize, yearly } from "@/lib/basket";
import { MAX_UINT, ADDR, BORROW_FEE_BPS, feeLabel } from "@/lib/contracts";
import { assetForUsdc, assetValue, fmtAsset, fmtHealth, fmtUsdc, parseUsdc, usdcInput } from "@/lib/format";
import type { Portfolio, Position } from "@/lib/usePortfolio";
import { vaultBatch } from "@/lib/batch";
import { useTx, type Call } from "@/lib/useTx";

/**
 * Approximate yearly dividend of the real share each token tracks, in basis points (gross). Tokenized stocks
 * reinvest dividends into the token through an on-chain multiplier, so locked tokens keep earning them.
 * cbBTC and Ether pay none. What reaches holders is less: see NET_DIVIDEND_SHARE.
 * The testnet mock tokens pay no dividends at all; the UI says so.
 */
const DIVIDEND_BPS: Record<string, number> = {
  mAAPL: 40,
  mNVDA: 2,
  mGOOGL: 30,
  mMETA: 30,
  mSPCX: 0,
  mPAXG: 0,
  mMSFT: 70,
  mAMD: 0,
  mcbBTC: 0,
  mWETH: 0,
};

/**
 * Share of a gross dividend that reaches a holder of a Coinbase tokenized stock: the issuer keeps 5% as a
 * distribution fee and US withholding tax (up to 30%, lower under some tax treaties) is taken before the
 * rest is reinvested. 0.95 x 0.70 = 66.5%, the cautious case.
 */
const NET_DIVIDEND_PER_MILLE = 665;

export type Tab = "lock" | "borrow" | "repay";

/**
 * Borrow presets as a share of the liquidation limit (the loan size at which Morpho liquidates).
 * Borrowing that share leaves the loan safe until prices fall by the rest: 30% survives a 70% drop.
 *
 * Why these numbers (research, November 16, 2026): brokers lend up to 50% of a stock's value with
 * a call at 75% (about 67% of the call line), and less for a single stock; banks lend 30 to 50%
 * against one stock. Morpho's liquidation bonus is fixed per market, about 12.7% of the seized
 * collateral at a 62.5% limit, and tokenized stocks do not trade at weekends. So the top level stays
 * at 65%, below the broker line. The vault default cap is 50% (Mid); High raises it to 65% only when
 * the amount needs it. The contract allows up to 85% for someone who types their own setting.
 */
// LEVELS and HIGH_CAP_BPS live in lib/actions.ts, shared with the chat assistant.
const WAD = 10n ** 18n;
/** Price fall a loan survives, in whole percent, from its health (WAD). */
const dropOf = (health: bigint | undefined) => (health === undefined || health === 0n ? 100 : Math.max(0, 100 - Number((100n * WAD) / health)));

const toNum = (v: bigint | undefined) => (v === undefined ? undefined : Number(v / 10n ** 14n) / 10_000);

/** One market of the basket, as the basket maths sees it (lib/actions.ts). Re-exported so Portfolio shows the same numbers. */
export { legOf };

/** What a collateral row offers: its status, or a way to lock more. Says where the tokens come from. */
function UseAction({ x, free, onAdd }: { x: Position; free: bigint; onAdd: () => void }) {
  const from = x.idle === 0n ? "from wallet" : x.wallet === 0n ? "" : "from vault and wallet";
  if (x.collateral > 0n)
    return (
      <span className="inline-flex items-center gap-2">
        {free > 0n && (
          <button type="button" onClick={onAdd} className="hit text-xs font-semibold text-ink hover:text-brand-ink">
            Add more
          </button>
        )}
        <Badge>Collateral</Badge>
      </span>
    );
  if (x.transfersPaused) return <span className="text-xs text-warn">Transfers paused</span>;
  if (free > 0n)
    return (
      <button type="button" onClick={onAdd} className="min-h-11 whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold text-ink hover:bg-hover sm:min-h-9">
        {from ? `Add ${from}` : "Add"}
      </button>
    );
  return <span className="text-xs text-muted">None free</span>;
}

/** Free tokens the person can lock: idle in the vault, then the wallet. Nothing while transfers are paused. */
function freeOf(pos: Position) {
  return pos.transfersPaused ? 0n : pos.idle + pos.wallet;
}

export function CollateralBasket({
  p,
  head,
  initialTab = "borrow",
}: {
  p: Portfolio;
  /** Breadcrumb and title, shown above the figures. */
  head?: ReactNode;
  /** Which action the panel opens on, for links such as /borrow?tab=repay. */
  initialTab?: Tab;
}) {
  const viewer = useViewer();
  const tx = useTx();
  const me = viewer.address;
  const vault = p.vault;
  const cap = p.borrowCapBps;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [lockUsd, setLockUsd] = useState<Record<string, string>>({});
  const [borrowAmt, setBorrowAmt] = useState("");
  const [level, setLevel] = useState<Level | null>(null);
  const [repayAmt, setRepayAmt] = useState("");

  // Only assets with a lending market can be locked and borrowed against (issue #60).
  const positions = p.positions.filter((x) => x.asset.borrowable);
  const legs = positions.map((x) => legOf(x));
  const now = summarize(legs, cap);
  // True when market cash, not the borrow cap, is what stops a bigger loan.
  const cashLimited = now.locked > 0n && now.available < (now.limit > now.debt ? now.limit - now.debt : 0n);
  const earnings = yearly(positions.map((x, i) => ({ ...legs[i], dividendBps: ((DIVIDEND_BPS[x.asset.symbol] ?? 0) * NET_DIVIDEND_PER_MILLE) / 1000, ratePerSecond: x.ratePerSecond })), BORROW_FEE_BPS);
  const feesOwed = p.totalBorrowFees;
  const owedTotal = now.debt + feesOwed;

  // ---- lock: dollars per asset to token amounts, capped by what is free
  const lockPlan = positions.map((x) => {
    const usd = parseUsdc(lockUsd[x.asset.symbol] ?? "");
    const free = freeOf(x);
    let wanted = x.price ? assetForUsdc(usd, x.price, x.asset.decimals) : 0n;
    // Round up by the smallest unit so "$10" locks $10.00, not $9.99.
    if (x.price && usd > 0n && assetValue(wanted, x.price, x.asset.decimals) < usd) wanted += 1n;
    const amount = wanted > free ? free : wanted;
    const value = x.price ? assetValue(amount, x.price, x.asset.decimals) : 0n;
    return { pos: x, usd, amount, value, tooMuch: wanted > free + 1n };
  });
  const lockTotal = lockPlan.reduce((a, l) => a + l.value, 0n);
  const afterLock = summarize(positions.map((x, i) => legOf(x, lockPlan[i].value)), cap);

  // ---- borrow and repay: one amount, split across the markets
  const highCap = cap > HIGH_CAP_BPS ? cap : HIGH_CAP_BPS;
  const highRoom = summarize(legs, highCap).available;
  // Each level: its full size (max borrow, loan-to-value, the fall it survives) and what the market's
  // cash allows right now. Clicking fills in what can actually be borrowed.
  const levelInfo = LEVELS.map((l) => {
    const target = (now.maxDebt * l.pct) / 100n;
    const want = target > now.debt ? target - now.debt : 0n;
    const room = l.pct * 100n > cap ? highRoom : now.available;
    const amount = want < room ? want : room;
    const split = amount > 0n ? splitBorrow(amount, legs, highCap) : undefined;
    const after = split ? summarize(positions.map((x, i) => legOf(x, 0n, split[i])), highCap) : undefined;
    return {
      ...l,
      want,
      amount,
      ltv: now.locked > 0n ? Number((target * 1000n) / now.locked) / 10 : 0,
      reached: want <= 10_000n,
      cashShort: room + 10_000n < want,
      drop: dropOf(after?.weakest),
    };
  });
  function pickLevel(key: Level, amount: bigint) {
    setLevel(key);
    setBorrowAmt(usdcInput(amount));
  }
  const borrow = parseUsdc(borrowAmt);
  // The vault cap is raised to 65% only for High risk, and only when the amount needs it.
  const raiseCap = level === "high" && borrow > now.available && cap < HIGH_CAP_BPS;
  const borrowCap = raiseCap ? HIGH_CAP_BPS : cap;
  const upTo = level === "high" ? highRoom : now.available;
  const borrowSplit = splitBorrow(borrow, legs, borrowCap);
  const afterBorrow = borrowSplit ? summarize(positions.map((x, i) => legOf(x, 0n, borrowSplit[i])), borrowCap) : undefined;
  const repayAll = repayAmt.trim() === "" ? false : parseUsdc(repayAmt) >= owedTotal;
  const repay = parseUsdc(repayAmt);
  const repaySplit = splitRepay(repay, legs, cap);

  const parts = positions
    .map((x, i) => ({ key: x.asset.symbol, value: Number(legs[i].value), color: x.asset.color, label: x.asset.name }))
    .filter((x) => x.value > 0);

  function fillEach(dollars: string) {
    setLockUsd(Object.fromEntries(positions.filter((x) => freeOf(x) > 0n && x.price).map((x) => [x.asset.symbol, dollars])));
  }

  function fillMax() {
    setLockUsd(
      Object.fromEntries(
        positions
          .filter((x) => freeOf(x) > 0n && x.price)
          .map((x) => [x.asset.symbol, fmtUsdc(assetValue(freeOf(x), x.price!, x.asset.decimals)).replace(/,/g, "")]),
      ),
    );
  }

  async function doLock() {
    // The vault's address is known before it exists, so a first lock can create it in the same flow.
    const vault = p.vault ?? p.predictedVault;
    if (!vault || !me) return;
    const calls: Call[] = [];
    if (!p.vault) calls.push(createVaultCall(me));
    for (const l of lockPlan) {
      if (l.amount === 0n) continue;
      const a = l.pos.asset;
      const fromIdle = l.amount < l.pos.idle ? l.amount : l.pos.idle;
      const fromWallet = l.amount - fromIdle;
      const approval = fromWallet > 0n ? await tx.withApproval(a.token, vault, fromWallet, `Allow your vault to take your ${a.name}`) : [];
      // Deposits never lock themselves (issue #29), so lock everything chosen here.
      calls.push(...lockCalls(vault, a, fromIdle, fromWallet, approval));
    }
    const lockLabel = `Lock $${fmtUsdc(lockTotal)} as collateral`;
    if (await tx.run(vaultBatch(vault, calls, lockLabel), `Locked $${fmtUsdc(lockTotal)} as collateral.`)) setLockUsd({});
  }

  async function doBorrow() {
    if (!vault || !me || !borrowSplit) return;
    const calls: Call[] = borrowCalls(vault, positions.map((x, i) => ({ asset: x.asset, usdc: borrowSplit[i] })), me, raiseCap);
    if (await tx.run(vaultBatch(vault, calls, "Borrow across your locked assets"), "Borrowed. The USDC is in your wallet.")) {
      setBorrowAmt("");
      setLevel(null);
    }
  }

  async function doRepay(all: boolean) {
    if (!vault) return;
    // Repaying all covers each loan plus its Stackday fee (paid first), with room for interest that
    // builds up until the transaction lands.
    const amounts = all ? positions.map((x) => x.debt + x.fee) : repaySplit;
    const total = amounts.reduce((a, b) => a + b, 0n);
    const approve = repayApprovalAmount(total, all);
    const calls: Call[] = [
      ...(await tx.withApproval(ADDR.usdc, vault, approve, "Allow your vault to take the USDC")),
      ...repayCalls(vault, positions.map((x, i) => ({ asset: x.asset, usdc: amounts[i] })), all),
    ];
    if (await tx.run(vaultBatch(vault, calls, all ? "Repay every loan" : "Repay your loans"), all ? "Loan fully repaid." : "Repayment made.")) setRepayAmt("");
  }

  const busy = tx.state.busy;
  const can = viewer.canAct && !!vault;
  const weakestPos = positions.find((x) => x.debt > 0n && x.health !== undefined && x.health === positions.filter((y) => y.debt > 0n).reduce((m, y) => (y.health! < m ? y.health! : m), MAX_UINT));

  // ---- display only: rates and the before and after summary
  const fee = Number(BORROW_FEE_BPS) / 100;
  const weighted = (items: { rate?: bigint; w: bigint }[]) => {
    const sum = items.reduce((a, x) => a + x.w, 0n);
    return sum > 0n ? items.reduce((a, x) => a + apyPpm(x.rate) * Number(x.w), 0) / Number(sum) / 10_000 : undefined;
  };
  const rateNow =
    weighted(positions.map((x) => ({ rate: x.ratePerSecond, w: x.debt }))) ??
    weighted(positions.map((x, i) => ({ rate: x.ratePerSecond, w: legs[i].value }))) ??
    (positions.length ? positions.reduce((a, x) => a + apyPpm(x.ratePerSecond), 0) / positions.length / 10_000 : 0);
  const borrowMorpho = borrowSplit ? weighted(positions.map((x, i) => ({ rate: x.ratePerSecond, w: borrowSplit[i] }))) : undefined;
  const rateAfter = (borrowMorpho ?? rateNow) + fee;
  const healthTone = (h: bigint | undefined) => {
    const n = toNum(h);
    return n === undefined ? undefined : n < 1 ? ("danger" as const) : n < 1.25 ? ("warn" as const) : ("grow" as const);
  };
  const locked = positions.filter((x, i) => legs[i].value > 0n).sort((a, b) => (b.collateral > a.collateral ? 1 : -1));
  const rows = [...positions].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  const repayLeft = repay >= owedTotal ? 0n : owedTotal - repay;
  const stocksLocked = positions.some((x) => x.collateral > 0n && x.asset.kind !== "crypto");

  const panelRef = useRef<HTMLDivElement>(null);
  // While a field has focus (the phone keyboard is open), the sticky action bar steps aside.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && t.matches("input, select, textarea");
    const onIn = (e: FocusEvent) => setTyping(isField(e.target));
    const onOut = (e: FocusEvent) => setTyping(isField(e.relatedTarget));
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  function openPanel(next: Tab, focusId?: string) {
    setTab(next);
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1023px)").matches) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    });
  }

  const tabs = (
    <PillTabs
      ariaLabel="Action"
      value={tab}
      onChange={setTab}
      options={[
        { value: "borrow", label: "Borrow" },
        { value: "repay", label: "Repay" },
        { value: "lock", label: "Add collateral" },
      ]}
    />
  );

  return (
    <div className="grid gap-x-8 gap-y-7 lg:grid-cols-[minmax(0,1fr)_384px] lg:grid-rows-[auto_1fr] lg:items-start">
      {/* Market header and figures */}
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        {head}
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:mt-7 sm:grid-cols-4">
          <Stat big label="Your loan" value={<DimCents text={`$${fmtUsdc(now.debt)}`} />} hint={`${fmtUsdc(owedTotal)} USDC owed`} />
          <Stat
            big
            label="Available to borrow"
            tone="brand"
            tip={cashLimited ? `The lending markets have only $${fmtUsdc(highRoom)} to lend right now.` : "The most you can borrow now, within your borrow limit."}
            value={<DimCents text={`$${fmtUsdc(now.available)}`} />}
            hint={cashLimited ? <span className="text-warn">Limited by market cash</span> : `of $${fmtUsdc(now.limit > now.debt ? now.limit - now.debt : 0n)} max`}
          />
          <Stat
            big
            label="Borrow rate"
            tip={`${rateNow.toFixed(2)}% Morpho interest, compounding, paid to lenders${fee > 0 ? `, plus a ${feeLabel(BORROW_FEE_BPS)} yearly ${BRAND.name} fee paid when you repay` : ""}. It moves with how much of the market is lent out.`}
            value={`${(rateNow + fee).toFixed(2)}%`}
            hint="a year, variable"
          />
          <Stat
            big
            label="Health"
            tone={healthTone(now.health)}
            tip="Health of all your loans together. Each asset is its own market and can be liquidated on its own if its price falls far."
            value={now.health !== undefined ? fmtHealth(now.health) : <span className="text-muted">–</span>}
            hint={
              now.health === undefined ? (
                "No loan"
              ) : weakestPos && locked.length > 1 ? (
                <LabelTip
                  label={`Weakest: ${weakestPos.asset.name} ${fmtHealth(now.weakest)}`}
                  tip="Each asset can be liquidated on its own, so watch the weakest one."
                />
              ) : (
                "Liquidation at 1.00"
              )
            }
          />
        </div>
      </div>

      {/* Action panel */}
      <aside ref={panelRef} aria-label="Borrow and repay" className="min-w-0 scroll-mt-28 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-20">
        <div className="mb-3">{tabs}</div>

        {tab === "borrow" && (
          <div className="space-y-2">
            <div className="rounded-2xl border border-line bg-popover px-4 py-3.5">
              <div className="flex items-center justify-between text-[13px] text-muted">
                <LabelTip
                  label="Collateral"
                  tip="Lock any mix of assets as collateral, then borrow against the total. New buys stay free until you lock them. Locking more makes a loan safer."
                />
                <span>Locked in your vault</span>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {locked.length === 0 ? (
                  <span className="text-[13px] text-muted">Nothing locked yet.</span>
                ) : (
                  locked.slice(0, 3).map((x) => (
                    <span key={x.asset.symbol} className="inline-flex h-[30px] items-center gap-[7px] rounded-full bg-hover pl-1 pr-2.5 text-[12.5px] font-medium">
                      <AssetIcon asset={x.asset} size={20} />
                      {x.asset.name}
                    </span>
                  ))
                )}
                {locked.length > 3 && <span className="text-xs text-muted">+{locked.length - 3}</span>}
                <span className="ml-auto text-[13px] font-medium tabular-nums">${fmtUsdc(now.locked)}</span>
              </div>
            </div>

            {now.locked > 0n && (
              <div role="group" aria-label="Risk level" className="grid grid-cols-3 gap-1.5">
                {levelInfo.map((l) => {
                  const active = level === l.key;
                  return (
                    <button
                      key={l.key}
                      type="button"
                      aria-pressed={active}
                      disabled={l.reached || l.amount === 0n}
                      onClick={() => pickLevel(l.key, l.amount)}
                      className={cx(
                        "min-h-11 rounded-xl border px-2.5 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                        active ? "border-[color-mix(in_srgb,var(--brand)_55%,transparent)] bg-brand-soft" : "border-line bg-popover hover:bg-hover",
                      )}
                    >
                      <div className={cx("text-xs font-semibold", l.tone)}>{l.label}</div>
                      {l.reached ? (
                        <div className="mt-0.5 text-[11px] text-muted">Already past this level</div>
                      ) : (
                        <>
                          <div className="mt-0.5 text-[13px] font-medium tabular-nums text-ink">${fmtUsdc(l.cashShort ? l.amount : l.want)}</div>
                          <div className="text-[11px] text-muted">
                            {l.cashShort ? "Market cash" : `Liquidation after a ${100 - Number(l.pct)}% drop`}
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {now.locked > 0n && levelInfo.some((l) => l.cashShort && !l.reached) && (
              <p className="px-1 text-xs text-warn">Markets can lend only ${fmtUsdc(highRoom)} right now.</p>
            )}

            <div
              className={cx(
                "block rounded-2xl border border-line bg-popover px-4 py-3.5 transition-[border-color,box-shadow] duration-150",
                "focus-within:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_10%,transparent)]",
              )}
            >
              <span className="flex items-center justify-between text-[13px] text-muted">
                <FieldLabel htmlFor="borrow-amount" label="Borrow USDC" tip="Borrows only against assets you locked. You receive the full amount." className="text-muted" />
                <AssetIcon icon="USDC" size={20} />
              </span>
              <input
                id="borrow-amount"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                value={borrowAmt}
                disabled={now.locked === 0n}
                onChange={(e) => {
                  setBorrowAmt(e.target.value);
                  setLevel(null);
                }}
                className="mt-2 w-full bg-transparent font-display text-[32px] leading-[1.15] tracking-[-0.02em] text-ink tabular-nums outline-none placeholder:text-faint disabled:cursor-not-allowed"
              />
              <span className="mt-1.5 flex items-center justify-between text-xs text-muted">
                <span className="tabular-nums">${fmtUsdc(borrow)}</span>
                <span className="inline-flex items-center gap-2">
                  <span className="tabular-nums">
                    {fmtUsdc(upTo)} USDC available{level === "high" && upTo > now.available ? " at High risk" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBorrowAmt(usdcInput(upTo))}
                    disabled={now.locked === 0n}
                    aria-label="Use the maximum"
                    className="hit rounded-[6px] bg-press px-[7px] py-[3px] text-[11px] font-semibold tracking-[0.02em] text-ink hover:bg-line disabled:opacity-50"
                  >
                    MAX
                  </button>
                </span>
              </span>
            </div>

            <div className="rounded-2xl border border-line bg-popover px-4 py-1.5">
              <Row label="Loan">
                <BeforeAfter from={fmtUsdc(now.debt)} to={afterBorrow && borrow > 0n ? `${fmtUsdc(afterBorrow.debt)} USDC` : undefined} />
                {!(afterBorrow && borrow > 0n) && " USDC"}
              </Row>
              <Row
                label={
                  <LabelTip
                    label="Health"
                    tip={
                      afterBorrow && borrow > 0n
                        ? `Weakest asset after this borrow: ${fmtHealth(afterBorrow.weakest)}. Liquidation after about a ${dropOf(afterBorrow.weakest)}% price drop.${stocksLocked ? " Stocks and gold don't trade at weekends, so prices can jump on Monday. A liquidation costs about 12.7% of the collateral taken." : ""}`
                        : "At 1.00, part of your collateral can be sold to repay the loan."
                    }
                  />
                }
              >
                <span className="inline-flex items-center gap-2">
                  {afterBorrow && borrow > 0n && (
                    <span className="hidden w-14 sm:block">
                      <HealthMeter compact health={toNum(afterBorrow.health)} />
                    </span>
                  )}
                  <BeforeAfter
                    from={now.health !== undefined ? fmtHealth(now.health) : "–"}
                    to={afterBorrow && borrow > 0n ? fmtHealth(afterBorrow.health) : undefined}
                    tone={afterBorrow ? healthTone(afterBorrow.health) : undefined}
                  />
                </span>
              </Row>
              <Row label="Available to borrow">
                <BeforeAfter from={`$${fmtUsdc(now.available)}`} to={afterBorrow && borrow > 0n ? `$${fmtUsdc(afterBorrow.available)}` : undefined} />
              </Row>
              <Row
                label="Borrow rate"
                tip={`${(borrowMorpho ?? rateNow).toFixed(2)}% Morpho interest, compounding, paid to lenders${fee > 0 ? `, plus a ${feeLabel(BORROW_FEE_BPS)} yearly ${BRAND.name} fee` : ""}. It moves with how much of the market is lent out.`}
              >
                {rateAfter.toFixed(2)}% variable
              </Row>
              {fee > 0 && <Row label={`${BRAND.name} fee`}>{feeLabel(BORROW_FEE_BPS)} a year, paid when you repay</Row>}
              {borrow > 0n && borrowSplit && (
                <Row label="Split" tip="Your borrow is split across your locked assets so each part has the same health.">
                  <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
                    {positions.map((x, i) =>
                      borrowSplit[i] > 0n ? (
                        <span key={x.asset.symbol} className="inline-flex items-center gap-1.5">
                          <AssetIcon asset={x.asset} size={16} />${fmtUsdc(borrowSplit[i])}
                        </span>
                      ) : null,
                    )}
                  </span>
                </Row>
              )}
              {borrow > 0n && borrowSplit && <Row label="You receive">${fmtUsdc(borrow)}</Row>}
            </div>

            {level === "high" && stocksLocked && (
              <p className="px-1 text-xs text-danger">
                Stocks and gold don&apos;t trade at weekends, so prices can jump on Monday. A liquidation costs about 12.7% of the collateral taken.
              </p>
            )}
            {raiseCap && <p className="px-1 text-xs text-danger">Also raises your borrow limit from {Number(cap) / 100}% to 65% of the maximum.</p>}
            {level === "high" && !p.emergencyRule && (p.schedulesPayingMe.length > 0 || p.claims.length > 0) && (
              <p className="px-1 text-xs text-muted">
                <LabelTip label="Consider the emergency rule" tip="Sends part of a payday to this collateral when the loan gets close to liquidation." />
              </p>
            )}
            {borrow > 0n && !borrowSplit && <p className="px-1 text-xs text-danger">More than you can borrow. Lock more first.</p>}

            {now.locked === 0n ? (
              <Button size="lg" className="w-full" variant="secondary" onClick={() => openPanel("lock")}>
                Lock collateral first
              </Button>
            ) : (
              <Button size="lg" className="w-full" disabled={!can || !me || borrow === 0n || !borrowSplit || busy} onClick={doBorrow}>
                {borrow > 0n ? `Borrow ${fmtUsdc(borrow)} USDC` : "Borrow USDC"}
              </Button>
            )}
          </div>
        )}

        {tab === "repay" && (
          <div className="space-y-2">
            <div
              className={cx(
                "block rounded-2xl border border-line bg-popover px-4 py-3.5 transition-[border-color,box-shadow] duration-150",
                "focus-within:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_10%,transparent)]",
              )}
            >
              <span className="flex items-center justify-between text-[13px] text-muted">
                <FieldLabel htmlFor="repay-amount" label="Repay USDC" tip="Repay any amount at any time. No penalty." className="text-muted" />
                <AssetIcon icon="USDC" size={20} />
              </span>
              <input
                id="repay-amount"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                value={repayAmt}
                onChange={(e) => setRepayAmt(e.target.value)}
                className="mt-2 w-full bg-transparent font-display text-[32px] leading-[1.15] tracking-[-0.02em] text-ink tabular-nums outline-none placeholder:text-faint"
              />
              <span className="mt-1.5 flex items-center justify-between text-xs text-muted">
                <span className="tabular-nums">${fmtUsdc(repay)}</span>
                <span className="inline-flex items-center gap-2">
                  <span className="tabular-nums">{fmtUsdc(owedTotal)} USDC owed</span>
                  <button
                    type="button"
                    onClick={() => setRepayAmt(usdcInput(owedTotal))}
                    disabled={now.debt === 0n}
                    aria-label="Use the maximum"
                    className="hit rounded-[6px] bg-press px-[7px] py-[3px] text-[11px] font-semibold tracking-[0.02em] text-ink hover:bg-line disabled:opacity-50"
                  >
                    MAX
                  </button>
                </span>
              </span>
            </div>

            <div className="rounded-2xl border border-line bg-popover px-4 py-1.5">
              <Row label="Owed">
                <BeforeAfter from={fmtUsdc(owedTotal)} to={repay > 0n ? `${fmtUsdc(repayLeft)} USDC` : undefined} />
                {repay === 0n && " USDC"}
              </Row>
              <Row label="Health">{now.health !== undefined ? fmtHealth(now.health) : "No loan"}</Row>
              {feesOwed >= 100n && (
                <Row label={`${BRAND.name} fee`} tip="Paid first, before the loan.">
                  ${fmtUsdc(feesOwed, 4)}
                </Row>
              )}
              {repay > 0n && !repayAll && (
                <Row label="Split" tip="Pays down the parts closest to their limit first.">
                  <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
                    {positions.map((x, i) =>
                      repaySplit[i] > 0n ? (
                        <span key={x.asset.symbol} className="inline-flex items-center gap-1.5">
                          <AssetIcon asset={x.asset} size={16} />${fmtUsdc(repaySplit[i])}
                        </span>
                      ) : null,
                    )}
                  </span>
                </Row>
              )}
            </div>

            <div className="grid grid-cols-[1fr_1.4fr] gap-2">
              <Button size="lg" variant="secondary" disabled={!can || now.debt === 0n || busy} onClick={() => doRepay(true)}>
                Repay all
              </Button>
              <Button size="lg" disabled={!can || repay === 0n || now.debt === 0n || busy} onClick={() => doRepay(repayAll)}>
                {repay > 0n ? `Repay ${fmtUsdc(repay)} USDC` : "Repay"}
              </Button>
            </div>
          </div>
        )}

        {tab === "lock" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted">Quick fill</span>
              <Chip onClick={() => fillEach("1")}>$1 each</Chip>
              <Chip onClick={() => fillEach("10")}>$10 each</Chip>
              <Chip onClick={fillMax}>Everything free</Chip>
            </div>
            <div className="divide-y divide-line-soft rounded-2xl border border-line bg-popover">
              {lockPlan.map((l) => {
                const a = l.pos.asset;
                const free = freeOf(l.pos);
                const freeValue = l.pos.price ? assetValue(free, l.pos.price, a.decimals) : 0n;
                return (
                  <div key={a.symbol} className="flex items-center gap-3 px-3.5 py-2.5">
                    <AssetIcon asset={a} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{a.name}</div>
                      <div className="truncate text-[11.5px] text-muted">
                        {l.pos.transfersPaused ? (
                          <span className="text-warn">Transfers paused. Can&apos;t lock now.</span>
                        ) : free === 0n ? (
                          "None free. Buy some on Invest."
                        ) : (
                          <>
                            Free{" "}
                            <FillAmount onFill={() => setLockUsd((s) => ({ ...s, [a.symbol]: usdcInput(freeValue) }))} label={`Lock all free ${a.name}`}>
                              ${fmtUsdc(freeValue)}
                            </FillAmount>{" "}
                            · {l.pos.idle === 0n ? "wallet" : l.pos.wallet === 0n ? "vault" : "vault and wallet"}
                            {l.tooMuch ? " · capped" : ""}
                          </>
                        )}
                      </div>
                    </div>
                    <span className="flex w-28 shrink-0 items-center rounded-[10px] border border-line bg-surface focus-within:border-[color-mix(in_srgb,var(--brand)_55%,transparent)]">
                      <span className="pl-2.5 text-[13px] text-muted">$</span>
                      <input
                        id={`lock-${a.symbol}`}
                        aria-label={`Dollars of ${a.name} to lock`}
                        inputMode="decimal"
                        placeholder="0.00"
                        disabled={free === 0n || !l.pos.price}
                        value={lockUsd[a.symbol] ?? ""}
                        onChange={(e) => setLockUsd((s) => ({ ...s, [a.symbol]: e.target.value }))}
                        className="min-h-10 w-full min-w-0 bg-transparent px-1.5 text-right text-base tabular-nums sm:text-sm text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed"
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="rounded-2xl border border-line bg-popover px-4 py-1.5">
              <Row label="Lock">${fmtUsdc(lockTotal)}</Row>
              <Row label="Locked">
                <BeforeAfter from={`$${fmtUsdc(now.locked)}`} to={lockTotal > 0n ? `$${fmtUsdc(afterLock.locked)}` : undefined} />
              </Row>
              <Row label="Available to borrow">
                <BeforeAfter from={`$${fmtUsdc(now.available)}`} to={lockTotal > 0n ? `$${fmtUsdc(afterLock.available)}` : undefined} />
              </Row>
            </div>
            {!vault && <p className="px-1 text-xs text-muted">Your vault is created in the same step.</p>}
            <Button size="lg" className="w-full" disabled={!viewer.canAct || !(vault ?? p.predictedVault) || lockTotal === 0n || busy} onClick={doLock}>
              Lock ${fmtUsdc(lockTotal)} as collateral
            </Button>
          </div>
        )}

        <TxStatus state={tx.state} />
        <div className="mt-3">
          <RiskNote compact />
        </div>
      </aside>

      {/* Collateral table and yearly estimate */}
      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
        <Card flush>
          <div className="flex min-h-[52px] flex-wrap items-center gap-x-5 gap-y-1 border-b border-line-soft px-4 py-2 sm:px-5">
            <div className="flex items-center gap-4 text-[13px]">
              <h2 className="font-medium text-ink">Collateral</h2>
              <Link href="/risk" className="text-muted hover:text-ink">
                Risk
              </Link>
            </div>
            <span className="ml-auto text-xs text-muted">Only assets marked Collateral back this loan</span>
          </div>
          <div className="hidden sm:block">
            <table className="dtable table-fixed">
              <colgroup>
                <col className="w-[32%]" />
                <col className="w-[22%]" />
                <col className="w-[18%]" />
                <col className="w-[28%]" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col" className="r">
                    In vault
                  </th>
                  <th scope="col" className="r">
                    Value
                  </th>
                  <th scope="col" className="r">
                    Use for this loan
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.asset.symbol}>
                    <td>
                      <div className="flex items-center gap-3">
                        <AssetIcon asset={x.asset} size={32} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{x.asset.name}</div>
                          <div className="truncate text-[11.5px] text-muted">
                            {x.wallet > 0n ? `${fmtAsset(x.wallet, x.asset.decimals, 4)} in wallet` : x.asset.symbol}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="r">
                      {fmtAsset(x.idle + x.collateral, x.asset.decimals, 4)} <span className="text-muted">{x.asset.symbol}</span>
                    </td>
                    <td className="r">${fmtUsdc(x.value)}</td>
                    <td className="r">
                      <UseAction x={x} free={freeOf(x)} onAdd={() => openPanel("lock", `lock-${x.asset.symbol}`)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line-soft sm:hidden">
            {rows.map((x) => (
              <li key={x.asset.symbol} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                <AssetIcon asset={x.asset} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{x.asset.name}</div>
                  <div className="truncate text-xs text-muted tabular-nums">
                    {fmtAsset(x.idle + x.collateral, x.asset.decimals, 4)} in vault · ${fmtUsdc(x.value)}
                    {x.wallet > 0n ? ` · ${fmtAsset(x.wallet, x.asset.decimals, 4)} in wallet` : ""}
                  </div>
                </div>
                <UseAction x={x} free={freeOf(x)} onAdd={() => openPanel("lock", `lock-${x.asset.symbol}`)} />
              </li>
            ))}
          </ul>
          {parts.length > 0 && (
            <div className="flex items-center gap-4 border-t border-line-soft bg-hover px-4 py-3 sm:px-5">
              <span className="shrink-0 text-xs text-muted">Locked ${fmtUsdc(now.locked)}</span>
              <div className="flex-1">
                <SplitBar parts={parts.map((x, i) => ({ ...x, color: splitColor(i) }))} height={6} />
              </div>
            </div>
          )}
        </Card>

        <Card title="Per year, at today's prices" badge={<Badge>Est.</Badge>}>
          <div className="grid grid-cols-3 gap-4">
            <Stat
              label="Dividends"
              tip="After the issuer's 5% fee and up to 30% US withholding tax, reinvested into the token."
              value={`+$${fmtUsdc(earnings.earn)}`}
            />
            <Stat label="Loan cost" tip={`Morpho interest plus the ${BRAND.name} fee.`} value={`−$${fmtUsdc(earnings.cost)}`} />
            <Stat
              label="Net"
              tip="At today's prices, before any price moves."
              value={`${earnings.net < 0n ? "−" : "+"}$${fmtUsdc(earnings.net < 0n ? -earnings.net : earnings.net)}`}
            />
          </div>
          <p className="mt-3 text-xs text-muted">Estimate. Test tokens pay no dividends.</p>
        </Card>
      </div>

      {/* Phone: sticky actions above the home indicator */}
      <div data-action-bar hidden={typing} className="glass fixed inset-x-0 bottom-0 z-20 grid grid-cols-[1fr_1.4fr] [&[hidden]]:hidden gap-2 border-t border-line px-4 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-3 lg:hidden">
        <Button size="lg" variant="secondary" onClick={() => openPanel("repay", "repay-amount")}>
          Repay
        </Button>
        <Button size="lg" onClick={() => openPanel(now.locked === 0n ? "lock" : "borrow", now.locked === 0n ? undefined : "borrow-amount")}>
          Borrow USDC
        </Button>
      </div>
    </div>
  );
}
