"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, InfoTip, LabelTip, Notice, Row, Spinner } from "@/components/ui";
import { isCents, readyToReceive, recordsCsv, toCents, usePrivatePay, usePrivateRecords, type PrivateRecord } from "@/lib/confidential";
import { fmtUsdc, parseUsdc, shortAddr } from "@/lib/format";

type Member = { wallet: string; name: string; salary: string };

/**
 * Employer: pay the team once, now, in one list. Each person can be paid privately (Fairblock: the
 * amount is encrypted on chain, paid from the employer's wallet) or the normal way (Payroll contract,
 * from the treasury first). People who have not turned on private pay are paid the normal way.
 * One "Pay all" button runs the normal payday first (one transaction), then the private ones.
 */
export function PayNow({
  team,
  address,
  canAct,
  walletUsdc,
  treasury,
  onPayNormally,
}: {
  team: Member[];
  address: string | undefined;
  canAct: boolean;
  walletUsdc: bigint;
  /** Unpaid USDC in the employer's Payroll treasury, used first for normal payments. */
  treasury: bigint;
  /** Pays these people through the Payroll contract; returns the transaction hash (or true) on success. */
  onPayNormally: (members: Member[], payday: number) => Promise<boolean | string>;
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
  const isReady = (m: Member) => !!ready.data?.[m.wallet.toLowerCase()];
  const isPrivate = (m: Member) => employerOn && isReady(m) && !publicOverride[m.wallet.toLowerCase()];
  const amountOf = (m: Member) => parseUsdc(m.salary);
  const privateList = payable.filter(isPrivate);
  const normalList = payable.filter((m) => !isPrivate(m));
  const privateTotal = privateList.reduce((a, m) => a + toCents(amountOf(m)), 0n);
  const normalTotal = normalList.reduce((a, m) => a + amountOf(m), 0n);
  const normalFromWallet = normalTotal > treasury ? normalTotal - treasury : 0n;
  const busy = !!pp.busy || !canAct || !!progress;
  const unevenCents = privateList.some((m) => !isCents(amountOf(m)));
  const anyReady = payable.some(isReady);
  // The private balance is only known once it is unlocked this visit (one signature makes the keys).
  const privateSpendable = pp.balance ? pp.balance.total - pp.balance.pending : undefined;
  const privateShort = privateSpendable === undefined ? undefined : privateTotal > privateSpendable ? toCents(privateTotal - privateSpendable + 9_999n) : 0n;
  // How many times the wallet will ask to sign. Normal pay is one transaction when the treasury
  // covers it (a top-up from the wallet adds an approval unless the wallet batches). Fairblock takes
  // one private payment at a time, each signed, so private pay is one signature per person, plus one
  // to unlock the keys this visit and one to top up the private balance if it is short.
  // Private pay comes out of the private balance; the wallet only covers what that balance lacks.
  const fromWallet = (privateShort ?? privateTotal) + normalFromWallet;
  const signatures =
    (normalList.length > 0 ? (normalFromWallet > 0n ? 2 : 1) : 0) +
    (privateList.length > 0 ? privateList.length + (pp.balance ? 0 : 1) + (privateShort === 0n ? 0 : 1) : 0);

  async function payAll() {
    const payday = Date.now();
    try {
      if (normalList.length > 0) {
        setProgress({ done: 0, note: `Paying ${normalList.length} the normal way` });
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
                <div className="text-xs text-muted">
                  {ready.isLoading ? "Checking private pay…" : ok ? "Private pay ready" : "Paid the normal way (no private pay yet)"}
                </div>
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

      {anyReady && status === "off" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-popover px-4 py-3">
          <p className="max-w-md text-xs text-muted">Some of your team can be paid privately. Turn on your own private account first.</p>
          <Button size="sm" variant="secondary" disabled={!!pp.busy || !canAct} onClick={pp.turnOn}>
            Turn on private pay
          </Button>
        </div>
      )}
      {status === "confirming" && <p className="mt-3 text-xs text-muted">Fairblock is confirming your private account; private pay unlocks in a minute.</p>}

      {employerOn && anyReady && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-popover px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">
              <LabelTip label="Private payroll balance" tip="Unlock it once per visit (one signature) to see whether it covers this payday." />
            </div>
            <div className="mt-0.5 text-[13px] font-medium tabular-nums">
              {privateSpendable === undefined ? "Hidden until you unlock it" : `$${fmtUsdc(privateSpendable)} ready to pay out`}
            </div>
            <div className="text-xs text-muted">
              {privateShort === undefined
                ? "Unlock to check it covers this payday."
                : privateShort > 0n
                  ? `Top it up before payday: $${fmtUsdc(privateShort)} more covers the private pay below.`
                  : "Covers the private pay below: no top-up needed on payday."}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {privateSpendable === undefined ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={pp.reveal}>
                Unlock
              </Button>
            ) : (
              <>
                {privateShort !== undefined && privateShort > 0n && (
                  <Button size="sm" variant="secondary" disabled={busy || privateShort > walletUsdc} onClick={async () => (await pp.deposit(privateShort)) && pp.reveal()}>
                    Top up ${fmtUsdc(privateShort)}
                  </Button>
                )}
                {privateSpendable > 0n && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={async () => (await pp.withdraw(toCents(privateSpendable))) && pp.reveal()}>
                    Withdraw leftover
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-line bg-popover px-4 py-1.5">
        <Row label={`Normal pay · ${normalList.length}`} tip="Comes from your treasury first, then your wallet.">
          {fmtUsdc(normalTotal)} USDC
        </Row>
        <Row
          label={`Private pay · ${privateList.length}`}
          tip="Comes from your private payroll balance, topped up from your wallet if it is short. Only each person can read their amount; wallet addresses still show."
        >
          {fmtUsdc(privateTotal)} USDC
        </Row>
        <Row label="Taken from your wallet now">{fmtUsdc(fromWallet)} USDC</Row>
      </div>
      {privateList.length > 0 && <p className="mt-2 px-1 text-xs text-muted">Private pay hides amounts only. Wallet addresses still show.</p>}
      {unevenCents && <p className="mt-2 px-1 text-xs text-muted">Private amounts are rounded down to whole cents.</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy || fromWallet > walletUsdc} onClick={payAll}>
          Pay all {payable.length} · ${fmtUsdc(normalTotal + privateTotal)}
        </Button>
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          About {signatures} {signatures === 1 ? "signature" : "signatures"}
          {privateList.length > 0 && <InfoTip label="Signatures">Fairblock sends one private payment at a time, each signed.</InfoTip>}
        </span>
      </div>
      {fromWallet > walletUsdc && <p className="mt-2 text-xs text-danger">Your wallet holds ${fmtUsdc(walletUsdc)} USDC; this payday needs ${fmtUsdc(fromWallet)} from it.</p>}

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
