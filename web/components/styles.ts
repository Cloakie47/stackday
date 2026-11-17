/** Class-name helpers. No "use client", so both server and client components can use them. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "ink" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** Classes for anything that should look like a button, including links (<Link className={buttonClass()}>). */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") {
  const styles = {
    primary: "key key-primary disabled:bg-sunken disabled:text-muted disabled:[text-shadow:none]",
    ink: "key key-ink disabled:bg-sunken disabled:text-muted",
    secondary: "key key-surface text-ink disabled:text-muted",
    ghost: "key key-ghost text-ink hover:bg-sunken disabled:text-muted",
    danger: "key key-surface key-danger text-danger hover:text-danger disabled:text-muted",
  }[variant];
  const sizes = { sm: "min-h-9 px-3.5 text-[13px]", md: "min-h-11 px-5 text-sm", lg: "min-h-12 px-6 text-[15px]" }[size];
  return cx(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold disabled:cursor-not-allowed",
    styles,
    sizes,
    className,
  );
}
