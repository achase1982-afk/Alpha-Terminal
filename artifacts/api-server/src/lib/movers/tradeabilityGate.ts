import type { FilteredName, TradeabilityRejectReason } from "@workspace/movers-types";
import { AVG_VOLUME_FLOOR } from "@workspace/movers-types";
import type { FmpMoverRow } from "./fmpMoversClient.js";
import type { FmpCompanyProfile } from "./fmpCompanyProfile.js";
import { isBelowMarketCapFloor } from "./stripMicroCap.js";
import { stripMover } from "./stripMover.js";

export interface TradeabilityCandidate {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
}

export function moverRowToCandidate(row: FmpMoverRow): TradeabilityCandidate {
  return {
    symbol: row.symbol,
    name: row.name,
    price: row.price,
    changePct: row.changesPercentage,
  };
}

function toFiltered(
  c: TradeabilityCandidate,
  reason: TradeabilityRejectReason,
): FilteredName {
  return {
    symbol: c.symbol,
    name: c.name,
    price: c.price,
    changePct: c.changePct,
    reason,
  };
}

export function applyTradeabilityGate(
  candidates: TradeabilityCandidate[],
  profiles: Map<string, FmpCompanyProfile>,
  options?: { requireOptionsChain?: boolean; symbolsWithOptions?: Set<string> },
): { tradeable: TradeabilityCandidate[]; filtered: FilteredName[] } {
  const filtered: FilteredName[] = [];
  const tradeable: TradeabilityCandidate[] = [];

  for (const c of candidates) {
    const verdict = stripMover({ name: c.name, price: c.price });
    if (!verdict.keep) {
      if (verdict.reason) filtered.push(toFiltered(c, verdict.reason));
      continue;
    }

    const profile = profiles.get(c.symbol.toUpperCase());
    const marketCap = profile?.marketCap ?? null;
    if (isBelowMarketCapFloor(marketCap)) {
      filtered.push(toFiltered(c, "MICRO_CAP"));
      continue;
    }

    const avgVol = profile?.averageVolume ?? null;
    if (avgVol == null || !Number.isFinite(avgVol) || avgVol < AVG_VOLUME_FLOOR) {
      filtered.push(toFiltered(c, "LOW_VOLUME"));
      continue;
    }

    if (options?.requireOptionsChain) {
      const sym = c.symbol.toUpperCase();
      if (!options.symbolsWithOptions?.has(sym)) {
        filtered.push(toFiltered(c, "NO_OPTIONS"));
        continue;
      }
    }

    tradeable.push(c);
  }

  return { tradeable, filtered };
}
