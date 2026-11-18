"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ASSET_DISC, ASSET_LOGOS, LOGO_MODE } from "@/lib/asset-logos";
import { EXPLORER, type Asset } from "@/lib/contracts";
import type { TxState } from "@/lib/useTx";
import { LearnMore } from "./learn-more";
import { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./styles";

// Class helpers live in a plain module so server components can call them too.
export { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./styles";

/* ------------------------------------------------------------------------------------------------
   Info tips: a small (i) button that explains a label. Hover (mouse) opens it after a short delay,
   keyboard focus opens it at once, a tap or click toggles it. Escape, an outside tap or blur closes
   it. Text only: no links or buttons inside.
------------------------------------------------------------------------------------------------ */

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 120; // time to move the pointer onto the bubble (WCAG 1.4.13 hoverable)
const WARM_MS = 400; // after one tip closes, the next opens at once
const GAP = 6;
const EDGE = 8;

let lastClosedAt = 0;
/** The one tip that is open, so opening another closes it. */
let openTip: { owner: object; close: () => void } | null = null;

type Place = { x: number; y: number; side: "top" | "bottom" };

export function InfoTip({
  label,
  children,
  side = "top",
  className = "",
}: {
  /** What this explains, for example "Health". Read out as "About Health". */
  label: string;
  /** One or two plain sentences. */
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const descId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pinned = useRef(false);
  const self = useRef({});
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  // A modal <dialog> sits in the top layer, so a bubble for a tip inside one must render inside it.
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    pinned.current = false;
    setOpen(false);
    setPlace(null);
    lastClosedAt = Date.now();
    if (openTip?.owner === self.current) openTip = null;
  }, []);

  const show = useCallback(
    (delay: number) => {
      window.clearTimeout(timer.current);
      const run = () => {
        if (openTip && openTip.owner !== self.current) openTip.close();
        openTip = { owner: self.current, close: hide };
        setHost(buttonRef.current?.closest<HTMLElement>("dialog[open]") ?? document.body);
        setOpen(true);
      };
      if (delay === 0 || Date.now() - lastClosedAt < WARM_MS) run();
      else timer.current = window.setTimeout(run, delay);
    },
    [hide],
  );

  const hideSoon = useCallback(() => {
    if (pinned.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(hide, CLOSE_DELAY_MS);
  }, [hide]);

  // Place the bubble above (or below) the button, inside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const b = buttonRef.current?.getBoundingClientRect();
      const t = bubbleRef.current;
      if (!b || !t) return;
      const w = t.offsetWidth;
      const h = t.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const fitsTop = b.top - GAP - h >= EDGE;
      const fitsBottom = b.bottom + GAP + h <= vh - EDGE;
      const s = side === "top" ? (fitsTop || !fitsBottom ? "top" : "bottom") : fitsBottom || !fitsTop ? "bottom" : "top";
      // Neither side fits: keep the top edge inside the viewport.
      const y = Math.max(EDGE, s === "top" ? b.top - GAP - h : b.bottom + GAP);
      const x = Math.min(Math.max(b.left + b.width / 2 - w / 2, EDGE), Math.max(EDGE, vw - EDGE - w));
      // Inside a transformed <dialog>, fixed positions are relative to the dialog's box.
      const dlg = t.closest("dialog");
      const off = dlg && getComputedStyle(dlg).transform !== "none" ? dlg.getBoundingClientRect() : { left: 0, top: 0 };
      setPlace({ x: Math.round(x - off.left), y: Math.round(y - off.top), side: s });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, side]);

  // Escape and outside taps close it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // keeps a surrounding <dialog> sheet open
      e.stopPropagation();
      hide();
    };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (buttonRef.current?.contains(n) || bubbleRef.current?.contains(n)) return;
      hide();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, hide]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={descId}
        data-open={open || undefined}
        className={cx("infotip-btn", className)}
        onPointerEnter={(e) => e.pointerType === "mouse" && show(OPEN_DELAY_MS)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hideSoon()}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && show(0)}
        onBlur={(e) => {
          if (pinned.current && bubbleRef.current?.contains(e.relatedTarget as Node | null)) return;
          hide();
        }}
        onClick={(e) => {
          e.preventDefault(); // inside a <label>, don't focus the field
          e.stopPropagation(); // don't sort a table column or follow a row link
          if (open && pinned.current) return hide();
          pinned.current = true;
          show(0);
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="8" cy="5.1" r="0.9" fill="currentColor" />
          <path d="M8 7.4v4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <span id={descId} hidden>
        {children}
      </span>
      {open &&
        host &&
        createPortal(
          <div
            ref={bubbleRef}
            aria-hidden="true"
            data-side={place?.side ?? side}
            className="infotip"
            style={{ left: place?.x ?? 0, top: place?.y ?? 0, visibility: place ? "visible" : "hidden" }}
            onPointerEnter={(e) => e.pointerType === "mouse" && window.clearTimeout(timer.current)}
            onPointerLeave={(e) => e.pointerType === "mouse" && hideSoon()}
          >
            {children}
          </div>,
          host,
        )}
    </>
  );
}

/** A label followed by its (i), for stats, table headers and summary rows. Without a tip it is just the label. */
export function LabelTip({ label, tip, className = "" }: { label: string; tip?: ReactNode; className?: string }) {
  if (!tip) return <span className={className}>{label}</span>;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap", className)}>
      {label}
      <InfoTip label={label}>{tip}</InfoTip>
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
   Layout
------------------------------------------------------------------------------------------------ */

export function PageHeader({
  title,
  lead,
  aside,
  crumb,
}: {
  title: ReactNode;
  /** One short line under the title. Never a paragraph. */
  lead?: ReactNode;
  aside?: ReactNode;
  /** A breadcrumb line above the title. */
  crumb?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-1 sm:pt-3">
      <div className="min-w-0">
        {crumb && <div className="mb-3 flex items-center gap-2 text-xs text-muted">{crumb}</div>}
        <h1 className="font-display text-[34px] font-light leading-none tracking-[-0.025em] text-ink sm:text-[44px]">{title}</h1>
        {lead && <p className="mt-2.5 max-w-xl text-sm text-muted">{lead}</p>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
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
  tip,
  flush = false,
}: {
  title?: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Kept for older pages: "feature" and "ink" render as a normal card in this design. */
  tone?: "surface" | "ink" | "feature";
  /** A short explanation behind an (i) after the title. */
  tip?: ReactNode;
  /** No inner padding, for a table that runs edge to edge. */
  flush?: boolean;
}) {
  return (
    <section
      data-tone={tone === "surface" ? undefined : tone}
      className={cx(
        "min-w-0 rounded-[18px] border border-line bg-surface shadow-card",
        flush ? "overflow-hidden" : "p-4 sm:p-5",
        className,
      )}
    >
      {(title || action) && (
        <div className={cx("flex flex-wrap items-center justify-between gap-2", flush ? "px-4 pt-4 sm:px-5" : "mb-4")}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {title && (
              <h2 className="text-sm font-semibold tracking-[-0.005em] text-ink">
                <LabelTip label={title} tip={tip} />
              </h2>
            )}
            {badge}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** The quiet text link used in card headers and table bars ("Edit plan", "Repay"). */
export function TextLink({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={cx("text-xs font-semibold text-ink hover:text-brand-ink", className)}>{children}</span>;
}

/* ------------------------------------------------------------------------------------------------
   Badges
------------------------------------------------------------------------------------------------ */

/** Marks anything that is a testnet stand-in, so nothing mocked passes as real. */
export function MockBadge({ children = "Mock" }: { children?: ReactNode }) {
  return <Badge tone="warn">{children}</Badge>;
}

export function RealBadge({ children = "Real" }: { children?: ReactNode }) {
  return <Badge tone="grow">{children}</Badge>;
}

/** A small status label. Sentence case, never all caps. */
export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "brand" | "grow" | "warn" | "danger"; children: ReactNode }) {
  const styles = {
    neutral: "bg-press text-ink-soft",
    brand: "bg-brand-soft text-brand-ink",
    grow: "bg-grow-soft text-grow",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <span className={cx("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[6px] px-[7px] text-[11px] font-semibold", styles)}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
   Figures
------------------------------------------------------------------------------------------------ */

/** "$12,480.32" with the cents in a quieter grey, as in the big figures. */
export function DimCents({ text }: { text: string }) {
  const i = text.lastIndexOf(".");
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-cents">{text.slice(i)}</span>
    </>
  );
}

/** A money figure that counts up to its value the first time it appears and when it changes. */
export function Money({
  value,
  decimals = 2,
  prefix = "$",
  dimCents = false,
}: {
  value: bigint | undefined;
  decimals?: number;
  prefix?: string;
  /** Show the cents in a quieter grey (big figures only). */
  dimCents?: boolean;
}) {
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
  const text = `${prefix}${shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  return <span className="tabular-nums">{dimCents ? <DimCents text={text} /> : text}</span>;
}

/**
 * A labelled figure. `hint` is a visible sub-line (keep it to a few words, for example "Liquidation at
 * 1.00"); `tip` is the explanation behind the (i) after the label.
 */
export function Stat({
  label,
  value,
  hint,
  big = false,
  tip,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  big?: boolean;
  tip?: ReactNode;
  /** Colour of the value: "brand" for the one figure that matters most, "grow" for a healthy loan. */
  tone?: "brand" | "grow" | "warn" | "danger";
}) {
  const color = tone === "brand" ? "text-brand" : tone === "grow" ? "text-grow" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-muted">
        <LabelTip label={label} tip={tip} />
      </div>
      <div
        className={cx(
          "truncate font-display font-normal tabular-nums tracking-[-0.02em]",
          color,
          big ? "mt-2 text-[30px] leading-[1.1] sm:text-[34px]" : "mt-1.5 text-[22px] leading-[1.15] sm:text-2xl",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
   Controls
------------------------------------------------------------------------------------------------ */

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
      className="hit font-semibold text-brand-ink underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
    >
      {children}
    </button>
  );
}

const INPUT_SHELL =
  "flex items-center rounded-xl border border-line bg-popover transition-[border-color,box-shadow] duration-150 focus-within:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_12%,transparent)]";

/** Label row for a form control: the <label> names the control, the (i) sits beside it, outside the label. */
export function FieldLabel({ htmlFor, label, tip, className = "" }: { htmlFor: string; label: string; tip?: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 text-[13px]", className || "text-ink-soft")}>
      <label htmlFor={htmlFor}>{label}</label>
      {tip && <InfoTip label={label}>{tip}</InfoTip>}
    </span>
  );
}

/** Input classes: 16px on phones (no iOS zoom), 14px from the small breakpoint up. */
export const INPUT_TEXT = "text-base sm:text-sm";

export function Field({
  label,
  suffix,
  hint,
  tip,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  suffix?: string;
  /** Visible line under the field: amount feedback and errors only. */
  hint?: ReactNode;
  /** Explanation behind an (i) after the label. */
  tip?: ReactNode;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  return (
    <div className="block min-w-0">
      <FieldLabel htmlFor={inputId} label={label} tip={tip} />
      <span className={cx("mt-1.5", INPUT_SHELL)}>
        <input
          {...props}
          id={inputId}
          aria-describedby={hint ? hintId : props["aria-describedby"]}
          className={cx("min-h-[42px] w-full min-w-0 rounded-xl bg-transparent px-3.5 tabular-nums text-ink outline-none placeholder:text-faint", INPUT_TEXT)}
        />
        {suffix && <span className="whitespace-nowrap pr-3.5 text-[13px] text-muted">{suffix}</span>}
      </span>
      {hint && (
        <span id={hintId} className="mt-1.5 block text-xs leading-relaxed text-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  tip,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  tip?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="block min-w-0">
      <FieldLabel htmlFor={id} label={label} tip={tip} />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          "mt-1.5 min-h-11 w-full min-w-0 truncate rounded-xl border border-line bg-popover pl-3 pr-8 text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_12%,transparent)]",
          INPUT_TEXT,
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
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
      {label && <span className="mb-1.5 block text-[13px] text-ink-soft">{label}</span>}
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? label}
        className="relative grid rounded-[11px] bg-press p-[3px]"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className="absolute inset-y-[3px] rounded-[8px] bg-popover shadow-[0_1px_2px_rgb(16_24_40/0.08),0_0_0_0.5px_var(--line)] transition-transform duration-[250ms] ease-[var(--ease-out)]"
          style={{
            width: `calc((100% - 6px) / ${options.length})`,
            left: "3px",
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
              "relative z-10 min-h-11 rounded-[8px] text-[13px] font-medium transition-colors duration-200 sm:min-h-[34px]",
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

/** Pill tabs like the top navigation: the active one is a card-coloured pill with a hairline. */
export function PillTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "min-h-11 rounded-[10px] border px-3.5 text-[13px] transition-colors duration-150 sm:min-h-9",
            o.value === value ? "border-line bg-popover text-ink shadow-pill" : "border-transparent text-ink-soft hover:bg-hover",
          )}
        >
          {o.label}
        </button>
      ))}
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
        "inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] sm:min-h-9",
        active ? "border-[color-mix(in_srgb,var(--brand)_45%,transparent)] bg-brand-soft text-brand-ink" : "border-line bg-popover text-ink hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------------------------------------
   Asset logos: one circle system. White logo on the brand colour, a 1px inner ring, no gradients or
   shadows. Letters on a neutral disc where there is no logo we may use.
------------------------------------------------------------------------------------------------ */

const LOGO_SIZES = [16, 20, 24, 32, 40] as const;
const snap = (n: number) => LOGO_SIZES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 32);
const GLYPH = (s: number) => (s <= 16 ? 0.62 : s <= 20 ? 0.6 : s <= 24 ? 0.58 : s <= 32 ? 0.56 : 0.54);
const MARK_FONT: Record<number, number> = { 16: 7, 20: 8, 24: 9, 32: 11, 40: 14 };

export function AssetIcon({ asset, icon, size = 32 }: { asset?: Asset; icon?: string; size?: number }) {
  const key = icon ?? asset?.icon ?? "";
  const px = snap(size);
  const path = LOGO_MODE === "brand" ? ASSET_LOGOS[key] : undefined;
  const disc = ASSET_DISC[key] ?? { style: "mark" as const, mark: (asset?.name ?? key).slice(0, 1).toUpperCase() };
  const style = path ? disc.style : "mark";
  const ring = "inset 0 0 0 1px var(--logo-ring)";

  if (style === "coin" && path)
    return (
      <svg aria-hidden viewBox="0 0 24 24" width={px} height={px} className="shrink-0" style={{ color: "#F7931A" }}>
        <path d={path} fill="currentColor" />
      </svg>
    );

  const bg = style === "brand" ? disc.bg : style === "mono" ? "var(--logo-mono-bg)" : "var(--mark-bg)";
  const fg = style === "brand" ? "#ffffff" : style === "mono" ? "var(--logo-mono-fg)" : "var(--mark-fg)";
  const mark = disc.mark ?? key.slice(0, 1);
  const letters = px <= 16 ? mark.slice(0, mark.length > 2 ? 1 : 2) : mark;
  const g = Math.round(px * (disc.scale ?? GLYPH(px)));
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full"
      style={{ width: px, height: px, background: bg, color: fg, boxShadow: ring }}
    >
      {style !== "mark" && path ? (
        <svg viewBox="0 0 24 24" width={g} height={g} fill="currentColor">
          <path d={path} />
        </svg>
      ) : (
        <span
          className="font-sans"
          style={{
            fontSize: letters.length > 2 ? Math.round(MARK_FONT[px] * 0.8) : MARK_FONT[px],
            fontWeight: 650,
            letterSpacing: "-0.01em",
            lineHeight: 1,
          }}
        >
          {letters}
        </span>
      )}
    </span>
  );
}

/** Overlapping logos for "borrowed against Apple and Bitcoin". Largest first, at most three, then "+N". */
export function AssetStack({ assets, size = 20 }: { assets: Asset[]; size?: 16 | 20 | 24 | 32 }) {
  const overlap = size >= 32 ? 10 : size >= 24 ? 8 : 6;
  const shown = assets.slice(0, 3);
  const extra = assets.length - shown.length;
  return (
    <span className="inline-flex items-center" role="img" aria-label={assets.map((a) => a.name).join(", ")}>
      {shown.map((a, i) => (
        <span
          key={a.symbol}
          className="inline-flex rounded-full"
          style={{ marginLeft: i === 0 ? 0 : -overlap, boxShadow: i === 0 ? undefined : "0 0 0 2px var(--surface)" }}
        >
          <AssetIcon asset={a} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="inline-grid place-items-center rounded-full bg-mark text-[9px] font-semibold text-mark-fg"
          style={{ width: size, height: size, marginLeft: -overlap, boxShadow: "0 0 0 2px var(--surface), inset 0 0 0 1px var(--logo-ring)" }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------------------------------------
   Bars and meters
------------------------------------------------------------------------------------------------ */

/** Stacked bar showing how a total splits across parts. */
export function SplitBar({ parts, height = 8 }: { parts: { key: string; value: number; color: string; label?: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div
      className="flex w-full gap-[3px] overflow-hidden rounded-[3px]"
      style={{ height }}
      role="img"
      aria-label={parts
        .filter((p) => p.value > 0 && p.label)
        .map((p) => `${p.label} ${total > 0 ? Math.round((p.value / total) * 100) : 0}%`)
        .join(", ") || "Split"}
    >
      {total > 0 ? (
        parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.key}
              className="h-full rounded-[3px] transition-[width] duration-500 ease-[var(--ease-out-quint)]"
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            />
          ))
      ) : (
        <span className="h-full w-full rounded-[3px] bg-press" />
      )}
    </div>
  );
}

/** Greyscale ramp for split bars, so the bar stays calm next to the coloured logos. */
export const SPLIT_COLORS = ["var(--split-1)", "var(--split-2)", "var(--split-3)", "var(--split-4)"];
/** Colour for part `i`. With `n` parts above four, the ramp blends evenly from darkest to lightest. */
export const splitColor = (i: number, n?: number) =>
  n && n > SPLIT_COLORS.length
    ? `color-mix(in srgb, var(--split-1) ${Math.round(100 - (i / (n - 1)) * 100)}%, var(--split-4))`
    : SPLIT_COLORS[Math.min(i, SPLIT_COLORS.length - 1)];

const H_MIN = 0.8;
const H_MAX = 3;
const hPos = (h: number) => Math.max(0, Math.min(100, ((h - H_MIN) / (H_MAX - H_MIN)) * 100));

/** Loan health on a gauge: red zone up to 1.00, amber to 1.25, green fill up to the current value. */
export function HealthMeter({ health, compact = false }: { health: number | undefined; compact?: boolean }) {
  const has = health !== undefined && isFinite(health);
  const pct = has ? Math.max(2, hPos(health!)) : 0;
  const fill = !has ? "bg-press" : health! < 1 ? "bg-danger" : health! < 1.25 ? "bg-warn" : "bg-grow";
  const label = !has ? "No loan" : health! < 1 ? "Can be liquidated" : health! < 1.25 ? "Close to liquidation" : "Healthy";
  const liq = hPos(1);
  const warn = hPos(1.25);
  return (
    <div>
      <div
        className="relative h-1.5 rounded-full bg-press"
        role="meter"
        aria-label="Loan health"
        aria-valuemin={H_MIN}
        aria-valuemax={H_MAX}
        aria-valuenow={has ? Math.min(health!, H_MAX) : undefined}
        aria-valuetext={has ? `${health!.toFixed(2)}, ${label}` : "No loan"}
      >
        <span className="absolute inset-y-0 left-0 rounded-l-full bg-zone-danger" style={{ width: `${liq}%` }} />
        <span className="absolute inset-y-0 bg-zone-warn" style={{ left: `${liq}%`, width: `${warn - liq}%` }} />
        {has && (
          <span
            className={cx("absolute inset-y-0 rounded-full opacity-90 transition-[width,background-color] duration-700 ease-[var(--ease-out-quint)]", fill)}
            style={{ left: `${warn}%`, width: `${Math.max(0, pct - warn)}%` }}
          />
        )}
        <span className="absolute -top-1 h-3.5 w-0.5 rounded-[1px] bg-danger" style={{ left: `${liq}%` }} />
        {has && <span className="absolute -top-[5px] h-4 w-0.5 rounded-[1px] bg-ink" style={{ left: `calc(${pct}% - 1px)` }} />}
      </div>
      {!compact && (
        <div className="mt-2 flex justify-between text-[11.5px] text-muted">
          <span>Liquidation 1.00</span>
          <span>
            {has && <span className="tabular-nums">Health {health!.toFixed(2)} · </span>}
            <span className={cx(!has ? "" : health! < 1 ? "text-danger" : health! < 1.25 ? "text-warn" : "text-grow")}>{label}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
   Status
------------------------------------------------------------------------------------------------ */

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
      <p className="mt-3 flex animate-[var(--animate-pop)] items-center gap-2 rounded-xl bg-brand-soft px-3.5 py-2.5 text-[13px] text-brand-ink" role="status">
        <Spinner /> {state.step}. Confirm in your wallet.
      </p>
    );
  if (state.error)
    return (
      <p className="mt-3 animate-[var(--animate-pop)] break-words rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger" role="alert">
        {state.error}
      </p>
    );
  if (state.done)
    return (
      <p className="mt-3 animate-[var(--animate-pop)] rounded-xl bg-grow-soft px-3.5 py-2.5 text-[13px] text-grow" role="status">
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
  return <div className={cx("rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed", styles)}>{children}</div>;
}

/** The loan risk line. Always visible wherever someone can borrow. */
export function RiskNote({ compact = false }: { compact?: boolean }) {
  if (compact)
    return (
      <p className="text-center text-[11.5px] leading-relaxed text-muted">
        If prices fall far, part of your collateral can be sold to repay your loan. Not investment advice.
      </p>
    );
  return (
    <p className="text-xs leading-relaxed text-muted">
      <span className="font-medium text-warn">Liquidation risk:</span> if prices fall far enough, part of your collateral can be sold to repay
      your loan. Not investment advice. <LearnMore href="/docs#borrowing">How borrowing works</LearnMore>
    </p>
  );
}

export function Row({ label, children, tip }: { label: ReactNode; children: ReactNode; tip?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 border-b border-line-soft py-2 text-[13px] last:border-0">
      <span className="shrink-0 text-muted">{typeof label === "string" ? <LabelTip label={label} tip={tip} /> : label}</span>
      <span className="min-w-0 break-words text-right tabular-nums text-ink">{children}</span>
    </div>
  );
}

/** "from → to" for the before and after summary of an action. */
export function BeforeAfter({ from, to, tone }: { from: ReactNode; to?: ReactNode; tone?: "grow" | "warn" | "danger" | "brand" }) {
  if (to === undefined) return <span className="tabular-nums">{from}</span>;
  const color = tone === "grow" ? "text-grow" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "brand" ? "text-brand-ink" : "text-ink";
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="text-muted">{from}</span>
      <span className="text-xs text-faint" aria-label="to">
        →
      </span>
      <span className={cx("font-semibold", color)}>{to}</span>
    </span>
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
  return <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">{children}</div>;
}

/** A grey placeholder in the shape of the content that is loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton block", className)} />;
}
