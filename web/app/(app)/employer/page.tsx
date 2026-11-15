"use client";

import { LearnMore } from "@/components/learn-more";
import { useEffect, useState } from "react";
import { isAddress, type ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import { useViewer } from "@/components/providers";
import { Button, Card, Empty, Field, Money, Notice, PageHeader, Row, Segmented, Select, TxStatus } from "@/components/ui";
import { payrollAbi } from "@/lib/abis";
import { ADDR, MIN_SCHEDULE_INTERVAL, type Address } from "@/lib/contracts";
import { fmtUsdc, intervalLabel, parseUsdc, shortAddr, until } from "@/lib/format";
import { useLastDays, useAttendance, useNames, useSession, useTeam, type TeamMember } from "@/lib/useAccount";
import { usePortfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";
import { BRAND } from "@/lib/brand";

const INTERVALS = [
  ...(MIN_SCHEDULE_INTERVAL <= 60 ? [{ value: "60", label: "Every minute (demo only)" }] : []),
  { value: "86400", label: "Daily" },
  { value: "604800", label: "Weekly" },
  { value: "1209600", label: "Every 2 weeks" },
  { value: "2592000", label: "Monthly (30 days)" },
];

function PastRuns({ employer }: { employer?: string }) {
  const count = useReadContracts({
    contracts: [{ address: ADDR.payroll, abi: payrollAbi, functionName: "runCount" }],
    query: { refetchInterval: 10_000 },
  });
  const total = Number((count.data?.[0]?.result as bigint | undefined) ?? 0n);
  const ids = Array.from({ length: Math.min(total, 20) }, (_, i) => BigInt(total - i));
  const runs = useReadContracts({
    contracts: ids.map((id) => ({ address: ADDR.payroll, abi: payrollAbi, functionName: "runs", args: [id] })) as unknown as readonly ContractFunctionParameters[],
    query: { enabled: ids.length > 0, refetchInterval: 10_000 },
  });
  const mine = ids
    .map((id, i) => ({ id, run: runs.data?.[i]?.result as readonly [string, bigint, bigint, bigint] | undefined }))
    .filter((x) => x.run && employer && x.run[0].toLowerCase() === employer.toLowerCase());

  if (!employer) return <Empty>Connect your wallet to see your paydays.</Empty>;
  if (mine.length === 0) return <Empty>No paydays from this wallet yet.</Empty>;
  return (
    <div>
      {mine.map(({ id, run }) => (
        <Row key={id.toString()} label={`Payday #${id} · ${new Date(Number(run![1]) * 1000).toLocaleString()}`}>
          {fmtUsdc(run![3])} of {fmtUsdc(run![2])} USDC claimed
        </Row>
      ))}
    </div>
  );
}

export default function EmployerPage() {
  const viewer = useViewer();
  const me = viewer.address;
  const p = usePortfolio(me);
  const tx = useTx();
  const session = useSession();
  const useDatabase = session.configured && session.signedIn;
  const { team, save, remove, saved } = useTeam(me, useDatabase);
  const attendance = useAttendance(useDatabase);
  const names = useNames(team.map((m) => m.wallet));
  const [treasuryAmt, setTreasuryAmt] = useState("");
  const [draft, setDraft] = useState<TeamMember>({ wallet: "", name: "", role: "", salary: "" });
  const [teamError, setTeamError] = useState<string>();
  const [mode, setMode] = useState<"recurring" | "once">("recurring");
  const [interval, setIntervalValue] = useState("604800");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  const payable = team.filter((m) => isAddress(m.wallet) && parseUsdc(m.salary) > 0n);
  const total = payable.reduce((a, m) => a + parseUsdc(m.salary), 0n);
  const employees = payable.map((m) => m.wallet as Address);
  const amounts = payable.map((m) => parseUsdc(m.salary));
  const treasury = parseUsdc(treasuryAmt);
  const committed = p.schedulesIRun.filter((s) => s.active).reduce((a, s) => a + s.total, 0n);
  const days = useLastDays(14);

  async function addMember() {
    setTeamError(undefined);
    if (!isAddress(draft.wallet.trim())) return setTeamError("That is not a valid wallet address.");
    if (!draft.name.trim()) return setTeamError("Enter a name.");
    if (parseUsdc(draft.salary) === 0n) return setTeamError("Enter a salary above zero.");
    try {
      await save({ ...draft, wallet: draft.wallet.trim() });
      setDraft({ wallet: "", name: "", role: "", salary: "" });
    } catch (e) {
      setTeamError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function fund() {
    const calls: Call[] = [
      ...(await tx.withApproval(ADDR.usdc, ADDR.payroll, treasury, `Allow ${BRAND.name} to take the USDC`)),
      { label: "Fund the treasury", address: ADDR.payroll, abi: payrollAbi, functionName: "deposit", args: [treasury] },
    ];
    if (await tx.run(calls, "Treasury funded.")) setTreasuryAmt("");
  }

  const withdrawAll = () =>
    tx.run(
      [{ label: "Withdraw the treasury", address: ADDR.payroll, abi: payrollAbi, functionName: "withdrawUnallocated", args: [p.employerBalance] }],
      "Treasury returned to your wallet.",
    );

  async function payOnce() {
    const fromTreasury = total > p.employerBalance ? p.employerBalance : total;
    const toDeposit = total - fromTreasury;
    const calls: Call[] = [];
    if (toDeposit > 0n) {
      calls.push(...(await tx.withApproval(ADDR.usdc, ADDR.payroll, toDeposit, `Allow ${BRAND.name} to take the USDC`)));
      calls.push({ label: "Pay the team now", address: ADDR.payroll, abi: payrollAbi, functionName: "depositAndCreateRun", args: [toDeposit, employees, amounts] });
    } else {
      calls.push({ label: "Pay the team now", address: ADDR.payroll, abi: payrollAbi, functionName: "createRun", args: [employees, amounts] });
    }
    await tx.run(calls, "Payday created. Your team can claim now.");
  }

  const startSchedule = () =>
    tx.run(
      [
        {
          label: "Start the recurring payroll",
          address: ADDR.payroll,
          abi: payrollAbi,
          functionName: "createSchedule",
          args: [employees, amounts, Number(interval), 0],
        },
      ],
      "Recurring payroll started. The first payday is due now.",
    );

  const runSchedule = (id: bigint) =>
    tx.run([{ label: "Pay the due payday", address: ADDR.payroll, abi: payrollAbi, functionName: "runSchedule", args: [id] }], "Payday paid out of your treasury.");

  const setActive = (id: bigint, active: boolean) =>
    tx.run(
      [{ label: active ? "Resume the schedule" : "Pause the schedule", address: ADDR.payroll, abi: payrollAbi, functionName: "setScheduleActive", args: [id, active] }],
      active ? "Schedule resumed." : "Schedule paused.",
    );

  return (
    <>
      <PageHeader
        title="Run payroll"
        lead={
          <>
            Fund a treasury, pick a rhythm, pay your team. <LearnMore href="/docs#businesses" />
          </>
        }
      />

      {!me && <Notice>Connect your wallet (top right) to run payroll.</Notice>}

      <Card tone="ink">
        <div className="grid gap-6 sm:grid-cols-[1fr_1fr] sm:items-end">
          <div>
            <div className="text-[13px] font-medium text-muted">Treasury</div>
            <div className="mt-2 font-display text-6xl font-semibold leading-none tracking-[-0.03em] sm:text-7xl">
              <Money value={me ? p.employerBalance : 0n} />
            </div>
            <p className="mt-3 text-sm text-muted">
              {committed > 0n
                ? `Covers ${(Number(p.employerBalance) / Number(committed)).toFixed(1)} more paydays of your active schedules (${fmtUsdc(committed)} USDC each).`
                : "Paydays are paid from here. Withdraw unused funds any time."}
            </p>
          </div>
          <div>
            <label className="block">
              <span className="text-[13px] font-medium text-canvas/70">Add USDC (wallet: {fmtUsdc(p.walletUsdc)})</span>
              <span className="mt-1.5 flex items-center rounded-2xl border border-white/20 bg-white/5 transition-colors duration-150 focus-within:border-white/60">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={treasuryAmt}
                  onChange={(e) => setTreasuryAmt(e.target.value)}
                  className="min-h-11 w-full min-w-0 bg-transparent px-3.5 text-base text-canvas outline-none placeholder:text-canvas/30"
                />
                <span className="pr-3.5 text-sm text-muted">USDC</span>
              </span>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={!viewer.canAct || treasury === 0n || treasury > p.walletUsdc || tx.state.busy} onClick={fund}>
                Fund treasury
              </Button>
              <button
                disabled={!viewer.canAct || p.employerBalance === 0n || tx.state.busy}
                onClick={withdrawAll}
                className="min-h-11 rounded-full border border-white/20 px-4 text-sm font-semibold text-canvas transition-colors hover:bg-white/10 disabled:opacity-40"
              >
                Withdraw all
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Team"
        action={
          session.configured && !session.signedIn && viewer.canAct ? (
            <Button size="sm" variant="secondary" disabled={session.busy} onClick={session.signIn}>
              {session.busy ? "Check your wallet…" : "Sign in to save to the database"}
            </Button>
          ) : undefined
        }
      >
        <p className="mb-4 text-xs text-muted">
          {saved === "database"
            ? `Saved in the ${BRAND.name} account database. Only you can see your team list.`
            : session.configured
              ? "Saved in this browser only until you sign in."
              : "Saved in this browser only (the account database is not connected yet)."}
        </p>
        {team.length === 0 ? (
          <Empty>No team members yet. Add the first one below.</Empty>
        ) : (
          <div className="divide-y divide-line">
            {team.map((m) => (
              <div key={m.wallet} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {m.name} {names.nameOf(m.wallet) && <span className="font-normal text-muted">@{names.nameOf(m.wallet)}</span>}
                  </div>
                  <div className="text-xs text-muted">
                    {m.role ? `${m.role} · ` : ""}
                    <span className="font-mono">{shortAddr(m.wallet)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">{fmtUsdc(parseUsdc(m.salary))} USDC</span>
                  <Button size="sm" variant="ghost" onClick={() => remove(m.wallet)} aria-label={`Remove ${m.name}`}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto] lg:items-end">
          <Field label="Wallet address" placeholder="0x…" value={draft.wallet} onChange={(e) => setDraft({ ...draft, wallet: e.target.value })} />
          <Field label="Name" placeholder="Maya K." value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Field label="Role (optional)" placeholder="Designer" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          <Field label="Salary per payday" inputMode="decimal" placeholder="0.00" suffix="USDC" value={draft.salary} onChange={(e) => setDraft({ ...draft, salary: e.target.value })} />
          <Button variant="ink" disabled={!me} onClick={addMember}>
            Add
          </Button>
        </div>
        {me && (
          <button className="mt-3 text-xs font-semibold text-brand-ink underline decoration-brand-ink/30 underline-offset-2 hover:decoration-brand-ink" onClick={() => setDraft({ ...draft, wallet: me, name: draft.name || "Me (test)" })}>
            Use my own address (for testing)
          </button>
        )}
        {teamError && <p className="mt-2 text-sm text-danger">{teamError}</p>}
      </Card>

      <Card title="Pay the team">
        <div className="grid gap-5 sm:grid-cols-2 sm:items-end">
          <Segmented
            label="How"
            value={mode}
            onChange={setMode}
            options={[
              { value: "recurring", label: "On a schedule" },
              { value: "once", label: "Once, now" },
            ]}
          />
          {mode === "recurring" && <Select label="Payday rhythm" value={interval} onChange={setIntervalValue} options={INTERVALS} />}
        </div>
        <div className="mt-5 rounded-2xl bg-sunken/70 p-4">
          <Row label="People paid">{payable.length}</Row>
          <Row label="Each payday costs">{fmtUsdc(total)} USDC</Row>
          {mode === "recurring" ? (
            <Row label="Your treasury covers">{total > 0n ? `${(Number(p.employerBalance) / Number(total)).toFixed(1)} paydays` : "…"}</Row>
          ) : (
            <Row label="Taken from your wallet now">{fmtUsdc(total > p.employerBalance ? total - p.employerBalance : 0n)} USDC</Row>
          )}
        </div>
        {mode === "recurring" ? (
          <>
            <Button size="lg" className="mt-5" disabled={!viewer.canAct || payable.length === 0 || tx.state.busy} onClick={startSchedule}>
              Start {intervalLabel(Number(interval)).toLowerCase()} payroll
            </Button>
            <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">
              A due payday waits until someone presses pay, and until the treasury covers it.{" "}
              <LearnMore href="/docs#businesses" />
            </p>
          </>
        ) : (
          <Button
            size="lg"
            className="mt-5"
            disabled={!viewer.canAct || payable.length === 0 || tx.state.busy || (total > p.employerBalance && total - p.employerBalance > p.walletUsdc)}
            onClick={payOnce}
          >
            Pay {fmtUsdc(total)} USDC now
          </Button>
        )}
        <TxStatus state={tx.state} />
      </Card>

      <Card title="Your schedules">
        {p.schedulesIRun.length === 0 ? (
          <Empty>No recurring payroll yet.</Empty>
        ) : (
          <div className="divide-y divide-line">
            {p.schedulesIRun.map((s) => {
              const due = s.active && now > 0 && s.nextPayAt <= now;
              const funded = p.employerBalance >= s.total;
              return (
                <div key={s.id.toString()} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                  <div>
                    <div className="text-sm font-semibold">
                      {intervalLabel(s.interval)} · {s.employees.length} {s.employees.length === 1 ? "person" : "people"} · {fmtUsdc(s.total)} USDC
                    </div>
                    <div className={`text-xs ${due && !funded ? "text-danger" : "text-muted"}`}>
                      {!s.active
                        ? "Paused"
                        : due
                          ? funded
                            ? "A payday is due now"
                            : "A payday is due, but the treasury is short. Top up to pay it."
                          : `Next payday ${until(s.nextPayAt, now)}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!viewer.canAct || !due || !funded || tx.state.busy} onClick={() => runSchedule(s.id)}>
                      Pay now
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!viewer.canAct || tx.state.busy} onClick={() => setActive(s.id, !s.active)}>
                      {s.active ? "Pause" : "Resume"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Attendance, last 14 days">
        {!session.configured ? (
          <Empty>Attendance needs the account database, which is not connected yet.</Empty>
        ) : !session.signedIn ? (
          <Empty>Sign in (in the Team section above) to see your team&apos;s check-ins.</Empty>
        ) : team.length === 0 ? (
          <Empty>Add team members to see their check-ins.</Empty>
        ) : (
          <div className="space-y-3">
            {team.map((m) => {
              const checked = attendance.data?.team[m.wallet.toLowerCase()] ?? [];
              return (
                <div key={m.wallet} className="grid items-center gap-3 sm:grid-cols-[10rem_1fr_3rem]">
                  <div className="truncate text-sm font-semibold">{m.name}</div>
                  <div className="flex gap-1" role="img" aria-label={`${m.name}: ${checked.length} of 14 days`}>
                    {days.map((d) => (
                      <span key={d} title={d} className={`h-6 flex-1 rounded-md ${checked.includes(d) ? "bg-grow" : "bg-sunken"}`} />
                    ))}
                  </div>
                  <div className="text-right text-xs tabular-nums text-muted">{checked.length}/14</div>
                </div>
              );
            })}
            <p className="pt-1 text-xs leading-relaxed text-muted">
              A record only. It does not change pay.
            </p>
          </div>
        )}
      </Card>

      <Card title="Past paydays">
        <PastRuns employer={me} />
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Unclaimed for 180 days? You can take it back.
        </p>
      </Card>
    </>
  );
}
