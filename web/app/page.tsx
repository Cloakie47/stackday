import Link from "next/link";
import { LearnMore } from "@/components/learn-more";
import { Logo, TestnetBanner, WalletButton } from "@/components/shell";
import { buttonClass, cx } from "@/components/styles";
import { ThemeToggle } from "@/components/theme";
import { Badge, Responsive } from "@/components/ui";

/** Public demo wallet from the README, opened read-only so anyone can look around without a wallet. */
const DEMO_VIEW = "/dashboard?view=0xC0F2c3CDd7D11FC9eC388ff2B2F57d81A38190df";

const STEPS = [
  { title: "Payday", text: "Salary arrives in USDC. Claim it to any wallet." },
  { title: "Your vault", text: "A share you pick buys tokenized stocks, cbBTC or Ether into your vault." },
  { title: "Themes", text: "Pick themes and get a suggested split for your next buys. You confirm every change.", beta: true },
  { title: "Borrow", text: "Borrow USDC against your holdings on Morpho instead of selling." },
];

const FACTS = [
  { value: "0.2%", label: "Max fee, fixed in the contracts" },
  { value: "1 vault", label: "Per person, only you control it" },
  { value: "Morpho", label: "Loans via existing markets" },
  { value: "Testnet", label: "Not audited yet" },
];

/** Borders for a 2 by 2 grid on phones that becomes one row of 4 on desktop. */
const FACT_CELL = [
  "pr-4 lg:pr-6",
  "border-l pl-4 sm:pl-6 lg:px-6",
  "border-t pr-4 lg:border-l lg:border-t-0 lg:px-6",
  "border-l border-t pl-4 sm:pl-6 lg:border-t-0",
];

const TRUST = [
  { title: "One vault per person", text: "Only your wallet can move funds out.", icon: "M5 11h14v10H5zM8 11V7a4 4 0 018 0v4" },
  { title: "No pool of our own", text: "Loans come from an existing Morpho market.", icon: "M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" },
  {
    title: "Low, fixed fees",
    text: "At most 0.2%, fixed in the contracts. One-time buys are free. No fee on salary.",
    icon: "M19 5L5 19M7.5 9.5a2 2 0 100-4 2 2 0 000 4zM16.5 18.5a2 2 0 100-4 2 2 0 000 4z",
  },
  { title: "Testnet, not audited", text: "Mock tokens and prices are labelled everywhere.", icon: "M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3" },
];

/** A product preview: a vault that grows one bar per payday while the loan against it gets healthier. */
function PaydayStack() {
  const bars = [18, 26, 31, 40, 46, 55, 61, 70, 76, 85, 91, 100];
  return (
    <figure
      className="mx-auto w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-preview sm:p-6"
      aria-label="Illustration: a vault growing every payday"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-muted">Vault value after 12 paydays</div>
          <div className="mt-1 text-[40px] font-semibold leading-[44px] tracking-[-0.03em] tabular-nums text-ink">$4,320</div>
        </div>
        <Badge>15% of salary</Badge>
      </div>

      <div className="mt-6 flex h-36 items-end gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            className="flex-1 rounded-t-[4px] rounded-b-[2px] bg-brand"
            style={{ height: `${h}%`, opacity: i === bars.length - 1 ? 1 : 0.25 + (i / (bars.length - 1)) * 0.6 }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted" aria-hidden>
        <span>Payday 1</span>
        <span>Payday 12</span>
      </div>

      <dl className="mt-5 grid grid-cols-2 divide-x divide-line border-t border-line pt-4">
        <div className="pr-4">
          <dt className="text-[13px] font-medium text-muted">Loan</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">$600</dd>
        </div>
        <div className="pl-4">
          <dt className="text-[13px] font-medium text-muted">Health</dt>
          <dd className="mt-0.5 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums text-ink">
            1.40 <span className="text-sm font-normal text-muted">to</span> <span className="text-grow">4.50</span>
          </dd>
        </div>
      </dl>
      <figcaption className="mt-4 text-xs text-muted">Illustration. Made-up numbers, not a forecast.</figcaption>
    </figure>
  );
}

function SectionHead({ id, title, link }: { id: string; title: string; link: { href: string; label?: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <h2 id={id} className="scroll-mt-24 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-ink sm:text-[36px] sm:leading-[42px]">
        {title}
      </h2>
      <LearnMore href={link.href} className="text-sm">
        {link.label}
      </LearnMore>
    </div>
  );
}

const NAV_LINK = "rounded-lg px-3 py-2 transition-colors hover:bg-hover hover:text-ink";

export default function Home() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <TestnetBanner />

      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex h-16 max-w-[75rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
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
            <WalletButton variant="secondary" />
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section>
          <div className="mx-auto grid max-w-[75rem] gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12 lg:px-8 lg:pb-24">
            <div>
              <Badge dot>
                <Responsive m="Base Sepolia testnet" d="Live on Base Sepolia testnet" />
              </Badge>
              <h1 className="mt-5 max-w-xl text-[40px] font-semibold leading-[44px] tracking-[-0.035em] text-ink sm:text-[56px] sm:leading-[60px]">
                <Responsive m="Invest a share of every payday." d="Turn every payday into an investment you control." />
              </h1>
              <p className="mt-5 max-w-[34rem] text-[17px] leading-7 text-ink-soft sm:text-lg">
                <Responsive
                  m="USDC payroll that invests a share of each salary. Borrow against it instead of selling."
                  d="USDC payroll that invests a share of each salary in a vault only you control. Borrow against it instead of selling."
                />
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/start" className={buttonClass("primary", "lg")}>
                  Get started
                </Link>
                <Link href={DEMO_VIEW} className={buttonClass("secondary", "lg")}>
                  View demo vault
                </Link>
              </div>
              <p className="mt-5 text-[13px] text-muted">
                No wallet needed for the demo. Already set up? <LearnMore href="/dashboard">Open app</LearnMore>
              </p>
            </div>
            <PaydayStack />
          </div>
        </section>

        {/* Key facts */}
        <section aria-label="Key facts" className="border-y border-line bg-surface">
          <dl className="mx-auto grid max-w-[75rem] grid-cols-2 px-4 sm:px-6 lg:grid-cols-4 lg:px-8">
            {FACTS.map((f, i) => (
              <div
                key={f.label}
                className={cx("flex flex-col-reverse border-line py-5 lg:py-6", FACT_CELL[i])}
              >
                <dt className="mt-0.5 text-[13px] text-muted">{f.label}</dt>
                <dd className="text-xl font-semibold tracking-[-0.015em] text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <section>
          <div className="mx-auto max-w-[75rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
            <SectionHead id="how" title="How it works" link={{ href: "/docs#how-it-works" }} />
            <ol className="relative mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
              <span aria-hidden className="absolute left-3 right-[calc((100%-4.5rem)/4-0.75rem)] top-3 hidden h-px bg-line-strong lg:block" />
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative">
                  <span className="relative grid h-6 w-6 place-items-center rounded-full border border-line-strong bg-canvas text-xs font-semibold tabular-nums text-muted">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 flex flex-wrap items-center gap-2 text-base font-semibold tracking-[-0.01em] text-ink">
                    {s.title}
                    {s.beta && <Badge>Beta</Badge>}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Trust and safety */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-[75rem] px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
            <SectionHead id="safety" title="Built so we can't move your money" link={{ href: "/docs#security" }} />
            <ul className="mt-10 grid border-t border-line sm:grid-cols-2">
              {TRUST.map((t, i) => (
                <li
                  key={t.title}
                  className={cx("flex gap-4 border-b border-line py-6", i % 2 === 0 ? "sm:pr-8" : "sm:border-l sm:pl-8")}
                >
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={t.icon} />
                  </svg>
                  <div>
                    <h3 className="text-[15px] font-semibold text-ink">{t.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{t.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn">
              Borrowing adds liquidation risk if prices fall.
              <LearnMore href="/docs#borrowing" className="text-warn decoration-warn/40 hover:decoration-warn">
                How loans work
              </LearnMore>
            </p>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto max-w-[75rem] px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
          <div className="flex flex-col items-start gap-6 rounded-4xl border border-line bg-surface p-6 sm:p-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-ink sm:text-[36px] sm:leading-[42px]">Try it with test USDC</h2>
              <p className="mt-2 text-[15px] text-muted">Connect a wallet on Base Sepolia.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <WalletButton size="lg" />
              <Link href="/docs" className={buttonClass("secondary", "lg")}>
                Read the docs
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[75rem] flex-wrap items-center justify-between gap-6 px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="text-[13px] text-muted">Built on Base</span>
          </div>
          <ThemeToggle />
          <p className="w-full text-xs leading-relaxed text-muted">
            <Responsive
              m={
                <>
                  Testnet, not audited. Not investment advice. Tokenized stocks: eligible non-US persons only, no voting rights.{" "}
                  <LearnMore href="/docs#notices">Notices</LearnMore>
                </>
              }
              d={
                <>
                  Testnet demo, not audited. Not investment advice. Tokenized stocks are for eligible persons outside the US and carry no
                  voting rights. <LearnMore href="/docs#notices">Full notices</LearnMore>
                </>
              }
            />
          </p>
        </div>
      </footer>
    </div>
  );
}
