"use client";

import { PaydayLog, PayNow } from "@/components/private-payday";
import { addPrivateRecord, fmt6 } from "@/lib/confidential";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress, type ContractFunctionParameters } from "viem";
import { useReadContracts } from "wagmi";
import { useViewer } from "@/components/providers";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  FillAmount,
  InfoTip,
  LabelTip,
  Money,
  Notice,
  PageHeader,
  Row,
  Segmented,
  Select,
  TxStatus,
  cx,
} from "@/components/ui";
import { payrollAbi } from "@/lib/abis";
import { ADDR, MIN_SCHEDULE_INTERVAL, type Address } from "@/lib/contracts";
import { fmtUsdc, intervalLabel, parseUsdc, shortAddr, until } from "@/lib/format";
import {
  saveBusiness,
  searchPeople,
  useAccountState,
  useAttendance,
  useLastDays,
  useNames,
  useTeam,
  type Person,
  type TeamMember,
} from "@/lib/useAccount";
import { usePortfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";
import { BRAND } from "@/lib/brand";

const INTERVALS = [
  ...(MIN_SCHEDULE_INTERVAL <= 60 ? [{ value: "60", label: "Every minute (testnet)" }] : []),
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

function BusinessProfile() {
  const account = useAccountState();
  const queryClient = useQueryClient();
  const business = account.me?.business;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  if (!account.session.configured || !account.session.signedIn) return null;

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await saveBusiness(name, description);
      await queryClient.invalidateQueries();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (!business && !editing)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-card sm:p-5">
        <p className="max-w-lg text-[13px] text-muted">
          <strong className="font-medium text-ink">Add your business name.</strong> Your team sees it instead of a wallet address.
        </p>
        <Button size="sm" onClick={() => setEditing(true)}>
          Add business details
        </Button>
      </div>
    );

  return (
    <Card
      title={editing ? "Business details" : (business?.name ?? "Business details")}
      action={
        !editing ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setName(business?.name ?? "");
              setDescription(business?.description ?? "");
              setEditing(true);
            }}
          >
            Edit
          </Button>
        ) : undefined
      }
    >
      {!editing ? (
        <div className="text-[13px] text-muted">
          <p>{business?.description || "No description yet."}</p>
          {account.me && (
            <p className="mt-3">
              Your {BRAND.name} ID <span className="ml-1 font-mono text-ink">{account.me.profile.uid}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          <Field label="Business name" placeholder="Northwind Studio" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <Field
            label="What does it do? (optional)"
            placeholder="A short description your team will see."
            value={description}
            maxLength={400}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-2">
            <Button disabled={saving || name.trim().length < 2} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </div>
      )}
    </Card>
  );
}

/** Find a person by their ID, name or wallet address, instead of pasting an address. */
function FindPeople({ onPick, already }: { onPick: (p: Person) => void; already: string[] }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>();
  const [hint, setHint] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setPeople(undefined);
      setHint(undefined);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const r = await searchPeople(text);
        if (!cancelled) {
          setPeople(r.people);
          setHint(r.hint);
        }
      } catch (e) {
        if (!cancelled) {
          setPeople([]);
          setHint(e instanceof Error ? e.message : "Search failed.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <div>
      <Field
        label={`Find someone on ${BRAND.name}`}
        placeholder={`${BRAND.name} ID (SD-7K3F9Q2M), name, or wallet address`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        hint={busy ? "Searching…" : hint}
      />
      {people && people.length === 0 && !busy && !hint && (
        <p className="mt-2 text-[13px] text-muted">
          Nobody found. Ask them to open {BRAND.name}, press Get started and send you their {BRAND.name} ID.
        </p>
      )}
      {people && people.length > 0 && (
        <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-popover">
          {people.map((person) => {
            const added = already.includes(person.wallet.toLowerCase());
            return (
              <li key={person.wallet} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{person.username ? `@${person.username}` : "No name chosen"}</div>
                  <div className="font-mono text-xs text-muted">
                    {person.uid} · {shortAddr(person.wallet)}
                  </div>
                </div>
                <Button size="sm" variant="secondary" disabled={added} onClick={() => { onPick(person); setQ(""); }}>
                  {added ? "On your team" : "Use this person"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function EmployerPage() {
  const viewer = useViewer();
  const me = viewer.address;
  const p = usePortfolio(me);
  const tx = useTx();
  const account = useAccountState();
  const session = account.session;
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

  /** One-off payday through the Payroll contract for these people (treasury first, wallet tops up the rest). */
  async function payMembers(list: { wallet: string; salary: string; name?: string }[], payday = Date.now()) {
    const who = list.map((m) => m.wallet as Address);
    const how = list.map((m) => parseUsdc(m.salary));
    const sum = how.reduce((a, b) => a + b, 0n);
    const fromTreasury = sum > p.employerBalance ? p.employerBalance : sum;
    const toDeposit = sum - fromTreasury;
    const calls: Call[] = [];
    if (toDeposit > 0n) {
      calls.push(...(await tx.withApproval(ADDR.usdc, ADDR.payroll, toDeposit, `Allow ${BRAND.name} to take the USDC`)));
      calls.push({ label: "Pay the team now", address: ADDR.payroll, abi: payrollAbi, functionName: "depositAndCreateRun", args: [toDeposit, who, how] });
    } else {
      calls.push({ label: "Pay the team now", address: ADDR.payroll, abi: payrollAbi, functionName: "createRun", args: [who, how] });
    }
    const result = await tx.run(calls, "Payday created. Your team can claim now.");
    if (result) {
      const hash = typeof result === "string" ? result : undefined;
      for (const m of list)
        addPrivateRecord(me, { at: Date.now(), kind: "paid", who: m.wallet, name: m.name, amount: fmt6(parseUsdc(m.salary)), tx: hash, payday, private: false });
    }
    return result;
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

  const shortOf = (s: { total: bigint }) => p.employerBalance < s.total;
  const pending = team.filter((m) => m.status !== "accepted").length;

  return (
    <>
      <PageHeader title="Payroll" lead="Fund the treasury, pick a rhythm, pay your team." />

      {!me && <Notice>Connect a wallet to run payroll.</Notice>}

      {/* Treasury */}
      <Card>
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-start">
          <div>
            <div className="text-[13px] text-muted">
              <LabelTip label="Treasury" tip="Paydays are paid from here. Withdraw unused funds any time." />
            </div>
            <div className="mt-2 font-display text-[34px] font-normal leading-[1.1] tracking-[-0.02em] sm:text-[40px]">
              <Money value={me ? p.employerBalance : 0n} dimCents />
            </div>
            {committed > 0n && (
              <p className="mt-1.5 text-xs text-muted">
                Covers {(Number(p.employerBalance) / Number(committed)).toFixed(1)} more paydays of your active schedules ({fmtUsdc(committed)} USDC each).
              </p>
            )}
          </div>
          <div>
            <Field
              label="Add USDC"
              inputMode="decimal"
              placeholder="0.00"
              suffix="USDC"
              value={treasuryAmt}
              onChange={(e) => setTreasuryAmt(e.target.value)}
              hint={
                <>
                  Wallet{" "}
                  <FillAmount onFill={() => setTreasuryAmt(fmtUsdc(p.walletUsdc).replace(/,/g, ""))} label="Use your whole wallet balance">
                    {fmtUsdc(p.walletUsdc)}
                  </FillAmount>{" "}
                  USDC
                </>
              }
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled={!viewer.canAct || treasury === 0n || treasury > p.walletUsdc || tx.state.busy} onClick={fund}>
                Fund treasury
              </Button>
              <Button variant="secondary" disabled={!viewer.canAct || p.employerBalance === 0n || tx.state.busy} onClick={withdrawAll}>
                Withdraw all
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <BusinessProfile />

      {/* Team */}
      <Card flush>
        <div className="flex min-h-[52px] flex-wrap items-center gap-x-5 gap-y-2 border-b border-line-soft px-4 py-2 sm:px-5">
          <div className="flex items-center gap-2 text-[13px] text-ink">
            <h2 className="font-medium">
              {saved === "database" ? (
                <LabelTip label="Team" tip="Only you see this list. People you add can be paid now and share check-ins once they accept." />
              ) : (
                "Team"
              )}
            </h2>
            <span className="rounded-[5px] bg-press px-1.5 text-[11px] tabular-nums text-muted">{team.length}</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted">
            {saved !== "database" && <span className="text-warn">Saved on this device only until you sign in.</span>}
            {session.configured && !session.signedIn && viewer.canAct && (
              <Button size="sm" variant="secondary" disabled={session.busy} onClick={session.signIn}>
                {session.busy ? "Check your wallet…" : "Sign in to save your team"}
              </Button>
            )}
          </div>
        </div>

        {team.length === 0 ? (
          <div className="p-4 sm:p-5">
            <Empty>No team members yet. Add the first one below.</Empty>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="dtable min-w-[640px] table-fixed">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[20%]" />
                  <col className="w-[14%]" />
                  <col className="w-[18%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="r">
                      Salary per payday
                    </th>
                    <th scope="col" className="r">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((m) => (
                    <tr key={m.wallet}>
                      <td>
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {m.name}
                            {names.nameOf(m.wallet) && <span className="ml-1.5 font-normal text-muted">@{names.nameOf(m.wallet)}</span>}
                          </div>
                          <div className="truncate font-mono text-[11.5px] text-muted">{names.idOf(m.wallet) ?? shortAddr(m.wallet)}</div>
                        </div>
                      </td>
                      <td className={cx("truncate", !m.role && "text-muted")}>{m.role || "–"}</td>
                      <td>
                        {m.status ? (
                          <Badge tone={m.status === "accepted" ? "grow" : "neutral"}>{m.status === "accepted" ? "Accepted" : "Invited"}</Badge>
                        ) : (
                          <span className="text-xs text-muted">This device</span>
                        )}
                      </td>
                      <td className="r">
                        {fmtUsdc(parseUsdc(m.salary))} <span className="text-muted">USDC</span>
                      </td>
                      <td className="r">
                        <Button size="sm" variant="ghost" onClick={() => remove(m.wallet)} aria-label={`Remove ${m.name}`}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line-soft md:hidden">
              {team.map((m) => (
                <li key={m.wallet} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                      <span className="truncate">{m.name}</span>
                      {m.status && <Badge tone={m.status === "accepted" ? "grow" : "neutral"}>{m.status === "accepted" ? "Accepted" : "Invited"}</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {m.role ? `${m.role} · ` : ""}
                      <span className="font-mono">{names.idOf(m.wallet) ?? shortAddr(m.wallet)}</span>
                    </div>
                  </div>
                  <div className="text-right text-[13.5px] tabular-nums">{fmtUsdc(parseUsdc(m.salary))} USDC</div>
                  <Button size="sm" variant="ghost" onClick={() => remove(m.wallet)} aria-label={`Remove ${m.name}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="space-y-4 border-t border-line-soft p-4 sm:p-5">
          {useDatabase && (
            <FindPeople
              already={team.map((m) => m.wallet.toLowerCase())}
              onPick={(person) => setDraft((d) => ({ ...d, wallet: person.wallet, name: d.name || person.username || "" }))}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.9fr_auto] lg:items-end">
            <Field label="Wallet address" placeholder="0x…" value={draft.wallet} onChange={(e) => setDraft({ ...draft, wallet: e.target.value })} />
            <Field label="Name" placeholder="Maya K." value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Field label="Role (optional)" placeholder="Designer" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
            <Field
              label="Salary per payday"
              inputMode="decimal"
              placeholder="0.00"
              suffix="USDC"
              value={draft.salary}
              onChange={(e) => setDraft({ ...draft, salary: e.target.value })}
            />
            <Button variant="secondary" disabled={!me} onClick={addMember}>
              Add
            </Button>
          </div>
          {teamError && <p className="text-[13px] text-danger">{teamError}</p>}
        </div>
      </Card>

      {/* Pay */}
      <Card title="Pay the team">
        <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
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
        {mode === "recurring" ? (
          <>
            <div className="mt-4 rounded-2xl border border-line bg-popover px-4 py-1.5">
              <Row label="People paid">{payable.length}</Row>
              <Row label="Each payday costs">{fmtUsdc(total)} USDC</Row>
              <Row label="Your treasury covers">{total > 0n ? `${(Number(p.employerBalance) / Number(total)).toFixed(1)} paydays` : "…"}</Row>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button size="lg" disabled={!viewer.canAct || payable.length === 0 || tx.state.busy} onClick={startSchedule}>
                Start {intervalLabel(Number(interval)).toLowerCase()} payroll
              </Button>
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                Paid automatically, weekdays 16:00 UTC.
                <InfoTip label="Automatic paydays">
                  A bot pays each due payday once the treasury covers it. You can also press Pay now. Your team then claims their pay. Private pay
                  needs your browser, so use Once, now for it.
                </InfoTip>
              </span>
            </div>
          </>
        ) : (
          <div className="mt-4">
            <PayNow
              team={payable.map((m) => ({ wallet: m.wallet, name: m.name, salary: m.salary }))}
              address={me}
              canAct={viewer.canAct && !tx.state.busy}
              walletUsdc={p.walletUsdc}
              treasury={p.employerBalance}
              onPayNormally={payMembers}
            />
          </div>
        )}
        <TxStatus state={tx.state} />
      </Card>

      {/* Schedules */}
      <Card title="Your schedules">
        {p.schedulesIRun.length === 0 ? (
          <Empty>No recurring payroll yet.</Empty>
        ) : (
          <div className="divide-y divide-line-soft">
            {p.schedulesIRun.map((s) => {
              const due = s.active && now > 0 && s.nextPayAt <= now;
              const funded = !shortOf(s);
              return (
                <div key={s.id.toString()} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                      {intervalLabel(s.interval)} · {s.employees.length} {s.employees.length === 1 ? "person" : "people"} ·{" "}
                      <span className="tabular-nums">{fmtUsdc(s.total)} USDC</span>
                      {!s.active && <Badge>Paused</Badge>}
                    </div>
                    {s.active && (
                      <div className={`mt-0.5 text-xs ${due && !funded ? "text-danger" : "text-muted"}`}>
                        {due ? (funded ? "A payday is due now" : "A payday is due, but the treasury is short. Top up to pay it.") : `Next payday ${until(s.nextPayAt, now)}`}
                      </div>
                    )}
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

      {/* Attendance */}
      <Card title="Attendance, last 14 days" tip="A record only. It does not change pay.">
        {!session.configured ? (
          <Empty>Attendance is not available right now.</Empty>
        ) : !session.signedIn ? (
          <Empty>Sign in (in the Team section above) to see your team&apos;s check-ins.</Empty>
        ) : team.length === 0 ? (
          <Empty>Add team members to see their check-ins.</Empty>
        ) : (
          <div className="space-y-3">
            {pending > 0 && (
              <p className="text-xs text-muted">
                {pending} invited {pending === 1 ? "person has" : "people have"} not accepted yet, so their check-ins are not shown.
              </p>
            )}
            {team
              .filter((m) => m.status === "accepted")
              .map((m) => {
                const checked = attendance.data?.team[m.wallet.toLowerCase()] ?? [];
                return (
                  <div key={m.wallet} className="grid items-center gap-2 sm:grid-cols-[10rem_1fr_3rem] sm:gap-3">
                    <div className="truncate text-[13px] font-medium">{m.name}</div>
                    <div className="flex gap-1" role="img" aria-label={`${m.name}: ${checked.length} of 14 days`}>
                      {days.map((d) => (
                        <span key={d} className={`h-6 flex-1 rounded-[4px] ${checked.includes(d) ? "bg-grow" : "bg-press"}`} />
                      ))}
                    </div>
                    <div className="text-right text-xs tabular-nums text-muted">{checked.length}/14</div>
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      <PaydayLog address={me} />

      <Card title="Past paydays" tip="Pay unclaimed for 180 days can be taken back into the treasury.">
        <PastRuns employer={me} />
      </Card>
    </>
  );
}
