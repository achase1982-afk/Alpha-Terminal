import { chainHasOpenInterest, type ChainRowForZones } from "./zonesModel";

export type AtWallProvenance = "uw" | "chain" | "fixture" | "none";

/** Hide chain-derived walls that are just spot placeholders with no OI backing. */
export function sanitizeGlanceWallStrike(
  wall: number | null,
  spot: number | null,
  provenance: AtWallProvenance,
  rows: ChainRowForZones[] | undefined,
): number | null {
  if (wall == null || !Number.isFinite(wall)) return null;
  if (provenance === "fixture" || provenance === "uw") return wall;
  if (provenance !== "chain") return wall;

  const hasOi = rows?.length ? chainHasOpenInterest(rows) : false;
  if (!hasOi) return null;
  if (spot != null && Math.abs(wall - spot) < 2.5) return null;
  return wall;
}