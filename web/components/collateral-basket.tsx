"use client";

import { useState } from "react";
import { useViewer } from "@/components/providers";
import { AssetIcon, Button, Card, Field, FillAmount, HealthMeter, Segmented, SplitBar, Stat, TxStatus } from "@/components/ui";
import { factoryAbi, vaultAbi } from "@/lib/abis";
import { apyPpm, splitBorrow, splitRepay, summarize, yearly, type Leg } from "@/lib/basket";
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
  mcbBTC: 0,
  mWETH: 0,
};

/**
 * Share of a gross dividend that reaches a holder of a Coinbase tokenized stock: the issuer keeps 5% as a
 * distribution fee and US withholding tax (up to 30%, lower under some tax treaties) is taken before the
 * rest is reinvested. 0.95 x 0.70 = 66.5%, the cautious case.
 */
const NET_DIVIDEND_PER_MILLE = 665;

type Tab = "lock" | "borrow" | "repay";

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
const LEVELS = [
  { key: "low", label: "Low risk", pct: 30n, tone: "text-grow" },
  { key: "mid", label: "Mid risk", pct: 50n, tone: "text-warn" },
  { key: "high", label: "High risk", pct: 65n, tone: "text-danger" },
] as const;
type Level = (typeof LEVELS)[number]["key"];
const HIGH_CAP_BPS = 6500n;
const WAD = 10n ** 18n;
/** Price fall a loan survives, in whole percent, from its health (WAD). */
const dropOf = (health: bigint | undefined) => (health === undefined || health === 0n ? 100 : Math.max(0, 100 - Number((100n * WAD) / health)));

const toNum = (v: bigint | undefined) => (v === undefined ? undefined : Number(v / 10n ** 14n) / 10_000);

function legOf(pos: Position, extraValue = 0n, extraDebt = 0n): Leg {
  const value = pos.price ? assetValue(pos.collateral, pos.price, pos.asset.decimals) : 0n;
  return { value: value + extraValue, lltv: pos.asset.lltv, debt: pos.debt + extraDebt, liquidity: pos.liquidity };
}

/** Free tokens the person can lock: idle in the vault, then the wallet. Nothing while transfers are paused. */
function freeOf(pos: Position) {
  return pos.transfersPaused ? 0n : pos.idle + pos.wallet;
}

export function CollateralBasket({ p }: { p: Portfolio }) {
  const viewer = useViewer();
  const tx = useTx();
  const me = viewer.address;
  const vault = p.vault;
  const cap = p.borrowCapBps;
  const [tab, setTab] = useState<Tab>("lock");
  const [lockUsd, setLockUsd] = useState<Record<string, string>>({});
  const [borrowAmt, setBorrowAmt] = useState("");
  const [level, setLevel] = useState<Level | null>(null);
  const [repayAmt, setRepayAmt] = useState("");

  const positions = p.positions;
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
    if (!p.vault) calls.push({ label: "Create your vault", address: ADDR.factory, abi: factoryAbi, functionName: "createVault", args: [me] });
    for (const l of lockPlan) {
      if (l.amount === 0n) continue;
      const a = l.pos.asset;
      const fromIdle = l.amount < l.pos.idle ? l.amount : l.pos.idle;
      const fromWallet = l.amount - fromIdle;
      if (fromWallet > 0n) {
        calls.push(...(await tx.withApproval(a.token, vault, fromWallet, `Allow your vault to take your ${a.name}`)));
        calls.push({ label: `Move ${a.name} from your wallet into your vault`, address: vault, abi: vaultAbi, functionName: "depositStock", args: [a.token, fromWallet] });
      }
      // Deposits never lock themselves (issue #29), so lock everything chosen here.
      const toLock = fromIdle + fromWallet;
      if (toLock > 0n) calls.push({ label: `Lock ${a.name} as collateral`, address: vault, abi: vaultAbi, functionName: "addCollateral", args: [a.token, toLock] });
    }
    const lockLabel = `Lock $${fmtUsdc(lockTotal)} as collateral`;
    if (await tx.run(vaultBatch(vault, calls, lockLabel), `Locked $${fmtUsdc(lockTotal)} as collateral.`)) setLockUsd({});
  }

  async function doBorrow() {
    if (!vault || !me || !borrowSplit) return;
    const calls: Call[] = positions
      .map((x, i) => ({ x, amt: borrowSplit[i] }))
      .filter(({ amt }) => amt > 0n)
      .map(({ x, amt }) => ({ label: `Borrow $${fmtUsdc(amt)} against your ${x.asset.name}`, address: vault, abi: vaultAbi, functionName: "borrow", args: [x.asset.token, 0n, amt, me] }));
    // Owner-only setting of the person's own vault, within the contract's 85% maximum.
    if (raiseCap) calls.unshift({ label: "Raise your vault's safety cap to 65%", address: vault, abi: vaultAbi, functionName: "setBorrowCapBps", args: [Number(HIGH_CAP_BPS)] });
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
    const approve = all ? total + total / 100n + 1000n : total;
    const calls: Call[] = [
      ...(await tx.withApproval(ADDR.usdc, vault, approve, "Allow your vault to take the USDC")),
      ...positions
        .map((x, i) => ({ x, amt: amounts[i] }))
        .filter(({ amt }) => amt > 0n)
        .map(({ x, amt }) => ({ label: `Repay the ${x.asset.name} part`, address: vault, abi: vaultAbi, functionName: "repay", args: [x.asset.token, all ? MAX_UINT : amt] })),
    ];
    if (await tx.run(vaultBatch(vault, calls, all ? "Repay every loan" : "Repay your loans"), all ? "Loan fully repaid." : "Repayment made.")) setRepayAmt("");
  }

  const busy = tx.state.busy;
  const can = viewer.canAct && !!vault;
  const weakestPos = positions.find((x) => x.debt > 0n && x.health !== undefined && x.health === positions.filter((y) => y.debt > 0n).reduce((m, y) => (y.health! < m ? y.health! : m), MAX_UINT));

  return (
    <Card title="Collateral basket">
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        Lock any mix of your assets as one pot of collateral, then borrow against the total. New buys stay free in your vault until you lock them here. Locking more, for example each payday's buy, makes a loan safer.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Stat label="Locked" value={`$${fmtUsdc(now.locked)}`} hint="Collateral value now" />
        <Stat
          label="You can borrow"
          value={`$${fmtUsdc(now.available)}`}
          hint={cashLimited ? "Limited by the USDC the markets have to lend" : "Under your borrow limit"}
        />
        <Stat label="Loan" value={`$${fmtUsdc(now.debt)}`} />
        <Stat label="Health" value={now.health !== undefined ? fmtHealth(now.health) : "No loan"} hint="Whole basket. Below 1.00 can be liquidated" />
      </div>
      {parts.length > 0 && (
        <div className="mt-5">
          <SplitBar parts={parts} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {positions.map((x, i) =>
              legs[i].value > 0n ? (
                <span key={x.asset.symbol} className="inline-flex items-center gap-1.5">
                  <AssetIcon asset={x.asset} size={14} /> {x.asset.name} ${fmtUsdc(legs[i].value)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}
      {now.debt > 0n && (
        <div className="mt-5">
          <HealthMeter health={toNum(now.weakest)} />
          <p className="mt-2 text-xs text-muted">
            The bar shows the weakest part{weakestPos ? ` (${weakestPos.asset.name}, health ${fmtHealth(now.weakest)})` : ""}: each asset sits in its own
            market and can be liquidated on its own if its price falls far.
          </p>
        </div>
      )}

      <div className="mt-6 max-w-md">
        <Segmented
          value={tab}
          onChange={setTab}
          label="What do you want to do?"
          options={[
            { value: "lock", label: "Lock" },
            { value: "borrow", label: "Borrow" },
            { value: "repay", label: "Repay" },
          ]}
        />
      </div>

      {tab === "lock" && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink-soft">Quick fill:</span>
            <Button size="sm" variant="secondary" onClick={() => fillEach("1")}>$1 of each</Button>
            <Button size="sm" variant="secondary" onClick={() => fillEach("10")}>$10 of each</Button>
            <Button size="sm" variant="ghost" onClick={fillMax}>Everything free</Button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {lockPlan.map((l) => {
              const a = l.pos.asset;
              const free = freeOf(l.pos);
              const freeValue = l.pos.price ? assetValue(free, l.pos.price, a.decimals) : 0n;
              return (
                <div key={a.symbol} className="flex items-start gap-3">
                  <span className="mt-7"><AssetIcon asset={a} size={28} /></span>
                  <div className="min-w-0 flex-1">
                    <Field
                      label={a.name}
                      inputMode="decimal"
                      placeholder="0.00"
                      suffix="USD"
                      disabled={free === 0n || !l.pos.price}
                      value={lockUsd[a.symbol] ?? ""}
                      onChange={(e) => setLockUsd((s) => ({ ...s, [a.symbol]: e.target.value }))}
                      hint={
                        l.pos.transfersPaused
                          ? "Transfers are paused, so it cannot be locked right now."
                          : free === 0n
                            ? "None free. Buy some on Invest."
                            : (
                              <>
                                Free:{" "}
                                <FillAmount onFill={() => setLockUsd((s) => ({ ...s, [a.symbol]: usdcInput(freeValue) }))} label={`Lock all free ${a.name}`}>
                                  ${fmtUsdc(freeValue)}
                                </FillAmount>{" "}
                                ({fmtAsset(free, a.decimals)} {a.symbol}, {l.pos.idle === 0n ? "in your wallet" : l.pos.wallet === 0n ? "in your vault" : "in your vault and wallet"})
                                {l.tooMuch ? ". Capped at what you have." : ""}
                              </>
                            )
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 rounded-2xl bg-sunken p-4 text-sm">
            Lock <strong>${fmtUsdc(lockTotal)}</strong>. Afterwards: <strong>${fmtUsdc(afterLock.locked)}</strong> locked, you can borrow up to{" "}
            <strong>${fmtUsdc(afterLock.available)}</strong>.
          </div>
          <Button className="mt-3 w-full sm:w-auto" disabled={!viewer.canAct || !(vault ?? p.predictedVault) || lockTotal === 0n || busy} onClick={doLock}>
            Lock ${fmtUsdc(lockTotal)} as collateral
          </Button>
          {!vault && <p className="mt-2 text-xs text-muted">Your vault is created in the same step.</p>}
        </div>
      )}

      {tab === "borrow" && (
        <div className="mt-5 max-w-xl">
          {now.locked > 0n && (
            <div className="mb-4">
              <div className="mb-2 text-[13px] font-medium text-muted">Pick a risk level, or type your own amount</div>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Risk level">
                {levelInfo.map((l) => {
                  const active = level === l.key;
                  return (
                    <button
                      key={l.key}
                      type="button"
                      aria-pressed={active}
                      disabled={l.reached || l.amount === 0n}
                      onClick={() => pickLevel(l.key, l.amount)}
                      className={`rounded-2xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        active ? "border-brand bg-brand/5" : "border-line hover:border-line-strong"
                      }`}
                    >
                      <div className={`text-sm font-semibold ${l.tone}`}>{l.label}</div>
                      {l.reached ? (
                        <div className="mt-1 text-xs text-muted">Already past this level</div>
                      ) : (
                        <>
                          <div className="mt-1 text-base font-semibold tabular-nums text-ink">${fmtUsdc(l.want)}</div>
                          <div className="text-[11px] text-muted">max borrow</div>
                          <div className="mt-2 text-xs text-muted">
                            Risk: {l.ltv.toFixed(0)}% of value ({Number(l.pct)}% of limit)
                          </div>
                          <div className="text-xs text-muted">Safe until a {100 - Number(l.pct)}% drop</div>
                          {l.cashShort && (
                            <div className="mt-1.5 text-xs text-warn">
                              Market can lend ${fmtUsdc(l.amount)} now{l.amount > 0n ? ` (safe until ${l.drop}%)` : ""}
                            </div>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              {levelInfo.some((l) => l.cashShort && !l.reached) && (
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  The lending markets have only ${fmtUsdc(highRoom)} to lend right now. Picking a level fills in what can be borrowed today.
                </p>
              )}
              {level === "high" && (
                <div className="mt-2 space-y-1 text-xs leading-relaxed text-danger">
                  {raiseCap && <p>This raises your vault&apos;s safety cap from {Number(cap) / 100}% to 65% of the liquidation limit, in the same signature.</p>}
                  {positions.some((x) => x.collateral > 0n && x.asset.kind !== "crypto") && (
                    <p>Tokenized stocks and gold do not trade at weekends, so a price can jump on Monday. A liquidation costs about 12.7% of the collateral taken.</p>
                  )}
                  {!p.emergencyRule && (p.schedulesPayingMe.length > 0 || p.claims.length > 0) && (
                    <p className="text-muted">
                      Tip: turn on the emergency rule on this page, so a payday share goes into this collateral if the loan gets close to liquidation.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <Field
            label="Borrow"
            inputMode="decimal"
            placeholder="0.00"
            suffix="USDC"
            value={borrowAmt}
            onChange={(e) => {
              setBorrowAmt(e.target.value);
              setLevel(null);
            }}
            hint={
              now.locked === 0n ? (
                "Lock collateral first."
              ) : (
                <>
                  Up to <FillAmount onFill={() => setBorrowAmt(usdcInput(upTo))}>${fmtUsdc(upTo)}</FillAmount>
                  {level === "high" && upTo > now.available ? " at High risk" : ""}. Uses only what you locked.
                </>
              )
            }
          />
          {borrow > 0n && borrowSplit && afterBorrow && (
            <div className="mt-4 rounded-2xl bg-sunken p-4 text-sm">
              <div className="font-medium">Split so every part stays equally safe:</div>
              <ul className="mt-2 space-y-1">
                {positions.map((x, i) =>
                  borrowSplit[i] > 0n ? (
                    <li key={x.asset.symbol} className="flex items-center gap-2">
                      <AssetIcon asset={x.asset} size={16} /> {x.asset.name}: ${fmtUsdc(borrowSplit[i])}
                    </li>
                  ) : null,
                )}
              </ul>
              {(() => {
                // Morpho's compounding rate on the markets this borrow uses, weighted by the split.
                const used = positions.map((x, i) => ({ x, amt: borrowSplit[i] })).filter(({ amt }) => amt > 0n);
                const sum = used.reduce((a, u) => a + u.amt, 0n);
                const morpho = sum > 0n ? used.reduce((a, u) => a + apyPpm(u.x.ratePerSecond) * Number(u.amt), 0) / Number(sum) / 10_000 : 0;
                const fee = Number(BORROW_FEE_BPS) / 100;
                return (
                  <div className="mt-2">
                    You receive the full <strong>${fmtUsdc(borrow)}</strong>. Borrow APY about <strong>{(morpho + fee).toFixed(2)}%</strong>
                    <span className="text-muted">
                      {" "}
                      ({morpho.toFixed(2)}% Morpho, compounding, to lenders{fee > 0 ? ` + ${feeLabel(BORROW_FEE_BPS)} a year Stackday fee, paid when you repay` : ""}).
                      The rate moves with how much of the market is lent out.
                    </span>
                  </div>
                );
              })()}
              <div className="mt-2 text-muted">
                Health afterwards: {fmtHealth(afterBorrow.health)} for the basket, {fmtHealth(afterBorrow.weakest)} for the weakest part. Safe until
                about a {dropOf(afterBorrow.weakest)}% price drop.
              </div>
            </div>
          )}
          {borrow > 0n && !borrowSplit && <p className="mt-2 text-xs text-danger">That is above what you can borrow now. Lock more first.</p>}
          <Button className="mt-3 w-full sm:w-auto" disabled={!can || !me || borrow === 0n || !borrowSplit || busy} onClick={doBorrow}>
            Borrow
          </Button>
        </div>
      )}

      {tab === "repay" && (
        <div className="mt-5 max-w-xl">
          <Field
            label="Repay"
            inputMode="decimal"
            placeholder="0.00"
            suffix="USDC"
            value={repayAmt}
            onChange={(e) => setRepayAmt(e.target.value)}
            hint={
              now.debt > 0n ? (
                <>
                  Any amount, any time. No penalty. Loan:{" "}
                  <FillAmount onFill={() => setRepayAmt(usdcInput(owedTotal))}>${fmtUsdc(owedTotal)}</FillAmount>
                  {feesOwed >= 100n ? ` (includes $${fmtUsdc(feesOwed, 4)} Stackday fee, paid first)` : ""}
                </>
              ) : (
                "Any amount, any time. No penalty."
              )
            }
          />
          {repay > 0n && !repayAll && (
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {positions.map((x, i) =>
                repaySplit[i] > 0n ? (
                  <li key={x.asset.symbol} className="flex items-center gap-2">
                    <AssetIcon asset={x.asset} size={16} /> {x.asset.name}: ${fmtUsdc(repaySplit[i])}
                  </li>
                ) : null,
              )}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!can || repay === 0n || now.debt === 0n || busy} onClick={() => doRepay(repayAll)}>
              Repay
            </Button>
            <Button variant="secondary" disabled={!can || now.debt === 0n || busy} onClick={() => doRepay(true)}>
              Repay all
            </Button>
          </div>
        </div>
      )}

      <TxStatus state={tx.state} />

      <div className="mt-6 grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
        <Stat label="Dividends a year" value={`+$${fmtUsdc(earnings.earn)}`} hint="After issuer fee and US tax" />
        <Stat label="Loan cost a year" value={`-$${fmtUsdc(earnings.cost)}`} hint="Morpho APY plus the Stackday fee" />
        <Stat label="Net a year" value={`${earnings.net < 0n ? "-" : "+"}$${fmtUsdc(earnings.net < 0n ? -earnings.net : earnings.net)}`} hint="At today's prices, before price moves" />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Estimated with each real share&apos;s yearly dividend, after the issuer&apos;s 5% fee and up to 30% US withholding tax (reinvested into
        the token, not paid in cash). The test tokens pay none.
      </p>
    </Card>
  );
}
