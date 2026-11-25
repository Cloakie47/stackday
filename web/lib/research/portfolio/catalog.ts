import type { AssetClass } from "../types.ts";
import { universeAsset } from "../universe.ts";

/**
 * The Stackday assets a person can hold, as the portfolio check needs them. Built by the route from
 * web/lib/contracts.ts (which reads the deployment) and by tests from fixtures, so the analysis
 * itself stays pure. `lltv` is 0 for an invest-only asset (no lending market).
 */
export type CatalogAsset = {
  assetId: string;
  name: string;
  assetClass: AssetClass;
  /** Liquidation limit of the asset's lending market, 0.625 = 62.5%, or 0 when it cannot be borrowed against. */
  lltv: number;
};

export type Catalog = ReadonlyMap<string, CatalogAsset>;

/** Builds the catalog. Research assets keep the research name ("Bitcoin" rather than "cbBTC"). */
export function makeCatalog(assets: CatalogAsset[]): Catalog {
  return new Map(
    assets.map((a) => {
      const u = universeAsset(a.assetId);
      return [a.assetId, u ? { ...a, name: u.name, assetClass: u.assetClass } : a];
    }),
  );
}

/** True when the research universe (six borrowable assets) covers this asset. */
export const coveredByResearch = (assetId: string) => Boolean(universeAsset(assetId));
