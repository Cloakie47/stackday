"use client";

import { AssetSelect } from "@/components/asset-select";
import { LearnMore } from "@/components/learn-more";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useViewer } from "@/components/providers";
import { useAccountState } from "@/lib/useAccount";
import {
  AddressLink,
  AssetIcon,
  Card,
  DimCents,
  Field,
  HealthMeter,
  LabelTip,
  MockBadge,
  Notice,
  PageHeader,
  RealBadge,
  Row,
  Stat,
  cx,
} from "@/components/ui";
import { apyPpm } from "@/lib/basket";
import { ADDR, BORROWABLE, BORROW_FEE_BPS, EXPLORER, SIP_FEE_BPS, feeLabel } from "@/lib/contracts";
import { WAD, ago, assetValue, fmtAsset, fmtPct, fmtPrice, fmtUsdc, parseUsdc } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";
import { BRAND } from "@/lib/brand";

const GAPS = [0, 10, 20, 30];

function status(health: number) {
  if (!isFinite(health)) return { label: "No loan", tone: "text-muted" };
  if (health < 1) return { label: "Can be liquidated", tone: "text-danger" };
  if (health < 1.25) return { label: "Close to liquidation", tone: "text-warn" };
  return { label: "Healthy", tone: "text-grow" };
}

/** Dollars with thousands separators and two decimals, for display only. */
const usd2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RiskPage() {
  const personal = useAccountState().mode === "personal";
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const [symbol, setSymbol] = useState(BORROWABLE[0].symbol);
  const [simCollateral, setSimCollateral] = useState("1000");
  const [simLoan, setSimLoan] = useState("300");
  const [customGap, setCustomGap] = useState(40);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  const pos = p.positions.find((x) => x.asset.symbol === symbol) ?? p.positions[0];
  const asset = pos.asset;
  const price = pos.price ?? 0n;
  const hasLoan = pos.debt > 0n;
  const lltv = Number(asset.lltv) / 1e18;
  // Morpho's liquidation bonus for this limit: min(15%, 1 / (1 - 0.3 * (1 - limit)) - 1)
  const bonusPct = Math.min(15, (1 / (1 - 0.3 * (1 - lltv)) - 1) * 100);

  // Real position if there is a loan, otherwise the example the visitor types in.
  const collateralValue = hasLoan ? assetValue(pos.collateral, price, asset.decimals) : parseUsdc(simCollateral);
  const debt = hasLoan ? pos.debt : parseUsdc(simLoan);
  const maxDebt = (collateralValue * asset.lltv) / WAD;
  const borrowLimit = (maxDebt * p.borrowCapBps) / 10_000n;
  const health = debt > 0n ? Number((maxDebt * 10_000n) / debt) / 10_000 : Infinity;
  const ltv = collateralValue > 0n ? Number((debt * 10_000n) / collateralValue) / 100 : 0;
  const liquidationPrice = isFinite(health) && health > 0 ? Number(price) / 1e8 / health : 0;
  const dropToLiquidation = isFinite(health) ? Math.max(0, (1 - 1 / health) * 100) : 100;
  const defaultSurvives = (1 - Number(p.borrowCapBps) / 10_000) * 100;
  // Morpho compounds every second, so the APY (not the simple rate) is the real yearly cost.
  const morphoApy = pos.ratePerSecond !== undefined ? apyPpm(pos.ratePerSecond) / 10_000 : undefined;
  const feePct = Number(BORROW_FEE_BPS) / 100;
  const apy = morphoApy !== undefined ? morphoApy + feePct : undefined;
  const yearlyCost = apy !== undefined ? (Number(debt) / 1e6) * (apy / 100) : undefined;

  const scenario = (gapPct: number) => {
    const h = health * (1 - gapPct / 100);
    const value = Math.floor((Number(collateralValue) / 1e6) * (1 - gapPct / 100) * 100) / 100;
    return { gapPct, health: h, value, price: (Number(price) / 1e8) * (1 - gapPct / 100), ...status(h) };
  };

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/borrow" className="hover:text-ink">
              Borrow
            </Link>
            <span aria-hidden>/</span>
            <b className="font-medium text-ink">Risk</b>
          </>
        }
        title="Risk"
        lead="Cost, limits and stress tests for a loan."
      />

      <div className="max-w-md">
        <AssetSelect label="Collateral asset" assets={BORROWABLE} value={symbol} onChange={setSymbol} />
        <p className="mt-1.5 text-xs text-muted">
          <LabelTip label="One loan per asset" tip="Each asset is its own loan. Pick one to see its numbers." />
        </p>
      </div>

      <Card title="The loan">
        <p className="text-[13px] text-muted">
          {hasLoan
            ? `Showing your real position: ${fmtAsset(pos.collateral, asset.decimals)} ${asset.symbol} locked as collateral.`
            : `You have no loan against ${asset.name}. The numbers below use the example you type in.`}
        </p>
        {!hasLoan && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Example: collateral worth" inputMode="decimal" suffix="USDC" value={simCollateral} onChange={(e) => setSimCollateral(e.target.value)} />
            <Field label="Example: amount borrowed" inputMode="decimal" suffix="USDC" value={simLoan} onChange={(e) => setSimLoan(e.target.value)} />
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat label="Loan" value={<DimCents text={`$${fmtUsdc(debt)}`} />} />
          <Stat label="Collateral value" value={<DimCents text={`$${fmtUsdc(collateralValue)}`} />} />
          <Stat
            label="Health"
            tip="How safe the loan is. At 1.00, part of the collateral can be sold to repay it."
            tone={!isFinite(health) ? undefined : health < 1 ? "danger" : health < 1.25 ? "warn" : "grow"}
            value={isFinite(health) ? health.toFixed(2) : "No loan"}
            hint="Liquidation at 1.00"
          />
          <Stat
            label="Loan to value"
            tip="Your loan as a share of your collateral's value."
            value={`${ltv.toFixed(1)}%`}
            hint={`Liquidation starts at ${(lltv * 100).toFixed(1)}%`}
          />
        </div>
        <div className="mt-5">
          <HealthMeter health={isFinite(health) ? health : undefined} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Borrowing cost">
          <Row
            label="Borrow rate"
            tip={`Morpho's rate is set by the market and goes to lenders. The ${BRAND.name} fee is a fixed yearly share of the loan, paid before the loan when you repay.`}
          >
            {apy !== undefined ? `${apy.toFixed(2)}% a year` : "…"}
          </Row>
          <Row label="Morpho interest, compounding">{morphoApy !== undefined ? `${morphoApy.toFixed(2)}%` : "…"}</Row>
          <Row label={`${BRAND.name} fee`}>{BORROW_FEE_BPS > 0n ? `${feeLabel(BORROW_FEE_BPS)} a year, paid when you repay` : "None"}</Row>
          <Row label="Cost of this loan">{yearlyCost !== undefined ? `about $${usd2(yearlyCost)} a year` : "…"}</Row>
          <Row label={`${BRAND.name} fee on recurring buys`}>{feeLabel(SIP_FEE_BPS)}, fixed</Row>
        </Card>

        <Card title="Limits">
          <Row
            label="Borrow limit"
            tip={`You start at half the market maximum, room for a ${defaultSurvives.toFixed(0)}% fall. You can raise it to 85%.`}
          >
            ${fmtUsdc(borrowLimit)} <span className="text-muted">({fmtPct(p.borrowCapBps)} of max)</span>
          </Row>
          <Row label="Max before liquidation">${fmtUsdc(maxDebt)}</Row>
          <Row label="Market cash" tip="USDC the market can lend right now.">
            ${fmtUsdc(pos.liquidity)}
          </Row>
        </Card>

        <Card title="Liquidation risk">
          <Row label={`${asset.name} price now`}>${fmtPrice(pos.price)}</Row>
          <Row label="Liquidation price">{debt > 0n ? `$${usd2(liquidationPrice)}` : "No loan"}</Row>
          <Row label="Price drop that triggers it">{debt > 0n ? `${dropToLiquidation.toFixed(1)}%` : "No loan"}</Row>
          <Row label="Liquidation penalty" tip="Extra collateral a liquidator takes when your loan is liquidated.">
            about {bonusPct.toFixed(1)}%
          </Row>
          <p className="mt-3 text-xs text-warn">At the liquidation price, part of your collateral can be sold with no warning.</p>
        </Card>

        <Card title="Repayment options">
          <ul className="space-y-2 text-[13px] text-ink-soft">
            <li>Repay any amount on the Borrow page. No penalty.</li>
            {personal ? (
              <li>Locking more of this asset, for example each recurring buy, makes the loan safer. New buys stay free until you lock them.</li>
            ) : (
              <>
                <li>Locking each payday share of this asset makes the loan safer. New buys stay free until you lock them.</li>
                <li>The emergency rule sends more salary to collateral when health is low.</li>
              </>
            )}
          </ul>
        </Card>
      </div>

      <Card
        flush
        title="Stress test: price gap"
        tip={
          asset.kind !== "crypto"
            ? `${asset.kind === "commodity" ? "The gold market closes" : "Stock markets close"} at night and at weekends and can reopen much lower in one step.`
            : "Crypto trades around the clock but can still fall very fast."
        }
      >
        <div className="mt-3 overflow-x-auto border-t border-line-soft">
          <table className="dtable min-w-[32rem]">
            <thead>
              <tr>
                <th scope="col">Price gap</th>
                <th scope="col" className="r">
                  New price
                </th>
                <th scope="col" className="r">
                  Collateral value
                </th>
                <th scope="col" className="r">
                  Health
                </th>
                <th scope="col" className="r">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {[...GAPS, customGap].map((g, i) => {
                const s = scenario(g);
                return (
                  <tr key={i}>
                    <td className="font-medium">
                      {g === 0 ? "Today" : `Down ${g}%`}
                      {i === GAPS.length && <span className="ml-1 text-xs font-normal text-muted">(your pick)</span>}
                    </td>
                    <td className="r">${usd2(s.price)}</td>
                    <td className="r">${usd2(s.value)}</td>
                    <td className="r">{isFinite(s.health) ? s.health.toFixed(2) : "No loan"}</td>
                    <td className={cx("r font-medium", s.tone)}>{s.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line-soft px-4 py-4 sm:px-5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="gap" className="text-[13px] text-ink-soft">
              Try your own gap
            </label>
            <span className="font-display text-2xl tracking-[-0.02em] tabular-nums">Down {customGap}%</span>
          </div>
          <input id="gap" type="range" min={0} max={80} step={1} value={customGap} onChange={(e) => setCustomGap(Number(e.target.value))} className="mt-2 h-11 w-full" />
          {debt > 0n && (
            <p className="mt-2 text-[13px] text-ink-soft">
              This loan survives a gap of up to <span className="font-medium text-ink">{dropToLiquidation.toFixed(1)}%</span>.
            </p>
          )}
        </div>
      </Card>

      <Card title="Stress test: paused transfers" tip="The issuer can pause token transfers, for example during a corporate action.">
        <Row label={`${asset.symbol} transfers right now`}>
          {pos.transfersPaused === undefined ? "…" : pos.transfersPaused ? <span className="text-danger">Paused</span> : <span className="text-grow">Working</span>}
        </Row>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="text-[13px] font-medium text-grow">Still works during a pause</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] text-ink-soft">
              <li>Repaying your loan (it only moves USDC)</li>
              {!personal && <li>Claiming salary: that asset&apos;s share is skipped and paid in USDC</li>}
              <li>Borrowing more against collateral already locked</li>
            </ul>
          </div>
          <div>
            <h3 className="text-[13px] font-medium text-danger">Does not work during a pause</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] text-ink-soft">
              <li>Adding collateral, so {personal ? "new buys" : "payday"} cannot make the loan safer</li>
              <li>Withdrawing the asset</li>
              <li>Buying it {personal ? "with a recurring plan" : "with a share of pay or a recurring plan"}</li>
            </ul>
          </div>
        </div>
        <div className="mt-4">
          <Notice tone="danger">
            <strong className="font-semibold">Worst case:</strong> a pause during a price fall. Liquidation can follow the moment transfers resume.
            Repaying USDC still works.
          </Notice>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card
          title="Price freshness"
          tip="On mainnet, stock prices freeze while markets are closed. Treat health as stale then."
          badge={<MockBadge>Mock price feed</MockBadge>}
        >
          <Row label={`${asset.name} reference price`}>${fmtPrice(pos.price)}</Row>
          <Row label="Last updated">{pos.priceUpdatedAt !== undefined && now ? ago(pos.priceUpdatedAt, now) : "…"}</Row>
          <Row label="Market status">
            {pos.feedFrozen === undefined ? "…" : pos.feedFrozen ? <span className="text-warn">Closed, price is frozen</span> : <span className="text-grow">Open</span>}
          </Row>
        </Card>

        <Card
          title="Market"
          tip="Your vault borrows directly from this Morpho market. Its price comes from a mock feed."
          badge={<RealBadge>Real Morpho contracts</RealBadge>}
        >
          <Row label="Lending protocol">
            Morpho on Base Sepolia <AddressLink address={ADDR.morpho} />
          </Row>
          <Row label="Market">
            <span className="inline-flex items-center gap-2">
              <AssetIcon asset={asset} size={16} />
              {asset.symbol} / USDC <MockBadge>mock collateral token</MockBadge>
            </span>
          </Row>
          <Row label="Market id">
            <span className="break-all font-mono text-xs">{asset.marketId}</span>
          </Row>
          <Row label="Liquidation LTV" tip="The loan to value at which liquidation starts.">
            {(lltv * 100).toFixed(1)}%
          </Row>
          <Row label="Interest rate model">Morpho adaptive curve</Row>
          <Row label="Collateral token">
            <AddressLink address={asset.token} />
          </Row>
          <Row label="Loan token">
            USDC <AddressLink address={ADDR.usdc} />
          </Row>
          <Row label={`${BRAND.name} adapter`}>
            <AddressLink address={asset.adapter} />
          </Row>
        </Card>
      </div>

      <p className="text-xs text-muted">
        <LearnMore href="/docs#borrowing">How borrowing works</LearnMore> ·{" "}
        <LearnMore href="/docs#contracts">All addresses</LearnMore> · Verify on{" "}
        <a className="font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink" href={EXPLORER} target="_blank" rel="noreferrer">
          BaseScan
        </a>
      </p>
    </>
  );
}
