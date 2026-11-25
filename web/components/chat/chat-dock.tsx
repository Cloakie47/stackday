"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useViewer } from "@/components/providers";
import { Button, Spinner } from "@/components/ui";
import type { ChatTurn, ResearchNote } from "@/lib/chat/agent";
import { parseIntent, type Intent } from "@/lib/chat/intent";
import { usePlan } from "@/lib/chat/usePlan";
import { useSession } from "@/lib/useAccount";
import { usePortfolio } from "@/lib/usePortfolio";
import { ActionCard } from "./action-card";

/**
 * The chat assistant dock on every app page: a floating button that opens a panel (a bottom sheet on
 * phones). History stays on this device only (localStorage, per wallet). The assistant answers and
 * prepares one card at a time; nothing is signed or sent without the person confirming in their wallet.
 */

type Msg = ChatTurn & { research?: ResearchNote[] };
type Pending = { intent: Intent; id: number };

const storeKey = (address: string) => `stackday-chat:${address.toLowerCase()}`;
const MAX_KEPT = 40;

function loadHistory(address: string): Msg[] {
  try {
    const raw = localStorage.getItem(storeKey(address));
    const parsed = raw ? (JSON.parse(raw) as Msg[]) : [];
    return Array.isArray(parsed) ? parsed.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string").slice(-MAX_KEPT) : [];
  } catch {
    return [];
  }
}

function saveHistory(address: string, msgs: Msg[]) {
  try {
    localStorage.setItem(storeKey(address), JSON.stringify(msgs.slice(-MAX_KEPT)));
  } catch {
    // private window or storage blocked: the chat still works, it just is not kept
  }
}

const SUGGESTIONS = ["What do I have?", "How is my loan?", "What are the fees?", "What does Stackday think about gold this week?"];

export function ChatDock() {
  const [open, setOpen] = useState(false);
  if (open) return <ChatPanel onClose={() => setOpen(false)} />;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="fixed bottom-24 right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-canvas shadow-[var(--shadow-lg)] hover:opacity-90 lg:bottom-6 lg:right-6"
      aria-label="Open the Stackday assistant"
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      Ask
    </button>
  );
}

/**
 * The open panel. It mounts only when opened, so its chain reads never start while a page is still
 * hydrating, and closing it drops any pending card (a card never outlives the panel it was shown in).
 */
function ChatPanel({ onClose }: { onClose: () => void }) {
  const viewer = useViewer();
  const me = viewer.canAct ? viewer.address : undefined;
  const session = useSession();
  const p = usePortfolio(me);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadedFor, setLoadedFor] = useState<string>();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<Pending | null>(null);
  // While a card's wallet steps run, the panel stays open and no new card can replace it.
  const [signing, setSigning] = useState(false);
  const close = useCallback(() => {
    if (!signing) onClose();
  }, [signing, onClose]);
  const plan = usePlan(pending?.intent ?? null, p, me);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  // History belongs to one wallet on this device.
  if (me && loadedFor !== me) {
    setLoadedFor(me);
    setMsgs(loadHistory(me));
    setPending(null);
  }

  useEffect(() => {
    if (me && loadedFor === me) saveHistory(me, msgs);
  }, [me, loadedFor, msgs]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs, plan, sending]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || sending || signing || !me) return;
      const next: Msg[] = [...msgs, { role: "user", text: clean.slice(0, 2000) }];
      setMsgs(next);
      setInput("");
      setError(undefined);
      setSending(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: next.slice(-20).map(({ role, text, untrusted }) => ({ role, text: text.slice(0, 4000), ...(untrusted ? { untrusted } : {}) })) }),
        });
        const body = (await res.json().catch(() => ({}))) as { text?: string; intent?: unknown; untrusted?: boolean; research?: ResearchNote[]; wallet?: string; error?: string };
        if (!res.ok) throw new Error(body.error ?? "The assistant could not answer.");
        // The answer is about the signed-in wallet; a card must be for that same connected wallet.
        if (body.wallet && body.wallet.toLowerCase() !== me.toLowerCase()) throw new Error("You are signed in with a different wallet. Sign in again with this one.");
        const reply: Msg = { role: "assistant", text: body.text || "", untrusted: !!body.untrusted, research: body.research?.length ? body.research : undefined };
        if (reply.text || reply.research) setMsgs((m) => [...m, reply]);
        if (body.intent) {
          const checked = parseIntent(body.intent);
          // One pending card at a time: a new one replaces the old one.
          if (checked.ok) setPending({ intent: checked.intent, id: nextId.current++ });
          else setError("The assistant proposed something that is not allowed, so it was dropped.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "The assistant could not answer.");
      } finally {
        setSending(false);
      }
    },
    [msgs, sending, signing, me],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function clear() {
    if (signing) return;
    setMsgs([]);
    setPending(null);
    setError(undefined);
  }

  return (
    <div
      role="dialog"
      aria-label="Stackday assistant"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] min-h-[60dvh] flex-col rounded-t-[20px] border border-line bg-surface shadow-[var(--shadow-lg)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[640px] sm:max-h-[calc(100dvh-48px)] sm:min-h-0 sm:w-[400px] sm:rounded-[20px]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">Assistant</div>
          <div className="text-[11.5px] text-warn">Base Sepolia testnet, test tokens</div>
        </div>
        <div className="flex items-center gap-1">
          {msgs.length > 0 && (
            <button type="button" onClick={clear} disabled={signing} className="hit rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-ink">
              Clear
            </button>
          )}
          <button type="button" onClick={close} disabled={signing} className="hit rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-ink" aria-label="Close the assistant">
            Close
          </button>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        {!me ? (
          <p className="text-[13px] text-muted">Connect your wallet to chat about your own balances and loans.</p>
        ) : !session.loading && !session.configured ? (
          <p className="text-[13px] text-muted">The assistant needs the account database, which is not connected on this site.</p>
        ) : !session.signedIn ? (
          <div className="space-y-2 text-[13px] text-muted">
            <p>Sign in once with your wallet so the assistant can read your own balances. It is a free signature, not a transaction.</p>
            <Button size="sm" disabled={session.busy} onClick={() => void session.signIn()}>
              Sign in with your wallet
            </Button>
            {session.error && <p className="text-xs text-danger">{session.error}</p>}
          </div>
        ) : (
          <>
            {msgs.length === 0 && (
              <div className="space-y-2">
                <p className="text-[13px] text-muted">
                  Ask about your balances, loans and the weekly research, or ask me to prepare a buy, sell, recurring buy, borrow or repay. You check and sign every action in your own wallet. General information, not financial advice.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft hover:bg-hover">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-ink px-3 py-2 text-[13px] text-canvas"
                      : "max-w-[95%] whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink"
                  }
                >
                  {m.text}
                  {m.research && (
                    <div className="mt-2 rounded-xl border border-line-soft bg-sunken px-3 py-2 text-xs text-ink-soft">
                      {m.research.map((r) => (
                        <div key={r.assetId}>
                          {r.name}: <b className="font-semibold">{r.view}</b> ({r.conviction} conviction)
                        </div>
                      ))}
                      <div className="mt-1 text-muted">Approved Stackday weekly report, week of {m.research[0].weekOf}.</div>
                      <div className="mt-1 text-[11px] leading-snug text-muted">{m.research[0].disclaimer}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pending && me && (plan ? (
              <ActionCard key={pending.id} result={plan} me={me} onBusyChange={setSigning} onClose={() => setPending(null)} />
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted">
                <Spinner /> Preparing the card with live prices...
              </p>
            ))}
            {sending && (
              <p className="flex items-center gap-2 text-xs text-muted">
                <Spinner /> Thinking...
              </p>
            )}
            {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
          </>
        )}
      </div>

      {me && session.signedIn && (
        <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line-soft px-3 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <label htmlFor="chat-input" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask or say: buy $20 of Apple"
            className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-popover px-3 py-2 text-base text-ink placeholder:text-faint focus:border-[var(--focus)] focus:outline-none sm:text-sm"
          />
          <Button type="submit" size="sm" disabled={sending || signing || !input.trim()}>
            Send
          </Button>
        </form>
      )}
    </div>
  );
}
