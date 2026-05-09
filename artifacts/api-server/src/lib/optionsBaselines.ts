/**
 * optionsBaselines.ts
 *
 * Trailing baselines computed from `polygon_options_history` (Polygon flat
 * files). These power:
 *   - The deterministic scanner's flow-acceleration sub-score (Part 1.3)
 *   - The intraday volume breakout detector for the live watcher (Part 1.2)
 *   - The trailing-unusual-flow API endpoint (Part 1.4)
 *
 * Graceful degradation (Part 1.5):
 *   Every public function returns `null` (or 0 / empty map for batch
 *   variants) when fewer than MIN_HISTORY_DAYS of history exist for the
 *   target ticker(s). Callers must treat `null` as "no signal" — the
 *   existing Flow bucket falls back to its current behavior in that case.
 *
 * Performance:
 *   The `(ticker, trade_date)` composite index added in lib/db/schema is
 *   required. A 130-ticker batch baseline query runs in <100ms; without
 *   the index, it would seq-scan ~1.7M rows per ticker (~280ms each).
 */

import { sql } from "@workspace/db";
import { db } from "@workspace/db";
import { logger } from "./logger.js";

// Part 6 — observability
//
// Every public baseline query and the LIVE_FLOW bucket emits one structured
// log line with a stable `op` discriminator and counter-shaped fields
// (durationMs, requested, returned, hitRate). Operators can `grep` for
// `op=baseline.*` to get a flat counter feed without standing up a metrics
// backend. Failure paths log at warn level with the same op tag so a single
// query can answer "how often did the trailing baseline degrade today?".
const olog = logger.child({ component: "optionsBaselines" });

/**
 * Build a parameterized `column IN (...)` fragment for a string array.
 * Drizzle's bare `ANY(${array})` template expands into `ANY(($1,$2,...))`
 * which Postgres treats as a row/record literal, not an array — causing
 * type-mismatch errors. `sql.join` keeps each value bound as its own
 * parameter and renders a clean IN-list.
 */
function inList(values: string[]) {
  return sql`(${sql.join(values.map(v => sql`${v}`), sql`, `)})`;
}

const MIN_HISTORY_DAYS = 10;
const DEFAULT_LOOKBACK_DAYS = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContractBaseline {
  optionSymbol: string;
  ticker: string;
  avgVolume: number;          // mean daily volume across lookback window
  avgVolOiRatio: number;      // mean(volume / openInterest) across window
  daysObserved: number;
}

export interface TickerBaseline {
  ticker: string;
  avgDailyNotional: number;   // sum(volume*close)/days
  avgDailyContracts: number;  // sum(volume)/days  (proxy when close is null)
  daysObserved: number;
}

export interface FlowAcceleration {
  ticker: string;
  recent3dAvg: number;        // mean daily volume across most recent 3 trading days
  trailing20dAvg: number;     // mean daily volume across the 20 days *before* the recent 3
  ratio: number;              // recent3dAvg / trailing20dAvg
  daysObserved: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Trading-day cutoff string (ISO YYYY-MM-DD) for the start of an N-day
 * lookback window relative to a reference date. We use calendar days * 1.5
 * as a buffer for weekends/holidays — the query then ranks by trade_date
 * desc and the consumer slices the latest N trading days, which is robust
 * to actual non-trading days.
 */
function lookbackCutoffISO(refDate: Date, days: number): string {
  const d = new Date(refDate);
  d.setUTCDate(d.getUTCDate() - Math.ceil(days * 1.5));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Part 1.1 — Per-contract 20-day baselines
// ---------------------------------------------------------------------------

/**
 * Returns 20-day average volume and average vol/OI ratio for a single
 * contract. Returns null when fewer than MIN_HISTORY_DAYS observed.
 */
export async function getContract20dBaseline(
  optionSymbol: string,
  opts: { lookbackDays?: number; referenceDate?: Date } = {},
): Promise<ContractBaseline | null> {
  const lookback = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const ref = opts.referenceDate ?? new Date();
  const cutoff = lookbackCutoffISO(ref, lookback);
  const t0 = Date.now();

  try {
    const rows = await db.execute<{
      ticker: string;
      days_observed: number;
      avg_volume: number | null;
      avg_vol_oi: number | null;
    }>(sql`
      WITH recent AS (
        SELECT ticker, volume, open_interest, trade_date
        FROM polygon_options_history
        WHERE option_symbol = ${optionSymbol}
          AND trade_date >= ${cutoff}
        ORDER BY trade_date DESC
        LIMIT ${lookback}
      )
      SELECT
        MAX(ticker)                                                 AS ticker,
        COUNT(*)                                                    AS days_observed,
        AVG(NULLIF(volume, 0))                                      AS avg_volume,
        AVG(CASE WHEN open_interest > 0 THEN volume::float / open_interest END) AS avg_vol_oi
      FROM recent;
    `);

    const row = rows.rows?.[0];
    const days = Number(row?.days_observed ?? 0);
    const degraded = !row || days < MIN_HISTORY_DAYS;
    olog.info({
      op: "baseline.contract.fetch",
      optionSymbol, lookback, daysObserved: days,
      durationMs: Date.now() - t0,
      degraded, reason: degraded ? "insufficient_history" : null,
    }, "baseline.contract");
    if (degraded) return null;
    return {
      optionSymbol,
      ticker: String(row.ticker ?? ""),
      avgVolume: Number(row.avg_volume ?? 0),
      avgVolOiRatio: Number(row.avg_vol_oi ?? 0),
      daysObserved: days,
    };
  } catch (err) {
    olog.warn({
      op: "baseline.contract.error", optionSymbol,
      durationMs: Date.now() - t0,
      err: err instanceof Error ? err.message : String(err),
    }, "baseline.contract failed");
    throw err;
  }
}

/**
 * Batch variant of {@link getContract20dBaseline} for many OCC symbols in one
 * round-trip (live watcher tape classification). Missing/degraded symbols are
 * omitted from the returned map.
 */
export async function getContracts20dBaselineBatch(
  optionSymbols: string[],
  opts: { lookbackDays?: number; referenceDate?: Date } = {},
): Promise<Map<string, ContractBaseline>> {
  const out = new Map<string, ContractBaseline>();
  const uniq = [...new Set(optionSymbols.map((s) => s.trim()).filter(Boolean))];
  if (uniq.length === 0) return out;

  const lookback = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const ref = opts.referenceDate ?? new Date();
  const cutoff = lookbackCutoffISO(ref, lookback);
  const t0 = Date.now();

  try {
    const rows = await db.execute<{
      option_symbol: string;
      ticker: string;
      days_observed: number;
      avg_volume: number | null;
      avg_vol_oi: number | null;
    }>(sql`
      WITH ranked AS (
        SELECT
          option_symbol,
          ticker,
          volume,
          open_interest,
          trade_date,
          ROW_NUMBER() OVER (PARTITION BY option_symbol ORDER BY trade_date DESC) AS rn
        FROM polygon_options_history
        WHERE option_symbol IN ${inList(uniq)}
          AND trade_date >= ${cutoff}
      ),
      agg AS (
        SELECT
          option_symbol,
          MAX(ticker) AS ticker,
          COUNT(*) AS days_observed,
          AVG(NULLIF(volume, 0)) AS avg_volume,
          AVG(CASE WHEN open_interest > 0 THEN volume::float / open_interest END) AS avg_vol_oi
        FROM ranked
        WHERE rn <= ${lookback}
        GROUP BY option_symbol
      )
      SELECT option_symbol, ticker, days_observed, avg_volume, avg_vol_oi
      FROM agg
      WHERE days_observed >= ${MIN_HISTORY_DAYS};
    `);

    for (const r of rows.rows ?? []) {
      const sym = String(r.option_symbol ?? "");
      if (!sym) continue;
      out.set(sym, {
        optionSymbol: sym,
        ticker: String(r.ticker ?? ""),
        avgVolume: Number(r.avg_volume ?? 0),
        avgVolOiRatio: Number(r.avg_vol_oi ?? 0),
        daysObserved: Number(r.days_observed ?? 0),
      });
    }

    olog.info({
      op: "baseline.contract.batch",
      requested: uniq.length,
      returned: out.size,
      lookback,
      durationMs: Date.now() - t0,
    }, "baseline.contract.batch");
    return out;
  } catch (err) {
    olog.warn({
      op: "baseline.contract.batch.error",
      requested: uniq.length,
      durationMs: Date.now() - t0,
      err: err instanceof Error ? err.message : String(err),
    }, "baseline.contract.batch failed");
    throw err;
  }
}

/**
 * Per-ticker 20-day baseline: average daily notional and average daily
 * contract volume across all contracts for the ticker.
 *
 * Batch-friendly: pass an array of tickers, get back a map. Returns an
 * entry only for tickers with >= MIN_HISTORY_DAYS history.
 */
export async function getTicker20dBaselines(
  tickers: string[],
  opts: { lookbackDays?: number; referenceDate?: Date } = {},
): Promise<Map<string, TickerBaseline>> {
  const out = new Map<string, TickerBaseline>();
  if (tickers.length === 0) return out;

  const lookback = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const ref = opts.referenceDate ?? new Date();
  const cutoff = lookbackCutoffISO(ref, lookback);
  const t0Batch = Date.now();

  // Two-step CTE so we can window the most-recent N *trading days per ticker*
  // (cutoff is calendar-day buffered; window enforces the real N-day cap).
  const rows = await db.execute<{
    ticker: string;
    days_observed: number;
    avg_notional: number | null;
    avg_contracts: number | null;
  }>(sql`
    WITH per_day AS (
      SELECT
        ticker,
        trade_date,
        SUM(volume)                                          AS day_contracts,
        SUM(volume * COALESCE(close_price, 0))               AS day_notional,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY trade_date DESC) AS rn
      FROM polygon_options_history
      WHERE ticker IN ${inList(tickers)}
        AND trade_date >= ${cutoff}
      GROUP BY ticker, trade_date
    )
    SELECT
      ticker,
      COUNT(*)              AS days_observed,
      AVG(day_notional)     AS avg_notional,
      AVG(day_contracts)    AS avg_contracts
    FROM per_day
    WHERE rn <= ${lookback}
    GROUP BY ticker;
  `);

  for (const r of rows.rows ?? []) {
    const days = Number(r.days_observed ?? 0);
    if (days < MIN_HISTORY_DAYS) continue;
    out.set(String(r.ticker), {
      ticker: String(r.ticker),
      avgDailyNotional: Number(r.avg_notional ?? 0),
      avgDailyContracts: Number(r.avg_contracts ?? 0),
      daysObserved: days,
    });
  }
  olog.info({
    op: "baseline.ticker.batch",
    requested: tickers.length,
    returned: out.size,
    hitRate: tickers.length > 0 ? +(out.size / tickers.length).toFixed(3) : 0,
    lookback,
    durationMs: Date.now() - t0Batch,
  }, "baseline.ticker.batch");
  return out;
}

// ---------------------------------------------------------------------------
// Part 1.2 — Intraday volume breakout (pure function)
// ---------------------------------------------------------------------------

export interface BreakoutResult {
  fired: boolean;
  ratio: number;
  reason?: string;
}

/**
 * Returns whether a contract's intraday volume so far constitutes a
 * "breakout" relative to its 20-day trailing baseline.
 *
 * Definition (from build directive Part 1.2 / Part 2.6):
 *   fired := todayVol >= 3 * baselineAvgVol  AND  todayVol >= 200
 *
 * Pure function — no I/O. Used by the live watcher (Part 2) and by the
 * Part 4 enrichment when stitching detections onto scan results.
 */
export function isIntradayVolumeBreakout(
  todayVol: number,
  baselineAvgVol: number | null,
  opts: { minVolume?: number; multiplier?: number } = {},
): BreakoutResult {
  const minVol = opts.minVolume ?? 200;
  const mult = opts.multiplier ?? 3;
  if (!baselineAvgVol || baselineAvgVol <= 0) {
    return { fired: false, ratio: 0, reason: "no_baseline" };
  }
  if (todayVol < minVol) {
    return { fired: false, ratio: todayVol / baselineAvgVol, reason: "below_min_volume" };
  }
  const ratio = todayVol / baselineAvgVol;
  return {
    fired: ratio >= mult,
    ratio,
    reason: ratio >= mult ? "breakout" : "below_multiplier",
  };
}

// ---------------------------------------------------------------------------
// Part 1.3 — Flow acceleration (recent 3d vs trailing 20d)
// ---------------------------------------------------------------------------

/**
 * Compares the most recent 3 trading days of options volume against the
 * trailing 20 days *prior* to those 3. Used as a Flow-bucket sub-score in
 * the deterministic scanner.
 *
 * Returns null when fewer than 13 days of history exist (3 recent + 10 prior).
 */
export async function getFlowAcceleration(
  tickers: string[],
  opts: { recentDays?: number; trailingDays?: number; referenceDate?: Date } = {},
): Promise<Map<string, FlowAcceleration>> {
  const out = new Map<string, FlowAcceleration>();
  if (tickers.length === 0) return out;

  const recentDays = opts.recentDays ?? 3;
  const trailingDays = opts.trailingDays ?? DEFAULT_LOOKBACK_DAYS;
  const total = recentDays + trailingDays;
  const ref = opts.referenceDate ?? new Date();
  const cutoff = lookbackCutoffISO(ref, total);
  const t0Accel = Date.now();

  const rows = await db.execute<{
    ticker: string;
    recent_avg: number | null;
    trailing_avg: number | null;
    recent_days: number;
    trailing_days: number;
  }>(sql`
    WITH per_day AS (
      SELECT
        ticker,
        trade_date,
        SUM(volume) AS day_vol,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY trade_date DESC) AS rn
      FROM polygon_options_history
      WHERE ticker IN ${inList(tickers)}
        AND trade_date >= ${cutoff}
      GROUP BY ticker, trade_date
    ),
    bucketed AS (
      SELECT
        ticker,
        CASE WHEN rn <= ${recentDays} THEN 'recent' ELSE 'trailing' END AS bucket,
        day_vol,
        rn
      FROM per_day
      WHERE rn <= ${total}
    )
    SELECT
      ticker,
      AVG(day_vol) FILTER (WHERE bucket = 'recent')   AS recent_avg,
      AVG(day_vol) FILTER (WHERE bucket = 'trailing') AS trailing_avg,
      COUNT(*) FILTER (WHERE bucket = 'recent')       AS recent_days,
      COUNT(*) FILTER (WHERE bucket = 'trailing')     AS trailing_days
    FROM bucketed
    GROUP BY ticker;
  `);

  for (const r of rows.rows ?? []) {
    const recDays = Number(r.recent_days ?? 0);
    const trDays = Number(r.trailing_days ?? 0);
    // Need at least the full recent window AND a meaningful trailing window.
    if (recDays < recentDays || trDays < MIN_HISTORY_DAYS) continue;
    const recentAvg = Number(r.recent_avg ?? 0);
    const trailingAvg = Number(r.trailing_avg ?? 0);
    if (trailingAvg <= 0) continue;
    out.set(String(r.ticker), {
      ticker: String(r.ticker),
      recent3dAvg: recentAvg,
      trailing20dAvg: trailingAvg,
      ratio: recentAvg / trailingAvg,
      daysObserved: recDays + trDays,
    });
  }
  // Counter-shaped log line: how many tickers had usable acceleration data
  // and what fraction of the request that satisfied. Operators grep `op=
  // baseline.flowAccel.batch` to see degradation rate per scan.
  let strongAccel = 0;
  for (const v of out.values()) if (v.ratio >= 1.5) strongAccel += 1;
  olog.info({
    op: "baseline.flowAccel.batch",
    requested: tickers.length,
    returned: out.size,
    strongAccel, // count with ratio >= 1.5 (eligible for Flow points)
    hitRate: tickers.length > 0 ? +(out.size / tickers.length).toFixed(3) : 0,
    recentDays, trailingDays,
    durationMs: Date.now() - t0Accel,
  }, "baseline.flowAccel.batch");
  // [LIVE_FL_DIAG] Trailing LIVE_FL input: from DB `polygon_options_history` only (no Polygon HTTP here).
  const sample = [...out.entries()].slice(0, 3).map(([t, a]) => ({
    ticker: t,
    ratio: a.ratio,
    recent3dAvg: a.recent3dAvg,
    trailing20dAvg: a.trailing20dAvg,
  }));
  // eslint-disable-next-line no-console
  console.log("[LIVE_FL_DIAG] getFlowAcceleration(source=polygon_options_history DB only)", {
    requested: tickers.length,
    mapSize: out.size,
    sample,
  });
  return out;
}

/**
 * Maps a flow-acceleration ratio to scoring points for the Flow bucket.
 *
 * Scoring (from build directive Part 1.3):
 *   ratio >= 2.0  → full credit (FULL_POINTS)
 *   ratio >= 1.5  → partial credit (PARTIAL_POINTS)
 *   else          → 0
 *
 * Lives inside the existing Flow bucket budget — no global rebalance needed
 * for Part 1. Part 4 introduces the separate LIVE_FLOW bucket.
 */
export const FLOW_ACCELERATION_FULL_POINTS = 6;
export const FLOW_ACCELERATION_PARTIAL_POINTS = 3;

export function flowAccelerationPoints(accel: FlowAcceleration | null): number {
  if (!accel || !Number.isFinite(accel.ratio)) return 0;
  if (accel.ratio >= 2.0) return FLOW_ACCELERATION_FULL_POINTS;
  if (accel.ratio >= 1.5) return FLOW_ACCELERATION_PARTIAL_POINTS;
  return 0;
}

// ---------------------------------------------------------------------------
// Part 4 — LIVE_FLOW bucket (0..20 raw points)
// ---------------------------------------------------------------------------
// The LIVE_FLOW bucket blends two sources:
//   (a) Live session events from the persistent WS watcher (Part 2 — TBD).
//       Each "event" is an intraday volume breakout fired by
//       isIntradayVolumeBreakout. Live-today is weighted heavier than
//       trailing days.
//   (b) Trailing flow acceleration (Part 1.3) computed from
//       polygon_options_history. This is the only source available until
//       Part 2 ships, so the bucket degrades gracefully to "EOD-only".
//
// Tier scoring (per directive):
//   1 event   -> 6
//   3 events  -> 12
//   6+ events -> 20
//   Penalty: -4 if directionally balanced (calls ≈ puts).
//
// Until Part 2 lands, `liveEventCount` is always 0 and the bucket is sourced
// purely from the trailing acceleration ratio mapped to "synthetic events":
//   ratio >= 3.0 -> 6 syn-events (full 20 pts)
//   ratio >= 2.0 -> 3 syn-events (12 pts)
//   ratio >= 1.5 -> 1 syn-event (6 pts)
//   else         -> 0
// This is the documented Part-1+Part-4 graceful-degradation behavior.

export const LIVE_FLOW_MAX = 20;

export interface LiveFlowInputs {
  /** Real-time breakout events fired by the WS watcher in today's session. */
  liveEventCount?: number;
  /** Trailing-window flow acceleration (ratio of recent to baseline). */
  trailingAccel?: FlowAcceleration | null;
  /** True when calls and puts are roughly balanced; triggers -4 penalty. */
  directionallyBalanced?: boolean;
}

export interface LiveFlowResult {
  /** 0..20 raw points for the LIVE_FLOW bucket. */
  score: number;
  /** True when at least one source contributed (live or trailing). */
  available: boolean;
  /** Effective event count after blending live + synthetic-from-trailing. */
  effectiveEvents: number;
  /** Whether the directional-balance penalty was applied. */
  penaltyApplied: boolean;
}

function tierPoints(events: number): number {
  if (events >= 6) return 20;
  if (events >= 3) return 12;
  if (events >= 1) return 6;
  return 0;
}

function syntheticEventsFromAccel(accel: FlowAcceleration | null | undefined): number {
  if (!accel || !Number.isFinite(accel.ratio)) return 0;
  if (accel.ratio >= 3.0) return 6;
  if (accel.ratio >= 2.0) return 3;
  if (accel.ratio >= 1.5) return 1;
  return 0;
}

export function computeLiveFlowBucket(inputs: LiveFlowInputs): LiveFlowResult {
  const liveEvents = Math.max(0, Math.floor(inputs.liveEventCount ?? 0));
  const synEvents = syntheticEventsFromAccel(inputs.trailingAccel);
  // Counter-shaped trace: per-ticker LIVE_FLOW application. We only emit at
  // debug to keep volume manageable across a 130-ticker scan; flip to info
  // temporarily when debugging score drift in production.
  if (olog.isLevelEnabled?.("debug")) {
    olog.debug({
      op: "liveFlow.compute",
      liveEvents, synEvents,
      ratio: inputs.trailingAccel?.ratio ?? null,
      directionallyBalanced: inputs.directionallyBalanced === true,
    }, "liveFlow.compute");
  }
  // Live-today weighted heavier: count live events fully, trailing synthetic
  // events at half weight (rounded down). This preserves Part 2's eventual
  // dominance while letting Part 1's flat-files signal carry the bucket today.
  const effectiveEvents = liveEvents + Math.floor(synEvents / 2) + (liveEvents === 0 ? synEvents - Math.floor(synEvents / 2) : 0);
  // ^ When no live events yet, use the FULL synthetic count so Part 1 alone
  //   can still drive the bucket. When live events arrive, they take primacy
  //   and synthetic events contribute only a half-weight tail.
  let score = tierPoints(effectiveEvents);
  let penaltyApplied = false;
  if (score > 0 && inputs.directionallyBalanced === true) {
    score = Math.max(0, score - 4);
    penaltyApplied = true;
  }
  const result: LiveFlowResult = {
    score: Math.min(LIVE_FLOW_MAX, score),
    available: liveEvents > 0 || synEvents > 0,
    effectiveEvents,
    penaltyApplied,
  };
  // [LIVE_FL_DIAG] Parsed values entering LIVE_FL score (trailing DB + optional WS live events).
  // eslint-disable-next-line no-console
  console.log("[LIVE_FL_DIAG] computeLiveFlowBucket", {
    liveEvents,
    synEvents,
    effectiveEvents: result.effectiveEvents,
    trailingRatio: inputs.trailingAccel?.ratio ?? null,
    directionallyBalanced: inputs.directionallyBalanced === true,
    score: result.score,
    available: result.available,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Part 1.4 — Trailing unusual flow query (last 5 trading days)
// ---------------------------------------------------------------------------

export interface TrailingUnusualEntry {
  ticker: string;
  recent5dContracts: number;
  trailing15dAvgContracts: number;
  ratio: number;
  topContracts: Array<{ optionSymbol: string; volume: number; putCall: string | null }>;
}

/**
 * Tickers whose 5-day options volume exceeds 2x their prior-15-day daily
 * baseline. Surfaces names that may not be in any current watchlist.
 */
export async function getTrailingUnusualFlow(
  opts: { recentDays?: number; trailingDays?: number; minRatio?: number; limit?: number } = {},
): Promise<TrailingUnusualEntry[]> {
  const recentDays = opts.recentDays ?? 5;
  const trailingDays = opts.trailingDays ?? 15;
  const minRatio = opts.minRatio ?? 2.0;
  const limit = opts.limit ?? 50;
  const totalDays = recentDays + trailingDays;
  const cutoff = lookbackCutoffISO(new Date(), totalDays);
  const t0Trailing = Date.now();

  const rows = await db.execute<{
    ticker: string;
    recent_total: number | null;
    trailing_avg: number | null;
    recent_days: number;
    trailing_days: number;
  }>(sql`
    WITH per_day AS (
      SELECT
        ticker, trade_date,
        SUM(volume) AS day_vol,
        ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY trade_date DESC) AS rn
      FROM polygon_options_history
      WHERE trade_date >= ${cutoff}
      GROUP BY ticker, trade_date
    )
    SELECT
      ticker,
      SUM(day_vol) FILTER (WHERE rn <= ${recentDays})                                      AS recent_total,
      AVG(day_vol) FILTER (WHERE rn > ${recentDays} AND rn <= ${totalDays})                AS trailing_avg,
      COUNT(*) FILTER (WHERE rn <= ${recentDays})                                          AS recent_days,
      COUNT(*) FILTER (WHERE rn > ${recentDays} AND rn <= ${totalDays})                    AS trailing_days
    FROM per_day
    GROUP BY ticker
    HAVING COUNT(*) FILTER (WHERE rn <= ${recentDays}) >= 1
       AND COUNT(*) FILTER (WHERE rn > ${recentDays} AND rn <= ${totalDays}) >= ${MIN_HISTORY_DAYS}
    ORDER BY ticker;
  `);

  const candidates: Array<{ ticker: string; recent: number; trailing: number; ratio: number }> = [];
  for (const r of rows.rows ?? []) {
    const recentTotal = Number(r.recent_total ?? 0);
    const trailingAvg = Number(r.trailing_avg ?? 0);
    const recDays = Number(r.recent_days ?? 0);
    if (trailingAvg <= 0 || recDays === 0) continue;
    const recentDailyAvg = recentTotal / recDays;
    const ratio = recentDailyAvg / trailingAvg;
    if (ratio < minRatio) continue;
    candidates.push({ ticker: String(r.ticker), recent: recentTotal, trailing: trailingAvg, ratio });
  }
  candidates.sort((a, b) => b.ratio - a.ratio);
  const top = candidates.slice(0, limit);

  // Per-ticker top contracts in the recent window — separate query keeps the
  // main aggregate cheap. Skip if no candidates.
  if (top.length === 0) {
    olog.info({
      op: "baseline.trailingUnusual.fetch",
      candidatesScanned: rows.rows?.length ?? 0,
      returned: 0,
      recentDays, trailingDays, minRatio,
      durationMs: Date.now() - t0Trailing,
    }, "baseline.trailingUnusual");
    return [];
  }
  const tickers = top.map(t => t.ticker);
  const recentCutoff = lookbackCutoffISO(new Date(), recentDays);
  const contractRows = await db.execute<{
    ticker: string;
    option_symbol: string;
    total_volume: number | null;
    put_call: string | null;
  }>(sql`
    SELECT ticker, option_symbol,
           SUM(volume) AS total_volume,
           MAX(put_call) AS put_call
    FROM polygon_options_history
    WHERE ticker IN ${inList(tickers)}
      AND trade_date >= ${recentCutoff}
    GROUP BY ticker, option_symbol
    ORDER BY ticker, SUM(volume) DESC;
  `);

  const perTickerTop = new Map<string, Array<{ optionSymbol: string; volume: number; putCall: string | null }>>();
  for (const r of contractRows.rows ?? []) {
    const list = perTickerTop.get(String(r.ticker)) ?? [];
    if (list.length < 5) {
      list.push({
        optionSymbol: String(r.option_symbol),
        volume: Number(r.total_volume ?? 0),
        putCall: r.put_call,
      });
      perTickerTop.set(String(r.ticker), list);
    }
  }

  const result = top.map(c => ({
    ticker: c.ticker,
    recent5dContracts: c.recent,
    trailing15dAvgContracts: c.trailing,
    ratio: c.ratio,
    topContracts: perTickerTop.get(c.ticker) ?? [],
  }));
  // Always emit a counter line on the success path too — keeps the
  // "one structured log per call" contract intact regardless of result size.
  olog.info({
    op: "baseline.trailingUnusual.fetch",
    candidatesScanned: rows.rows?.length ?? 0,
    returned: result.length,
    recentDays, trailingDays, minRatio,
    durationMs: Date.now() - t0Trailing,
  }, "baseline.trailingUnusual");
  return result;
}
