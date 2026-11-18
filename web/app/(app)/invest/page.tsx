"use client";

import { PriceChart } from "@/components/price-chart";
import { AssetSelect } from "@/components/asset-select";
import { LearnMore } from "@/components/learn-more";
import { useEffect, useState } from "react";
import { erc20Abi } from "viem";
import { useReadContracts } from "wagmi";
import { useViewer } from "@/components/providers";
import { AssetIcon, Button, Card, Empty, Field, FillAmount, MockBadge, Notice, PageHeader, Select, Stat, TxStatus } from "@/components/ui";
import { factoryAbi, mockSwapAbi, routerAbi, vaultAbi } from "@/lib/abis";
import { ADDR, ASSETS, EARN_FEE_BPS, MAX_UINT, SIP_FEE_BPS, feeLabel } from "@/lib/contracts";
import { assetForUsdc, fmtAsset, fmtPct, fmtPrice, fmtUsdc, intervalLabel, parseUsdc, until, usdcInput } from "@/lib/format";
import { usePortfolio, type Position } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";
import { BRAND } from "@/lib/brand";
import { DEFAULT_SLOT, SLOT_DAYS, nextSlot, slotLabel } from "@/lib/slots";

/** Above this, a manual buy shows "Slippage is too high" (the buy itself refuses to fill past 1%). */
const MAX_SLIPPAGE_BPS = 100n;

function AssetPicker({ positions, value, onChange }: { positions: Position[]; value: string; onChange: (s: string) => void }) {
  return (
    <AssetSelect
      label="Asset"
      assets={positions.map((p) => p.asset)}
      value={value}
      onChange={onChange}
      detail={(a) => `$${fmtPrice(positions.find((p) => p.asset.symbol === a.symbol)?.price)}`}
    />
  );
}

export default function InvestPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const tx = useTx();
  const me = viewer.address;
  const [symbol, setSymbol] = useState(ASSETS[0].symbol);
  const [amt, setAmt] = useState("");
  const [perBuy, setPerBuy] = useState("");
  const [interval, setIntervalDays] = useState("7");
  const [slotDay, setSlotDay] = useState(String(DEFAULT_SLOT.day));
  const [weeks, setWeeks] = useState("12");
  const [earnAmt, setEarnAmt] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  const pos = p.positions.find((x) => x.asset.symbol === symbol) ?? p.positions[0];
  const asset = pos.asset;
  const amount = parseUsdc(amt);
  const recurringAmount = parseUsdc(perBuy);
  const plans = p.positions.filter((x) => x.recurring);
  // A one-time buy is free; only recurring buys pay the SIP fee (SipRouter.sol).
  const min = (v: bigint) => (pos.price ? (assetForUsdc(v, pos.price, asset.decimals) * 99n) / 100n : 0n);

  // Manual buys work at any hour. Show the rate the exchange gives right now and flag high slippage.
  // On testnet the exchange is the mock; a mainnet quote source plugs in here later.
  const quotes = useReadContracts({
    contracts: [
      { address: ADDR.mockSwap, abi: mockSwapAbi, functionName: "quote", args: [asset.token, amount] },
      { address: ADDR.router, abi: routerAbi, functionName: "quoteAtOracle", args: [asset.token, amount] },
    ],
    query: { enabled: !!ADDR.mockSwap && amount > 0n },
  });
  const exchangeOut = amount > 0n ? (quotes.data?.[0]?.result as bigint | undefined) : undefined;
  const oracleOut = amount > 0n ? (quotes.data?.[1]?.result as bigint | undefined) : undefined;
  const slippageBps = exchangeOut !== undefined && oracleOut ? (oracleOut > exchangeOut ? ((oracleOut - exchangeOut) * 10_000n) / oracleOut : 0n) : undefined;
  const slippageTooHigh = slippageBps !== undefined && slippageBps > MAX_SLIPPAGE_BPS;
  const rate = exchangeOut && exchangeOut > 0n ? (amount * 10n ** BigInt(asset.decimals) * 100n) / exchangeOut : undefined; // USDC per token, 8 decimals

  async function buyOnce() {
    const calls: Call[] = [
      ...(await tx.withApproval(ADDR.usdc, ADDR.router, amount, `Allow ${BRAND.name} to take the USDC`)),
      { label: `Buy ${asset.name} into your vault`, address: ADDR.router, abi: routerAbi, functionName: "invest", args: [asset.token, amount, min(amount)] },
    ];
    if (await tx.run(calls, `Bought. The ${asset.name} is in your vault.`)) setAmt("");
  }

  /** The first buy is the next chosen weekday at 11:00 New York time; later buys keep that slot. */
  const firstBuyAt = () => nextSlot(Number(slotDay), DEFAULT_SLOT.time, Math.floor(Date.now() / 1000));

  // How long a plan runs: the wallet approval covers exactly that many buys, then the plan stops on
  // its own (the next buy cannot take the USDC). "Until I stop" approves without a limit.
  const buysFor = (intervalDays: number) => (weeks === "0" ? 0 : Math.max(1, Math.ceil((Number(weeks) * 7) / intervalDays)));
  const buyCount = buysFor(Number(interval));
  const MAX_APPROVAL = 2n ** 256n - 1n;
  const approveMore = (extra: bigint, label: string): Call => ({
    label,
    address: ADDR.usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [ADDR.router, extra === MAX_APPROVAL || p.routerAllowance + extra > MAX_APPROVAL - 1n ? MAX_APPROVAL : p.routerAllowance + extra],
  });

  async function savePlan() {
    const calls: Call[] = [
      buyCount === 0
        ? approveMore(MAX_APPROVAL, "Allow recurring buys until you stop them")
        : approveMore(recurringAmount * BigInt(buyCount), `Allow ${buyCount} recurring buys`),
      {
        label: "Save your recurring plan",
        address: ADDR.router,
        abi: routerAbi,
        functionName: "setPlan",
        args: [asset.token, recurringAmount, Number(interval) * 86400, 100, firstBuyAt()],
      },
    ];
    if (await tx.run(calls, `Recurring plan saved. Buys run ${slotLabel(Number(slotDay), DEFAULT_SLOT.time)} New York time.`)) {
      setPerBuy("");
      // Let the trigger bot know, so future buys run on time. Optional: works without the database.
      fetch("/api/keeper/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: me, asset: asset.token }),
      }).catch(() => {});
    }
  }

  const extendPlan = (x: Position) => {
    const n = buysFor(Math.max(1, Math.round(x.recurring!.interval / 86400)));
    return tx.run(
      [n === 0 ? approveMore(MAX_APPROVAL, "Allow recurring buys until you stop them") : approveMore(x.recurring!.usdcPerBuy * BigInt(n), `Allow ${n} more buys`)],
      "Plan extended.",
    );
  };

  const runPlan = (x: Position) =>
    me &&
    tx.run(
      [{ label: `Run the ${x.asset.name} buy`, address: ADDR.router, abi: routerAbi, functionName: "executePlan", args: [me, x.asset.token] }],
      "Recurring buy done.",
    );

  const cancelPlan = (x: Position) =>
    tx.run(
      [{ label: `Cancel the ${x.asset.name} plan`, address: ADDR.router, abi: routerAbi, functionName: "cancelPlan", args: [x.asset.token] }],
      "Recurring plan cancelled.",
    );

  // ---- interest on idle USDC
  const earn = parseUsdc(earnAmt);
  const vault = p.vault ?? p.predictedVault;
  const fromWallet = earn > p.vaultUsdc ? earn - p.vaultUsdc : 0n;

  async function startEarning() {
    if (!vault || !me) return;
    const calls: Call[] = [];
    if (!p.vault) calls.push({ label: "Create your vault", address: ADDR.factory, abi: factoryAbi, functionName: "createVault", args: [me] });
    calls.push(...(await tx.withApproval(ADDR.usdc, vault, fromWallet, "Allow your vault to take the USDC")));
    calls.push({ label: "Start earning interest", address: vault, abi: vaultAbi, functionName: "earn", args: [earn] });
    if (await tx.run(calls, "Your USDC is now earning interest.")) setEarnAmt("");
  }

  const stopEarning = () =>
    p.vault &&
    me &&
    tx.run(
      [{ label: "Take all earning USDC back", address: p.vault, abi: vaultAbi, functionName: "stopEarning", args: [MAX_UINT, me] }],
      "USDC and its interest are back in your wallet.",
    );

  return (
    <>
      <PageHeader
        title="Invest"
        lead={
          <>
            Buy into your own vault, once or on a schedule. <LearnMore href="/docs#individuals" />
          </>
        }
      />

      {!me && <Notice>Connect your wallet (top right) to invest.</Notice>}

      <Card title="Choose what to buy">
        <AssetPicker positions={p.positions} value={symbol} onChange={setSymbol} />
        <p className="mt-3 text-xs text-muted">
          In your vault: {fmtAsset(pos.idle + pos.collateral, asset.decimals)} {asset.symbol}. Wallet:{" "}
          {fmtUsdc(p.walletUsdc)} USDC.
          {!asset.borrowable && (
            <span className="ml-1 font-medium text-ink-soft">
              Invest only: {asset.name} has no lending market yet, so it cannot be borrowed against.
            </span>
          )}
        </p>
        <PriceChart key={asset.symbol} asset={asset} testnetPrice={pos.price} />

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line p-4">
            <h3 className="text-sm font-semibold">Buy once</h3>
            <div className="mt-3">
              <Field
                label="Amount"
                inputMode="decimal"
                placeholder="0.00"
                suffix="USDC"
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                hint={
                  <>
                    {amount > 0n && exchangeOut !== undefined && rate !== undefined
                      ? `Rate $${fmtPrice(rate)} per ${asset.symbol}. About ${fmtAsset(exchangeOut, asset.decimals)} ${asset.symbol}. `
                      : amount > 0n && pos.price
                        ? `About ${fmtAsset(assetForUsdc(amount, pos.price, asset.decimals), asset.decimals)} ${asset.symbol}. `
                        : ""}
                    Wallet:{" "}
                    <FillAmount onFill={() => setAmt(usdcInput(p.walletUsdc))} label="Use all USDC in your wallet">
                      ${fmtUsdc(p.walletUsdc)}
                    </FillAmount>
                  </>
                }
              />
            </div>
            <Button
              className="mt-3 w-full"
              disabled={!viewer.canAct || amount === 0n || amount > p.walletUsdc || slippageTooHigh || tx.state.busy}
              onClick={buyOnce}
            >
              Buy {asset.name}
            </Button>
            {amount > p.walletUsdc && <p className="mt-2 text-xs text-danger">Your wallet does not hold that much USDC.</p>}
            {slippageTooHigh && <p className="mt-2 text-xs text-danger">Slippage is too high.</p>}
          </div>

          <div className="rounded-2xl border border-line p-4">
            <h3 className="text-sm font-semibold">Buy on a schedule</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field
                label="Each time"
                inputMode="decimal"
                placeholder="0.00"
                suffix="USDC"
                value={perBuy}
                onChange={(e) => setPerBuy(e.target.value)}
                hint={
                  <>
                    Quick:{" "}
                    {["5", "10", "25", "50"].map((v, i) => (
                      <span key={v}>
                        {i > 0 && " · "}
                        <FillAmount onFill={() => setPerBuy(v)}>${v}</FillAmount>
                      </span>
                    ))}
                  </>
                }
              />
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
              <Select
                label="How long"
                value={weeks}
                onChange={setWeeks}
                options={[
                  { value: "4", label: "4 weeks" },
                  { value: "12", label: "12 weeks" },
                  { value: "26", label: "26 weeks" },
                  { value: "52", label: "1 year" },
                  { value: "0", label: "Until I stop" },
                ]}
              />
              <Select
                label="Day (11:00 am New York)"
                value={slotDay}
                onChange={setSlotDay}
                options={SLOT_DAYS.map((d) => ({ value: String(d.value), label: d.label }))}
              />
            </div>
            <p className="mt-2 text-xs text-muted">Buys run while the US market is open, when prices are steadiest.</p>
            {recurringAmount > 0n && (
              <p className="mt-2 text-xs text-muted">
                {buyCount === 0
                  ? "Runs until you cancel it."
                  : `${buyCount} buys, $${fmtUsdc(recurringAmount * BigInt(buyCount))} in total. It stops on its own after the last one.`}
              </p>
            )}
            <Button variant="ink" className="mt-3 w-full" disabled={!viewer.canAct || recurringAmount === 0n || tx.state.busy} onClick={savePlan}>
              {pos.recurring ? "Replace the recurring buy" : "Start a recurring buy"}
            </Button>
            <p className="mt-2 text-xs text-muted">{fmtPct(SIP_FEE_BPS)} fee on each recurring buy.</p>
          </div>
        </div>
        <TxStatus state={tx.state} />
      </Card>

      <Card title="Your recurring buys">
        {plans.length === 0 ? (
          <Empty>No recurring buys yet. You can run one per asset, side by side.</Empty>
        ) : (
          <div className="divide-y divide-line">
            {plans.map((x) => {
              const due = now > 0 && x.recurring!.nextBuyAt <= now;
              const unlimited = p.routerAllowance > 2n ** 200n;
              const left = unlimited ? undefined : p.routerAllowance / x.recurring!.usdcPerBuy;
              const ended = left === 0n;
              return (
                <div key={x.asset.symbol} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <AssetIcon asset={x.asset} />
                    <div>
                      <div className="text-sm font-semibold">
                        {fmtUsdc(x.recurring!.usdcPerBuy)} USDC into {x.asset.name} · {intervalLabel(x.recurring!.interval)}
                      </div>
                      <div className="text-xs text-muted">
                        {ended
                          ? "Finished: the approved buys are used up"
                          : `${due ? "A buy is due now" : `Next buy ${until(x.recurring!.nextBuyAt, now)}`} · ${
                              left === undefined ? "runs until you stop it" : `${left} ${left === 1n ? "buy" : "buys"} left`
                            }`}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {ended ? (
                      <Button size="sm" variant="secondary" disabled={!viewer.canAct || tx.state.busy} onClick={() => extendPlan(x)}>
                        Extend
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={!viewer.canAct || !due || tx.state.busy} onClick={() => runPlan(x)}>
                        Run now
                      </Button>
                    )}
                    <Button size="sm" variant="danger" disabled={!viewer.canAct || tx.state.busy} onClick={() => cancelPlan(x)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Earn interest on idle USDC" badge={<MockBadge>Mock interest venue</MockBadge>}>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Lend idle vault USDC to earn interest. Not guaranteed.
          {EARN_FEE_BPS > 0n && ` Stackday fee: ${feeLabel(EARN_FEE_BPS)} a year, taken only out of the interest.`}{" "}
          <LearnMore href="/docs#earn" />
        </p>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Earning now" value={`$${fmtUsdc(p.earning, 4)}`} />
          <Stat label="Idle in your vault" value={`$${fmtUsdc(p.vaultUsdc)}`} />
          <Stat label="In your wallet" value={`$${fmtUsdc(p.walletUsdc)}`} />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field
            label="Amount to put to work"
            inputMode="decimal"
            placeholder="0.00"
            suffix="USDC"
            value={earnAmt}
            onChange={(e) => setEarnAmt(e.target.value)}
            hint={
              <>
                {fromWallet > 0n ? `${fmtUsdc(fromWallet)} USDC will come from your wallet.` : "Uses USDC already in your vault first."}{" "}
                {p.vaultUsdc > 0n && (
                  <>
                    Idle in vault:{" "}
                    <FillAmount onFill={() => setEarnAmt(usdcInput(p.vaultUsdc))}>${fmtUsdc(p.vaultUsdc)}</FillAmount>{" "}
                  </>
                )}
                Vault and wallet:{" "}
                <FillAmount onFill={() => setEarnAmt(usdcInput(p.vaultUsdc + p.walletUsdc))}>${fmtUsdc(p.vaultUsdc + p.walletUsdc)}</FillAmount>
              </>
            }
          />
          <Button disabled={!viewer.canAct || earn === 0n || fromWallet > p.walletUsdc || tx.state.busy} onClick={startEarning}>
            Start earning
          </Button>
          <Button variant="secondary" disabled={!viewer.canAct || p.earning === 0n || tx.state.busy} onClick={stopEarning}>
            Take it all back
          </Button>
        </div>
      </Card>
    </>
  );
}
