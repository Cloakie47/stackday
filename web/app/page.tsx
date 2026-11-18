import Link from "next/link";
import { LearnMore } from "@/components/learn-more";
import { Logo, LogoMark, SiteNotices } from "@/components/shell";
import { buttonClass } from "@/components/styles";
import { ThemeToggle } from "@/components/theme";
import { AssetIcon, Badge } from "@/components/ui";
import { BRAND } from "@/lib/brand";

/** Public demo wallet from the README, opened read-only so anyone can look around without a wallet. */
const DEMO_VIEW = "/dashboard?view=0xC0F2c3CDd7D11FC9eC388ff2B2F57d81A38190df";

const STEPS = [
  { title: "Payday", text: "Salary arrives in USDC. Claim it to any wallet." },
  { title: "Your vault", text: "A share you pick buys stocks, cbBTC or Ether into a vault only you control." },
  { title: "Themes", text: "Pick themes and get a suggested split for your next buy. You confirm every change.", soon: true },
  { title: "Borrow", text: "Borrow USDC against your holdings on Morpho instead of selling." },
];

const TEAMS = [
  {
    title: "For the business",
    points: ["Fund a USDC treasury", "Pay your team once or on a schedule", "Add people by their ID, no spreadsheets"],
  },
  {
    title: "For the team",
    points: ["Claim salary to any wallet", "Send a share of each payday into assets", "Borrow against them instead of selling"],
  },
];

const TRUST = [
  { title: "One vault per person", text: "Only your wallet can move funds out." },
  { title: "No lending pool of ours", text: "Loans come from an existing Morpho market." },
  { title: "Tiny fees, fixed", text: "0.2% at most, set in the contracts. One-time buys are free. Never on salary." },
  { title: "Testnet, not audited", text: "Mock tokens and prices are labelled everywhere." },
];

const STRIP = [
  { title: "A share of every salary", text: "You pick the percentage" },
  { title: "One vault per person", text: "Only you can move it" },
  { title: "Borrow instead of selling", text: "Loans via existing Morpho markets" },
  { title: "Testnet only", text: "Mock tokens, not audited" },
];

const SAMPLE = [
  { icon: "AAPL", name: "Apple", holding: "18.42 AAPL", value: "$6,578.40", share: "48.1%" },
  { icon: "BTC", name: "Bitcoin", holding: "0.0281 cbBTC", value: "$2,810.00", share: "20.5%" },
  { icon: "NVDA", name: "NVIDIA", holding: "12.10 NVDA", value: "$2,299.00", share: "16.8%" },
  { icon: "ETH", name: "Ether", holding: "0.38 WETH", value: "$1,330.00", share: "9.7%" },
];

/** A small, static picture of the app with sample numbers. */
function AppPreview() {
  return (
    <figure aria-label="Picture of the app with sample data" className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-1.5" aria-hidden>
        <span className="mr-2 text-ink">
          <LogoMark size={20} />
        </span>
        {["Portfolio", "Invest", "Borrow", "Payday"].map((t, i) => (
          <span
            key={t}
            className={
              i === 0
                ? "rounded-[8px] border border-line bg-popover px-2.5 py-1 text-[11.5px] text-ink shadow-pill"
                : "hidden rounded-[8px] border border-transparent px-2.5 py-1 text-[11.5px] text-ink-soft sm:inline"
            }
          >
            {t}
          </span>
        ))}
        <span className="ml-auto">
          <Badge>Sample data</Badge>
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[11.5px] text-muted">Net worth</div>
          <div className="mt-1 font-display text-[17px] leading-none tracking-[-0.02em] tabular-nums sm:text-[26px]">
            $12,480<span className="text-cents">.32</span>
          </div>
          <div className="mt-1.5 text-[11px] text-grow">+6.8% since first buy</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">Next payday</div>
          <div className="mt-1 font-display text-[17px] leading-none tracking-[-0.02em] sm:text-[26px]">Fri 20 Nov</div>
          <div className="mt-1.5 text-[11px] text-muted">15% of salary</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">Health</div>
          <div className="mt-1 font-display text-[17px] leading-none tracking-[-0.02em] text-grow tabular-nums sm:text-[26px]">2.41</div>
          <div className="mt-1.5 text-[11px] text-muted">Loan $1,200.00</div>
        </div>
      </div>

      <table className="mt-5 w-full text-left text-[12px] tabular-nums">
        <thead>
          <tr className="text-[11px] text-muted">
            <th className="border-b border-line-soft pb-2 font-normal">Asset</th>
            <th className="hidden border-b border-line-soft pb-2 text-right font-normal sm:table-cell">Holding</th>
            <th className="border-b border-line-soft pb-2 text-right font-normal">Value</th>
            <th className="border-b border-line-soft pb-2 text-right font-normal">Share</th>
          </tr>
        </thead>
        <tbody>
          {SAMPLE.map((r) => (
            <tr key={r.icon}>
              <td className="border-b border-line-soft py-2.5 [tr:last-child_&]:border-0">
                <span className="flex items-center gap-2.5 font-medium">
                  <AssetIcon icon={r.icon} size={24} />
                  {r.name}
                </span>
              </td>
              <td className="hidden border-b border-line-soft py-2.5 text-right sm:table-cell [tr:last-child_&]:border-0">{r.holding}</td>
              <td className="border-b border-line-soft py-2.5 text-right [tr:last-child_&]:border-0">{r.value}</td>
              <td className="border-b border-line-soft py-2.5 text-right text-muted [tr:last-child_&]:border-0">{r.share}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function SectionHead({ id, title, link }: { id: string; title: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <h2 id={id} className="scroll-mt-24 font-display text-[30px] font-light leading-[1.05] tracking-[-0.025em] sm:text-[38px]">
        {title}
      </h2>
      {link && (
        <LearnMore href={link.href} className="text-[13px]">
          {link.label}
        </LearnMore>
      )}
    </div>
  );
}

const NAV_LINK = "flex h-9 items-center rounded-[10px] px-3 text-[13px] text-ink-soft transition-colors hover:bg-hover hover:text-ink";

export default function Home() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="glass sticky top-0 z-20">
        <div className="mx-auto flex h-[52px] max-w-[1280px] items-center justify-between gap-3 px-4 sm:h-16 sm:px-7">
          <div className="flex items-center gap-6">
            <Logo />
            <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
              <a href="#how" className={NAV_LINK}>
                How it works
              </a>
              <a href="#teams" className={NAV_LINK}>
                For teams
              </a>
              <a href="#safety" className={NAV_LINK}>
                Safety
              </a>
              <Link href="/docs" className={NAV_LINK}>
                Docs
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden lg:block">
              <ThemeToggle />
            </div>
            <span className="hidden sm:block">
              <Link href="/start" className={buttonClass("ghost", "sm")}>
                Sign in
              </Link>
            </span>
            <Link href="/dashboard" className={buttonClass("secondary", "sm")}>
              Open app
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto max-w-[1280px] px-4 pt-2 sm:px-7 sm:pt-4">
          <div className="hero-grid overflow-hidden rounded-[22px] border border-line">
            <div className="grid gap-10 px-5 pb-10 pt-8 sm:px-10 sm:pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12 lg:px-12 lg:pb-12">
              <div className="animate-[var(--animate-fade)]">
                <span className="inline-flex h-6 items-center gap-1.5 rounded-[6px] border border-line bg-popover px-2 text-[11.5px] text-ink-soft">
                  <i className="h-1.5 w-1.5 rounded-full bg-grow" aria-hidden />
                  Live on Base Sepolia testnet
                </span>
                <h1 className="mt-6 max-w-[14ch] font-display text-[40px] font-light leading-[1.03] tracking-[-0.03em] sm:text-[54px]">
                  Turn every payday into an investment you control.
                </h1>
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
                  Each payday, a share of your salary buys tokenized stocks, Bitcoin, Ether or gold into a vault only you control.
                  Need cash? Borrow USDC against it instead of selling.
                </p>
                <div className="mt-7 flex flex-wrap gap-2.5">
                  <Link href="/start" className={buttonClass("primary", "lg")}>
                    Get started
                  </Link>
                  <a href="#how" className={buttonClass("secondary", "lg")}>
                    See how it works
                  </a>
                </div>
                <p className="mt-5 text-xs text-muted">
                  Testnet demo, not audited. Not investment advice. No wallet? <LearnMore href={DEMO_VIEW}>View a demo vault</LearnMore>
                </p>
              </div>
              <AppPreview />
            </div>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line-soft bg-surface/60 px-5 py-6 sm:px-10 lg:grid-cols-4 lg:px-12">
              {STRIP.map((s) => (
                <li key={s.title}>
                  <div className="text-[13px] font-medium text-ink">{s.title}</div>
                  <div className="mt-0.5 text-xs text-muted">{s.text}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-[1120px] px-4 pt-20 sm:px-7 sm:pt-24">
          <SectionHead id="how" title="How it works" link={{ href: "/docs#how-it-works", label: "Read the details" }} />
          <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-[18px] border border-line bg-surface p-5 shadow-card">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-press text-[11px] font-semibold tabular-nums text-ink" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="mt-5 flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {s.title}
                  {s.soon && <Badge>In development</Badge>}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* For teams */}
        <section className="mx-auto max-w-[1120px] px-4 pt-20 sm:px-7 sm:pt-24">
          <SectionHead id="teams" title="Payroll that invests" />
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {TEAMS.map((t) => (
              <div key={t.title} className="rounded-[18px] border border-line bg-surface p-5 shadow-card">
                <h3 className="text-sm font-semibold">{t.title}</h3>
                <ul className="mt-3 divide-y divide-line-soft">
                  {t.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-3 py-2.5 text-[13px] text-ink-soft">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-grow" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l4 4 10-10" />
                      </svg>
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Trust and safety */}
        <section className="mx-auto max-w-[1120px] px-4 pt-20 sm:px-7 sm:pt-24">
          <SectionHead id="safety" title={`Built so ${BRAND.name} can't move your money`} link={{ href: "/docs#security", label: "Security and risks" }} />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((t) => (
              <li key={t.title} className="rounded-[18px] border border-line bg-surface p-5 shadow-card">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" />
                </svg>
                <h3 className="mt-4 text-sm font-semibold">{t.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{t.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-warn-soft px-4 py-3 text-[13px] text-warn">
            Borrowing adds liquidation risk if prices fall.
            <LearnMore href="/docs#borrowing" className="text-warn decoration-warn/40 hover:decoration-warn">
              How loans work
            </LearnMore>
          </p>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-[1120px] px-4 py-20 sm:px-7 sm:py-24">
          <div className="flex flex-col items-start gap-6 rounded-[18px] border border-line bg-surface p-6 shadow-card sm:p-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-[28px] font-light leading-tight tracking-[-0.02em] sm:text-[32px]">Try it with test USDC</h2>
              <p className="mt-1.5 text-[13px] text-muted">Connect a wallet on Base Sepolia. Nothing here is real money.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/start" className={buttonClass("primary", "lg")}>
                Get started
              </Link>
              <Link href="/docs" className={buttonClass("secondary", "lg")}>
                Read the docs
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-5 px-4 py-8 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Logo />
              <span className="text-xs text-muted">Built on Base. Testnet demo, not audited.</span>
            </div>
            <ThemeToggle />
          </div>
          <SiteNotices />
        </div>
      </footer>
    </div>
  );
}
