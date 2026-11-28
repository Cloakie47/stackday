"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useViewer } from "@/components/providers";
import { cx } from "@/components/ui";
import type { ChatTurn, ResearchNote } from "@/lib/chat/agent";
import { parseIntent, type Intent } from "@/lib/chat/intent";
import { borrowInsteadChip, errorStep, followUpChips, type Chip } from "@/lib/chat/chips";
import { leadIn } from "@/lib/chat/leadIn";
import { usePlan } from "@/lib/chat/usePlan";
import { useSession } from "@/lib/useAccount";
import { usePortfolio } from "@/lib/usePortfolio";
import { ActionCard, ActionCardSkeleton } from "./action-card";
import { ChipRow } from "./chips";
import { EmptyState, type EmptyMode } from "./empty-state";
import { ActivityList, ReceiptCard, type ChatReceipt } from "./receipt-card";

/**
 * The chat assistant dock on every app page: a floating button that opens a panel (a bottom sheet on
 * phones). History stays on this device only (localStorage, per wallet). The assistant answers and
 * prepares one card at a time; nothing is signed or sent without the person confirming in their wallet.
 */

/** A chat message. A `receipt` is a finished action kept on this device only, never sent to the model. */
type Msg = ChatTurn & { research?: ResearchNote[]; receipt?: ChatReceipt };
/**
 * The card on screen. `anchor` is the index of the message it sits under (the sentence written for it,
 * right after the person's own message). `userText` is what the person typed for it, for the engine.
 */
type Pending = { intent: Intent; id: number; anchor: number; userText: string };
/** A card that left the conversation without a receipt, kept as one quiet line in its place. */
type ClosedCard = { anchor: number; note: string };
type ChatError = { text: string; refusal?: boolean };

/** What Tab can land on inside the panel. */
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

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
      className="chat-launcher fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-canvas shadow-[var(--shadow-lg)] hover:opacity-90 lg:bottom-6 lg:right-6"
      aria-label="Open the Stackday assistant"
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      Ask
    </button>
  );
}

/** A 40px square header button with an icon and a spoken label. */
function IconButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cx(
        "grid h-10 w-10 place-items-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent",
        pressed && "bg-hover text-ink",
      )}
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

/** "The assistant is writing": three dots. Motion stops for people who ask for less of it. */
function TypingDots() {
  return (
    <div className="flex">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-sunken px-3.5 py-3" role="status" aria-label="The assistant is writing">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
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
  const [error, setError] = useState<ChatError>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [closed, setClosed] = useState<ClosedCard[]>([]);
  // While a card's wallet steps run, the panel stays open and no new card can replace it.
  const [signing, setSigning] = useState(false);
  const [view, setView] = useState<"chat" | "activity">("chat");
  // The receipt takes the card's place: no separate "Done" message, the receipt card says it.
  const addReceipt = useCallback((r: ChatReceipt) => {
    setMsgs((m) => [...m, { role: "assistant", text: r.headline ?? r.title, receipt: r }]);
  }, []);
  // A wallet signature in progress (card steps or the sign-in message) keeps the panel open.
  const walletBusy = signing || session.busy;
  const close = useCallback(() => {
    if (!walletBusy) onClose();
  }, [walletBusy, onClose]);
  // ENGINE: pass pending?.userText as 5th arg
  const { result: plan, check } = usePlan(pending?.intent ?? null, pending?.id ?? 0, p, me);
  // Follow-up chips for the last answer (from code, see lib/chat/chips.ts), and the card that finished.
  const [chips, setChips] = useState<Chip[]>([]);
  const [doneCard, setDoneCard] = useState<number | null>(null);
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
    setClosed([]);
    setChips([]);
  }

  // On a sell card: "Or borrow X USDC instead", from the card's own numbers. An option, not advice.
  const borrowChip = pending && plan?.ok && doneCard !== pending.id && !signing ? borrowInsteadChip(plan) : null;

  useEffect(() => {
    if (me && loadedFor === me) saveHistory(me, msgs);
  }, [me, loadedFor, msgs]);

  // Follow the newest message; the empty state stays at its top so the greeting is seen first.
  useEffect(() => {
    if (msgs.length === 0 && !sending) return;
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

  /**
   * Phones: when the on-screen keyboard opens, the sheet sits on top of it (visualViewport), so the
   * message box stays in view. Desktop and wide screens keep the stylesheet's placement.
   */
  useEffect(() => {
    const vv = window.visualViewport;
    const el = panelRef.current;
    if (!vv || !el) return;
    const phone = window.matchMedia("(max-width: 639px)");
    const apply = () => {
      const covered = phone.matches ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
      el.style.bottom = covered > 0 ? `${covered}px` : "";
      el.style.maxHeight = covered > 0 ? `${Math.round(vv.height * 0.94)}px` : "";
      el.style.minHeight = covered > 0 ? "0px" : "";
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    phone.addEventListener("change", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      phone.removeEventListener("change", apply);
    };
  }, []);

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

  /** The card on screen leaves the conversation without a receipt: one quiet line stays in its place. */
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });
  const fold = useCallback((cur: Pending | null, note: string) => {
    if (cur) setClosed((c) => [...c.filter((x) => x.anchor !== cur.anchor), { anchor: cur.anchor, note }]);
  }, []);
  const retire = useCallback(
    (note: string) => {
      fold(pendingRef.current, note);
      setPending(null);
    },
    [fold],
  );

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || sending || signing || !me) return;
      const userText = clean.slice(0, 2000);
      const next: Msg[] = [...msgs, { role: "user", text: userText }];
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
          // only the card (built in code) carries numbers. The card sits right under that sentence.
          const anchor = next.length;
          setMsgs((m) => [...m, { role: "assistant", text: leadIn(checked.intent) }]);
          // One pending card at a time: a new one replaces the old one, which folds into one line.
          fold(pendingRef.current, "Replaced by a newer card");
          setPending({ intent: checked.intent, id: nextId.current++, anchor, userText });
        } else if (checked) {
          setError({ text: "The assistant suggested an action that is not allowed, so it was dropped.", refusal: true });
        } else {
          const reply: Msg = { role: "assistant", text: body.text || "", untrusted: !!body.untrusted, research: body.research?.length ? body.research : undefined };
          if (reply.text || reply.research) setMsgs((m) => [...m, reply]);
        }
      } catch (e) {
        // Error ladder: the second failure in a row is worded differently and offers question chips.
        failures.current += 1;
        const step = errorStep(failures.current, e instanceof Error ? e.message : "The assistant could not answer.");
        setError({ text: step.text });
        setChips(step.chips);
      } finally {
        setSending(false);
      }
    },
    [msgs, sending, signing, me, fold],
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
    setPending((cur) => (cur ? { ...cur, id } : cur));
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
    setClosed([]);
    setError(undefined);
    setChips([]);
    failures.current = 0;
  }

  const canChat = !!me && session.signedIn;
  const emptyMode: EmptyMode = !me
    ? viewer.readOnly
      ? { kind: "view_only" }
      : { kind: "signed_out" }
    : !session.loading && !session.configured
      ? { kind: "no_database" }
      : !session.signedIn
        ? { kind: "sign_in", busy: session.busy, error: session.error, onSignIn: () => void session.signIn() }
        : { kind: "ready" };
  const tall = !!pending && view === "chat" && canChat;

  /** The card (or its skeleton, or its folded line) under message `i`. */
  function cardAt(i: number) {
    if (pending && pending.anchor === i && me) {
      // Its own live region is off: the countdown is never read out; the card announces its own changes.
      return (
        <div aria-live="off" className="animate-[var(--animate-pop)]">
          {plan ? (
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
                setSigning(false);
                setPending(null);
              }}
              onClose={(outcome) => retire(outcome === "expired" ? "Card expired" : outcome === "done" ? "Done" : "Card closed")}
            />
          ) : (
            <ActionCardSkeleton />
          )}
        </div>
      );
    }
    const gone = closed.find((c) => c.anchor === i);
    if (gone)
      return (
        <p className="flex items-center gap-2 pl-1 text-[11.5px] text-muted">
          <span aria-hidden className="h-px w-4 bg-line" />
          {gone.note}
        </p>
      );
    return null;
  }

  return (
    <>
      {/* Phones: the page behind the sheet is dimmed, and tapping it closes the sheet (not while signing). */}
      <div aria-hidden className="chat-backdrop fixed inset-0 z-50 sm:hidden" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-title"
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cx(
          "chat-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[20px] border border-line bg-surface shadow-[var(--shadow-lg)] outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:h-[640px] sm:max-h-[calc(100dvh-48px)] sm:min-h-0 sm:w-[400px] sm:rounded-[20px]",
          tall ? "min-h-[88dvh]" : "min-h-[45dvh]",
        )}
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
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-line-soft py-1.5 pl-4 pr-2 sm:py-2">
          <div className="min-w-0">
            <h2 id="chat-title" className="text-sm font-semibold text-ink">
              {view === "activity" ? "Activity" : "Assistant"}
            </h2>
            <div className="text-[11.5px] text-warn">Base Sepolia testnet, test tokens</div>
          </div>
          <div className="flex items-center">
            {canChat && (
              <IconButton
                label={view === "chat" ? "Show activity" : "Back to the chat"}
                pressed={view === "activity"}
                onClick={() => setView((v) => (v === "chat" ? "activity" : "chat"))}
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </IconButton>
            )}
            {msgs.some((m) => !m.receipt) && view === "chat" && (
              <IconButton label="Clear the conversation" onClick={clear} disabled={signing}>
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
              </IconButton>
            )}
            <IconButton label="Close the assistant" onClick={close} disabled={walletBusy}>
              <path d="M6 6l12 12M18 6L6 18" />
            </IconButton>
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
          {canChat && view === "activity" ? (
            <ActivityList receipts={msgs.filter((m) => m.receipt).map((m) => m.receipt!)} />
          ) : !canChat || msgs.length === 0 ? (
            <EmptyState mode={emptyMode} disabled={sending || signing} onPick={pickChip} />
          ) : (
            <>
              {/* The conversation is a log: new messages are announced politely. */}
              <div role="log" aria-live="polite" aria-label="Conversation" className="space-y-3">
                {msgs.map((m, i) => (
                  <div key={i} className="space-y-2">
                    <div className={m.role === "user" ? "flex justify-end" : "flex"}>
                      {m.receipt ? (
                        <div className="w-full">
                          <ReceiptCard r={m.receipt} />
                        </div>
                      ) : (
                        <div
                          className={
                            m.role === "user"
                              ? "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-ink px-3 py-2 text-[13px] text-canvas"
                              : "max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-sunken px-3 py-2 text-[13px] leading-relaxed text-ink"
                          }
                        >
                          {m.text}
                          {m.research && (
                            <div className="mt-2 rounded-xl border border-line-soft bg-popover px-3 py-2 text-xs text-ink-soft">
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
                      )}
                    </div>
                    {cardAt(i)}
                  </div>
                ))}
              </div>
              {borrowChip && <ChipRow label="Another option" chips={[borrowChip]} disabled={sending || signing} onPick={pickChip} />}
              <div role="status">
                {sending && <TypingDots />}
                {error &&
                  (error.refusal ? (
                    <div className="rounded-2xl rounded-bl-md bg-warn-soft px-3 py-2 text-[13px] leading-relaxed text-warn">
                      <div className="font-semibold">I can&apos;t do that here.</div>
                      <div className="mt-0.5">{error.text}</div>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">{error.text}</p>
                  ))}
              </div>
              {!sending && chips.length > 0 && <ChipRow label="Suggestions" chips={chips} disabled={signing} onPick={pickChip} />}
            </>
          )}
        </div>

        {canChat && view === "chat" && (
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
              className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-popover px-3 py-2.5 text-base text-ink placeholder:text-muted focus:border-[var(--focus)] focus:outline-none sm:min-h-10 sm:py-2 sm:text-sm"
            />
            <button
              type="submit"
              disabled={sending || signing || !input.trim()}
              aria-label="Send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand text-white transition-colors hover:bg-brand-strong disabled:bg-sunken disabled:text-muted sm:h-10 sm:w-10"
            >
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          </form>
        )}
      </div>
    </>
  );
}
