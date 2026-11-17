import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, TestnetBanner } from "@/components/shell";
import { buttonClass } from "@/components/styles";
import { ThemeToggle } from "@/components/theme";
import { Badge, MockBadge, RealBadge } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { EXPLORER } from "@/lib/contracts";
import deployment from "@/lib/deployment.json";
import { DocsMobileNav, DocsSidebar, type DocsSection } from "./docs-nav";

export const metadata: Metadata = {
  title: "Docs",
  description: `How ${BRAND.name} works: payroll, your vault, Themes, borrowing, contracts and risks.`,
};

/*
  Addresses come from web/lib/deployment.json, which web/scripts/gen-abis.py copies from
  deployments/base-sepolia.json (the official testnet deployment). Nothing here edits either file.
*/
const D = deployment as unknown as Record<string, string | number | string[]>;
const SYMBOLS = D.assetSymbols as string[];
const ASSET_NAMES: Record<string, string> = {
  mAAPL: "Apple (AAPLc)",
  mNVDA: "NVIDIA (NVDAc)",
  mGOOGL: "Alphabet (GOOGLc)",
  mMETA: "Meta (METAc)",
  mSPCX: "SpaceX (SPCXc)",
  mPAXG: "Gold (PAX Gold, PAXG)",
  mcbBTC: "cbBTC (Coinbase Wrapped BTC)",
  mWETH: "Ether (WETH)",
};
const feePct = `${Number(D.sipFeeBps) / 100}%`;
const borrowFeePct = Number(D.borrowFeeBps ?? 0) > 0 ? `${Number(D.borrowFeeBps) / 100}%` : "None yet";
const earnFeePct = Number(D.earnFeeBps ?? 0) > 0 ? `${Number(D.earnFeeBps) / 100}%` : "None yet";
const pct = (wad: string | number) => `${(Number(wad) / 1e16).toFixed(1).replace(/\.0$/, "")}%`;

const SECTIONS: DocsSection[] = [
  { id: "what", label: `What ${BRAND.name} is` },
  { id: "how-it-works", label: "How it works" },
  { id: "who", label: "Who it is for" },
  { id: "vault", label: "Your vault and fees" },
  { id: "themes", label: "Themes and risk rules" },
  { id: "borrowing", label: "Borrowing and health" },
  { id: "private-pay", label: "Private pay" },
  { id: "testnet", label: "Testnet: real and mocked" },
  { id: "contracts", label: "Contract addresses" },
  { id: "security", label: "Security and risks" },
  { id: "notices", label: "Notices" },
  { id: "faq", label: "FAQ" },
  { id: "links", label: "Links" },
];

/* ---------- small building blocks ---------- */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-line pt-10 first:border-0 first:pt-0">
      <h2 className="font-display text-3xl font-semibold tracking-[-0.025em] sm:text-[2.25rem]">
        <a href={`#${id}`} className="rounded-md hover:text-brand-ink">
          {title}
        </a>
      </h2>
      <div className="mt-5 space-y-4 text-[16px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-28 pt-3 text-lg font-semibold tracking-tight text-ink">
      {children}
    </h3>
  );
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className={`w-full ${head.length > 2 ? "min-w-[28rem]" : ""} border-separate border-spacing-0 overflow-hidden rounded-2xl border border-line bg-surface text-left text-sm`}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="border-b border-line bg-sunken px-4 py-2.5 font-medium text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="border-b border-line px-4 py-2.5 align-top text-ink last-of-type:tabular-nums [tr:last-child_&]:border-0">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Addr({ a }: { a: string }) {
  return (
    <a
      href={`${EXPLORER}/address/${a}`}
      target="_blank"
      rel="noreferrer"
      className="break-all font-mono text-xs text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink"
    >
      {a}
    </a>
  );
}

function Hex({ v }: { v: string }) {
  return <span className="break-all font-mono text-xs text-muted">{v}</span>;
}

function Callout({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div className={tone === "warn" ? "rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn" : "rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand-ink"}>
      {children}
    </div>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink">
      {children}
    </a>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "Who can use it?",
    a: "Coinbase tokenized stocks are only for eligible persons outside the United States. This demo runs on a test network with free test USDC. The app does not check where you are, so if you are in the United States, do not use it with real tokenized stocks.",
  },
  {
    q: "Is this investment advice?",
    a: `No. ${BRAND.name} is a tool. It shows what your own choices and published rules produce, and you confirm every purchase. Prices can fall and you can lose money.`,
  },
  {
    q: "Do I own the shares?",
    a: "Tokenized stocks track the share price. They carry no voting rights. The real tokens have an issuer who can pause or block transfers, and no contract can prevent that.",
  },
  {
    q: "Is this real money?",
    a: "No. Everything runs on Base Sepolia, a test network. The asset tokens, their prices, the exchange and the interest venue are mocks.",
  },
  {
    q: `Can ${BRAND.name} move my money?`,
    a: "No. Each vault has one owner. No admin or owner function can take value out of it, and the fee cannot be changed after deployment.",
  },
  {
    q: "What if I lose my wallet?",
    a: "A vault has one owner key and no recovery. Losing the key means losing access to the vault.",
  },
  {
    q: "Does a recurring payroll pay itself?",
    a: "No. When a payday is due, someone has to press the button: the employer, the employee or an automation service. Until then the payday waits.",
  },
  {
    q: "Can I look around without a wallet?",
    a: "Yes. Add ?view= and any wallet address to an app page, for example the dashboard, to see it read-only.",
  },
];

/* ---------- page ---------- */

export default function DocsPage() {
  const stackday: [string, string][] = [
    ["Payroll", D.payroll as string],
    ["SipRouter (buys without an employer)", D.sipRouter as string],
    ["VaultFactory", D.vaultFactory as string],
    ["EmployeeVault (code every vault uses)", D.vaultImplementation as string],
    ["Price adapter", D.priceAdapter as string],
    ["Interest adapter (ERC-4626)", D.yieldAdapter as string],
    ...SYMBOLS.map((s) => [`Morpho lending adapter, ${s}`, D[`${s}LendingAdapter`] as string] as [string, string]),
    ...SYMBOLS.map((s) => [`Price oracle for Morpho, ${s}`, D[`${s}Oracle`] as string] as [string, string]),
  ];
  const protocols: [string, string][] = [
    ["Morpho", D.morpho as string],
    ["Morpho interest rate model", D.morphoIrm as string],
    ["USDC (Circle test USDC)", D.usdc as string],
  ];
  const mocks: [string, string][] = [
    ...SYMBOLS.flatMap((s) => [
      [`${s} token, stands in for ${ASSET_NAMES[s] ?? s}`, D[s] as string] as [string, string],
      [`${s} price feed`, D[`${s}Feed`] as string] as [string, string],
    ]),
    ["Mock exchange", D.mockSwapAdapter as string],
    ["Mock interest vault", D.mockYieldVault as string],
  ];

  return (
    <div className="min-h-dvh overflow-x-clip">
      <TestnetBanner />
      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden text-sm font-medium text-muted sm:inline">Docs</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <Link href="/dashboard" className={buttonClass("primary", "sm")}>
              Open the app
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <DocsMobileNav sections={SECTIONS} />
        <div className="grid gap-12 py-10 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:py-14">
          <DocsSidebar sections={SECTIONS} />

          <main id="main" className="min-w-0 max-w-3xl space-y-12">
            <header>
              <Badge tone="brand">Docs</Badge>
              <h1 className="mt-4 font-display text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-6xl">
                {BRAND.name}, explained
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-muted">
                Everything the app leaves out to stay simple. Short sections, plain words.
              </p>
            </header>

            <Section id="what" title={`What ${BRAND.name} is`}>
              <p>
                A payroll app on Base. A business pays its team in USDC. Before claiming, each person can send a share of
                their salary into tokenized stocks, cbBTC or Ether, held in a vault only they control. When they need
                cash, they borrow USDC against what they hold instead of selling it.
              </p>
              <p>
                It runs on Base Sepolia, a test network. Nothing is on Base mainnet, and there has been no independent
                security audit.
              </p>
            </Section>

            <Section id="how-it-works" title="How it works">
              <ol className="space-y-3">
                {[
                  ["Payday", "The employer funds a USDC treasury and pays once or on a schedule (daily, weekly, every 2 weeks or monthly). Each person claims to any wallet."],
                  ["Vault", "Before claiming, you pick a share (for example 10 or 20 percent) and what it buys, once or on every payday. It lands in your own vault."],
                  ["Themes", "In development. Pick themes you care about, and the app proposes a capped split for your next buys. You confirm every change."],
                  ["Borrow", "Borrow USDC against your holdings through an existing Morpho market. New buys stay free until you lock them; lock each payday's buy and the loan gets safer over time."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink">{i + 1}</span>
                    <span>
                      <strong className="font-semibold text-ink">{t}.</strong> {d}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-4">
                Next step: confidential salary payments, so pay amounts are hidden on chain while each person can still read
                their own.
              </p>
            </Section>

            <Section id="who" title="Who it is for">
              <H3 id="businesses">For businesses</H3>
              <List
                items={[
                  "Fund a treasury once, then pay your team once or on a schedule.",
                  "Pause, resume or withdraw unused treasury at any time.",
                  "Keep a team list and see attendance check-ins (optional account database; money never depends on it).",
                  "Nothing is locked in advance. If the treasury runs short, a due payday waits until you top up.",
                  "A salary never claimed can be taken back after 180 days.",
                ]}
              />
              <H3 id="employees">For employees</H3>
              <List
                items={[
                  "Claim each salary to any wallet you choose.",
                  "Choose a share to invest and split it across up to 6 assets, once or for every payday.",
                  "If one purchase fails, that part is paid to you in USDC. A failed buy never blocks your salary.",
                  "Set an emergency rule so a risky loan gets more collateral on payday.",
                ]}
              />
              <H3 id="individuals">For Personal accounts (no employer needed)</H3>
              <List
                items={[
                  "Buy into your own vault from your wallet, once or on a schedule (one recurring plan per asset).",
                  "A recurring buy can be started by anyone when due, but it only fills within the oracle price and your slippage limit.",
                  "Borrowing and interest work the same way as for employees.",
                ]}
              />
            </Section>

            <Section id="vault" title="Your vault and fees">
              <List
                items={[
                  "One vault per person, created the first time you invest. No pooled money.",
                  "Only you can move value out. Anyone can add to it or repay a loan for it.",
                  "Withdraw any time. With a loan open, you can withdraw only what the borrow limit still allows.",
                ]}
              />
              <H3 id="earn">Interest on idle USDC</H3>
              <p>USDC in your vault can be lent to an interest vault (ERC-4626) and earns while it waits. On testnet this venue is a mock.</p>
              <H3 id="fees">Fees</H3>
              <p>
                {BRAND.name} coordinates buying, locking, borrowing and earning, and takes small fees for it. Every fee is fixed in
                the contracts when they are deployed, capped at 0.2% in the code, and can never be changed.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">What</th>
                      <th className="py-1.5 pr-4 font-medium">Fee</th>
                      <th className="py-1.5 font-medium">Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    <tr>
                      <td className="py-1.5 pr-4">Recurring buys (every payday, or a schedule)</td>
                      <td className="py-1.5 pr-4 text-ink">{feePct}</td>
                      <td className="py-1.5">{feePct} of a 100 USDC buy</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4">One-time buys</td>
                      <td className="py-1.5 pr-4 text-ink">Free</td>
                      <td className="py-1.5">-</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4">Borrowing, once, from the borrowed USDC</td>
                      <td className="py-1.5 pr-4 text-ink">{borrowFeePct}</td>
                      <td className="py-1.5">Borrow 1,000, receive {1000 - Number(D.borrowFeeBps ?? 0) / 10}, owe 1,000</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-4">Idle USDC earning interest</td>
                      <td className="py-1.5 pr-4 text-ink">{earnFeePct} a year</td>
                      <td className="py-1.5">Taken only out of the interest, never the deposit</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3">
                Never charged: salary paid out, money already in your vault, collateral. Loan interest goes to the market&apos;s
                lenders, not to {BRAND.name}.
              </p>
            </Section>

            <Section id="themes" title="Themes and risk rules">
              <Callout>
                Themes is in development. These are the rules it is built to follow. Numbers may change before it ships.
              </Callout>
              <p>
                You pick themes and a risk level (Steady, Balanced or Bold). A fixed set of rules turns that into a split
                for your next buys and shows a reason for each holding. The AI model never sets or overrides these rules. It
                only proposes; you confirm.
              </p>
              <H3 id="caps">Targets for new buys</H3>
              <p>
                These targets shape each suggested split for your next buys. They are not limits on what you hold: Stackday
                cannot sell for you, so a holding that rises can grow above its target and stay there. The Themes page shows a
                notice when that happens, and new money goes to other holdings first.
              </p>
              <Table
                head={["Rule", "Target"]}
                rows={[
                  ["Single stock", "15% of each split"],
                  ["Single theme", "40%"],
                  ["AI and chips cluster (NVDA, SNDK, INTC, MSFT)", "35%"],
                  ["Crypto (cbBTC, WETH and crypto-like stocks)", "25% (Steady 10%)"],
                  ["Single high-risk asset", "2.5%"],
                  ["USDC cushion", "At least 5% (Steady 20%)"],
                  ["Leverage", "None. Total exposure never above 1x"],
                ]}
              />
              <H3 id="mood">Market mood</H3>
              <p>
                Market mood summarises recent news about the stocks in your themes, weighted by how much each item matters to
                the business. It does not predict prices and does not change your amounts. A serious event confirmed by a
                filing or two reliable sources is flagged so you can look at it.
              </p>
              <H3 id="rebalancing">Rebalancing with new money</H3>
              <List
                items={[
                  "The contracts can only buy, so a rebalance is a new split for your next payday or recurring buy, sent to the holdings that are under target. Nothing is sold. It keeps the mix closer to what you chose; it does not add return.",
                  "A holding counts as off target when it is more than 5 points or more than 25 percent away from its target.",
                  "Buys below $5 are skipped to keep fees low.",
                  "Buying pauses for an asset whose price feed is frozen or out of date, or whose transfers are paused.",
                ]}
              />
            </Section>

            <Section id="borrowing" title="Borrowing and health">
              <p>
                Your vault locks its assets as collateral and borrows USDC from an existing Morpho market. {BRAND.name} runs
                no lending pool. There is no repayment schedule and no forced repayment.
              </p>
              <H3 id="basket">Collateral basket</H3>
              <p>
                Borrowing has two steps. First you lock collateral: any mix of your stocks, cbBTC and Ether, for example
                $1 each of Apple, NVIDIA, cbBTC and Ether for $4 in total. Then you borrow against the total. Each borrow is split across the assets so every
                part ends up equally safe, and each repayment pays the most stretched parts first. Morpho keeps one market
                per asset, so each part can still be liquidated on its own if its own price falls far. The page shows the
                weakest part as well as the total. With no loan open, you can unlock everything in one go.
              </p>
              <p>
                The page also shows what the basket earns in a year: reinvested dividends (each real share&apos;s approximate dividend after the issuer&apos;s 5% fee and up to 30% US tax; the testnet tokens pay none) minus the live interest on the loan.
              </p>
              <H3 id="health">Loan health</H3>
              <p>
                Health = collateral value × the market&apos;s liquidation limit ÷ what you owe. Above 1.00 is safe. At or below
                1.00 the market can sell part of your collateral to repay the loan (liquidation), and the liquidator keeps a
                bonus from it.
              </p>
              <Table
                head={["Market", "Liquidation limit", "Liquidator bonus (approx.)"]}
                rows={SYMBOLS.map((s) => {
                  const l = Number(D[`${s}Lltv`]) / 1e18;
                  const bonus = (Math.min(1.15, 1 / (0.3 * l + 0.7)) - 1) * 100;
                  return [`${ASSET_NAMES[s] ?? s} / USDC`, pct(D[`${s}Lltv`] as number), `${bonus.toFixed(1)}%`];
                })}
              />
              <H3 id="limits">Your borrow limit</H3>
              <p>
                By default you can borrow half of what the market allows, which leaves room for a large price drop before
                liquidation. You can raise your own limit to at most 85% of the maximum. Nobody else can change it.
              </p>
              <H3 id="emergency-rule">Emergency rule</H3>
              <p>
                Choose a health threshold and a share of salary. If that loan is at or below the threshold on payday, at least
                that share buys the asset and goes straight to collateral. It only acts when a salary is claimed, so it is a
                safety habit, not instant protection.
              </p>
              <H3 id="stress">Price gaps and paused transfers</H3>
              <List
                items={[
                  "Stock markets close at night and on weekends, so prices can jump when they reopen. The Risk page shows what a 10, 20 or 30 percent gap would do to your loan.",
                  "If transfers of a stock token are paused, you can still repay, but you cannot add or take out that collateral until transfers resume.",
                  "Interest is set by the market, changes with demand, and is added to what you owe every second.",
                ]}
              />
            </Section>

            <Section id="private-pay" title="Private pay">
              <p>
                Private pay hides salary amounts on chain using Fairblock&apos;s confidential transfers (StableTrust). It is
                real on Base Sepolia, not mocked, and Fairblock also runs it on Base mainnet.
              </p>
              <p>
                Each team member turns on private pay once (the team invite on Home offers it), so their account is ready
                before the first private payday. On Payroll, Pay the team with &quot;Once, now&quot; lists everyone with a Private
                tick box: ticked for people who are ready, and anyone not set up yet is paid the normal way. One Pay all button
                pays the normal ones first (from the treasury), then the private ones (it tops up the employer&apos;s private
                balance from their wallet, then sends each person an encrypted amount). Scheduled paydays are paid the normal way. Only the sender and the receiver can read an amount; each
                decrypts it in their own browser with keys made from one wallet signature. Wallet addresses still show.
              </p>
              <p>
                On My pay, the team member checks their private pay, picks a share to invest (none, 10%, 20% or their own),
                an asset, and whether the rest stays private or goes to their wallet. One button collects the share from the
                private balance and buys the asset into their vault (a one-time buy, so no {BRAND.name} fee). Whatever stays
                private never shows on chain. Fairblock&apos;s network confirms each step, usually within a minute on testnet,
                and may charge a small fee on withdrawals.
              </p>
              <p>
                Choosing &quot;Every payday&quot; saves the split on that device, as percentages only. When new private pay arrives,
                Home and My pay say so (this reads only that an encrypted incoming balance exists, never the amount), and the saved
                split is filled in: one tap collects and invests it. The person still presses the button, because only their
                browser holds their private keys. Employers and team members each keep a private pay record in their own browser,
                with a CSV export for an accountant or auditor.
              </p>
              <p>
                Private pay runs beside {BRAND.name}&apos;s payroll contract, not inside it, because the keys live in each
                person&apos;s browser and a contract cannot send a private payment on its own. {BRAND.name} never holds this money.
                Amounts move in whole cents.
              </p>
            </Section>

            <Section id="testnet" title="Testnet: real and mocked">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <RealBadge>Real</RealBadge>
                  <List
                    items={[
                      `${BRAND.name} payroll, vault and adapter contracts (verified on Sourcify)`,
                      "Morpho lending market, interest model and liquidation rules",
                      "Circle test USDC",
                    ]}
                  />
                </div>
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <MockBadge>Mocked</MockBadge>
                  <List
                    items={["Asset tokens and their price feeds", "The exchange where assets are bought", "The interest venue", "Dividends (the mocks pay none)"]}
                  />
                </div>
              </div>
              <p>
                The same code is tested against real AAPLc, a real Aerodrome pool and the real Morpho AAPLc/USDC market on a
                private copy of Base mainnet.
              </p>
              <H3 id="demo">Demo panel</H3>
              <p>
                Testnet-only switches to show stress scenarios: a price drop, a market closing and reopening lower, paused
                transfers, a price recovery and a quick payday. Only the wallet that deployed the mocks can use the market
                switches. They cannot touch anyone&apos;s vault, salary or loan.
              </p>
              <p>
                Test USDC comes from the <Ext href="https://faucet.circle.com">Circle faucet</Ext>. On testnet the shortest
                payroll rhythm is {Number(D.minScheduleInterval)} seconds so a schedule can be shown in a demo.
              </p>
            </Section>

            <Section id="contracts" title="Contract addresses">
              <p>
                Base Sepolia (chain {Number(D.chainId)}). Copied from <code className="font-mono text-sm">deployments/base-sepolia.json</code>. Each
                address opens on BaseScan.
              </p>
              <H3>{BRAND.name} contracts (no owner)</H3>
              <Table head={["Contract", "Address"]} rows={stackday.map(([n, a]) => [n, <Addr key={a} a={a} />])} />
              <H3>Existing protocols</H3>
              <Table head={["What", "Address"]} rows={protocols.map(([n, a]) => [n, <Addr key={a} a={a} />])} />
              <H3>Morpho markets</H3>
              <Table
                head={["Market", "Limit", "Market id"]}
                rows={SYMBOLS.map((s) => [`${s} / USDC`, pct(D[`${s}Lltv`] as number), <Hex key={s} v={D[`${s}MarketId`] as string} />])}
              />
              <H3>Testnet mocks (owned by the demo wallet)</H3>
              <Table head={["Mock", "Address"]} rows={mocks.map(([n, a]) => [n, <Addr key={a} a={a} />])} />
            </Section>

            <Section id="security" title="Security and risks">
              <Callout tone="warn">No independent audit. Do not use with real money.</Callout>
              <H3>Built in</H3>
              <List
                items={[
                  "No admin or owner function can move funds out of a vault. Vaults cannot be re-initialised or taken over.",
                  "Adapters act only on the caller's own position and hold nothing between calls.",
                  "Employer treasuries are separate. A paused schedule pays nothing, and resuming gives no back pay.",
                  "The fee is fixed and capped, and its wallet has no powers.",
                ]}
              />
              <H3>Known limits</H3>
              <List
                items={[
                  "Tokenized stocks have an issuer who can pause, block or seize tokens. No contract can protect against that.",
                  "A vault has one owner key and no recovery.",
                  "The emergency rule only acts on payday. Between paydays there is no automatic protection.",
                  "Morpho, USDC, the interest venue and the price feeds are outside protocols. The app depends on them but does not control them.",
                  "A stranger can send tiny paydays to an address. They cannot take or block anything, but heavy spam could hide an older unclaimed salary from the screen (it stays claimable).",
                  "Names, team lists and attendance in the account database are only as private as that database.",
                ]}
              />
            </Section>

            <Section id="notices" title="Notices">
              <List
                items={[
                  "Coinbase tokenized stocks are only available to eligible persons outside the United States.",
                  "Tokenized stocks track the price of a share. They carry no voting rights or other shareholder rights.",
                  `Nothing in ${BRAND.name} is financial or investment advice. It shows what your choices and published rules produce, and you confirm every purchase.`,
                  "Prices can fall. Borrowing can lead to liquidation and the loss of part of your collateral. Past prices say nothing about the future.",
                  `${BRAND.name} is a hackathon demo on a test network. It is not deployed to Base mainnet and has not had an independent security audit.`,
                  `${BRAND.name} is not affiliated with or endorsed by Base, Coinbase, Morpho or any company whose stock appears in the app.`,
                ]}
              />
            </Section>

            <Section id="faq" title="FAQ">
              <div className="divide-y divide-line border-y border-line">
                {FAQ.map((f) => (
                  <details key={f.q} className="faq group">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-[16px] font-semibold tracking-tight text-ink">
                      {f.q}
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sunken text-muted transition-transform duration-200 ease-[var(--ease-out)] group-open:rotate-45" aria-hidden>
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </span>
                    </summary>
                    <p className="pb-4 pr-12 text-[15px] leading-relaxed text-muted">{f.a}</p>
                  </details>
                ))}
              </div>
            </Section>

            <Section id="links" title="Links">
              <List
                items={[
                  <Link key="app" href="/dashboard" className="font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2">
                    Open the app
                  </Link>,
                  <Link key="risk" href="/risk" className="font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2">
                    Risk page and stress test
                  </Link>,
                  <Ext key="scan" href={`${EXPLORER}/address/${D.payroll}`}>
                    Payroll contract on BaseScan
                  </Ext>,
                  <Ext key="sourcify" href={`https://repo.sourcify.dev/84532/${D.payroll}`}>
                    Verified source on Sourcify
                  </Ext>,
                  <Ext key="morpho" href="https://docs.morpho.org">
                    Morpho docs
                  </Ext>,
                  <Ext key="faucet" href="https://faucet.circle.com">
                    Circle test USDC faucet
                  </Ext>,
                ]}
              />
            </Section>
          </main>
        </div>
      </div>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs text-muted sm:px-8">
          <span>Built on Base. Testnet demo, not audited. Not investment advice.</span>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}
