import type { Action, Indicators, Levels } from "../types.ts";
import type { UniverseAsset } from "../universe.ts";

/**
 * Entry, target and stop, computed in code from daily price data (never by the model):
 * - entry  = last daily close
 * - stop   = nearest support between 1 and 3 ATR14 below the close, less a quarter ATR of room;
 *            otherwise 2 x ATR14 below the close
 * - target = nearest resistance between 1 and 6 ATR14 above the close; otherwise 3 x ATR14 above
 * Null when levels make no sense: no public price (SpaceX), cash-like funds (Treasuries), too
 * little data, or a "sell" suggestion (Stackday never sells short, so a sell has no entry).
 */

export function roundPrice(x: number): number {
  if (!Number.isFinite(x)) return x;
  const abs = Math.abs(x);
  const decimals = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

const fmt = (x: number) => String(roundPrice(x));
const valid = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

export function computeLevels(asset: UniverseAsset, daily: Indicators | undefined, action: Action): Levels | null {
  if (!asset.publicPrice || asset.risk === "cash-like" || action === "sell" || !daily) return null;
  const last = daily.last;
  const atr = daily.atr14;
  if (!valid(last) || !valid(atr) || atr >= last / 2) return null;

  const supports = (daily.support ?? []).filter((s) => valid(s) && s < last - atr && s >= last - 3 * atr).sort((a, b) => b - a);
  const resistances = (daily.resistance ?? []).filter((r) => valid(r) && r >= last + atr && r <= last + 6 * atr).sort((a, b) => a - b);

  const support = supports[0];
  const resistance = resistances[0];
  const stop = support !== undefined ? support - 0.25 * atr : last - 2 * atr;
  const target = resistance !== undefined ? resistance : last + 3 * atr;
  if (!(stop > 0) || !(stop < last) || !(target > last)) return null;

  const basis = [
    `entry = last daily close ${fmt(last)}`,
    support !== undefined
      ? `stop = nearest support ${fmt(support)} less 0.25 x ATR14 (${fmt(atr)})`
      : `stop = 2 x ATR14 (${fmt(atr)}) below the close`,
    resistance !== undefined ? `target = nearest resistance ${fmt(resistance)}` : `target = 3 x ATR14 above the close`,
  ].join("; ");

  return { entry: roundPrice(last), target: roundPrice(target), stop: roundPrice(stop), basis };
}
