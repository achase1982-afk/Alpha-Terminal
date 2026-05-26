import type { CatalystOptionsChainVerdict } from "./catalystOptionsChainLive.js";
import type { FilteredName } from "@workspace/movers-types";
import type { FmpCompanyProfile } from "../movers/fmpCompanyProfile.js";
import { isBelowMarketCapFloor } from "../movers/stripMicroCap.js";
import type { TradeabilityCandidate } from "../movers/tradeabilityGate.js";

const LEV_TOKEN =
  /(\b\d(?:\.\d)?x\b|\bultra(?:pro)?\b|\bbull\s*\d?x\b|\bbear\b|\bleveraged\b|\binverse\b|daily\s+target)/i;
const LEV_ISSUER =
  /(direxion|graniteshares|proshares|microsectors|defiance|tradr|t-?rex|leverage\s*shares|kurv|axs|tidal)/i;

const PRICE_FLOOR = 5;
const AVG_VOLUME_FLOOR = 500_000;

function toFiltered(c: TradeabilityCandidate, reason: FilteredName["reason"]): FilteredName {
  return {
    symbol: c.symbol,
    name: c.name,
    price: c.price,
    changePct: c.changePct,
    reason,
  };
}

/** Cheap gates only — no live options network calls. */
export function applyCatalystCheapGates(
  candidates: TradeabilityCandidate[],
  profiles: Map<string, FmpCompanyProfile>,
): { survivors: TradeabilityCandidate[]; filtered: FilteredName[] } {
  const filtered: FilteredName[] = [];
  const survivors: TradeabilityCandidate[] = [];

  for (const c of candidates) {
    const sym = c.symbol.toUpperCase();
    const profile = profiles.get(sym);
    const n = c.name ?? "";

    if (LEV_TOKEN.test(n) || LEV_ISSUER.test(n)) {
      filtered.push(toFiltered(c, "LEVERAGED_ETF"));
      continue;
    }

    if (c.price < PRICE_FLOOR) {
      filtered.push(toFiltered(c, "SUB_5"));
      continue;
    }

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

    survivors.push(c);
  }

  return { survivors, filtered };
}

/** Live options verdict — only `no` removes the name; `unknown` keeps with unconfirmed tag. */
export function applyCatalystOptionsGate(
  survivors: TradeabilityCandidate[],
  optionsVerdicts: Map<string, CatalystOptionsChainVerdict>,
): {
  tradeable: TradeabilityCandidate[];
  filtered: FilteredName[];
  optionsStatusBySymbol: Map<string, CatalystOptionsChainVerdict>;
} {
  const filtered: FilteredName[] = [];
  const tradeable: TradeabilityCandidate[] = [];
  const optionsStatusBySymbol = new Map<string, CatalystOptionsChainVerdict>();

  for (const c of survivors) {
    const sym = c.symbol.toUpperCase();
    const verdict = optionsVerdicts.get(sym) ?? "unknown";
    optionsStatusBySymbol.set(sym, verdict);

    if (verdict === "no") {
      filtered.push(toFiltered(c, "NO_OPTIONS"));
      continue;
    }

    tradeable.push(c);
  }

  return { tradeable, filtered, optionsStatusBySymbol };
}
