/**
 * Scanner Layer 5 — options flow over a rolling wall-clock window (default 4h).
 *
 * Sources `options_flow_raw_trades` (Polygon tape / watcher / strategist backfill).
 * - **Blocks / sweeps**: persisted `is_block` / `is_sweep` flags from
 *   {@link classifyForFlowPersistence} (block = size ≥ 100 contracts and not a sweep;
 *   sweep = OPRA condition 219).
 * - **Net delta $**: Σ (aggressor sign × option delta × contracts × 100 × spot). Delta from
 *   `options_flow_per_strike` joined on session `date` + strike key; spot from caller quotes.
 * - **Top strike**: strike key (strike + call/put + expiration) with highest contract volume
 *   in the window; label `$425C` / `$425P`.
 * - **Volume**: total contracts (Σ size) in the window.
 * - **Volume / OI**: window volume ÷ sum of `open_interest` on the latest per-symbol
 *   `options_flow_per_strike` snapshot (chain-level OI).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const SCANNER_FLOW_DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Wire shape merged onto GET /api/scanner/v3/universe cards (`flow` field). */
export type ScannerFlowLayer5Wire = {
  blocks_4h: number | null;
  sweeps_4h: number | null;
  net_delta_dollar: number | null;
  top_strike_label: string | null;
  top_strike: {
    strike: number;
    option_type: "call" | "put";
    expiration: string;
    volume_at_strike: number;
    open_interest: number | null;
  } | null;
  volume_4h: number | null;
  volume_over_oi: number | null;
};

function formatTopStrikeLabel(strike: number, optionType: string): string {
  const ot = optionType === "put" ? "put" : "call";
  const strikeStr = Number.isInteger(strike) ? String(strike) : strike.toFixed(2).replace(/\.?0+$/, "");
  const suffix = ot === "call" ? "C" : "P";
  return `$${strikeStr}${suffix}`;
}

function parseOptionType(raw: string): "call" | "put" {
  return raw === "put" ? "put" : "call";
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function intOrZero(v: unknown): number {
  const n = numOrNull(v);
  return n != null ? Math.trunc(n) : 0;
}

/**
 * Per-symbol flow metrics. Returns `null` for symbols with no qualifying prints in the window.
 */
export async function fetchScannerFlowContextForSymbols(
  symbols: string[],
  underlyingPriceBySymbol: ReadonlyMap<string, number | null | undefined>,
  opts?: { windowMs?: number },
): Promise<Map<string, ScannerFlowLayer5Wire | null>> {
  const windowMs = opts?.windowMs ?? SCANNER_FLOW_DEFAULT_WINDOW_MS;
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, ScannerFlowLayer5Wire | null>();
  for (const s of uniq) out.set(s, null);

  if (uniq.length === 0) return out;

  const cutoff = new Date(Date.now() - windowMs);
  const cutoffIso = cutoff.toISOString();
  const inList = sql.join(uniq.map((s) => sql`${s}`), sql`, `);

  // Narrow by `date` so scans use `options_flow_raw_trades_sym_date_ts_idx`
  // (underlying_symbol, date, timestamp). Session `date` can trail NY wall
  // calendar across weekends/holidays; widen the lower bound by 7 days.
  const rawFlowNyDateLo = sql`(LEAST(
    DATE(timezone('America/New_York', ${cutoffIso}::timestamptz)),
    DATE(timezone('America/New_York', CURRENT_TIMESTAMP))
  ) - 7)`;
  const rawFlowNyDateHi = sql`GREATEST(
    DATE(timezone('America/New_York', ${cutoffIso}::timestamptz)),
    DATE(timezone('America/New_York', CURRENT_TIMESTAMP))
  )`;

  const aggRows = await db.execute(sql`
    SELECT
      underlying_symbol AS sym,
      COUNT(*) FILTER (WHERE is_block IS TRUE)::int AS blocks,
      COUNT(*) FILTER (WHERE is_sweep IS TRUE)::int AS sweeps,
      COALESCE(SUM(size), 0)::double precision AS vol_4h
    FROM options_flow_raw_trades
    WHERE underlying_symbol IN (${inList})
      AND date BETWEEN ${rawFlowNyDateLo} AND ${rawFlowNyDateHi}
      AND timestamp IS NOT NULL
      AND timestamp >= ${cutoffIso}::timestamptz
    GROUP BY underlying_symbol
  `);

  const aggBySym = new Map<string, { blocks: number; sweeps: number; vol4h: number }>();
  for (const row of (aggRows.rows ?? []) as Record<string, unknown>[]) {
    const sym = String(row.sym ?? "").toUpperCase();
    if (!sym) continue;
    const vol = numOrNull(row.vol_4h) ?? 0;
    aggBySym.set(sym, {
      blocks: intOrZero(row.blocks),
      sweeps: intOrZero(row.sweeps),
      vol4h: vol,
    });
  }

  const topRows = await db.execute(sql`
    WITH strike_vol AS (
      SELECT
        underlying_symbol AS sym,
        strike,
        option_type,
        expiration::text AS expiration,
        SUM(size)::double precision AS strike_vol
      FROM options_flow_raw_trades
      WHERE underlying_symbol IN (${inList})
        AND date BETWEEN ${rawFlowNyDateLo} AND ${rawFlowNyDateHi}
        AND timestamp IS NOT NULL
        AND timestamp >= ${cutoffIso}::timestamptz
      GROUP BY underlying_symbol, strike, option_type, expiration
    ),
    ranked AS (
      SELECT
        sym,
        strike,
        option_type,
        expiration,
        strike_vol,
        ROW_NUMBER() OVER (PARTITION BY sym ORDER BY strike_vol DESC, strike ASC, expiration ASC) AS rn
      FROM strike_vol
    )
    SELECT sym, strike, option_type, expiration, strike_vol
    FROM ranked
    WHERE rn = 1
  `);

  const topBySym = new Map<
    string,
    { strike: number; option_type: string; expiration: string; strike_vol: number }
  >();
  for (const row of (topRows.rows ?? []) as Record<string, unknown>[]) {
    const sym = String(row.sym ?? "").toUpperCase();
    if (!sym) continue;
    const strike = numOrNull(row.strike);
    if (strike == null) continue;
    const strikeVol = numOrNull(row.strike_vol) ?? 0;
    topBySym.set(sym, {
      strike,
      option_type: String(row.option_type ?? "call"),
      expiration: String(row.expiration ?? ""),
      strike_vol: strikeVol,
    });
  }

  const oiRows = await db.execute(sql`
    WITH latest AS (
      SELECT underlying_symbol AS sym, MAX(date) AS d
      FROM options_flow_per_strike
      WHERE underlying_symbol IN (${inList})
      GROUP BY underlying_symbol
    )
    SELECT o.underlying_symbol AS sym, SUM(COALESCE(o.open_interest, 0))::double precision AS chain_oi
    FROM options_flow_per_strike o
    INNER JOIN latest l ON l.sym = o.underlying_symbol AND o.date = l.d
    WHERE o.underlying_symbol IN (${inList})
    GROUP BY o.underlying_symbol
  `);

  const chainOiBySym = new Map<string, number>();
  for (const row of (oiRows.rows ?? []) as Record<string, unknown>[]) {
    const sym = String(row.sym ?? "").toUpperCase();
    const oi = numOrNull(row.chain_oi) ?? 0;
    if (sym) chainOiBySym.set(sym, oi);
  }

  const priced = uniq.filter((s) => {
    const p = underlyingPriceBySymbol.get(s);
    return p != null && Number.isFinite(p) && p > 0;
  });

  const netBySym = new Map<string, number>();
  if (priced.length > 0) {
    const priceTuples = sql.join(
      priced.map((s) => {
        const px = underlyingPriceBySymbol.get(s)!;
        return sql`(${s}::text, ${px}::double precision)`;
      }),
      sql`, `,
    );
    const pricedIn = sql.join(priced.map((s) => sql`${s}`), sql`, `);

    const netRows = await db.execute(sql`
      WITH prices(sym, px) AS (VALUES ${priceTuples})
      SELECT
        t.underlying_symbol AS sym,
        SUM(
          (CASE
            WHEN t.side = 'ask' THEN 1::double precision
            WHEN t.side = 'bid' THEN -1::double precision
            ELSE 0::double precision
          END)
          * COALESCE(p.delta, 0)::double precision
          * COALESCE(t.size, 0)::double precision
          * 100.0::double precision
          * pr.px::double precision
        ) AS net_delta_dollar
      FROM options_flow_raw_trades t
      INNER JOIN prices pr ON pr.sym = t.underlying_symbol
      LEFT JOIN options_flow_per_strike p
        ON p.underlying_symbol = t.underlying_symbol
        AND p.date = t.date
        AND p.option_type = t.option_type
        AND p.strike = t.strike
        AND p.expiration = t.expiration
      WHERE t.underlying_symbol IN (${pricedIn})
        AND t.date BETWEEN ${rawFlowNyDateLo} AND ${rawFlowNyDateHi}
        AND t.timestamp IS NOT NULL
        AND t.timestamp >= ${cutoffIso}::timestamptz
      GROUP BY t.underlying_symbol
    `);

    for (const row of (netRows.rows ?? []) as Record<string, unknown>[]) {
      const sym = String(row.sym ?? "").toUpperCase();
      const n = numOrNull(row.net_delta_dollar);
      if (sym && n != null) netBySym.set(sym, n);
    }
  }

  const topOiKeys = [...topBySym.entries()].filter(([sym]) => (aggBySym.get(sym)?.vol4h ?? 0) > 0);
  const strikeOiBySym = new Map<string, number | null>();
  if (topOiKeys.length > 0) {
    const tupleSql = sql.join(
      topOiKeys.map(([sym, t]) => {
        return sql`(${sym}::text, ${t.strike}::double precision, ${t.expiration}::date, ${t.option_type}::text)`;
      }),
      sql`, `,
    );

    const oiStrikeRows = await db.execute(sql`
      WITH latest AS (
        SELECT underlying_symbol AS sym, MAX(date) AS d
        FROM options_flow_per_strike
        WHERE underlying_symbol IN (${inList})
        GROUP BY underlying_symbol
      ),
      wanted(sym, strike, expiration, option_type) AS (VALUES ${tupleSql})
      SELECT p.underlying_symbol AS sym, p.open_interest AS oi
      FROM options_flow_per_strike p
      INNER JOIN latest l ON l.sym = p.underlying_symbol AND p.date = l.d
      INNER JOIN wanted w
        ON w.sym = p.underlying_symbol
        AND w.strike = p.strike
        AND w.expiration = p.expiration
        AND w.option_type = p.option_type
    `);

    for (const row of (oiStrikeRows.rows ?? []) as Record<string, unknown>[]) {
      const sym = String(row.sym ?? "").toUpperCase();
      const oi = row.oi != null ? intOrZero(row.oi) : null;
      if (sym) strikeOiBySym.set(sym, oi);
    }
  }

  for (const sym of uniq) {
    const agg = aggBySym.get(sym);
    if (!agg || agg.vol4h <= 0) {
      out.set(sym, null);
      continue;
    }

    const top = topBySym.get(sym);
    const chainOi = chainOiBySym.get(sym) ?? 0;
    const volumeOverOi =
      chainOi > 0 && Number.isFinite(agg.vol4h) ? Math.round((agg.vol4h / chainOi) * 10_000) / 10_000 : null;

    const hasPrice =
      underlyingPriceBySymbol.get(sym) != null &&
      Number.isFinite(underlyingPriceBySymbol.get(sym)!) &&
      (underlyingPriceBySymbol.get(sym) as number) > 0;
    const netRaw = netBySym.get(sym);
    const net_delta_dollar = hasPrice && netRaw != null && Number.isFinite(netRaw) ? Math.round(netRaw * 100) / 100 : null;

    const topStrikeOi = strikeOiBySym.get(sym) ?? null;

    const wire: ScannerFlowLayer5Wire = {
      blocks_4h: agg.blocks,
      sweeps_4h: agg.sweeps,
      net_delta_dollar,
      top_strike_label: top ? formatTopStrikeLabel(top.strike, top.option_type) : null,
      top_strike: top
        ? {
            strike: top.strike,
            option_type: parseOptionType(top.option_type),
            expiration: top.expiration,
            volume_at_strike: Math.round(top.strike_vol),
            open_interest: topStrikeOi,
          }
        : null,
      volume_4h: Math.round(agg.vol4h),
      volume_over_oi: volumeOverOi,
    };

    out.set(sym, wire);
  }

  return out;
}
