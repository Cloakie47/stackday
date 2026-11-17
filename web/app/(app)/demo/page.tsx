"use client";

import { AssetSelect } from "@/components/asset-select";
import { LearnMore } from "@/components/learn-more";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useReadContracts } from "wagmi";
import { useViewer } from "@/components/providers";
import { AddressLink, Button, Card, Field, MockBadge, Notice, PageHeader, Row, TxStatus } from "@/components/ui";
import { mockFeedAbi, mockStockAbi, mockSwapAbi, payrollAbi } from "@/lib/abis";
import { ADDR, ASSETS } from "@/lib/contracts";
import { fmtPrice, fmtUsdc, parseUsdc } from "@/lib/format";
import { usePortfolio } from "@/lib/usePortfolio";
import { useTx, type Call } from "@/lib/useTx";

const STORY = [
  "Payroll: add yourself to the team, fund the treasury and start a schedule (or pay once).",
  "My pay: claim with 10% or 20% invested. The assets land in your vault (deposit).",
  "Borrow: lock some of them, then borrow USDC against them.",
  "Here: drop that asset's price 30%. Open Risk and watch loan health fall.",
  "Here: pause transfers. On Borrow, repaying still works but withdrawing does not.",
  "Here: resume transfers and recover the price.",
  "Borrow: repay everything, then withdraw.",
];

export default function DemoPage() {
  const viewer = useViewer();
  const p = usePortfolio(viewer.address);
  const tx = useTx();
  const [symbol, setSymbol] = useState(ASSETS[0].symbol);
  const [custom, setCustom] = useState("");
  const [payday, setPayday] = useState("5");
  const [interest, setInterest] = useState("0.05");

  const pos = p.positions.find((x) => x.asset.symbol === symbol) ?? p.positions[0];
  const asset = pos.asset;
  const extra = useReadContracts({
    contracts: [
      { address: asset.feed, abi: mockFeedAbi, functionName: "owner" },
      { address: ADDR.usdc, abi: erc20Abi, functionName: "balanceOf", args: [ADDR.mockSwap] },
    ],
    query: { refetchInterval: 10_000 },
  });
  const operator = extra.data?.[0]?.result as string | undefined;
  const exchangeUsdc = (extra.data?.[1]?.result as bigint | undefined) ?? 0n;
  const isOperator = viewer.canAct && !!viewer.address && !!operator && viewer.address.toLowerCase() === operator.toLowerCase();
  const disabled = !isOperator || tx.state.busy;
  const price = pos.price ?? 0n;

  function setPrice(newPrice: bigint, label: string) {
    if (newPrice <= 0n) return;
    // A closed (frozen) market can only move by reopening at a new price.
    const call: Call = pos.feedFrozen
      ? { label, address: asset.feed, abi: mockFeedAbi, functionName: "reopenAt", args: [newPrice] }
      : { label, address: asset.feed, abi: mockFeedAbi, functionName: "setPrice", args: [newPrice] };
    return tx.run([call], `${asset.name} price is now $${fmtPrice(newPrice)}.`);
  }

  async function runPayday() {
    if (!viewer.address) return;
    const amount = parseUsdc(payday);
    const calls: Call[] = [
      ...(await tx.withApproval(ADDR.usdc, ADDR.payroll, amount, "Approve USDC")),
      {
        label: "Create a payday for this wallet",
        address: ADDR.payroll,
        abi: payrollAbi,
        functionName: "depositAndCreateRun",
        args: [amount, [viewer.address], [amount]],
      },
    ];
    await tx.run(calls, "New payday created. Claim it on My pay.");
  }

  return (
    <>
      <PageHeader
        title="Testnet tools"
        lead={
          <>
            Switches for stress scenarios. They only change mocks. <LearnMore href="/docs#demo" />
          </>
        }
        aside={<MockBadge>Testnet only</MockBadge>}
      />

      {isOperator ? (
        <Notice tone="grow">Connected as the demo operator. Switches are on.</Notice>
      ) : (
        <Notice tone="warn">
          Only the operator wallet {operator && <AddressLink address={operator} />} can use these switches.
          {viewer.canAct ? " You're on a different wallet." : " Connect that wallet to use them."}
        </Notice>
      )}

      <Card title="Demo script">
        <ol className="space-y-2 text-sm leading-relaxed text-ink-soft">
          {STORY.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="w-4 shrink-0 pt-px text-right text-xs font-medium tabular-nums text-muted">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Market switches" badge={<MockBadge />}>
        <AssetSelect label="Asset" assets={p.positions.map((x) => x.asset)} value={symbol} onChange={setSymbol} />
        <div className="mt-4">
          <Row label="Price now">${fmtPrice(pos.price)}</Row>
          <Row label="Starting price">${fmtPrice(asset.startPrice)}</Row>
          <Row label="Market">{pos.feedFrozen ? "Closed (price frozen)" : "Open"}</Row>
          <Row label="Token transfers">{pos.transfersPaused ? "Paused" : "Working"}</Row>
        </div>

        <h3 className="mt-6 text-sm font-semibold">Price drop (overnight gap)</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {[10n, 20n, 30n].map((pct) => (
            <Button key={pct.toString()} variant="danger" size="sm" disabled={disabled} onClick={() => setPrice((price * (100n - pct)) / 100n, `Drop ${asset.name} by ${pct}%`)}>
              Drop {pct.toString()}%
            </Button>
          ))}
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setPrice(asset.startPrice, `Recover the ${asset.name} price`)}>
            Recover to starting price
          </Button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
          <Field label="Or set an exact price" inputMode="decimal" placeholder="0.00" suffix="USD" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button variant="secondary" className="min-h-11 sm:mt-6" disabled={disabled || parseUsdc(custom) === 0n} onClick={() => setPrice(parseUsdc(custom) * 100n, `Set the ${asset.name} price`)}>
            Set price
          </Button>
        </div>

        <h3 className="mt-6 text-sm font-semibold">Market closed (weekend)</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !!pos.feedFrozen}
            onClick={() =>
              tx.run(
                [{ label: "Close the market", address: asset.feed, abi: mockFeedAbi, functionName: "setFrozen", args: [true] }],
                "Market closed. The price is frozen and getting stale.",
              )
            }
          >
            Close market
          </Button>
          <Button variant="danger" size="sm" disabled={disabled || !pos.feedFrozen} onClick={() => setPrice((price * 80n) / 100n, "Reopen the market 20% lower")}>
            Reopen 20% lower
          </Button>
          <Button variant="secondary" size="sm" disabled={disabled || !pos.feedFrozen} onClick={() => setPrice(price, "Reopen the market at the same price")}>
            Reopen at same price
          </Button>
        </div>

        <h3 className="mt-6 text-sm font-semibold">Paused collateral transfers</h3>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            variant="danger"
            size="sm"
            disabled={disabled || !!pos.transfersPaused}
            onClick={() =>
              tx.run(
                [{ label: "Pause transfers", address: asset.token, abi: mockStockAbi, functionName: "setTransfersPaused", args: [true] }],
                `${asset.symbol} transfers are paused.`,
              )
            }
          >
            Pause transfers
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || !pos.transfersPaused}
            onClick={() =>
              tx.run(
                [{ label: "Resume transfers", address: asset.token, abi: mockStockAbi, functionName: "setTransfersPaused", args: [false] }],
                `${asset.symbol} transfers work again.`,
              )
            }
          >
            Resume transfers
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </Card>

      <Card title="Quick payday">
        <p className="text-sm leading-relaxed text-muted">
          Pays the connected wallet from its own test USDC.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
          <Field label="Salary" inputMode="decimal" suffix="USDC" value={payday} onChange={(e) => setPayday(e.target.value)} hint={`Wallet: ${fmtUsdc(p.walletUsdc)} USDC.`} />
          <Button className="min-h-11 sm:mt-6" disabled={!viewer.canAct || tx.state.busy || parseUsdc(payday) === 0n || parseUsdc(payday) > p.walletUsdc} onClick={runPayday}>
            Create payday
          </Button>
        </div>
      </Card>

      <Card title="Housekeeping" badge={<MockBadge />}>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
          <Field
            label="Pay interest into the mock interest venue"
            inputMode="decimal"
            suffix="USDC"
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            hint="Sends your own test USDC to the mock venue, so everyone earning there sees interest arrive."
          />
          <Button
            variant="secondary"
            className="min-h-11 sm:mt-6"
            disabled={!viewer.canAct || tx.state.busy || parseUsdc(interest) === 0n}
            onClick={() =>
              tx.run(
                [{ label: "Pay interest into the mock venue", address: ADDR.usdc, abi: erc20Abi, functionName: "transfer", args: [ADDR.mockYieldVault, parseUsdc(interest)] }],
                "Interest paid in.",
              )
            }
          >
            Pay interest
          </Button>
        </div>
        <div className="-mx-4 mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 pt-4 sm:-mx-5 sm:px-5">
          <p className="text-sm text-ink-soft">
            The mock exchange holds <strong>{fmtUsdc(exchangeUsdc)} USDC</strong> from purchases.
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || exchangeUsdc === 0n}
            onClick={() =>
              tx.run(
                [{ label: "Take test USDC back from the mock exchange", address: ADDR.mockSwap, abi: mockSwapAbi, functionName: "withdrawUsdc", args: [viewer.address, exchangeUsdc] }],
                "Test USDC returned to the operator wallet.",
              )
            }
          >
            Take it back
          </Button>
        </div>
      </Card>
    </>
  );
}
