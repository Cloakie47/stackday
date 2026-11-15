"use client";

import { LearnMore } from "@/components/learn-more";
import Link from "next/link";
import { useState } from "react";
import { useViewer } from "@/components/providers";
import { useAccountState } from "@/lib/useAccount";
import {
  AssetIcon,
  Button,
  Card,
  Chip,
  Field,
  HealthMeter,
  Notice,
  PageHeader,
  RiskNote,
  Select,
  Stat,
  TxStatus,
  buttonClass,
} from "@/components/ui";
import { payrollAbi, vaultAbi } from "@/lib/abis";
import { ADDR, ASSETS, MAX_UINT, ZERO, assetByToken } from "@/lib/contracts";
import { WAD, aprFromPerSecond, assetValue, fmtAsset, fmtHealth, fmtPct, fmtUsdc, parseAmount, parseUsdc } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";

export default function BorrowPage() {
  const personal = useAccountState().mode === "personal";
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const tx = useTx();
  const me = viewer.address;
  const [symbol, setSymbol] = useState(ASSETS[0].symbol);
  const [borrowAmt, setBorrowAmt] = useState("");
  const [repayAmt, setRepayAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [share, setShare] = useState("50");
  const [threshold, setThreshold] = useState("1.5");

  const pos = p.positions.find((x) => x.asset.symbol === symbol) ?? p.positions[0];
  const asset = pos.asset;
  const vault = p.vault;
  const totalHeld = pos.idle + pos.collateral;
  const usable = pos.transfersPaused ? pos.collateral : totalHeld;
  const maxAtLiquidation = pos.price ? (assetValue(usable, pos.price, asset.decimals) * asset.lltv) / WAD : 0n;
  const borrowLimit = (maxAtLiquidation * p.borrowCapBps) / 10_000n;
  const room = borrowLimit > pos.debt ? borrowLimit - pos.debt : 0n;
  const available = pos.liquidity !== undefined && pos.liquidity < room ? pos.liquidity : room;
  const borrow = parseUsdc(borrowAmt);
  const repay = parseUsdc(repayAmt);
  const withdraw = parseAmount(withdrawAmt, asset.decimals);
  const health = pos.health !== undefined && pos.debt > 0n ? Number(pos.health / 10n ** 14n) / 10_000 : undefined;
  const apr = aprFromPerSecond(pos.ratePerSecond);
  const rule = p.emergencyRule;
  const ruleAsset = assetByToken(rule?.asset);
  const ruleBps = Math.round(Number(share || "0") * 100);

  async function doBorrow() {
    if (!vault || !me) return;
    const ok = await tx.run(
      [
        {
          label: `Borrow USDC against your ${asset.name}`,
          address: vault,
          abi: vaultAbi,
          functionName: "borrow",
          args: [asset.token, pos.transfersPaused ? 0n : pos.idle, borrow, me],
        },
      ],
      "Borrowed. The USDC is in your wallet.",
    );
    if (ok) setBorrowAmt("");
  }

  async function doRepay(all: boolean) {
    if (!vault) return;
    const amount = all ? pos.debt + pos.debt / 100n + 1000n : repay;
    const calls: Call[] = [
      ...(await tx.withApproval(ADDR.usdc, vault, amount, "Allow your vault to take the USDC")),
      {
        label: all ? "Repay the whole loan" : "Repay part of the loan",
        address: vault,
        abi: vaultAbi,
        functionName: "repay",
        args: [asset.token, all ? MAX_UINT : repay],
      },
    ];
    if (await tx.run(calls, all ? "Loan fully repaid." : "Repayment made.")) setRepayAmt("");
  }

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
          args: off ? [ZERO, 0, 0n] : [asset.token, ruleBps, BigInt(Math.round(Number(threshold) * 100)) * 10n ** 16n],
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
            Borrow USDC against what you hold. Repay any time. <LearnMore href="/docs#borrowing" />
          </>
        }
        aside={
          <Link href="/risk" className={buttonClass("ink")}>
            Risk screen and stress test
          </Link>
        }
      />

      {!me && <Notice>Connect your wallet (top right) to borrow.</Notice>}

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Asset to borrow against">
        {p.positions.map((x) => (
          <Chip key={x.asset.symbol} active={x.asset.symbol === symbol} onClick={() => setSymbol(x.asset.symbol)}>
            <AssetIcon asset={x.asset} size={20} /> {x.asset.name}
            {x.debt > 0n && <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-label="has a loan" />}
          </Chip>
        ))}
      </div>

      <Card title={`Your ${asset.name} loan`}>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Loan" value={`$${fmtUsdc(pos.debt)}`} />
          <Stat label="Health" value={fmtHealth(pos.health)} hint="Below 1.00 can be liquidated" />
          <Stat label="You can borrow" value={`$${fmtUsdc(available)}`} hint={`${fmtPct(p.borrowCapBps)} of the maximum`} />
          <Stat label="Interest now" value={apr !== undefined ? `${apr.toFixed(2)}%` : "…"} hint="Per year, changes with demand" />
        </div>
        <div className="mt-5">
          <HealthMeter health={health} />
        </div>
        <p className="mt-4 text-xs text-muted">
          In your vault: {fmtAsset(pos.idle, asset.decimals)} {asset.symbol} free, {fmtAsset(pos.collateral, asset.decimals)} posted.
          Liquidation limit {fmtPct((asset.lltv * 10_000n) / WAD)}.
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <Field
              label="Borrow"
              inputMode="decimal"
              placeholder="0.00"
              suffix="USDC"
              value={borrowAmt}
              onChange={(e) => setBorrowAmt(e.target.value)}
              hint={
                pos.transfersPaused
                  ? "Transfers are paused, so only collateral already posted counts."
                  : pos.idle > 0n
                    ? `Your ${fmtAsset(pos.idle, asset.decimals)} free ${asset.symbol} will be posted as collateral.`
                    : "Uses the collateral already posted."
              }
            />
            <Button className="mt-3 w-full" disabled={!viewer.canAct || !vault || borrow === 0n || borrow > available || tx.state.busy} onClick={doBorrow}>
              Borrow
            </Button>
            {borrow > available && <p className="mt-2 text-xs text-danger">That is above what you can borrow now.</p>}
          </div>
          <div>
            <Field
              label="Repay"
              inputMode="decimal"
              placeholder="0.00"
              suffix="USDC"
              value={repayAmt}
              onChange={(e) => setRepayAmt(e.target.value)}
              hint="Any amount, any time. No penalty."
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={!viewer.canAct || !vault || repay === 0n || pos.debt === 0n || tx.state.busy} onClick={() => doRepay(false)}>
                Repay
              </Button>
              <Button variant="secondary" disabled={!viewer.canAct || !vault || pos.debt === 0n || tx.state.busy} onClick={() => doRepay(true)}>
                Repay all
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-2 border-t border-line pt-6 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field
            label={`Withdraw ${asset.name} to your wallet`}
            inputMode="decimal"
            placeholder="0.0"
            suffix={asset.symbol}
            value={withdrawAmt}
            onChange={(e) => setWithdrawAmt(e.target.value)}
            hint={
              pos.debt > 0n
                ? "With a loan open, you can withdraw only what the limit allows."
                : "You can withdraw everything at any time."
            }
          />
          <Button variant="ghost" disabled={totalHeld === 0n} onClick={() => setWithdrawAmt(fmtAsset(totalHeld, asset.decimals, asset.decimals).replace(/,/g, ""))}>
            Max
          </Button>
          <Button variant="secondary" disabled={!viewer.canAct || !vault || withdraw === 0n || withdraw > totalHeld || tx.state.busy} onClick={doWithdraw}>
            Withdraw
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </Card>

      <RiskNote />

      {!personal && (
      <Card title="Emergency rule">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          If this loan&apos;s health is at or below your threshold on payday, this share of the salary goes to its
          collateral. Acts only when a salary is claimed. <LearnMore href="/docs#emergency-rule" />
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
            value={symbol}
            onChange={setSymbol}
            options={ASSETS.map((a) => ({ value: a.symbol, label: a.name }))}
          />
          <Select
            label="When health is at or below"
            value={threshold}
            onChange={setThreshold}
            options={[
              { value: "1.25", label: "1.25 (late)" },
              { value: "1.5", label: "1.50 (balanced)" },
              { value: "2", label: "2.00 (early)" },
            ]}
          />
          <Field label="Share of salary to redirect" inputMode="numeric" suffix="%" value={share} onChange={(e) => setShare(e.target.value)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ink" disabled={!viewer.canAct || ruleBps <= 0 || ruleBps > 10000 || tx.state.busy} onClick={() => saveRule(false)}>
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
