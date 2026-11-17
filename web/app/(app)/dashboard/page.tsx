"use client";

import { LearnMore } from "@/components/learn-more";
import { PrivatePaySetup, PrivatePayWaiting } from "@/components/private-collect";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useViewer } from "@/components/providers";
import {
  AddressLink,
  AssetIcon,
  Button,
  buttonClass,
  cx,
  Skeleton,
  Card,
  Empty,
  Field,
  HealthMeter,
  Money,
  Notice,
  PageHeader,
  SplitBar,
  Stat,
} from "@/components/ui";
import { assetByToken } from "@/lib/contracts";
import { fmtAsset, fmtHealth, fmtPct, fmtPrice, fmtUsdc, intervalLabel, until } from "@/lib/format";
import { answerInvite, saveUsername, useAccountState, useAttendance, useLastDays, useNames } from "@/lib/useAccount";
import { usePortfolio, type Portfolio } from "@/lib/usePortfolio";

function useNow() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Invitations({ canAct }: { canAct: boolean }) {
  const account = useAccountState();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const teams = account.me?.memberships ?? [];
  const names = useNames(teams.map((t) => t.employer));
  if (teams.length === 0) return null;

  async function answer(employer: string, action: "accept" | "decline") {
    setBusy(employer);
    setError(undefined);
    try {
      await answerInvite(employer, action);
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your answer.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Card title="Your teams">
      <div className="divide-y divide-line">
        {teams.map((t) => (
          <div key={t.employer} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {t.businessName ?? names.display(t.employer)}
                {t.role && <span className="font-normal text-muted"> · {t.role}</span>}
              </div>
              <div className="text-xs text-muted">
                {t.status === "invited"
                  ? "Added you to their team. They can already pay you. If you accept, they can also see the days you check in."
                  : "You are on this team. They can see the days you check in."}
              </div>
            </div>
            {t.status === "invited" ? (
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === t.employer} onClick={() => answer(t.employer, "accept")}>
                  Accept
                </Button>
                <Button size="sm" variant="secondary" disabled={busy === t.employer} onClick={() => answer(t.employer, "decline")}>
                  Decline
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy === t.employer} onClick={() => answer(t.employer, "decline")}>
                Leave
              </Button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <PrivatePaySetup address={account.address} canAct={canAct} />
    </Card>
  );
}

function Account({ canAct, wallet }: { canAct: boolean; wallet?: string }) {
  const account = useAccountState();
  const session = account.session;
  const names = useNames([wallet]);
  const attendance = useAttendance(session.configured && session.signedIn);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const current = names.nameOf(wallet);
  const days = useLastDays(14);
  const checkedToday = attendance.data?.mine.includes(attendance.data.today) ?? false;
  const uid = account.me?.profile.uid ?? names.idOf(wallet);

  if (!session.configured)
    return (
      <Card title="Your account">
        <p className="text-sm leading-relaxed text-muted">
          Sign-in is not available right now. Your money does not depend on it.
        </p>
      </Card>
    );

  async function save() {
    setSaving(true);
    setMessage(undefined);
    try {
      await saveUsername(name);
      setMessage({ ok: true, text: "Name saved." });
      setName("");
      window.location.reload();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Could not save." });
    } finally {
      setSaving(false);
    }
  }

  async function copyId() {
    if (!uid) return;
    await navigator.clipboard.writeText(uid).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const idRow = uid && (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sunken/70 px-4 py-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Your Stackday ID</div>
        <div className="mt-0.5 font-mono text-lg font-semibold tracking-wide">{uid}</div>
        <div className="text-xs text-muted">
          {account.mode === "personal" ? "Your unique ID on Stackday." : "Give this to a business so it can find you and add you to its team."}
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={copyId}>
        {copied ? "Copied" : "Copy ID"}
      </Button>
    </div>
  );

  return (
    <Card
      title="Your account"
      action={
        account.role ? (
          <Link href="/start" className="text-xs font-semibold text-brand underline">
            {account.role === "individual" ? "Personal" : account.role === "owner" ? "Business owner" : "Team member"} · change
          </Link>
        ) : undefined
      }
    >
      {idRow}
      {!session.signedIn ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {current ? (
              <>
                This wallet is <strong className="text-ink">@{current}</strong>. Sign in to change it or check in.
              </>
            ) : (
              (account.mode === "personal" ? "Sign in to pick a name. It is one free signature." : "Sign in to pick a name and check in. It is one free signature.")
            )}
          </p>
          <Button variant="ink" disabled={!canAct || session.busy} onClick={session.signIn}>
            {session.busy ? "Check your wallet…" : "Sign in with wallet"}
          </Button>
          {session.error && <p className="w-full text-sm text-danger">{session.error}</p>}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted">
              {current ? (
                <>
                  You are <strong className="text-ink">@{current}</strong>.
                </>
              ) : (
                "Pick a unique name to show instead of your address."
              )}
            </p>
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label={current ? "Change name" : "Name"}
                  placeholder="for example maya_k"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  maxLength={20}
                />
              </div>
              <Button variant="secondary" disabled={saving || name.length < 3} onClick={save}>
                Save
              </Button>
            </div>
            {message && <p className={`mt-2 text-sm ${message.ok ? "text-grow" : "text-danger"}`}>{message.text}</p>}
          </div>
          {account.mode !== "personal" && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">Attendance, last 14 days</p>
              <Button size="sm" variant={checkedToday ? "secondary" : "primary"} disabled={checkedToday} onClick={attendance.checkIn}>
                {checkedToday ? "Checked in today" : "Check in for today"}
              </Button>
            </div>
            <div className="mt-3 flex gap-1" role="img" aria-label="Attendance for the last 14 days">
              {days.map((d) => (
                <span
                  key={d}
                  title={d}
                  className={`h-7 flex-1 rounded-md transition-colors duration-300 ${
                    attendance.data?.mine.includes(d) ? "bg-grow" : "bg-sunken"
                  }`}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Only teams you accept can see it. Does not change your pay.</p>
          </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Plans({ p, now }: { p: Portfolio; now: number }) {
  const personal = useAccountState().mode === "personal";
  const names = useNames(p.schedulesPayingMe.map((s) => s.employer));
  const recurring = p.positions.filter((x) => x.recurring);
  const ruleAsset = assetByToken(p.emergencyRule?.asset);
  // Personal is plain investing: salary plans, payroll schedules and the salary-based emergency rule stay in Business.
  const salaryPlans = !personal;
  const nothing =
    recurring.length === 0 && (!salaryPlans || (p.sipPlan.length === 0 && !p.emergencyRule && p.schedulesPayingMe.length === 0));

  return (
    <Card title="Your plans">
      {nothing ? (
        <Empty>
          {personal ? (
            <>
              No plans yet. Start a recurring buy on{" "}
              <Link href="/invest" className="font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink">
                Invest
              </Link>
              .
            </>
          ) : (
            <>
              No plans yet. Set a share of every salary on{" "}
              <Link href="/pay" className="font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink">
                My pay
              </Link>
              .
            </>
          )}
        </Empty>
      ) : (
        <div className="divide-y divide-line">
          {salaryPlans && p.schedulesPayingMe.map((s) => (
            <div key={`s${s.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
              <div>
                <div className="text-sm font-semibold">
                  Salary from {names.display(s.employer)} · {intervalLabel(s.interval)}
                </div>
                <div className="text-xs text-muted">
                  {s.active ? `Next payday ${until(s.nextPayAt, now)}` : "Paused by the employer"}
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums">{fmtUsdc(s.mine)} USDC</div>
            </div>
          ))}
          {salaryPlans && p.sipPlan.length > 0 && (
            <div className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Payday plan</div>
                <Link href="/pay" className="text-xs font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink">
                  Change
                </Link>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {p.sipPlan.map((leg) => {
                  const a = assetByToken(leg.asset);
                  return a ? (
                    <span key={a.symbol} className="inline-flex items-center gap-2 rounded-full bg-sunken py-1 pl-1 pr-3 text-[13px] font-semibold">
                      <AssetIcon asset={a} size={22} /> {fmtPct(leg.bps)} into {a.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
          {recurring.map((x) => (
            <div key={`r${x.asset.symbol}`} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <AssetIcon asset={x.asset} size={30} />
                <div>
                  <div className="text-sm font-semibold">
                    {fmtUsdc(x.recurring!.usdcPerBuy)} USDC into {x.asset.name} · {intervalLabel(x.recurring!.interval)}
                  </div>
                  <div className="text-xs text-muted">Recurring buy from your wallet. Next {until(x.recurring!.nextBuyAt, now)}.</div>
                </div>
              </div>
              <Link href="/invest" className="text-xs font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink">
                Manage
              </Link>
            </div>
          ))}
          {salaryPlans && p.emergencyRule && ruleAsset && (
            <div className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
              <div>
                <div className="text-sm font-semibold">Emergency rule on your {ruleAsset.name} loan</div>
                <div className="text-xs text-muted">
                  If health is at or below {fmtHealth(p.emergencyRule.threshold)}, {fmtPct(p.emergencyRule.bps)} of the next
                  salary goes to collateral. {p.emergencyActive ? "Active right now." : "Not triggered."}
                </div>
              </div>
              <Link href="/borrow" className="text-xs font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink">
                Change
              </Link>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Signed dollar change and percent, for "Total invested" against what it is worth now. */
function Change({ now, putIn }: { now: bigint; putIn: bigint }) {
  if (putIn === 0n) return <span className="text-muted">-</span>;
  const diff = now - putIn;
  const pct = Number((diff * 10_000n) / putIn) / 100;
  // Amounts are shown in whole cents, so under one cent is flat, not a red "-$0.00".
  const flat = diff > -10_000n && diff < 10_000n;
  const up = diff >= 0n;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-semibold tabular-nums",
        flat ? "bg-sunken text-muted" : up ? "bg-grow-soft text-grow" : "bg-danger-soft text-danger",
      )}
    >
      {!flat && (
        <svg aria-hidden viewBox="0 0 12 12" className={cx("h-2.5 w-2.5", !up && "rotate-180")}>
          <path d="M6 2.5 10 8H2z" fill="currentColor" />
        </svg>
      )}
      <span className="sr-only">{flat ? "No change" : up ? "Up" : "Down"}</span>
      {flat ? (
        "$0.00 (0.0%)"
      ) : (
        <>
          {up ? "+" : "-"}${fmtUsdc(up ? diff : -diff)} ({up ? "+" : ""}
          {pct.toFixed(1)}%)
        </>
      )}
    </span>
  );
}

function HoldingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading holdings">
      <Skeleton className="h-3.5 w-full rounded-full" />
      <div className="mt-5 divide-y divide-line">
        {[0, 1].map((i) => (
          <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 first:pt-0 last:pb-0">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-1.5 w-40 rounded-full" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  // Business team members see this page as Holdings; Personal users as Home.
  const { mode } = useAccountState();
  const businessMode = mode !== "personal";
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const names = useNames([viewer.address]);
  const now = useNow();
  const cash = p.earning + p.vaultUsdc;
  const netWorth = p.totalAssetValue + cash - p.totalDebt;
  const held = p.positions.filter((x) => x.idle + x.collateral > 0n);
  const loans = p.positions.filter((x) => x.debt > 0n);
  const heldTotal = held.reduce((a, x) => a + x.value, 0n);
  const name = names.nameOf(viewer.address);

  return (
    <>
      <PageHeader
        title={name ? `Hello, ${name}` : "Home"}
        lead={
          <>
            {businessMode ? "What your pay has bought, and any loans against it." : "Your investments, plans and loans."}{" "}
            <LearnMore href="/docs#vault" />
          </>
        }
        aside={p.vault && <AddressLink address={p.vault} label="Your vault on BaseScan" />}
      />

      {!viewer.address && <Notice>Connect your wallet (top right) to see your dashboard.</Notice>}
      {viewer.address && <PrivatePayWaiting address={viewer.address} />}

      {businessMode && p.totalClaimable > 0n && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-brand p-5 text-white shadow-brand sm:p-6">
          <div>
            <div className="text-[13px] font-medium text-white/70">Salary waiting for you</div>
            <div className="mt-1 font-display text-5xl font-semibold leading-none tracking-[-0.03em]">
              <Money value={p.totalClaimable} />
            </div>
          </div>
          <Link
            href="/pay"
            className="inline-flex min-h-12 items-center rounded-full bg-white px-6 text-[15px] font-semibold text-[#0040cc] shadow-sm transition-[transform,background-color] duration-150 hover:bg-white/90 active:scale-[0.97] focus-visible:outline-white"
          >
            Claim it
          </Link>
        </div>
      )}

      <Card tone="ink">
        <div className="grid gap-8 sm:grid-cols-[1.2fr_1fr] sm:items-end">
          <div>
            <div className="text-[13px] font-medium text-muted">Net worth in your vault</div>
            <div className="money-sheen mt-2 font-display text-6xl font-semibold leading-none tracking-[-0.03em] sm:text-7xl">
              <Money value={viewer.address ? netWorth : 0n} />
            </div>
            <p className="mt-3 text-sm text-muted">Assets plus cash, minus loans.</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-line rounded-2xl bg-white/[0.04] py-3 shadow-[inset_0_0_0_1px_var(--line)]">
            {[
              { label: "Assets", value: p.totalAssetValue },
              { label: "Cash", value: cash },
              { label: "Borrowed", value: p.totalDebt },
            ].map((s) => (
              <div key={s.label} className="px-4">
                <div className="text-[13px] font-medium text-muted">{s.label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">
                  <Money value={s.value} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card
        title="Holdings"
        action={
          <Link href="/invest" className="text-xs font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink">
            Buy more
          </Link>
        }
      >
        {held.length === 0 && p.loading && viewer.address ? (
          <HoldingsSkeleton />
        ) : held.length === 0 ? (
          <Empty action={<Link href="/invest" className={buttonClass("primary", "sm")}>Make your first buy</Link>}>
            {businessMode ? "Nothing in your vault yet. Your first share of pay or purchase creates it." : "Nothing in your vault yet. Your first purchase creates it."}
          </Empty>
        ) : (
          <>
            {p.totalPutIn > 0n && (
              <div className="mb-5 grid grid-cols-2 gap-4 rounded-2xl bg-sunken/70 p-4 sm:grid-cols-3">
                <Stat label="Total invested" value={`$${fmtUsdc(p.totalPutIn)}`} />
                <Stat label="Worth now" value={`$${fmtUsdc(p.totalAssetValue)}`} />
                <div>
                  <div className="text-[13px] font-medium text-muted">Change</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums">
                    <Change now={p.totalAssetValue} putIn={p.totalPutIn} />
                  </div>
                </div>
              </div>
            )}
            <SplitBar
              parts={held.map((x) => ({ key: x.asset.symbol, value: Number(x.value), color: x.asset.color, label: x.asset.name }))}
              height={12}
            />
            <div className="mt-5 divide-y divide-line">
              {held.map((x) => {
                const share = heldTotal > 0n ? Number((x.value * 1000n) / heldTotal) / 10 : 0;
                return (
                  <div key={x.asset.symbol} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 first:pt-0 last:pb-0">
                    <AssetIcon asset={x.asset} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold">{x.asset.name}</span>
                        <span className="hidden shrink-0 rounded-md bg-sunken px-1.5 py-px font-mono text-[11px] text-muted sm:inline">{x.asset.symbol}</span>
                        {x.collateral > 0n && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-2 py-px text-[11px] font-semibold text-brand-ink">
                            <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5">
                              <rect x="2" y="5.5" width="8" height="5" rx="1.2" fill="currentColor" />
                              <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                            </svg>
                            {x.idle > 0n ? "Part locked" : "Locked"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs tabular-nums text-muted">
                        {fmtAsset(x.idle + x.collateral, x.asset.decimals)} at ${fmtPrice(x.price)}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="track block h-1.5 w-full max-w-40 overflow-hidden rounded-full">
                          <span className="split-seg block h-full rounded-full" style={{ width: `${share}%`, background: x.asset.color }} />
                        </span>
                        <span className="text-[11px] tabular-nums text-muted">{share.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 tabular-nums">
                      <div className="text-[15px] font-semibold">${fmtUsdc(x.value)}</div>
                      {x.putIn > 0n && (
                        <>
                          <div className="text-xs">
                            <Change now={x.value} putIn={x.putIn} />
                          </div>
                          <div className="text-[11px] text-muted">put in ${fmtUsdc(x.putIn)}</div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {p.totalPutIn > 0n && (
          <p className="mt-4 text-xs leading-relaxed text-muted">
            Total invested is the USDC you put in through buys and payday shares, before fees. It never goes down, so
            assets you took out of the vault show up as a loss in Change.
          </p>
        )}
        {cash > 0n && (
          <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
            Cash: ${fmtUsdc(p.earning)} earning interest, ${fmtUsdc(p.vaultUsdc)} idle in the vault.
          </p>
        )}
      </Card>

      <Plans p={p} now={now} />

      {loans.length > 0 && (
        <Card
          title="Your loans"
          action={
            <Link href="/risk" className="text-xs font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink">
              Stress test
            </Link>
          }
        >
          <div className="space-y-6">
            {loans.map((x) => {
              const health = x.health !== undefined ? Number(x.health / 10n ** 14n) / 10_000 : undefined;
              return (
                <div key={x.asset.symbol}>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AssetIcon asset={x.asset} size={30} />
                      <div className="text-sm font-semibold">Borrowed against {x.asset.name}</div>
                    </div>
                    <div className="flex gap-6">
                      <Stat label="Loan" value={`$${fmtUsdc(x.debt)}`} />
                      <Stat label="Health" value={fmtHealth(x.health)} />
                    </div>
                  </div>
                  <HealthMeter health={health} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {businessMode && <Invitations canAct={viewer.canAct} />}

      <Account canAct={viewer.canAct} wallet={viewer.address} />
    </>
  );
}
