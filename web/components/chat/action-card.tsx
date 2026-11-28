"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useWalletClient } from "wagmi";
import { BeforeAfter, Button, HealthMeter, Notice, Row, Skeleton, Spinner, TxStatus } from "@/components/ui";
import type { Address } from "@/lib/contracts";
import type { BuildResult, Destination } from "@/lib/chat/buildCalls";
import { confirmAllowed, precheckLine, type PrecheckState } from "@/lib/chat/precheck";
import { recipientName } from "@/lib/chat/recipient";
import { searchPeople } from "@/lib/useAccount";
import { canBatchAtomically, useTx } from "@/lib/useTx";
import { TxLinks, type ChatReceipt } from "./receipt-card";

export { TxLinks, type ChatReceipt } from "./receipt-card";

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-2)}`;

/** The pre-check line: checking, passes, blocked (with reason, hint and "Check again") or could not check. */
function PrecheckNote({ check, onRefresh }: { check: PrecheckState; onRefresh?: () => void }) {
  if (check.status === "blocked") {
    return (
      <div className="mt-3" role="alert">
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
    <p role="status" className={`mt-3 flex items-center gap-2 text-xs leading-relaxed ${check.status === "passes" ? "text-grow" : "text-muted"}`}>
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

/** Where the money goes: one line, plus the full address when it leaves the person's own wallet and vault. */
function DestinationLine({ d }: { d: Destination }) {
  if (d.kind === "none") return null;
  const icon = (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-muted">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
  if (d.kind === "recipient") {
    const who = d.name ? `@${d.name.replace(/^@/, "")}` : d.id ? d.id : "this address";
    return (
      <div className="mt-3 flex gap-2 rounded-xl border border-line-soft bg-sunken px-3 py-2 text-xs leading-relaxed">
        {icon}
        <div className="min-w-0">
          <div className="font-medium text-ink">
            To {who}
            {d.name && d.id ? <span className="font-normal text-muted"> ({d.id})</span> : null}
          </div>
          {d.address && <div className="mt-0.5 break-all font-mono text-[11.5px] text-ink">{d.address}</div>}
        </div>
      </div>
    );
  }
  const label = d.kind === "own_vault" ? "Into your vault" : "To your wallet";
  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-line-soft bg-sunken px-3 py-2 text-xs">
      {icon}
      <span className="text-ink">
        {label}
        {d.address && (
          <span className="ml-1 font-mono text-ink-soft" title={d.address}>
            {shortAddr(d.address)}
          </span>
        )}
      </span>
    </div>
  );
}

const fmtH = (h: number | null) => (h === null || !isFinite(h) ? "No loan" : h > 99 ? "99+" : h.toFixed(2));

/** Loan health before and after this card, with the gauge at the after value. */
function HealthChange({ before, after }: { before: number | null; after: number | null }) {
  const tone = after === null ? "grow" : after < 1 ? "danger" : after < 1.25 ? "warn" : before !== null && after < before ? "brand" : "grow";
  return (
    <div className="mt-3 rounded-xl border border-line-soft px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="text-muted">Loan health</span>
        <BeforeAfter from={fmtH(before)} to={fmtH(after)} tone={tone} />
      </div>
      <div className="mt-2.5">
        <HealthMeter health={after === null ? undefined : after} compact />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>Liquidation at 1.00</span>
        <span>Higher is safer</span>
      </div>
    </div>
  );
}

/** The card's place while the plan builds: the same shape, in grey. */
export function ActionCardSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-popover p-3.5" role="status" aria-label="Preparing the card with live prices">
      <div className="flex justify-between gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-5 w-[85%]" />
      <Skeleton className="mt-1.5 h-5 w-[55%]" />
      <Skeleton className="mt-4 h-9 w-full rounded-xl" />
      <div className="mt-3 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[70%]" />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Skeleton className="h-9 w-16 rounded-[9px]" />
        <Skeleton className="h-9 w-32 rounded-[9px]" />
      </div>
      <span className="sr-only">Preparing the card with live prices...</span>
    </div>
  );
}

/**
 * The confirmation card for one chat action. Everything on it comes from the same object the calls
 * come from (lib/chat/buildCalls.ts). The top says the action in one sentence and where the money
 * goes; three rows sum it up (the key figure, the fee, how many signatures); the rest sits under
 * Details. The footer (countdown, Cancel, Confirm) stays in view while the card scrolls.
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
  const [typed, setTyped] = useState("");
  const suffixId = useId();
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
  // If the card goes away mid-flow (the dock swaps it for its receipt), the panel is not left "busy".
  const busyChange = useRef(onBusyChange);
  useEffect(() => {
    busyChange.current = onBusyChange;
  });
  useEffect(() => () => busyChange.current?.(false), []);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (!result.ok) {
    // A refusal is said calmly: what cannot be done here, then the reason. Chips below offer next steps.
    return (
      <div className="rounded-2xl border border-line bg-popover p-3.5" role="note">
        <div className="flex items-start gap-2.5 rounded-xl bg-warn-soft px-3 py-2.5 text-warn">
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <div className="min-w-0 text-[13px] leading-relaxed">
            <div className="font-semibold">I can&apos;t do that here.</div>
            <div className="mt-0.5">{result.reason}</div>
          </div>
        </div>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onClose("cancelled")}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const plan = result;
  const headline = plan.headline || plan.title;
  const dest = plan.destination;
  const suffix = dest.confirmSuffix?.trim();
  const suffixOk = !suffix || typed.trim().toLowerCase() === suffix.toLowerCase();
  const left = Math.max(0, plan.expiresAt - now);
  const expired = left === 0 && !finished;
  const rowValue = (r: { label: string; value: string }) => (giftName && r.value === plan.giftRecipient ? `${r.value} (${giftName})` : r.value);

  // Summary: the first row the headline does not already say, then the fee and the signatures.
  const key = plan.rows.find((r) => !headline.includes(r.value)) ?? plan.rows[0];
  const rest = plan.rows.filter((r) => r !== key);
  const multi = plan.calls.length > 1;
  const signatures =
    plan.calls.length === 0 ? null : !multi || oneSignature ? "1 signature" : oneSignature === null ? "Checking your wallet..." : `${plan.calls.length} steps`;

  async function confirm() {
    if (Math.floor(Date.now() / 1000) >= plan.expiresAt || !confirmAllowed(check) || !suffixOk) return;
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
    // Leave a receipt in the chat with every transaction of this action (the dock shows it in place of the card).
    onReceipt?.({ title: plan.title, headline: plan.headline, fee: plan.fee, rows: plan.rows, hashes: tx.hashesOfLastRun(), at: Date.now() });
  }

  const showFooter = !plan.handoff && !finished;

  return (
    <div className="rounded-2xl border border-line bg-popover shadow-[var(--shadow-pop)]" aria-label={`Confirm: ${plan.title}`}>
      <div className="p-3.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted">{plan.title}</span>
          <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn">Testnet, test tokens</span>
        </div>
        <h3 className="mt-1.5 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">{finished ? `Done. ${headline}` : headline}</h3>

        <DestinationLine d={dest} />
        {plan.health && <HealthChange before={plan.health.before} after={plan.health.after} />}

        <div className="mt-2">
          {key && <Row label={key.label}>{rowValue(key)}</Row>}
          <Row label="Fee">{plan.fee}</Row>
          {signatures && !plan.handoff && <Row label="Signatures">{signatures}</Row>}
        </div>

        {(rest.length > 0 || plan.notes.length > 0 || (multi && !plan.handoff)) && (
          <details className="chat-details group mt-1 rounded-xl border border-line-soft">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-medium text-ink-soft hover:text-ink sm:min-h-9">
              Details
              <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="text-muted transition-transform group-open:rotate-180">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <div className="border-t border-line-soft px-3 pb-2 pt-1">
              {rest.map((r) => (
                <Row key={r.label} label={r.label}>
                  {rowValue(r)}
                </Row>
              ))}
              {multi && !plan.handoff && (
                <div className="py-2 text-xs leading-relaxed">
                  <div className="font-medium text-ink">
                    {oneSignature ? "Your wallet signs these steps at once:" : `Your wallet asks you ${plan.calls.length} times, one step after another:`}
                  </div>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-ink-soft">
                    {plan.calls.map((c) => (
                      <li key={c.label}>{c.label}</li>
                    ))}
                  </ol>
                </div>
              )}
              {plan.notes.length > 0 && (
                <ul className="space-y-1 py-1.5 text-xs leading-relaxed text-muted">
                  {plan.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}

        {showFooter && suffix && (
          <div className="mt-3">
            <label htmlFor={suffixId} className="block text-xs font-medium text-ink">
              Type the last {suffix.length} characters of the address to confirm
            </label>
            <input
              id={suffixId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={suffix.length + 4}
              required
              aria-invalid={typed.length > 0 && !suffixOk}
              className="mt-1.5 h-10 w-full rounded-xl border border-line bg-popover px-3 font-mono text-base text-ink placeholder:text-muted focus:border-[var(--focus)] focus:outline-none sm:text-sm"
              placeholder={`${suffix.length} characters`}
            />
            {typed.length >= suffix.length && !suffixOk && <p className="mt-1 text-xs text-danger">That does not match the end of the address.</p>}
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
            {expired && <p className="mt-3 text-xs text-warn">This card expired, so its numbers may be out of date.</p>}
            {check && !expired && !tx.state.busy && <PrecheckNote check={check} onRefresh={onRefresh} />}
            {plan.calls.length > 0 && <p className="mt-2 text-[11.5px] text-muted">Once confirmed on chain, it cannot be undone.</p>}
          </>
        )}
        {!finished && <TxStatus state={tx.state} />}
      </div>

      {showFooter && (
        // Sticks to the bottom of the chat while the card scrolls, so Confirm stays in reach on a phone.
        <div className="sticky bottom-0 z-[1] flex items-center justify-between gap-2 rounded-b-2xl border-t border-line-soft bg-popover px-3.5 py-2.5">
          {/* The countdown is not announced every second; only the change to expired is (below). */}
          <span className="min-w-0 text-xs tabular-nums text-muted" aria-hidden>
            {expired ? "Expired" : `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
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
              <Button size="sm" disabled={expired || tx.state.busy || plan.calls.length === 0 || !confirmAllowed(check) || !suffixOk} onClick={confirm}>
                Confirm in wallet
              </Button>
            )}
          </div>
          <span className="sr-only" role="status">
            {expired ? "This card expired, so its numbers may be out of date. Refresh the numbers or close it." : ""}
          </span>
        </div>
      )}
    </div>
  );
}
