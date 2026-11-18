"use client";

import { AssetSelect } from "@/components/asset-select";
import { CollateralBasket, type Tab } from "@/components/collateral-basket";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { useViewer } from "@/components/providers";
import { useAccountState } from "@/lib/useAccount";
import { Badge, Button, Card, Field, Notice, Row, Select, TxStatus } from "@/components/ui";
import { payrollAbi, vaultAbi } from "@/lib/abis";
import { ADDR, ASSETS, BORROWABLE, ZERO, assetByToken } from "@/lib/contracts";
import { fmtAsset, fmtHealth, fmtPct, fmtUsdc, parseAmount } from "@/lib/format";
import { usePortfolio, type Portfolio } from "@/lib/usePortfolio";
import { useTx } from "@/lib/useTx";

/** Reads ?tab=repay or ?tab=collateral so links can open the panel on that action. */
function BasketFromUrl({ p, head }: { p: Portfolio; head: ReactNode }) {
  const q = useSearchParams().get("tab");
  const tab: Tab = q === "repay" ? "repay" : q === "collateral" || q === "lock" ? "lock" : "borrow";
  return <CollateralBasket key={tab} p={p} head={head} initialTab={tab} />;
}

export default function BorrowPage() {
  const personal = useAccountState().mode === "personal";
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const tx = useTx();
  const me = viewer.address;
  const [symbol, setSymbol] = useState(ASSETS[0].symbol);
  const [ruleSymbol, setRuleSymbol] = useState(BORROWABLE[0].symbol);
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [share, setShare] = useState("50");
  const [threshold, setThreshold] = useState("1.5");

  const pos = p.positions.find((x) => x.asset.symbol === symbol) ?? p.positions[0];
  const asset = pos.asset;
  const vault = p.vault;
  const totalHeld = pos.idle + pos.collateral;
  const withdraw = parseAmount(withdrawAmt, asset.decimals);
  const rule = p.emergencyRule;
  const ruleAsset = assetByToken(rule?.asset);
  const ruleToken = (BORROWABLE.find((a) => a.symbol === ruleSymbol) ?? BORROWABLE[0]).token;
  const ruleBps = Math.round(Number(share || "0") * 100);

  async function doWithdraw() {
    if (!vault || !me) return;
    const ok = await tx.run(
      [{ label: `Withdraw ${asset.name} to your wallet`, address: vault, abi: vaultAbi, functionName: "withdraw", args: [asset.token, withdraw, me] }],
      `${asset.name} sent to your wallet.`,
    );
    if (ok) setWithdrawAmt("");
  }

  const saveRule = (off: boolean) =>
    tx.run(
      [
        {
          label: off ? "Turn off the emergency rule" : "Save the emergency rule",
          address: ADDR.payroll,
          abi: payrollAbi,
          functionName: "setEmergencyRule",
          args: off ? [ZERO, 0, 0n] : [ruleToken, ruleBps, BigInt(Math.round(Number(threshold) * 100)) * 10n ** 16n],
        },
      ],
      off ? "Emergency rule turned off." : "Emergency rule saved.",
    );

  const head = (
    <div>
      <div className="mb-3 flex items-center gap-2 pt-1 text-xs text-muted sm:pt-3">
        Borrow <span aria-hidden>/</span> <b className="font-medium text-ink">USDC against your vault</b>
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <h1 className="flex items-center gap-3.5 font-display text-[34px] font-light leading-none tracking-[-0.025em] sm:text-[44px]">
          USDC
          <span className="h-[30px] w-px bg-line sm:h-[34px]" aria-hidden />
          <span className="text-cents">Your vault</span>
        </h1>
        <Badge>Variable rate</Badge>
      </div>
    </div>
  );

  return (
    <>
      {!me && (
        <>
          {head}
          <Notice>Connect a wallet to borrow.</Notice>
        </>
      )}

      {me && (
        <Suspense fallback={<CollateralBasket p={p} head={head} />}>
          <BasketFromUrl p={p} head={head} />
        </Suspense>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Take assets out" tip="Sends assets to your wallet. Locked assets are released only as far as your loan allows.">
          <AssetSelect
            label="Asset"
            assets={p.positions.map((x) => x.asset)}
            value={symbol}
            onChange={setSymbol}
            detail={(a) => {
              const debt = p.positions.find((x) => x.asset.symbol === a.symbol)?.debt ?? 0n;
              return debt > 0n ? <span className="text-warn">Loan ${fmtUsdc(debt)}</span> : null;
            }}
          />
          <div className="mt-3">
            <Row label="In your vault">
              {fmtAsset(pos.idle, asset.decimals)} free, {fmtAsset(pos.collateral, asset.decimals)} locked
            </Row>
            {pos.debt > 0n && (
              <Row label={`Loan against ${asset.name}`}>
                ${fmtUsdc(pos.debt)} · health {fmtHealth(pos.health)}
              </Row>
            )}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field
              label={`Withdraw ${asset.name}`}
              inputMode="decimal"
              placeholder="0.0"
              suffix={asset.symbol}
              value={withdrawAmt}
              onChange={(e) => setWithdrawAmt(e.target.value)}
            />
            <Button variant="ghost" disabled={totalHeld === 0n} onClick={() => setWithdrawAmt(fmtAsset(totalHeld, asset.decimals, asset.decimals).replace(/,/g, ""))}>
              Max
            </Button>
            <Button variant="secondary" disabled={!viewer.canAct || !vault || withdraw === 0n || withdraw > totalHeld || tx.state.busy} onClick={doWithdraw}>
              Withdraw
            </Button>
          </div>
          {pos.debt > 0n && (
            <p className="mt-2 text-xs text-muted">With a loan open, you can withdraw only what the loan allows. Repay first to take everything.</p>
          )}
          <TxStatus state={tx.state} />
        </Card>

        {!personal && (
          <Card
            title="Emergency rule"
            tip="On payday, if this loan's health is at or below your threshold, this share of the salary buys its collateral. It acts only when a salary is claimed."
            badge={rule && ruleAsset ? <Badge tone={p.emergencyActive ? "warn" : "neutral"}>{p.emergencyActive ? "Active" : "Not triggered"}</Badge> : undefined}
          >
            {rule && ruleAsset && (
              <p className="mb-3 text-[13px] text-ink-soft">
                Rule: {ruleAsset.name} health ≤ {fmtHealth(rule.threshold)} → {fmtPct(rule.bps)} of salary
              </p>
            )}
            <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_96px]">
              <Select
                label="Protect the loan on"
                value={ruleSymbol}
                onChange={setRuleSymbol}
                options={BORROWABLE.map((a) => ({ value: a.symbol, label: a.name }))}
              />
              <Select
                label="Health at or below"
                value={threshold}
                onChange={setThreshold}
                options={[
                  { value: "1.25", label: "1.25 (late)" },
                  { value: "1.5", label: "1.50 (balanced)" },
                  { value: "2", label: "2.00 (early)" },
                ]}
              />
              <Field label="Salary share" inputMode="numeric" suffix="%" value={share} onChange={(e) => setShare(e.target.value)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={!viewer.canAct || ruleBps <= 0 || ruleBps > 10000 || tx.state.busy} onClick={() => saveRule(false)}>
                Save rule
              </Button>
              {rule && (
                <Button variant="secondary" disabled={!viewer.canAct || tx.state.busy} onClick={() => saveRule(true)}>
                  Turn off
                </Button>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
