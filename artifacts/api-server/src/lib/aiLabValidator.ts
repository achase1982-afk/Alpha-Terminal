import { getCorrelation, AI_LAB_CONFIG } from "./aiLabService.js";

// ─── CONFIGURABLE THRESHOLDS ────────────────────────────────────────────────
export const VALIDATION_CONFIG = {
  MAX_SPREAD_PCT: 0.10,
  MIN_OI_PER_LEG: 500,
  MIN_VOL_OI_RATIO: 0.10,
  MIN_DTE_OPTIONS: 5,
  MIN_AVG_VOLUME_STOCK: 500_000,
  MAX_ACTIVE_IDEAS: 5,
  MAX_SAME_SECTOR: 3,
  MAX_SAME_DIRECTION: 4,
  MAX_CORRELATION: 0.80,
  MAX_DATA_FRESHNESS_MINUTES: 30,
};

export interface TradeIdeaCandidate {
  symbol: string;
  direction: "LONG" | "SHORT";
  instrumentType: "STOCK" | "OPTIONS" | "STOCK+OPTIONS";
  optionStructureType?: string | null;
  legs?: Array<{
    legType: "CALL" | "PUT";
    side: "BUY" | "SELL";
    strike: number;
    expiration: string;
    quantity: number;
  }> | null;
  entrySpreadPct?: number | null;
  oiAtEntry?: number | null;
  volumeAtEntry?: number | null;
  volumeToOiRatio?: number | null;
  sector?: string | null;
  status?: string;
}

export interface ActiveIdea {
  symbol: string;
  direction: string;
  instrumentType: string;
  optionStructureType?: string | null;
  sector?: string | null;
  status: string;
}

export interface MarketDataSnapshot {
  avgVolume20d: number;
  dataFreshnessMinutes: number;
}

export interface ValidationResult {
  approved: boolean;
  rejectionReason?: string;
}

export async function validateAiLabIdea(
  candidate: TradeIdeaCandidate,
  activeIdeas: ActiveIdea[],
  marketData: MarketDataSnapshot,
): Promise<ValidationResult> {

  if (marketData.dataFreshnessMinutes > VALIDATION_CONFIG.MAX_DATA_FRESHNESS_MINUTES) {
    return { approved: false, rejectionReason: "STALE_DATA" };
  }

  const hasOptions = candidate.instrumentType === "OPTIONS" || candidate.instrumentType === "STOCK+OPTIONS";

  if (hasOptions) {
    if ((candidate.entrySpreadPct ?? 0) > VALIDATION_CONFIG.MAX_SPREAD_PCT) {
      return { approved: false, rejectionReason: "WIDE_SPREAD" };
    }

    if ((candidate.oiAtEntry ?? 0) < VALIDATION_CONFIG.MIN_OI_PER_LEG) {
      return { approved: false, rejectionReason: "LOW_OI" };
    }

    if ((candidate.volumeToOiRatio ?? 0) < VALIDATION_CONFIG.MIN_VOL_OI_RATIO) {
      return { approved: false, rejectionReason: "LOW_ACTIVITY" };
    }

    if (candidate.legs && candidate.legs.length > 0) {
      for (const leg of candidate.legs) {
        const expDate = new Date(leg.expiration);
        if (isNaN(expDate.getTime())) {
          return { approved: false, rejectionReason: "INVALID_EXPIRATION" };
        }
        const now = new Date();
        const dte = Math.round((expDate.getTime() - now.getTime()) / 86_400_000);
        if (dte < VALIDATION_CONFIG.MIN_DTE_OPTIONS) {
          return { approved: false, rejectionReason: "DTE_TOO_SHORT" };
        }
      }
    }
  }

  if (candidate.instrumentType === "STOCK") {
    if (marketData.avgVolume20d < VALIDATION_CONFIG.MIN_AVG_VOLUME_STOCK) {
      return { approved: false, rejectionReason: "LOW_LIQUIDITY" };
    }
  }

  const active = activeIdeas.filter(i => i.status === "ACTIVE" || i.status === "NEW");

  if (active.length >= VALIDATION_CONFIG.MAX_ACTIVE_IDEAS) {
    return { approved: false, rejectionReason: "MAX_ACTIVE_REACHED" };
  }

  const sectorCount = active.filter(i => i.sector && i.sector === candidate.sector).length;
  if (candidate.sector && sectorCount >= VALIDATION_CONFIG.MAX_SAME_SECTOR) {
    return { approved: false, rejectionReason: "SECTOR_CONCENTRATION" };
  }

  const longCount = active.filter(i => i.direction === "LONG").length + (candidate.direction === "LONG" ? 1 : 0);
  const shortCount = active.filter(i => i.direction === "SHORT").length + (candidate.direction === "SHORT" ? 1 : 0);
  if (longCount > VALIDATION_CONFIG.MAX_SAME_DIRECTION) {
    return { approved: false, rejectionReason: "DIRECTION_SKEW" };
  }
  if (shortCount > VALIDATION_CONFIG.MAX_SAME_DIRECTION) {
    return { approved: false, rejectionReason: "DIRECTION_SKEW" };
  }

  for (const existing of active) {
    if (existing.symbol.toUpperCase() === candidate.symbol.toUpperCase()) {
      if (existing.direction === candidate.direction) {
        const sameStructure = existing.optionStructureType === candidate.optionStructureType;
        if (sameStructure || existing.instrumentType === candidate.instrumentType) {
          return { approved: false, rejectionReason: "DUPLICATE_IDEA" };
        }
      }
      if (existing.direction !== candidate.direction) {
        return { approved: false, rejectionReason: "CONTRADICTORY_IDEA" };
      }
    }
  }

  for (const existing of active) {
    if (existing.direction === candidate.direction && existing.symbol.toUpperCase() !== candidate.symbol.toUpperCase()) {
      const corr = await getCorrelation(candidate.symbol, existing.symbol);
      if (corr > VALIDATION_CONFIG.MAX_CORRELATION) {
        return { approved: false, rejectionReason: "HIGH_CORRELATION_DUPLICATE" };
      }
    }
  }

  return { approved: true };
}
