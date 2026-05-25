import { createHash } from "node:crypto";
import type { MoversCatalystType } from "@workspace/movers-types";
import { db, moversTier2CacheTable, eq, lt } from "@workspace/db";
import type { MoversNewsHeadline } from "./fmpMoversNews.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Tier2CacheEntry = {
  catalystType: MoversCatalystType;
  drivingHeadline: string;
};

/** Stable key from deduped headline titles only (not prices, % change, or dates). */
export function buildHeadlineSetKey(headlines: MoversNewsHeadline[]): string {
  const titles = [
    ...new Set(
      headlines
        .map((h) => h.title.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
  const raw = titles.join("\n");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

async function pruneOldTier2CacheEntries(): Promise<void> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  await db.delete(moversTier2CacheTable).where(lt(moversTier2CacheTable.createdAt, cutoff));
}

export async function getTier2CacheEntry(headlineSetKey: string): Promise<Tier2CacheEntry | null> {
  if (!headlineSetKey) return null;
  const rows = await db
    .select()
    .from(moversTier2CacheTable)
    .where(eq(moversTier2CacheTable.headlineSetKey, headlineSetKey))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    catalystType: row.catalystType as MoversCatalystType,
    drivingHeadline: row.drivingHeadline,
  };
}

export async function writeTier2CacheEntry(
  headlineSetKey: string,
  entry: Tier2CacheEntry,
): Promise<void> {
  await db
    .insert(moversTier2CacheTable)
    .values({
      headlineSetKey,
      catalystType: entry.catalystType,
      drivingHeadline: entry.drivingHeadline,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: moversTier2CacheTable.headlineSetKey,
      set: {
        catalystType: entry.catalystType,
        drivingHeadline: entry.drivingHeadline,
        createdAt: new Date(),
      },
    });
  await pruneOldTier2CacheEntries();
}
