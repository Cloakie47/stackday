import Link from "next/link";
import { LearnMore } from "@/components/learn-more";
import { Logo, TestnetBanner, WalletButton } from "@/components/shell";
import { buttonClass } from "@/components/styles";
import { ThemeToggle } from "@/components/theme";
import { Badge } from "@/components/ui";

/** Public demo wallet from the README, opened read-only so anyone can look around without a wallet. */
const DEMO_VIEW = "/dashboard?view=0xC0F2c3CDd7D11FC9eC388ff2B2F57d81A38190df";

const STEPS = [
  {
    title: "Payday",
    text: "Salary arrives in USDC. Claim it to any wallet.",
    icon: "M12 3v18M16.5 7.5h-6.25a2.75 2.75 0 000 5.5h3.5a2.75 2.75 0 010 5.5H7.5",
  },
  {
    title: "Your vault",
    text: "A share you pick buys stocks, cbBTC or Ether into a vault only you control.",
    icon: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  },
  {
    title: "Themes",
    text: "Coming next: pick themes and get a suggested split for your next buy. You confirm every change.",
    icon: "M12 3l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.4l-5.3 2.9 1.1-5.9L3.4 9.3l6-.8z",
    soon: true,
  },
  {
    title: "Borrow",
    text: "Borrow USDC against your holdings on Morpho instead of selling.",
    icon: "M4 9h16v10H4zM8 9V6a4 4 0 018 0v3M12 13v2",
  },
];

const TRUST = [
  { title: "One vault per person", text: "Only your wallet can move funds out." },
  { title: "No lending pool of ours", text: "Loans come from an existing Morpho market." },
  { title: "0.25% fee, fixed", text: "Only on recurring buys. One-time buys are free. Never on salary." },
  { title: "Testnet, not audited", text: "Mock tokens and prices are labelled everywhere." },
];

/** The memorable thing: a vault that grows one bar per payday while the loan against it gets safer. */
function PaydayStack() {
  const bars = [18, 26, 31, 40, 46, 55, 61, 70, 76, 85, 91, 100];
  return (
    <figure className="feature relative mx-auto w-full max-w-md rounded-[2rem] p-6 sm:p-7" aria-label="Illustration: a vault growing every payday">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-muted">Vault value after 12 paydays</div>
          <div className="mt-1.5 font-display text-5xl font-semibold leading-none tracking-[-0.03em] tabular-nums">$4,320</div>
        </div>
        <span className="rounded-full bg-white/12 px-2.5 py-1 text-xs font-semibold text-white/90">15% of salary</span>
      </div>

      <div className="mt-8 flex h-40 items-end gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            className="stack-bar flex-1 rounded-t-md rounded-b-sm"
            style={{
              height: `${h}%`,
              animationDelay: `${300 + i * 55}ms`,
              background: i === bars.length - 1 ? "#ffffff" : `rgb(143 177 255 / ${0.35 + (i / bars.length) * 0.55})`,
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted" aria-hidden>
        <span>Payday 1</span>
        <span>Payday 12</span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-5 text-sm">
        <div>
          <div className="text-muted">Borrowed</div>
          <div className="mt-0.5 font-semibold tabular-nums">$600</div>
        </div>
        <div>
          <div className="text-muted">Loan health</div>
          <div className="mt-0.5 flex items-baseline gap-1.5 font-semibold tabular-nums">
            1.4 <span className="text-muted">to</span> 4.5
          </div>
        </div>
      </div>
      <figcaption className="mt-5 text-[11px] text-muted">Illustration with made-up numbers. Not live data, not a forecast.</figcaption>
    </figure>
  );
}

function StepIcon({ d }: { d: string }) {
  return (
    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand-ink" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}

function SectionHead({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="scroll-mt-24 font-display text-4xl font-semibold leading-[1.05] tracking-[-0.025em] sm:text-5xl">
      {title}
    </h2>
  );
}

const NAV_LINK = "rounded-full px-3 py-2 transition-colors hover:bg-sunken hover:text-ink";

export default function Home() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <TestnetBanner />

      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <Logo />
          <nav aria-label="Sections" className="hidden items-center gap-1 text-sm font-medium text-muted md:flex">
            <a href="#how" className={NAV_LINK}>
              How it works
            </a>
            <a href="#safety" className={NAV_LINK}>
              Safety
            </a>
            <Link href="/docs" className={NAV_LINK}>
              Docs
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <WalletButton />
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="hero-glow relative">
          <div className="mx-auto grid max-w-6xl gap-14 px-4 pb-20 pt-12 sm:px-8 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-10 lg:pb-28">
            <div className="animate-[var(--animate-rise)]">
              <Badge tone="brand">Live on Base Sepolia testnet</Badge>
              <h1 className="mt-6 font-display text-[3.25rem] font-semibold leading-[0.98] tracking-[-0.035em] sm:text-7xl lg:text-[5.25rem]">
                Turn every payday into stock you own.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
                Payroll in USDC that invests a share of each salary into a vault only you control. Borrow against it
                instead of selling.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/start" className={buttonClass("primary", "lg", "shadow-brand")}>
                  Get started
                </Link>
                <Link href="/dashboard" className={buttonClass("secondary", "lg")}>
                  I have an account
                </Link>
              </div>
              <p className="mt-6 text-sm text-muted">
                No wallet? <LearnMore href={DEMO_VIEW}>View a demo vault</LearnMore>
              </p>
            </div>
            <PaydayStack />
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHead id="how" title="How it works" />
              <LearnMore href="/docs#how-it-works" className="text-sm" />
            </div>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex flex-col rounded-3xl border border-line bg-canvas p-6">
                  <div className="flex items-center justify-between">
                    <StepIcon d={s.icon} />
                    <span className="text-sm font-semibold tabular-nums text-muted" aria-hidden>
                      {i + 1}/4
                    </span>
                  </div>
                  <h3 className="mt-6 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
                    {s.title}
                    {s.soon && <Badge tone="neutral">In development</Badge>}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Trust and safety */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHead id="safety" title="Built so we can't move your money" />
              <LearnMore href="/docs#security" className="text-sm" />
            </div>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TRUST.map((t) => (
                <li key={t.title} className="rounded-3xl border border-line bg-surface p-6 shadow-xs">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-ink" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" />
                  </svg>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight">{t.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{t.text}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-warn/20 bg-warn-soft px-5 py-4 text-sm font-medium text-warn">
              Borrowing adds liquidation risk if prices fall.
              <LearnMore href="/docs#borrowing" className="text-warn decoration-warn/40 hover:decoration-warn">
                How loans work
              </LearnMore>
            </p>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="px-4 pb-20 sm:px-8 sm:pb-24">
          <div className="feature mx-auto flex max-w-6xl flex-col items-start gap-8 rounded-[2rem] p-8 sm:p-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.025em] sm:text-5xl">Try it with test USDC</h2>
              <p className="mt-3 text-[17px] text-muted">Connect a wallet on Base Sepolia.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <WalletButton light />
              <Link
                href="/docs"
                className="inline-flex min-h-9 items-center rounded-full border border-white/25 px-3.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-white/10"
              >
                Read the docs
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-10 sm:px-8">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="text-sm text-muted">Built on Base</span>
          </div>
          <ThemeToggle />
          <p className="w-full text-xs leading-relaxed text-muted">
            Testnet demo, not audited. Tokenized stocks are for eligible persons outside the US. Not investment advice.{" "}
            <LearnMore href="/docs#notices">Full notices</LearnMore>
          </p>
        </div>
      </footer>
    </div>
  );
}
