"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, Notice, Spinner } from "@/components/ui";
import { isCents, readyToReceive, recordsCsv, toCents, usePrivatePay, usePrivateRecords, type PrivateRecord } from "@/lib/confidential";
import { fmtUsdc, parseUsdc, shortAddr } from "@/lib/format";

type Member = { wallet: string; name: string; salary: string };

/**
 * Employer: one private payday for the whole team. People who have turned on private pay get an
 * encrypted amount through Fairblock; anyone not set up yet can be paid the normal way instead
 * (through the Payroll contract), so nobody waits for their salary.
 */
export function PrivatePayday({
  team,
  address,
  canAct,
  walletUsdc,
  onPayNormally,
}: {
  team: Member[];
  address: string | undefined;
  canAct: boolean;
  walletUsdc: bigint;
  /** Pays these people through the Payroll contract; returns the transaction hash (or true) on success. */
  onPayNormally: (members: Member[], payday: number) => Promise<boolean | string>;
}) {
  const pp = usePrivatePay(address);
  const [progress, setProgress] = useState<{ done: number; note: string }>();
  const payable = team.filter((m) => parseUsdc(m.salary) > 0n);
  const ready = useQuery({
    queryKey: ["private-ready", payable.map((m) => m.wallet.toLowerCase()).sort().join(",")],
    enabled: payable.length > 0,
    queryFn: () => readyToReceive(payable.map((m) => m.wallet)),
    refetchInterval: 30_000,
  });
  const isReady = (m: Member) => !!ready.data?.[m.wallet.toLowerCase()];
  const privateList = payable.filter(isReady);
  const normalList = payable.filter((m) => ready.data && !isReady(m));
  const amountOf = (m: Member) => toCents(parseUsdc(m.salary));
  const privateTotal = privateList.reduce((a, m) => a + amountOf(m), 0n);
  const status = pp.status;
  const busy = !!pp.busy || !canAct;
  const unevenCents = privateList.some((m) => !isCents(parseUsdc(m.salary)));

  async function payPrivately(payday = Date.now()) {
    setProgress({ done: 0, note: "Starting" });
    await pp.payMany(
      privateList.map((m) => ({ to: m.wallet, amount: amountOf(m), name: m.name })),
      (done, note) => setProgress({ done, note }),
      payday,
    );
  }

  /** Pay everyone in one go: the normal payments first (one transaction), then the private ones. */
  async function payAll() {
    const payday = Date.now();
    if (normalList.length > 0) {
      setProgress({ done: 0, note: `Paying ${normalList.length} the normal way` });
      const ok = await onPayNormally(normalList, payday);
      if (!ok) return setProgress(undefined);
    }
    if (privateList.length > 0) await payPrivately(payday);
    else setProgress(undefined);
  }
  const allTotal = payable.reduce((a, m) => a + amountOf(m), 0n);
  const canPayAll = status === "on" && privateList.length > 0 && normalList.length > 0 && privateTotal <= walletUsdc;

  return (
    <Card title="Private payday">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="grow">Real on Base Sepolia</Badge>
        <span className="text-xs text-muted">Confidential transfers by Fairblock. Test USDC.</span>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Pay your team without the amounts showing on chain. Each person turns on private pay once, on their My pay page. Wallet addresses stay
        visible; amounts do not. Paid from your wallet, not the treasury.
      </p>

      {payable.length === 0 ? (
        <div className="mt-5">
          <Notice>Add team members with a salary above to pay them privately.</Notice>
        </div>
      ) : (
        <>
          <div className="mt-5 divide-y divide-line">
            {payable.map((m) => (
              <div key={m.wallet} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{m.name || shortAddr(m.wallet)}</div>
                  <div className="text-xs text-muted">
                    {ready.isLoading ? "Checking…" : isReady(m) ? <span className="text-grow">Private pay ready</span> : <span className="text-warn">Not set up yet</span>}
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums">{fmtUsdc(amountOf(m))} USDC</span>
              </div>
            ))}
          </div>

          {!address ? null : status === "off" ? (
            <div className="mt-5">
              <p className="text-sm text-muted">Turn on your own private account first (one signature, one transaction).</p>
              <Button className="mt-3" disabled={busy} onClick={pp.turnOn}>
                Turn on private pay
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap gap-3">
              {canPayAll && (
                <Button disabled={busy} onClick={payAll}>
                  Pay all {payable.length} · ${fmtUsdc(allTotal)}
                </Button>
              )}
              <Button
                variant={canPayAll ? "secondary" : undefined}
                disabled={busy || status !== "on" || privateList.length === 0 || privateTotal > walletUsdc}
                onClick={() => payPrivately()}
              >
                Pay {privateList.length} privately · ${fmtUsdc(privateTotal)}
              </Button>
              {normalList.length > 0 && (
                <Button variant="secondary" disabled={busy} onClick={() => onPayNormally(normalList, Date.now())}>
                  Pay the {normalList.length} not set up the normal way
                </Button>
              )}
            </div>
          )}
          {status === "confirming" && <p className="mt-2 text-xs text-muted">Fairblock is confirming your private account.</p>}
          {privateTotal > walletUsdc && privateList.length > 0 && (
            <p className="mt-2 text-xs text-danger">Your wallet holds ${fmtUsdc(walletUsdc)} USDC; private pay is paid from your wallet.</p>
          )}
          {unevenCents && <p className="mt-2 text-xs text-muted">Amounts are rounded down to whole cents: private balances keep two decimals.</p>}
        </>
      )}

      {progress && pp.busy && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Spinner /> {progress.note}… each step waits for Fairblock (about a minute). Keep this page open.
        </p>
      )}
      {pp.busy && !progress && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Spinner /> {pp.busy}… check your wallet.
        </p>
      )}
      {pp.done && !pp.busy && <p className="mt-4 text-sm text-grow">{pp.done}</p>}
      {pp.error && !pp.busy && <p className="mt-4 text-sm text-danger">{pp.error}</p>}
    </Card>
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
      action={
        records.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={exportCsv}>
            Export CSV
          </Button>
        ) : undefined
      }
    >
      {paydays.length === 0 ? (
        <Notice>Paydays you pay from this browser appear here, private and normal, with each transaction.</Notice>
      ) : (
        <div className="divide-y divide-line">
          {paydays.map(([day, list]) => {
            const total = list.reduce((a, r) => a + Number(r.amount), 0);
            const priv = list.filter((r) => r.private).length;
            return (
              <details key={day} className="group py-3 first:pt-0">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {new Date(day).toLocaleString()}
                    <span className="ml-2 font-normal text-muted">
                      {list.length} {list.length === 1 ? "payment" : "payments"}
                      {priv > 0 ? ` · ${priv} private` : ""}
                      {list.length - priv > 0 ? ` · ${list.length - priv} normal` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">
                    {total.toFixed(2)} USDC
                    <span className="text-muted transition-transform group-open:rotate-180" aria-hidden>
                      ▾
                    </span>
                  </span>
                </summary>
                <div className="mt-3 space-y-2 rounded-2xl bg-sunken/70 p-3">
                  {list.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{r.name || shortAddr(r.who ?? "")}</span>
                        <Badge tone={r.private ? "grow" : "neutral"}>{r.private ? "Private" : "Normal"}</Badge>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums">{r.amount} USDC</span>
                        {r.tx ? (
                          <a className="font-mono text-xs text-brand underline-offset-4 hover:underline" href={BASESCAN_TX + r.tx} target="_blank" rel="noreferrer">
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
