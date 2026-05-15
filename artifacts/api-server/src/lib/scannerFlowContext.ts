/**
 * Scanner Layer 5 — options flow for the **current US equity RTH session to date**
 * (09:30–16:00 America/New_York, trading days only; outside that interval → no flow window).
 *
 * Sources `options_flow_raw_trades` (Polygon tape / watcher / strategist backfill).
 * **No fallbacks:** no 24h widen, no `options_flow_exec_per_strike` rollup, no snapshot flow_summary.
 *
 * - **Blocks / sweeps**: persisted `is_block` / `is_sweep` flags from
 *   {@link classifyForFlowPersistence} (block = size ≥ 100 contracts and not a sweep;
 *   sweep = OPRA condition 219).
 * - **Net delta $**: Σ (aggressor sign × option delta × contracts × 100 × spot). Delta from
 *   `options_flow_per_strike` joined on session `date` + strike key; spot from caller quotes.
 * - **Top strike**: strike key with highest contract volume in the session window.
 * - **Volume**: total contracts (Σ size) in the window.
 * - **Volume / OI**: window volume ÷ sum of `open_interest` on the latest per-symbol
 *   `options_flow_per_strike` snapshot (chain-level OI).
 */

import { db } from "@workspace/db";
import { sql } from "@workspace/db";
import { dbNaiveUtcTimestampToIso } from "./dbNaiveUtcTimestampToIso.js";
import {
  getScannerRthSessionToDateWindow,
  type ScannerRthSessionInactiveReason,
} from "./scannerFlowSessionWindow.js";

/** @deprecated Legacy 4h default; scanner v3 no longer uses rolling wall-clock windows. */
export const SCANNER_FLOW_DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Diagnostics for the RTH session-to-date window (same bounds as symbol-events journal). */
export type ScannerFlowContextDiagnostics = {
  /** Milliseconds from session open to session end bound (0 when inactive). */
  window_ms: number;
  /** ISO lower bound of the flow query (RTH open) when active. */
  cutoff_iso: string;
  /** ISO upper bound (inclusive) when active. */
  session_end_iso: string;
  rows_in_window: number;
  max_trade_ts_in_window: string | null;
  session_active: boolean;
  session_date_et: string | null;
  session_inactive_reason: ScannerRthSessionInactiveReason | null;
};

export type ScannerFlowPrimaryEventType = "sweep" | "block";

export type ScannerFlowNetDirection = "bullish" | "bearish" | "mixed" | "neutral";

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
  /** Count of persisted `options_flow_raw_trades` rows in the session window (all prints). */
  events_today: number | null;
  primary_event_type: ScannerFlowPrimaryEventType | null;
  net_direction: ScannerFlowNetDirection;
  last_event_ts: string | null;
  sweep_count: number | null;
  block_count: number | null;
  largest_event_notional: number | null;
};

const NET_DIRECTION_USD_THRESHOLD = 5000;

export function primaryEventTypeFromSweepBlockCounts(sweeps: number, blocks: number): ScannerFlowPrimaryEventType | null {
  if (sweeps <= 0 && blocks <= 0) return null;
  if (sweeps >= blocks) return "sweep";
  return "block";
}

export function netDirectionFromEventsAndDelta(
  eventsToday: number,
  netDeltaDollar: number | null,
): ScannerFlowNetDirection {
  if (eventsToday === 0) return "neutral";
  if (netDeltaDollar != null && Number.isFinite(netDeltaDollar)) {
    if (netDeltaDollar > NET_DIRECTION_USD_THRESHOLD) return "bullish";
    if (netDeltaDollar < -NET_DIRECTION_USD_THRESHOLD) return "bearish";
  }
  return "mixed";
}

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

async function fetchChainOiBySymbols(uniq: string[]): Promise<Map<string, number>> {
  const chainOiBySym = new Map<string, number>();
  if (uniq.length === 0) return chainOiBySym;
  const inList = sql.join(uniq.map((s) => sql`${s}`), sql`, `);
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
  for (const row of (oiRows.rows ?? []) as Record<string, unknown>[]) {
    const sym = String(row.sym ?? "").toUpperCase();
    const oi = numOrNull(row.chain_oi) ?? 0;
    if (sym) chainOiBySym.set(sym, oi);
  }
  return chainOiBySym;
}

/**
 * Aggregate `options_flow_raw_trades` for [startIso, endIso] inclusive (timestamptz).
 */
async function computeScannerFlowForRange(
  uniq: string[],
  startIso: string,
  endIso: string,
  underlyingPriceBySymbol: ReadonlyMap<string, number | null | undefined>,
  sessionMeta: { session_date_et: string; window_ms: number },
): Promise<{
  bySymbol: Map<string, ScannerFlowLayer5Wire | null>;
  diagnostics: ScannerFlowContextDiagnostics;
}> {
  const out = new Map<string, ScannerFlowLayer5Wire | null>();
  for (const s of uniq) out.set(s, null);

  if (uniq.length === 0) {
    return {
      bySymbol: out,
      diagnostics: {
        window_ms: sessionMeta.window_ms,
        cutoff_iso: startIso,
        session_end_iso: endIso,
        rows_in_window: 0,
        max_trade_ts_in_window: null,
        session_active: true,
        session_date_et: sessionMeta.session_date_et,
        session_inactive_reason: null,
      },
    };
  }

  const inList = sql.join(uniq.map((s) => sql`${s}`), sql`, `);

  const [aggRows, topRows, oiRows, windowDiagRows] = await Promise.all([
    db.execute(sql`
      SELECT
        underlying_symbol AS sym,
        COUNT(*)::int AS events_today,
        COUNT(*) FILTER (WHERE is_block IS TRUE)::int AS blocks,
        COUNT(*) FILTER (WHERE is_sweep IS TRUE)::int AS sweeps,
        COALESCE(SUM(size), 0)::double precision AS vol_4h,
        MAX(timestamp) AS last_event_ts,
        MAX(notional)::double precision AS largest_event_notional
      FROM options_flow_raw_trades
      WHERE underlying_symbol IN (${inList})
        AND timestamp IS NOT NULL
        AND timestamp >= ${startIso}::timestamptz
        AND timestamp <= ${endIso}::timestamptz
      GROUP BY underlying_symbol
    `),
    db.execute(sql`
      WITH strike_vol AS (
        SELECT
          underlying_symbol AS sym,
          strike,
          option_type,
          expiration::text AS expiration,
          SUM(size)::double precision AS strike_vol
        FROM options_flow_raw_trades
        WHERE underlying_symbol IN (${inList})
          AND timestamp IS NOT NULL
          AND timestamp >= ${startIso}::timestamptz
          AND timestamp <= ${endIso}::timestamptz
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
    `),
    db.execute(sql`
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
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int AS rows_in_window,
        MAX(timestamp) AS max_trade_ts_in_window
      FROM options_flow_raw_trades
      WHERE underlying_symbol IN (${inList})
        AND timestamp IS NOT NULL
        AND timestamp >= ${startIso}::timestamptz
        AND timestamp <= ${endIso}::timestamptz
    `),
  ]);

  const diagRow = (windowDiagRows.rows ?? [])[0] as Record<string, unknown> | undefined;
  const maxTsRaw = diagRow?.max_trade_ts_in_window;
  const diagnostics: ScannerFlowContextDiagnostics = {
    window_ms: sessionMeta.window_ms,
    cutoff_iso: startIso,
    session_end_iso: endIso,
    rows_in_window: intOrZero(diagRow?.rows_in_window),
    max_trade_ts_in_window: dbNaiveUtcTimestampToIso(maxTsRaw),
    session_active: true,
    session_date_et: sessionMeta.session_date_et,
    session_inactive_reason: null,
  };

  const aggBySym = new Map<
    string,
    {
      blocks: number;
      sweeps: number;
      vol4h: number;
      events_today: number;
      last_event_ts: string | null;
      largest_event_notional: number | null;
    }
  >();
  for (const row of (aggRows.rows ?? []) as Record<string, unknown>[]) {
    const sym = String(row.sym ?? "").toUpperCase();
    if (!sym) continue;
    const vol = numOrNull(row.vol_4h) ?? 0;
    const last_event_ts = dbNaiveUtcTimestampToIso(row.last_event_ts);
    aggBySym.set(sym, {
      blocks: intOrZero(row.blocks),
      sweeps: intOrZero(row.sweeps),
      vol4h: vol,
      events_today: intOrZero(row.events_today),
      last_event_ts,
      largest_event_notional: numOrNull(row.largest_event_notional),
    });
  }

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
        AND t.timestamp IS NOT NULL
        AND t.timestamp >= ${startIso}::timestamptz
        AND t.timestamp <= ${endIso}::timestamptz
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

    const events_today = agg.events_today;
    const primary_event_type = primaryEventTypeFromSweepBlockCounts(agg.sweeps, agg.blocks);
    const net_direction = netDirectionFromEventsAndDelta(events_today, net_delta_dollar);

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
      events_today,
      primary_event_type,
      net_direction,
      last_event_ts: agg.last_event_ts,
      sweep_count: agg.sweeps,
      block_count: agg.blocks,
      largest_event_notional: agg.largest_event_notional,
    };

    out.set(sym, wire);
  }

  return { bySymbol: out, diagnostics };
}

function inactiveDiagnostics(reason: ScannerRthSessionInactiveReason): ScannerFlowContextDiagnostics {
  return {
    window_ms: 0,
    cutoff_iso: "",
    session_end_iso: "",
    rows_in_window: 0,
    max_trade_ts_in_window: null,
    session_active: false,
    session_date_et: null,
    session_inactive_reason: reason,
  };
}

export async function fetchScannerFlowContextForSymbols(
  symbols: string[],
  underlyingPriceBySymbol: ReadonlyMap<string, number | null | undefined>,
): Promise<{
  bySymbol: Map<string, ScannerFlowLayer5Wire | null>;
  diagnostics: ScannerFlowContextDiagnostics;
}> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const emptyOut = new Map<string, ScannerFlowLayer5Wire | null>();
  for (const s of uniq) emptyOut.set(s, null);

  const session = await getScannerRthSessionToDateWindow();
  if (!session.active) {
    return {
      bySymbol: emptyOut,
      diagnostics: inactiveDiagnostics(session.reason),
    };
  }

  const windowMs = Math.max(0, new Date(session.endIso).getTime() - new Date(session.startIso).getTime());
  return computeScannerFlowForRange(uniq, session.startIso, session.endIso, underlyingPriceBySymbol, {
    session_date_et: session.sessionDateEtYmd,
    window_ms: windowMs,
  });
}
