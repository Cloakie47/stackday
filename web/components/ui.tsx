"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
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
        tone === "surface" ? "card" : "feature",
        className,
      )}
    >
      {tone !== "surface" && (
        <>
          <Spotlight />
          <span className="feature-edge" aria-hidden />
        </>
      )}
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
      <span className="well mt-1.5 flex items-center rounded-2xl">
        <input
          {...props}
          className="min-h-11 w-full min-w-0 rounded-2xl bg-transparent px-3.5 text-base text-ink outline-none placeholder:text-muted"
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
        className="well mt-1.5 min-h-11 w-full rounded-2xl px-3 text-base text-ink outline-none focus:shadow-[var(--well),0_0_0_2px_var(--brand),0_0_0_5px_var(--brand-soft)]"
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
        className="track relative grid rounded-full p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className="thumb absolute inset-y-1 rounded-full transition-transform duration-[250ms] ease-[var(--ease-out)]"
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
              "relative z-10 min-h-9 rounded-full text-[13px] transition-colors duration-200 pointer-coarse:min-h-11",
              compact ? "px-0.5 sm:px-3" : "truncate px-3",
              o.value === value ? "font-bold text-ink" : "font-semibold text-muted hover:text-ink",
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
        "tile inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold",
        active ? "text-brand-ink" : "text-ink",
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
  const shown = total > 0 ? parts.filter((p) => p.value > 0) : [];
  const pct = (v: number) => Math.round((v / total) * 100);
  const summary = shown.map((p) => `${p.label ?? p.key} ${pct(p.value)}%`).join(", ");
  return (
    <div
      className="track flex w-full gap-[3px] overflow-hidden rounded-full p-[2px]"
      style={{ height: height + 4 }}
      role="img"
      aria-label={summary ? `Split: ${summary}` : "Nothing yet"}
    >
      {shown.map((p) => (
        <span
          key={p.key}
          title={`${p.label ?? p.key} ${pct(p.value)}%`}
          className="split-seg h-full rounded-full transition-[flex-grow] duration-500 ease-[var(--ease-out-quint)]"
          style={{ flexGrow: p.value, flexBasis: 0, minWidth: 6, background: p.color }}
        />
      ))}
    </div>
  );
}

/** Loan health on a line from "liquidation" to "very safe". */
export function HealthMeter({ health }: { health: number | undefined }) {
  const has = health !== undefined && isFinite(health);
  const at = (h: number) => ((h - 0.8) / (3 - 0.8)) * 100;
  const pct = has ? Math.max(2, Math.min(100, at(health!))) : 0;
  const level = !has ? "none" : health! < 1 ? "danger" : health! < 1.25 ? "warn" : "grow";
  const meter = { "--meter": { none: "var(--line-strong)", danger: "var(--danger)", warn: "var(--warn)", grow: "var(--grow)" }[level] } as CSSProperties;
  const label = !has ? "No loan" : health! < 1 ? "Can be liquidated" : health! < 1.25 ? "Close to liquidation" : "Safe";
  return (
    <div>
      <div
        className="track relative h-3 rounded-full"
        role="meter"
        aria-label="Loan health"
        aria-valuemin={0.8}
        aria-valuemax={3}
        aria-valuenow={has ? Math.min(3, health!) : undefined}
        aria-valuetext={has ? `${health!.toFixed(2)}, ${label}` : label}
      >
        <span aria-hidden className="health-zones absolute inset-0 rounded-full" />
        <span
          aria-hidden
          className="health-fill absolute inset-y-[2px] left-[2px] rounded-full transition-[width] duration-700 ease-[var(--ease-out-quint)]"
          style={{ ...meter, width: `calc(${pct}% - 4px)` }}
        />
        <span aria-hidden className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-danger" style={{ left: `${at(1)}%` }} />
        {has && (
          <span
            aria-hidden
            className="health-knob absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-700 ease-[var(--ease-out-quint)]"
            style={{ ...meter, left: `${pct}%` }}
          />
        )}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>Liquidation at 1.00</span>
        <span className={cx("font-semibold", level === "danger" ? "text-danger" : level === "warn" ? "text-warn" : level === "grow" ? "text-grow" : "")}>{label}</span>
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
    <div className="card mt-4 flex animate-[var(--animate-pop)] items-start gap-3 rounded-2xl p-3.5" role={kind === "error" ? "alert" : "status"}>
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
          {kind === "busy" ? state.step : kind === "done" ? state.done : "That did not go through"}
        </p>
        {kind !== "done" && (
          <p className="mt-0.5 break-words text-[13px] leading-relaxed text-muted">
            {kind === "busy" ? "Confirm in your wallet, then wait for it to finish." : state.error}
          </p>
        )}
      </div>
      {state.hash && kind !== "busy" && (
        <a className={buttonClass("secondary", "sm", "shrink-0")} href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
          View
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
      className={cx(label ? "text-[13px] font-semibold" : "font-mono text-xs", "text-brand-ink underline decoration-brand-ink/30 underline-offset-2 transition-colors hover:decoration-brand-ink")}
      href={`${EXPLORER}/address/${address}`}
      target="_blank"
      rel="noreferrer"
    >
      {label ?? `${address.slice(0, 8)}…${address.slice(-6)}`}
    </a>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="track flex flex-col items-center gap-3 rounded-2xl px-5 py-7 text-center">
      <span aria-hidden className="thumb grid h-10 w-10 place-items-center rounded-full text-muted">
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
          <path d="M4 7.5 10 4l6 3.5v5L10 16l-6-3.5zM4 7.5l6 3.5 6-3.5M10 11v5" />
        </svg>
      </span>
      <div className="max-w-sm text-sm leading-relaxed text-muted">{children}</div>
      {action}
    </div>
  );
}

/** A grey placeholder in the shape of the content that is loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}

/**
 * A soft light that follows the pointer across a feature panel. Mouse and trackpad only:
 * touch screens and reduced-motion users never see it move.
 */
export function Spotlight() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    let r = host.getBoundingClientRect();
    const enter = () => {
      r = host.getBoundingClientRect();
    };
    const paint = () => {
      raf = 0;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const move = (e: PointerEvent) => {
      x = e.clientX - r.left;
      y = e.clientY - r.top;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointermove", move);
    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, []);
  return <span ref={ref} className="spotlight" aria-hidden />;
}
