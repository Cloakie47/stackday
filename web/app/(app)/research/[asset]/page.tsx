import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AssetResearch } from "@/components/research/asset-research";
import { UNIVERSE } from "@/lib/research/universe";

/** Accepts the Stackday symbol (mAAPL) or the plain ticker (aapl), any case. */
function resolve(param: string) {
  const p = decodeURIComponent(param).toLowerCase();
  return UNIVERSE.find((a) => a.assetId.toLowerCase() === p || a.underlying.toLowerCase() === p);
}

export function generateStaticParams() {
  return UNIVERSE.map((a) => ({ asset: a.assetId }));
}

function Asset({ asset }: { asset: string }) {
  const u = resolve(asset);
  if (!u) notFound();
  return <AssetResearch assetId={u.assetId} />;
}

export default function AssetResearchPage({ params }: { params: Promise<{ asset: string }> }) {
  return (
    <Suspense fallback={<div aria-busy="true" className="skeleton h-40 w-full rounded-[18px]" />}>
      {params.then(({ asset }) => (
        <Asset asset={asset} />
      ))}
    </Suspense>
  );
}
