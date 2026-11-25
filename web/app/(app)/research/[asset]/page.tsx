import { Suspense } from "react";
import { AssetResearch, NotCovered } from "@/components/research/asset-research";
import deployment from "@/lib/deployment.json";
import { UNIVERSE, checkResearchable } from "@/lib/research/universe";

/** Accepts the Stackday symbol (mAAPL) or the plain ticker (aapl), any case. */
function resolve(param: string) {
  const p = param.toLowerCase();
  return UNIVERSE.find((a) => a.assetId.toLowerCase() === p || a.underlying.toLowerCase() === p);
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function generateStaticParams() {
  return UNIVERSE.map((a) => ({ asset: a.assetId }));
}

function Asset({ asset }: { asset: string }) {
  const name = safeDecode(asset).slice(0, 40);
  const u = resolve(name);
  // Research covers borrowable assets only: anything else gets a clear "not covered" page.
  if (!u || !checkResearchable(u.assetId, deployment as Record<string, unknown>).ok) return <NotCovered asset={name} />;
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
