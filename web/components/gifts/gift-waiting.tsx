"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { fmtUsdc } from "@/lib/format";
import { usePendingGifts } from "@/lib/gifts/useGifts";
import { useNames } from "@/lib/useAccount";
import { GiftBoxArt } from "./gift-box";

/** Home: "You have a gift to open" while this wallet has an unopened, unexpired gift. Renders nothing otherwise. */
export function GiftWaitingCard({ address }: { address: string }) {
  const { list, count } = usePendingGifts(address);
  const names = useNames(list.map((g) => g.sender));
  if (count === 0) return null;
  const first = list[0];
  const total = list.reduce((s, g) => s + g.usdc, 0n);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-3">
        <div className="gift-stage shrink-0" data-phase="idle">
          <GiftBoxArt small />
        </div>
        <div>
          <div className="text-sm font-medium">{count === 1 ? "You have a gift to open" : `You have ${count} gifts to open`}</div>
          <div className="mt-0.5 text-[13px] text-muted">
            {count === 1 ? `From ${names.display(first.sender)}, $${fmtUsdc(first.usdc)}` : `$${fmtUsdc(total)} in all`} · test USDC, bought into your vault when
            opened
          </div>
        </div>
      </div>
      <Link href="/gifts" className={buttonClass("primary", "md")}>
        Open
      </Link>
    </div>
  );
}

/** The count for the menu badge, or nothing when there is no gift to open. */
export function GiftBadge({ address }: { address?: string }) {
  const { count } = usePendingGifts(address);
  if (!count) return null;
  return (
    <span
      className="ml-auto mr-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white tabular-nums"
      aria-label={`${count} to open`}
    >
      {count}
    </span>
  );
}
