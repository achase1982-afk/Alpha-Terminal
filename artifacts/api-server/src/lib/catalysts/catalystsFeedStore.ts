import { desc, sql } from "drizzle-orm";
import type { CatalystsFeed } from "@workspace/catalysts-types";
import { emptyCatalystsFeed } from "@workspace/catalysts-types";
import { db, catalystsFeedTable } from "@workspace/db";
import { normalizeCatalystsFeedPayload } from "./normalizeCatalystsFeedPayload.js";

const CATALYSTS_FEED_RETENTION = 30;

export async function persistCatalystsFeed(feed: CatalystsFeed): Promise<void> {
  const builtAt = feed.builtAt ? new Date(feed.builtAt) : new Date();
  await db.insert(catalystsFeedTable).values({
    builtAt,
    payload: feed as unknown as Record<string, unknown>,
  });

  await db.execute(sql`
    DELETE FROM catalysts_feed
    WHERE id NOT IN (
      SELECT id FROM catalysts_feed
      ORDER BY built_at DESC
      LIMIT ${CATALYSTS_FEED_RETENTION}
    )
  `);
}

export async function getLatestCatalystsFeed(): Promise<CatalystsFeed> {
  const [row] = await db
    .select()
    .from(catalystsFeedTable)
    .orderBy(desc(catalystsFeedTable.builtAt))
    .limit(1);

  if (!row?.payload || typeof row.payload !== "object") {
    return emptyCatalystsFeed();
  }
  return normalizeCatalystsFeedPayload(row.payload as unknown as CatalystsFeed);
}
