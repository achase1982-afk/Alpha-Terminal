import type { GammaEnv, UwGammaZoneModel } from "./uwGammaZonesTypes.js";

export type { GammaEnv, UwGammaStrikeRow, UwGammaZoneModel } from "./uwGammaZonesTypes.js";
export { formatGexUsd } from "./uwGammaZonesTypes.js";

export function parseUwGammaAmount(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const n = Number(raw.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function parseUwStrikeRow(raw: unknown): { strike: number; callGammaOi: number; putGammaOi: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const strike = Number(o.strike ?? o.price);
  if (!Number.isFinite(strike)) return null;
  const callGammaOi = parseUwGammaAmount(o.call_gamma_oi);
  const putGammaOi = parseUwGammaAmount(o.put_gamma_oi);
  return { strike, callGammaOi, putGammaOi };
}

function gammaEnv(netGex: number, flip: number | null, spot: number | null): GammaEnv {
  if (!Number.isFinite(netGex) || netGex === 0) return null;
  const nearFlip = flip != null && spot != null && Math.abs(spot - flip) <= spot * 0.002;
  if (nearFlip) return "near_flip";
  return netGex > 0 ? "damping" : "amplifying";
}

/**
 * Derive glance GEX / walls / flip from UW `live_gamma_0dte` expiry-strike rows.
 * Parses string gamma fields; skips zero-filled far strikes for flip; walls from max call / put gamma OI.
 */
export function computeZonesFromUwGamma0dte(
  rawRows: unknown[],
  opts?: { spot?: number | null; asOfLabel?: string },
): UwGammaZoneModel {
  const asOfLabel = opts?.asOfLabel ?? "—";
  const spot = opts?.spot ?? null;

  const rows = rawRows.map(parseUwStrikeRow).filter((r): r is NonNullable<typeof r> => r != null);
  if (!rows.length) {
    return { callWall: null, putWall: null, flip: null, netGexUsdPer1Pct: null, env: null, asOfLabel };
  }

  let netGex = 0;
  let maxCall = -Infinity;
  let maxCallStrike: number | null = null;
  let minPut = Infinity;
  let minPutStrike: number | null = null;

  for (const r of rows) {
    netGex += r.callGammaOi + r.putGammaOi;
    if (r.callGammaOi > maxCall) {
      maxCall = r.callGammaOi;
      maxCallStrike = r.strike;
    }
    if (r.putGammaOi < minPut) {
      minPut = r.putGammaOi;
      minPutStrike = r.strike;
    }
  }

  const active = rows
    .filter((r) => r.callGammaOi !== 0 || r.putGammaOi !== 0)
    .sort((a, b) => a.strike - b.strike);

  const flipFromCumulative = (rows: typeof active): number | null => {
    let cumulative = 0;
    let prevCumSign: -1 | 1 | null = null;
    for (const row of rows) {
      cumulative += row.callGammaOi + row.putGammaOi;
      if (cumulative === 0) continue;
      const sign: -1 | 1 = cumulative > 0 ? 1 : -1;
      if (prevCumSign !== null && sign !== prevCumSign) return row.strike;
      prevCumSign = sign;
    }
    return null;
  };
  const flipFromPerStrike = (rows: typeof active): number | null => {
    let prevSign: -1 | 1 | null = null;
    for (const row of rows) {
      const net = row.callGammaOi + row.putGammaOi;
      if (net === 0) continue;
      const sign: -1 | 1 = net > 0 ? 1 : -1;
      if (prevSign !== null && sign !== prevSign) return row.strike;
      prevSign = sign;
    }
    return null;
  };

  let flip: number | null = null;
  if (active.length >= 2) {
    flip = flipFromCumulative(active) ?? flipFromPerStrike(active);
  }

  const hasGamma = active.length > 0 && Number.isFinite(netGex) && netGex !== 0;
  if (!hasGamma) {
    return { callWall: null, putWall: null, flip: null, netGexUsdPer1Pct: null, env: null, asOfLabel };
  }

  return {
    callWall: maxCallStrike,
    putWall: minPutStrike,
    flip,
    netGexUsdPer1Pct: netGex,
    env: gammaEnv(netGex, flip, spot),
    asOfLabel,
  };
}

/** Latest `live_gamma` minute row net (gamma_per_one_percent_move_oi). */
export function netGexFromUwLiveGammaRows(rawRows: unknown[]): number | null {
  if (!rawRows.length) return null;
  const last = rawRows[rawRows.length - 1];
  if (!last || typeof last !== "object") return null;
  const o = last as Record<string, unknown>;
  const v = parseUwGammaAmount(o.gamma_per_one_percent_move_oi);
  return v !== 0 ? v : null;
}