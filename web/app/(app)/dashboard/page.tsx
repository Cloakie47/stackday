"use client";

import { LearnMore } from "@/components/learn-more";
import { PrivatePaySetup, PrivatePayWaiting } from "@/components/private-collect";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
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
  Responsive,
  SplitBar,
  Stat,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { assetByToken } from "@/lib/contracts";
import { fmtAsset, fmtHealth, fmtPct, fmtPrice, fmtUsdc, intervalLabel, until } from "@/lib/format";
import { answerInvite, saveUsername, useAccountState, useAttendance, useLastDays, useNames } from "@/lib/useAccount";
import { usePortfolio, type Portfolio, type Position } from "@/lib/usePortfolio";

/** A quiet text link for card headers ("Buy", "Manage"). */
const ACTION_LINK = "rounded-sm text-[13px] font-medium text-brand-ink underline-offset-[3px] hover:underline";

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
                {t.status === "invited" ? (
                  <Responsive
                    m="Can pay you now. Accept to share check-ins."
                    d="Wants to add you to their team. They can pay you now. Accept to also share your check-ins."
                  />
                ) : (
                  "You're on this team. They can see your check-ins."
                )}
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
        <p className="text-sm leading-relaxed text-muted">Sign-in is down right now. Your funds are not affected.</p>
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
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5">
      <div>
        <div className="text-[13px] font-medium text-muted">
          Your {BRAND.name} ID
        </div>
        <div className="mt-0.5 font-mono text-base font-medium tracking-wide">{uid}</div>
        {account.mode !== "personal" && (
          <div className="mt-0.5 text-xs text-muted">
            <Responsive m="Share with your employer." d="Share it with your employer so they can add you." />
          </div>
        )}
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
          <Link href="/start" className={ACTION_LINK}>
            {account.role === "individual" ? "Personal" : account.role === "owner" ? "Business owner" : "Team member"} · Change
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
                This wallet is <strong className="font-medium text-ink">@{current}</strong>. Sign in to change it or check in.
              </>
            ) : account.mode === "personal" ? (
              "Sign in to pick a name. One free signature."
            ) : (
              "Sign in to pick a name and check in. One free signature."
            )}
          </p>
          <Button variant="secondary" disabled={!canAct || session.busy} onClick={session.signIn}>
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
                  You are <strong className="font-medium text-ink">@{current}</strong>.
                </>
              ) : (
                "Pick a unique name to show instead of your address."
              )}
            </p>
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label={current ? "Change name" : "Name"}
                  placeholder="maya_k"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  maxLength={20}
                />
              </div>
              <Button variant="secondary" className="min-h-11" disabled={saving || name.length < 3} onClick={save}>
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
                  {checkedToday ? "Checked in today" : "Check in"}
                </Button>
              </div>
              <div className="mt-3 flex gap-1" role="img" aria-label="Attendance for the last 14 days">
                {days.map((d) => (
                  <span
                    key={d}
                    title={d}
                    className={`h-7 flex-1 rounded-[4px] transition-colors duration-300 ${attendance.data?.mine.includes(d) ? "bg-grow" : "bg-sunken"}`}
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

function PlanRow({ title, meta, aside }: { title: ReactNode; meta?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{title}</div>
        {meta && <div className="mt-0.5 text-xs text-muted">{meta}</div>}
      </div>
      {aside}
    </div>
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
        <Empty
          title="No plans yet"
          action={
            <Link href={personal ? "/invest" : "/pay"} className={buttonClass("secondary", "sm")}>
              {personal ? "Start a recurring buy" : "Set a payday plan"}
            </Link>
          }
        >
          {personal ? "Recurring buys you start on Invest show here." : "A payday plan invests a share of every salary. Set one on My pay."}
        </Empty>
      ) : (
        <div className="divide-y divide-line">
          {salaryPlans &&
            p.schedulesPayingMe.map((s) => (
              <PlanRow
                key={`s${s.id}`}
                title={
                  <>
                    Salary from {names.display(s.employer)} · {intervalLabel(s.interval)}
                  </>
                }
                meta={s.active ? `Next payday ${until(s.nextPayAt, now)}` : "Paused by the employer"}
                aside={<div className="text-sm font-medium tabular-nums">{fmtUsdc(s.mine)} USDC</div>}
              />
            ))}
          {salaryPlans && p.sipPlan.length > 0 && (
            <div className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Payday plan</div>
                <Link href="/pay" className={ACTION_LINK}>
                  Change
                </Link>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {p.sipPlan.map((leg) => {
                  const a = assetByToken(leg.asset);
                  return a ? (
                    <span key={a.symbol} className="inline-flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 text-[13px] font-medium">
                      <AssetIcon asset={a} size={20} /> {fmtPct(leg.bps)} into {a.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
          {recurring.map((x) => (
            <div key={`r${x.asset.symbol}`} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-3">
                <AssetIcon asset={x.asset} size={28} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {fmtUsdc(x.recurring!.usdcPerBuy)} USDC into {x.asset.name} · {intervalLabel(x.recurring!.interval)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    <Responsive m={`Next ${until(x.recurring!.nextBuyAt, now)}`} d={`Recurring buy from your wallet. Next ${until(x.recurring!.nextBuyAt, now)}.`} />
                  </div>
                </div>
              </div>
              <Link href="/invest" className={ACTION_LINK}>
                Manage
              </Link>
            </div>
          ))}
          {salaryPlans && p.emergencyRule && ruleAsset && (
            <PlanRow
              title={<>Emergency rule on your {ruleAsset.name} loan</>}
              meta={
                <>
                  If health is at or below {fmtHealth(p.emergencyRule.threshold)}, {fmtPct(p.emergencyRule.bps)} of the next salary goes to
                  collateral. {p.emergencyActive ? "Active right now." : "Not triggered."}
                </>
              }
              aside={
                <Link href="/borrow" className={ACTION_LINK}>
                  Change
                </Link>
              }
            />
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
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-medium tabular-nums",
        flat ? "bg-sunken text-ink-soft" : up ? "bg-grow-soft text-grow" : "bg-danger-soft text-danger",
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
          {up ? "+" : "−"}${fmtUsdc(up ? diff : -diff)} ({up ? "+" : "−"}
          {Math.abs(pct).toFixed(1)}%)
        </>
      )}
    </span>
  );
}

function ShareBar({ share, color }: { share: number; color: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="block h-1 w-16 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${share}%`, background: color }} />
      </span>
      <span className="w-12 text-right text-xs tabular-nums text-muted">{share.toFixed(1)}%</span>
    </span>
  );
}

function LockBadge({ x }: { x: Position }) {
  if (x.collateral === 0n) return null;
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-sunken px-1.5 text-xs font-medium text-ink-soft">
      <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5">
        <rect x="2" y="5.5" width="8" height="5" rx="1.2" fill="currentColor" />
        <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      {x.idle > 0n ? "Part locked" : "Locked"}
    </span>
  );
}

function HoldingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading holdings" className="divide-y divide-line">
      {[0, 1].map((i) => (
        <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 first:pt-0 last:pb-0">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HoldingsTable({ held, heldTotal }: { held: Position[]; heldTotal: bigint }) {
  const share = (x: Position) => (heldTotal > 0n ? Number((x.value * 1000n) / heldTotal) / 10 : 0);
  const th = "h-10 px-3 text-xs font-medium text-muted first:pl-5 last:pr-5";
  const td = "h-16 px-3 first:pl-5 last:pr-5";
  return (
    <>
      {/* Desktop and tablet: a real table, full-bleed under the card header. */}
      <div className="-mx-4 hidden overflow-x-auto border-t border-line sm:-mx-5 md:block">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <th scope="col" className={th}>
                Asset
              </th>
              <th scope="col" className={cx(th, "text-right")}>
                Amount
              </th>
              <th scope="col" className={cx(th, "text-right")}>
                Price
              </th>
              <th scope="col" className={cx(th, "text-right")}>
                Value
              </th>
              <th scope="col" className={cx(th, "text-right")}>
                Change
              </th>
              <th scope="col" className={cx(th, "text-right")}>
                Share
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {held.map((x) => (
              <tr key={x.asset.symbol} className="transition-colors duration-100 hover:bg-hover">
                <td className={td}>
                  <div className="flex items-center gap-3">
                    <AssetIcon asset={x.asset} size={32} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-ink">{x.asset.name}</span>
                        <LockBadge x={x} />
                      </div>
                      <div className="text-xs text-muted">{x.asset.symbol}</div>
                    </div>
                  </div>
                </td>
                <td className={cx(td, "text-right tabular-nums text-ink")}>{fmtAsset(x.idle + x.collateral, x.asset.decimals)}</td>
                <td className={cx(td, "text-right tabular-nums text-ink")}>${fmtPrice(x.price)}</td>
                <td className={cx(td, "text-right tabular-nums")}>
                  <div className="font-medium text-ink">${fmtUsdc(x.value)}</div>
                  {x.putIn > 0n && <div className="text-xs text-muted">Invested ${fmtUsdc(x.putIn)}</div>}
                </td>
                <td className={cx(td, "text-right")}>{x.putIn > 0n ? <Change now={x.value} putIn={x.putIn} /> : <span className="text-muted">-</span>}</td>
                <td className={cx(td, "text-right")}>
                  <ShareBar share={share(x)} color={x.asset.color} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: divided rows inside the same card. */}
      <ul className="-mx-4 divide-y divide-line border-t border-line sm:-mx-5 md:hidden">
        {held.map((x) => (
          <li key={x.asset.symbol} className="px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-3">
              <AssetIcon asset={x.asset} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{x.asset.name}</span>
                  <LockBadge x={x} />
                </div>
                <div className="truncate text-xs tabular-nums text-muted">
                  {fmtAsset(x.idle + x.collateral, x.asset.decimals)} {x.asset.symbol}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[15px] font-semibold tabular-nums text-ink">${fmtUsdc(x.value)}</div>
                <div className="text-xs tabular-nums text-muted">${fmtPrice(x.price)}</div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 pl-11">
              <div>
                <dt className="text-xs text-muted">Change</dt>
                <dd className="mt-1">{x.putIn > 0n ? <Change now={x.value} putIn={x.putIn} /> : <span className="text-[13px] text-muted">-</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Share</dt>
                <dd className="mt-1.5">
                  <ShareBar share={share(x)} color={x.asset.color} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
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

      {!viewer.address && <Notice>Connect your wallet to see your dashboard.</Notice>}
      {viewer.address && <PrivatePayWaiting address={viewer.address} />}

      {businessMode && p.totalClaimable > 0n && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium text-muted">Salary to claim</div>
              <div className="mt-1 text-[28px] font-semibold leading-8 tracking-[-0.02em] tabular-nums">
                <Money value={p.totalClaimable} />
              </div>
            </div>
            <Link href="/pay" className={buttonClass("primary", "md")}>
              Claim
            </Link>
          </div>
        </Card>
      )}

      <Card tone="feature">
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-8">
          <div>
            <div className="text-[13px] font-medium text-muted">Net worth</div>
            <div className="mt-1.5 font-display text-[36px] font-semibold leading-10 tracking-[-0.03em] text-ink sm:text-[44px] sm:leading-[48px]">
              <Money value={viewer.address ? netWorth : 0n} />
            </div>
            <p className="mt-1.5 text-[13px] text-muted">Assets plus cash, minus loans.</p>
          </div>
          <dl className="grid grid-cols-3 border-t border-line pt-4 md:border-t-0 md:pt-0">
            {[
              { label: "Assets", value: p.totalAssetValue },
              { label: "Cash", value: cash },
              { label: "Loans", value: p.totalDebt },
            ].map((s, i) => (
              <div key={s.label} className={cx("min-w-0 md:px-6", i > 0 && "border-l border-line pl-4", i === 2 && "md:pr-0")}>
                <dt className="text-[13px] font-medium text-muted">{s.label}</dt>
                <dd className="mt-1 truncate text-lg font-semibold tabular-nums tracking-[-0.015em] text-ink sm:text-[22px] sm:leading-7">
                  ${fmtUsdc(s.value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <Card
        title="Holdings"
        action={
          <Link href="/invest" className={ACTION_LINK}>
            Buy
          </Link>
        }
      >
        {held.length === 0 && p.loading && viewer.address ? (
          <HoldingsSkeleton />
        ) : held.length === 0 ? (
          <Empty title="No assets yet" action={<Link href="/invest" className={buttonClass("primary", "sm")}>Make your first buy</Link>}>
            <Responsive
              m="Your first buy creates your vault."
              d={businessMode ? "Your first buy or payday share creates your vault." : "Your first buy creates your vault."}
            />
          </Empty>
        ) : (
          <>
            {p.totalPutIn > 0n && (
              <dl className="mb-4 grid grid-cols-3">
                <div className="min-w-0 pr-4">
                  <Stat label="Total invested" value={`$${fmtUsdc(p.totalPutIn)}`} />
                </div>
                <div className="min-w-0 border-l border-line px-4">
                  <Stat label="Worth now" value={`$${fmtUsdc(p.totalAssetValue)}`} />
                </div>
                <div className="min-w-0 border-l border-line pl-4">
                  <div className="text-[13px] font-medium leading-[18px] text-muted">Change</div>
                  <div className="mt-1.5">
                    <Change now={p.totalAssetValue} putIn={p.totalPutIn} />
                  </div>
                </div>
              </dl>
            )}
            {held.length > 1 && (
              <div className="mb-4">
                <SplitBar parts={held.map((x) => ({ key: x.asset.symbol, value: Number(x.value), color: x.asset.color, label: x.asset.name }))} />
              </div>
            )}
            <HoldingsTable held={held} heldTotal={heldTotal} />
          </>
        )}
        {(p.totalPutIn > 0n || cash > 0n) && held.length > 0 && (
          // The footnote is hidden on phones, so the divider only shows there when the cash line follows.
          <div className={cx("-mx-4 border-t border-line sm:-mx-5", cash === 0n && "hidden sm:block")} />
        )}
        {p.totalPutIn > 0n && (
          <p className="mt-4 hidden text-xs leading-relaxed text-muted sm:block">
            Total invested is the USDC you put in, before fees. Withdrawn assets count as a loss in Change.
          </p>
        )}
        {cash > 0n && (
          <p className="mt-4 text-[13px] text-muted">
            <Responsive
              m={`$${fmtUsdc(p.earning)} earning · $${fmtUsdc(p.vaultUsdc)} idle`}
              d={`Cash: $${fmtUsdc(p.earning)} earning interest, $${fmtUsdc(p.vaultUsdc)} idle.`}
            />
          </p>
        )}
      </Card>

      <Plans p={p} now={now} />

      {loans.length > 0 && (
        <Card
          title="Your loans"
          action={
            <Link href="/risk" className={ACTION_LINK}>
              Stress test
            </Link>
          }
        >
          <div className="divide-y divide-line">
            {loans.map((x) => {
              const health = x.health !== undefined ? Number(x.health / 10n ** 14n) / 10_000 : undefined;
              return (
                <div key={x.asset.symbol} className="py-4 first:pt-0 last:pb-0">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AssetIcon asset={x.asset} size={28} />
                      <div className="text-sm font-medium">
                        <Responsive m={`${x.asset.name} loan`} d={`Loan against ${x.asset.name}`} />
                      </div>
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
