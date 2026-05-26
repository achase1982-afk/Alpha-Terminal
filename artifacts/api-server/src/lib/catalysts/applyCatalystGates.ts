import type { CatalystGateSettings, CatalystTradeabilityRejectReason } from "@workspace/catalysts-types";
import type { FilteredName } from "@workspace/movers-types";
import type { FmpCompanyProfile } from "../movers/fmpCompanyProfile.js";
import type { TradeabilityCandidate } from "../movers/tradeabilityGate.js";

const LEV_TOKEN =
  /(\b\d(?:\.\d)?x\b|\bultra(?:pro)?\b|\bbull\s*\d?x\b|\bbear\b|\bleveraged\b|\binverse\b|daily\s+target)/i;
const LEV_ISSUER =
  /(direxion|graniteshares|proshares|microsectors|defiance|tradr|t-?rex|leverage\s*shares|kurv|axs|tidal)/i;

function toFiltered(
  c: TradeabilityCandidate,
  reason: CatalystTradeabilityRejectReason,
): FilteredName {
  return {
    symbol: c.symbol,
    name: c.name,
    price: c.price,
    changePct: c.changePct,
    reason,
  };
}

/**
 * Catalysts-specific tradeability gate (settings-driven; Movers gate stays unchanged).
 */
export function applyCatalystGates(
  candidates: TradeabilityCandidate[],
  profiles: Map<string, FmpCompanyProfile>,
  settings: CatalystGateSettings,
  symbolsWithOptions: Set<string>,
): { tradeable: TradeabilityCandidate[]; filtered: FilteredName[] } {
  if (!settings.gatesEnabled) {
    return { tradeable: [...candidates], filtered: [] };
  }

  const filtered: FilteredName[] = [];
  const tradeable: TradeabilityCandidate[] = [];

  for (const c of candidates) {
    const sym = c.symbol.toUpperCase();
    const profile = profiles.get(sym);

    if (settings.stripLeveragedEtfs) {
      const n = c.name ?? "";
      if (LEV_TOKEN.test(n) || LEV_ISSUER.test(n)) {
        filtered.push(toFiltered(c, "LEVERAGED_ETF"));
        continue;
      }
    }

    if (settings.requirePriceFloor && settings.priceFloorUsd > 0 && c.price < settings.priceFloorUsd) {
      filtered.push(toFiltered(c, "SUB_5"));
      continue;
    }

    if (settings.requireMicroCapFloor && settings.marketCapFloorUsd > 0) {
      const marketCap = profile?.marketCap ?? null;
      if (marketCap == null || !Number.isFinite(marketCap) || marketCap < settings.marketCapFloorUsd) {
        filtered.push(toFiltered(c, "MICRO_CAP"));
        continue;
      }
    }

    if (settings.requireVolumeFloor && settings.avgVolumeFloor > 0) {
      const avgVol = profile?.averageVolume ?? null;
      if (avgVol == null || !Number.isFinite(avgVol) || avgVol < settings.avgVolumeFloor) {
        filtered.push(toFiltered(c, "LOW_VOLUME"));
        continue;
      }
    }

    if (settings.requireOptionsChain && !symbolsWithOptions.has(sym)) {
      filtered.push(toFiltered(c, "NO_OPTIONS"));
      continue;
    }

    tradeable.push(c);
  }

  return { tradeable, filtered };
}
