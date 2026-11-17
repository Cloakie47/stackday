"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, Notice, Spinner } from "@/components/ui";
import { isCents, readyToReceive, toCents, usePrivatePay } from "@/lib/confidential";
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
  onPayNormally: (members: Member[]) => Promise<boolean>;
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

  async function payPrivately() {
    setProgress({ done: 0, note: "Starting" });
    await pp.payMany(
      privateList.map((m) => ({ to: m.wallet, amount: amountOf(m) })),
      (done, note) => setProgress({ done, note }),
    );
  }

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
              <Button disabled={busy || status !== "on" || privateList.length === 0 || privateTotal > walletUsdc} onClick={payPrivately}>
                Pay {privateList.length} privately · ${fmtUsdc(privateTotal)}
              </Button>
              {normalList.length > 0 && (
                <Button variant="secondary" disabled={busy} onClick={() => onPayNormally(normalList)}>
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
