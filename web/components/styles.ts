/** Class-name helpers. No "use client", so both server and client components can use them. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "ink" | "secondary" | "soft" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Classes for anything that should look like a button, including links (<Link className={buttonClass()}>).
 * Heights 32 / 40 / 48 (44 minimum on touch screens), 8px radius on small, 10px otherwise.
 */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  const styles = {
    primary: "key key-primary",
    ink: "key key-ink",
    secondary: "key key-surface text-ink",
    soft: "key key-soft text-ink",
    ghost: "key key-ghost text-ink-soft hover:text-ink",
    danger: "key key-surface key-danger text-danger",
  }[variant];
  const sizes = {
    sm: "min-h-8 rounded-lg px-3 text-[13px] font-medium pointer-coarse:min-h-11",
    md: "min-h-10 rounded-xl px-4 text-sm font-medium pointer-coarse:min-h-11",
    lg: "min-h-12 rounded-xl px-5 text-[15px] font-semibold",
  }[size];
  return cx(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap disabled:cursor-not-allowed",
    styles,
    sizes,
    className,
  );
}
