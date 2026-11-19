"use client";

import { useState } from "react";
import { useViewer } from "@/components/providers";
import { Badge, Button, Card, Notice, PageHeader, Skeleton, cx } from "@/components/ui";
import type { Plan } from "@/lib/research/types";
import { getAccess, type PlanOffer } from "./api";
import { Disclaimer, LoadError, ResearchTabs, fmtDate, useLoad } from "./bits";

function price(o: PlanOffer) {
  if (o.priceUsdc === 0) return "Free";
  if (o.priceUsdc === null) return "Price not set yet";
  return `${o.priceUsdc.toLocaleString("en-US")} test USDC${o.period ? (o.period.startsWith("per ") ? ` ${o.period}` : ` for ${o.period}`) : ""}`;
}

export function PlansPage() {
  const viewer = useViewer();
  const access = useLoad(getAccess, "access");
  const [chosen, setChosen] = useState<Plan | null>(null);

  return (
    <>
      <PageHeader title="Plans" lead="The research list and asset pages are free. Plans add deeper reports." />
      <ResearchTabs />

      {access.status === "loading" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-[18px]" />
          ))}
        </div>
      ) : access.status === "error" ? (
        <LoadError error={access.error} />
      ) : (
        <>
          {access.data.sample && (
            <Notice tone="warn">
              <Badge tone="warn">Sample data</Badge> The plans service is not live yet, so this shows placeholder plans with no prices.
            </Notice>
          )}
          {!access.data.paywallEnabled ? (
            <Notice tone="grow">Payments are off for now. Every report is free while pricing is agreed.</Notice>
          ) : (
            <Notice>Payments use test USDC on Base Sepolia. No real money is involved.</Notice>
          )}

          {access.data.entitlement && (
            <Card title="Your plan">
              <p className="text-[13px]">
                <span className="font-medium capitalize">{access.data.entitlement.plan.replace(/-/g, " ")}</span>
                {access.data.entitlement.validUntil && <span className="text-muted"> until {fmtDate(access.data.entitlement.validUntil)}</span>}
                {access.data.entitlement.reportCredits > 0 && (
                  <span className="text-muted"> · {access.data.entitlement.reportCredits} report credits left</span>
                )}
                {access.data.entitlement.premium && (
                  <span className="ml-2">
                    <Badge tone="brand">Premium</Badge>
                  </span>
                )}
              </p>
            </Card>
          )}

          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {access.data.plans.map((o) => {
              const current = access.data.entitlement?.plan === o.plan;
              const payable = access.data.paywallEnabled && o.priceUsdc !== null && o.priceUsdc > 0;
              return (
                <li key={o.plan} className="flex">
                  <section
                    aria-labelledby={`plan-${o.plan}`}
                    className={cx(
                      "flex w-full flex-col rounded-[18px] border bg-surface p-4 shadow-card sm:p-5",
                      current ? "border-[color-mix(in_srgb,var(--brand)_55%,transparent)]" : "border-line",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h2 id={`plan-${o.plan}`} className="text-sm font-semibold">
                        {o.label}
                      </h2>
                      {current && <Badge tone="brand">Your plan</Badge>}
                    </div>
                    <p className={cx("mt-2 font-display text-[22px] tracking-[-0.02em]", o.priceUsdc === null ? "text-muted" : "text-ink")}>{price(o)}</p>
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
                    {o.priceUsdc !== 0 && (
                      <Button
                        className="mt-4 w-full"
                        variant={chosen === o.plan ? "primary" : "secondary"}
                        disabled={!payable || current || !viewer.address}
                        onClick={() => setChosen(o.plan)}
                      >
                        {!access.data.paywallEnabled ? "Payments are off" : current ? "Current plan" : `Choose ${o.label}`}
                      </Button>
                    )}
                  </section>
                </li>
              );
            })}
          </ul>

          {access.data.paywallEnabled && !viewer.address && <Notice>Connect a wallet to choose a plan.</Notice>}
          {chosen && access.data.paywallEnabled && (
            <Card title="Pay with test USDC">
              <Notice tone="warn">
                The payment step is a placeholder in this build. When it is switched on, you send test USDC on Base Sepolia from your own wallet
                and the server checks the transfer before the plan starts. Nothing has been charged.
              </Notice>
              <Button className="mt-3" variant="ghost" onClick={() => setChosen(null)}>
                Cancel
              </Button>
            </Card>
          )}
        </>
      )}

      <Disclaimer />
    </>
  );
}
