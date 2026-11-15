import Link from "next/link";
import { Logo, TestnetBanner, WalletButton } from "@/components/shell";
import { MockBadge, RealBadge } from "@/components/ui";

const STEPS = [
  {
    n: "01",
    title: "Payday arrives",
    text: "Your employer funds a USDC treasury and sets a rhythm: daily, weekly or monthly. Each payday you claim to any wallet you choose.",
  },
  {
    n: "02",
    title: "A share goes to work",
    text: "Before you claim, pick a share, say 10% or 20%, and what it buys: tokenized stocks, Bitcoin or Ether. Once, or on every payday.",
  },
  {
    n: "03",
    title: "It sits in a vault only you control",
    text: "One vault per person. No pooled money, no admin key. Idle USDC in it can earn interest.",
  },
  {
    n: "04",
    title: "Need cash? Borrow, do not sell",
    text: "Borrow USDC against your assets through an existing lending market. Every payday adds collateral, so the loan gets safer as the weeks go by.",
  },
];

function Preview() {
  // A static illustration of the claim screen. Not live data.
  const rows = [
    { label: "Apple", pct: 10, color: "#1f2937" },
    { label: "Bitcoin", pct: 5, color: "#d97706" },
    { label: "Ether", pct: 5, color: "#4f46e5" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-sm animate-[var(--animate-rise)] [animation-delay:200ms]" aria-hidden>
      <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-brand/20 blur-3xl" />
      <div className="rounded-3xl border border-white/10 bg-surface p-5 text-ink shadow-2xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">This payday</div>
        <div className="mt-1 font-display text-5xl leading-none">$2,400.00</div>
        <div className="mt-5 flex h-3 gap-0.5 overflow-hidden rounded-full bg-sunken">
          <span className="h-full w-[80%] rounded-l-full bg-line-strong" />
          {rows.map((r) => (
            <span key={r.label} className="h-full last:rounded-r-full" style={{ width: `${r.pct}%`, background: r.color }} />
          ))}
        </div>
        <ul className="mt-4 space-y-2.5 text-sm">
          <li className="flex justify-between">
            <span className="text-muted">Cash to your wallet</span>
            <span className="font-semibold tabular-nums">$1,920.00</span>
          </li>
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                {r.label} <span className="text-muted">{r.pct}%</span>
              </span>
              <span className="font-semibold tabular-nums">${((2400 * r.pct) / 100).toFixed(2)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 rounded-full bg-brand py-3 text-center text-sm font-semibold text-white">Claim salary</div>
        <p className="mt-3 text-center text-[11px] text-muted">Illustration. Not live data.</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-dvh">
      <TestnetBanner />
      <div className="bg-ink text-canvas">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Logo light />
          <div className="flex items-center gap-3">
            <Link href="/risk" className="hidden text-sm font-medium text-canvas/70 transition-colors hover:text-canvas sm:block">
              Risks
            </Link>
            <WalletButton light />
          </div>
        </header>

        <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:pb-28 lg:pt-16">
          <div className="animate-[var(--animate-rise)]">
            <p className="text-sm font-semibold text-brand-soft/80">Stackday, salary maxxing on Base</p>
            <h1 className="mt-4 font-display text-6xl leading-[0.95] tracking-tight text-balance sm:text-7xl lg:text-8xl">
              Every payday,
              <br />
              <em className="text-brand-soft">a little richer.</em>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-canvas/70">
              Payroll in USDC that turns a share of each salary into stocks, Bitcoin or Ether, held in a vault only you
              control. When you need cash, borrow against it instead of selling.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex min-h-12 items-center rounded-full bg-brand px-7 text-[15px] font-semibold text-white transition-[background-color,transform] duration-200 hover:bg-brand-dark active:scale-[0.97]"
              >
                Open my dashboard
              </Link>
              <Link
                href="/employer"
                className="inline-flex min-h-12 items-center rounded-full border border-white/20 px-7 text-[15px] font-semibold text-canvas transition-[background-color,transform] duration-200 hover:bg-white/10 active:scale-[0.97]"
              >
                I run payroll
              </Link>
            </div>
          </div>
          <Preview />
        </section>
      </div>

      <main className="mx-auto max-w-6xl space-y-20 px-5 py-20 sm:px-8">
        <section>
          <h2 className="font-display text-4xl tracking-tight sm:text-5xl">How it works</h2>
          <ol className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2">
            {STEPS.map((s) => (
              <li key={s.n} className="border-t border-line-strong pt-5">
                <div className="font-mono text-xs text-muted">{s.n}</div>
                <h3 className="mt-2 text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-4xl tracking-tight sm:text-5xl">Honest about what is real</h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
              This demo runs on Base Sepolia, a test network. The real stock tokens do not exist there, so some parts
              are stand-ins, and every one of them is labelled. Stackday is not deployed to Base mainnet and has not had
              an independent security audit.
            </p>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
              The same vault, payroll and lending code is tested against the real AAPLc token, a real Aerodrome pool, a
              real Morpho interest vault and the real Morpho AAPLc/USDC market on a private copy of Base mainnet.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-line bg-surface p-5">
              <RealBadge>Real</RealBadge>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                <li>Stackday payroll, vault and adapter contracts</li>
                <li>Morpho lending market, interest model and liquidation rules</li>
                <li>USDC (Circle test USDC)</li>
                <li>One vault per person, no admin access</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-line bg-surface p-5">
              <MockBadge>Mocked on testnet</MockBadge>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                <li>Asset tokens (stand-ins for AAPLc, NVDAc, cbBTC, WETH)</li>
                <li>Their price feeds</li>
                <li>The exchange where assets are bought</li>
                <li>The venue where idle USDC earns interest</li>
                <li>Dividends (the mock tokens pay none)</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-warn-soft p-6 sm:p-8">
          <h2 className="font-display text-3xl tracking-tight text-warn">Read this before you borrow</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-warn">
            Asset prices can fall. If you borrow and the price drops far enough, your assets can be sold (liquidated) to
            repay the loan, and you can lose part of them. Stock markets also close at night and on weekends, so prices
            can gap. Borrowing avoids a sale but adds debt and liquidation risk.
          </p>
          <Link href="/risk" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-semibold text-canvas transition-transform duration-200 active:scale-[0.97]">
            Open the risk screen
          </Link>
        </section>

        <section className="grid gap-6 border-t border-line-strong pt-10 sm:grid-cols-3">
          <div>
            <div className="font-display text-5xl">0.25%</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Stackday&apos;s only fee, on USDC that goes into assets. Fixed in the contract. Salary paid out is never charged.
            </p>
          </div>
          <div>
            <div className="font-display text-5xl">1 vault</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">Per person, controlled only by that person. Stackday cannot move anything out of it.</p>
          </div>
          <div>
            <div className="font-display text-5xl">0 pools</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">Stackday runs no lending pool. Loans come from an existing Morpho market.</p>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-12 text-xs leading-relaxed text-muted sm:px-8">
        Stackday is a hackathon demo on a test network. Coinbase tokenized stocks are only available to eligible persons
        outside the United States and carry no voting rights. Not financial advice.
      </footer>
    </div>
  );
}
