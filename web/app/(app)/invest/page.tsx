"use client";

import { PriceChart } from "@/components/price-chart";
import { AssetSelect } from "@/components/asset-select";
import { LearnMore } from "@/components/learn-more";
import { useEffect, useState } from "react";
import { erc20Abi } from "viem";
import { useReadContracts } from "wagmi";
import { useViewer } from "@/components/providers";
import { AssetIcon, Button, Card, Empty, Field, FillAmount, MockBadge, Notice, PageHeader, Responsive, Select, Stat, TxStatus } from "@/components/ui";
import { factoryAbi, mockSwapAbi, routerAbi, vaultAbi } from "@/lib/abis";
import { ADDR, ASSETS, EARN_FEE_BPS, MAX_UINT, SIP_FEE_BPS, feeLabel } from "@/lib/contracts";
import { assetForUsdc, fmtAsset, fmtPct, fmtPrice, fmtUsdc, intervalLabel, parseUsdc, until, usdcInput } from "@/lib/format";
import { usePortfolio, type Position } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";
import { BRAND } from "@/lib/brand";
import { DEFAULT_SLOT, SLOT_DAYS, nextSlot, slotLabel } from "@/lib/slots";

/** Above this, a manual buy says the price moved too much (the buy itself refuses to fill past 1%). */
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
      ...(await tx.withApproval(ADDR.usdc, ADDR.router, amount, "Approve USDC")),
      { label: `Buy ${asset.name} into your vault`, address: ADDR.router, abi: routerAbi, functionName: "invest", args: [asset.token, amount, min(amount)] },
    ];
    if (await tx.run(calls, `Bought. The ${asset.name} is in your vault.`)) setAmt("");
  }

  /** The first buy is the next chosen weekday at 11:00 New York time; later buys keep that slot. */
  // Called only from the save handler, never during render.
  // eslint-disable-next-line react-hooks/purity
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
    calls.push(...(await tx.withApproval(ADDR.usdc, vault, fromWallet, "Approve USDC")));
    calls.push({ label: "Start earning interest", address: vault, abi: vaultAbi, functionName: "earn", args: [earn] });
    if (await tx.run(calls, "Your USDC is now earning interest.")) setEarnAmt("");
  }

  const stopEarning = () =>
    p.vault &&
    me &&
    tx.run(
      [{ label: "Withdraw all earning USDC", address: p.vault, abi: vaultAbi, functionName: "stopEarning", args: [MAX_UINT, me] }],
      "USDC and its interest are back in your wallet.",
    );

  return (
    <>
      <PageHeader
        title="Invest"
        lead={
          <>
            Buy once or on a schedule, straight into your vault. <LearnMore href="/docs#individuals" />
          </>
        }
      />

      {!me && <Notice>Connect your wallet to invest.</Notice>}

      <Card title="What to buy">
        <AssetPicker positions={p.positions} value={symbol} onChange={setSymbol} />
        <p className="mt-2 text-xs tabular-nums text-muted">
          In your vault {fmtAsset(pos.idle + pos.collateral, asset.decimals)} {asset.symbol} · Wallet {fmtUsdc(p.walletUsdc)} USDC
        </p>
        <PriceChart key={asset.symbol} asset={asset} testnetPrice={pos.price} />

        <div className="-mx-4 mt-6 grid border-t border-line sm:-mx-5 lg:grid-cols-2">
          <div className="px-4 pt-5 sm:px-5 lg:pb-1">
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
                    {amount > 0n && exchangeOut !== undefined && rate !== undefined ? (
                      <Responsive
                        m={`About ${fmtAsset(exchangeOut, asset.decimals)} ${asset.symbol}. `}
                        d={`About ${fmtAsset(exchangeOut, asset.decimals)} ${asset.symbol} at $${fmtPrice(rate)} each. `}
                      />
                    ) : amount > 0n && pos.price ? (
                      `About ${fmtAsset(assetForUsdc(amount, pos.price, asset.decimals), asset.decimals)} ${asset.symbol}. `
                    ) : (
                      ""
                    )}
                    Wallet{" "}
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
            {amount > p.walletUsdc && <p className="mt-2 text-xs text-danger">Not enough USDC in your wallet.</p>}
            {slippageTooHigh && (
              <p className="mt-2 text-xs text-danger">
                <Responsive m="Price moved over 1%. Try again." d="Price moved more than 1%. Try a smaller amount or try again." />
              </p>
            )}
          </div>

          <div className="mt-6 border-t border-line px-4 pt-5 sm:px-5 lg:mt-0 lg:border-l lg:border-t-0 lg:pb-1">
            <h3 className="text-sm font-semibold">Recurring buy</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Amount per buy"
                inputMode="decimal"
                placeholder="0.00"
                suffix="USDC"
                value={perBuy}
                onChange={(e) => setPerBuy(e.target.value)}
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
                label="Day (11:00 ET)"
                value={slotDay}
                onChange={setSlotDay}
                options={SLOT_DAYS.map((d) => ({ value: String(d.value), label: d.label }))}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick amounts">
              {["5", "10", "25", "50"].map((v) => (
                <Button key={v} size="sm" variant="soft" aria-label={`${v} USDC per buy`} onClick={() => setPerBuy(v)}>
                  ${v}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Buys run while the US market is open.</p>
            {recurringAmount > 0n && (
              <p className="mt-2 text-xs text-muted">
                {buyCount === 0
                  ? "Runs until you cancel it."
                  : `${buyCount} buys, $${fmtUsdc(recurringAmount * BigInt(buyCount))} total. Stops after the last one.`}
              </p>
            )}
            <Button variant="secondary" className="mt-3 w-full" disabled={!viewer.canAct || recurringAmount === 0n || tx.state.busy} onClick={savePlan}>
              {pos.recurring ? "Replace recurring buy" : "Start recurring buy"}
            </Button>
            <p className="mt-2 text-xs text-muted">{fmtPct(SIP_FEE_BPS)} fee on each recurring buy.</p>
          </div>
        </div>
        <TxStatus state={tx.state} />
      </Card>

      <Card title="Your recurring buys">
        {plans.length === 0 ? (
          <Empty>
            <Responsive m="No recurring buys yet." d="No recurring buys yet. You can run one per asset." />
          </Empty>
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
                      <div className="text-sm font-medium">
                        {fmtUsdc(x.recurring!.usdcPerBuy)} USDC into {x.asset.name} · {intervalLabel(x.recurring!.interval)}
                      </div>
                      <div className="text-xs text-muted">
                        {ended
                          ? "Finished. Extend to keep buying."
                          : `${due ? "Due now" : `Next buy ${until(x.recurring!.nextBuyAt, now)}`} · ${
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

      <Card title="Earn interest" badge={<MockBadge>Mock venue</MockBadge>}>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          <Responsive m="Earn a variable rate on idle USDC. Not guaranteed." d="Lend idle USDC in your vault to earn a variable rate. Not guaranteed." />
          {EARN_FEE_BPS > 0n && ` ${BRAND.name} fee: ${feeLabel(EARN_FEE_BPS)} a year, taken only out of the interest.`}{" "}
          <LearnMore href="/docs#earn" />
        </p>
        <dl className="mt-5 grid grid-cols-3">
          <div className="min-w-0 pr-3 sm:pr-6">
            <Stat label="Earning" value={`$${fmtUsdc(p.earning, 4)}`} />
          </div>
          <div className="min-w-0 border-l border-line px-3 sm:px-6">
            <Stat label="Idle in vault" value={`$${fmtUsdc(p.vaultUsdc)}`} />
          </div>
          <div className="min-w-0 border-l border-line pl-3 sm:pl-6">
            <Stat label="In wallet" value={`$${fmtUsdc(p.walletUsdc)}`} />
          </div>
        </dl>
        <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-start">
          <Field
            label="Amount"
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
          <Button className="min-h-11 sm:mt-[25.5px]" disabled={!viewer.canAct || earn === 0n || fromWallet > p.walletUsdc || tx.state.busy} onClick={startEarning}>
            Start earning
          </Button>
          <Button variant="secondary" className="min-h-11 sm:mt-[25.5px]" disabled={!viewer.canAct || p.earning === 0n || tx.state.busy} onClick={stopEarning}>
            Withdraw all
          </Button>
        </div>
      </Card>
    </>
  );
}
