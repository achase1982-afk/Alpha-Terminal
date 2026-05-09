/**
 * Resolve NBBO for options ingest using Polygon WS quote cache and/or Schwab LEVELONE_OPTIONS,
 * preferring the quote whose timestamp is closest to the trade within {@link FRESH_QUOTE_MAX_MS}.
 */
import { getNbbo } from "./polygonOptionsWs.js";
import { getOptionTick } from "./schwabStreamer.js";
import { parseOcc } from "./optionsFlowPersistence.js";
import { buildSchwabOptionStreamerKey } from "./schwabOptionOccKey.js";

export const FRESH_QUOTE_MAX_MS = 2000;

export interface FreshNbboSnapshot {
  bid: number;
  ask: number;
}

function score(tradeMs: number, quoteTs: number): number {
  return Math.abs(tradeMs - quoteTs);
}

/** Pick freshest NBBO within {@link FRESH_QUOTE_MAX_MS} of trade time (Polygon WS + Schwab cache). */
export function resolveFreshOptionNbbo(occRaw: string, tradeMs: number): FreshNbboSnapshot | null {
  const occ = occRaw.startsWith("O:") ? occRaw : `O:${occRaw}`;
  type Cand = { bid: number; ask: number; ts: number; delta: number };
  const cands: Cand[] = [];

  const poly = getNbbo(occ);
  if (poly && poly.bid > 0 && poly.ask > 0 && poly.ask >= poly.bid) {
    const delta = score(tradeMs, poly.ts);
    if (delta <= FRESH_QUOTE_MAX_MS) {
      cands.push({ bid: poly.bid, ask: poly.ask, ts: poly.ts, delta });
    }
  }

  const parsed = parseOcc(occ);
  if (parsed) {
    const schwabKey = buildSchwabOptionStreamerKey(
      parsed.underlying,
      parsed.expiration,
      parsed.strike,
      parsed.type === "call" ? "CALL" : "PUT",
    );
    if (schwabKey) {
      const tick = getOptionTick(schwabKey);
      const bid = tick?.bid;
      const ask = tick?.ask;
      if (
        tick &&
        typeof bid === "number" &&
        typeof ask === "number" &&
        bid > 0 &&
        ask > 0 &&
        ask >= bid
      ) {
        const delta = score(tradeMs, tick.ts);
        if (delta <= FRESH_QUOTE_MAX_MS) {
          cands.push({ bid, ask, ts: tick.ts, delta });
        }
      }
    }
  }

  if (cands.length === 0) return null;
  cands.sort((a, b) => a.delta - b.delta);
  const best = cands[0]!;
  return { bid: best.bid, ask: best.ask };
}
