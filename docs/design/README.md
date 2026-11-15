# Design system

How the web app looks, and how to keep new screens consistent. The tokens themselves live in `web/app/globals.css`.

## Direction

Base-native: crisp Base blue on cool, clean surfaces, generous whitespace, confident type, subtle depth, light and dark themes, phone first. One memorable element per page (the deep blue "feature" panel for the main number), everything around it quiet.

No Coinbase or Base logos, nothing that implies endorsement. A plain "Built on Base" text line is fine.

## Name

The product name is in `web/lib/brand.ts` (`BRAND.name`). Use it instead of typing the name, so a rename is one line.

## Colour

Use the role, never a hex value. Every role flips between light and dark.

| Role | Use for |
|---|---|
| `canvas` | Page background |
| `surface` | Cards, inputs, sheets |
| `sunken` | Wells, tracks, segmented controls |
| `ink`, `ink-soft`, `muted` | Text, from strongest to weakest. `muted` passes AA |
| `line`, `line-strong` | Dividers; input borders |
| `brand` | Primary buttons and brand fills only. White text on it |
| `brand-strong` | Hover on brand fills |
| `brand-soft` + `brand-ink` | Selected states, info notices, and blue text such as links |
| `grow`, `warn`, `danger` (+ `-soft`) | Status. Text colour on its own soft background |

`brand-dark` is an older name for `brand-ink`, kept so existing pages compile. Prefer `text-brand-ink` for links over `text-brand` (brand is too dark to read as text in dark mode).

## Type

- Display: **Funnel Display**, `font-display font-semibold`, tight tracking. Page titles, section titles, big money figures.
- UI: **Geist** (`font-sans`). Labels are sentence case, never all caps.
- Data: **Geist Mono** (`font-mono`) for addresses and hashes only.
- Numbers that line up use `tabular-nums`.

## Shape, depth, motion

- Radius: full pill for controls, 16px (`rounded-2xl`) for inputs and notices, 24px (`rounded-3xl`) for cards, 32px for hero panels.
- Shadows: `shadow-xs` on resting cards, `shadow-md`/`shadow-lg` for things that float. Cards rely on a hairline border first.
- Motion: `--ease-out` for anything entering or responding, under 300 ms. Buttons scale to 0.97 on press. Never `transition: all`. Reduced motion turns movement off.

## Components (`web/components/ui.tsx`)

`PageHeader`, `Card` (`tone="feature"` for the one hero panel; `"ink"` is an alias), `Badge`, `MockBadge`, `RealBadge`, `Money`, `Stat`, `Button` and `buttonClass()` (for links that look like buttons), `Field`, `Select`, `Segmented`, `Chip`, `AssetIcon`, `SplitBar`, `HealthMeter`, `Spinner`, `TxStatus`, `Notice`, `RiskNote`, `Row`, `AddressLink`, `Empty`, `Skeleton`.

Theme: `ThemeToggle` and `useTheme` in `web/components/theme.tsx`. Layout: `Shell`, `Logo`, `LogoMark`, `WalletButton`, `TestnetBanner` in `web/components/shell.tsx`.

## Accessibility floor

Visible focus ring in both themes, skip link, labelled icon buttons, native `<dialog>` for sheets (focus trap and Escape), 16px inputs on phones (no zoom), safe-area padding, tap targets at least 36px (44px for primary actions).
