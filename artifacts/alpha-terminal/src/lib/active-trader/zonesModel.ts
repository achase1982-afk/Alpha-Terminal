import { computeZonesFromUwGamma0dte } from "@workspace/order-ticket-math";

export type GammaEnv = "damping" | "amplifying" | "near_flip" | null;

export interface ZoneModel {
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  netGexUsdPer1Pct: number | null;
  env: GammaEnv;
  asOfLabel: string;
  /** e.g. `Closed · as of 4:15 PM` when session is closed. */
  glanceCaption?: string;
  /** Prior 0DTE expiry: walls and gamma flip show a dash until the session rolls. */
  wallsRollLabel?: string | null;
  /** `unusual_whales` is the gamma glance. `chain` is the local fallback. */
  levelSource?: "unusual_whales" | "chain";
  /** True only for a glance sample whose own timestamp is still inside the fresh window. */
  levelFresh?: boolean;
  /** Coincident UW walls at ATM. Current gamma math leaves both walls set instead. */
  gammaPinStrike?: number | null;
  /** Strike with the largest |call_gamma_vol|. */
  callWallVol?: number | null;
  /** Strike with the largest |put_gamma_vol|. */
  putWallVol?: number | null;
  staleExpiry?: boolean;
  dataExpiry?: string;
}

export interface ChainRowForZones {
  strike: number;
  callOi: number;
  putOi: number;
  callGamma: number | null;
  putGamma: number | null;
}

function gexPerContract(gamma: number, oi: number, spot: number, spotForScale: number, isCall: boolean): number {
  if (!gamma || !oi || !spotForScale) return 0;
  const raw = gamma * oi * 100 * spotForScale * spotForScale * 0.01;
  return isCall ? raw : -raw;
}

export function chainHasOpenInterest(rows: ChainRowForZones[]): boolean {
  return rows.some((r) => r.callOi > 0 || r.putOi > 0);
}

/**
 * Gamma flip from chain rows: the strike where cumulative net gamma
 * (call gamma x OI + put gamma x OI, put signed negative) crosses zero
 * in strike order. No cross returns null ("none in range").
 */
export function chainGammaFlip(rows: ChainRowForZones[], spot: number | null): number | null {
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;
  const perStrike = rows
    .map((r) => ({
      strike: r.strike,
      call_gamma_oi: gexPerContract(r.callGamma ?? 0, r.callOi, spot, spot, true),
      put_gamma_oi: gexPerContract(r.putGamma ?? 0, r.putOi, spot, spot, false),
    }))
    .filter((r) => r.call_gamma_oi !== 0 || r.put_gamma_oi !== 0);
  if (perStrike.length < 2) return null;
  return computeZonesFromUwGamma0dte(perStrike, { spot }).flip;
}

export function computeZoneModel(rows: ChainRowForZones[], spot: number | null): ZoneModel {
  const asOfLabel = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
    hour12: false,
  });
  if (!spot || rows.length === 0) {
    return { callWall: null, putWall: null, flip: null, netGexUsdPer1Pct: null, env: null, asOfLabel };
  }

  if (!chainHasOpenInterest(rows)) {
    return { callWall: null, putWall: null, flip: null, netGexUsdPer1Pct: null, env: null, asOfLabel };
  }

  const low = spot * 0.9;
  const high = spot * 1.1;
  const band = rows.filter((r) => r.strike >= low && r.strike <= high);
  const derived = computeZonesFromUwGamma0dte(
    band.map((r) => ({
      strike: r.strike,
      call_gamma_oi: gexPerContract(r.callGamma ?? 0, r.callOi, spot, spot, true),
      put_gamma_oi: gexPerContract(r.putGamma ?? 0, r.putOi, spot, spot, false),
    })),
    { spot, asOfLabel },
  );

  return {
    callWall: derived.callWall,
    putWall: derived.putWall,
    callWallVol: null,
    putWallVol: null,
    flip: derived.flip,
    netGexUsdPer1Pct: derived.netGexUsdPer1Pct,
    env: derived.env,
    asOfLabel,
  };
}

export function formatGexUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "\u2014";
  const sign = v >= 0 ? "+" : "\u2212";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${Math.round(abs)}`;
}