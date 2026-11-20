import type { GammaEnv, UwGammaStrikeRow, UwGammaZoneModel } from "./uwGammaZonesTypes.js";

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

function parseUwTimeMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw < 1e12 ? raw * 1000 : raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Date.parse(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseUwStrikeRow(raw: unknown): UwGammaStrikeRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const strike = Number(o.strike ?? o.price);
  if (!Number.isFinite(strike)) return null;
  return {
    strike,
    callGammaOi: parseUwGammaAmount(o.call_gamma_oi),
    putGammaOi: parseUwGammaAmount(o.put_gamma_oi),
    callGammaVol: parseUwGammaAmount(o.call_gamma_vol),
    putGammaVol: parseUwGammaAmount(o.put_gamma_vol),
    timeMs: parseUwTimeMs(o.time ?? o.timestamp ?? o.updated_at ?? o.as_of),
  };
}

type RankedRow = UwGammaStrikeRow & { seq: number };

function preferNewerGammaRow(row: RankedRow, prev: RankedRow): boolean {
  if (row.timeMs != null && prev.timeMs != null) {
    if (row.timeMs !== prev.timeMs) return row.timeMs > prev.timeMs;
    return row.seq >= prev.seq;
  }
  if (row.timeMs != null) return true;
  if (prev.timeMs != null) return false;
  return row.seq >= prev.seq;
}

/** Desk `live_gamma_0dte` repeats a strike through the session. Keep the newest print. */
export function newestUwGammaRowPerStrike(rows: UwGammaStrikeRow[]): UwGammaStrikeRow[] {
  const ranked: RankedRow[] = rows.map((row, seq) => ({ ...row, seq }));
  const byStrike = new Map<number, RankedRow>();
  for (const row of ranked) {
    const prev = byStrike.get(row.strike);
    if (!prev || preferNewerGammaRow(row, prev)) byStrike.set(row.strike, row);
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

function wallByAbs(rows: readonly UwGammaStrikeRow[], field: "callGammaOi" | "putGammaOi" | "callGammaVol" | "putGammaVol"): number | null {
  let bestMag = 0;
  let strike: number | null = null;
  for (const row of rows) {
    const mag = Math.abs(row[field]);
    if (mag > bestMag) {
      bestMag = mag;
      strike = row.strike;
    }
  }
  return strike;
}

/**
 * Strikes where cumulative net gamma (call OI + put OI), walking up the chain,
 * crosses or lands on zero. No per-strike sign change, and no strike outside this list.
 */
export function cumulativeNetGammaFlips(rows: readonly UwGammaStrikeRow[]): number[] {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  let cumulative = 0;
  let prevSign: -1 | 1 | null = null;
  const flips: number[] = [];
  for (const row of sorted) {
    cumulative += row.callGammaOi + row.putGammaOi;
    if (cumulative === 0) {
      if (prevSign !== null) flips.push(row.strike);
      prevSign = null;
      continue;
    }
    const sign: -1 | 1 = cumulative > 0 ? 1 : -1;
    if (prevSign !== null && sign !== prevSign) flips.push(row.strike);
    prevSign = sign;
  }
  return flips;
}

function pickFlipStrike(flips: number[], spotHint: number | null): number | null {
  if (!flips.length) return null;
  if (spotHint == null || !Number.isFinite(spotHint)) return flips[0] ?? null;
  const atOrBelow = flips.filter((s) => s <= spotHint);
  if (atOrBelow.length) return atOrBelow[atOrBelow.length - 1]!;
  return flips.reduce((best, s) => (Math.abs(s - spotHint) < Math.abs(best - spotHint) ? s : best));
}

function gammaEnv(netGex: number, flip: number | null, spot: number | null): GammaEnv {
  if (!Number.isFinite(netGex) || netGex === 0) return null;
  const nearFlip = flip != null && spot != null && Math.abs(spot - flip) <= spot * 0.002;
  if (nearFlip) return "near_flip";
  return netGex > 0 ? "damping" : "amplifying";
}

/**
 * Derive glance GEX / walls / flip from UW `live_gamma_0dte` expiry-strike rows.
 *
 * Walls read one field each, ranked by absolute gamma (put gamma is negative):
 * call OI, put OI, call volume, put volume. The same strike may be both walls.
 * Flip is the cumulative call+put OI zero cross in strike order. No cross → null
 * ("none in range" at the label).
 */
export function computeZonesFromUwGamma0dte(
  rawRows: unknown[],
  opts?: { spot?: number | null; asOfLabel?: string },
): UwGammaZoneModel {
  const asOfLabel = opts?.asOfLabel ?? "—";
  const spot = opts?.spot ?? null;
  const empty: UwGammaZoneModel = {
    callWall: null,
    putWall: null,
    callWallVol: null,
    putWallVol: null,
    flip: null,
    netGexUsdPer1Pct: null,
    env: null,
    asOfLabel,
  };

  const parsed = rawRows.map(parseUwStrikeRow).filter((r): r is UwGammaStrikeRow => r != null);
  const rows = newestUwGammaRowPerStrike(parsed);
  if (!rows.length) return empty;

  let netGex = 0;
  let hasGamma = false;
  for (const row of rows) {
    netGex += row.callGammaOi + row.putGammaOi;
    if (
      row.callGammaOi !== 0 ||
      row.putGammaOi !== 0 ||
      row.callGammaVol !== 0 ||
      row.putGammaVol !== 0
    ) {
      hasGamma = true;
    }
  }
  if (!hasGamma) return empty;

  const callWall = wallByAbs(rows, "callGammaOi");
  const putWall = wallByAbs(rows, "putGammaOi");
  const callWallVol = wallByAbs(rows, "callGammaVol");
  const putWallVol = wallByAbs(rows, "putGammaVol");
  const flip = pickFlipStrike(cumulativeNetGammaFlips(rows), spot);

  return {
    callWall,
    putWall,
    callWallVol,
    putWallVol,
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
