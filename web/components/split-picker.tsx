"use client";

import { useState } from "react";
import { AssetIcon, Chip, Field } from "@/components/ui";
import type { Asset } from "@/lib/contracts";
import { MAX_SPLIT_ASSETS, nudgeWeight, toggleAsset, weightsOf, type Split } from "@/lib/split";

const SHARES = [
  { pct: 0, label: "None" },
  { pct: 10, label: "10%", hint: "A good start" },
  { pct: 20, label: "20%", hint: "Builds faster" },
];

const KIND_LABEL: Record<Asset["kind"], string> = { stock: "Stock", commodity: "Gold", crypto: "Crypto" };

/**
 * One way to choose a payday split, used by Claim (normal pay) and Collect (private pay):
 * 1. how much goes to work (None, 10%, 20% or a custom percent),
 * 2. which assets (tap to add, up to 6),
 * 3. split evenly, or adjust each asset's share of the invested part.
 */
export function SplitPicker({
  value,
  onChange,
  assets,
  label = "How much of this pay goes to work?",
}: {
  value: Split;
  onChange: (s: Split) => void;
  assets: Asset[];
  label?: string;
}) {
  const [custom, setCustom] = useState(!SHARES.some((s) => s.pct === value.pct));
  const [adjust, setAdjust] = useState(!!value.weights);
  const weights = weightsOf(value);
  const chosen = value.symbols.map((s) => assets.find((a) => a.symbol === s)).filter((a): a is Asset => !!a);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {SHARES.map((s) => (
            <Chip
              key={s.pct}
              active={!custom && value.pct === s.pct}
              onClick={() => {
                setCustom(false);
                onChange({ ...value, pct: s.pct, symbols: s.pct > 0 && value.symbols.length === 0 ? [assets[0].symbol] : value.symbols });
              }}
            >
              {s.label}
              {s.hint && <span className="font-normal opacity-70">{s.hint}</span>}
            </Chip>
          ))}
          <Chip active={custom} onClick={() => setCustom(true)}>
            Custom
          </Chip>
          {custom && (
            <div className="w-28">
              <Field
                label="Share"
                inputMode="decimal"
                placeholder="15"
                suffix="%"
                value={value.pct ? String(value.pct) : ""}
                onChange={(e) => {
                  const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                  onChange({ ...value, pct, symbols: pct > 0 && value.symbols.length === 0 ? [assets[0].symbol] : value.symbols });
                }}
              />
            </div>
          )}
        </div>
      </div>

      {value.pct > 0 && (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Spread it across</h3>
            <span className="text-xs text-muted">
              {value.symbols.length} of up to {MAX_SPLIT_ASSETS} chosen
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Assets to buy">
            {assets.map((a) => {
              const on = value.symbols.includes(a.symbol);
              const full = !on && value.symbols.length >= MAX_SPLIT_ASSETS;
              return (
                <button
                  key={a.symbol}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => onChange(toggleAsset(value, a.symbol))}
                  title={full ? "Up to 6 assets per payday." : undefined}
                  className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
                    on ? "border-brand bg-brand/10 text-ink" : "border-line bg-surface/60 text-muted hover:border-line-strong"
                  }`}
                >
                  <AssetIcon asset={a} size={24} />
                  {a.name}
                  {on && (
                    <span className="text-brand-ink" aria-hidden>
                      ✓
                    </span>
                  )}
                  <span className="text-[11px] font-normal opacity-70">{KIND_LABEL[a.kind]}</span>
                </button>
              );
            })}
          </div>

          {chosen.length > 0 && (
            <div className="mt-4 rounded-2xl bg-sunken/70 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-muted">{adjust ? "Your split" : "Split evenly"}</span>
                {chosen.length > 1 && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-ink underline-offset-2 hover:underline"
                    onClick={() => {
                      if (adjust) onChange({ ...value, weights: undefined });
                      setAdjust(!adjust);
                    }}
                  >
                    {adjust ? "Back to even" : "Adjust"}
                  </button>
                )}
              </div>
              <div className="mt-2 space-y-1.5">
                {chosen.map((a) => {
                  const w = weights[a.symbol] ?? 0;
                  return (
                    <div key={a.symbol} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <AssetIcon asset={a} size={18} /> {a.name}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {adjust && (
                          <button
                            type="button"
                            aria-label={`Less ${a.name}`}
                            disabled={w <= 0}
                            onClick={() => onChange(nudgeWeight(value, a.symbol, -5))}
                            className="grid h-7 w-7 place-items-center rounded-full border border-line-strong leading-none hover:border-ink disabled:opacity-30"
                          >
                            −
                          </button>
                        )}
                        <span className="whitespace-nowrap text-right tabular-nums">
                          {Math.round(w)}% · {((value.pct * w) / 100).toFixed(1)}% of pay
                        </span>
                        {adjust && (
                          <button
                            type="button"
                            aria-label={`More ${a.name}`}
                            disabled={w >= 100}
                            onClick={() => onChange(nudgeWeight(value, a.symbol, 5))}
                            className="grid h-7 w-7 place-items-center rounded-full border border-line-strong leading-none hover:border-ink disabled:opacity-30"
                          >
                            +
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
