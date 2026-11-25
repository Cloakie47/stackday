"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { AssetIcon, Button, Notice, Spinner, cx } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { ASSETS, EXPLORER, GIFT_BOX, assetByToken } from "@/lib/contracts";
import { fmtAsset, fmtUsdc } from "@/lib/format";
import { boughtParts, buildDeclineCall, buildOpenCall, type BoughtPart } from "@/lib/gifts/calls";
import { BOX_LABEL, KIND, pickToLegs, type MixLeg, type ResearchPick } from "@/lib/gifts/mix";
import type { Gift } from "@/lib/gifts/useGifts";
import { useTx } from "@/lib/useTx";

/** The three notices every gift screen carries. */
export function GiftNotices({ className = "" }: { className?: string }) {
  return (
    <ul className={cx("flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] leading-4 text-muted", className)}>
      <li>Base Sepolia testnet, test tokens</li>
      <li>Only for people in eligible places outside the US</li>
      <li>Gifts may have tax rules where you live</li>
    </ul>
  );
}

const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const r = 70 + (i % 3) * 18;
  return { dx: Math.round(Math.cos(angle) * r), dy: Math.round(Math.sin(angle) * r * 0.8 - 30) };
});

/** The box itself. Its motion comes from data-phase on the surrounding .gift-stage (globals.css). */
export function GiftBoxArt({ small = false }: { small?: boolean }) {
  return (
    <div className={cx("relative mx-auto", small ? "h-[60px] w-[66px]" : "h-[150px] w-[132px]")} aria-hidden>
      <div className={cx("absolute left-0 top-0 origin-top-left", small ? "scale-50" : "pt-[30px]")}>
        <div className="gift-glow" />
        {PARTICLES.map((p, i) => (
          <span key={i} className="gift-particle" style={{ ["--dx" as string]: `${p.dx}px`, ["--dy" as string]: `${p.dy}px` }} />
        ))}
        <div className="gift-box">
          <div className="gift-body">
            <div className="gift-ribbon-v" />
          </div>
          <div className="gift-lid">
            <div className="gift-ribbon-v" />
            <div className="gift-bow" />
          </div>
        </div>
      </div>
    </div>
  );
}

type Phase = "idle" | "pending" | "opened" | "failed";

/** "One stock: Apple" style summary of a fixed mix. */
function MixList({ legs, usdc }: { legs: MixLeg[]; usdc?: bigint }) {
  return (
    <ul className="space-y-1.5">
      {legs.map((l) => {
        const a = assetByToken(l.token);
        return (
          <li key={l.token} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <AssetIcon asset={a} size={24} />
              <span className="truncate">{a?.name ?? l.token}</span>
            </span>
            <span className="tabular-nums text-muted">
              {l.weightBps / 100}%{usdc !== undefined ? ` · $${fmtUsdc((usdc * BigInt(l.weightBps)) / 10_000n)}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function boxTypeOf(g: Pick<Gift, "kind" | "legs">): string {
  if (g.kind === KIND.Research) return BOX_LABEL.research;
  return g.legs.length === 1 ? BOX_LABEL.one : "Mix";
}

/**
 * Opening a gift: a sheet (full height on phones) with the box. Tap Open, sign `open`, the box shakes
 * while the transaction runs, and only once it is confirmed the lid lifts and one card per asset
 * rises with the amount read from the confirmed receipt (GiftPartBought logs). A failure closes the
 * box with the reason and a Retry.
 */
export function OpenGiftSheet({ gift, from, message, onClose }: { gift: Gift; from: string; message?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const tx = useTx();
  const publicClient = usePublicClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [parts, setParts] = useState<BoughtPart[]>([]);
  const [peek, setPeek] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string>();
  const research = gift.kind === KIND.Research;
  const [pick, setPick] = useState<{ pick: ResearchPick | null; reason?: string } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (!research) return;
    let live = true;
    fetch("/api/gifts/research")
      .then((r) => r.json())
      .then((b: { pick: ResearchPick | null; reason?: string }) => live && setPick(b))
      .catch(() => live && setPick({ pick: null, reason: "Could not read the research right now." }));
    return () => {
      live = false;
    };
  }, [research]);

  const researchLegs = pick?.pick ? pickToLegs(pick.pick, (id) => ASSETS.find((a) => a.symbol === id)?.token) : null;
  const canOpen = !!GIFT_BOX && (!research || !!researchLegs);
  const busy = phase === "pending" || tx.state.busy;

  async function open() {
    if (!GIFT_BOX || !publicClient) return;
    setError(undefined);
    setPhase("pending");
    let call;
    try {
      call = buildOpenCall(GIFT_BOX, gift.id, research ? (researchLegs ?? undefined) : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This gift cannot be opened right now.");
      setPhase("failed");
      return;
    }
    const hash = await tx.run([call], "Opened into your vault.");
    if (typeof hash !== "string") {
      setPhase("failed");
      return;
    }
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      setParts(boughtParts(GIFT_BOX, gift.id, receipt.logs));
      setPhase("opened");
    } catch {
      setError("The gift was opened, but its receipt could not be read. Check your vault.");
      setPhase("failed");
    }
  }

  async function decline() {
    if (!GIFT_BOX) return;
    if (await tx.run([buildDeclineCall(GIFT_BOX, gift.id)], "Declined. The USDC went back to the sender.")) setDeclined(true);
  }

  // Close the dialog and tell the page at once, so the next gift always gets a fresh sheet.
  function close() {
    ref.current?.close();
    onClose();
  }

  const reason = error ?? tx.state.error;
  const announce =
    phase === "pending"
      ? "Opening into your vault. Confirm in your wallet."
      : phase === "opened"
        ? `Gift opened. ${parts.map((p) => `${fmtAsset(p.assetOut, assetByToken(p.asset)?.decimals ?? 18)} ${assetByToken(p.asset)?.name ?? "asset"}`).join(", ")} added to your vault.`
        : phase === "failed"
          ? `The gift did not open. ${reason ?? ""}`
          : declined
            ? "Gift declined."
            : "";

  return (
    <dialog
      ref={ref}
      className="gift-sheet"
      aria-labelledby="gift-sheet-title"
      onCancel={(e) => {
        // Escape never closes the sheet while the wallet or the transaction is still running.
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="flex min-h-full flex-col sm:min-h-0">
        <div className="flex items-center justify-between px-4 pb-1 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] sm:pt-3">
          <h2 id="gift-sheet-title" className="text-sm font-semibold">
            A gift from {from}
          </h2>
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
            Close
          </Button>
        </div>

        <div className="gift-stage flex-1 overflow-y-auto overflow-x-hidden px-5 pb-4 pt-2" data-phase={phase}>
          <div className="pt-6">
            <GiftBoxArt />
          </div>
          <p className="mt-3 text-center font-display text-[28px] font-light tracking-[-0.02em]">${fmtUsdc(gift.usdc)}</p>
          <p className="text-center text-xs text-muted">{boxTypeOf(gift)} · test USDC, bought into your own vault when opened</p>
          {message && (
            <blockquote className="mx-auto mt-3 max-w-xs animate-[var(--animate-rise)] rounded-xl bg-press px-3.5 py-2.5 text-center text-[13px] italic text-ink-soft">
              &ldquo;{message}&rdquo;
            </blockquote>
          )}

          {/* Before opening: what is inside. */}
          {phase !== "opened" && !declined && (
            <div className="mt-5 rounded-2xl border border-line bg-popover p-3.5">
              {research ? (
                !pick ? (
                  <p className="flex items-center gap-2 text-[13px] text-muted">
                    <Spinner /> Reading the latest approved research...
                  </p>
                ) : researchLegs && pick.pick ? (
                  <>
                    <MixList legs={researchLegs} usdc={gift.usdc} />
                    <p className="mt-3 text-xs leading-relaxed text-muted">
                      Picked by {BRAND.name} research on {pick.pick.weekOf}, general research, not advice.
                    </p>
                  </>
                ) : (
                  <Notice tone="warn">
                    {pick.reason ?? "There is no approved research to pick from yet."} This box opens once an approved weekly report is available. You can
                    also decline it.
                  </Notice>
                )
              ) : peek ? (
                <>
                  <MixList legs={gift.legs} usdc={gift.usdc} />
                  <p className="mt-2 text-[11.5px] text-muted">The mix is public on the chain; hiding it is only for the fun of opening.</p>
                </>
              ) : (
                <button type="button" className="w-full text-left text-[13px] text-ink-soft" onClick={() => setPeek(true)}>
                  What is inside stays hidden until you open it. <span className="font-semibold text-ink underline">Peek anyway</span>
                </button>
              )}
            </div>
          )}

          {/* After the confirmed transaction: one card per asset, the real amounts from the receipt. */}
          {phase === "opened" && (
            <div className="mt-5 space-y-2">
              {parts.map((p, i) => {
                const a = assetByToken(p.asset);
                return (
                  <div
                    key={p.asset}
                    className="gift-card flex items-center justify-between gap-3 rounded-2xl border border-line bg-popover p-3.5 shadow-card"
                    style={{ animationDelay: `${0.45 + i * 0.12}s` }}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <AssetIcon asset={a} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a?.name ?? p.asset}</span>
                        <span className="block text-xs text-muted">${fmtUsdc(p.usdcIn)} of test USDC</span>
                      </span>
                    </span>
                    <span className="text-right text-sm tabular-nums">
                      {fmtAsset(p.assetOut, a?.decimals ?? 18)} <span className="text-xs text-muted">{a?.symbol}</span>
                    </span>
                  </div>
                );
              })}
              {tx.state.hash && (
                <p className="pt-1 text-center text-xs">
                  <a className="text-brand-ink underline" href={`${EXPLORER}/tx/${tx.state.hash}`} target="_blank" rel="noreferrer">
                    View transaction
                  </a>
                </p>
              )}
            </div>
          )}

          {phase === "failed" && reason && (
            <p className="mt-4 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger" role="alert">
              {reason}
            </p>
          )}
          {declined && <Notice tone="grow">Declined. The USDC went back to the sender.</Notice>}

          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>
        </div>

        {/* Actions in thumb reach. */}
        <div className="sticky bottom-0 border-t border-line-soft bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
          {phase === "opened" ? (
            <div className="grid grid-cols-2 gap-2">
              <Link href="/dashboard" className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-line text-[13px] font-medium">
                View in my vault
              </Link>
              <Button onClick={close}>Done</Button>
            </div>
          ) : declined ? (
            <Button className="w-full" onClick={close}>
              Done
            </Button>
          ) : (
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <Button variant="secondary" onClick={decline} disabled={busy}>
                Decline
              </Button>
              <Button onClick={open} disabled={busy || !canOpen}>
                {busy ? (
                  <>
                    <Spinner /> Opening into your vault...
                  </>
                ) : phase === "failed" ? (
                  "Retry"
                ) : (
                  "Open"
                )}
              </Button>
            </div>
          )}
          <GiftNotices className="mt-3 justify-center" />
        </div>
      </div>
    </dialog>
  );
}
