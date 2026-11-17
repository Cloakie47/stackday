"use client";

import { AssetSelect } from "@/components/asset-select";
import { CollateralBasket } from "@/components/collateral-basket";
import { LearnMore } from "@/components/learn-more";
import Link from "next/link";
import { useState } from "react";
import { useViewer } from "@/components/providers";
import { useAccountState } from "@/lib/useAccount";
import {
  Button,
  Card,
  Field,
  Notice,
  PageHeader,
  Responsive,
  RiskNote,
  Select,
  TxStatus,
  buttonClass,
} from "@/components/ui";
import { payrollAbi, vaultAbi } from "@/lib/abis";
import { ADDR, ASSETS, ZERO, assetByToken } from "@/lib/contracts";
import { fmtAsset, fmtHealth, fmtPct, fmtUsdc, parseAmount } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";
import { useTx } from "@/lib/useTx";

export default function BorrowPage() {
  const personal = useAccountState().mode === "personal";
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const tx = useTx();
  const me = viewer.address;
  const [symbol, setSymbol] = useState(ASSETS[0].symbol);
  const [ruleSymbol, setRuleSymbol] = useState(ASSETS[0].symbol);
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
  const ruleToken = (ASSETS.find((a) => a.symbol === ruleSymbol) ?? ASSETS[0]).token;
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

  return (
    <>
      <PageHeader
        title="Borrow"
        lead={
          <>
            Lock collateral, then borrow USDC against it. Repay any time. <LearnMore href="/docs#borrowing" />
          </>
        }
        aside={
          <Link href="/risk" className={buttonClass("secondary")}>
            <Responsive m="Stress test" d="Risk and stress test" />
          </Link>
        }
      />

      {!me && <Notice>Connect your wallet to borrow.</Notice>}

      {me && <CollateralBasket p={p} />}

      <Card title="Withdraw">
        <p className="text-sm text-muted">
          <Responsive m="Collateral unlocks if your loan allows." d="Withdraw to your wallet. Collateral unlocks automatically if your loan allows it." />
        </p>
        <div className="mt-4">
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
        </div>
        <p className="mt-3 text-xs tabular-nums text-muted">
          In your vault: {fmtAsset(pos.idle, asset.decimals)} {asset.symbol} free, {fmtAsset(pos.collateral, asset.decimals)} locked.
          {pos.debt > 0n && ` Loan against ${asset.name}: $${fmtUsdc(pos.debt)}, health ${fmtHealth(pos.health)}.`}
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-start">
          <Field
            label="Amount"
            inputMode="decimal"
            placeholder="0.0"
            suffix={asset.symbol}
            value={withdrawAmt}
            onChange={(e) => setWithdrawAmt(e.target.value)}
            hint={
              pos.debt > 0n
                ? "Your loan limits how much you can withdraw. Repay to withdraw all."
                : "No loan. Withdraw any amount."
            }
          />
          <Button variant="ghost" className="min-h-11 sm:mt-[25.5px]" disabled={totalHeld === 0n} onClick={() => setWithdrawAmt(fmtAsset(totalHeld, asset.decimals, asset.decimals).replace(/,/g, ""))}>
            Max
          </Button>
          <Button variant="secondary" className="min-h-11 sm:mt-[25.5px]" disabled={!viewer.canAct || !vault || withdraw === 0n || withdraw > totalHeld || tx.state.busy} onClick={doWithdraw}>
            Withdraw
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </Card>

      <RiskNote />

      {!personal && (
      <Card title="Emergency rule">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          <Responsive
            m="Tops up collateral from your salary when health is low."
            d="On payday, if this loan's health is at or below your threshold, a share of your salary goes to its collateral. Runs only when you claim."
          />{" "}
          <LearnMore href="/docs#emergency-rule" />
        </p>
        {rule && ruleAsset && (
          <div className="mt-4">
            <Notice tone={p.emergencyActive ? "warn" : "info"}>
              Current rule: if your {ruleAsset.name} loan health is at or below <strong>{fmtHealth(rule.threshold)}</strong>, put{" "}
              <strong>{fmtPct(rule.bps)}</strong> of the next salary into collateral.{" "}
              {p.emergencyActive ? "It is active right now." : "It is not triggered right now."}
            </Notice>
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Select
            label="Protect the loan on"
            value={ruleSymbol}
            onChange={setRuleSymbol}
            options={ASSETS.map((a) => ({ value: a.symbol, label: a.name }))}
          />
          <Select
            label="Trigger at health"
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
          <Button variant="secondary" disabled={!viewer.canAct || ruleBps <= 0 || ruleBps > 10000 || tx.state.busy} onClick={() => saveRule(false)}>
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
    </>
  );
}
