"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { ASSET_LOGOS } from "@/lib/asset-logos";
import { EXPLORER, type Asset } from "@/lib/contracts";
import { shortAddr } from "@/lib/format";
import type { TxState } from "@/lib/useTx";
import { LearnMore } from "./learn-more";
import { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./styles";

// Class helpers live in a plain module so server components can call them too.
export { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./styles";

/** Short text on phones, fuller text from 640px. Only the visible one is read by screen readers. */
export function Responsive({ m, d }: { m: ReactNode; d: ReactNode }) {
  return (
    <>
      <span className="sm:hidden">{m}</span>
      <span className="hidden sm:inline">{d}</span>
    </>
  );
}

export function PageHeader({ title, lead, aside }: { title: string; lead?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-[1.25] tracking-[-0.02em] text-ink sm:text-[28px] sm:leading-[34px]">{title}</h1>
        {lead && <p className="mt-1.5 hidden max-w-xl text-sm leading-relaxed text-muted sm:block">{lead}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Card({
  title,
  badge,
  action,
  children,
  className = "",
  tone = "surface",
}: {
  title?: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** "feature" (alias "ink") is the summary panel for the one hero number on a page. */
  tone?: "surface" | "ink" | "feature";
}) {
  return (
    <section className={cx("min-w-0 rounded-3xl p-4 sm:p-5", tone === "surface" ? "card" : "summary", className)}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {title && <h2 className="text-base font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
            {badge}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Marks anything that is a testnet stand-in, so nothing mocked passes as real. */
export function MockBadge({ children = "Mock" }: { children?: ReactNode }) {
  return (
    <Badge tone="warn" dot>
      {children}
    </Badge>
  );
}

export function RealBadge({ children = "Real" }: { children?: ReactNode }) {
  return (
    <Badge tone="grow" dot>
      {children}
    </Badge>
  );
}

/** A small status label. Sentence case, never all caps. `dot` marks live or state badges. */
export function Badge({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: "neutral" | "brand" | "grow" | "warn" | "danger";
  dot?: boolean;
  children: ReactNode;
}) {
  const styles = {
    neutral: "bg-sunken text-ink-soft",
    brand: "bg-brand-soft text-brand-ink",
    grow: "bg-grow-soft text-grow",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <span className={cx("inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium leading-4", styles)}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * A money figure. By default it counts up (400 ms) the first time it appears and when it changes;
 * pass animate={false} for figures that should simply show their value.
 */
export function Money({
  value,
  decimals = 2,
  prefix = "$",
  animate = true,
}: {
  value: bigint | undefined;
  decimals?: number;
  prefix?: string;
  animate?: boolean;
}) {
  const target = value === undefined ? undefined : Number(value) / 1e6;
  const [shown, setShown] = useState(target ?? 0);
  const from = useRef(0);

  useEffect(() => {
    if (target === undefined) return;
    // With reduced motion (or animate off) the figure jumps straight to its value (a 0 ms count).
    const duration = !animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400;
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = duration === 0 ? 1 : Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 4);
      setShown(start + (target - start) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);

  if (target === undefined) return <span className="skeleton inline-block w-[4.5ch] align-baseline">0</span>;
  const [whole, cents] = shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).split(".");
  return (
    <span className="money">
      {prefix && <span className="money-unit">{prefix}</span>}
      {whole}
      {cents !== undefined && <span className="money-cents">.{cents}</span>}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  big = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  big?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-medium leading-[18px] text-muted">{label}</div>
      <div
        className={cx(
          "mt-1 truncate tabular-nums text-ink",
          big
            ? "font-display text-[36px] font-semibold leading-10 tracking-[-0.03em] sm:text-[44px] sm:leading-[48px]"
            : "text-[22px] font-semibold leading-7 tracking-[-0.015em]",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs leading-4 text-muted">{hint}</div>}
    </div>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

/** An amount shown next to a field; clicking it puts that amount in the field. */
export function FillAmount({ onFill, children, label }: { onFill: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onFill}
      aria-label={label}
      title="Use this amount"
      className="rounded-sm font-semibold text-brand-ink underline decoration-brand-ink/30 decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  suffix,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; suffix?: string; hint?: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      <span className="well mt-1.5 flex items-center rounded-xl">
        <input
          {...props}
          className="min-h-11 w-full min-w-0 rounded-xl bg-transparent px-3.5 text-base tabular-nums text-ink outline-none placeholder:text-faint"
        />
        {suffix && <span className="whitespace-nowrap pr-3.5 text-sm text-muted">{suffix}</span>}
      </span>
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[13px] font-medium text-ink-soft">{label}</span>
      <span className="relative mt-1.5 block">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="well min-h-11 w-full appearance-none rounded-xl pl-3.5 pr-9 text-base text-ink outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted">
          <path d="M5.5 8l4.5 4.5L14.5 8" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  );
}

/** A row of mutually exclusive choices with a sliding highlight. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  compact = false,
}: {
  value: T;
  onChange: (v: T) => void;
  /** `ariaLabel` names an option for screen readers when its text is ambiguous (1m vs 1M). */
  options: { value: T; label: string; ariaLabel?: string }[];
  label?: string;
  /** Names the group when there is no visible label. */
  ariaLabel?: string;
  /** Tighter segments for many short options (chart timeframes) so labels never truncate on phones. */
  compact?: boolean;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div>
      {label && <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">{label}</span>}
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? label}
        className="track relative grid rounded-xl p-0.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className="thumb absolute inset-y-0.5 rounded-lg transition-transform duration-200 ease-[var(--ease-out)]"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            left: "2px",
            transform: `translateX(${index * 100}%)`,
          }}
        />
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            aria-label={o.ariaLabel}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative z-10 min-h-8 rounded-lg text-[13px] font-medium transition-colors duration-150 pointer-coarse:min-h-10",
              compact ? "px-0.5 sm:px-2.5" : "truncate px-3",
              o.value === value ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Chip({
  active,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...props}
      className={cx(
        "tile inline-flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium pointer-coarse:min-h-11",
        active ? "text-brand-ink" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function AssetIcon({ asset, size = 32 }: { asset: Asset; size?: number }) {
  const logo = ASSET_LOGOS[asset.icon];
  // Bitcoin's logo is already a coin, so it is drawn as it is. The others sit white on their brand colour.
  if (logo && asset.icon === "BTC") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} className="shrink-0" style={{ color: asset.color }}>
        <circle cx="12" cy="12" r="10" fill="white" />
        <path d={logo} fill="currentColor" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: asset.color,
        boxShadow: "0 0 0 1px var(--line)",
        fontSize: size * (asset.icon.length > 3 ? 0.25 : 0.3),
        letterSpacing: "-0.02em",
      }}
    >
      {logo ? (
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="currentColor">
          <path d={logo} />
        </svg>
      ) : (
        asset.icon
      )}
    </span>
  );
}

/** Thin stacked bar showing how a total splits across parts. */
export function SplitBar({ parts, height = 6 }: { parts: { key: string; value: number; color: string; label?: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const shown = total > 0 ? parts.filter((p) => p.value > 0) : [];
  const pct = (v: number) => Math.round((v / total) * 100);
  const summary = shown.map((p) => `${p.label ?? p.key} ${pct(p.value)}%`).join(", ");
  return (
    <div
      className="flex w-full gap-0.5 overflow-hidden rounded-full bg-sunken"
      style={{ height }}
      role="img"
      aria-label={summary ? `Split: ${summary}` : "Nothing yet"}
    >
      {shown.map((p) => (
        <span
          key={p.key}
          title={`${p.label ?? p.key} ${pct(p.value)}%`}
          className="h-full transition-[flex-grow] duration-300 ease-[var(--ease-out)] first:rounded-l-full last:rounded-r-full"
          style={{ flexGrow: p.value, flexBasis: 0, minWidth: 4, background: p.color }}
        />
      ))}
    </div>
  );
}

/** Loan health on a line from 0.8 to 3.0, with the liquidation point at 1.00. */
export function HealthMeter({ health }: { health: number | undefined }) {
  const has = health !== undefined && isFinite(health);
  const at = (h: number) => ((h - 0.8) / (3 - 0.8)) * 100;
  const pct = has ? Math.max(1, Math.min(100, at(health!))) : 0;
  const level = !has ? "none" : health! < 1 ? "danger" : health! < 1.25 ? "warn" : "grow";
  const fill = { none: "transparent", danger: "var(--danger)", warn: "var(--warn)", grow: "var(--grow)" }[level];
  const label = !has ? "No loan" : health! < 1 ? "Can be liquidated" : health! < 1.25 ? "Near liquidation" : "Healthy";
  return (
    <div>
      <div
        className="relative h-2 rounded-full bg-sunken"
        role="meter"
        aria-label="Loan health"
        aria-valuemin={0.8}
        aria-valuemax={3}
        aria-valuenow={has ? Math.min(3, health!) : undefined}
        aria-valuetext={has ? `${health!.toFixed(2)}, ${label}` : label}
      >
        <span aria-hidden className="health-zones absolute inset-0 rounded-full" />
        {has && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-[var(--ease-out)]"
            style={{ width: `${pct}%`, background: fill }}
          />
        )}
        <span aria-hidden className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-danger" style={{ left: `${at(1)}%` }} />
        {has && (
          <span
            aria-hidden
            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink transition-[left] duration-300 ease-[var(--ease-out)]"
            style={{ left: `${pct}%` }}
          />
        )}
      </div>
      <div className="mt-2 flex justify-between gap-3 text-xs text-muted">
        <span>Liquidation 1.00</span>
        <span className={cx("font-medium", level === "danger" ? "text-danger" : level === "warn" ? "text-warn" : level === "grow" ? "text-grow" : "")}>{label}</span>
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-[var(--animate-spin-slow)] rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function TxStatus({ state }: { state: TxState }) {
  const kind = state.busy ? "busy" : state.error ? "error" : state.done ? "done" : null;
  if (!kind) return null;
  const badge = { busy: "bg-brand-soft text-brand-ink", error: "bg-danger-soft text-danger", done: "bg-grow-soft text-grow" }[kind];
  return (
    <div
      className="mt-4 flex animate-[var(--animate-pop)] items-start gap-3 rounded-2xl border border-line bg-surface p-3.5"
      role={kind === "error" ? "alert" : "status"}
    >
      <span aria-hidden className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", badge)}>
        {kind === "busy" ? (
          <Spinner />
        ) : (
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={kind === "done" ? "M3.5 8.5l3 3 6-7" : "M4.5 4.5l7 7M11.5 4.5l-7 7"} />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className={cx("text-sm font-semibold", kind === "error" ? "text-danger" : "text-ink")}>
          {kind === "busy" ? state.step : kind === "done" ? state.done : "Transaction failed"}
        </p>
        {kind !== "done" && (
          <p className="mt-0.5 break-words text-[13px] leading-relaxed text-muted">
            {kind === "busy" ? <Responsive m="Confirm in your wallet." d="Confirm in your wallet, then keep this page open." /> : state.error}
          </p>
        )}
      </div>
      {state.hash && kind !== "busy" && (
        <a className={buttonClass("secondary", "sm", "shrink-0")} href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
          <Responsive m="View" d="View on BaseScan" />
          <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M4 8l4-4M5 4h3v3" />
          </svg>
        </a>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "grow"; children: ReactNode }) {
  const styles = {
    info: "bg-brand-soft text-brand-ink",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    grow: "bg-grow-soft text-grow",
  }[tone];
  return <div className={cx("rounded-xl px-3.5 py-3 text-[13px] leading-relaxed sm:text-sm", styles)}>{children}</div>;
}

export function RiskNote() {
  return (
    <Notice tone="warn">
      <Responsive
        m="If prices fall, collateral can be sold to repay your loan. Not investment advice."
        d={
          <>
            <strong className="font-semibold">Liquidation risk:</strong> if prices fall far enough, part of your collateral can be sold to repay
            your loan. Not investment advice.
          </>
        }
      />{" "}
      <LearnMore href="/docs#borrowing" className="text-warn decoration-warn/40 hover:decoration-warn" />
    </Notice>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium tabular-nums text-ink">{children}</span>
    </div>
  );
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a
      className={cx(
        label ? "text-[13px] font-medium" : "font-mono text-xs",
        "rounded-sm text-brand-ink underline decoration-brand-ink/30 underline-offset-2 transition-colors hover:decoration-brand-ink",
      )}
      href={`${EXPLORER}/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      {label ?? shortAddr(address)}
    </a>
  );
}

/** An empty state: centred text and at most one action. No box, no well. */
export function Empty({ children, action, title }: { children: ReactNode; action?: ReactNode; title?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-7 text-center">
      <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 text-faint" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
        <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5zM4 8.5l8 4.5 8-4.5M12 13v7" />
      </svg>
      {title && <div className="mt-1 text-sm font-medium text-ink">{title}</div>}
      <div className="max-w-[40ch] text-[13px] leading-relaxed text-muted">{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A grey placeholder in the shape of the content that is loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}

/**
 * Retired: the pointer spotlight was part of the old glossy feature panel. Kept as a no-op
 * so any remaining import keeps compiling.
 */
export function Spotlight() {
  return null;
}
