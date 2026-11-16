/** Class-name helpers. No "use client", so both server and client components can use them. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "ink" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** Classes for anything that should look like a button, including links (<Link className={buttonClass()}>). */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  const styles = {
    primary:
      "bg-brand text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] hover:bg-brand-strong disabled:bg-sunken disabled:text-muted disabled:shadow-none",
    ink: "bg-ink text-canvas hover:bg-ink-soft disabled:bg-sunken disabled:text-muted",
    secondary:
      "border border-line-strong bg-surface text-ink shadow-xs hover:bg-sunken disabled:text-muted disabled:hover:bg-surface",
    ghost: "text-ink hover:bg-sunken disabled:text-muted",
    danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft disabled:border-line disabled:text-muted",
  }[variant];
  const sizes = { sm: "min-h-9 px-3.5 text-[13px]", md: "min-h-11 px-5 text-sm", lg: "min-h-12 px-6 text-[15px]" }[size];
  return cx(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100",
    styles,
    sizes,
    className,
  );
}
