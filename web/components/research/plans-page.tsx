"use client";

import { Badge, Card, Notice, PageHeader, Skeleton, cx } from "@/components/ui";
import { getAccess, type AccessInfo } from "./api";
import { Disclaimer, LoadError, ResearchTabs, SampleBanner, fmtDate, useLoad } from "./bits";

const PLAN_CARDS: { key: keyof AccessInfo["prices"]; label: string; period: string; features: string[] }[] = [
  {
    key: "weekly-single",
    label: "One Monday report",
    period: "for one report",
    features: ["The full report for one Monday", "All six assets: chart read, scenarios, this week's view, borrowing note", "Investment ideas and last week's scorecard"],
  },
  {
    key: "monthly",
    label: "Monthly",
    period: "per month",
    features: ["Every Monday report for a month (four or five)", "Everything in the single report", "The public scorecard stays free for everyone"],
  },
];

const price = (v: number | null, period: string) => (v === null ? "Not set" : `${v.toLocaleString("en-US")} test USDC ${period}`);

export function PlansPage() {
  const access = useLoad(getAccess, "access");

  return (
    <>
      <PageHeader title="Plans" lead="The Monday report is a free beta preview for now. These plans are a proposal for later." />
      <ResearchTabs />

      <Notice tone="grow">
        The paywall is off. The weekly report is a free beta preview until it has met the quality bar for four Mondays in a row and a legal check is
        done. Nothing is charged until then.
      </Notice>

      {access.status === "loading" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-[18px]" />
          ))}
        </div>
      ) : access.status === "error" ? (
        <LoadError error={access.error} />
      ) : (
        <>
          <SampleBanner show={access.from === "sample"}>The plans service is not live, so no proposed amounts are shown. {access.why}</SampleBanner>
          {access.data.paywallEnabled && <Notice tone="warn">Payments are switched on in this environment. They use test USDC on Base Sepolia only, with no real value.</Notice>}

          {access.data.entitlement && (
            <Card title="Your plan">
              <p className="text-[13px]">
                <span className="font-medium capitalize">{access.data.entitlement.plan.replace(/-/g, " ")}</span>
                {access.data.entitlement.validUntil && <span className="text-muted"> until {fmtDate(access.data.entitlement.validUntil)}</span>}
                {access.data.entitlement.weeklyCredits > 0 && <span className="text-muted"> · {access.data.entitlement.weeklyCredits} Monday reports left to open</span>}
              </p>
            </Card>
          )}

          <ul className="grid gap-3 sm:grid-cols-2">
            {PLAN_CARDS.map((o) => {
              const v = access.data.prices[o.key];
              return (
                <li key={o.key} className="flex">
                  <section aria-labelledby={`plan-${o.key}`} className="flex w-full flex-col rounded-[18px] border border-line bg-surface p-4 shadow-card sm:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 id={`plan-${o.key}`} className="text-sm font-semibold">
                        {o.label}
                      </h2>
                      <Badge tone="warn">Proposal</Badge>
                    </div>
                    <p className={cx("mt-2 font-display text-[22px] tracking-[-0.02em]", v === null ? "text-muted" : "text-ink")}>{price(v, o.period)}</p>
                    <p className="mt-1 text-xs text-muted">Proposed amount, for the founder to decide. Not charged.</p>
                    <ul className="mt-3 flex-1 space-y-1.5 text-[13px] text-ink-soft">
                      {o.features.map((f) => (
                        <li key={f} className="flex gap-2">
                          <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-grow" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 8.5l2.5 2.5L12 5.5" />
                          </svg>
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button type="button" disabled className="mt-4 inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-[10px] border border-line bg-press text-[13px] font-medium text-muted sm:min-h-9">
                      Free during the beta
                    </button>
                  </section>
                </li>
              );
            })}
          </ul>
          <p className="text-xs leading-relaxed text-muted">
            When payments are switched on, a plan is paid with a small USDC transfer from your own wallet and checked on the server. Testnet only until
            mainnet.
          </p>
        </>
      )}

      <Disclaimer />
    </>
  );
}
