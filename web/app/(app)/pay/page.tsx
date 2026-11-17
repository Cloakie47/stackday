"use client";

import { PrivateCollect, PrivateRecords } from "@/components/private-collect";
import { LearnMore } from "@/components/learn-more";
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { useViewer } from "@/components/providers";
import {
  AssetIcon,
  Button,
  Card,
  Chip,
  Empty,
  Field,
  Money,
  Notice,
  PageHeader,
  Row,
  Segmented,
  SplitBar,
  TxStatus,
} from "@/components/ui";
import { payrollAbi } from "@/lib/abis";
import { ADDR, ASSETS, SIP_FEE_BPS, assetByToken } from "@/lib/contracts";
import { assetForUsdc, fmtAsset, fmtHealth, fmtPct, fmtUsdc, intervalLabel, until } from "@/lib/format";
import { useNames } from "@/lib/useAccount";
import { usePortfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";
import { BRAND } from "@/lib/brand";
import { SplitPicker } from "@/components/split-picker";
import { splitToBps, type Split } from "@/lib/split";


/** The fee only applies to the "every payday" plan; a one-time choice is free (Payroll.sol). */
const feeOn = (usdc: bigint, recurring: boolean) => (recurring ? (usdc * SIP_FEE_BPS) / 10_000n : 0n);

/** Least amount to accept for a SIP line: the reference price minus any fee, with 1% room. */
function minOut(usdc: bigint, price: bigint | undefined, decimals: number, recurring: boolean) {
  if (!price) return 0n;
  const net = usdc - feeOn(usdc, recurring);
  return (assetForUsdc(net, price, decimals) * 99n) / 100n;
}

export default function PayPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const tx = useTx();
  const me = viewer.address;
  const names = useNames(p.schedulesPayingMe.map((s) => s.employer));
  const [runIndex, setRunIndex] = useState(0);
  const [split, setSplit] = useState<Split>({ pct: 10, symbols: [ASSETS[0].symbol] });
  const [frequency, setFrequency] = useState<"once" | "always">("once");
  const [recipient, setRecipient] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  const claim = p.claims[Math.min(runIndex, Math.max(0, p.claims.length - 1))];
  const amount = claim?.amount ?? 0n;
  const plan = splitToBps(split);
  const total = plan.bps.reduce((a, b) => a + b, 0) / 100;
  const to = recipient.trim() || me || "";
  const due = p.schedulesPayingMe.filter((s) => s.active && now > 0 && s.nextPayAt <= now);

  const legs = useMemo(
    () =>
      plan.symbols
        .map((sym, i) => ({ pos: p.positions.find((x) => x.asset.symbol === sym)!, bps: plan.bps[i] }))
        .filter((l) => !!l.pos)
        .map((l) => {
          const usdc = (amount * BigInt(l.bps)) / 10_000n;
          const fee = feeOn(usdc, frequency === "always");
          return {
            ...l,
            usdc,
            fee,
            est: l.pos.price ? assetForUsdc(usdc - fee, l.pos.price, l.pos.asset.decimals) : 0n,
          };
        }),
    [p.positions, plan, amount, frequency],
  );
  const sipUsdc = legs.reduce((a, l) => a + l.usdc, 0n);
  const feeUsdc = legs.reduce((a, l) => a + l.fee, 0n);


  async function submit() {
    if (!claim) return;
    const tokens = legs.map((l) => l.pos.asset.token);
    const bps = legs.map((l) => l.bps);
    let mins = legs.map((l) => minOut(l.usdc, l.pos.price, l.pos.asset.decimals, frequency === "always"));
    if (p.emergencyActive && p.emergencyRule) {
      // The contract sends the whole SIP share to the loan's asset, so only that minimum applies.
      const rule = p.emergencyRule;
      const pos = p.positions.find((x) => x.asset.token.toLowerCase() === rule.asset.toLowerCase());
      const share = BigInt(Math.round(total * 100)) > rule.bps ? BigInt(Math.round(total * 100)) : rule.bps;
      mins = [pos ? minOut((amount * share) / 10_000n, pos.price, pos.asset.decimals, frequency === "always") : 0n];
    }
    const calls: Call[] = [];
    if (frequency === "always") {
      const same =
        p.sipPlan.length === tokens.length &&
        p.sipPlan.every((leg, i) => leg.asset.toLowerCase() === tokens[i].toLowerCase() && Number(leg.bps) === bps[i]);
      if (!same)
        calls.push({
          label: "Save your payday plan",
          address: ADDR.payroll,
          abi: payrollAbi,
          functionName: "setSipPlanMany",
          args: [tokens, bps],
        });
      calls.push({ label: "Claim salary", address: ADDR.payroll, abi: payrollAbi, functionName: "claimMany", args: [claim.runId, to, mins] });
    } else {
      calls.push({
        label: "Claim salary",
        address: ADDR.payroll,
        abi: payrollAbi,
        functionName: "claimWithSipMany",
        args: [claim.runId, to, tokens, bps, mins],
      });
    }
    await tx.run(calls, "Salary claimed.");
  }

  const release = (id: bigint) =>
    tx.run(
      [{ label: "Release the payday", address: ADDR.payroll, abi: payrollAbi, functionName: "runSchedule", args: [id] }],
      "Payday released. You can claim it now.",
    );

  const turnOffPlan = () =>
    tx.run(
      [{ label: "Turn off the payday plan", address: ADDR.payroll, abi: payrollAbi, functionName: "setSipPlanMany", args: [[], []] }],
      "Every-payday plan turned off.",
    );

  const ruleAsset = assetByToken(p.emergencyRule?.asset);

  return (
    <>
      <PageHeader
        title="My pay"
        lead={
          <>
            Claim your salary and choose a share to invest. <LearnMore href="/docs#employees" />
          </>
        }
      />

      {!me && <Notice>Connect your wallet (top right) to see your salary.</Notice>}

      {due.map((s) => (
        <div key={s.id.toString()} className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-grow-soft p-5">
          <div>
            <div className="text-sm font-semibold text-grow">
              Your {intervalLabel(s.interval).toLowerCase()} pay from {names.display(s.employer)} is ready
            </div>
            <div className="text-xs text-grow/80">{fmtUsdc(s.mine)} USDC. Press Release to move it into Claim.</div>
          </div>
          <Button variant="ink" disabled={!viewer.canAct || tx.state.busy} onClick={() => release(s.id)}>
            Release pay
          </Button>
        </div>
      ))}

      <Card title="Claim your salary">
        {p.claims.length === 0 ? (
          <Empty>
            {me
              ? "Nothing to claim right now. When your employer runs payroll, it shows up here."
              : "Connect your wallet to see your salary."}
          </Empty>
        ) : (
          <div className="space-y-7">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[13px] font-medium text-muted">Ready to claim</div>
                <div className="mt-1.5 font-display text-6xl font-semibold leading-none tracking-[-0.03em]">
                  <Money value={amount} />
                </div>
                <div className="mt-1 text-xs text-muted">Payroll run #{claim.runId.toString()}</div>
              </div>
              {p.claims.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {p.claims.slice(0, 6).map((c, i) => (
                    <Chip key={c.runId.toString()} active={i === runIndex} onClick={() => setRunIndex(i)}>
                      #{c.runId.toString()} · {fmtUsdc(c.amount)}
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            <SplitPicker value={split} onChange={setSplit} assets={ASSETS} label="How much of this salary should go to work?" />

            <div className="grid gap-5 sm:grid-cols-2">
              <Segmented
                label="How often"
                value={frequency}
                onChange={setFrequency}
                options={[
                  { value: "once", label: "Just this payday" },
                  { value: "always", label: "Every payday" },
                ]}
              />
              <Field
                label="Send the cash part to"
                placeholder={me ?? "0x…"}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                hint={
                  recipient && !isAddress(recipient.trim())
                    ? "This is not a valid address"
                    : "Leave empty to use your connected wallet. Any wallet works."
                }
              />
            </div>

            <div className="rounded-2xl bg-sunken/70 p-4">
              <SplitBar
                parts={[
                  { key: "cash", value: Number(amount - sipUsdc), color: "var(--color-line-strong)", label: "Cash" },
                  ...legs.map((l) => ({ key: l.pos.asset.symbol, value: Number(l.usdc), color: l.pos.asset.color, label: l.pos.asset.name })),
                ]}
                height={12}
              />
              <div className="mt-3">
                <Row label="Cash you receive">{fmtUsdc(amount - sipUsdc)} USDC</Row>
                {legs.map((l) => (
                  <Row key={l.pos.asset.symbol} label={`${fmtPct(BigInt(l.bps))} into ${l.pos.asset.name}`}>
                    about {fmtAsset(l.est, l.pos.asset.decimals)} {l.pos.asset.symbol}
                  </Row>
                ))}
                {sipUsdc > 0n &&
                  (frequency === "always" ? (
                    <Row label={`${BRAND.name} fee (${fmtPct(SIP_FEE_BPS)} of the invested part, every payday plan)`}>{fmtUsdc(feeUsdc, 4)} USDC</Row>
                  ) : (
                    <Row label={`${BRAND.name} fee`}>None for a one-time choice</Row>
                  ))}
              </div>
            </div>

            {p.emergencyActive && p.emergencyRule && ruleAsset && (
              <Notice tone="warn">
                <strong>Emergency rule active.</strong> At least {fmtPct(p.emergencyRule.bps)} of this salary buys{" "}
                {ruleAsset.name} for that loan&apos;s collateral (health at or below {fmtHealth(p.emergencyRule.threshold)}). Other
                choices are skipped. <LearnMore href="/docs#emergency-rule" className="text-warn decoration-warn/40" />
              </Notice>
            )}
            {legs
              .filter((l) => l.pos.transfersPaused)
              .map((l) => (
                <Notice key={l.pos.asset.symbol} tone="warn">
                  {l.pos.asset.symbol} transfers are paused. That part is paid to you in USDC.
                </Notice>
              ))}

            <Button size="lg" className="w-full sm:w-auto" disabled={!viewer.canAct || tx.state.busy || !isAddress(to)} onClick={submit}>
              Claim {fmtUsdc(amount)} USDC
            </Button>
          </div>
        )}
        <TxStatus state={tx.state} />
      </Card>

      <Card title="Your payday plan">
        {p.sipPlan.length === 0 ? (
          <Empty>No payday plan yet. Choose &quot;Every payday&quot; when you claim to set one.</Empty>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {p.sipPlan.map((leg) => {
                const a = assetByToken(leg.asset);
                return a ? (
                  <span key={a.symbol} className="inline-flex items-center gap-2 rounded-full bg-sunken py-1 pl-1 pr-3 text-[13px] font-semibold">
                    <AssetIcon asset={a} size={22} /> {fmtPct(leg.bps)} into {a.name}
                  </span>
                ) : null;
              })}
            </div>
            <Button variant="secondary" size="sm" disabled={!viewer.canAct || tx.state.busy} onClick={turnOffPlan}>
              Turn off
            </Button>
          </div>
        )}
      </Card>

      {p.schedulesPayingMe.length > 0 && (
        <Card title="Your recurring salary">
          <div className="divide-y divide-line">
            {p.schedulesPayingMe.map((s) => (
              <div key={s.id.toString()} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                <div>
                  <div className="text-sm font-semibold">
                    {names.display(s.employer)} · {intervalLabel(s.interval)}
                  </div>
                  <div className="text-xs text-muted">{s.active ? `Next payday ${until(s.nextPayAt, now)}` : "Paused by the employer"}</div>
                </div>
                <div className="text-sm font-semibold tabular-nums">{fmtUsdc(s.mine)} USDC</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <PrivateCollect p={p} address={me} canAct={viewer.canAct} />
      <PrivateRecords address={me} role="member" />
    </>
  );
}
