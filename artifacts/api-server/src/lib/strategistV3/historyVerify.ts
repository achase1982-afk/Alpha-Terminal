import { db, eq, and, strategistHistoryTable } from "@workspace/db";
import { logger } from "../logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Confirm strategist_history row is readable before push (V2 parity). Max ~500ms. */
export async function verifyStrategistHistoryReadable(jobId: string): Promise<boolean> {
  const deadline = Date.now() + 500;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const rows = await db
        .select({ id: strategistHistoryTable.id })
        .from(strategistHistoryTable)
        .where(and(eq(strategistHistoryTable.jobId, jobId), eq(strategistHistoryTable.cleared, false)))
        .limit(1);
      if (rows[0]?.id != null) return true;
    } catch (err) {
      logger.warn({ err, jobId, attempt }, "StrategistV3: history verify read failed");
    }
    if (attempt >= 2) break;
    await sleep(200);
  }
  return false;
}
