import type { GatherFn } from "./daily.ts";
import type { GatherMarketFn } from "./weekly.ts";

/**
 * Where the engine gets its data. The data branch (gg/research-data) provides
 * `gatherAsset(assetId, date): Promise<AssetResearchInput>` and a market-wide gatherer returning
 * `MarketResearchInput` in web/lib/research/data. Until it is merged these stay null, and the run
 * routes answer "data source not connected" instead of running (so no model money is spent on
 * empty input).
 *
 * After both branches merge, the swap is two lines, for example:
 *   import { gatherAsset, gatherMarket } from "../data/index.ts";
 *   export const defaultGather: GatherFn | null = gatherAsset;
 *   export const defaultGatherMarket: GatherMarketFn | null = gatherMarket;
 */
export const defaultGather: GatherFn | null = null;
export const defaultGatherMarket: GatherMarketFn | null = null;
