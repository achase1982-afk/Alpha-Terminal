import { logger } from "./logger.js";

/** IV removal reason keys (chain contamination filter). */
export type IvClampedReasonKey =
  | "sentinel"
  | "ceilingClamp"
  | "oneSidedMarket"
  | "pennyOption"
  | "invalidMid"
  | "spreadExceedsMid"
  | "noLiquidity"
  | "surfaceOutlier";

const DEV = process.env.NODE_ENV === "development";

function mapLegacyIvClampedReasonKey(key: string): IvClampedReasonKey {
  const legacy: Record<string, IvClampedReasonKey> = {
    wideSpread: "spreadExceedsMid",
    lowVolume: "noLiquidity",
    lowOi: "noLiquidity",
    deepOtm: "invalidMid",
  };
  const newKeys: Record<string, true> = {
    sentinel: true,
    ceilingClamp: true,
    oneSidedMarket: true,
    pennyOption: true,
    invalidMid: true,
    spreadExceedsMid: true,
    noLiquidity: true,
    surfaceOutlier: true,
  };
  if (newKeys[key]) return key as IvClampedReasonKey;
  if (legacy[key]) {
    if (DEV) {
      logger.warn({ legacyKey: key, mappedTo: legacy[key] }, "ivClampedReasons: deprecated legacy key — use new taxonomy");
    }
    return legacy[key]!;
  }
  if (DEV) {
    logger.warn({ key }, "ivClampedReasons: unknown reason key — mapping to noLiquidity");
  }
  return "noLiquidity";
}

/**
 * Merge historical / legacy reason counts into the current key set (backward compat for persisted payloads).
 */
export function normalizeIvClampedReasonsForPayload(
  raw: Record<string, number | undefined>,
): Record<IvClampedReasonKey, number> {
  const out: Record<IvClampedReasonKey, number> = {
    sentinel: 0,
    ceilingClamp: 0,
    oneSidedMarket: 0,
    pennyOption: 0,
    invalidMid: 0,
    spreadExceedsMid: 0,
    noLiquidity: 0,
    surfaceOutlier: 0,
  };
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "number" || v <= 0) continue;
    const nk = mapLegacyIvClampedReasonKey(k);
    out[nk] += v;
  }
  return out;
}
