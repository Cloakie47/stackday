"use client";

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
  MockBadge,
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

type Alloc = Record<string, number>; // asset symbol -> percent of salary

const PRESETS = [
  { pct: 0, label: "Keep it all" },
  { pct: 10, label: "10%", hint: "A good start" },
  { pct: 20, label: "20%", hint: "Builds faster" },
];

/** Least amount to accept for a SIP line: the reference price minus the fee, with 1% room. */
function minOut(usdc: bigint, price: bigint | undefined, decimals: number) {
  if (!price) return 0n;
  const net = usdc - (usdc * SIP_FEE_BPS) / 10_000n;
  return (assetForUsdc(net, price, decimals) * 99n) / 100n;
}

export default function PayPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const tx = useTx();
  const me = viewer.address;
  const names = useNames(p.schedulesPayingMe.map((s) => s.employer));
  const [runIndex, setRunIndex] = useState(0);
  const [alloc, setAlloc] = useState<Alloc>({ [ASSETS[0].symbol]: 10 });
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
  const total = Object.values(alloc).reduce((a, b) => a + b, 0);
  const to = recipient.trim() || me || "";
  const due = p.schedulesPayingMe.filter((s) => s.active && now > 0 && s.nextPayAt <= now);

  const legs = useMemo(
    () =>
      p.positions
        .map((pos) => ({ pos, pct: alloc[pos.asset.symbol] ?? 0 }))
        .filter((l) => l.pct > 0)
        .map((l) => {
          const usdc = (amount * BigInt(l.pct)) / 100n;
          const fee = (usdc * SIP_FEE_BPS) / 10_000n;
          return {
            ...l,
            usdc,
            fee,
            est: l.pos.price ? assetForUsdc(usdc - fee, l.pos.price, l.pos.asset.decimals) : 0n,
          };
        }),
    [p.positions, alloc, amount],
  );
  const sipUsdc = legs.reduce((a, l) => a + l.usdc, 0n);
  const feeUsdc = legs.reduce((a, l) => a + l.fee, 0n);

  function setPreset(pct: number) {
    if (pct === 0) return setAlloc({});
    const chosen = Object.keys(alloc).filter((s) => alloc[s] > 0);
    const symbols = chosen.length ? chosen : [ASSETS[0].symbol];
    const each = Math.floor(pct / symbols.length);
    const next: Alloc = {};
    symbols.forEach((s, i) => (next[s] = each + (i === 0 ? pct - each * symbols.length : 0)));
    setAlloc(next);
  }

  function setPct(symbol: string, pct: number) {
    const others = total - (alloc[symbol] ?? 0);
    const clamped = Math.max(0, Math.min(100 - others, Math.round(pct)));
    setAlloc((a) => ({ ...a, [symbol]: clamped }));
  }

  async function submit() {
    if (!claim) return;
    const tokens = legs.map((l) => l.pos.asset.token);
    const bps = legs.map((l) => l.pct * 100);
    let mins = legs.map((l) => minOut(l.usdc, l.pos.price, l.pos.asset.decimals));
    if (p.emergencyActive && p.emergencyRule) {
      // The contract sends the whole SIP share to the loan's asset, so only that minimum applies.
      const rule = p.emergencyRule;
      const pos = p.positions.find((x) => x.asset.token.toLowerCase() === rule.asset.toLowerCase());
      const share = BigInt(total * 100) > rule.bps ? BigInt(total * 100) : rule.bps;
      mins = [pos ? minOut((amount * share) / 10_000n, pos.price, pos.asset.decimals) : 0n];
    }
    const calls: Call[] = [];
    if (frequency === "always") {
      const same =
        p.sipPlan.length === tokens.length &&
        p.sipPlan.every((leg, i) => leg.asset.toLowerCase() === tokens[i].toLowerCase() && Number(leg.bps) === bps[i]);
      if (!same)
        calls.push({
          label: "Save your every-payday plan",
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
      [{ label: "Turn off the every-payday plan", address: ADDR.payroll, abi: payrollAbi, functionName: "setSipPlanMany", args: [[], []] }],
      "Every-payday plan turned off.",
    );

  const ruleAsset = assetByToken(p.emergencyRule?.asset);

  return (
    <>
      <PageHeader
        title="Get paid"
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
              Your {intervalLabel(s.interval).toLowerCase()} payday from {names.display(s.employer)} is due
            </div>
            <div className="text-xs text-grow/80">{fmtUsdc(s.mine)} USDC. Anyone can release it from the employer&apos;s treasury.</div>
          </div>
          <Button variant="ink" disabled={!viewer.canAct || tx.state.busy} onClick={() => release(s.id)}>
            Release payday
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

            <div>
              <h3 className="text-sm font-semibold">How much of this salary should go to work?</h3>
              <p className="mt-1 text-sm text-muted">
                Optional. You can change it every payday.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <Chip key={preset.pct} active={total === preset.pct} onClick={() => setPreset(preset.pct)}>
                    {preset.label}
                    {preset.hint && <span className="font-normal opacity-70">{preset.hint}</span>}
                  </Chip>
                ))}
                {!PRESETS.some((x) => x.pct === total) && <Chip active>{total}% custom</Chip>}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">What should it buy?</h3>
                <MockBadge>Mock tokens on testnet</MockBadge>
              </div>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {p.positions.map((pos) => {
                  const pct = alloc[pos.asset.symbol] ?? 0;
                  return (
                    <div
                      key={pos.asset.symbol}
                      className={`rounded-2xl border p-3.5 transition-[border-color,background-color] duration-200 ${
                        pct > 0 ? "border-ink bg-surface" : "border-line bg-surface/60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <AssetIcon asset={pos.asset} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{pos.asset.name}</div>
                          <div className="text-xs text-muted">
                            {pos.asset.kind === "stock" ? "Tokenized stock" : "Crypto"} · stands in for {pos.asset.realTicker}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Less ${pos.asset.name}`}
                            onClick={() => setPct(pos.asset.symbol, pct - 5)}
                            disabled={pct === 0}
                            className="grid h-8 w-8 place-items-center rounded-full border border-line-strong text-lg leading-none transition-colors hover:border-ink disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-11 text-center text-sm font-semibold tabular-nums">{pct}%</span>
                          <button
                            type="button"
                            aria-label={`More ${pos.asset.name}`}
                            onClick={() => setPct(pos.asset.symbol, pct + 5)}
                            disabled={total >= 100}
                            className="grid h-8 w-8 place-items-center rounded-full border border-line-strong text-lg leading-none transition-colors hover:border-ink disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

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
                  <Row key={l.pos.asset.symbol} label={`${l.pct}% into ${l.pos.asset.name}`}>
                    about {fmtAsset(l.est, l.pos.asset.decimals)} {l.pos.asset.symbol}
                  </Row>
                ))}
                {sipUsdc > 0n && <Row label={`${BRAND.name} fee (${fmtPct(SIP_FEE_BPS)} of the invested part)`}>{fmtUsdc(feeUsdc, 4)} USDC</Row>}
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

      <Card title="Your every-payday plan">
        {p.sipPlan.length === 0 ? (
          <Empty>No standing plan. Choose &quot;Every payday&quot; when you claim to set one.</Empty>
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
    </>
  );
}
