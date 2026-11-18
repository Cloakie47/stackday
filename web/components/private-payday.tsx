"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, Field, FillAmount, InfoTip, LabelTip, Notice, Row, Spinner } from "@/components/ui";
import { isCents, readyToReceive, recordsCsv, toCents, useLastPrivateStepAt, usePrivatePay, usePrivateRecords, type PrivateRecord, type PrivateStatus } from "@/lib/confidential";
import { fmtUsdc, parseUsdc, shortAddr } from "@/lib/format";

type Member = { wallet: string; name: string; salary: string };

/** "2 h 10 min" style duration. */
function ago(ms: number) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`;
}

/**
 * Why private pay cannot be used right now, in plain words, or undefined when it can.
 * `lastStepAt` is when the waiting step was sent, if known.
 */
export function privateBlockedReason(status: PrivateStatus | undefined, lastStepAt?: number | null): string | undefined {
  if (status === "off") return "Turn on private pay to use a private balance.";
  if (status === "confirming") return "Your private account is being confirmed. This usually takes about a minute.";
  if (status === "processing") {
    const when = lastStepAt
      ? `, sent at ${new Date(lastStepAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${ago(Date.now() - lastStepAt)} ago),`
      : "";
    const late = lastStepAt && Date.now() - lastStepAt > 10 * 60_000 ? " Confirming usually takes about a minute, so this one is taking longer than normal." : "";
    return `Your last private step (a deposit, payment or withdrawal)${when} is still being confirmed. Private pay unlocks as soon as it is confirmed, and the money stays in your private account meanwhile.${late}`;
  }
  return undefined;
}

/**
 * The employer's (or anyone's) private balance at Fairblock: hidden until unlocked with one signature
 * per visit, with Deposit (from the wallet) and Withdraw (back to the wallet) for any amount.
 */
export function PrivateBalancePanel({ address, canAct, walletUsdc }: { address: string | undefined; canAct: boolean; walletUsdc: bigint }) {
  const pp = usePrivatePay(address);
  const [amt, setAmt] = useState("");
  const amount = toCents(parseUsdc(amt));
  const busy = !!pp.busy || !canAct;
  const lastStep = useLastPrivateStepAt(address, pp.status === "processing");
  const blocked = privateBlockedReason(pp.status, lastStep.data);
  const bal = pp.balance;

  return (
    <div>
      <div className="text-[13px] text-muted">
        <LabelTip label="Private balance" tip="USDC at Fairblock for private pay. Amounts are encrypted on chain; only you can read this balance, in your browser." />
      </div>
      <div className="mt-2 font-display text-[34px] font-normal leading-[1.1] tracking-[-0.02em] sm:text-[40px]">
        {!address ? (
          <span className="text-muted">–</span>
        ) : pp.status === "off" ? (
          <span className="text-muted">Off</span>
        ) : bal ? (
          <span className="tabular-nums">${fmtUsdc(bal.spendable)}</span>
        ) : (
          <span className="text-muted">Hidden</span>
        )}
      </div>
      {bal && bal.pending > 0n && <p className="mt-1.5 text-xs text-muted">Plus ${fmtUsdc(bal.pending)} arriving, usable once Fairblock applies it.</p>}

      {!address || pp.status === undefined ? (
        <p className="mt-3 text-xs text-muted">{address ? "Checking with Fairblock…" : "Connect a wallet to see it."}</p>
      ) : pp.status === "off" ? (
        <div className="mt-3">
          <Button variant="secondary" disabled={busy || pp.statusLoading} onClick={pp.turnOn}>
            Turn on private pay
          </Button>
          <p className="mt-2 text-xs text-muted">One signature makes your private keys. Stackday never sees them.</p>
        </div>
      ) : blocked ? (
        <p className="mt-3 text-xs text-warn">{blocked}</p>
      ) : !bal ? (
        <div className="mt-3">
          <Button variant="secondary" disabled={busy} onClick={pp.reveal}>
            Unlock balance
          </Button>
          <p className="mt-2 text-xs text-muted">One signature per visit. It is decrypted in your browser only.</p>
        </div>
      ) : (
        <div className="mt-3">
          <Field
            label="Amount"
            inputMode="decimal"
            placeholder="0.00"
            suffix="USDC"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            hint={
              <>
                Wallet{" "}
                <FillAmount onFill={() => setAmt(fmtUsdc(toCents(walletUsdc)).replace(/,/g, ""))} label="Use your whole wallet balance">
                  {fmtUsdc(walletUsdc)}
                </FillAmount>{" "}
                · Private{" "}
                <FillAmount onFill={() => setAmt(fmtUsdc(bal.spendable).replace(/,/g, ""))} label="Use your whole private balance">
                  {fmtUsdc(bal.spendable)}
                </FillAmount>
              </>
            }
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy || amount === 0n || amount > walletUsdc} onClick={async () => (await pp.deposit(amount)) && setAmt("")}>
              Deposit
            </Button>
            <Button variant="secondary" disabled={busy || amount === 0n || amount > bal.spendable} onClick={async () => (await pp.withdraw(amount)) && setAmt("")}>
              Withdraw
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">Whole cents only. Each step waits for Fairblock, usually about a minute.</p>
        </div>
      )}
      {pp.busy && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <Spinner /> {pp.busy}… check your wallet, then Fairblock confirms.
        </p>
      )}
      {pp.done && !pp.busy && <p className="mt-3 text-[13px] text-grow">{pp.done}</p>}
      {pp.error && !pp.busy && <p className="mt-3 text-[13px] text-danger">{pp.error}</p>}
    </div>
  );
}

/**
 * Employer: pay the team once, now, in one list. Each person can be paid privately (Fairblock: the
 * amount is encrypted on chain, paid only from the employer's private balance) or the normal way
 * (Payroll contract, paid only from the treasury). People who have not turned on private pay are paid
 * the normal way. One "Pay all" button runs the normal payday first (one transaction), then the private ones.
 */
export function PayNow({
  team,
  address,
  canAct,
  treasury,
  onPayNormally,
  onFundTreasury,
}: {
  team: Member[];
  address: string | undefined;
  canAct: boolean;
  /** Unpaid USDC in the employer's Payroll treasury: normal pay comes only from here. */
  treasury: bigint;
  /** Pays these people through the Payroll contract; returns the transaction hash (or true) on success. */
  onPayNormally: (members: Member[], payday: number) => Promise<boolean | string>;
  /** Moves this much from the wallet into the treasury. */
  onFundTreasury: (amount: bigint) => Promise<unknown>;
}) {
  const pp = usePrivatePay(address);
  const [progress, setProgress] = useState<{ done: number; note: string }>();
  // People the employer switched to normal pay although they could receive privately.
  const [publicOverride, setPublicOverride] = useState<Record<string, boolean>>({});
  const payable = team.filter((m) => parseUsdc(m.salary) > 0n);
  const ready = useQuery({
    queryKey: ["private-ready", payable.map((m) => m.wallet.toLowerCase()).sort().join(",")],
    enabled: payable.length > 0,
    queryFn: () => readyToReceive(payable.map((m) => m.wallet)),
    refetchInterval: 30_000,
  });
  const status = pp.status;
  const employerOn = status === "on";
  const lastStep = useLastPrivateStepAt(address, status === "processing");
  const blocked = privateBlockedReason(status, lastStep.data);
  const isReady = (m: Member) => !!ready.data?.[m.wallet.toLowerCase()];
  const isPrivate = (m: Member) => employerOn && isReady(m) && !publicOverride[m.wallet.toLowerCase()];
  const amountOf = (m: Member) => parseUsdc(m.salary);
  const privateList = payable.filter(isPrivate);
  const normalList = payable.filter((m) => !isPrivate(m));
  const privateTotal = privateList.reduce((a, m) => a + toCents(amountOf(m)), 0n);
  const normalTotal = normalList.reduce((a, m) => a + amountOf(m), 0n);
  const busy = !!pp.busy || !canAct || !!progress;
  const unevenCents = privateList.some((m) => !isCents(amountOf(m)));
  const anyReady = payable.some(isReady);

  // Each kind of pay comes from its own balance only. Short balances block Pay all with a one-click fix.
  const treasuryShort = normalTotal > treasury ? normalTotal - treasury : 0n;
  const privateSpendable = pp.balance?.spendable;
  const privateShort =
    privateList.length === 0 ? 0n : privateSpendable === undefined ? undefined : privateTotal > privateSpendable ? toCents(privateTotal - privateSpendable + 9_999n) : 0n;
  const covered = treasuryShort === 0n && privateShort === 0n;
  // Normal pay is one transaction. Fairblock takes one private payment at a time, each signed.
  const signatures = (normalList.length > 0 ? 1 : 0) + privateList.length;

  function reasonFor(m: Member, ok: boolean): string {
    if (ready.isLoading) return "Checking private pay…";
    if (!ok) return "Paid the normal way: they have not turned on private pay in My pay yet";
    if (status === "off") return "Private pay ready: turn on yours to pay them privately";
    if (status === "confirming" || status === "processing") return "Private pay ready: waiting for your last private step to confirm";
    return isPrivate(m) ? "Paid privately" : "Private pay ready";
  }

  async function payAll() {
    const payday = Date.now();
    try {
      if (normalList.length > 0) {
        setProgress({ done: 0, note: `Paying ${normalList.length} from your treasury` });
        const ok = await onPayNormally(normalList, payday);
        if (!ok) return;
      }
      if (privateList.length > 0) {
        setProgress({ done: 0, note: "Starting private pay" });
        await pp.payMany(
          privateList.map((m) => ({ to: m.wallet, amount: toCents(amountOf(m)), name: m.name })),
          (done, note) => setProgress({ done, note }),
          payday,
        );
      }
    } finally {
      setProgress(undefined);
    }
  }

  if (payable.length === 0) return <Notice>Add team members with a salary to pay them.</Notice>;

  return (
    <div>
      <div className="divide-y divide-line-soft rounded-2xl border border-line bg-popover">
        {payable.map((m) => {
          const key = m.wallet.toLowerCase();
          const ok = isReady(m);
          const priv = isPrivate(m);
          return (
            <div key={m.wallet} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{m.name || shortAddr(m.wallet)}</div>
                <div className="text-xs text-muted">{reasonFor(m, ok)}</div>
              </div>
              <div className="flex items-center gap-4">
                <label className={`flex min-h-11 items-center gap-2 text-xs font-medium sm:min-h-9 ${ok && employerOn ? "cursor-pointer text-ink" : "cursor-not-allowed text-muted"}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-brand)]"
                    checked={priv}
                    disabled={!ok || !employerOn || busy}
                    onChange={(e) => setPublicOverride((o) => ({ ...o, [key]: !e.target.checked }))}
                  />
                  Private
                </label>
                <span className="w-24 text-right text-[13px] tabular-nums">{fmtUsdc(priv ? toCents(amountOf(m)) : amountOf(m))} USDC</span>
              </div>
            </div>
          );
        })}
      </div>

      {anyReady && blocked && <p className="mt-3 px-1 text-xs text-warn">{blocked} Until then everyone is paid the normal way.</p>}

      <div className="mt-3 rounded-2xl border border-line bg-popover px-4 py-1.5">
        <Row label={`Normal pay · ${normalList.length}`} tip="Paid only from your treasury.">
          {fmtUsdc(normalTotal)} USDC
        </Row>
        <Row label="Treasury">
          <span className={treasuryShort > 0n ? "text-danger" : ""}>{fmtUsdc(treasury)} USDC</span>
        </Row>
        {privateList.length > 0 && (
          <>
            <Row label={`Private pay · ${privateList.length}`} tip="Paid only from your private balance. Only each person can read their amount; wallet addresses still show.">
              {fmtUsdc(privateTotal)} USDC
            </Row>
            <Row label="Private balance">
              {privateSpendable === undefined ? (
                <span className="text-muted">Hidden</span>
              ) : (
                <span className={privateShort && privateShort > 0n ? "text-danger" : ""}>{fmtUsdc(privateSpendable)} USDC</span>
              )}
            </Row>
          </>
        )}
      </div>

      {(treasuryShort > 0n || privateShort !== 0n) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-popover px-4 py-3">
          <div className="max-w-md space-y-1 text-xs text-muted">
            {treasuryShort > 0n && <p>Your treasury is ${fmtUsdc(treasuryShort)} short for normal pay.</p>}
            {privateShort === undefined && <p>Unlock your private balance to check it covers private pay.</p>}
            {privateShort !== undefined && privateShort > 0n && <p>Your private balance is ${fmtUsdc(privateShort)} short for private pay.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {treasuryShort > 0n && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onFundTreasury(treasuryShort)}>
                Add ${fmtUsdc(treasuryShort)} to treasury
              </Button>
            )}
            {privateShort === undefined && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={pp.reveal}>
                Unlock private balance
              </Button>
            )}
            {privateShort !== undefined && privateShort > 0n && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => pp.deposit(privateShort)}>
                Deposit ${fmtUsdc(privateShort)} privately
              </Button>
            )}
          </div>
        </div>
      )}
      {privateList.length > 0 && <p className="mt-2 px-1 text-xs text-muted">Private pay hides amounts only. Wallet addresses still show.</p>}
      {unevenCents && <p className="mt-2 px-1 text-xs text-muted">Private amounts are rounded down to whole cents.</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy || !covered} onClick={payAll}>
          Pay all {payable.length} · ${fmtUsdc(normalTotal + privateTotal)}
        </Button>
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          About {signatures} {signatures === 1 ? "signature" : "signatures"}
          {privateList.length > 0 && <InfoTip label="Signatures">Fairblock sends one private payment at a time, each signed.</InfoTip>}
        </span>
      </div>

      {progress && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <Spinner /> {progress.note}…{privateList.length > 0 ? " private steps wait for Fairblock (about a minute each). Keep this page open." : ""}
        </p>
      )}
      {pp.busy && !progress && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <Spinner /> {pp.busy}… check your wallet.
        </p>
      )}
      {pp.done && !pp.busy && <p className="mt-3 text-[13px] text-grow">{pp.done}</p>}
      {pp.error && !pp.busy && <p className="mt-3 text-[13px] text-danger">{pp.error}</p>}
    </div>
  );
}

const BASESCAN_TX = "https://sepolia.basescan.org/tx/";

/**
 * Employer: one entry per payday, each opening to show every payment, whether it was private or
 * normal, and its transaction. Kept in this browser (private amounts are encrypted on chain, so this
 * is the readable copy); paydays run by the trigger bot are not listed here.
 */
export function PaydayLog({ address }: { address: string | undefined }) {
  const records = usePrivateRecords(address).filter((r) => r.kind === "paid");
  if (!address) return null;
  const groups = new Map<number, PrivateRecord[]>();
  for (const r of records) {
    const key = r.payday ?? r.at;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const paydays = [...groups.entries()].sort((a, b) => b[0] - a[0]);
  function exportCsv() {
    const blob = new Blob([recordsCsv(records)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stackday-payday-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Card
      title="Payday log"
      tip="Paydays you pay from this browser, private and normal, with each transaction. Paydays the bot pays are not listed."
      action={
        records.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={exportCsv}>
            Export CSV
          </Button>
        ) : undefined
      }
    >
      {paydays.length === 0 ? (
        <p className="text-[13px] text-muted">No paydays paid from this browser yet.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {paydays.map(([day, list]) => {
            const total = list.reduce((a, r) => a + Number(r.amount), 0);
            const priv = list.filter((r) => r.private).length;
            return (
              <details key={day} className="group py-3 first:pt-0">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 sm:min-h-9">
                  <span className="text-[13px] font-medium">
                    {new Date(day).toLocaleString()}
                    <span className="ml-2 font-normal text-muted">
                      {list.length} {list.length === 1 ? "payment" : "payments"}
                      {priv > 0 ? ` · ${priv} private` : ""}
                      {list.length - priv > 0 ? ` · ${list.length - priv} normal` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-[13px] tabular-nums">
                    {total.toFixed(2)} USDC
                    <span className="text-muted transition-transform group-open:rotate-180" aria-hidden>
                      ▾
                    </span>
                  </span>
                </summary>
                <div className="mt-2 space-y-2 rounded-xl border border-line bg-popover p-3">
                  {list.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{r.name || shortAddr(r.who ?? "")}</span>
                        <Badge tone={r.private ? "grow" : "neutral"}>{r.private ? "Private" : "Normal"}</Badge>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums">{r.amount} USDC</span>
                        {r.tx ? (
                          <a className="font-mono text-xs text-brand-ink underline-offset-4 hover:underline" href={BASESCAN_TX + r.tx} target="_blank" rel="noreferrer">
                            {r.tx.slice(0, 10)}…
                          </a>
                        ) : (
                          <span className="text-xs text-muted">no hash</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {priv > 0 && <p className="pt-1 text-xs text-muted">Private amounts are encrypted on chain: the transaction shows who was paid, not how much.</p>}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </Card>
  );
}
