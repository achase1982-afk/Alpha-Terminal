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
  /** Require 10 settled sessions for drift / vs S&P. */
  requireSessionSnapshot: boolean;
}

export const CATALYST_GATE_LIMITS = {
  priceFloorUsd: { min: 0, max: 500, step: 1 },
  /** Off (0) or $1B–$2T — slide to ~$500B–$1T+ for mega-cap-only earnings weeks. */
  marketCapFloorUsd: { min: 0, max: 2_000_000_000_000, step: 1_000_000_000 },
  avgVolumeFloor: { min: 0, max: 20_000_000, step: 10_000 },
} as const;

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
  const lim = CATALYST_GATE_LIMITS;
  return {
    gatesEnabled: raw.gatesEnabled ?? d.gatesEnabled,
    requireOptionsChain: raw.requireOptionsChain ?? d.requireOptionsChain,
    stripLeveragedEtfs: raw.stripLeveragedEtfs ?? d.stripLeveragedEtfs,
    requirePriceFloor: raw.requirePriceFloor ?? d.requirePriceFloor,
    priceFloorUsd: clampNum(raw.priceFloorUsd, d.priceFloorUsd, lim.priceFloorUsd.min, lim.priceFloorUsd.max),
    requireMicroCapFloor: raw.requireMicroCapFloor ?? d.requireMicroCapFloor,
    marketCapFloorUsd: clampNum(
      raw.marketCapFloorUsd,
      d.marketCapFloorUsd,
      lim.marketCapFloorUsd.min,
      lim.marketCapFloorUsd.max,
    ),
    requireVolumeFloor: raw.requireVolumeFloor ?? d.requireVolumeFloor,
    avgVolumeFloor: clampNum(
      raw.avgVolumeFloor,
      d.avgVolumeFloor,
      lim.avgVolumeFloor.min,
      lim.avgVolumeFloor.max,
    ),
    requireSessionSnapshot: raw.requireSessionSnapshot ?? d.requireSessionSnapshot,
  };
}

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function formatMarketCapFloorLabel(usd: number): string {
  if (usd <= 0) return "Off";
  if (usd >= 1_000_000_000_000) {
    const t = usd / 1_000_000_000_000;
    return `$${t % 1 === 0 ? t.toFixed(0) : t.toFixed(2)}T+`;
  }
  if (usd >= 1_000_000_000) {
    const b = usd / 1_000_000_000;
    return `$${b % 1 === 0 ? b.toFixed(0) : b.toFixed(1)}B+`;
  }
  if (usd >= 1_000_000) return `$${Math.round(usd / 1_000_000)}M+`;
  return `$${Math.round(usd / 1000)}K+`;
}

export function formatVolumeFloorLabel(n: number): string {
  if (n <= 0) return "Off";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M+`;
  if (n >= 1000) return `${Math.round(n / 1000)}K+`;
  return `${n}+`;
}
