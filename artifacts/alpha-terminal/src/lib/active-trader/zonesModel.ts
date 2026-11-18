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
  /** Prior 0DTE expiry: walls/flip show `— rolls at open`. */
  wallsRollLabel?: string | null;
  /** Coincident UW walls at ATM. */
  gammaPinStrike?: number | null;
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
  let callWall: number | null = null;
  let putWall: number | null = null;
  let maxCallGex = 0;
  let maxPutAbs = 0;
  let netGex = 0;

  const gridSpots: number[] = [];
  for (let s = low; s <= high; s += spot * 0.002) gridSpots.push(s);
  const netBySpot: number[] = gridSpots.map((s) => {
    let n = 0;
    for (const r of rows) {
      if (r.strike < low || r.strike > high) continue;
      const cg = r.callGamma ?? 0;
      const pg = r.putGamma ?? 0;
      n += gexPerContract(cg * (s / spot), r.callOi, s, s, true);
      n += gexPerContract(pg * (s / spot), r.putOi, s, s, false);
    }
    return n;
  });

  for (const r of rows) {
    if (r.strike < low || r.strike > high) continue;
    const callG = gexPerContract(r.callGamma ?? 0, r.callOi, spot, spot, true);
    const putG = gexPerContract(r.putGamma ?? 0, r.putOi, spot, spot, false);
    netGex += callG + putG;
    if (callG > maxCallGex) {
      maxCallGex = callG;
      callWall = r.strike;
    }
    if (Math.abs(putG) > maxPutAbs) {
      maxPutAbs = Math.abs(putG);
      putWall = r.strike;
    }
  }

  let flip: number | null = null;
  for (let i = 1; i < netBySpot.length; i++) {
    const a = netBySpot[i - 1];
    const b = netBySpot[i];
    const crossed = (a < 0 && b > 0) || (a > 0 && b < 0);
    if (crossed) {
      flip = gridSpots[i];
      break;
    }
  }

  let env: GammaEnv = null;
  if (netGex !== 0) {
    const nearFlip = flip != null && Math.abs(spot - flip) <= spot * 0.002;
    if (nearFlip) env = "near_flip";
    else env = netGex > 0 ? "damping" : "amplifying";
  }

  if (callWall != null && putWall != null && callWall === putWall) {
    let altCall: number | null = null;
    let altPut: number | null = null;
    let altCallG = 0;
    let altPutAbs = 0;
    for (const r of rows) {
      if (r.strike < low || r.strike > high) continue;
      if (r.strike === callWall) continue;
      const callG = gexPerContract(r.callGamma ?? 0, r.callOi, spot, spot, true);
      const putG = gexPerContract(r.putGamma ?? 0, r.putOi, spot, spot, false);
      if (callG > altCallG) {
        altCallG = callG;
        altCall = r.strike;
      }
      if (Math.abs(putG) > altPutAbs) {
        altPutAbs = Math.abs(putG);
        altPut = r.strike;
      }
    }
    if (altCall != null) callWall = altCall;
    else if (altPut != null) putWall = altPut;
  }

  return {
    callWall,
    putWall,
    flip,
    netGexUsdPer1Pct: netGex,
    env,
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