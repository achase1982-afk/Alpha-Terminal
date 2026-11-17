import { db, deskSpxTapeTable } from "@workspace/db";
import { getDeskNormalizedTapeSince, registerDeskSpxSse } from "./deskStreamerTap.js";

export { registerDeskSpxSse, getDeskNormalizedTapeSince };

const lastPersisted = new Map<string, number>();

export async function deskPersistNormalizedTick(tick: {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  ts_ms: number;
}): Promise<void> {
  const prev = lastPersisted.get(tick.symbol) ?? 0;
  if (tick.ts_ms <= prev) return;
  lastPersisted.set(tick.symbol, tick.ts_ms);
  try {
    await db
      .insert(deskSpxTapeTable)
      .values({
        symbol: tick.symbol,
        ts: new Date(tick.ts_ms),
        last: tick.last,
        bid: tick.bid,
        ask: tick.ask,
      })
      .onConflictDoNothing({ target: [deskSpxTapeTable.symbol, deskSpxTapeTable.ts] });
  } catch {
    /* non-fatal */
  }
}

export function getDeskTapeSince(since?: string): ReturnType<typeof getDeskNormalizedTapeSince> {
  const sinceMs = since != null ? Date.parse(since) : undefined;
  return getDeskNormalizedTapeSince(
    sinceMs != null && Number.isFinite(sinceMs) ? sinceMs : undefined,
  );
}