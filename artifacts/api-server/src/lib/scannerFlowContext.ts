/**
 * Scanner Layer 5 — options flow over a rolling wall-clock window (default 4h).
 *
 * Window length: {@link SCANNER_FLOW_DEFAULT_WINDOW_MS}, override with env
 * `SCANNER_FLOW_LAYER5_WINDOW_MS` (milliseconds, clamped 1h–48h) when tape is stale.
 *
 * Sources `options_flow_raw_trades` (Polygon tape / watcher / strategist backfill).
 * When the primary window is empty, {@link fetchScannerFlowContextForSymbols} retries a **24h**
 * cutoff, then `options_flow_exec_per_strike` session rollup, then `ticker_signal_snapshot.flow_summary`.
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

import { db, tickerSignalSnapshotTable } from "@workspace/db";
import { inArray, sql } from "@workspace/db";

export const SCANNER_FLOW_DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000;

const FALLBACK_WHEN_PRIMARY_EMPTY_MS = 24 * 60 * 60 * 1000;

const FLOW_WINDOW_MS_MIN = 60 * 60 * 1000;
/** Upper bound for env-driven window (7d). Larger windows are heavier on `options_flow_raw_trades`. */
const FLOW_WINDOW_MS_MAX = 7 * 24 * 60 * 60 * 1000;

/**
 * Override default 4h rolling window via `SCANNER_FLOW_LAYER5_WINDOW_MS` (milliseconds).
 * Clamped to 1h–7d. Use when `options_flow_raw_trades` lags (e.g. tape backfill stalls) so the
 * Flow panel can still surface recent prints without changing client code.
 */
export function resolveScannerFlowWindowMs(opts?: { windowMs?: number }): number {
  if (opts?.windowMs != null && Number.isFinite(opts.windowMs) && opts.windowMs > 0) {
    return Math.min(Math.max(opts.windowMs, FLOW_WINDOW_MS_MIN), FLOW_WINDOW_MS_MAX);
  }
  const raw = process.env.SCANNER_FLOW_LAYER5_WINDOW_MS;
  if (raw == null || raw === "") return SCANNER_FLOW_DEFAULT_WINDOW_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return SCANNER_FLOW_DEFAULT_WINDOW_MS;
  return Math.min(Math.max(n, FLOW_WINDOW_MS_MIN), FLOW_WINDOW_MS_MAX);
}

/** Universe-level stats for the same window as {@link fetchScannerFlowContextForSymbols}. */
export type ScannerFlowContextDiagnostics = {
  window_ms: number;
  cutoff_iso: string;
  rows_in_window: number;
  max_trade_ts_in_window: string | null;
};

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

/** Latest session date rollup from `options_flow_exec_per_strike` (rollup job from raw tape). */
async function fetchExecPerStrikeSessionRollup(
  uniq: string[],
  chainOiBySym: Map<string, number>,
): Promise<Map<string, ScannerFlowLayer5Wire | null>> {
  const out = new Map<string, ScannerFlowLayer5Wire | null>();
  for (const s of uniq) out.set(s, null);
  if (uniq.length === 0) return out;

  const inList = sql.join(uniq.map((s) => sql`${s}`), sql`, `);

  const rows = await db.execute(sql`
    WITH latest AS (
      SELECT underlying_symbol AS sym, MAX(date) AS d
      FROM options_flow_exec_per_strike
      WHERE underlying_symbol IN (${inList})
      GROUP BY underlying_symbol
    ),
    strike_roll AS (
      SELECT
        e.underlying_symbol AS sym,
        e.strike,
        e.option_type,
        e.expiration::text AS expiration,
        SUM(e.sweep_volume + e.block_volume + e.regular_volume)::double precision AS strike_vol
      FROM options_flow_exec_per_strike e
      INNER JOIN latest l ON l.sym = e.underlying_symbol AND e.date = l.d
      WHERE e.underlying_symbol IN (${inList})
      GROUP BY e.underlying_symbol, e.strike, e.option_type, e.expiration
    ),
    ranked AS (
      SELECT
        sym,
        strike,
        option_type,
        expiration,
        strike_vol,
        ROW_NUMBER() OVER (PARTITION BY sym ORDER BY strike_vol DESC, strike ASC, expiration ASC) AS rn
      FROM strike_roll
    ),
    tot AS (
      SELECT
        e.underlying_symbol AS sym,
        SUM(e.sweep_count)::int AS sweeps,
        SUM(e.block_count)::int AS blocks,
        SUM(e.sweep_volume + e.block_volume + e.regular_volume)::double precision AS vol
      FROM options_flow_exec_per_strike e
      INNER JOIN latest l ON l.sym = e.underlying_symbol AND e.date = l.d
      WHERE e.underlying_symbol IN (${inList})
      GROUP BY e.underlying_symbol
    )
    SELECT
      tot.sym,
      tot.sweeps,
      tot.blocks,
      tot.vol,
      rk.strike AS top_strike,
      rk.option_type AS top_type,
      rk.expiration AS top_exp,
      rk.strike_vol AS top_strike_vol
    FROM tot
    LEFT JOIN ranked rk ON rk.sym = tot.sym AND rk.rn = 1
    WHERE tot.vol > 0
  `);

  type TopKey = { sym: string; strike: number; exp: string; ot: string };
  const topKeys: TopKey[] = [];

  for (const row of (rows.rows ?? []) as Record<string, unknown>[]) {
    const sym = String(row.sym ?? "").toUpperCase();
    if (!sym) continue;
    const vol = numOrNull(row.vol) ?? 0;
    if (vol <= 0) continue;
    const strike = numOrNull(row.top_strike);
    const topVol = numOrNull(row.top_strike_vol) ?? 0;
    const otRaw = String(row.top_type ?? "call");
    const exp = String(row.top_exp ?? "");
    let top: ScannerFlowLayer5Wire["top_strike"] = null;
    let label: string | null = null;
    if (strike != null && exp.length > 0) {
      label = formatTopStrikeLabel(strike, otRaw);
      topKeys.push({ sym, strike, exp, ot: otRaw });
      top = {
        strike,
        option_type: parseOptionType(otRaw),
        expiration: exp.length >= 10 ? exp.slice(0, 10) : exp,
        volume_at_strike: Math.round(topVol),
        open_interest: null,
      };
    }
    const chainOi = chainOiBySym.get(sym) ?? 0;
    const volumeOverOi =
      chainOi > 0 && Number.isFinite(vol) ? Math.round((vol / chainOi) * 10_000) / 10_000 : null;

    out.set(sym, {
      blocks_4h: intOrZero(row.blocks),
      sweeps_4h: intOrZero(row.sweeps),
      net_delta_dollar: null,
      top_strike_label: label,
      top_strike: top,
      volume_4h: Math.round(vol),
      volume_over_oi: volumeOverOi,
    });
  }

  if (topKeys.length > 0) {
    const tupleSql = sql.join(
      topKeys.map((p) => sql`(${p.sym}::text, ${p.strike}::double precision, ${p.exp}::date, ${p.ot}::text)`),
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
    const oiBySym = new Map<string, number | null>();
    for (const row of (oiStrikeRows.rows ?? []) as Record<string, unknown>[]) {
      oiBySym.set(String(row.sym ?? "").toUpperCase(), row.oi != null ? intOrZero(row.oi) : null);
    }
    for (const sym of Array.from(out.keys())) {
      const w = out.get(sym);
      if (!w?.top_strike) continue;
      const oi = oiBySym.get(sym) ?? null;
      out.set(sym, { ...w, top_strike: { ...w.top_strike, open_interest: oi } });
    }
  }

  return out;
}

function parseFlowSummaryToWire(flowSummary: unknown): ScannerFlowLayer5Wire | null {
  if (flowSummary == null || typeof flowSummary !== "object" || Array.isArray(flowSummary)) return null;
  const f = flowSummary as Record<string, unknown>;
  const ask = numOrNull(f.ask_notional) ?? 0;
  const bid = numOrNull(f.bid_notional) ?? 0;
  const mid = numOrNull(f.mid_notional) ?? 0;
  const hasNotional = ask > 0 || bid > 0 || mid > 0;
  const tierRaw = f.tape_coverage_tier ?? f.tape_quality;
  const tier = typeof tierRaw === "string" ? tierRaw : "";
  const hasTier = tier !== "" && tier !== "not_run";

  const top = f.top_strike;
  let topStrike: ScannerFlowLayer5Wire["top_strike"] = null;
  let label: string | null = null;
  if (top && typeof top === "object" && !Array.isArray(top)) {
    const t = top as Record<string, unknown>;
    const strike = numOrNull(t.strike);
    if (strike != null && Number.isFinite(strike)) {
      const otRaw = String(t.type ?? "call");
      const expRaw = t.expiry != null ? String(t.expiry) : t.expiration != null ? String(t.expiration) : "";
      const expiration = expRaw.length >= 10 ? expRaw.slice(0, 10) : expRaw;
      label = formatTopStrikeLabel(strike, otRaw);
      topStrike = {
        strike,
        option_type: parseOptionType(otRaw),
        expiration,
        volume_at_strike: 0,
        open_interest: null,
      };
    }
  }

  if (!label && !hasNotional && !hasTier) return null;

  return {
    blocks_4h: null,
    sweeps_4h: null,
    net_delta_dollar: null,
    top_strike_label: label,
    top_strike: topStrike,
    volume_4h: null,
    volume_over_oi: null,
  };
}

async function fetchTickerSnapshotFlowFallback(uniq: string[]): Promise<Map<string, ScannerFlowLayer5Wire | null>> {
  const out = new Map<string, ScannerFlowLayer5Wire | null>();
  for (const s of uniq) out.set(s, null);
  if (uniq.length === 0) return out;

  const rows = await db
    .select({
      ticker: tickerSignalSnapshotTable.ticker,
      flowSummary: tickerSignalSnapshotTable.flowSummary,
    })
    .from(tickerSignalSnapshotTable)
    .where(inArray(tickerSignalSnapshotTable.ticker, uniq));

  for (const r of rows) {
    const sym = r.ticker.trim().toUpperCase();
    const wire = parseFlowSummaryToWire(r.flowSummary);
    if (wire) out.set(sym, wire);
  }
  return out;
}

/**
 * Single rolling cutoff: aggregate `options_flow_raw_trades` + diagnostics for that window.
 */
async function computeScannerFlowForWindow(
  uniq: string[],
  cutoffIso: string,
  underlyingPriceBySymbol: ReadonlyMap<string, number | null | undefined>,
  diagnosticsWindowMs: number,
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
        window_ms: diagnosticsWindowMs,
        cutoff_iso: cutoffIso,
        rows_in_window: 0,
        max_trade_ts_in_window: null,
      },
    };
  }

  const inList = sql.join(uniq.map((s) => sql`${s}`), sql`, `);

  const [aggRows, topRows, oiRows, windowDiagRows] = await Promise.all([
    db.execute(sql`
      SELECT
        underlying_symbol AS sym,
        COUNT(*) FILTER (WHERE is_block IS TRUE)::int AS blocks,
        COUNT(*) FILTER (WHERE is_sweep IS TRUE)::int AS sweeps,
        COALESCE(SUM(size), 0)::double precision AS vol_4h
      FROM options_flow_raw_trades
      WHERE underlying_symbol IN (${inList})
        AND timestamp IS NOT NULL
        AND timestamp >= ${cutoffIso}::timestamptz
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
        AND timestamp >= ${cutoffIso}::timestamptz
    `),
  ]);

  const diagRow = (windowDiagRows.rows ?? [])[0] as Record<string, unknown> | undefined;
  const maxTsRaw = diagRow?.max_trade_ts_in_window;
  const diagnostics: ScannerFlowContextDiagnostics = {
    window_ms: diagnosticsWindowMs,
    cutoff_iso: cutoffIso,
    rows_in_window: intOrZero(diagRow?.rows_in_window),
    max_trade_ts_in_window:
      maxTsRaw instanceof Date
        ? maxTsRaw.toISOString()
        : maxTsRaw != null && String(maxTsRaw).length > 0
          ? String(maxTsRaw)
          : null,
  };

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

  return { bySymbol: out, diagnostics };
}

export async function fetchScannerFlowContextForSymbols(
  symbols: string[],
  underlyingPriceBySymbol: ReadonlyMap<string, number | null | undefined>,
  opts?: { windowMs?: number },
): Promise<{
  bySymbol: Map<string, ScannerFlowLayer5Wire | null>;
  diagnostics: ScannerFlowContextDiagnostics;
}> {
  const windowMs = resolveScannerFlowWindowMs(opts);
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const emptyOut = new Map<string, ScannerFlowLayer5Wire | null>();
  for (const s of uniq) emptyOut.set(s, null);

  if (uniq.length === 0) {
    return {
      bySymbol: emptyOut,
      diagnostics: {
        window_ms: windowMs,
        cutoff_iso: new Date(Date.now() - windowMs).toISOString(),
        rows_in_window: 0,
        max_trade_ts_in_window: null,
      },
    };
  }

  const cutoffIsoPrimary = new Date(Date.now() - windowMs).toISOString();
  const primary = await computeScannerFlowForWindow(uniq, cutoffIsoPrimary, underlyingPriceBySymbol, windowMs);
  const out = primary.bySymbol;
  const diagnostics = primary.diagnostics;

  if (windowMs <= SCANNER_FLOW_DEFAULT_WINDOW_MS) {
    const missing24 = uniq.filter((s) => out.get(s) == null);
    if (missing24.length > 0) {
      const fbIso = new Date(Date.now() - FALLBACK_WHEN_PRIMARY_EMPTY_MS).toISOString();
      const fb = await computeScannerFlowForWindow(missing24, fbIso, underlyingPriceBySymbol, windowMs);
      for (const s of missing24) {
        const w = fb.bySymbol.get(s);
        if (w != null) out.set(s, w);
      }
    }
  }

  let missing = uniq.filter((s) => out.get(s) == null);
  if (missing.length > 0) {
    const chainOi = await fetchChainOiBySymbols(missing);
    const sessionMap = await fetchExecPerStrikeSessionRollup(missing, chainOi);
    for (const s of missing) {
      const w = sessionMap.get(s);
      if (w != null) out.set(s, w);
    }
  }

  missing = uniq.filter((s) => out.get(s) == null);
  if (missing.length > 0) {
    const snapMap = await fetchTickerSnapshotFlowFallback(missing);
    for (const s of missing) {
      const w = snapMap.get(s);
      if (w != null) out.set(s, w);
    }
  }

  return { bySymbol: out, diagnostics };
}
