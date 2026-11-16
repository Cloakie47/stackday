"use client";

import { useEffect, useState } from "react";
import { TvWidget, type WidgetState } from "@/components/tradingview";
import { Button, RealBadge, Segmented, Skeleton, cx } from "@/components/ui";
import { DEFAULT_TIMEFRAME, TIMEFRAMES, timeframe, tvSymbol } from "@/lib/charts";
import type { Asset } from "@/lib/contracts";
import { fmtPrice } from "@/lib/format";

const SPOKEN: Record<string, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "1h": "1 hour",
  "1d": "1 day",
  "1w": "1 week",
  "1mo": "1 month",
  "1y": "1 year",
  "5y": "5 years",
};
const TF_KEY = "stackday-chart-timeframe";

/** What the chart actually shows, in words, for the footer. */
function marketWords(asset: Asset, symbol: string) {
  if (asset.icon === "BTC") return "Live Bitcoin price (BTC/USD). cbBTC tracks Bitcoin 1 to 1.";
  if (asset.icon === "ETH") return "Live Ether price (ETH/USD).";
  return `Live market price of ${symbol}.`;
}

/**
 * Large real-market price chart with the founder's timeframes (Invest page only, per the design
 * spec). Drawn by TradingView; the testnet still uses test prices, which the footer states.
 */
export function PriceChart({ asset, testnetPrice }: { asset: Asset; testnetPrice?: bigint }) {
  const symbol = tvSymbol(asset.symbol);
  const [tf, setTf] = useState(DEFAULT_TIMEFRAME);
  const [state, setState] = useState<WidgetState>("waiting");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TF_KEY);
      if (saved && TIMEFRAMES.some((t) => t.id === saved)) setTf(saved);
    } catch {
      /* private mode: keep the default */
    }
  }, []);

  function choose(id: string) {
    setTf(id);
    try {
      localStorage.setItem(TF_KEY, id);
    } catch {
      /* ignore */
    }
  }

  if (!symbol) return null;
  const t = timeframe(tf);

  return (
    <section aria-labelledby="price-chart-title" className="mt-5 sm:rounded-2xl sm:border sm:border-line sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="price-chart-title" className="text-sm font-semibold">
            {asset.name} price
          </h3>
          <RealBadge>Real market price</RealBadge>
        </div>
        <div className="w-full sm:w-[26rem]">
          <Segmented
            value={tf}
            onChange={choose}
            ariaLabel="Chart timeframe"
            compact
            options={TIMEFRAMES.map((x) => ({ value: x.id, label: x.label, ariaLabel: SPOKEN[x.id] }))}
          />
        </div>
      </div>

      <div className="relative mt-4 h-60 w-full overflow-hidden rounded-xl sm:h-80" style={{ touchAction: "pan-y" }}>
        {state === "error" ? (
          <div className="grid h-full place-items-center rounded-xl border border-dashed border-line-strong text-center text-sm text-muted">
            <div>
              <p>Chart unavailable right now. Buying still works.</p>
              <Button className="mt-3" size="sm" variant="ghost" onClick={() => setRetry((r) => r + 1)}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <>
            {state !== "ready" && <Skeleton className="absolute inset-0 h-full w-full rounded-xl" />}
            <TvWidget
              name="tv-advanced-chart"
              className={cx("tv-scope h-full w-full transition-opacity duration-150", state === "ready" ? "opacity-100" : "opacity-0")}
              attrs={{
                symbol,
                interval: t.interval,
                "time-frame": t.range || false,
                "chart-type": "area",
                "hide-volume": true,
                "hide-top-toolbar": true,
                "hide-snapshot-button": true,
                title: `${asset.name} price chart by TradingView`,
              }}
              onState={setState}
              retry={retry}
            />
          </>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        {marketWords(asset, symbol)} Stackday runs on testnet with test prices, so buys and loans here use ${fmtPrice(testnetPrice)}.
        {state === "error" && " Chart by TradingView."}
      </p>
    </section>
  );
}
