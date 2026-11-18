/** Class-name helpers. No "use client", so both server and client components can use them. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "ink" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** Classes for anything that should look like a button, including links (<Link className={buttonClass()}>). */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  const styles = {
    primary: "border border-transparent bg-brand text-white hover:bg-brand-strong disabled:border-line disabled:bg-sunken disabled:text-muted",
    ink: "border border-transparent bg-ink text-canvas hover:opacity-90 disabled:border-line disabled:bg-sunken disabled:text-muted disabled:opacity-100",
    secondary:
      "border border-line bg-popover text-ink shadow-pill hover:bg-[color-mix(in_srgb,var(--popover),var(--ink)_4%)] disabled:text-muted disabled:hover:bg-popover",
    ghost: "text-ink hover:bg-hover disabled:text-muted",
    danger: "border border-danger/30 bg-popover text-danger hover:bg-danger-soft disabled:border-line disabled:text-muted",
  }[variant];
  // Phones get 44px targets; desktop keeps the slimmer 36 and 40px controls of the design.
  const sizes = {
    sm: "min-h-11 sm:min-h-9 rounded-[9px] px-3.5 text-[13px]",
    md: "min-h-11 rounded-[10px] px-4 text-[13px]",
    lg: "min-h-12 rounded-[10px] px-5 text-sm",
  }[size];
  return cx(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100",
    styles,
    sizes,
    className,
  );
}
