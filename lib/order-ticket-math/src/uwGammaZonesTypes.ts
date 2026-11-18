export type GammaEnv = "damping" | "amplifying" | "near_flip" | null;

export interface UwGammaStrikeRow {
  strike: number;
  callGammaOi: number;
  putGammaOi: number;
}

export interface UwGammaZoneModel {
  callWall: number | null;
  putWall: number | null;
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