export type GammaEnv = "damping" | "amplifying" | "near_flip" | null;

export interface UwGammaStrikeRow {
  strike: number;
  callGammaOi: number;
  putGammaOi: number;
  callGammaVol: number;
  putGammaVol: number;
  /** Snapshot time, when the feed row has one. */
  timeMs: number | null;
}

export interface UwGammaZoneModel {
  /** Strike with the largest |call_gamma_oi|. */
  callWall: number | null;
  /** Strike with the largest |put_gamma_oi|. Put gamma is negative, so this is absolute. */
  putWall: number | null;
  /** Strike with the largest |call_gamma_vol|. */
  callWallVol?: number | null;
  /** Strike with the largest |put_gamma_vol|. */
  putWallVol?: number | null;
  flip: number | null;
  netGexUsdPer1Pct: number | null;
  env: GammaEnv;
  asOfLabel: string;
  glanceCaption?: string;
}

export function formatGexUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "\u2014";
  const sign = v >= 0 ? "+" : "\u2212";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${Math.round(abs)}`;
}
