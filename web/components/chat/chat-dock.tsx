"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { useViewer } from "@/components/providers";
import { Button, Spinner } from "@/components/ui";
import type { ChatTurn, ResearchNote } from "@/lib/chat/agent";
import { parseIntent, type Intent } from "@/lib/chat/intent";
import { borrowInsteadChip, errorStep, followUpChips, starterChips, type Chip } from "@/lib/chat/chips";
import { leadIn } from "@/lib/chat/leadIn";
import { usePlan } from "@/lib/chat/usePlan";
import { useSession } from "@/lib/useAccount";
import { usePortfolio } from "@/lib/usePortfolio";
import { ActionCard, TxLinks, type ChatReceipt } from "./action-card";

/**
 * The chat assistant dock on every app page: a floating button that opens a panel (a bottom sheet on
 * phones). History stays on this device only (localStorage, per wallet). The assistant answers and
 * prepares one card at a time; nothing is signed or sent without the person confirming in their wallet.
 */

/** A chat message. A `receipt` is a finished action kept on this device only, never sent to the model. */
type Msg = ChatTurn & { research?: ResearchNote[]; receipt?: ChatReceipt };
type Pending = { intent: Intent; id: number };

/** What Tab can land on inside the panel. */
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const storeKey = (address: string) => `stackday-chat:${address.toLowerCase()}`;
const MAX_KEPT = 40;
const MAX_RECEIPTS = 100;

/** The last messages, plus every older receipt (up to 100), so the Activity list outlives the chat. */
function trimmed(msgs: Msg[]): Msg[] {
  const recent = msgs.slice(-MAX_KEPT);
  const older = msgs.slice(0, -MAX_KEPT).filter((m) => m.receipt);
  return [...older.slice(-MAX_RECEIPTS), ...recent];
}

function loadHistory(address: string): Msg[] {
  try {
    const raw = localStorage.getItem(storeKey(address));
    const parsed = raw ? (JSON.parse(raw) as Msg[]) : [];
    return Array.isArray(parsed) ? trimmed(parsed.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")) : [];
  } catch {
    return [];
  }
}

function saveHistory(address: string, msgs: Msg[]) {
  try {
    localStorage.setItem(storeKey(address), JSON.stringify(trimmed(msgs)));
  } catch {
    // private window or storage blocked: the chat still works, it just is not kept
  }
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  // Focus goes back to the "Ask" button when the panel closes (it remounts on close).
  const refocus = useRef(false);
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    launcher.current?.focus();
  }, [open]);
  if (open)
    return (
      <ChatPanel
        onClose={() => {
          refocus.current = true;
          setOpen(false);
        }}
      />
    );
  return (
    <button
      ref={launcher}
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
  const [view, setView] = useState<"chat" | "activity">("chat");
  const addReceipt = useCallback((r: ChatReceipt) => {
    setMsgs((m) => [...m, { role: "assistant", text: `Done: ${r.title}`, receipt: r }]);
  }, []);
  // A wallet signature in progress (card steps or the sign-in message) keeps the panel open.
  const walletBusy = signing || session.busy;
  const close = useCallback(() => {
    if (!walletBusy) onClose();
  }, [walletBusy, onClose]);
  const { result: plan, check } = usePlan(pending?.intent ?? null, pending?.id ?? 0, p, me);
  // Follow-up chips for the last answer (from code, see lib/chat/chips.ts), and the card that finished.
  const [chips, setChips] = useState<Chip[]>([]);
  const [doneCard, setDoneCard] = useState<number | null>(null);
  const pathname = usePathname();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const failures = useRef(0);

  // History belongs to one wallet on this device.
  if (me && loadedFor !== me) {
    setLoadedFor(me);
    setMsgs(loadHistory(me));
    setPending(null);
    setChips([]);
  }

  // On a sell card: "Or borrow X USDC instead", from the card's own numbers. An option, not advice.
  const borrowChip = pending && plan?.ok && doneCard !== pending.id && !signing ? borrowInsteadChip(plan) : null;

  useEffect(() => {
    if (me && loadedFor === me) saveHistory(me, msgs);
  }, [me, loadedFor, msgs]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs, plan, check, sending]);

  // Initial focus once, when the panel opens: the message box if there is one, else the panel itself.
  useEffect(() => {
    (inputRef.current ?? panelRef.current)?.focus();
  }, []);

  // Esc closes, except while a wallet signature is in progress (close() checks).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  /** Keeps Tab inside the panel while it is open. Stands down while a wallet asks for a signature. */
  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || walletBusy || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Phones: drag the handle down to close the sheet. Moves the panel directly, no re-render per frame. */
  const drag = useRef<{ y: number; dy: number } | null>(null);
  function onHandleDown(e: PointerEvent<HTMLDivElement>) {
    if (walletBusy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, dy: 0 };
    if (panelRef.current) panelRef.current.style.transition = "none";
  }
  function onHandleMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !panelRef.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    panelRef.current.style.transform = `translateY(${drag.current.dy}px)`;
  }
  function onHandleUp() {
    const d = drag.current;
    drag.current = null;
    const el = panelRef.current;
    if (!d || !el) return;
    if (d.dy > 96) return close();
    el.style.transition = "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)";
    el.style.transform = "";
  }

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || sending || signing || !me) return;
      const next: Msg[] = [...msgs, { role: "user", text: clean.slice(0, 2000) }];
      setMsgs(next);
      setInput("");
      setError(undefined);
      setChips([]);
      setSending(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: next.filter((m) => !m.receipt).slice(-20).map(({ role, text, untrusted }) => ({ role, text: text.slice(0, 4000), ...(untrusted ? { untrusted } : {}) })) }),
        });
        const body = (await res.json().catch(() => ({}))) as { text?: string; intent?: unknown; untrusted?: boolean; research?: ResearchNote[]; tools?: unknown; wallet?: string; error?: string };
        if (!res.ok) throw new Error(body.error ?? "The assistant could not answer.");
        // The answer is about the signed-in wallet; a card must be for that same connected wallet.
        if (body.wallet && body.wallet.toLowerCase() !== me.toLowerCase()) throw new Error("You are signed in with a different wallet. Sign in again with this one.");
        failures.current = 0;
        // Untrusted text never chooses an action: the server already refuses that, and so does the browser.
        const checked = body.intent ? (body.untrusted ? ({ ok: false } as const) : parseIntent(body.intent)) : null;
        // Follow-up chips are picked in code from the fixed catalogue (lib/chat/chips.ts), never from the reply.
        const tools = Array.isArray(body.tools) ? body.tools.filter((t): t is string => typeof t === "string") : [];
        setChips(followUpChips({ action: checked?.ok ? checked.intent.action : undefined, tools, untrusted: !!body.untrusted }, clean));
        if (checked?.ok) {
          // A card turn: the model's own text is not shown. Code writes the sentence above the card, so
          // only the card (built in code) carries numbers.
          setMsgs((m) => [...m, { role: "assistant", text: leadIn(checked.intent) }]);
          // One pending card at a time: a new one replaces the old one.
          setPending({ intent: checked.intent, id: nextId.current++ });
        } else if (checked) {
          setError("The assistant proposed something that is not allowed, so it was dropped.");
        } else {
          const reply: Msg = { role: "assistant", text: body.text || "", untrusted: !!body.untrusted, research: body.research?.length ? body.research : undefined };
          if (reply.text || reply.research) setMsgs((m) => [...m, reply]);
        }
      } catch (e) {
        // Error ladder: the second failure in a row is worded differently and offers question chips.
        failures.current += 1;
        const step = errorStep(failures.current, e instanceof Error ? e.message : "The assistant could not answer.");
        setError(step.text);
        setChips(step.chips);
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

  /**
   * "Refresh numbers" / "Check again": the SAME stored intent under a new id, so usePlan reads the
   * chain again and rebuilds through buildPlan (same cap, same allowlist) with a fresh expiry and a new
   * pre-check. No /api/chat request and no model call.
   */
  function refreshCard() {
    if (signing) return;
    // The pressed button goes away with the old card: keep focus in the panel (not the input, which
    // would open the phone keyboard).
    panelRef.current?.focus();
    const id = nextId.current++;
    setPending((cur) => (cur ? { intent: cur.intent, id } : cur));
  }

  /** A chip sends its text; the chip row goes away, so focus stays in the panel. */
  function pickChip(text: string) {
    panelRef.current?.focus();
    void send(text);
  }

  function clear() {
    if (signing) return;
    // Clearing the conversation keeps the receipts: they are the record of what was signed.
    setMsgs((m) => m.filter((x) => x.receipt));
    setPending(null);
    setError(undefined);
    setChips([]);
    failures.current = 0;
  }

  return (
    <>
      {/* Phones: the page behind the sheet is dimmed, and tapping it closes the sheet (not while signing). */}
      <div aria-hidden className="fixed inset-0 z-50 bg-[rgb(0_0_0/0.4)] sm:hidden" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-title"
        tabIndex={-1}
        onKeyDown={trapTab}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] min-h-[60dvh] flex-col rounded-t-[20px] border border-line bg-surface shadow-[var(--shadow-lg)] outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[640px] sm:max-h-[calc(100dvh-48px)] sm:min-h-0 sm:w-[400px] sm:rounded-[20px]"
      >
        {/* Phones: a drag handle; pull it down to close. The Close button does the same for keyboards. */}
        <div
          aria-hidden
          className="flex touch-none select-none justify-center pb-1 pt-2 sm:hidden"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 pb-3 pt-1 sm:pt-3">
          <div className="min-w-0">
            <h2 id="chat-title" className="text-sm font-semibold text-ink">
              Assistant
            </h2>
            <div className="text-[11.5px] text-warn">Base Sepolia testnet, test tokens</div>
          </div>
          <div className="flex items-center gap-1">
            {me && session.signedIn && (
              <button
                type="button"
                onClick={() => setView((v) => (v === "chat" ? "activity" : "chat"))}
                aria-pressed={view === "activity"}
                className="hit rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-ink"
              >
                {view === "chat" ? "Activity" : "Chat"}
              </button>
            )}
            {msgs.some((m) => !m.receipt) && view === "chat" && (
              <button type="button" onClick={clear} disabled={signing} className="hit rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-ink">
                Clear
              </button>
            )}
            <button type="button" onClick={close} disabled={walletBusy} className="hit rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-ink" aria-label="Close the assistant">
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
          ) : view === "activity" ? (
            <ActivityList receipts={msgs.filter((m) => m.receipt).map((m) => m.receipt!)} />
          ) : (
            <>
              {msgs.length === 0 && (
                <div className="space-y-2">
                  <p className="text-[13px] text-muted">
                    Ask about your balances, loans and the weekly research, or ask me to prepare a buy, sell, recurring buy, borrow or repay. You check and sign every action in your own wallet. General information, not financial advice.
                  </p>
                  <ChipRow label="Suggestions for this page" chips={starterChips(pathname)} disabled={sending || signing} onPick={pickChip} />
                </div>
              )}
              {/* The conversation is a log: new messages are announced politely. The card sits outside it,
                  so its countdown is not read out; the card announces its own state changes. */}
              <div role="log" aria-live="polite" aria-label="Conversation" className="space-y-3">
                {msgs.map((m, i) => (
                  <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-ink px-3 py-2 text-[13px] text-canvas"
                          : "max-w-[95%] whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink"
                      }
                    >
                      {m.receipt ? <ReceiptCard r={m.receipt} /> : m.text}
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
              </div>
              {pending && me && (plan ? (
                <ActionCard
                  key={pending.id}
                  result={plan}
                  check={check}
                  me={me}
                  onRefresh={refreshCard}
                  onBusyChange={setSigning}
                  onReceipt={(r) => {
                    addReceipt(r);
                    setDoneCard(pending.id);
                  }}
                  onClose={() => setPending(null)}
                />
              ) : (
                <p className="flex items-center gap-2 text-xs text-muted" role="status">
                  <Spinner /> Preparing the card with live prices...
                </p>
              ))}
              {borrowChip && <ChipRow label="Another option" chips={[borrowChip]} disabled={sending || signing} onPick={pickChip} />}
              <div role="status">
                {sending && (
                  <p className="flex items-center gap-2 text-xs text-muted">
                    <Spinner /> Thinking...
                  </p>
                )}
                {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
              </div>
              {!sending && chips.length > 0 && <ChipRow label="Suggestions" chips={chips} disabled={signing} onPick={pickChip} />}
            </>
          )}
        </div>

        {me && session.signedIn && view === "chat" && (
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
    </>
  );
}

/** A row of suggestion chips. Each one just sends its text, the same as typing it. */
function ChipRow({ chips, label, disabled, onPick }: { chips: Chip[]; label: string; disabled?: boolean; onPick: (text: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={`${c.id}-${c.label}`}
          type="button"
          disabled={disabled}
          onClick={() => onPick(c.text)}
          className="min-h-9 touch-manipulation select-none rounded-full border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-hover active:bg-hover disabled:opacity-50"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** A finished action in the chat: what was done, when, and its transactions on BaseScan. */
function ReceiptCard({ r }: { r: ChatReceipt }) {
  return (
    <div className="rounded-xl border border-line-soft bg-sunken px-3 py-2 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-grow">Done: {r.title}</span>
        <span className="shrink-0 text-muted">{when(r.at)}</span>
      </div>
      {r.rows.slice(0, 2).map((row) => (
        <div key={row.label} className="mt-0.5 text-ink-soft">
          {row.label}: {row.value}
        </div>
      ))}
      <TxLinks hashes={r.hashes} />
    </div>
  );
}

/** Every action this wallet finished through the chat on this device, newest first. */
function ActivityList({ receipts }: { receipts: ChatReceipt[] }) {
  if (receipts.length === 0) {
    return <p className="text-[13px] text-muted">No buys, sells or loans from the chat yet. When you confirm one, it shows here with its transaction links.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Actions you confirmed through the chat, kept on this device. Every transaction links to BaseScan.</p>
      {[...receipts].reverse().map((r) => (
        <ReceiptCard key={`${r.at}-${r.title}`} r={r} />
      ))}
    </div>
  );
}
