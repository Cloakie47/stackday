"use client";

import { useState } from "react";
import { useViewer } from "@/components/providers";
import { Button, Card, Empty, Field, Notice, PageHeader, Segmented, Select, Skeleton } from "@/components/ui";
import { ASSETS } from "@/lib/contracts";
import type { Holding, Horizon, PortfolioAnalysis, PortfolioInput, RiskTolerance } from "@/lib/research/types";
import { UNIVERSE } from "@/lib/research/universe";
import { usePortfolio } from "@/lib/usePortfolio";
import { analysePortfolio } from "./api";
import { Disclaimer, LoadError, ResearchAssetIcon, ResearchTabs, SampleBanner, assetName, fmtUsd, useSnapshot } from "./bits";
import { PortfolioAnalysisView } from "./portfolio-analysis";
import { previewAnalysis } from "./portfolio-preview";

const HORIZONS: { value: Horizon; label: string }[] = [
  { value: "short", label: "Under 1 year" },
  { value: "medium", label: "1 to 5 years" },
  { value: "long", label: "5 years or more" },
];
const RISKS: { value: RiskTolerance; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function PortfolioPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const snap = useSnapshot();
  const [manual, setManual] = useState<Holding[]>([]);
  const [pick, setPick] = useState(UNIVERSE[0].assetId);
  const [units, setUnits] = useState("");
  const [horizon, setHorizon] = useState<Horizon>("long");
  const [risk, setRisk] = useState<RiskTolerance>("medium");
  const [monthly, setMonthly] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ a: PortfolioAnalysis; preview: boolean } | null>(null);

  /** Testnet mock price in USD: the live mock feed when read, else the deployed start price. */
  const priceUsd = (id: string) => {
    const pos = p.positions.find((x) => x.asset.symbol === id);
    if (pos?.price) return Number(pos.price) / 1e8;
    const a = ASSETS.find((x) => x.symbol === id);
    return a ? Number(a.startPrice) / 1e8 : undefined;
  };

  const vault: Holding[] = viewer.address
    ? p.positions
        .filter((x) => x.idle + x.collateral > 0n)
        .map((x) => ({ assetId: x.asset.symbol, amount: Number(x.idle + x.collateral) / 10 ** x.asset.decimals, origin: "vault" as const }))
    : [];

  const amount = Number(units);
  const canAdd = Number.isFinite(amount) && amount > 0;
  function add() {
    if (!canAdd) return;
    setManual((m) => [...m.filter((h) => h.assetId !== pick), { assetId: pick, amount: amount + (m.find((h) => h.assetId === pick)?.amount ?? 0), origin: "manual" }]);
    setUnits("");
  }

  const holdings = [...vault, ...manual];

  async function run() {
    setBusy(true);
    setError(null);
    const input: PortfolioInput = {
      holdings,
      horizon,
      risk,
      monthlyNewMoneyUsd: Number(monthly) > 0 ? Number(monthly) : undefined,
      loanUsd: p.totalDebt > 0n ? Number(p.totalDebt) / 1e6 : undefined,
    };
    try {
      const notes = snap.status === "ready" ? snap.data.notes : [];
      const r = await analysePortfolio(input, () => previewAnalysis(input, priceUsd, notes));
      setResult({ a: r.data, preview: r.from === "sample" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Portfolio check" lead="See how your holdings are spread, what overlaps, and where new money could go." />
      <ResearchTabs />
      <SampleBanner show={snap.status === "ready" && snap.data.kind === "sample"} what="research the check reads" />

      <Card title="Your holdings" tip="Vault holdings are read from your own vault on Base Sepolia. You can add anything else by hand. Values use testnet mock prices.">
        {!viewer.address ? (
          <Notice>Connect a wallet to include your vault, or add holdings by hand below.</Notice>
        ) : p.loading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : vault.length === 0 ? (
          <Notice>Your vault is empty. Add holdings by hand below.</Notice>
        ) : null}

        {holdings.length > 0 && (
          <ul className="mt-3 divide-y divide-line-soft">
            {holdings.map((h) => (
              <li key={`${h.origin}-${h.assetId}`} className="flex min-h-[52px] items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-3">
                  <ResearchAssetIcon assetId={h.assetId} size={24} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{assetName(h.assetId)}</span>
                    <span className="block text-xs text-muted">
                      {h.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} units · {h.origin === "vault" ? "In your vault" : "Added by hand"}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[13px] tabular-nums">{fmtUsd(h.amount * (priceUsd(h.assetId) ?? 0))}</span>
                  {h.origin === "manual" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${assetName(h.assetId)}`}
                      onClick={() => setManual((m) => m.filter((x) => x.assetId !== h.assetId))}
                    >
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-4 grid items-end gap-3 border-t border-line-soft pt-4 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Select label="Add an asset" value={pick} onChange={setPick} options={UNIVERSE.map((u) => ({ value: u.assetId, label: `${u.name} (${u.underlying})` }))} />
          <Field label="Units" inputMode="decimal" placeholder="0" value={units} onChange={(e) => setUnits(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={!canAdd}>
            Add
          </Button>
        </form>
      </Card>

      <Card title="Your goals">
        <div className="grid gap-5 lg:grid-cols-2">
          <Segmented label="How long you plan to invest" value={horizon} onChange={setHorizon} options={HORIZONS} />
          <Segmented label="How much risk you can take" value={risk} onChange={setRisk} options={RISKS} />
        </div>
        <div className="mt-4 max-w-xs">
          <Field
            label="New money each month"
            inputMode="decimal"
            placeholder="0"
            suffix="USD"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            tip="Used only for ideas on where new money could go. Nothing is ever sold."
          />
        </div>
        <Button className="mt-4" disabled={holdings.length === 0 || busy} onClick={run}>
          {busy ? "Checking" : "Check my portfolio"}
        </Button>
        {holdings.length === 0 && <p className="mt-2 text-xs text-muted">Add at least one holding first.</p>}
      </Card>

      {error && <LoadError error={error} />}
      {result ? (
        <>
          {result.preview && (
            <Notice tone="warn">
              Preview: the portfolio service is not live yet, so this check was worked out in your browser with a simple sample method.
            </Notice>
          )}
          {result.a.holdings.length === 0 ? <Empty>None of these holdings has a price to value them with.</Empty> : <PortfolioAnalysisView a={result.a} preview={result.preview} />}
        </>
      ) : null}

      <Disclaimer />
    </>
  );
}
