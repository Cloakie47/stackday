"use client";

import { PrivatePaySetup, PrivatePayWaiting } from "@/components/private-collect";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { legOf } from "@/components/collateral-basket";
import { useViewer } from "@/components/providers";
import {
  AddressLink,
  AssetIcon,
  AssetStack,
  Badge,
  Button,
  Card,
  DimCents,
  Empty,
  Field,
  HealthMeter,
  InfoTip,
  LabelTip,
  Money,
  Notice,
  PageHeader,
  Row,
  SplitBar,
  buttonClass,
  cx,
  splitColor,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { apyPpm, summarize } from "@/lib/basket";
import { BORROW_FEE_BPS, assetByToken, type Asset } from "@/lib/contracts";
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

const KIND: Record<Asset["kind"], string> = { stock: "tokenized stock", crypto: "crypto", commodity: "gold", fund: "fund" };
const healthNum = (h: bigint | undefined) => (h === undefined ? undefined : Number(h / 10n ** 14n) / 10_000);
const healthTone = (h: number | undefined) => (h === undefined ? "" : h < 1 ? "text-danger" : h < 1.25 ? "text-warn" : "text-grow");

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
      <div className="divide-y divide-line-soft">
        {teams.map((t) => (
          <div key={t.employer} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">
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
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
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
        <p className="text-[13px] text-muted">Sign-in is not available right now. Your money does not depend on it.</p>
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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft bg-popover px-4 py-3">
      <div>
        <div className="text-xs text-muted">
          <LabelTip
            label={`Your ${BRAND.name} ID`}
            tip={account.mode === "personal" ? `Your unique ${BRAND.name} ID.` : "Share it with a business so it can add you to its team."}
          />
        </div>
        <div className="mt-0.5 font-mono text-[15px] font-medium tracking-wide">{uid}</div>
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
          <Link href="/start" className="text-xs font-semibold text-ink hover:text-brand-ink">
            {account.role === "individual" ? "Personal" : account.role === "owner" ? "Business owner" : "Team member"} · change
          </Link>
        ) : undefined
      }
    >
      {idRow}
      {!session.signedIn ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-[13px] text-muted">
            {current ? (
              <>
                This wallet is <strong className="font-medium text-ink">@{current}</strong>. Sign in to change it or check in.
              </>
            ) : (
              <LabelTip
                label={account.mode === "personal" ? "Sign in to pick a name." : "Sign in to pick a name and check in."}
                tip="Signing proves you own this wallet. It is free and sends no transaction."
              />
            )}
          </p>
          <Button variant="secondary" disabled={!canAct || session.busy} onClick={session.signIn}>
            {session.busy ? "Check your wallet…" : "Sign in with wallet"}
          </Button>
          {session.error && <p className="w-full text-[13px] text-danger">{session.error}</p>}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            {current && (
              <p className="text-[13px] text-muted">
                You are <strong className="font-medium text-ink">@{current}</strong>.
              </p>
            )}
            <div className="mt-2 flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label={current ? "Change name" : "Name"}
                  placeholder="Pick a unique name, for example maya_k"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  maxLength={20}
                />
              </div>
              <Button variant="secondary" disabled={saving || name.length < 3} onClick={save}>
                Save
              </Button>
            </div>
            {message && <p className={`mt-2 text-[13px] ${message.ok ? "text-grow" : "text-danger"}`}>{message.text}</p>}
          </div>
          {account.mode !== "personal" && (
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-muted">
                  <LabelTip label="Check in, last 14 days" tip="Only teams you accept can see your check-ins. It does not change your pay." />
                </p>
                <Button size="sm" variant={checkedToday ? "secondary" : "primary"} disabled={checkedToday} onClick={attendance.checkIn}>
                  {checkedToday ? "Checked in today" : "Check in for today"}
                </Button>
              </div>
              <div className="mt-3 flex gap-1" role="img" aria-label="Attendance for the last 14 days">
                {days.map((d) => (
                  <span
                    key={d}
                    className={`h-6 flex-1 rounded-[4px] transition-colors duration-300 ${attendance.data?.mine.includes(d) ? "bg-grow" : "bg-press"}`}
                  />
                ))}
              </div>
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
  const up = diff >= 0n;
  return (
    <span className={up ? "text-grow" : "text-danger"}>
      {up ? "+" : "−"}${fmtUsdc(up ? diff : -diff)} ({up ? "+" : "−"}
      {Math.abs(pct).toFixed(1)}%)
    </span>
  );
}

/** One of the large figures across the top of the page. */
function Figure({
  label,
  tip,
  value,
  sub,
  className = "",
  tone = "text-ink",
  hero = false,
}: {
  label: string;
  tip?: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  tone?: string;
  hero?: boolean;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-xs text-muted sm:text-[13px]">
        <LabelTip label={label} tip={tip} />
      </div>
      <div
        className={cx(
          "truncate font-display font-normal tabular-nums tracking-[-0.02em]",
          tone,
          hero ? "mt-1.5 text-[40px] leading-[1.05] lg:mt-2 lg:text-[34px] lg:leading-[1.1]" : "mt-1 text-[15px] font-medium lg:mt-2 lg:text-[34px] lg:font-normal lg:leading-[1.1]",
        )}
      >
        {value}
      </div>
      {sub && <div className={cx("mt-1.5 text-xs text-muted", !hero && "hidden lg:block")}>{sub}</div>}
    </div>
  );
}

function PaydayPlanCard({ p, now }: { p: Portfolio; now: number }) {
  const names = useNames(p.schedulesPayingMe.map((s) => s.employer));
  const legs = p.sipPlan.map((leg) => ({ leg, asset: assetByToken(leg.asset) })).filter((x): x is { leg: (typeof p.sipPlan)[number]; asset: Asset } => !!x.asset);
  const total = legs.reduce((a, l) => a + l.leg.bps, 0n);
  const ruleAsset = assetByToken(p.emergencyRule?.asset);
  const next = p.schedulesPayingMe.filter((s) => s.active).sort((a, b) => a.nextPayAt - b.nextPayAt)[0];

  return (
    <Card
      title="Payday plan"
      action={
        <Link href="/pay" className="text-xs font-semibold text-ink hover:text-brand-ink">
          {legs.length ? "Edit plan" : "Set a plan"}
        </Link>
      }
    >
      {legs.length === 0 ? (
        <p className="text-[13px] text-muted">No payday plan yet. Choose a share of every salary on Payday.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[28px] leading-none tracking-[-0.02em]">{fmtPct(total)}</span>
            <span className="text-[13px] text-muted">of each salary buys into your vault</span>
          </div>
          <div className="mt-4">
            <SplitBar parts={legs.map((l, i) => ({ key: l.asset.symbol, value: Number(l.leg.bps), color: splitColor(i), label: l.asset.name }))} />
          </div>
          <div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {legs.map((l, i) => (
              <div key={l.asset.symbol} className="flex items-center gap-2 text-xs text-muted">
                <i className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: splitColor(i) }} aria-hidden />
                <span className="truncate">{l.asset.name}</span>
                <b className="ml-auto font-medium tabular-nums text-ink">{total > 0n ? Math.round(Number((l.leg.bps * 100n) / total)) : 0}%</b>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="mt-3.5">
        {p.schedulesPayingMe.map((s) => (
          <Row key={`s${s.id}`} label={`${names.display(s.employer)} · ${intervalLabel(s.interval)}`}>
            {s.active ? `${fmtUsdc(s.mine)} USDC` : <span className="text-warn">Paused by the employer</span>}
          </Row>
        ))}
        {next && <Row label="Next payday">{until(next.nextPayAt, now)}</Row>}
        {p.emergencyRule && ruleAsset && (
          <Row
            label="Emergency rule"
            tip={`If the ${ruleAsset.name} loan's health is at or below ${fmtHealth(p.emergencyRule.threshold)} on payday, ${fmtPct(p.emergencyRule.bps)} of that salary buys collateral for it.`}
          >
            {p.emergencyActive ? <Badge tone="warn">Active</Badge> : <span className="text-muted">Not triggered</span>}
          </Row>
        )}
      </div>
    </Card>
  );
}

function RecurringCard({ p, now }: { p: Portfolio; now: number }) {
  const recurring = p.positions.filter((x) => x.recurring);
  return (
    <Card
      title="Recurring buys"
      action={
        <Link href="/invest" className="text-xs font-semibold text-ink hover:text-brand-ink">
          {recurring.length ? "Manage" : "Start one"}
        </Link>
      }
    >
      {recurring.length === 0 ? (
        <p className="text-[13px] text-muted">No recurring buys yet.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {recurring.map((x) => (
            <div key={x.asset.symbol} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-3">
                <AssetIcon asset={x.asset} size={24} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{x.asset.name}</div>
                  <div className="text-xs text-muted">
                    {intervalLabel(x.recurring!.interval)} · next {until(x.recurring!.nextBuyAt, now)}
                  </div>
                </div>
              </div>
              <div className="text-[13px] tabular-nums">{fmtUsdc(x.recurring!.usdcPerBuy)} USDC</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function LoanCard({ p, health, available, rate }: { p: Portfolio; health: number | undefined; available: bigint; rate: number }) {
  const loans = p.positions.filter((x) => x.debt > 0n).sort((a, b) => (b.debt > a.debt ? 1 : -1));
  const backing = p.positions.filter((x) => x.collateral > 0n).sort((a, b) => (b.value > a.value ? 1 : -1));
  return (
    <Card
      title="Loan"
      action={
        <span className="flex items-center gap-4">
          {loans.length > 0 && (
            <Link href="/risk" className="hit text-xs font-semibold text-muted hover:text-ink">
              Stress test
            </Link>
          )}
          <Link href={loans.length ? "/borrow?tab=repay" : "/borrow"} className="text-xs font-semibold text-ink hover:text-brand-ink">
            {loans.length ? "Repay" : "Borrow"}
          </Link>
        </span>
      }
    >
      {loans.length === 0 ? (
        <>
          <div className="flex items-baseline gap-3">
            <span className="font-display text-[28px] leading-none tracking-[-0.02em]">No loan</span>
          </div>
          <div className="mt-4">
            <Row label="Available to borrow" tip="How much USDC you can borrow now against what you locked, within your borrow limit.">
              <span className="text-brand-ink">${fmtUsdc(available)}</span>
            </Row>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-[28px] leading-none tracking-[-0.02em] tabular-nums">{fmtUsdc(p.totalDebt)}</span>
            <span className="inline-flex items-center gap-2 text-[13px] text-muted">
              USDC borrowed against
              {backing.length > 0 && <AssetStack assets={backing.map((x) => x.asset)} size={20} />}
              <span className="hidden sm:inline">{backing.map((x) => x.asset.name).slice(0, 2).join(" and ")}{backing.length > 2 ? " and more" : ""}</span>
            </span>
          </div>
          <div className="mt-5">
            <HealthMeter health={health} />
          </div>
          <div className="mt-3">
            <Row label="Borrow rate" tip={`Morpho interest plus the ${BRAND.name} fee of ${Number(BORROW_FEE_BPS) / 100}% a year. It moves with how much of the market is lent out.`}>
              {rate.toFixed(2)}% a year, variable
            </Row>
            <Row label="Available to borrow">
              <span className="text-brand-ink">${fmtUsdc(available)}</span>
            </Row>
          </div>
        </>
      )}
    </Card>
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
  const held = p.positions.filter((x) => x.idle + x.collateral > 0n).sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  const name = names.nameOf(viewer.address);
  const loading = !!viewer.address && p.loading;

  // Whole basket, the same numbers the Borrow page shows.
  const borrowable = p.positions.filter((x) => x.asset.borrowable);
  const basket = summarize(borrowable.map((x) => legOf(x)), p.borrowCapBps);
  const health = healthNum(basket.health);
  const debtSum = p.positions.reduce((a, x) => a + x.debt, 0n);
  const morpho = debtSum > 0n ? p.positions.reduce((a, x) => a + apyPpm(x.ratePerSecond) * Number(x.debt), 0) / Number(debtSum) / 10_000 : 0;
  const rate = morpho + Number(BORROW_FEE_BPS) / 100;
  const splitOf = (token: string) => p.sipPlan.find((l) => l.asset.toLowerCase() === token.toLowerCase())?.bps;
  const showSplit = businessMode || p.sipPlan.length > 0;
  const money = (v: bigint) => (loading ? <span className="skeleton inline-block min-w-24">0</span> : <DimCents text={`$${fmtUsdc(v)}`} />);

  return (
    <>
      <PageHeader
        title={name ? `Hello, ${name}` : "Portfolio"}
        lead={businessMode ? "What your pay has bought, and what you owe against it." : "Your investments, plans and loans."}
        aside={
          <div className="hidden gap-2 md:flex">
            <Link href="/invest" className={buttonClass("secondary", "sm")}>
              Buy
            </Link>
            <Link href="/borrow?tab=repay" className={buttonClass("secondary", "sm")}>
              Repay
            </Link>
            <Link href="/borrow" className={buttonClass("primary", "sm")}>
              Borrow USDC
            </Link>
          </div>
        }
      />

      {!viewer.address && <Notice>Connect a wallet to see your portfolio.</Notice>}
      {viewer.address && <PrivatePayWaiting address={viewer.address} />}

      {businessMode && p.totalClaimable > 0n && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-line bg-surface p-4 shadow-card sm:p-5">
          <div>
            <div className="text-[13px] text-muted">Salary waiting for you</div>
            <div className="mt-1 font-display text-[30px] leading-none tracking-[-0.02em] text-brand">
              <Money value={p.totalClaimable} dimCents />
            </div>
          </div>
          <Link href="/pay" className={buttonClass("primary", "md")}>
            Claim it
          </Link>
        </div>
      )}

      {/* Large figures */}
      <section aria-label="Summary" className="grid grid-cols-3 gap-x-4 gap-y-5 border-b border-line-soft pb-5 lg:grid-cols-[1.25fr_1fr_1fr_0.8fr_1.1fr] lg:border-0 lg:pb-1">
        <Figure
          hero
          className="col-span-3 lg:col-span-1"
          label="Net worth"
          tip="Assets plus cash in your vault, minus your loan."
          value={viewer.address ? <Money value={netWorth} dimCents /> : <DimCents text="$0.00" />}
          sub={
            p.totalPutIn > 0n ? (
              <>
                <Change now={p.totalAssetValue} putIn={p.totalPutIn} /> on{" "}
                <LabelTip
                  label={`$${fmtUsdc(p.totalPutIn)} invested`}
                  tip="USDC you put in through buys and payday shares, before fees. It never goes down, so assets you withdraw show as a loss here."
                />
              </>
            ) : undefined
          }
        />
        <Figure label="Assets" value={money(p.totalAssetValue)} sub={`${held.length} ${held.length === 1 ? "asset" : "assets"} in your vault`} />
        <Figure label="Loan" value={money(p.totalDebt)} sub={p.totalDebt > 0n ? `USDC at ${rate.toFixed(2)}% a year` : "No loan open"} />
        <Figure
          label="Health"
          tip="How safe your loan is. Healthy above 1.25. At 1.00, part of your collateral can be sold to repay the loan."
          value={health !== undefined ? health.toFixed(2) : "–"}
          tone={health !== undefined ? healthTone(health) : "text-muted"}
          sub="Liquidation at 1.00"
        />
        <Figure
          className="hidden lg:block"
          label="Available to borrow"
          tip="How much more USDC you can borrow now, within your borrow limit."
          value={money(basket.available)}
          tone="text-brand"
          sub={`of $${fmtUsdc(basket.limit > basket.debt ? basket.limit - basket.debt : 0n)} max`}
        />
      </section>

      {/* Phone actions, inline as in the design */}
      <div className="grid grid-cols-3 gap-2 md:hidden">
        <Link href="/invest" className={buttonClass("secondary", "md")}>
          Buy
        </Link>
        <Link href="/borrow" className={buttonClass("primary", "md")}>
          Borrow
        </Link>
        <Link href="/borrow?tab=repay" className={buttonClass("secondary", "md")}>
          Repay
        </Link>
      </div>

      {/* Holdings */}
      <Card flush>
        <div className="flex min-h-[52px] flex-wrap items-center gap-x-5 gap-y-2 border-b border-line-soft px-4 py-2 sm:px-5">
          <div className="flex h-full items-center gap-2 text-[13px] text-ink">
            <h2 className="font-medium">Holdings</h2>
            <span className="rounded-[5px] bg-press px-1.5 text-[11px] text-muted tabular-nums">{held.length}</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              Cash <span className="tabular-nums text-ink">${fmtUsdc(cash)}</span>
              <InfoTip label="Cash">
                USDC in your vault. Earning: ${fmtUsdc(p.earning)}. Idle: ${fmtUsdc(p.vaultUsdc)}.
              </InfoTip>
            </span>
            <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
            <span className="hidden sm:inline">Earning on idle USDC: {p.earning > 0n ? <span className="text-grow">On</span> : "Off"}</span>
            {p.earning === 0n && (
              <Link href="/invest" className="hidden font-semibold text-ink hover:text-brand-ink sm:inline">
                Turn on
              </Link>
            )}
          </div>
        </div>

        {held.length === 0 ? (
          <div className="p-4 sm:p-5">
            <Empty>
              <div className="flex flex-col items-center gap-3">
                Nothing in your vault yet.
                <Link href="/invest" className={buttonClass("primary", "sm")}>
                  Buy
                </Link>
              </div>
            </Empty>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="dtable min-w-[760px] table-fixed">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[13%]" />
                  <col className="w-[17%]" />
                  <col className="w-[18%]" />
                  {showSplit && <col className="w-[12%]" />}
                  <col className="w-[14%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col" className="r">
                      Price
                    </th>
                    <th scope="col" className="r">
                      Holding
                    </th>
                    <th scope="col" className="r">
                      <LabelTip label="Allocation" tip="Share of your vault's asset value." />
                    </th>
                    {showSplit && (
                      <th scope="col" className="r">
                        <LabelTip label="Payday split" tip="Share of each payday that buys this asset." />
                      </th>
                    )}
                    <th scope="col">
                      <LabelTip label="Loan" tip="Assets marked Collateral back your loan. You can't withdraw them past what the loan allows." />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {held.map((x) => {
                    const share = p.totalAssetValue > 0n ? Number((x.value * 1000n) / p.totalAssetValue) / 10 : 0;
                    const split = splitOf(x.asset.token);
                    return (
                      <tr key={x.asset.symbol}>
                        <td>
                          <div className="flex items-center gap-3">
                            <AssetIcon asset={x.asset} size={32} />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{x.asset.name}</div>
                              <div className="truncate text-[11.5px] text-muted">
                                {x.asset.symbol} · {KIND[x.asset.kind]}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="r">${fmtPrice(x.price)}</td>
                        <td className="r">
                          <div className="flex flex-col items-end gap-1">
                            <span>
                              {fmtAsset(x.idle + x.collateral, x.asset.decimals, 4)} <span className="text-muted">{x.asset.symbol}</span>
                            </span>
                            <span className="rounded-[6px] bg-press px-[7px] text-[11px] font-medium leading-5 text-ink-soft">${fmtUsdc(x.value)}</span>
                          </div>
                        </td>
                        <td className="r">
                          <div className="flex items-center justify-end gap-2.5">
                            <span className="h-1 w-[72px] overflow-hidden rounded bg-press" aria-hidden>
                              <i className="block h-full rounded bg-ink-soft" style={{ width: `${Math.min(100, share)}%` }} />
                            </span>
                            <span className="min-w-[42px] text-right">{share.toFixed(1)}%</span>
                          </div>
                        </td>
                        {showSplit && <td className={cx("r", !split && "text-muted")}>{split ? fmtPct(split) : "0%"}</td>}
                        <td>
                          {x.collateral > 0n ? (
                            <Badge>Collateral</Badge>
                          ) : (
                            <span className="text-xs text-muted">{x.asset.borrowable ? "Not used" : "Invest only"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Phone list */}
            <div className="lg:hidden">
              <div className="flex justify-between px-4 pb-1 pt-3 text-xs text-muted">
                <span>Asset</span>
                <span>Value · share</span>
              </div>
              <ul className="divide-y divide-line-soft">
                {held.map((x) => {
                  const share = p.totalAssetValue > 0n ? Number((x.value * 1000n) / p.totalAssetValue) / 10 : 0;
                  return (
                    <li key={x.asset.symbol} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                      <AssetIcon asset={x.asset} size={24} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                          <span className="truncate">{x.asset.name}</span>
                          {x.collateral > 0n && (
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" role="img" aria-label="Collateral">
                              <path d="M6 11h12v9H6zM9 11V8a3 3 0 016 0v3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted tabular-nums">
                          {fmtAsset(x.idle + x.collateral, x.asset.decimals, 4)} {x.asset.symbol}
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="text-[13.5px]">${fmtUsdc(x.value)}</div>
                        <div className="text-xs text-muted">{share.toFixed(1)}%</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {businessMode ? <PaydayPlanCard p={p} now={now} /> : <RecurringCard p={p} now={now} />}
        <LoanCard p={p} health={health} available={basket.available} rate={rate} />
      </div>

      {businessMode && p.positions.some((x) => x.recurring) && <RecurringCard p={p} now={now} />}

      {businessMode && <Invitations canAct={viewer.canAct} />}

      <Account canAct={viewer.canAct} wallet={viewer.address} />

      {p.vault && (
        <p className="text-xs text-muted">
          <AddressLink address={p.vault} label="Your vault on BaseScan" />
        </p>
      )}
    </>
  );
}
