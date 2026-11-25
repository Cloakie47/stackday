"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Notice, Row, TxStatus } from "@/components/ui";
import type { Address } from "@/lib/contracts";
import type { BuildResult } from "@/lib/chat/buildCalls";
import { useTx } from "@/lib/useTx";

/**
 * The confirmation card for one chat action. Everything on it comes from the same object the calls
 * come from (lib/chat/buildCalls.ts). The person signs in their own wallet with useTx, which simulates
 * every call first. The card expires two minutes after it was built.
 */
export function ActionCard({
  result,
  me,
  onClose,
  onBusyChange,
}: {
  result: BuildResult;
  me: Address;
  onClose: (outcome: "done" | "cancelled" | "expired") => void;
  /** True while the wallet steps run, so the panel keeps the card open until they finish. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const tx = useTx();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    onBusyChange?.(tx.state.busy);
  }, [tx.state.busy, onBusyChange]);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (!result.ok) {
    return (
      <div className="rounded-2xl border border-line bg-popover p-3.5">
        <Notice tone="warn">{result.reason}</Notice>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onClose("cancelled")}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const plan = result;
  const left = Math.max(0, plan.expiresAt - now);
  const expired = left === 0 && !finished;

  async function confirm() {
    if (Math.floor(Date.now() / 1000) >= plan.expiresAt) return;
    const ok = await tx.run(plan.calls, plan.doneMessage);
    if (!ok) return;
    setFinished(true);
    if (plan.registerKeeper) {
      // Let the trigger bot know, so future buys run on time (as the Invest page does). Optional.
      fetch("/api/keeper/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: me, asset: plan.registerKeeper }),
      }).catch(() => {});
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-popover p-3.5 shadow-[var(--shadow-pop)]" aria-label={`Confirm: ${plan.title}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{plan.title}</h3>
        <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">Testnet, test tokens</span>
      </div>
      <div className="mt-2">
        {plan.rows.map((r) => (
          <Row key={r.label} label={r.label}>
            {r.value}
          </Row>
        ))}
        <Row label="Stackday fee">{plan.fee}</Row>
      </div>
      <div className="mt-2 rounded-xl bg-sunken px-3 py-2 text-xs leading-relaxed text-ink-soft">
        <div>{plan.receiverLabel}:</div>
        <div className="mt-0.5 break-all font-mono text-[11.5px] text-ink">your wallet {me}</div>
      </div>
      {plan.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
          {plan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {plan.handoff ? (
        <div className="mt-3">
          <Notice>{plan.handoff}</Notice>
          <div className="mt-2 flex items-center justify-end gap-3">
            {plan.link && (
              <Link href={plan.link.href} className="text-xs font-semibold text-ink underline hover:text-brand-ink">
                {plan.link.label}
              </Link>
            )}
            <Button size="sm" variant="ghost" onClick={() => onClose("cancelled")}>
              Close
            </Button>
          </div>
        </div>
      ) : finished ? (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => onClose("done")}>
            Done
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted" aria-live="polite">
            {expired ? "This card expired. Ask again for fresh numbers." : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={tx.state.busy} onClick={() => onClose(expired ? "expired" : "cancelled")}>
              {expired ? "Close" : "Cancel"}
            </Button>
            <Button size="sm" disabled={expired || tx.state.busy || plan.calls.length === 0} onClick={confirm}>
              Confirm in wallet
            </Button>
          </div>
        </div>
      )}
      <TxStatus state={tx.state} />
    </div>
  );
}
