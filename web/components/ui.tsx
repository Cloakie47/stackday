"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { ASSET_LOGOS } from "@/lib/asset-logos";
import { EXPLORER, type Asset } from "@/lib/contracts";
import type { TxState } from "@/lib/useTx";
import { LearnMore } from "./learn-more";
import { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./styles";

// Class helpers live in a plain module so server components can call them too.
export { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./styles";

export function PageHeader({ title, lead, aside }: { title: string; lead?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[2rem] font-semibold leading-[1.05] tracking-[-0.02em] text-ink sm:text-[2.75rem]">{title}</h1>
        {lead && <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{lead}</p>}
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
  /** "feature" (alias "ink") is the deep blue hero panel. Use it once per page, for the main number. */
  tone?: "surface" | "ink" | "feature";
}) {
  return (
    <section
      className={cx(
        "rounded-3xl p-5 sm:p-6",
        tone === "surface" ? "border border-line bg-surface shadow-xs" : "feature",
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
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
    <Badge tone="warn">{children}</Badge>
  );
}

export function RealBadge({ children = "Real" }: { children?: ReactNode }) {
  return (
    <Badge tone="grow">{children}</Badge>
  );
}

/** A small status pill with a dot. Sentence case, never all caps. */
export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "grow" | "warn" | "danger"; children: ReactNode }) {
  const styles = {
    neutral: "bg-sunken text-ink-soft",
    brand: "bg-brand-soft text-brand-ink",
    grow: "bg-grow-soft text-grow",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", styles)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

/** A money figure that counts up to its value the first time it appears and when it changes. */
export function Money({ value, decimals = 2, prefix = "$" }: { value: bigint | undefined; decimals?: number; prefix?: string }) {
  const target = value === undefined ? undefined : Number(value) / 1e6;
  const [shown, setShown] = useState(target ?? 0);
  const from = useRef(0);

  useEffect(() => {
    if (target === undefined) return;
    // With reduced motion the figure jumps straight to its value (a 0 ms count).
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600;
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
  }, [target]);

  if (target === undefined) return <span className="skeleton inline-block min-w-20">0</span>;
  return (
    <span className="tabular-nums">
      {prefix}
      {shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
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
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div
        className={cx(
          "mt-1.5 truncate tabular-nums text-ink",
          big ? "font-display text-5xl font-semibold leading-none tracking-[-0.03em] sm:text-6xl" : "text-2xl font-semibold tracking-tight",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
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
      className="font-semibold text-brand underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
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
      <span className="mt-1.5 flex items-center rounded-2xl border border-line-strong bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:shadow-[0_0_0_4px_var(--color-brand-soft)]">
        <input
          {...props}
          className="min-h-11 w-full min-w-0 rounded-2xl bg-transparent px-3.5 text-base text-ink outline-none placeholder:text-muted/60"
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
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 min-h-11 w-full rounded-2xl border border-line-strong bg-surface px-3 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-brand focus:shadow-[0_0_0_4px_var(--color-brand-soft)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
        className="relative grid rounded-full bg-sunken p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className="absolute inset-y-1 rounded-full bg-surface shadow-sm transition-transform duration-[250ms] ease-[var(--ease-out)] dark:bg-line-strong"
          style={{
            width: `calc((100% - 0.5rem) / ${options.length})`,
            left: "0.25rem",
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
              "relative z-10 min-h-9 rounded-full text-[13px] font-semibold transition-colors duration-200",
              compact ? "px-0.5 sm:px-3" : "truncate px-3",
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
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]",
        active ? "border-brand bg-brand-soft text-brand-ink" : "border-line-strong bg-surface text-ink hover:bg-sunken",
      )}
    >
      {children}
    </button>
  );
}

export function AssetIcon({ asset, size = 36 }: { asset: Asset; size?: number }) {
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
      className="inline-grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        background: asset.color,
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 0 0 1px var(--line)",
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

/** Stacked bar showing how a total splits across parts. */
export function SplitBar({ parts, height = 10 }: { parts: { key: string; value: number; color: string; label?: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className="flex w-full gap-0.5 overflow-hidden rounded-full bg-sunken" style={{ height }} role="img" aria-label="Split">
      {total > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.key}
              title={p.label}
              className="h-full transition-[width] duration-500 ease-[var(--ease-out-quint)] first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            />
          ))}
    </div>
  );
}

/** Loan health on a line from "liquidation" to "very safe". */
export function HealthMeter({ health }: { health: number | undefined }) {
  const has = health !== undefined && isFinite(health);
  const pct = has ? Math.max(2, Math.min(100, ((health! - 0.8) / (3 - 0.8)) * 100)) : 0;
  const tone = !has ? "bg-line-strong" : health! < 1 ? "bg-danger" : health! < 1.25 ? "bg-warn" : "bg-grow";
  const label = !has ? "No loan" : health! < 1 ? "Can be liquidated" : health! < 1.25 ? "Close to liquidation" : "Safe";
  return (
    <div>
      <div className="relative h-2.5 rounded-full bg-sunken">
        {/* liquidation line at 1.0 */}
        <span className="absolute inset-y-[-3px] w-0.5 rounded bg-danger/60" style={{ left: `${((1 - 0.8) / (3 - 0.8)) * 100}%` }} />
        <span
          className={cx("absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-700 ease-[var(--ease-out-quint)]", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>Liquidation at 1.00</span>
        <span className={cx("font-semibold", !has ? "" : health! < 1 ? "text-danger" : health! < 1.25 ? "text-warn" : "text-grow")}>
          {label}
        </span>
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
  if (state.busy)
    return (
      <p className="mt-4 flex animate-[var(--animate-pop)] items-center gap-2 rounded-2xl bg-brand-soft px-3.5 py-2.5 text-sm text-brand-ink" role="status">
        <Spinner /> {state.step}. Confirm in your wallet and wait for it to finish.
      </p>
    );
  if (state.error)
    return (
      <p className="mt-4 animate-[var(--animate-pop)] break-words rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">
        {state.error}
      </p>
    );
  if (state.done)
    return (
      <p className="mt-4 animate-[var(--animate-pop)] rounded-2xl bg-grow-soft px-3.5 py-2.5 text-sm text-grow" role="status">
        {state.done}{" "}
        {state.hash && (
          <a className="font-semibold underline" href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
            View transaction
          </a>
        )}
      </p>
    );
  return null;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "grow"; children: ReactNode }) {
  const styles = {
    info: "bg-brand-soft text-brand-ink",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    grow: "bg-grow-soft text-grow",
  }[tone];
  return <div className={cx("rounded-2xl px-4 py-3 text-sm leading-relaxed", styles)}>{children}</div>;
}

export function RiskNote() {
  return (
    <Notice tone="warn">
      <strong>Risk:</strong> if prices fall far enough, part of your collateral can be sold to repay a loan. Not financial
      advice. <LearnMore href="/docs#borrowing" className="text-warn decoration-warn/40 hover:decoration-warn" />
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
      className="font-mono text-xs text-brand-ink underline decoration-brand-ink/30 underline-offset-2 transition-colors hover:decoration-brand-ink"
      href={`${EXPLORER}/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      {label ?? `${address.slice(0, 8)}…${address.slice(-6)}`}
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

/** A grey placeholder in the shape of the content that is loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}
