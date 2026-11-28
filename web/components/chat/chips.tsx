"use client";

import { Chip } from "@/components/ui";

/** The part of a chip the dock draws. Catalogue chips (lib/chat/chips.ts) and the empty-state tiles both fit. */
export type StarterChip = { label: string; text: string; kind: "question" | "action" };

/**
 * One suggestion chip. It only sends its text, the same as typing it. An action chip carries a small
 * arrow: it prepares a card the person still checks and signs.
 */
export function ChatChip({ chip, disabled, onPick, block }: { chip: StarterChip; disabled?: boolean; onPick: (text: string) => void; block?: boolean }) {
  const action = chip.kind === "action";
  return (
    <Chip
      size="sm"
      disabled={disabled}
      onClick={() => onPick(chip.text)}
      className={`touch-manipulation select-none text-left ${block ? "w-full justify-between" : ""} ${action ? "" : "font-normal text-ink-soft"}`}
      title={action ? "Prepares a card for you to check" : undefined}
    >
      <span className="min-w-0">{chip.label}</span>
      {action && (
        <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      )}
      {action && <span className="sr-only">(prepares a card)</span>}
    </Chip>
  );
}

/** A row of suggestion chips with a group label for screen readers. */
export function ChipRow({ chips, label, disabled, onPick }: { chips: StarterChip[]; label: string; disabled?: boolean; onPick: (text: string) => void }) {
  if (chips.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <ChatChip key={`${c.kind}-${c.label}`} chip={c} disabled={disabled} onPick={onPick} />
      ))}
    </div>
  );
}
