/**
 * The full guide is a static site in public/guide, built from docs-site/ (node docs-site/build.mjs).
 * It replaced the old /docs page. Links to it are plain <a> links, not next/link, because it is a
 * static file and not a Next.js route. Old /docs#section names map to the guide's pages here.
 */
export const GUIDE = "/guide/index.html";

const SECTIONS: Record<string, string> = {
  what: "intro",
  "how-it-works": "intro",
  who: "intro",
  vault: "vault",
  themes: "invest-themes",
  borrowing: "borrow",
  "private-pay": "private-pay",
  testnet: "security",
  contracts: "contracts",
  security: "security",
  notices: "security",
  faq: "faq",
  links: "faq",
  demo: "getting-started-testnet-tools",
  employees: "payday",
  individuals: "invest",
};

/** The guide's address for an old /docs section name (or a guide page id), or the guide's start. */
export function guideHref(section?: string): string {
  if (!section) return GUIDE;
  return `${GUIDE}#${SECTIONS[section] ?? section}`;
}

/** Turns an old "/docs" or "/docs#section" link into the guide's address; other links are returned as they are. */
export function fromDocsHref(href: string): string {
  if (href !== "/docs" && !href.startsWith("/docs#")) return href;
  const hash = href.split("#")[1];
  return guideHref(hash);
}
