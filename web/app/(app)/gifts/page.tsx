"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { GiftBoxArt, OpenGiftSheet, boxTypeOf, GiftNotices } from "@/components/gifts/gift-box";
import { SendGift } from "@/components/gifts/send-gift";
import { useViewer } from "@/components/providers";
import { AssetStack, Badge, Button, Card, Empty, Notice, PageHeader, PillTabs, Skeleton, TxStatus } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { GIFT_BOX, assetByToken, type Asset } from "@/lib/contracts";
import { fmtUsdc } from "@/lib/format";
import { buildDeclineCall, buildRevokeCall } from "@/lib/gifts/calls";
import { BOX_LABEL, KIND, giftLinkPrefill, type BoxType } from "@/lib/gifts/mix";
import { STATE_LABEL, expiresIn, giftState, type GiftState } from "@/lib/gifts/status";
import { useGifts, useNowSeconds, type Gift } from "@/lib/gifts/useGifts";
import { useNames, useSession } from "@/lib/useAccount";
import { usePortfolio } from "@/lib/usePortfolio";
import { useTx } from "@/lib/useTx";

type Tab = "received" | "sent" | "send";

const TONE: Record<GiftState, "neutral" | "brand" | "grow" | "warn" | "danger"> = {
  pending: "brand",
  expired: "warn",
  opened: "grow",
  revoked: "neutral",
  declined: "neutral",
  refunded: "neutral",
  none: "neutral",
};

function legAssets(g: Gift): Asset[] {
  return g.legs.map((l) => assetByToken(l.token)).filter((a): a is Asset => !!a);
}

function GiftRow({
  g,
  who,
  now,
  message,
  hideMix,
  actions,
}: {
  g: Gift;
  who: string;
  now: number;
  message?: string;
  hideMix: boolean;
  actions?: ReactNode;
}) {
  const state = giftState(g, now);
  const assets = legAssets(g);
  const [peek, setPeek] = useState(false);
  const showMix = !hideMix || peek;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="gift-stage shrink-0" data-phase="still">
          <GiftBoxArt small />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium tabular-nums">${fmtUsdc(g.usdc)}</span>
            <span className="truncate text-ink-soft">{who}</span>
            <Badge tone={TONE[state]}>{STATE_LABEL[state]}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{boxTypeOf(g)}</span>
            {hideMix && !peek && assets.length > 0 && (
              <button type="button" className="hit font-semibold text-ink underline" onClick={() => setPeek(true)}>
                Peek inside
              </button>
            )}
            {showMix && assets.length > 0 && (
              <>
                <AssetStack assets={assets} size={16} />
                <span className="truncate">{g.legs.map((l) => `${assetByToken(l.token)?.name ?? "?"} ${l.weightBps / 100}%`).join(", ")}</span>
              </>
            )}
            {g.kind === KIND.Research && g.legs.length === 0 && <span>mix picked when opened</span>}
            {state === "pending" && <span>expires {expiresIn(g.expiresAt, now)}</span>}
            <span className="font-mono">#{g.id.toString()}</span>
          </div>
          {message && <p className="mt-1 truncate text-xs italic text-ink-soft">&ldquo;{message}&rdquo;</p>}
        </div>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </li>
  );
}

type Prefill = { usdc?: string; box?: BoxType };

/** Reads ?usdc= and ?box= (the chat's gift card links here) and opens the Send tab with them. */
function GiftsFromUrl() {
  const q = useSearchParams();
  const prefill = giftLinkPrefill(q.get("usdc"), q.get("box"));
  return <Gifts key={`${prefill.usdc ?? ""}|${prefill.box ?? ""}`} prefill={prefill} />;
}

export default function GiftsPage() {
  return (
    <Suspense fallback={<Gifts prefill={{}} />}>
      <GiftsFromUrl />
    </Suspense>
  );
}

function Gifts({ prefill }: { prefill: Prefill }) {
  const fromLink = prefill.usdc !== undefined || prefill.box !== undefined;
  const viewer = useViewer();
  const me = viewer.address;
  const gifts = useGifts(me);
  const portfolio = usePortfolio(me);
  const session = useSession();
  const now = useNowSeconds();
  const tx = useTx();
  const names = useNames([...gifts.received.map((g) => g.sender), ...gifts.sent.map((g) => g.recipient)]);
  const [tab, setTab] = useState<Tab>(fromLink ? "send" : "received");
  // The gift being opened is kept here, outside the list, so the sheet stays while the list refreshes.
  const [opening, setOpening] = useState<Gift | null>(null);

  const pendingIn = gifts.received.filter((g) => giftState(g, now) === "pending");

  const canAct = viewer.canAct && !!GIFT_BOX;
  const signInForMessages = session.configured && !session.signedIn && (gifts.received.length > 0 || gifts.sent.length > 0);

  return (
    <>
      <PageHeader title="Gifts" lead="Send someone a box of stocks worth an amount of test USDC. They open it into their own vault." />

      {!GIFT_BOX && <Notice tone="warn">Gift boxes are not deployed on this network yet.</Notice>}
      {!me && <Notice>Connect a wallet to send and open gifts.</Notice>}

      <PillTabs<Tab>
        ariaLabel="Gifts"
        value={tab}
        onChange={setTab}
        options={[
          { value: "received", label: pendingIn.length ? `Received (${pendingIn.length})` : "Received" },
          { value: "sent", label: "Sent" },
          { value: "send", label: "Send a gift" },
        ]}
      />

      {signInForMessages && tab !== "send" && (
        <Notice>
          Messages are kept private.{" "}
          <button type="button" className="font-semibold underline" onClick={() => session.signIn()} disabled={session.busy}>
            Sign in with your wallet
          </button>{" "}
          to read them (a free signature).
        </Notice>
      )}

      {tab === "received" && (
        <Card title="Received" tip="Gifts sent to this wallet. Opening buys the mix straight into your own vault, as free stock you can sell or withdraw.">
          {gifts.loading ? (
            <Skeleton className="h-16" />
          ) : gifts.received.length === 0 ? (
            <Empty>No gifts yet. Share your {BRAND.name} ID so friends can send you one.</Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {gifts.received.map((g) => {
                const state = giftState(g, now);
                return (
                  <GiftRow
                    key={g.id.toString()}
                    g={g}
                    who={`from ${names.display(g.sender)}`}
                    now={now}
                    message={gifts.messages[g.id.toString()]}
                    hideMix={state === "pending"}
                    actions={
                      state === "pending" && canAct ? (
                        <>
                          <Button size="sm" variant="secondary" disabled={tx.state.busy} onClick={() => tx.run([buildDeclineCall(GIFT_BOX!, g.id)], "Declined. The USDC went back to the sender.")}>
                            Decline
                          </Button>
                          <Button size="sm" onClick={() => setOpening(g)}>
                            Open
                          </Button>
                        </>
                      ) : undefined
                    }
                  />
                );
              })}
            </ul>
          )}
          <TxStatus state={tx.state} />
        </Card>
      )}

      {tab === "sent" && (
        <Card title="Sent" tip="Until a gift is opened you can take it back. Unopened gifts come back to you on their own after they expire (the keeper refunds them daily on weekdays).">
          {gifts.loading ? (
            <Skeleton className="h-16" />
          ) : gifts.sent.length === 0 ? (
            <Empty>You have not sent a gift yet.</Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {gifts.sent.map((g) => {
                const state = giftState(g, now);
                return (
                  <GiftRow
                    key={g.id.toString()}
                    g={g}
                    who={`to ${names.display(g.recipient)}`}
                    now={now}
                    message={gifts.messages[g.id.toString()]}
                    hideMix={state === "pending"}
                    actions={
                      (state === "pending" || state === "expired") && canAct ? (
                        <Button size="sm" variant="secondary" disabled={tx.state.busy} onClick={() => tx.run([buildRevokeCall(GIFT_BOX!, g.id)], "Taken back. The USDC is in your wallet again.")}>
                          {state === "expired" ? "Refund now" : "Revoke"}
                        </Button>
                      ) : undefined
                    }
                  />
                );
              })}
            </ul>
          )}
          <TxStatus state={tx.state} />
        </Card>
      )}

      {tab === "send" && (
        <div className="mx-auto w-full max-w-xl">
          {fromLink && (
            <Notice>
              Filled in from the chat: {[prefill.usdc && `${prefill.usdc} test USDC`, prefill.box && BOX_LABEL[prefill.box]].filter(Boolean).join(", ")}. Choose who the gift is for, then
              check and send.
            </Notice>
          )}
          <SendGift me={viewer.canAct ? me : undefined} walletUsdc={portfolio.walletUsdc} onSent={() => gifts.refetch()} initial={prefill} />
        </div>
      )}

      {tab !== "send" && <GiftNotices />}

      {opening && (
        <OpenGiftSheet
          key={opening.id.toString()}
          gift={opening}
          from={names.display(opening.sender)}
          message={gifts.messages[opening.id.toString()]}
          onClose={() => {
            setOpening(null);
            gifts.refetch();
          }}
        />
      )}
    </>
  );
}
