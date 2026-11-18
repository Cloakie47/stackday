"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SplitPicker } from "@/components/split-picker";
import { Badge, Button, Card, LabelTip, Notice, Row, Segmented, Spinner, Stat, TxStatus } from "@/components/ui";
import { routerAbi } from "@/lib/abis";
import { ADDR, ASSETS } from "@/lib/contracts";
import {
  addPrivateRecord,
  loadPrivateSplit,
  recordsCsv,
  savePrivateSplit,
  toCents,
  usePrivatePay,
  usePrivatePayWaiting,
  usePrivateRecords,
  withdrawQuote,
} from "@/lib/confidential";
import { assetForUsdc, fmtAsset, fmtUsdc } from "@/lib/format";
import type { Portfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";
import { BRAND } from "@/lib/brand";
import { splitAmount, type Split } from "@/lib/split";

type Rest = "keep" | "withdraw";
type Step = "idle" | "collecting" | "buying" | "done";
type Repeat = "once" | "always";

/**
 * Team member: collect private pay and invest a share of it, on one screen.
 * 1. Withdraw the investing share (and the rest, if chosen) from the private balance to the wallet.
 * 2. Wait for Fairblock to deliver it.
 * 3. Buy the chosen assets into the person's own vault (one-time buys, so no Stackday fee).
 * The rest can stay private, so the full salary never shows on chain.
 */
export function PrivateCollect({ p, address, canAct }: { p: Portfolio; address: string | undefined; canAct: boolean }) {
  const pp = usePrivatePay(address);
  const tx = useTx();
  const [split, setSplit] = useState<Split>({ pct: 10, symbols: [ASSETS[0].symbol] });
  const [rest, setRest] = useState<Rest>("keep");
  const [step, setStep] = useState<Step>("idle");
  const [note, setNote] = useState<string>();
  const [repeat, setRepeat] = useState<Repeat>("once");
  const [saved, setSaved] = useState(false);
  const waiting = usePrivatePayWaiting(address);

  // A saved "every payday" split fills the choices in, so collecting is one tap.
  useEffect(() => {
    const sp = loadPrivateSplit(address);
    setSaved(!!sp);
    if (!sp) return;
    setRepeat("always");
    setRest(sp.rest);
    const symbols = sp.symbols.filter((x) => ASSETS.some((a) => a.symbol === x));
    setSplit({ pct: sp.pct, symbols: symbols.length ? symbols : [ASSETS[0].symbol], weights: sp.weights });
  }, [address]);

  const status = pp.status;
  const balance = pp.balance;
  const available = balance ? balance.total : 0n;
  const pct = Math.min(100, Math.max(0, split.pct));
  const investGross = split.symbols.length ? toCents((available * BigInt(Math.round(pct * 100))) / 10_000n) : 0n;
  const restAmount = available - investGross;
  const toWithdraw = toCents(investGross + (rest === "withdraw" ? restAmount : 0n));
  // The invested part per asset, for the summary (before Fairblock's withdrawal fee).
  const preview = splitAmount(investGross, split);
  const posOf = (sym: string) => p.positions.find((x) => x.asset.symbol === sym)!;
  const names = preview.symbols.map((x) => posOf(x).asset.name);
  const namesText = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const busy = !!pp.busy || step === "collecting" || step === "buying" || !canAct;

  async function collectAndInvest() {
    if (toWithdraw === 0n) return;
    savePrivateSplit(address, repeat === "always" ? { pct, symbols: split.symbols, weights: split.weights, rest } : undefined);
    setSaved(repeat === "always");
    const walletBefore = p.walletUsdc;
    // What actually reaches the wallet after Fairblock's withdrawal fee.
    let investNet = investGross;
    try {
      const q = await withdrawQuote(toWithdraw);
      const net = BigInt(q.estimatedNetAmount);
      investNet = toWithdraw > 0n ? (investGross * net) / toWithdraw : 0n;
    } catch {
      /* quote unavailable: keep the gross figure; the buy below uses what arrived */
    }
    setStep("collecting");
    const ok = await pp.collect(toWithdraw, setNote);
    if (!ok) return setStep("idle");
    if (investNet === 0n) {
      setStep("done");
      return pp.reveal();
    }
    setStep("buying");
    setNote(`Buying ${namesText} into your vault`);
    const amount = investNet < walletBefore + toWithdraw ? investNet : walletBefore + toWithdraw;
    const parts = splitAmount(amount, split);
    // One approval for the total, then one one-time buy per asset. Wallets that batch sign it all once.
    const calls: Call[] = [
      ...(await tx.withApproval(ADDR.usdc, ADDR.router, amount, `Allow ${BRAND.name} to take the USDC`)),
      ...parts.symbols.map((sym, i) => {
        const x = posOf(sym);
        const min = x.price ? (assetForUsdc(parts.amounts[i], x.price, x.asset.decimals) * 99n) / 100n : 0n;
        return { label: `Buy ${x.asset.name} into your vault`, address: ADDR.router, abi: routerAbi, functionName: "invest", args: [x.asset.token, parts.amounts[i], min] } as Call;
      }),
    ];
    const bought = await tx.run(calls, `Collected and invested $${fmtUsdc(amount)} in ${namesText}.`);
    if (bought)
      parts.symbols.forEach((sym, i) =>
        addPrivateRecord(address, { at: Date.now(), kind: "invested", name: posOf(sym).asset.name, amount: (Number(parts.amounts[i]) / 1e6).toFixed(2) }),
      );
    setStep(bought ? "done" : "idle");
    pp.reveal();
  }

  return (
    <Card
      title="Private pay"
      tip="Your employer can pay you without the amount showing on chain. Only you can read it: it is decrypted in your browser. Collect it here and invest a share in the same step. Whatever you do not withdraw stays private."
      badge={<Badge tone="grow">Real on Base Sepolia</Badge>}
    >
      <p className="text-xs text-muted">Confidential transfers by Fairblock. Test USDC.</p>

      {waiting.data && step === "idle" && (
        <div className="mt-4">
          <Notice tone="grow">New private pay has arrived. Check it below and collect it{saved ? " with your usual split" : ""}.</Notice>
        </div>
      )}
      {!address ? (
        <div className="mt-5">
          <Notice>Connect your wallet to use private pay.</Notice>
        </div>
      ) : status === "off" ? (
        <div className="mt-5">
          <p className="text-[13px] text-muted">
            <LabelTip
              label="Turn it on once, before your first private payday."
              tip="One signature makes your private keys (kept in your browser), then one transaction opens your account. Fairblock confirms it in about a minute."
            />
          </p>
          <Button className="mt-3" disabled={busy} onClick={pp.turnOn}>
            Turn on private pay
          </Button>
        </div>
      ) : status === "confirming" ? (
        <div className="mt-5">
          <Notice>
            <span className="inline-flex items-center gap-2">
              <Spinner /> Fairblock is confirming your private account. You can already tell your employer you are ready.
            </span>
          </Notice>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat
              label="Private balance"
              value={balance ? `$${fmtUsdc(balance.total)}` : "Hidden"}
              hint={balance ? (balance.pending > 0n ? `includes $${fmtUsdc(balance.pending)} just arrived` : "Visible only to you") : "Encrypted on chain"}
            />
          </div>
          {!balance ? (
            <Button variant="secondary" disabled={busy} onClick={pp.reveal}>
              Check my private pay
            </Button>
          ) : available === 0n ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-muted">Nothing to collect yet.</p>
              <Button variant="ghost" size="sm" disabled={busy} onClick={pp.reveal}>
                Check again
              </Button>
            </div>
          ) : (
            <>
              <SplitPicker value={split} onChange={setSplit} assets={ASSETS} label="How much of this pay goes to work?" />
              <div className="grid gap-5 sm:grid-cols-2">
                <Segmented
                  label="The rest"
                  value={rest}
                  onChange={setRest}
                  options={[
                    { value: "keep", label: "Keep private" },
                    { value: "withdraw", label: "To my wallet" },
                  ]}
                />
                <Segmented
                  label="Use this split"
                  value={repeat}
                  onChange={setRepeat}
                  options={[
                    { value: "once", label: "Just this payday" },
                    { value: "always", label: "Every payday" },
                  ]}
                />
              </div>

              <div className="rounded-2xl border border-line bg-popover px-4 py-1.5">
                {preview.symbols.map((sym, i) => {
                  const x = posOf(sym);
                  return (
                    <Row key={sym} label={`Into ${x.asset.name}`}>
                      ${fmtUsdc(preview.amounts[i])}
                      {x.price ? ` · about ${fmtAsset(assetForUsdc(preview.amounts[i], x.price, x.asset.decimals), x.asset.decimals)} ${x.asset.symbol}` : ""}
                    </Row>
                  );
                })}
                <Row label={rest === "keep" ? "Stays private" : "To your wallet"}>${fmtUsdc(restAmount)}</Row>
                <Row label={`${BRAND.name} fee`}>None (one-time buy)</Row>
              </div>
              <div className="space-y-1 px-1 text-xs text-muted">
                {repeat === "always" && (
                  <p>
                    <LabelTip
                      label="Saved on this device as percentages only."
                      tip="Next payday it is filled in for you. You still press Collect, because only your browser holds your private keys."
                    />
                  </p>
                )}
                <p>Fairblock takes a small fee on each withdrawal. Amounts that leave the private balance are visible on chain.</p>
              </div>

              <Button className="w-full sm:w-auto" disabled={busy || toWithdraw === 0n} onClick={collectAndInvest}>
                {investGross > 0n
                  ? `Collect and invest $${fmtUsdc(investGross)}${saved && repeat === "always" ? " as usual" : ""}`
                  : `Collect $${fmtUsdc(toWithdraw)} to my wallet`}
              </Button>
            </>
          )}
        </div>
      )}

      {step !== "idle" && (
        <ol className="mt-4 space-y-1.5 text-[13px]">
          <li className={step === "collecting" ? "text-ink" : "text-muted"}>
            {step === "collecting" ? <Spinner /> : "✓"} 1. Collect from your private balance{step === "collecting" && note ? `: ${note}` : ""}
          </li>
          {investGross > 0n && (
            <li className={step === "buying" ? "text-ink" : "text-muted"}>
              {step === "buying" ? <Spinner /> : step === "done" ? "✓" : "·"} 2. Buy {namesText} into your vault
            </li>
          )}
        </ol>
      )}
      <TxStatus state={tx.state} />
      {pp.busy && step === "idle" && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <Spinner /> {pp.busy}… check your wallet.
        </p>
      )}
      {pp.error && !pp.busy && <p className="mt-3 text-[13px] text-danger">{pp.error}</p>}
      {step === "done" && !tx.state.busy && <p className="mt-3 text-[13px] text-grow">Done. Your vault and wallet update in a few seconds.</p>}
    </Card>
  );
}

/**
 * Shown with team invites: turn on private pay early, so the account is ready (Fairblock takes about a
 * minute to confirm) before the first private payday.
 */
export function PrivatePaySetup({ address, canAct }: { address: string | undefined; canAct: boolean }) {
  const pp = usePrivatePay(address);
  if (!address || !pp.status) return null;
  if (pp.status !== "off")
    return <p className="mt-3 text-xs text-grow">{pp.status === "confirming" ? "Private pay: Fairblock is confirming your account." : "Private pay is on: your employer can pay you privately."}</p>;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-popover px-4 py-3">
      <p className="max-w-md text-xs text-muted">
        <LabelTip
          label="Turn on private pay now."
          tip="Your employer can then pay you without the amount showing on chain. One signature and one transaction."
        />
      </p>
      <Button size="sm" variant="secondary" disabled={!!pp.busy || !canAct} onClick={pp.turnOn}>
        {pp.busy ? "Check your wallet…" : "Turn on private pay"}
      </Button>
      {pp.error && <p className="w-full text-xs text-danger">{pp.error}</p>}
    </div>
  );
}

/** A person's private pay record on this device, with a CSV export for an accountant or auditor. */
export function PrivateRecords({ address, role }: { address: string | undefined; role: "employer" | "member" }) {
  const records = usePrivateRecords(address);
  if (!address || records.length === 0) return null;
  function exportCsv() {
    const blob = new Blob([recordsCsv(records)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stackday-private-pay-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const label = { paid: "Paid privately", collected: "Collected", invested: "Invested" } as const;
  return (
    <Card
      title={role === "employer" ? "Private payroll record" : "Private pay record"}
      tip="For your own books. Export it to share with an accountant or auditor. Amounts on chain stay encrypted; this record is the readable copy."
      action={
        <Button size="sm" variant="secondary" onClick={exportCsv}>
          Export CSV
        </Button>
      }
    >
      <p className="text-xs text-muted">
        Kept in this browser only.{" "}
        <a className="font-semibold text-brand-ink underline-offset-4 hover:underline" href="https://docs.fairblock.network/ct/how-it-works/compliance" target="_blank" rel="noreferrer">
          Fairblock compliance
        </a>
      </p>
      <div className="mt-3 divide-y divide-line-soft">
        {records.slice(0, 12).map((r, i) => (
          <div key={`${r.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
            <span>
              {label[r.kind]}
              {r.name ? ` · ${r.name}` : ""}
              <span className="ml-2 text-xs text-muted">{new Date(r.at).toLocaleString()}</span>
            </span>
            <span className="tabular-nums">{r.amount} USDC</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Home: a reminder when new private pay has arrived and is not collected yet. */
export function PrivatePayWaiting({ address }: { address: string | undefined }) {
  const waiting = usePrivatePayWaiting(address);
  if (!waiting.data) return null;
  const split = loadPrivateSplit(address);
  return (
    <Notice tone="grow">
      New private pay has arrived.{" "}
      <Link href="/pay" className="font-semibold underline underline-offset-2">
        {split && split.pct > 0 ? `Collect it and invest ${split.pct}% as usual` : "Collect it on My pay"}
      </Link>
    </Notice>
  );
}
