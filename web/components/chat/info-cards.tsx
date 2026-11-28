"use client";

import type { ReactNode } from "react";
import { AssetIcon, Badge, HealthMeter, Notice, Row } from "@/components/ui";
import { ASSETS } from "@/lib/contracts";
import { ChipRow } from "./chips";
import type { CommandMeta, InfoView } from "./commands-stub"; // ENGINE: switch to @/lib/chat/commands

/**
 * Answers to look-up commands (/balance, /positions, /$TICKER, /borrow with no amount, /help), drawn
 * in the chat from numbers the engine read from the chain in code. No model text, no network call.
 * Chips only send a message, the same as typing it; an action still becomes a card to check and sign.
 */

type Props = { view: InfoView; disabled?: boolean; onPick: (text: string) => void; onInsert: (text: string) => void };

export function InfoCard({ view, disabled, onPick, onInsert }: Props) {
  switch (view.kind) {
    case "balance":
      return <BalanceCard view={view} />;
    case "positions":
      return <PositionsCard view={view} />;
    case "ticker":
      return <TickerCard view={view} disabled={disabled} onPick={onPick} />;
    case "borrow_max":
      return <BorrowMaxCard view={view} disabled={disabled} onPick={onPick} />;
    case "help":
      return <HelpCard commands={view.commands} onInsert={onInsert} />;
  }
}

function Shell({ title, badge, icon, children }: { title: string; badge?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="w-full rounded-2xl border border-line bg-popover p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-[13px] font-semibold text-ink">{title}</h3>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

const Testnet = () => <Badge tone="warn">Testnet, test tokens</Badge>;

const iconFor = (symbol: string) => ASSETS.find((a) => a.symbol === symbol)?.icon;

export function BalanceCard({ view }: { view: Extract<InfoView, { kind: "balance" }> }) {
  return (
    <Shell title="Your USDC" badge={<Testnet />}>
      <Row label="In your wallet">{view.walletUsdc}</Row>
      <Row label="In your vault">{view.vaultUsdc}</Row>
      <Row label="Earning interest">{view.earning}</Row>
      <Row label={<span className="font-semibold text-ink">Total</span>}>
        <span className="font-semibold">{view.total}</span>
      </Row>
    </Shell>
  );
}

export function PositionsCard({ view }: { view: Extract<InfoView, { kind: "positions" }> }) {
  return (
    <Shell title="Your positions" badge={<Testnet />}>
      {view.holdings.length === 0 ? (
        <p className="py-2 text-[12.5px] text-muted">No holdings yet.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <caption className="sr-only">Holdings</caption>
          <thead>
            <tr className="text-[11px] text-muted">
              <th scope="col" className="py-1 text-left font-medium">
                Asset
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Free
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Locked
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {view.holdings.map((h) => (
              <tr key={h.ticker} className="border-t border-line-soft">
                <th scope="row" className="py-1.5 text-left font-normal">
                  <span className="font-mono font-semibold text-ink">${h.ticker}</span>
                  <span className="block truncate text-[11px] text-muted">{h.name}</span>
                </th>
                <td className="py-1.5 text-right tabular-nums text-ink">{h.free}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{h.locked}</td>
                <td className="py-1.5 text-right tabular-nums text-ink">{h.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {view.loans.length > 0 && (
        <div className="mt-2 space-y-2 border-t border-line-soft pt-2">
          <div className="text-[11px] font-medium text-muted">Loans</div>
          {view.loans.map((l) => (
            <div key={l.ticker} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="font-mono font-semibold text-ink">${l.ticker}</span>
                <span className="tabular-nums text-ink">{l.owed} owed</span>
              </div>
              {l.health !== null && (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <HealthMeter health={l.health} compact />
                  </div>
                  <span className="text-[11.5px] tabular-nums text-muted">Health {l.health.toFixed(2)}</span>
                </div>
              )}
              {l.liquidationPrice && <div className="text-[11.5px] text-muted">Liquidation price {l.liquidationPrice}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 border-t border-line-soft">
        <Row label="Earning interest">{view.earning}</Row>
        <Row label={<span className="font-semibold text-ink">Total</span>}>
          <span className="font-semibold">{view.total}</span>
        </Row>
      </div>
    </Shell>
  );
}

export function TickerCard({ view, disabled, onPick }: { view: Extract<InfoView, { kind: "ticker" }>; disabled?: boolean; onPick: (text: string) => void }) {
  return (
    <Shell
      title={`$${view.ticker} ${view.name}`}
      icon={<AssetIcon icon={iconFor(view.symbol)} size={24} />}
      badge={view.borrowable ? <Badge tone="brand">Borrowable</Badge> : <Badge>Invest only</Badge>}
    >
      <Row label="Test price">{view.price ?? "Not available"}</Row>
      <Row label="In your wallet">{view.wallet}</Row>
      <Row label="In your vault">{view.vault}</Row>
      <Row label="Locked as collateral">{view.locked}</Row>
      <Row label={<span className="font-semibold text-ink">Value</span>}>
        <span className="font-semibold">{view.value}</span>
      </Row>
      {view.chips.length > 0 && (
        <div className="mt-2">
          <ChipRow label={`Actions for ${view.name}`} chips={view.chips} disabled={disabled} onPick={onPick} />
        </div>
      )}
    </Shell>
  );
}

const RISK_LABEL = { low: "Low", mid: "Mid", high: "High" } as const;

export function BorrowMaxCard({ view, disabled, onPick }: { view: Extract<InfoView, { kind: "borrow_max" }>; disabled?: boolean; onPick: (text: string) => void }) {
  return (
    <Shell title={`Borrow against $${view.ticker}`} icon={<AssetIcon icon={iconFor(view.symbol)} size={24} />} badge={<Testnet />}>
      {view.reason && (
        <div className="mb-2">
          <Notice tone="warn">{view.reason}</Notice>
        </div>
      )}
      <ul className="divide-y divide-line-soft">
        {view.levels.map((l) => (
          <li key={l.risk} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-1.5">
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-ink">{RISK_LABEL[l.risk]} risk</div>
              <div className="text-[11.5px] tabular-nums text-muted">Up to {l.max}</div>
            </div>
            {l.chip ? (
              <ChipRow label={`${RISK_LABEL[l.risk]} risk`} chips={[l.chip]} disabled={disabled} onPick={onPick} />
            ) : (
              l.note && <span className="text-[11.5px] text-muted">{l.note}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-muted">Higher risk borrows more but sits closer to liquidation. Not financial advice.</p>
    </Shell>
  );
}

export function HelpCard({ commands, onInsert }: { commands: CommandMeta[]; onInsert: (text: string) => void }) {
  return (
    <Shell title="Commands">
      <p className="mb-2 text-[11.5px] leading-snug text-muted">Tap an example to put it in the message box. Type $ for an asset.</p>
      <ul className="divide-y divide-line-soft">
        {commands.map((c) => (
          <li key={c.name} className="py-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[12.5px] font-semibold text-ink">/{c.name.replace(/^\//, "")}</span>
              <span className="min-w-0 text-[12px] text-ink-soft">{c.description}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-[11px] text-muted">{c.usage}</span>
              <button
                type="button"
                onClick={() => onInsert(c.example)}
                className="min-h-8 touch-manipulation rounded-lg border border-line bg-surface px-2 font-mono text-[11.5px] text-ink hover:bg-hover"
                aria-label={`Put ${c.example} in the message box`}
              >
                {c.example}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
