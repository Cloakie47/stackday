// Builds the Stackday docs site from src/pages/*.html into one static index.html.
//
//   node docs-site/build.mjs                     writes docs-site/index.html and the copy the web app
//                                                serves at /guide (web/public/guide)
//   node docs-site/build.mjs --fragment <dir>     also writes a body-only copy (no doctype, html,
//                                                head or body tags) plus assets into <dir>, for
//                                                hosts that add their own document skeleton
//
// No dependencies. Contract addresses are read from deployments/base-sepolia.json (read only) so
// the tables never drift from the official testnet deployment. The build fails on em or en dashes.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const pagesDir = join(here, "src", "pages");
const deployment = JSON.parse(readFileSync(join(repo, "deployments", "base-sepolia.json"), "utf8"));

const REPO_URL = "https://github.com/Cloakie47/stackday";
const APP_URL = "https://stackday-rho.vercel.app";
const SCAN = "https://sepolia.basescan.org/address/";

// ---------- Generated tables ----------
const ASSET_INFO = {
  mAAPL: ["Apple", "AAPLc", "Stock"],
  mNVDA: ["NVIDIA", "NVDAc", "Stock"],
  mGOOGL: ["Alphabet", "GOOGLc", "Stock"],
  mMETA: ["Meta", "METAc", "Stock"],
  mSPCX: ["SpaceX (mock price only)", "SPCXc", "Stock"],
  mTSLA: ["Tesla", "TSLAc", "Stock"],
  mAMZN: ["Amazon", "AMZNc", "Stock"],
  mMSFT: ["Microsoft", "MSFTc", "Stock"],
  mMSTR: ["Strategy", "MSTRc", "Stock"],
  mAMD: ["AMD", "AMDc", "Stock"],
  mSPX: ["S&amp;P 500 fund token", "deSPXA", "Fund"],
  mSGOV: ["0 to 3 month US Treasuries", "wtSGOV", "Fund"],
  mcbBTC: ["Bitcoin", "cbBTC", "Crypto"],
  mWETH: ["Ether", "WETH", "Crypto"],
  mPAXG: ["Gold", "PAXG", "Gold"],
};
const ZERO = "0x0000000000000000000000000000000000000000";
const addr = (a) => `<a class="addr" href="${SCAN}${a}" rel="noopener" target="_blank">${a}</a>`;
const pct = (wad) => `${(Number(BigInt(wad) / 10n ** 13n) / 1000).toString()}%`;
const table = (head, rows, numCols = []) =>
  `<div class="table-wrap"><table><thead><tr>${head
    .map((h, i) => `<th${numCols.includes(i) ? ' class="num"' : ""}>${h}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td${numCols.includes(i) ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

const symbols = deployment.assetSymbols;
const borrowable = symbols.filter((s) => deployment[`${s}LendingAdapter`] && deployment[`${s}LendingAdapter`] !== ZERO);
const investOnly = symbols.filter((s) => !borrowable.includes(s));

const generated = {
  assets: table(
    ["Test token", "Stands in for", "Kind", "Can borrow against", "Liquidation limit"],
    symbols.map((s) => {
      const [name, real, kind] = ASSET_INFO[s] || [s, "", ""];
      const b = borrowable.includes(s);
      return [
        `<code>${s}</code>`,
        `${name} (${real})`,
        kind,
        b ? '<span class="pill live">Yes</span>' : '<span class="pill plan">Invest only</span>',
        b ? pct(deployment[`${s}Lltv`]) : "None",
      ];
    }),
    [4]
  ),
  core: table(
    ["Contract", "What it does", "Address"],
    [
      ["Payroll", "Employer treasuries, paydays, claims, payday plans, emergency rule", addr(deployment.payroll)],
      ["SipRouter", "One-time and recurring buys from your own wallet", addr(deployment.sipRouter)],
      ["GiftBox", "Gift boxes: holds USDC until opened, then buys into the recipient's vault", addr(deployment.giftBox)],
      ["VaultFactory", "Creates one vault per person; holds the fixed fee settings", addr(deployment.vaultFactory)],
      ["EmployeeVault (implementation)", "The code every personal vault runs", addr(deployment.vaultImplementation)],
      ["Price adapter", "Reads the price feeds for each asset", addr(deployment.priceAdapter)],
      ["Interest adapter (ERC-4626)", "Puts idle vault USDC into an interest vault", addr(deployment.yieldAdapter)],
    ]
  ),
  external: table(
    ["Protocol or token", "Address"],
    [
      ["Morpho (real, the lending protocol)", addr(deployment.morpho)],
      ["Morpho interest rate model (real)", addr(deployment.morphoIrm)],
      ["USDC (Circle test USDC, real)", addr(deployment.usdc)],
    ]
  ),
  markets: table(
    ["Market", "Liquidation limit", "Lending adapter", "Morpho market id"],
    borrowable.map((s) => [
      `${s} / USDC`,
      pct(deployment[`${s}Lltv`]),
      addr(deployment[`${s}LendingAdapter`]),
      `<span class="addr">${deployment[`${s}MarketId`]}</span>`,
    ]),
    [1]
  ),
  mocks: table(
    ["Mock (testnet only)", "Address"],
    [
      ...symbols.map((s) => [`${s} token`, addr(deployment[s])]),
      ...symbols.map((s) => [`${s} price feed`, addr(deployment[`${s}Feed`])]),
      ["Mock exchange (swap adapter)", addr(deployment.mockSwapAdapter)],
      ["Mock sell desk", addr(deployment.mockSellDesk)],
      ["Mock interest vault", addr(deployment.mockYieldVault)],
    ]
  ),
  fees: table(
    ["Setting", "Value on the testnet deployment"],
    [
      ["Recurring buy fee (sipFeeBps)", `${deployment.sipFeeBps} bps = ${deployment.sipFeeBps / 100}%`],
      ["Borrow fee (borrowFeeBps)", `${deployment.borrowFeeBps} bps = ${deployment.borrowFeeBps / 100}% a year`],
      ["Earn fee (earnFeeBps)", `${deployment.earnFeeBps} bps = ${deployment.earnFeeBps / 100}% a year`],
      ["Fee wallet", addr(deployment.feeRecipient)],
      ["Shortest payroll rhythm (minScheduleInterval)", `${deployment.minScheduleInterval} seconds`],
      ["Chain id", `${deployment.chainId} (Base Sepolia)`],
    ]
  ),
  counts: `${symbols.length} assets, ${borrowable.length} of them can be borrowed against`,
  borrowableList: borrowable.join(", "),
  investOnlyList: investOnly.join(", "),
};

// Repeated bits of page markup, written once here.
const snippets = {
  PLAIN:
    '<p class="plain-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z"/></svg>In plain words</p>',
  INFO:
    '<svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  WARN:
    '<svg class="note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.5"/></svg>',
};

// ---------- Pages ----------
const files = readdirSync(pagesDir).filter((f) => f.endsWith(".html")).sort();
const pages = files.map((f) => {
  let html = readFileSync(join(pagesDir, f), "utf8").replace(/\r\n/g, "\n");
  html = html.replace(/<!--@(\w+)-->/g, (m, key) => {
    if (!(key in generated)) throw new Error(`${f}: unknown placeholder ${m}`);
    return generated[key];
  });
  html = html.replace(/\{\{REPO\}\}/g, REPO_URL); // {{APP}} is filled per output below
  html = html.replace(/\{\{(PLAIN|INFO|WARN)\}\}/g, (m, k) => snippets[k]);
  const open = html.match(/<article\b[^>]*>/);
  if (!open) throw new Error(`${f}: no <article>`);
  const attr = (n) => (open[0].match(new RegExp(`${n}="([^"]*)"`)) || [])[1];
  const id = attr("id"), title = attr("data-title"), section = attr("data-section");
  if (!id || !title || !section) throw new Error(`${f}: article needs id, data-title and data-section`);
  return { file: f, id, title, section, html: html.trim() };
});

const sections = [];
for (const p of pages) {
  let s = sections.find((x) => x.name === p.section);
  if (!s) sections.push((s = { name: p.section, pages: [] }));
  s.pages.push(p);
}
const nav = sections
  .map(
    (s) =>
      `<div class="nav-group"><p class="nav-title">${s.name}</p><ul class="nav-list">${s.pages
        .map((p) => `<li><a class="nav-link" href="#${p.id}">${p.title}</a></li>`)
        .join("")}</ul></div>`
  )
  .join("\n");

const icon = {
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  sun: '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg>',
};
const mark =
  '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="19" fill="#0052ff"/><g transform="translate(12.16 12.16) scale(1.6533)" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"><path d="M5 17h14M7 12h10M9 7h6"/></g></svg>';

// Shared arrowheads for every diagram. Kept in an always-rendered SVG so diagrams on hidden pages
// still find them.
const defs = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-head" d="M0 0L10 5L0 10z"/></marker>
<marker id="ah-acc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-head acc" d="M0 0L10 5L0 10z"/></marker>
<marker id="ah-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-head bad" d="M0 0L10 5L0 10z"/></marker>
<marker id="ah-good" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="d-head good" d="M0 0L10 5L0 10z"/></marker>
</defs></svg>`;

const fonts =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&family=Hanken+Grotesk:wght@500;600&family=Inter:wght@400;500;600&display=swap">';

const body = `<a class="skip-link" href="#main">Skip to content</a>
${defs}
<header class="topbar">
  <button class="icon-btn menu-btn" id="menu-btn" type="button" aria-label="Open the page menu" aria-expanded="false" aria-controls="sidebar">${icon.menu}</button>
  <a class="brand" href="#${pages[0].id}" aria-label="Stackday docs home">${mark}<span class="brand-name">Stackday</span><span class="brand-tag">Docs</span></a>
  <button class="search-trigger" id="search-btn" type="button" aria-label="Search the docs">${icon.search}<span>Search the docs</span><span class="kbd">/</span></button>
  <div class="top-actions">
    <span class="net-badge" title="Everything here runs on the Base Sepolia test network">Base Sepolia testnet</span>
    <a class="icon-btn gh-link" href="${REPO_URL}" rel="noopener" target="_blank" aria-label="Source code on GitHub" title="Source code on GitHub">${icon.code}</a>
    <button class="icon-btn theme-btn" id="theme-btn" type="button" aria-label="Switch theme">${icon.sun}${icon.moon}</button>
    <a class="app-link" href="{{APP}}/dashboard">Open app</a>
  </div>
</header>
<div class="layout">
  <nav class="sidebar" id="sidebar" aria-label="Docs pages">
${nav}
  </nav>
  <main class="content" id="main" tabindex="-1">
${pages.map((p) => p.html).join("\n\n")}
    <footer class="site-foot">
      <p>Stackday is an independent project built on Base for the Base Stocks Maxxing hackathon. It is not an official Base or Coinbase site, and it runs on the Base Sepolia test network only.</p>
      <p>Nothing here is investment advice. There has been no independent security audit. Tokenized stocks are meant for eligible people outside the United States.</p>
    </footer>
  </main>
  <aside class="toc" aria-label="On this page">
    <p class="toc-title">On this page</p>
    <ol id="toc-list"></ol>
  </aside>
</div>`;

// Cache-busting version for the stylesheet and script, from their contents.
const ver = createHash("sha256")
  .update(readFileSync(join(here, "assets", "site.css")))
  .update(readFileSync(join(here, "assets", "site.js")))
  .digest("hex")
  .slice(0, 10);

const title = "Stackday Docs";
const description = "How Stackday works, in plain words first and then in depth: payday investing, your own vault, borrowing instead of selling, research, gift boxes and the chat assistant, on Base Sepolia.";

// A full document. `base` is where the assets live, `app` the app's address ("" when the guide is
// served by the app itself), `withFonts` whether to load Google Fonts (the app's security headers
// allow fonts from its own origin only, so its copy uses the fallback fonts).
const page = ({ base, app, withFonts, cacheBust }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
${withFonts ? fonts : ""}
<link rel="stylesheet" href="${base}site.css${cacheBust}">
</head>
<body>
${body.replace(/\{\{APP\}\}/g, app)}
<script src="${base}site.js${cacheBust}"></script>
</body>
</html>
`;
const full = page({ base: "assets/", app: APP_URL, withFonts: true, cacheBust: `?v=${ver}` });
const inApp = page({ base: "/guide/assets/", app: "", withFonts: false, cacheBust: `?v=${ver}` });

const fragment = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<link rel="stylesheet" href="assets/site.css">
${body.replace(/\{\{APP\}\}/g, APP_URL)}
<script src="assets/site.js"></script>
`;

// ---------- Checks ----------
const banned = [new RegExp("\u2014"), new RegExp("\u2013"), new RegExp("&" + "mdash;"), new RegExp("&" + "ndash;")];
const toCheck = [["index.html", full], ["web/public/guide/index.html", inApp], ...["site.css", "site.js"].map((f) => [f, readFileSync(join(here, "assets", f), "utf8")])];
for (const [name, text] of toCheck) {
  for (const re of banned) {
    const m = text.match(re);
    if (m) {
      const at = text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ");
      throw new Error(`${name}: em or en dash found near "${at}"`);
    }
  }
}
const ids = new Set();
for (const p of pages) {
  if (ids.has(p.id)) throw new Error(`duplicate page id ${p.id}`);
  if (/^(settings|sidebar|customize|upgrade|downloads|comment-)/.test(p.id)) throw new Error(`reserved page id ${p.id}`);
  ids.add(p.id);
}

const crlf = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
writeFileSync(join(here, "index.html"), crlf(full));

// The copy the web app serves at /guide (web/public/guide), so the guide ships with the site.
const pub = join(repo, "web", "public", "guide");
mkdirSync(join(pub, "assets"), { recursive: true });
writeFileSync(join(pub, "index.html"), crlf(inApp));
for (const f of ["site.css", "site.js", "favicon.svg"]) copyFileSync(join(here, "assets", f), join(pub, "assets", f));
console.log(`docs-site/index.html: ${pages.length} pages, ${(full.length / 1024).toFixed(0)} KB, ${generated.counts}`);

const fi = process.argv.indexOf("--fragment");
if (fi > 0) {
  const out = process.argv[fi + 1];
  mkdirSync(join(out, "assets"), { recursive: true });
  writeFileSync(join(out, "index.html"), fragment);
  for (const f of ["site.css", "site.js", "favicon.svg"]) copyFileSync(join(here, "assets", f), join(out, "assets", f));
  console.log(`fragment written to ${out}`);
}
