import Link from "next/link";
import { Logo, TestnetBanner, WalletButton } from "@/components/shell";
import { ThemeToggle } from "@/components/theme";
import { buttonClass } from "@/components/styles";
import { Badge, MockBadge, RealBadge } from "@/components/ui";
import { BRAND } from "@/lib/brand";

/** Public demo wallet from the README, opened read-only so anyone can look around without a wallet. */
const DEMO_VIEW = "/dashboard?view=0xC0F2c3CDd7D11FC9eC388ff2B2F57d81A38190df";

const STEPS = [
  {
    title: "Payday",
    text: "Your employer pays salary in USDC on Base, once or on a schedule. Claim it to any wallet you choose.",
    icon: "M12 3v18M16.5 7.5h-6.25a2.75 2.75 0 000 5.5h3.5a2.75 2.75 0 010 5.5H7.5",
  },
  {
    title: "Your vault",
    text: "Before you claim, send a share, say 10 or 20 percent, into tokenized stocks, Bitcoin or Ether. It lands in a vault only you control.",
    icon: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  },
  {
    title: "Themes",
    text: "Pick the themes you care about and see a capped, explained split for your next payday. You confirm every change.",
    icon: "M12 3l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.4l-5.3 2.9 1.1-5.9L3.4 9.3l6-.8z",
    soon: true,
  },
  {
    title: "Borrow",
    text: "Need cash? Borrow USDC against what you hold through an existing Morpho market instead of selling. Each payday adds collateral.",
    icon: "M4 9h16v10H4zM8 9V6a4 4 0 018 0v3M12 13v2",
  },
];

const TRUST = [
  {
    title: "One vault per person",
    text: "Your assets sit in a vault contract that only your wallet controls. No pooled money, no admin key. Nobody else can move anything out.",
  },
  {
    title: "Loans come from Morpho",
    text: `${BRAND.name} runs no lending pool. Borrowing goes through an existing, public Morpho market with its own liquidation rules.`,
  },
  {
    title: "A fee you can read",
    text: "0.25 percent of the USDC that goes into assets, fixed in the contract forever. Salary paid out is never charged.",
  },
  {
    title: "Open about the limits",
    text: "Testnet only, no independent audit yet, and every testnet stand-in is labelled as a mock wherever it appears.",
  },
];

const FAQ = [
  {
    q: "Who can use it?",
    a: "Coinbase tokenized stocks are only available to eligible persons outside the United States. This demo runs on Base Sepolia, a test network, so anyone can try the flow with free test USDC. If you are in the United States, do not use it with real tokenized stocks.",
  },
  {
    q: "Is this investment advice?",
    a: `No. ${BRAND.name} is a tool. It shows what your own choices and published rules produce, and you confirm every purchase. Nothing on this site is a recommendation to buy or sell anything. Prices can fall and you can lose money.`,
  },
  {
    q: "Do I own the shares?",
    a: "Tokenized stocks give you economic exposure to the share price. They carry no voting rights. The real tokens have an issuer who can pause or block transfers, which no contract can prevent.",
  },
  {
    q: "Is this real money?",
    a: "No. Everything here runs on a test network. The asset tokens, their prices, the exchange and the interest venue are mocks, and the site labels them. Our contracts, the Morpho market and Circle test USDC are real testnet deployments.",
  },
  {
    q: `Can ${BRAND.name} move my money?`,
    a: "No. Each vault has one owner, you. No admin or owner function can take value out of it, and the fee cannot be changed after deployment.",
  },
  {
    q: "What happens if prices fall while I borrow?",
    a: "Your loan health drops. If it falls far enough, the lending market can sell part of your collateral to repay the loan (liquidation). You can turn on an emergency rule so that your next payday share goes to collateral, and you can repay at any time. The Risk page has a stress test.",
  },
  {
    q: "What are Themes?",
    a: "A layer in development: you pick themes such as chips or payments, and the app suggests a split for your next payday with hard caps and a reason for each holding. It only proposes. You confirm every change.",
  },
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

function SectionHead({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="scroll-mt-24 font-display text-4xl font-semibold leading-[1.05] tracking-[-0.025em] sm:text-5xl">
        {title}
      </h2>
      {lead && <p className="mt-4 text-[17px] leading-relaxed text-muted">{lead}</p>}
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <TestnetBanner />

      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <Logo />
          <nav aria-label="Sections" className="hidden items-center gap-1 text-sm font-medium text-muted md:flex">
            <a href="#how" className="rounded-full px-3 py-2 transition-colors hover:bg-sunken hover:text-ink">
              How it works
            </a>
            <a href="#safety" className="rounded-full px-3 py-2 transition-colors hover:bg-sunken hover:text-ink">
              Safety
            </a>
            <a href="#faq" className="rounded-full px-3 py-2 transition-colors hover:bg-sunken hover:text-ink">
              FAQ
            </a>
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
                Payroll in USDC that sends a share of each salary into tokenized stocks, Bitcoin or Ether, held in a vault
                only you control. When you need cash, borrow against it instead of selling.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/dashboard" className={buttonClass("primary", "lg", "shadow-brand")}>
                  Open the app
                </Link>
                <Link href="/employer" className={buttonClass("secondary", "lg")}>
                  I run payroll
                </Link>
              </div>
              <p className="mt-6 text-sm text-muted">
                No wallet yet?{" "}
                <Link href={DEMO_VIEW} className="font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-4 hover:decoration-brand-ink">
                  Look at a demo vault, read-only
                </Link>
              </p>
            </div>
            <PaydayStack />
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-28">
            <SectionHead
              id="how"
              title="How it works"
              lead="Four steps, from salary to a position that grows with every payday. You decide the share, and you can change it any time."
            />
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative flex flex-col rounded-3xl border border-line bg-canvas p-6">
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
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-28">
            <SectionHead
              id="safety"
              title="Built so we can't move your money"
              lead={`${BRAND.name} has no admin keys over your vault and no lending pool of its own. Here is exactly what is real today and what is a testnet stand-in.`}
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {TRUST.map((t) => (
                <div key={t.title} className="rounded-3xl border border-line bg-surface p-6 shadow-xs">
                  <h3 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-ink" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" />
                    </svg>
                    {t.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{t.text}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-line bg-surface p-6 shadow-xs">
                <RealBadge>Real</RealBadge>
                <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed">
                  <li>{BRAND.name} payroll, vault and adapter contracts, verified on Sourcify</li>
                  <li>Morpho lending market, interest model and liquidation rules</li>
                  <li>USDC (Circle test USDC)</li>
                  <li>The same code tested against real AAPLc, Aerodrome and Morpho on a copy of Base mainnet</li>
                </ul>
              </div>
              <div className="rounded-3xl border border-line bg-surface p-6 shadow-xs">
                <MockBadge>Mocked on testnet</MockBadge>
                <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed">
                  <li>Asset tokens (stand-ins for AAPLc, NVDAc, cbBTC, WETH) and their price feeds</li>
                  <li>The exchange where assets are bought</li>
                  <li>The venue where idle USDC earns interest</li>
                  <li>Dividends (the mock tokens pay none)</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 rounded-3xl border border-warn/20 bg-warn-soft p-6 sm:p-8">
              <h3 className="text-xl font-semibold tracking-tight text-warn">Read this before you borrow</h3>
              <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-warn">
                Asset prices can fall. If you borrow and the price drops far enough, part of your assets can be sold
                (liquidated) to repay the loan. Stock markets close at night and on weekends, so prices can gap.
                Borrowing avoids a sale but adds debt and liquidation risk.
              </p>
              <Link href="/risk" className={buttonClass("ink", "md", "mt-5")}>
                Open the risk page
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.8fr_1.2fr]">
            <SectionHead id="faq" title="Questions" lead="The short, honest answers. The README on GitHub has the full detail." />
            <div className="divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details key={f.q} className="faq group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[17px] font-semibold tracking-tight">
                    {f.q}
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sunken text-muted transition-transform duration-200 ease-[var(--ease-out)] group-open:rotate-45" aria-hidden>
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </summary>
                  <p className="pb-5 pr-12 text-[15px] leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="px-4 py-20 sm:px-8 sm:py-24">
          <div className="feature mx-auto flex max-w-6xl flex-col items-start gap-8 rounded-[2rem] p-8 sm:p-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.025em] sm:text-5xl">Try it with test USDC</h2>
              <p className="mt-4 text-[17px] leading-relaxed text-muted">
                Connect a browser wallet on Base Sepolia. Free test USDC comes from the Circle faucet.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <WalletButton light />
              <Link href={DEMO_VIEW} className="inline-flex min-h-9 items-center rounded-full border border-white/25 px-3.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-white/10">
                View the demo vault
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <Logo />
              <span className="text-sm text-muted">Built on Base</span>
            </div>
            <ThemeToggle />
          </div>
          <p className="mt-8 max-w-3xl text-xs leading-relaxed text-muted">
            {BRAND.name} is a hackathon demo on a test network. It is not deployed to Base mainnet and has not had an
            independent security audit. Coinbase tokenized stocks are only available to eligible persons outside the
            United States and carry no voting rights. Nothing here is financial or investment advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
