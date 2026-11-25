"use client";

import { useEffect, useState } from "react";
import { erc20Abi } from "viem";
import { usePublicClient } from "wagmi";
import { AssetSelect } from "@/components/asset-select";
import { AssetIcon, Button, Card, Chip, Field, FieldLabel, Notice, Row, Segmented, TxStatus, cx, INPUT_TEXT } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { ASSETS, ADDR, GIFT_BOX, type Address } from "@/lib/contracts";
import { fmtUsdc, parseUsdc, shortAddr } from "@/lib/format";
import { buildCreateCalls, createdGiftId } from "@/lib/gifts/calls";
import {
  BOX_LABEL,
  EXPIRY_DAYS,
  MAX_LEGS,
  MESSAGE_MAX,
  amountProblem,
  expiryFrom,
  mixProblem,
  oneStockMix,
  ratiosToBps,
  recipientQuery,
  surpriseMix,
  type BoxType,
  type ExpiryDays,
  type MixLeg,
  type ResearchPick,
} from "@/lib/gifts/mix";
import { searchPeople, useNames, useSession, type Person } from "@/lib/useAccount";
import { useTx } from "@/lib/useTx";
import { GiftNotices } from "./gift-box";

type Recipient = { wallet: Address; uid: string | null; username: string | null };

/** Pick the recipient by Stackday ID (or name) through /api/people, or paste a wallet address. */
function RecipientPicker({ me, value, onChange }: { me?: string; value: Recipient | null; onChange: (r: Recipient | null) => void }) {
  const session = useSession();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [hint, setHint] = useState<string>();
  const [busy, setBusy] = useState(false);
  const names = useNames([value?.wallet]);
  const parsed = recipientQuery(q);
  const canSearch = session.configured && session.signedIn;

  async function find() {
    setHint(undefined);
    setPeople([]);
    if (parsed.kind === "wallet" && !canSearch) {
      if (me && parsed.q === me.toLowerCase()) return setHint("That is your own wallet. Gifts go to someone else.");
      return onChange({ wallet: parsed.q as Address, uid: null, username: null });
    }
    if (parsed.kind === "none") return setHint("Type a Stackday ID like SD-7K3F9Q2M, a name, or a wallet address.");
    setBusy(true);
    try {
      const r = await searchPeople(parsed.q);
      setPeople(r.people);
      if (r.hint) setHint(r.hint);
      else if (r.people.length === 0) setHint(parsed.kind === "wallet" ? "No Stackday profile for that wallet. You can still send to it." : "Nobody found with that ID or name.");
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    const name = value.username ? `@${value.username}` : names.nameOf(value.wallet) ? `@${names.nameOf(value.wallet)}` : null;
    const uid = value.uid ?? names.idOf(value.wallet);
    return (
      <div>
        <FieldLabel htmlFor="gift-recipient-done" label="To" />
        <div id="gift-recipient-done" className="mt-1.5 flex items-center justify-between gap-3 rounded-xl border border-line bg-popover px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{name ?? "Wallet without a Stackday name"}</div>
            <div className="truncate text-xs text-muted">
              {uid ? <span className="font-mono">{uid} · </span> : null}
              <span className="font-mono">{value.wallet}</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FieldLabel htmlFor="gift-recipient" label="To" tip={`Their ${BRAND.name} ID is in their account menu. A wallet address works too.`} />
      <div className="mt-1.5 flex gap-2">
        <input
          id="gift-recipient"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), find())}
          placeholder={canSearch ? "SD-7K3F9Q2M, @name or 0x..." : "0x... wallet address"}
          autoComplete="off"
          spellCheck={false}
          className={cx("min-h-[42px] w-full min-w-0 rounded-xl border border-line bg-popover px-3.5 text-ink outline-none placeholder:text-faint", INPUT_TEXT)}
        />
        <Button variant="secondary" onClick={find} disabled={busy || !q.trim()}>
          {busy ? "Finding..." : "Find"}
        </Button>
      </div>
      {!session.loading && session.configured && !session.signedIn && (
        <p className="mt-1.5 text-xs text-muted">
          To look someone up by {BRAND.name} ID,{" "}
          <button type="button" className="font-semibold text-ink underline" onClick={() => session.signIn()} disabled={session.busy}>
            sign in with your wallet
          </button>{" "}
          (a free signature). A wallet address works without it.
        </p>
      )}
      {!session.loading && !session.configured && (
        <p className="mt-1.5 text-xs text-muted">The account database is not connected here, so paste the recipient&apos;s wallet address.</p>
      )}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
      {people.length > 0 && (
        <ul className="mt-2 divide-y divide-line-soft rounded-xl border border-line bg-popover">
          {people.map((p) => (
            <li key={p.wallet}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2 text-left hover:bg-hover"
                onClick={() => onChange({ wallet: p.wallet as Address, uid: p.uid, username: p.username })}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.username ? `@${p.username}` : "No name yet"}</span>
                  <span className="block truncate font-mono text-xs text-muted">
                    {p.uid ?? ""} · {shortAddr(p.wallet)}
                  </span>
                </span>
                <span className="text-xs font-semibold text-brand-ink">Choose</span>
              </button>
            </li>
          ))}
          {parsed.kind === "wallet" && !people.some((p) => p.wallet.toLowerCase() === parsed.q) && (
            <li>
              <button type="button" className="min-h-11 w-full px-3.5 py-2 text-left text-[13px] hover:bg-hover" onClick={() => onChange({ wallet: parsed.q as Address, uid: null, username: null })}>
                Send to {shortAddr(parsed.q)} anyway
              </button>
            </li>
          )}
        </ul>
      )}
      {people.length === 0 && parsed.kind === "wallet" && canSearch && hint && (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => onChange({ wallet: parsed.q as Address, uid: null, username: null })}>
          Send to {shortAddr(parsed.q)}
        </Button>
      )}
    </div>
  );
}

/** My mix: tap assets (up to 6) and give each a share; the shares become whole percents adding to 100%. */
function MixPicker({ ratios, onChange }: { ratios: Record<string, string>; onChange: (r: Record<string, string>) => void }) {
  const chosen = Object.keys(ratios);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Assets in the mix">
        {ASSETS.map((a) => {
          const on = a.symbol in ratios;
          const full = !on && chosen.length >= MAX_LEGS;
          return (
            <button
              key={a.symbol}
              type="button"
              aria-pressed={on}
              disabled={full}
              onClick={() => {
                const next = { ...ratios };
                if (on) delete next[a.symbol];
                else next[a.symbol] = "";
                onChange(next);
              }}
              className={cx(
                "flex min-h-11 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[13px] font-medium transition-colors disabled:opacity-40 sm:min-h-9",
                on ? "border-[color-mix(in_srgb,var(--brand)_45%,transparent)] bg-brand-soft text-ink" : "border-line bg-popover text-ink-soft hover:bg-hover",
              )}
            >
              <AssetIcon asset={a} size={24} />
              {a.name}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        {chosen.length} of up to {MAX_LEGS}. Leave the shares empty to split evenly.
      </p>
      {chosen.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {chosen.map((symbol) => (
            <Field
              key={symbol}
              label={`${ASSETS.find((a) => a.symbol === symbol)?.name ?? symbol} share`}
              inputMode="decimal"
              placeholder="even"
              suffix="%"
              value={ratios[symbol]}
              onChange={(e) => onChange({ ...ratios, [symbol]: e.target.value.replace(/[^0-9.]/g, "") })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function legsFromRatios(ratios: Record<string, string>) {
  const entries = Object.entries(ratios);
  if (entries.length === 0) return { legs: null, error: "Pick at least one asset." };
  const typed = entries.some(([, v]) => v.trim() !== "");
  const parts = entries.map(([symbol, v]) => ({
    token: ASSETS.find((a) => a.symbol === symbol)!.token,
    ratio: typed ? Number(v) : 1,
  }));
  if (typed && parts.some((p) => !(p.ratio > 0))) return { legs: null, error: "Give every chosen asset a share above zero, or leave them all empty." };
  const r = ratiosToBps(parts);
  return r.ok ? { legs: r.value, error: null } : { legs: null, error: r.error };
}

/** One summary line per part, with the USDC each buys (rounded the way the contract splits it). */
function MixPreview({ legs, amount }: { legs: MixLeg[]; amount: bigint }) {
  return (
    <ul className="space-y-1">
      {legs.map((l) => {
        const a = ASSETS.find((x) => x.token.toLowerCase() === l.token.toLowerCase());
        return (
          <li key={l.token} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex items-center gap-2">
              <AssetIcon asset={a} size={20} />
              {a?.name}
            </span>
            <span className="tabular-nums text-muted">
              {l.weightBps / 100}%{amount > 0n ? ` · $${fmtUsdc((amount * BigInt(l.weightBps)) / 10_000n)}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Send a gift: recipient, amount (1 to 500 test USDC), box type, optional message and expiry, then
 * one signature flow (approve if needed, then GiftBox.create) through lib/useTx.ts.
 */
export function SendGift({ me, walletUsdc, onSent }: { me?: Address; walletUsdc: bigint; onSent?: () => void }) {
  const tx = useTx();
  const publicClient = usePublicClient();
  const session = useSession();
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [amt, setAmt] = useState("5");
  const [type, setType] = useState<BoxType>("one");
  const [single, setSingle] = useState(ASSETS[0].symbol);
  const [ratios, setRatios] = useState<Record<string, string>>({});
  const [surprise, setSurprise] = useState<MixLeg[]>([]);
  const [hideSurprise, setHideSurprise] = useState(false);
  const [message, setMessage] = useState("");
  const [days, setDays] = useState<ExpiryDays>(30);
  const [research, setResearch] = useState<{ pick: ResearchPick | null; reason?: string } | null>(null);
  const [sent, setSent] = useState<{ id: bigint | null; note?: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/gifts/research")
      .then((r) => r.json())
      .then((b) => live && setResearch(b))
      .catch(() => live && setResearch({ pick: null, reason: "Could not read the research right now." }));
    return () => {
      live = false;
    };
  }, []);

  const amount = parseUsdc(amt);
  const amountError = amt.trim() ? amountProblem(amount, me ? walletUsdc : undefined) : null;
  const mine = legsFromRatios(ratios);
  const legs: MixLeg[] | "research" | null =
    type === "one"
      ? oneStockMix(ASSETS.find((a) => a.symbol === single)!.token)
      : type === "mix"
        ? mine.legs
        : type === "surprise"
          ? surprise.length
            ? surprise
            : null
          : research?.pick
            ? "research"
            : null;
  const mixError = type === "mix" ? mine.error : type === "surprise" && !surprise.length ? "Shuffle to pick a surprise." : legs && legs !== "research" ? mixProblem(legs) : null;
  const messageNeedsSignIn = message.trim() !== "" && session.configured && !session.signedIn;
  const problem = !GIFT_BOX
    ? "Gift boxes are not deployed on this network."
    : !me
      ? "Connect your wallet first."
      : !recipient
        ? "Choose who the gift is for."
        : (amountProblem(amount, walletUsdc) ?? mixError ?? (legs ? null : (research?.reason ?? "There is no approved research to pick from yet.")));

  function pickType(t: BoxType) {
    setType(t);
    if (t === "surprise" && surprise.length === 0) setSurprise(surpriseMix(ASSETS.map((a) => a.token)));
  }

  async function send() {
    if (problem || !GIFT_BOX || !me || !recipient || !legs || !publicClient) return;
    setSent(null);
    let calls;
    try {
      const allowance = await publicClient.readContract({ address: ADDR.usdc, abi: erc20Abi, functionName: "allowance", args: [me, GIFT_BOX] });
      calls = buildCreateCalls({
        giftBox: GIFT_BOX,
        usdc: ADDR.usdc,
        sender: me,
        recipient: recipient.wallet,
        amount,
        expiresAt: expiryFrom(Math.floor(Date.now() / 1000), days),
        mix: legs,
        allowance,
      });
    } catch (e) {
      tx.reset();
      setSent({ id: null, note: e instanceof Error ? e.message : "Could not prepare the gift." });
      return;
    }
    const hash = await tx.run(calls, "Gift sent. It waits in the gift box until they open it.");
    if (typeof hash !== "string") return;
    let id: bigint | null = null;
    try {
      id = createdGiftId(GIFT_BOX, (await publicClient.getTransactionReceipt({ hash })).logs);
    } catch {
      /* the gift exists on chain either way; only the message needs the id */
    }
    let note: string | undefined;
    const text = message.trim();
    if (text && id !== null) {
      const res = await fetch("/api/gifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id.toString(), message: text }) }).catch(() => null);
      if (!res || !res.ok) {
        const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
        note = `The gift is sent, but the message was not saved: ${body.error ?? "network error"}`;
      }
    }
    setSent({ id, note });
    setMessage("");
    onSent?.();
  }

  return (
    <Card title="Send a gift" tip="Your USDC waits in the gift box contract until they open it. Then it buys the mix straight into their own vault. Until then you can take it back.">
      <div className="space-y-5">
        <RecipientPicker me={me} value={recipient} onChange={setRecipient} />

        <Field
          label="Amount"
          inputMode="decimal"
          suffix="test USDC"
          value={amt}
          onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))}
          hint={amountError ?? (me ? `1 to 500. In your wallet: $${fmtUsdc(walletUsdc)}` : "1 to 500 test USDC.")}
        />

        <div>
          <Segmented<BoxType>
            label="Box"
            value={type}
            onChange={pickType}
            options={(["one", "mix", "surprise", "research"] as BoxType[]).map((t) => ({ value: t, label: BOX_LABEL[t] }))}
          />
          <div className="mt-3">
            {type === "one" && <AssetSelect label="Stock" assets={ASSETS} value={single} onChange={setSingle} />}
            {type === "mix" && <MixPicker ratios={ratios} onChange={setRatios} />}
            {type === "surprise" && (
              <div className="space-y-2.5 rounded-2xl border border-line bg-popover p-3.5">
                <p className="text-[13px] text-ink-soft">A random mix of 2 to 4 assets with random shares, picked now in your browser.</p>
                {hideSurprise ? <p className="text-[13px] text-muted">Hidden: a surprise for you too.</p> : <MixPreview legs={surprise} amount={amount} />}
                <div className="flex flex-wrap items-center gap-2">
                  <Chip onClick={() => setSurprise(surpriseMix(ASSETS.map((a) => a.token)))}>Shuffle</Chip>
                  <Chip active={hideSurprise} onClick={() => setHideSurprise((h) => !h)}>
                    {hideSurprise ? "Show me the mix" : "Keep it a surprise for me too"}
                  </Chip>
                </div>
              </div>
            )}
            {type === "research" && (
              <div className="rounded-2xl border border-line bg-popover p-3.5 text-[13px] text-ink-soft">
                {research?.pick ? (
                  <>
                    The mix is picked from the newest approved {BRAND.name} weekly research at the moment they open it, from the six researched assets. Today it
                    would be:
                    <div className="mt-2.5">
                      <MixPreview
                        legs={research.pick.legs
                          .map((l) => ({ token: ASSETS.find((a) => a.symbol === l.assetId)?.token as Address, weightBps: l.weightBps }))
                          .filter((l) => !!l.token)}
                        amount={amount}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted">Picked by {BRAND.name} research on {research.pick.weekOf}, general research, not advice.</p>
                  </>
                ) : research ? (
                  (research.reason ?? "There is no approved research yet.")
                ) : (
                  "Reading the latest approved research..."
                )}
              </div>
            )}
            {type === "mix" && mixError && Object.keys(ratios).length > 0 && <p className="mt-2 text-xs text-danger">{mixError}</p>}
            {type === "mix" && mine.legs && <div className="mt-3 rounded-2xl border border-line bg-popover p-3.5"><MixPreview legs={mine.legs} amount={amount} /></div>}
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="gift-message" label="Message (optional)" />
          <textarea
            id="gift-message"
            maxLength={MESSAGE_MAX}
            rows={2}
            value={message}
            disabled={!session.configured}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={session.configured ? "Happy birthday!" : "Messages need the account database, which is not connected here."}
            className={cx("mt-1.5 w-full resize-none rounded-xl border border-line bg-popover px-3.5 py-2.5 text-ink outline-none placeholder:text-faint disabled:opacity-60", INPUT_TEXT)}
          />
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>{session.configured ? "Only you and the recipient can read it." : ""}</span>
            <span className="tabular-nums">
              {message.length}/{MESSAGE_MAX}
            </span>
          </div>
        </div>

        <Segmented<string>
          label="If it is not opened, it comes back to you after"
          value={String(days)}
          onChange={(v) => setDays(Number(v) as ExpiryDays)}
          options={EXPIRY_DAYS.map((d) => ({ value: String(d), label: `${d} days` }))}
        />

        <div className="rounded-2xl bg-press px-4 py-2">
          <Row label="They receive">{amount > 0n ? `$${fmtUsdc(amount)} of ${type === "research" ? "research-picked assets" : "assets"}, bought when opened` : "-"}</Row>
          <Row label="Fee">None</Row>
          <Row label="Until opened">You can take it back any time</Row>
        </div>

        {messageNeedsSignIn ? (
          <Button className="w-full" onClick={() => session.signIn()} disabled={session.busy}>
            {session.busy ? "Signing in..." : "Sign in to attach the message"}
          </Button>
        ) : (
          <Button className="w-full" size="lg" onClick={send} disabled={!!problem || tx.state.busy}>
            {tx.state.busy ? "Sending..." : amount > 0n ? `Send $${fmtUsdc(amount)} gift` : "Send gift"}
          </Button>
        )}
        {problem && recipient && <p className="text-center text-xs text-muted">{problem}</p>}
        <TxStatus state={tx.state} />
        {sent?.note && <Notice tone="warn">{sent.note}</Notice>}
        {sent && !sent.note && sent.id !== null && <Notice tone="grow">Gift number {sent.id.toString()} is wrapped. They will see it on their Home page.</Notice>}
        <GiftNotices />
      </div>
    </Card>
  );
}
