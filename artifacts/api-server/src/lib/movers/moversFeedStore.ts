import { desc, sql } from "drizzle-orm";
import type { MoversFeed } from "@workspace/movers-types";
import { db, moversFeedTable } from "@workspace/db";
import { MOVERS_FEED_RETENTION } from "./moversConfig.js";
import { emptyMoversFeed } from "./buildMoversFeed.js";

export async function persistMoversFeed(feed: MoversFeed): Promise<void> {
  const capturedAt = new Date(feed.capturedAt);
  await db.insert(moversFeedTable).values({
    capturedAt,
    payload: feed as unknown as Record<string, unknown>,
  });

  await db.execute(sql`
    DELETE FROM movers_feed
    WHERE id NOT IN (
      SELECT id FROM movers_feed
      ORDER BY captured_at DESC
      LIMIT ${MOVERS_FEED_RETENTION}
    )
  `);
}

export async function getLatestMoversFeed(): Promise<MoversFeed> {
  const [row] = await db
    .select()
    .from(moversFeedTable)
    .orderBy(desc(moversFeedTable.capturedAt))
    .limit(1);

  if (!row?.payload || typeof row.payload !== "object") {
    return emptyMoversFeed();
  }
  return row.payload as unknown as MoversFeed;
}
