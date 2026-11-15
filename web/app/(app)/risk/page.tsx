"use client";

import { useEffect, useState } from "react";
import { useViewer } from "@/components/providers";
import {
  AddressLink,
  AssetIcon,
  Card,
  Chip,
  Field,
  HealthMeter,
  MockBadge,
  Notice,
  PageHeader,
  RealBadge,
  RiskNote,
  Row,
  Stat,
} from "@/components/ui";
import { ADDR, ASSETS, EXPLORER } from "@/lib/contracts";
import { WAD, ago, aprFromPerSecond, assetValue, fmtAsset, fmtPct, fmtPrice, fmtUsdc, parseUsdc } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";

const GAPS = [0, 10, 20, 30];

function status(health: number) {
  if (!isFinite(health)) return { label: "No loan", tone: "text-muted" };
  if (health < 1) return { label: "Can be liquidated", tone: "text-danger" };
  if (health < 1.25) return { label: "Close to liquidation", tone: "text-warn" };
  return { label: "Safe", tone: "text-grow" };
}

export default function RiskPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const [symbol, setSymbol] = useState(ASSETS[0].symbol);
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
  const apr = aprFromPerSecond(pos.ratePerSecond);
  const yearlyCost = apr !== undefined ? (Number(debt) / 1e6) * (apr / 100) : undefined;

  const scenario = (gapPct: number) => {
    const h = health * (1 - gapPct / 100);
    const value = Math.floor((Number(collateralValue) / 1e6) * (1 - gapPct / 100) * 100) / 100;
    return { gapPct, health: h, value, price: (Number(price) / 1e8) * (1 - gapPct / 100), ...status(h) };
  };

  return (
    <>
      <PageHeader
        title="Risk"
        lead="Everything about borrowing on one page: cost, limits, liquidation risk, how to repay, and what a bad night or a frozen market would do."
      />

      <RiskNote />

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Collateral asset">
        {p.positions.map((x) => (
          <Chip key={x.asset.symbol} active={x.asset.symbol === symbol} onClick={() => setSymbol(x.asset.symbol)}>
            <AssetIcon asset={x.asset} size={20} /> {x.asset.name}
          </Chip>
        ))}
      </div>

      <Card title="The loan">
        <p className="text-sm text-muted">
          {hasLoan
            ? `Showing your real position: ${fmtAsset(pos.collateral, asset.decimals)} ${asset.symbol} posted as collateral.`
            : `You have no loan against ${asset.name}. The numbers below use the example you type in.`}
        </p>
        {!hasLoan && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Example: collateral worth" inputMode="decimal" suffix="USDC" value={simCollateral} onChange={(e) => setSimCollateral(e.target.value)} />
            <Field label="Example: amount borrowed" inputMode="decimal" suffix="USDC" value={simLoan} onChange={(e) => setSimLoan(e.target.value)} />
          </div>
        )}
        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Loan" value={`$${fmtUsdc(debt)}`} />
          <Stat label="Collateral value" value={`$${fmtUsdc(collateralValue)}`} />
          <Stat label="Health" value={<span className={status(health).tone}>{isFinite(health) ? health.toFixed(2) : "No loan"}</span>} />
          <Stat label="Loan to value" value={`${ltv.toFixed(1)}%`} hint={`Liquidation starts at ${(lltv * 100).toFixed(1)}%`} />
        </div>
        <div className="mt-5">
          <HealthMeter health={isFinite(health) ? health : undefined} />
        </div>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card title="Borrowing cost">
          <Row label="Interest rate now">{apr !== undefined ? `${apr.toFixed(2)}% per year` : "…"}</Row>
          <Row label="Cost of this loan at that rate">{yearlyCost !== undefined ? `about $${yearlyCost.toFixed(2)} per year` : "…"}</Row>
          <Row label="Stackday fee on borrowing">None</Row>
          <Row label="Stackday fee on purchases">0.25%, fixed</Row>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Interest is set by the lending market, moves up when more people borrow, and is added to what you owe every
            second. It goes to the market&apos;s lenders, not to Stackday.
          </p>
        </Card>

        <Card title="Limits">
          <Row label={`Your borrow limit (${fmtPct(p.borrowCapBps)} of the maximum)`}>${fmtUsdc(borrowLimit)}</Row>
          <Row label="Absolute maximum before liquidation">${fmtUsdc(maxDebt)}</Row>
          <Row label="USDC available in the market">${fmtUsdc(pos.liquidity)}</Row>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Stackday starts you at half of what the market would allow, which leaves room for a {defaultSurvives.toFixed(0)}%
            price fall before liquidation. That lowers the risk, it does not remove it. You can raise your own limit to
            at most 85% of the maximum. Nobody else can change it.
          </p>
        </Card>

        <Card title="Liquidation risk">
          <Row label={`${asset.name} price now`}>${fmtPrice(pos.price)}</Row>
          <Row label="Liquidation price">{debt > 0n ? `$${liquidationPrice.toFixed(2)}` : "No loan"}</Row>
          <Row label="Price drop that triggers it">{debt > 0n ? `${dropToLiquidation.toFixed(1)}%` : "No loan"}</Row>
          <Row label="Liquidator bonus taken from your collateral">about {bonusPct.toFixed(1)}%</Row>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            If the price falls to the liquidation price, anyone may repay part of your loan and take that value of your
            collateral plus the bonus. You keep what is left. There is no warning period.
          </p>
        </Card>

        <Card title="Repayment options">
          <ul className="space-y-2.5 text-sm leading-relaxed text-ink">
            <li>Repay any amount at any time on the Borrow page. No schedule, no early repayment penalty.</li>
            <li>Repay everything, then withdraw all your collateral.</li>
            <li>Do nothing: every payday with a SIP share into this asset adds collateral, so health improves on its own.</li>
            <li>Set the emergency rule so a risky loan pulls a bigger share of your next salary into collateral.</li>
            <li>Anyone can repay on your behalf, for example from another wallet of yours.</li>
          </ul>
        </Card>
      </div>

      <Card title="Stress test: overnight or weekend price gap">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          {asset.kind === "stock"
            ? "Stock markets close at night and on weekends. The price feed holds the last price while they are closed and can reopen much lower in one step, with no chance to react in between."
            : "Crypto trades around the clock, so there is no closed market, but prices can still fall very fast."}{" "}
          This is what a sudden fall would do to the loan above.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <th className="py-2 font-semibold">Price gap</th>
                <th className="py-2 text-right font-semibold">New price</th>
                <th className="py-2 text-right font-semibold">Collateral value</th>
                <th className="py-2 text-right font-semibold">Health</th>
                <th className="py-2 text-right font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {[...GAPS, customGap].map((g, i) => {
                const s = scenario(g);
                return (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-3 font-medium">
                      {g === 0 ? "Today" : `Down ${g}%`}
                      {i === GAPS.length && <span className="ml-1 text-xs text-muted">(your pick)</span>}
                    </td>
                    <td className="py-3 text-right tabular-nums">${s.price.toFixed(2)}</td>
                    <td className="py-3 text-right tabular-nums">${s.value.toFixed(2)}</td>
                    <td className="py-3 text-right tabular-nums">{isFinite(s.health) ? s.health.toFixed(2) : "No loan"}</td>
                    <td className={`py-3 text-right font-semibold ${s.tone}`}>{s.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="gap" className="text-[13px] font-medium text-ink-soft">
              Try your own gap
            </label>
            <span className="font-display text-3xl tabular-nums">Down {customGap}%</span>
          </div>
          <input id="gap" type="range" min={0} max={80} step={1} value={customGap} onChange={(e) => setCustomGap(Number(e.target.value))} className="mt-2 w-full" />
        </div>
        {debt > 0n && (
          <p className="mt-4 text-sm text-ink">
            This loan survives a gap of up to <strong>{dropToLiquidation.toFixed(1)}%</strong>.
          </p>
        )}
      </Card>

      <Card title="Stress test: paused collateral transfers">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          The issuer of a tokenized stock can pause transfers of the token, for example during a corporate action. While
          paused, the token cannot move at all.
        </p>
        <div className="mt-3">
          <Row label={`${asset.symbol} transfers right now`}>
            {pos.transfersPaused === undefined ? "…" : pos.transfersPaused ? <span className="text-danger">Paused</span> : <span className="text-grow">Working</span>}
          </Row>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-grow">Still works during a pause</h3>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
              <li>Repaying your loan (it only moves USDC)</li>
              <li>Claiming salary: that asset&apos;s share is skipped and paid in USDC</li>
              <li>Borrowing more against collateral already posted</li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-danger">Does not work during a pause</h3>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
              <li>Adding collateral, so payday cannot make the loan safer</li>
              <li>Withdrawing the asset</li>
              <li>Buying it with a SIP share or a recurring plan</li>
            </ul>
          </div>
        </div>
        <div className="mt-5">
          <Notice tone="danger">
            <strong>The dangerous combination:</strong> a pause during a price fall. Liquidators cannot take the collateral
            while it is paused, so nothing happens at first. But interest keeps growing, you cannot add collateral, and
            the moment transfers resume an unhealthy loan can be liquidated immediately. The only defence during a pause
            is to repay USDC.
          </Notice>
        </div>
      </Card>

      <Card title="Price freshness" badge={<MockBadge>Mock price feed</MockBadge>}>
        <Row label={`${asset.name} reference price`}>${fmtPrice(pos.price)}</Row>
        <Row label="Last updated">{pos.priceUpdatedAt !== undefined && now ? ago(pos.priceUpdatedAt, now) : "…"}</Row>
        <Row label="Market status">
          {pos.feedFrozen === undefined ? "…" : pos.feedFrozen ? <span className="text-warn">Closed, price is frozen</span> : <span className="text-grow">Open</span>}
        </Row>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          On Base mainnet stock prices come from Chainlink, which runs 24 hours on 5 days a week and holds the last close
          on nights, weekends and holidays. A health number computed from a frozen price can look fine while the real
          market has already moved. Treat health as stale whenever the market is closed.
        </p>
      </Card>

      <Card title="The exact market used" badge={<RealBadge>Real Morpho contracts</RealBadge>}>
        <Row label="Lending protocol">
          Morpho on Base Sepolia <AddressLink address={ADDR.morpho} />
        </Row>
        <Row label="Market">
          {asset.symbol} / USDC <MockBadge>mock collateral token</MockBadge>
        </Row>
        <Row label="Market id">
          <span className="break-all font-mono text-xs">{asset.marketId}</span>
        </Row>
        <Row label="Liquidation limit (LLTV)">{(lltv * 100).toFixed(1)}%</Row>
        <Row label="Interest rate model">Morpho adaptive curve</Row>
        <Row label="Collateral token">
          <AddressLink address={asset.token} />
        </Row>
        <Row label="Loan token">
          USDC <AddressLink address={ADDR.usdc} />
        </Row>
        <Row label="Stackday adapter for this market">
          <AddressLink address={asset.adapter} />
        </Row>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Stackday does not run a lending pool. Your vault borrows directly from this Morpho market, which Stackday
          created on the test network with the same liquidation limit as the main real {asset.realTicker} / USDC market on
          Base mainnet. The price it uses here comes from a mock feed that the demo operator can change. Verify any
          address on{" "}
          <a className="underline" href={EXPLORER} target="_blank" rel="noreferrer">
            BaseScan
          </a>
          .
        </p>
      </Card>
    </>
  );
}
