"use client";

import { useState } from "react";
import { useViewer } from "@/components/providers";
import { Button, Card, Empty, Field, Notice, PageHeader, Select, Skeleton } from "@/components/ui";
import { ASSETS } from "@/lib/contracts";
import type { Holding, PortfolioAnalysis, PortfolioInput, View } from "@/lib/research/types";
import { universeAsset } from "@/lib/research/universe";
import { usePortfolio } from "@/lib/usePortfolio";
import { previewPortfolio } from "./api";
import { Disclaimer, LoadError, NOT_COVERED, NotCoveredBadge, ResearchAssetIcon, ResearchTabs, SampleBanner, assetName, fmtUsd, useWeekly } from "./bits";
import { PortfolioAnalysisView } from "./portfolio-analysis";
import { previewAnalysis } from "./portfolio-preview";

export function PortfolioPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const weekly = useWeekly();
  const [manual, setManual] = useState<Holding[]>([]);
  const [pick, setPick] = useState(ASSETS[0]?.symbol ?? "mAAPL");
  const [units, setUnits] = useState("");
  const [loan, setLoan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ a: PortfolioAnalysis; preview: boolean; sampleViews: boolean } | null>(null);

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
        .map((x) => ({
          assetId: x.asset.symbol,
          amount: Number(x.idle + x.collateral) / 10 ** x.asset.decimals,
          origin: "vault" as const,
          loanUsd: x.debt > 0n ? Number(x.debt) / 1e6 : undefined,
        }))
    : [];

  const amount = Number(units);
  const loanUsd = Number(loan);
  const canAdd = Number.isFinite(amount) && amount > 0 && (loan === "" || (Number.isFinite(loanUsd) && loanUsd >= 0));
  function add() {
    if (!canAdd) return;
    setManual((m) => {
      const prev = m.find((h) => h.assetId === pick);
      const nextLoan = (prev?.loanUsd ?? 0) + (loanUsd > 0 ? loanUsd : 0);
      return [...m.filter((h) => h.assetId !== pick), { assetId: pick, amount: amount + (prev?.amount ?? 0), origin: "manual", loanUsd: nextLoan > 0 ? nextLoan : undefined }];
    });
    setUnits("");
    setLoan("");
  }

  const holdings = [...vault, ...manual];
  const covered = holdings.filter((h) => universeAsset(h.assetId));
  const notCovered = holdings.filter((h) => !universeAsset(h.assetId));
  const pickCovered = Boolean(universeAsset(pick));

  async function run() {
    setBusy(true);
    setError(null);
    // Only research-universe holdings go to the check; the rest are listed as not covered.
    const input: PortfolioInput = { holdings: covered };
    const views = new Map<string, View>();
    if (weekly.status === "ready") for (const s of weekly.data.report.assets) if (s.status === "ok") views.set(s.assetId, s.view.view);
    try {
      const r = await previewPortfolio(input, () => previewAnalysis(input, priceUsd, views));
      setResult({ a: r.data.analysis, preview: r.from === "sample", sampleViews: r.data.reportKind === "sample" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Portfolio check" lead="Facts about your holdings: allocation, overlap, concentration and loan health, with a link to the general view for each asset." />
      <ResearchTabs />
      <Disclaimer />
      <Notice>
        This check states facts and links to the weekly research, which is the same for every reader. It never gives a personal buy or sell order, and
        nothing is saved.
      </Notice>

      <Card title="Your holdings" tip="Vault holdings and loans are read from your own vault on Base Sepolia. You can add anything else by hand. Values use testnet mock prices.">
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
              <li key={`${h.origin}-${h.assetId}`} className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-3">
                  <ResearchAssetIcon assetId={h.assetId} size={24} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 truncate text-[13px] font-medium">
                      {assetName(h.assetId)}
                      {!universeAsset(h.assetId) && <NotCoveredBadge />}
                    </span>
                    <span className="block text-xs text-muted">
                      {h.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} units · {h.origin === "vault" ? "In your vault" : "Added by hand"}
                      {h.loanUsd ? ` · ${fmtUsd(h.loanUsd)} borrowed` : ""}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[13px] tabular-nums">{fmtUsd(h.amount * (priceUsd(h.assetId) ?? 0))}</span>
                  {h.origin === "manual" && (
                    <Button variant="ghost" size="sm" aria-label={`Remove ${assetName(h.assetId)}`} onClick={() => setManual((m) => m.filter((x) => x.assetId !== h.assetId))}>
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-4 grid items-end gap-3 border-t border-line-soft pt-4 sm:grid-cols-[1.4fr_1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Select label="Add an asset" value={pick} onChange={setPick} options={ASSETS.map((a) => ({ value: a.symbol, label: `${a.name}${universeAsset(a.symbol) ? "" : " (not covered)"}` }))} />
          <Field label="Units" inputMode="decimal" placeholder="0" value={units} onChange={(e) => setUnits(e.target.value)} />
          <Field
            label="Borrowed against it"
            inputMode="decimal"
            placeholder="0"
            suffix="USD"
            value={loan}
            onChange={(e) => setLoan(e.target.value)}
            tip="Optional. Used only for the loan health facts and the borrowing note."
          />
          <Button type="submit" variant="secondary" disabled={!canAdd}>
            Add
          </Button>
        </form>
        {!pickCovered && <p className="mt-2 text-xs text-muted">{NOT_COVERED} It is listed, but not part of the check.</p>}

        <Button className="mt-4" disabled={covered.length === 0 || busy} onClick={run}>
          {busy ? "Checking" : "Check these holdings"}
        </Button>
        {covered.length === 0 && <p className="mt-2 text-xs text-muted">Add at least one covered holding first.</p>}
      </Card>

      {notCovered.length > 0 && (
        <Card title="Not covered">
          <p className="mb-3 text-[13px] text-ink-soft">{NOT_COVERED} These holdings are left out of the check.</p>
          <ul className="flex flex-wrap gap-2">
            {notCovered.map((h) => (
              <li key={`${h.origin}-${h.assetId}`} className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-popover px-3 py-1.5 text-[13px]">
                <ResearchAssetIcon assetId={h.assetId} size={20} />
                {assetName(h.assetId)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {error && <LoadError error={error} />}
      {result ? (
        <>
          {result.preview ? (
            <Notice tone="warn">Preview: the portfolio service is not live, so this check was worked out in your browser with a simple sample method.</Notice>
          ) : null}
          <SampleBanner show={result.sampleViews}>The general views linked below come from the sample weekly report, not a real one.</SampleBanner>
          {result.a.holdings.length === 0 ? <Empty>None of these holdings has a price to value them with.</Empty> : <PortfolioAnalysisView a={result.a} preview={result.preview} />}
        </>
      ) : null}

      <Disclaimer />
    </>
  );
}
