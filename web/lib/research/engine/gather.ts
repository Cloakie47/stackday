import type { GatherFn } from "./run.ts";

/**
 * Where the engine gets each asset's facts. The data branch (gg/research-data) provides
 * `gatherAsset(assetId, date): Promise<AssetResearchInput>` in web/lib/research/data. Until it is
 * merged this placeholder is used, and the run route reports "data source not connected" instead
 * of running (so no model money is spent on empty input).
 *
 * After both branches merge, the swap is one line:
 *   import { gatherAsset } from "../data/index.ts";
 *   export const defaultGather: GatherFn | null = gatherAsset;
 */
export const defaultGather: GatherFn | null = null;
