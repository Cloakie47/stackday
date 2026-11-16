import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./styles";

/**
 * A small link to the matching section of the docs page, for example /docs#borrowing.
 * The UI keeps only what someone needs to act; longer explanations live in /docs.
 */
export function LearnMore({ href, children = "Learn more", className = "" }: { href: string; children?: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "whitespace-nowrap font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 transition-colors hover:decoration-brand-ink",
        className,
      )}
    >
      {children}
    </Link>
  );
}
