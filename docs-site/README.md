# Stackday docs site

A standalone static documentation site for Stackday: every feature explained in plain words first, then in depth, with flow diagrams. Plain HTML, CSS and a little JavaScript. No dependencies, no build tools beyond Node, and nothing shared with the web app in `web/`.

## View it

Open `docs-site/index.html` in a browser. It works straight from the file, or from any static server:

    python -m http.server 4377 --directory docs-site

Then open http://localhost:4377.

## Change it

The pages live in `docs-site/src/pages/`, one file per page, in sidebar order by file name. Each file is one `<article class="page">` with an `id`, a `data-title` and a `data-section` (the sidebar group). After editing, rebuild:

    node docs-site/build.mjs

That writes `docs-site/index.html`. Commit both the page source and the rebuilt `index.html`.

What the build does:

- Puts the pages into one page with the sidebar, search, "On this page" and the theme toggle.
- Fills the address, market, asset and fee tables from `deployments/base-sepolia.json` (read only), so they always match the official testnet deployment. Placeholders look like `<!--@markets-->`.
- Fails if any page contains an em dash or an en dash.
- Writes CRLF line endings.

`node docs-site/build.mjs --fragment <folder>` also writes a body-only copy plus the assets into that folder, for hosts that add their own document skeleton.

## How it is put together

- `assets/site.css`: the theme (light and dark tokens, Base-inspired blue accent) and layout.
- `assets/site.js`: hash routing (one page shown at a time, `#borrow` and heading links such as `#borrow-the-emergency-rule`), the "On this page" list, search over page titles and headings (press `/` or Ctrl+K), the mobile menu and the theme toggle.
- Diagrams are inline SVG drawn with theme colours, so they work in both themes and need no library. On phones they scroll sideways instead of shrinking.

## Writing rules

- Each feature page starts with an "In plain words" box (`{{PLAIN}}`), then "How it works", a diagram, then edge cases and limits.
- Use the repository's own status words. Label anything mocked, testnet only or not built.
- No em dashes. Testnet only. This is not an official Base or Coinbase site; do not use their logos.
