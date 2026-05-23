import type { FilteredName, MoversFeed, Situation, TickerStat } from "@workspace/movers-types";
import type { FmpMoverRow } from "./fmpMoversClient.js";
import { stripMover } from "./stripMover.js";

function toTickerStat(row: FmpMoverRow): TickerStat {
  return {
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    price: row.price,
    changePct: row.changesPercentage,
  };
}

function toFiltered(row: FmpMoverRow, reason: FilteredName["reason"]): FilteredName {
  return {
    symbol: row.symbol,
    name: row.name,
    price: row.price,
    changePct: row.changesPercentage,
    reason,
  };
}

function singleSituation(row: FmpMoverRow): Situation {
  return {
    kind: "single",
    id: row.symbol,
    label: row.symbol,
    tickers: [toTickerStat(row)],
    catalystType: "PENDING",
    catalyst: null,
    read: null,
    posture: "PENDING",
    confidence: null,
  };
}

export function buildMoversFeedFromRows(rows: FmpMoverRow[], capturedAt = new Date()): MoversFeed {
  const detected = rows.length;
  const filtered: FilteredName[] = [];
  const survivors: FmpMoverRow[] = [];

  for (const row of rows) {
    const verdict = stripMover({ name: row.name, price: row.price });
    if (verdict.keep) {
      survivors.push(row);
    } else if (verdict.reason) {
      filtered.push(toFiltered(row, verdict.reason));
    }
  }

  survivors.sort((a, b) => Math.abs(b.changesPercentage) - Math.abs(a.changesPercentage));

  const situations = survivors.map(singleSituation);

  return {
    capturedAt: capturedAt.toISOString(),
    funnel: {
      detected,
      filtered: filtered.length,
      tradeable: survivors.length,
      situations: situations.length,
    },
    situations,
    flagged: [],
    filtered,
  };
}

/** Placeholder when no poll has been persisted yet (`capturedAt` is empty). */
export function emptyMoversFeed(): MoversFeed {
  return {
    capturedAt: "",
    funnel: { detected: 0, filtered: 0, tradeable: 0, situations: 0 },
    situations: [],
    flagged: [],
    filtered: [],
  };
}
