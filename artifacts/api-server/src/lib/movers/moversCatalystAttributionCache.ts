import type { MoversCatalystType } from "@workspace/movers-types";
import { db, moversCatalystCacheTable, eq } from "@workspace/db";

export type MoversCatalystAttribution = {
  catalystType: MoversCatalystType;
  catalystSummary: string;
};

/** Poll-path: use LLM-corrected type/summary when expand-time cache exists for this newsKey. */
export async function getCatalystAttributionFromCache(
  newsKey: string,
): Promise<MoversCatalystAttribution | null> {
  if (!newsKey) return null;
  const rows = await db
    .select({
      catalystType: moversCatalystCacheTable.catalystType,
      catalystSummary: moversCatalystCacheTable.catalystSummary,
    })
    .from(moversCatalystCacheTable)
    .where(eq(moversCatalystCacheTable.newsKey, newsKey))
    .limit(1);
  const row = rows[0];
  if (!row?.catalystType?.trim() || !row?.catalystSummary?.trim()) return null;
  return {
    catalystType: row.catalystType as MoversCatalystType,
    catalystSummary: row.catalystSummary.trim(),
  };
}
