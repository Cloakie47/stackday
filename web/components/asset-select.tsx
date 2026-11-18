"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AssetIcon, cx } from "@/components/ui";
import type { Asset } from "@/lib/contracts";

/** Second line under the name: the real token this testnet mock stands in for. */
const subtitle = (a: Asset) => `Test token, stands in for ${a.realTicker}${a.borrowable ? "" : " · invest only"}`;

const GROUPS: { kind: Asset["kind"]; label: string }[] = [
  { kind: "stock", label: "Stocks" },
  { kind: "fund", label: "Funds" },
  { kind: "commodity", label: "Commodities" },
  { kind: "crypto", label: "Crypto" },
];

/**
 * Dropdown for picking one asset, grouped into stocks and crypto, with each asset's logo.
 * `detail` adds something on the right of each row, such as a price or a loan marker.
 */
export function AssetSelect({
  assets,
  value,
  onChange,
  label,
  detail,
}: {
  assets: Asset[];
  value: string;
  onChange: (symbol: string) => void;
  label: string;
  detail?: (asset: Asset) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const ordered = GROUPS.flatMap((g) => assets.filter((a) => a.kind === g.kind));
  const selected = assets.find((a) => a.symbol === value) ?? assets[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function show() {
    setActive(Math.max(0, ordered.findIndex((a) => a.symbol === selected?.symbol)));
    setOpen(true);
  }

  function pick(a: Asset) {
    onChange(a.symbol);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") return setOpen(false);
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      return show();
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(ordered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (ordered[active]) pick(ordered[active]);
    }
  }

  if (!selected) return null;

  return (
    <div ref={root} className={cx("relative w-full max-w-sm", open && "z-40")} onKeyDown={onKey}>
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : show())}
        className="mt-1.5 flex min-h-12 w-full items-center gap-3 rounded-2xl border border-line-strong bg-surface px-3.5 text-left transition-[border-color,box-shadow] duration-150 focus-visible:border-brand focus-visible:shadow-[0_0_0_4px_var(--color-brand-soft)] focus-visible:outline-none"
      >
        <AssetIcon asset={selected} size={26} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{selected.name}</span>
          <span className="block text-xs text-muted">{subtitle(selected)}</span>
        </span>
        {detail && <span className="shrink-0 text-sm tabular-nums text-muted">{detail(selected)}</span>}
        <svg aria-hidden viewBox="0 0 20 20" className={cx("h-4 w-4 shrink-0 text-muted transition-transform duration-200", open && "rotate-180")}>
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 z-30 mt-2 max-h-80 overflow-auto rounded-2xl border border-line bg-surface p-1.5 shadow-lg"
        >
          {GROUPS.map((g) => {
            const items = assets.filter((a) => a.kind === g.kind);
            if (items.length === 0) return null;
            return (
              <div key={g.kind} role="group" aria-label={g.label}>
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label}</div>
                {items.map((a) => {
                  const i = ordered.indexOf(a);
                  const isSelected = a.symbol === selected.symbol;
                  return (
                    <div
                      key={a.symbol}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(a)}
                      className={cx(
                        "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2",
                        i === active ? "bg-sunken" : "",
                        isSelected && "font-semibold",
                      )}
                    >
                      <AssetIcon asset={a} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{a.name}</span>
                        <span className="block text-xs font-normal text-muted">{subtitle(a)}</span>
                      </span>
                      {detail && <span className="shrink-0 text-xs font-normal tabular-nums text-muted">{detail(a)}</span>}
                      {isSelected && (
                        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-brand">
                          <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
