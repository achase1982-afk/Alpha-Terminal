import { listLiveBooks } from "../lib/journalHistory.js";
import { logger } from "../lib/logger.js";
import { getValidAccessToken } from "../lib/tokenStore.js";
import { excursionFromSamples } from "./excursion.js";
import {
  closeWatch,
  ensureWatch,
  flatPosition,
  loadOpenPositions,
  openWatches,
  pruneQuotes,
  quotesFor,
  unrealizedAtMid,
  writeQuote,
  type WatchLeg,
} from "./quotes.js";
import { marksFromPositions } from "./sync.js";

let timer: ReturnType<typeof setInterval> | null = null;
let sampling = false;

function watchLegs(raw: unknown): WatchLeg[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((leg) => {
    if (!leg || typeof leg !== "object") return [];
    const row = leg as Record<string, unknown>;
    const instrumentKey = String(row.instrumentKey ?? "");
    if (!instrumentKey) return [];
    const delta = Number(row.quantityDelta ?? 0);
    return [{
      instrumentKey,
      side: delta < 0 ? "short" as const : "long" as const,
      qty: Math.abs(delta) || 1,
      openPrice: Number(row.price ?? 0),
      multiplier: Number(row.multiplier ?? 1),
    }];
  });
}

export async function sampleOnce(now = new Date()): Promise<void> {
  if (sampling) return;
  sampling = true;
  try {
    const open = await loadOpenPositions();
    for (const position of open) {
      await ensureWatch({
        positionId: position.id,
        accountRef: position.accountRef,
        openedAt: position.openedAt,
        legs: watchLegs(position.legs),
        now,
      });
    }
    const token = getValidAccessToken("trader");
    const mids: Record<string, number> = {};
    if (token) {
      const books = await listLiveBooks(token);
      for (const book of books) {
        for (const mark of marksFromPositions(book.positions ?? [])) mids[mark.instrumentKey] = mark.mid;
      }
    }
    const watches = await openWatches();
    for (const watch of watches) {
      const flat = await flatPosition(watch.positionId);
      const priced = unrealizedAtMid(watch.legs, mids);
      if (token) {
        await writeQuote({
          positionId: watch.positionId,
          ts: now,
          valid: priced.valid,
          unrealized: priced.unrealized,
          legs: priced.quotes,
          source: "book",
        });
      }
      if (!flat) continue;
      const samples = await quotesFor(watch.positionId);
      await closeWatch(watch.positionId, flat.closedAt, excursionFromSamples({
        openedAt: watch.openedAt.toISOString(),
        closedAt: flat.closedAt.toISOString(),
        exitPnl: flat.grossPnl,
        startedLate: watch.startedLate,
        samples,
      }));
    }
    if (now.getUTCMinutes() === 0) await pruneQuotes(now);
  } catch {
    logger.warn("Position quote sample failed");
  } finally {
    sampling = false;
  }
}

export function startQuoteRecorder(): void {
  if (timer) return;
  void sampleOnce();
  timer = setInterval(() => {
    void sampleOnce();
  }, 60_000);
}
