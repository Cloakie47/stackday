"use client";

import Link from "next/link";
import { useState } from "react";
import { isAddress } from "viem";
import { Badge, Button, Card, Field, Notice, Select, Spinner, Stat, buttonClass } from "@/components/ui";
import { CENT, isCents, usePrivatePay, usePrivateStatus, type PrivateStatus } from "@/lib/confidential";
import { fmtUsdc, parseUsdc, shortAddr } from "@/lib/format";

const STATUS_TEXT: Record<PrivateStatus, string> = {
  off: "Off",
  confirming: "Waiting for Fairblock to confirm",
  processing: "Fairblock is processing your last step",
  on: "On",
};

function centsHint(v: bigint) {
  return v > 0n && !isCents(v) ? "Use whole cents (for example 12.50). Private balances keep two decimals." : undefined;
}

/** Shows whether a team member can receive private pay yet. */
function ReceiverStatus({ address }: { address: string }) {
  const s = usePrivateStatus(isAddress(address) ? address : undefined);
  if (!isAddress(address)) return null;
  if (s.isLoading) return <span className="text-xs text-muted">Checking…</span>;
  return s.data === "on" || s.data === "processing" ? (
    <span className="text-xs text-grow">Can receive private pay</span>
  ) : (
    <span className="text-xs text-warn">They need to turn on private pay first (on their My pay page)</span>
  );
}

export function PrivatePay({
  address,
  role,
  team = [],
  canAct = true,
}: {
  address: string | undefined;
  /** False when someone views another wallet read-only. */
  canAct?: boolean;
  role: "employer" | "member";
  team?: { wallet: string; name: string }[];
}) {
  const pp = usePrivatePay(address);
  const [depositAmt, setDepositAmt] = useState("");
  const [payTo, setPayTo] = useState("");
  const [payAmt, setPayAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const deposit = parseUsdc(depositAmt);
  const pay = parseUsdc(payAmt);
  const withdraw = parseUsdc(withdrawAmt);
  const status = pp.status;
  const on = status === "on";
  const busy = !!pp.busy || status === "processing" || !canAct;
  const recipient = payTo.trim();

  return (
    <Card title="Private pay">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="grow">Real on Base Sepolia</Badge>
        <span className="text-xs text-muted">Confidential transfers by Fairblock. Test USDC.</span>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        {role === "employer"
          ? "Pay someone without the amount showing on chain. You move USDC into a private balance, then send each person an amount only they can read. Wallet addresses still show."
          : "Receive pay without the amount showing on chain. Only you can read your private balance; it is decrypted in your browser. Withdraw it to your wallet whenever you like, then invest a share."}{" "}
        <a className="font-medium text-brand underline-offset-4 hover:underline" href="https://docs.fairblock.network/ct/get-started/architecture" target="_blank" rel="noreferrer">
          How it works
        </a>
      </p>

      <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3">
        <Stat label="Private pay" value={pp.statusLoading ? "…" : status ? STATUS_TEXT[status] : "…"} hint={status === "confirming" || status === "processing" ? "Usually a few minutes" : undefined} />
        <Stat
          label="Private balance"
          value={pp.balance ? `$${fmtUsdc(pp.balance.total)}` : "Hidden"}
          hint={pp.balance ? (pp.balance.pending > 0n ? `$${fmtUsdc(pp.balance.pending)} still arriving` : "Visible only to you") : "Encrypted on chain"}
        />
      </div>

      {!address ? (
        <div className="mt-5">
          <Notice>Connect your wallet to use private pay.</Notice>
        </div>
      ) : status === "off" ? (
        <div className="mt-5">
          <p className="text-sm text-muted">One signature makes your private keys (kept in your browser, never sent anywhere), then one transaction opens your private account.</p>
          <Button className="mt-3" disabled={busy} onClick={pp.turnOn}>
            Turn on private pay
          </Button>
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy || status === "confirming"} onClick={pp.reveal}>
              {pp.balance ? "Refresh my private balance" : "Show my private balance"}
            </Button>
          </div>

          {role === "employer" && (
            <>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field
                  label="Move USDC into your private balance"
                  inputMode="decimal"
                  placeholder="0.00"
                  suffix="USDC"
                  value={depositAmt}
                  onChange={(e) => setDepositAmt(e.target.value)}
                  hint={centsHint(deposit) ?? "From your wallet. The deposit itself is visible; what you pay out of it is not."}
                />
                <Button disabled={!on || busy || !isCents(deposit)} onClick={async () => (await pp.deposit(deposit)) && setDepositAmt("")}>
                  Move in
                </Button>
              </div>

              <div>
                <div className="text-[13px] font-medium text-ink-soft">Pay a team member privately</div>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
                  {team.length > 0 ? (
                    <Select
                      label="Who"
                      value={recipient}
                      onChange={setPayTo}
                      options={[{ value: "", label: "Choose someone" }, ...team.map((m) => ({ value: m.wallet, label: `${m.name || shortAddr(m.wallet)}` }))]}
                    />
                  ) : (
                    <Field label="Their wallet address" placeholder="0x…" value={payTo} onChange={(e) => setPayTo(e.target.value)} />
                  )}
                  <Field label="Amount" inputMode="decimal" placeholder="0.00" suffix="USDC" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} hint={centsHint(pay)} />
                </div>
                <div className="mt-2">{recipient && <ReceiverStatus address={recipient} />}</div>
                <Button className="mt-3" disabled={!on || busy || !isAddress(recipient) || !isCents(pay)} onClick={async () => (await pp.pay(recipient, pay)) && setPayAmt("")}>
                  Pay privately
                </Button>
              </div>
            </>
          )}

          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field
              label="Withdraw to your wallet"
              inputMode="decimal"
              placeholder="0.00"
              suffix="USDC"
              value={withdrawAmt}
              onChange={(e) => setWithdrawAmt(e.target.value)}
              hint={centsHint(withdraw) ?? "Back to normal USDC. Fairblock takes a small withdrawal fee."}
            />
            <Button variant="secondary" disabled={!on || busy || !isCents(withdraw)} onClick={async () => (await pp.withdraw(withdraw)) && setWithdrawAmt("")}>
              Withdraw
            </Button>
          </div>
          {role === "member" && (
            <p className="text-sm text-muted">
              Once it is in your wallet,{" "}
              <Link href="/invest" className={buttonClass("ghost", "sm")}>
                invest a share
              </Link>{" "}
              into your vault.
            </p>
          )}
        </div>
      )}

      {pp.busy && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Spinner /> {pp.busy}… check your wallet.
        </p>
      )}
      {pp.done && !pp.busy && <p className="mt-4 text-sm text-grow">{pp.done}</p>}
      {pp.error && !pp.busy && <p className="mt-4 text-sm text-danger">{pp.error}</p>}
      <p className="mt-5 text-xs leading-relaxed text-muted">
        Runs beside Stackday&apos;s payroll, not inside it: your private keys stay in your browser, so no contract can send private pay for you, and
        Stackday never holds this money. Amounts move in whole cents (minimum {fmtUsdc(CENT)} USDC).
      </p>
    </Card>
  );
}
