"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useWalletClient } from "wagmi";
import { Button, Notice, Row, Spinner, TxStatus } from "@/components/ui";
import { EXPLORER, type Address } from "@/lib/contracts";
import type { BuildResult } from "@/lib/chat/buildCalls";
import { confirmAllowed, precheckLine, type PrecheckState } from "@/lib/chat/precheck";
import { recipientName } from "@/lib/chat/recipient";
import { searchPeople } from "@/lib/useAccount";
import { canBatchAtomically, useTx } from "@/lib/useTx";

/** What a finished card leaves behind in the chat: a receipt with every transaction hash. */
export type ChatReceipt = {
  title: string;
  rows: { label: string; value: string }[];
  hashes: `0x${string}`[];
  at: number;
};

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/** One transaction link per hash, numbered when there is more than one. */
export function TxLinks({ hashes }: { hashes: `0x${string}`[] }) {
  if (hashes.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs">
      {hashes.map((h, i) => (
        <li key={h}>
          <a href={`${EXPLORER}/tx/${h}`} target="_blank" rel="noreferrer" className="font-mono text-ink underline underline-offset-2 hover:text-brand-ink">
            {hashes.length > 1 ? `${i + 1}. ` : ""}
            {short(h)}
          </a>
          <span className="text-muted"> on BaseScan</span>
        </li>
      ))}
    </ul>
  );
}

/** The pre-check line: checking, passes, blocked (with reason, hint and "Check again") or could not check. */
function PrecheckNote({ check, onRefresh }: { check: PrecheckState; onRefresh?: () => void }) {
  if (check.status === "blocked") {
    return (
      <div className="mt-2" role="alert">
        <Notice tone="danger">
          {precheckLine(check)}
          {check.hint && <span className="mt-1 block">{check.hint}</span>}
        </Notice>
        {onRefresh && (
          <div className="mt-1.5 flex justify-end">
            <button type="button" onClick={onRefresh} className="hit text-xs font-semibold text-ink underline underline-offset-2 hover:text-brand-ink">
              Check again
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <p role="status" className={`mt-2 flex items-center gap-2 text-xs leading-relaxed ${check.status === "passes" ? "text-grow" : "text-muted"}`}>
      {check.status === "checking" && <Spinner />}
      {precheckLine(check)}
    </p>
  );
}

/** Whether the connected wallet signs every step at once (EIP-5792). Null while checking. */
function useOneSignature(steps: number): boolean | null {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [one, setOne] = useState<boolean | null>(steps <= 1 ? true : null);
  useEffect(() => {
    if (steps <= 1 || !walletClient || !address) return;
    let live = true;
    canBatchAtomically(walletClient, address).then((ok) => live && setOne(ok));
    return () => {
      live = false;
    };
  }, [steps, walletClient, address]);
  return one;
}

/**
 * The confirmation card for one chat action. Everything on it comes from the same object the calls
 * come from (lib/chat/buildCalls.ts). Before confirming it says exactly what the wallet will ask
 * (one signature, or each numbered step); while signing it shows which step is open; when done it
 * becomes a receipt with every transaction hash, which the chat keeps in its history.
 *
 * `check` is the pre-check from usePlan: every call simulated in order on Base Sepolia right after the
 * card was built. While it runs, and when it says a step would fail, Confirm is off; when the network
 * could not answer, Confirm stays on. The person signs in their own wallet with useTx, which simulates
 * each step again before the wallet opens when the wallet signs step by step. The card expires two
 * minutes after it was built.
 */
export function ActionCard({
  result,
  me,
  check,
  onRefresh,
  onClose,
  onBusyChange,
  onReceipt,
}: {
  result: BuildResult;
  me: Address;
  /** The pre-check of this card's calls (undefined for a refusal or a hand-off). */
  check?: PrecheckState;
  /**
   * Rebuilds this card from the same intent (fresh chain reads, fresh expiry, a new pre-check). No
   * model call. Shown as "Refresh numbers" once the card expires and "Check again" when it is blocked.
   */
  onRefresh?: () => void;
  onClose: (outcome: "done" | "cancelled" | "expired") => void;
  /** True while the wallet steps run, so the panel keeps the card open until they finish. */
  onBusyChange?: (busy: boolean) => void;
  /** Called once when the action went through, with its receipt. */
  onReceipt?: (r: ChatReceipt) => void;
}) {
  const tx = useTx();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [finished, setFinished] = useState(false);
  const steps = result.ok ? result.calls.length : 0;
  const oneSignature = useOneSignature(steps);
  // Gift card: show the recipient's name next to the ID when the people lookup finds exactly them.
  const giftId = result.ok ? result.giftRecipient : undefined;
  const people = useQuery({
    queryKey: ["chat-gift-recipient", giftId],
    queryFn: () => searchPeople(giftId ?? ""),
    enabled: !!giftId,
    staleTime: 60_000,
    retry: false,
  });
  const giftName = giftId && people.data ? recipientName(giftId, people.data.people) : null;


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
    if (Math.floor(Date.now() / 1000) >= plan.expiresAt || !confirmAllowed(check)) return;
    const ok = await tx.run(plan.calls, plan.doneMessage);
    if (!ok) return;
    setFinished(true);
    // Leave a receipt in the chat with every transaction of this action.
    onReceipt?.({ title: plan.title, rows: plan.rows, hashes: tx.hashesOfLastRun(), at: Date.now() });
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
        <h3 className="text-sm font-semibold text-ink">{finished ? `Done: ${plan.title}` : plan.title}</h3>
        <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">Testnet, test tokens</span>
      </div>
      <div className="mt-2">
        {plan.rows.map((r) => (
          <Row key={r.label} label={r.label}>
            {giftName && r.value === plan.giftRecipient ? `${r.value} (${giftName})` : r.value}
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

      {!plan.handoff && !finished && plan.calls.length > 0 && (
        <div className="mt-2 rounded-xl border border-line-soft px-3 py-2 text-xs leading-relaxed">
          <div className="font-medium text-ink">
            {plan.calls.length === 1 || oneSignature
              ? "Your wallet asks you once."
              : oneSignature === null
                ? `Checking your wallet for ${plan.calls.length} steps...`
                : `Your wallet asks you ${plan.calls.length} times, one step after another:`}
          </div>
          {plan.calls.length > 1 && (
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-ink-soft">
              {plan.calls.map((c) => (
                <li key={c.label}>{c.label}</li>
              ))}
            </ol>
          )}
          <div className="mt-1 text-muted">Once confirmed on chain, it cannot be undone.</div>
        </div>
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
        <div className="mt-3">
          <div className="text-xs font-medium text-grow">{plan.doneMessage}</div>
          <TxLinks hashes={tx.state.hashes ?? (tx.state.hash ? [tx.state.hash] : [])} />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => onClose("done")}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <>
          {check && !expired && !tx.state.busy && <PrecheckNote check={check} onRefresh={onRefresh} />}
          <div className="mt-3 flex items-center justify-between gap-2">
            {/* The countdown is not announced every second; only the change to expired is (below). */}
            <span className="text-xs tabular-nums text-muted">
              {expired ? "This card expired, so its numbers may be out of date." : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" disabled={tx.state.busy} onClick={() => onClose(expired ? "expired" : "cancelled")}>
                {expired ? "Close" : "Cancel"}
              </Button>
              {expired && onRefresh ? (
                <Button size="sm" onClick={onRefresh}>
                  Refresh numbers
                </Button>
              ) : (
                <Button size="sm" disabled={expired || tx.state.busy || plan.calls.length === 0 || !confirmAllowed(check)} onClick={confirm}>
                  Confirm in wallet
                </Button>
              )}
            </div>
          </div>
          <span className="sr-only" role="status">
            {expired ? "This card expired. Refresh the numbers or close it." : ""}
          </span>
        </>
      )}
      {!finished && <TxStatus state={tx.state} />}
    </div>
  );
}
