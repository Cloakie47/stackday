"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { AssetIcon, cx } from "@/components/ui";
import { COMMANDS, suggestAssets, type AssetSuggestion, type CommandMeta } from "./commands-stub"; // ENGINE: switch to @/lib/chat/commands

/**
 * The chat message box with two autocomplete popups, both opening above the box:
 * - `/` as the very first character lists the commands (filtered by prefix, aliases included).
 * - `$` at the start or after a space lists assets (at most four), filtered by the command typed.
 * Up/Down move, Enter or Tab pick, Esc closes. With no popup open, Enter sends and Shift+Enter adds a
 * new line. Picking only inserts text: nothing is sent until the person sends it.
 */

type Filter = "all" | "borrowable" | "held" | "send";
type Popup =
  | { kind: "command"; start: number; end: number; items: CommandMeta[] }
  | { kind: "asset"; start: number; end: number; items: AssetSuggestion[] };

const bare = (name: string) => name.replace(/^\//, "").toLowerCase();

/** The command the message starts with, aliases resolved, or undefined. */
function commandOf(value: string): string | undefined {
  const m = /^\/(\S+)/.exec(value);
  if (!m) return undefined;
  const word = m[1].toLowerCase();
  return COMMANDS.find((c) => bare(c.name) === word || c.aliases.some((a) => bare(a) === word))?.name.replace(/^\//, "");
}

/** Which assets make sense after the command typed so far. */
function filterFor(value: string): Filter {
  const cmd = commandOf(value);
  if (cmd === "borrow" || cmd === "lock") return "borrowable";
  if (cmd === "sell" || cmd === "unlock") return "held";
  if (cmd === "send" || cmd === "withdraw") return "send";
  return "all";
}

/** The popup for the text before the caret, or null. */
function popupAt(value: string, caret: number, positions: unknown[]): Popup | null {
  const before = value.slice(0, caret);
  // Commands: only while the caret is still inside the first word, which starts with "/".
  if (before.startsWith("/") && !/\s/.test(before)) {
    const q = before.slice(1).toLowerCase();
    const items = COMMANDS.filter((c) => bare(c.name).startsWith(q) || c.aliases.some((a) => bare(a).startsWith(q)));
    return items.length ? { kind: "command", start: 0, end: caret, items } : null;
  }
  // Assets: a "$" token at the start or after whitespace, letters only ("$5" is an amount).
  const m = /(^|\s)\$([A-Za-z][A-Za-z0-9.]*)?$/.exec(before);
  if (!m) return null;
  const query = m[2] ?? "";
  const start = caret - query.length - 1;
  const items = suggestAssets(query, { positions, filter: filterFor(value) }).slice(0, 4);
  return items.length ? { kind: "asset", start, end: caret, items } : null;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  positions,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string) => void;
  /** Sending or signing: typing still works, sending waits. */
  busy?: boolean;
  /** The person's positions, for the asset suggestions (held amounts, held-only filter). */
  positions: unknown[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Esc closes the popup for the token it was open on; a new token opens it again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const nextCaret = useRef<number | null>(null);

  const found = popupAt(value, Math.min(caret, value.length), positions);
  const key = found ? `${found.kind}:${found.start}` : null;
  const popup = found && key !== dismissed ? found : null;
  const count = popup?.items.length ?? 0;
  const current = popup ? Math.min(active, count - 1) : -1;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  // After a pick, put the caret right after the inserted text.
  useLayoutEffect(() => {
    const at = nextCaret.current;
    const el = inputRef.current;
    if (at === null || !el) return;
    nextCaret.current = null;
    el.setSelectionRange(at, at);
  }, [value, inputRef]);

  function sync(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart ?? el.value.length);
  }

  function pick(i: number) {
    if (!popup) return;
    const token = popup.kind === "command" ? `/${bare(popup.items[i].name)} ` : `$${popup.items[i].ticker} `;
    // Swallow the rest of the word being replaced and one space after it, so nothing doubles up.
    const rest = value.slice(popup.end).replace(/^\S*\s?/, "");
    const next = value.slice(0, popup.start) + token + rest;
    const at = popup.start + token.length;
    nextCaret.current = at;
    setCaret(at);
    setActive(0);
    onChange(next.slice(0, 2000));
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // An input method (Japanese, Chinese, Korean...) uses Enter and the arrows while composing.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (popup) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((current + step + count) % count);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (e.shiftKey) return;
        e.preventDefault();
        pick(current);
        return;
      }
      if (e.key === "Escape") {
        // Close the popup only, not the whole panel.
        e.preventDefault();
        e.stopPropagation();
        setDismissed(key);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy) onSubmit(value);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit(value);
      }}
      className="relative flex items-end gap-2 border-t border-line-soft px-3 py-3 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      <div role="status" aria-live="polite" className="sr-only">
        {popup ? `${count} ${count === 1 ? "suggestion" : "suggestions"}` : ""}
      </div>
      {popup && (
        <ul
          id={listId}
          role="listbox"
          aria-label={popup.kind === "command" ? "Commands" : "Assets"}
          className="absolute inset-x-3 bottom-full z-10 mb-2 max-h-72 animate-[var(--animate-pop)] overflow-y-auto rounded-2xl border border-line bg-popover p-1 shadow-[var(--shadow-lg)]"
        >
          {popup.kind === "command"
            ? popup.items.map((c, i) => (
                <li
                  key={c.name}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === current}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                  onPointerEnter={() => setActive(i)}
                  className={cx("flex min-h-11 cursor-pointer flex-col justify-center rounded-xl px-2.5 py-1.5 sm:min-h-10", i === current && "bg-hover")}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[13px] font-semibold text-ink">/{bare(c.name)}</span>
                    <span className="min-w-0 truncate text-[12.5px] text-ink-soft">{c.description}</span>
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted">{c.usage}</span>
                </li>
              ))
            : popup.items.map((s, i) => (
                <li
                  key={s.symbol}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === current}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pick(i);
                  }}
                  onPointerEnter={() => setActive(i)}
                  className={cx("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-1.5 sm:min-h-10", i === current && "bg-hover")}
                >
                  <AssetIcon icon={s.icon} size={24} />
                  <span className="font-mono text-[13px] font-semibold text-ink">${s.ticker}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">{s.name}</span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-muted">{s.held ?? (s.borrowable ? "" : "Invest only")}</span>
                </li>
              ))}
        </ul>
      )}
      <label htmlFor="chat-input" className="sr-only">
        Message the assistant
      </label>
      <textarea
        id="chat-input"
        ref={inputRef}
        rows={1}
        value={value}
        maxLength={2000}
        role="combobox"
        aria-expanded={!!popup}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={popup && current >= 0 ? optionId(current) : undefined}
        autoComplete="off"
        spellCheck={value.startsWith("/") ? false : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target);
          setActive(0);
          setDismissed(null);
        }}
        onSelect={(e) => sync(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => setDismissed(key)}
        onFocus={(e) => {
          sync(e.currentTarget);
          setDismissed(null);
        }}
        placeholder="Ask, or type / for commands"
        className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-popover px-3 py-2.5 text-base text-ink placeholder:text-muted focus:border-[var(--focus)] focus:outline-none sm:min-h-10 sm:py-2 sm:text-sm"
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        aria-label="Send"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white transition-colors hover:bg-brand-strong disabled:bg-sunken disabled:text-muted sm:h-10 sm:w-10"
      >
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M6 11l6-6 6 6" />
        </svg>
      </button>
    </form>
  );
}
