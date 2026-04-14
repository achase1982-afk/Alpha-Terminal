import { getAiLabFullConfig } from "./aiLabConfig.js";

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
  dataTimestamp: number;
  availableExpirations?: string[];
}

export interface ValidationResult {
  approved: boolean;
  rejectionReason?: string;
}

const cooldownMap = new Map<string, number>();
const MAX_COOLDOWN_SIZE = 30;
const COOLDOWN_DURATION_MS = 24 * 60 * 60 * 1000;

export function isOnCooldown(symbol: string): boolean {
  const ts = cooldownMap.get(symbol.toUpperCase());
  if (!ts) return false;
  if (Date.now() - ts > COOLDOWN_DURATION_MS) {
    cooldownMap.delete(symbol.toUpperCase());
    return false;
  }
  return true;
}

export function addToCooldown(symbol: string): void {
  if (cooldownMap.size >= MAX_COOLDOWN_SIZE) {
    let oldestKey = "";
    let oldestTs = Infinity;
    for (const [k, v] of cooldownMap) {
      if (v < oldestTs) { oldestTs = v; oldestKey = k; }
    }
    if (oldestKey) cooldownMap.delete(oldestKey);
  }
  cooldownMap.set(symbol.toUpperCase(), Date.now());
}

export function getCooldownList(): Array<{ symbol: string; cooldownUntil: string }> {
  const result: Array<{ symbol: string; cooldownUntil: string }> = [];
  for (const [sym, ts] of cooldownMap) {
    const expiresAt = ts + COOLDOWN_DURATION_MS;
    if (Date.now() < expiresAt) {
      result.push({ symbol: sym, cooldownUntil: new Date(expiresAt).toISOString() });
    }
  }
  return result;
}

export async function validateAiLabIdea(
  candidate: TradeIdeaCandidate,
  activeIdeas: ActiveIdea[],
  marketData: MarketDataSnapshot,
): Promise<ValidationResult> {
  const cfg = getAiLabFullConfig();

  const dataAgeMinutes = (Date.now() - marketData.dataTimestamp) / 60_000;
  if (dataAgeMinutes > cfg.dataFreshnessMinutes) {
    return { approved: false, rejectionReason: "STALE_DATA" };
  }

  const hasOptions = candidate.instrumentType === "OPTIONS" || candidate.instrumentType === "STOCK+OPTIONS";

  if (hasOptions) {
    if ((candidate.entrySpreadPct ?? 0) > cfg.validatorMaxSpreadPct) {
      return { approved: false, rejectionReason: "WIDE_SPREAD" };
    }

    if ((candidate.oiAtEntry ?? 0) < cfg.validatorMinOiPerLeg) {
      return { approved: false, rejectionReason: "LOW_OI" };
    }

    if (candidate.legs && candidate.legs.length > 0 && marketData.availableExpirations && marketData.availableExpirations.length > 0) {
      const validDates = new Set(marketData.availableExpirations);
      for (const leg of candidate.legs) {
        if (!validDates.has(leg.expiration)) {
          return { approved: false, rejectionReason: "INVALID_EXPIRATION" };
        }
      }
    }
  }

  if (candidate.instrumentType === "STOCK") {
    if (marketData.avgVolume20d < cfg.validatorMinAvgVolumeStock) {
      return { approved: false, rejectionReason: "LOW_LIQUIDITY" };
    }
  }

  const active = activeIdeas.filter(i => i.status === "ACTIVE" || i.status === "NEW");

  if (active.length >= cfg.validatorMaxActiveIdeas) {
    return { approved: false, rejectionReason: "MAX_ACTIVE_REACHED" };
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

  return { approved: true };
}
