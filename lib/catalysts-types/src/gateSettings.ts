/** User-tunable Catalysts tradeability gates (sidebar + API). */
export interface CatalystGateSettings {
  /** Master switch — when false, only the 10-day earnings window applies. */
  gatesEnabled: boolean;
  requireOptionsChain: boolean;
  stripLeveragedEtfs: boolean;
  requirePriceFloor: boolean;
  /** Minimum price when requirePriceFloor (0 = off). */
  priceFloorUsd: number;
  requireMicroCapFloor: boolean;
  /** Minimum market cap when requireMicroCapFloor (0 = off). */
  marketCapFloorUsd: number;
  requireVolumeFloor: boolean;
  /** Minimum average volume when requireVolumeFloor (0 = off). */
  avgVolumeFloor: number;
  /** Require 10 settled Schwab sessions for drift / vs S&P. */
  requireSessionSnapshot: boolean;
}

export const DEFAULT_CATALYST_GATE_SETTINGS: CatalystGateSettings = {
  gatesEnabled: true,
  requireOptionsChain: true,
  stripLeveragedEtfs: true,
  requirePriceFloor: true,
  priceFloorUsd: 5,
  requireMicroCapFloor: true,
  marketCapFloorUsd: 500_000_000,
  requireVolumeFloor: true,
  avgVolumeFloor: 500_000,
  requireSessionSnapshot: true,
};

export function normalizeCatalystGateSettings(
  raw: Partial<CatalystGateSettings> | null | undefined,
): CatalystGateSettings {
  const d = DEFAULT_CATALYST_GATE_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    gatesEnabled: raw.gatesEnabled ?? d.gatesEnabled,
    requireOptionsChain: raw.requireOptionsChain ?? d.requireOptionsChain,
    stripLeveragedEtfs: raw.stripLeveragedEtfs ?? d.stripLeveragedEtfs,
    requirePriceFloor: raw.requirePriceFloor ?? d.requirePriceFloor,
    priceFloorUsd: clampNum(raw.priceFloorUsd, d.priceFloorUsd, 0, 10_000),
    requireMicroCapFloor: raw.requireMicroCapFloor ?? d.requireMicroCapFloor,
    marketCapFloorUsd: clampNum(raw.marketCapFloorUsd, d.marketCapFloorUsd, 0, 1e12),
    requireVolumeFloor: raw.requireVolumeFloor ?? d.requireVolumeFloor,
    avgVolumeFloor: clampNum(raw.avgVolumeFloor, d.avgVolumeFloor, 0, 1e9),
    requireSessionSnapshot: raw.requireSessionSnapshot ?? d.requireSessionSnapshot,
  };
}

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
