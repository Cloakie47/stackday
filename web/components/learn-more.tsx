import Link from "next/link";
import type { ReactNode } from "react";
import { fromDocsHref } from "@/lib/guide";
import { cx } from "./styles";

/**
 * A small link to the matching section of the guide, for example /docs#borrowing.
 * The UI keeps only what someone needs to act; longer explanations live in the guide
 * (public/guide). Old /docs links are mapped to the guide and use a plain <a>, because
 * the guide is a static file, not a Next.js route.
 */
export function LearnMore({ href, children = "Learn more", className = "" }: { href: string; children?: ReactNode; className?: string }) {
  const classes = cx(
    "whitespace-nowrap font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 transition-colors hover:decoration-brand-ink",
    className,
  );
  const target = fromDocsHref(href);
  if (target !== href) {
    return (
      <a href={target} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
