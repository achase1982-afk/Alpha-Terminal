import { db } from "@workspace/db";
import { equityDailyTable, optionsFlowPerStrikeTable } from "@workspace/db";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { impliedVolatilityBSM } from "./bsmIV";
import { probePolygonRate, type RateProbe } from "./polygonRateProbe";
import { normalizeIV, computeIVRForSymbol } from "./ivNormalize";
import { validateIv30PathB } from "./ivSanityFloor";

const POLYGON_API = "https://api.polygon.io";
const SECTOR_ETFS = ["XLE", "XLF", "XLK", "XLU", "XLV", "XLI", "XLP", "XLY", "XLB"];
const RISK_FREE = 0.045;
const IV30_MIN_DTE = 20;
const IV30_MAX_DTE = 40;
const IV30_ATM_MONEYNESS = 0.05;

type Iv30BackfillCandidate = { iv: number | null; strike: number; dte: number | null };

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function selectBackfillIv30d(spot: number, rows: Iv30BackfillCandidate[]): number | null {
  if (spot <= 0) return null;
  const candidates = rows
    .map((r) => ({
      iv: normalizeIV(r.iv),
      dte: r.dte ?? 0,
      moneyness: Math.abs(r.strike - spot) / spot,
    }))
    .filter((c): c is { iv: number; dte: number; moneyness: number } =>
      c.iv != null &&
      c.dte >= IV30_MIN_DTE &&
      c.dte <= IV30_MAX_DTE &&
      c.moneyness <= IV30_ATM_MONEYNESS
    )
    .sort((a, b) => {
      const aScore = Math.abs(a.dte - 30) + a.moneyness * 100;
      const bScore = Math.abs(b.dte - 30) + b.moneyness * 100;
      return aScore - bScore;
    });
  if (candidates.length === 0) return null;
  return medianOf(candidates.slice(0, 6).map(c => c.iv));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Composite key for flow_strike_unique; last row wins on collision (see dedupePendingFlowPerStrikeRows). */
function flowPerStrikeInsertDedupeKey(row: typeof optionsFlowPerStrikeTable.$inferInsert): string {
  return `${row.underlyingSymbol}|${row.date}|${row.optionType}|${row.strike}|${row.expiration}`;
}

/**
 * Collapse duplicate (underlying, date, option_type, strike, expiration) rows before INSERT ...
 * ON CONFLICT DO UPDATE so Postgres never sees two identical conflict targets in one statement.
 */
function dedupePendingFlowPerStrikeRows(
  rows: Array<typeof optionsFlowPerStrikeTable.$inferInsert>,
  sym: string,
): Array<typeof optionsFlowPerStrikeTable.$inferInsert> {
  const map = new Map<string, typeof optionsFlowPerStrikeTable.$inferInsert>();
  for (const row of rows) {
    map.set(flowPerStrikeInsertDedupeKey(row), row);
  }
  const m = rows.length;
  const dropped = m - map.size;
  if (dropped > 0) {
    logger.debug(
      { sym, dropped, batch: m },
      `dedup dropped ${dropped} rows from batch of ${m} for symbol ${sym}`,
    );
  }
  return [...map.values()];
}

async function fetchWithRetry(url: string, attempts = 3, timeoutMs = 20000): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (r.status === 429) {
        await sleep(2000 * (i + 1));
        continue;
      }
      return r;
    } catch (e) {
      clearTimeout(t);
      if (i === attempts - 1) {
        logger.warn({ url: url.split("?")[0], error: (e as Error).message }, "fetchWithRetry failed");
        return null;
      }
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

interface ContractMeta {
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
}

export interface ListContractsDiagnostic {
  symbol: string;
  fromDate: string;
  pagesFetched: number;
  pageCapHit: boolean;
  hasMorePages: boolean;
  totalContracts: number;
  earliestExpiration: string | null;
  latestExpiration: string | null;
  expirationsByMonth: Record<string, number>;
}

async function listContracts(
  symbol: string, fromDate: string, apiKey: string,
  diag?: { capture: ListContractsDiagnostic },
): Promise<ContractMeta[]> {
  const out: ContractMeta[] = [];
  // Sort by expiration_date asc so the OLDEST/most-history-having contracts come first.
  // Without sort, Polygon may return newest-first which means we hit the page cap with
  // only recently-created contracts that have no deep history.
  let url: string | null =
    `${POLYGON_API}/v3/reference/options/contracts` +
    `?underlying_ticker=${encodeURIComponent(symbol)}` +
    `&expiration_date.gte=${fromDate}` +
    `&expired=true&order=asc&sort=expiration_date&limit=1000&apiKey=${apiKey}`;

  const PAGE_CAP = 200; // 200 × 1000 = 200k contracts (covers SPY/QQQ deep history)
  let pages = 0;
  let lastJsonHadNext = false;
  while (url && pages < PAGE_CAP) {
    const r = await fetchWithRetry(url);
    if (!r || !r.ok) break;
    const json = await r.json() as { results?: Array<Record<string, unknown>>; next_url?: string };
    for (const c of (json.results ?? [])) {
      const ticker = c["ticker"] as string | undefined;
      const ctype = c["contract_type"] as string | undefined;
      const strike = c["strike_price"] as number | undefined;
      const exp = c["expiration_date"] as string | undefined;
      if (ticker && ctype && strike && exp) {
        out.push({ ticker, type: ctype === "call" ? "call" : "put", strike, expiration: exp });
      }
    }
    lastJsonHadNext = !!json.next_url;
    url = json.next_url ? `${json.next_url}&apiKey=${apiKey}` : null;
    pages++;
    await sleep(50);
  }

  if (diag) {
    const exps = out.map(c => c.expiration).sort();
    const byMonth: Record<string, number> = {};
    for (const e of exps) {
      const m = e.slice(0, 7);
      byMonth[m] = (byMonth[m] ?? 0) + 1;
    }
    diag.capture = {
      symbol, fromDate,
      pagesFetched: pages,
      pageCapHit: pages >= PAGE_CAP,
      hasMorePages: lastJsonHadNext && pages >= PAGE_CAP,
      totalContracts: out.length,
      earliestExpiration: exps[0] ?? null,
      latestExpiration: exps[exps.length - 1] ?? null,
      expirationsByMonth: byMonth,
    };
  }

  logger.info({
    symbol, fromDate, pages, pageCapHit: pages >= PAGE_CAP,
    contracts: out.length,
    earliestExp: out.length ? out.map(c => c.expiration).sort()[0] : null,
    latestExp: out.length ? out.map(c => c.expiration).sort()[out.length - 1] : null,
  }, "listContracts: pagination summary");
  return out;
}

export async function diagnoseListContracts(symbol: string, daysBack: number): Promise<ListContractsDiagnostic | { error: string }> {
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) return { error: "POLYGON_API_KEY missing" };
  const fromDate = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
  const diag: { capture: ListContractsDiagnostic } = { capture: {
    symbol, fromDate, pagesFetched: 0, pageCapHit: false, hasMorePages: false,
    totalContracts: 0, earliestExpiration: null, latestExpiration: null, expirationsByMonth: {},
  } };
  await listContracts(symbol.toUpperCase(), fromDate, apiKey, diag);
  return diag.capture;
}

interface AggBar { date: string; close: number; volume: number; vwap: number | null }

async function fetchContractAggs(
  contractTicker: string, fromDate: string, toDate: string, apiKey: string,
): Promise<AggBar[]> {
  const url = `${POLYGON_API}/v2/aggs/ticker/${encodeURIComponent(contractTicker)}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=300&apiKey=${apiKey}`;
  const r = await fetchWithRetry(url);
  if (!r || !r.ok) return [];
  const json = await r.json() as { results?: Array<Record<string, unknown>> };
  const out: AggBar[] = [];
  for (const bar of (json.results ?? [])) {
    const ts = bar["t"] as number;
    const c = bar["c"] as number;
    const v = (bar["v"] ?? 0) as number;
    const vw = (bar["vw"] ?? null) as number | null;
    if (!ts || !c || c <= 0) continue;
    out.push({
      date: new Date(ts).toISOString().slice(0, 10),
      close: c,
      volume: Math.round(v),
      vwap: vw,
    });
  }
  return out;
}

export interface BackfillReport {
  rateProbe: RateProbe;
  symbolsProcessed: number;
  contractsListed: number;
  flowRowsInserted: number;
  flowRowsUpdatedWithIV: number;
  equityRowsIVUpdated: number;
  ivrRowsUpdated: number;
  errors: string[];
  daysBack: number;
}

export interface BackfillJob {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  symbolsTotal: number;
  daysBack: number;
  report: BackfillReport | null;
  error: string | null;
}

const jobs = new Map<string, BackfillJob>();
let activeJobId: string | null = null;

export function getBackfillJob(id: string): BackfillJob | null {
  return jobs.get(id) ?? null;
}

export function listBackfillJobs(): BackfillJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function startBackfillJob(symbols: string[], daysBack: number): BackfillJob {
  const id = `backfill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: BackfillJob = {
    id,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    symbolsTotal: symbols.length + SECTOR_ETFS.length,
    daysBack,
    report: null,
    error: null,
  };
  jobs.set(id, job);
  if (activeJobId && jobs.get(activeJobId)?.status === "running") {
    job.status = "failed";
    job.error = `another backfill is already running: ${activeJobId}`;
    job.completedAt = new Date().toISOString();
    logger.warn({ id, conflictingJobId: activeJobId }, "Historical IV backfill: rejected — concurrent run");
    return job;
  }
  activeJobId = id;
  void backfillHistoricalIV(symbols, daysBack)
    .then((report) => {
      job.status = "completed";
      job.report = report;
      job.completedAt = new Date().toISOString();
      logger.info({ id, report }, "Historical IV backfill: job completed");
    })
    .catch((e) => {
      job.status = "failed";
      job.error = (e as Error).message;
      job.completedAt = new Date().toISOString();
      logger.error({ id, error: job.error }, "Historical IV backfill: job failed");
    })
    .finally(() => {
      if (activeJobId === id) activeJobId = null;
    });
  return job;
}

export async function backfillHistoricalIV(
  symbols: string[],
  daysBack: number,
  opts: { skipSectorEtfs?: boolean } = {},
): Promise<BackfillReport> {
  const report: BackfillReport = {
    rateProbe: { tier: "unknown", successCount: 0, failureCount: 0, rateLimited: false, elapsedMs: 0, message: "" },
    symbolsProcessed: 0,
    contractsListed: 0,
    flowRowsInserted: 0,
    flowRowsUpdatedWithIV: 0,
    equityRowsIVUpdated: 0,
    ivrRowsUpdated: 0,
    errors: [],
    daysBack,
  };

  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    report.errors.push("POLYGON_API_KEY missing");
    return report;
  }

  const probe = await probePolygonRate();
  report.rateProbe = probe;

  const allSymbols = opts.skipSectorEtfs
    ? [...new Set(symbols.map(s => s.toUpperCase()))]
    : [...new Set([...symbols, ...SECTOR_ETFS].map(s => s.toUpperCase()))];
  const now = new Date();
  const fromDate = new Date(now.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);
  const toDate = now.toISOString().slice(0, 10);

  logger.info({ symbols: allSymbols.length, fromDate, toDate, daysBack }, "Historical IV backfill: starting");

  for (const sym of allSymbols) {
    try {
      // ---------- 1. Pull contracts (paginated, includes expired) ----------
      const contracts = await listContracts(sym, fromDate, apiKey);
      report.contractsListed += contracts.length;
      if (contracts.length === 0) {
        report.symbolsProcessed++;
        continue;
      }

      // ---------- 2. Pull underlying daily closes from equity_daily ----------
      const eqRows = await db
        .select({ date: equityDailyTable.date, close: equityDailyTable.close })
        .from(equityDailyTable)
        .where(and(eq(equityDailyTable.symbol, sym), gte(equityDailyTable.date, fromDate)));
      const spotByDate = new Map<string, number>();
      for (const r of eqRows) {
        if (r.close && r.close > 0) spotByDate.set(r.date, r.close);
      }
      if (spotByDate.size === 0) {
        report.symbolsProcessed++;
        continue;
      }

      logger.info({ sym, contracts: contracts.length, equityDates: spotByDate.size }, "Historical IV backfill: contracts listed");

      // ---------- 3. For each contract: fetch aggregates, BSM IV, stream insert per batch ----------
      const PARALLEL = 4;
      const FLUSH_EVERY = 50; // flush DB every N contracts processed
      let pendingRows: Array<typeof optionsFlowPerStrikeTable.$inferInsert> = [];
      let symRowsInserted = 0;
      let symRowsWithIV = 0;
      let lastProgressLog = Date.now();

      for (let ci = 0; ci < contracts.length; ci += PARALLEL) {
        const batch = contracts.slice(ci, ci + PARALLEL);
        const results = await Promise.allSettled(batch.map(async (c) => {
          const bars = await fetchContractAggs(c.ticker, fromDate, toDate, apiKey);
          const rows: Array<typeof optionsFlowPerStrikeTable.$inferInsert> = [];
          for (const bar of bars) {
            const spot = spotByDate.get(bar.date);
            if (!spot) continue;
            const dte = Math.max(0, Math.round(
              (new Date(`${c.expiration}T20:00:00Z`).getTime() - new Date(`${bar.date}T20:00:00Z`).getTime()) / 86_400_000
            ));
            if (dte < 1 || dte > 365) continue;
            const mid = bar.close;
            let iv: number | null = null;
            try {
              iv = impliedVolatilityBSM({
                spot, strike: c.strike, dte,
                isCall: c.type === "call",
                optionPrice: mid,
                riskFreeRate: RISK_FREE,
              });
            } catch { /* swallow */ }
            rows.push({
              underlyingSymbol: sym,
              date: bar.date,
              optionType: c.type,
              strike: c.strike,
              expiration: c.expiration,
              dte,
              dailyVolume: bar.volume,
              openInterest: null,
              bid: null,
              ask: null,
              mid,
              impliedVolatility: iv,
              delta: null,
              gamma: null,
              theta: null,
              vega: null,
              avgTradePrice: bar.vwap,
            });
            if (iv != null) symRowsWithIV++;
          }
          return rows;
        }));
        for (const r of results) {
          if (r.status === "fulfilled") pendingRows.push(...r.value);
        }
        // Flush every FLUSH_EVERY contracts, or when buffer >= 500 rows
        if (((ci + PARALLEL) % FLUSH_EVERY === 0) || pendingRows.length >= 500) {
          if (pendingRows.length > 0) {
            const BATCH = 500;
            for (let b = 0; b < pendingRows.length; b += BATCH) {
              const slice = dedupePendingFlowPerStrikeRows(pendingRows.slice(b, b + BATCH), sym);
              await db.insert(optionsFlowPerStrikeTable)
                .values(slice)
                .onConflictDoUpdate({
                  target: [
                    optionsFlowPerStrikeTable.underlyingSymbol,
                    optionsFlowPerStrikeTable.date,
                    optionsFlowPerStrikeTable.optionType,
                    optionsFlowPerStrikeTable.strike,
                    optionsFlowPerStrikeTable.expiration,
                  ],
                  set: {
                    impliedVolatility: sql`COALESCE(${optionsFlowPerStrikeTable.impliedVolatility}, EXCLUDED.implied_volatility)`,
                    mid: sql`COALESCE(${optionsFlowPerStrikeTable.mid}, EXCLUDED.mid)`,
                    dailyVolume: sql`GREATEST(COALESCE(${optionsFlowPerStrikeTable.dailyVolume}, 0), COALESCE(EXCLUDED.daily_volume, 0))`,
                    avgTradePrice: sql`COALESCE(${optionsFlowPerStrikeTable.avgTradePrice}, EXCLUDED.avg_trade_price)`,
                  },
                });
              symRowsInserted += slice.length;
            }
            pendingRows = [];
          }
          if (Date.now() - lastProgressLog > 30_000) {
            logger.info({
              sym, contractsDone: ci + PARALLEL, contractsTotal: contracts.length,
              symRowsInserted, symRowsWithIV,
            }, "Historical IV backfill: batch progress");
            lastProgressLog = Date.now();
          }
        }
        await sleep(40);
      }

      // Final flush
      if (pendingRows.length > 0) {
        const BATCH = 500;
        for (let b = 0; b < pendingRows.length; b += BATCH) {
          const slice = dedupePendingFlowPerStrikeRows(pendingRows.slice(b, b + BATCH), sym);
          await db.insert(optionsFlowPerStrikeTable)
            .values(slice)
            .onConflictDoUpdate({
              target: [
                optionsFlowPerStrikeTable.underlyingSymbol,
                optionsFlowPerStrikeTable.date,
                optionsFlowPerStrikeTable.optionType,
                optionsFlowPerStrikeTable.strike,
                optionsFlowPerStrikeTable.expiration,
              ],
              set: {
                impliedVolatility: sql`COALESCE(${optionsFlowPerStrikeTable.impliedVolatility}, EXCLUDED.implied_volatility)`,
                mid: sql`COALESCE(${optionsFlowPerStrikeTable.mid}, EXCLUDED.mid)`,
                dailyVolume: sql`GREATEST(COALESCE(${optionsFlowPerStrikeTable.dailyVolume}, 0), COALESCE(EXCLUDED.daily_volume, 0))`,
                avgTradePrice: sql`COALESCE(${optionsFlowPerStrikeTable.avgTradePrice}, EXCLUDED.avg_trade_price)`,
              },
            });
          symRowsInserted += slice.length;
        }
        pendingRows = [];
      }

      report.flowRowsInserted += symRowsInserted;
      report.flowRowsUpdatedWithIV += symRowsWithIV;

      // ---------- 5. Per date: 20–40 DTE, ±5% ATM, median of top candidates → equity_daily.iv_30d ----------
      const datesInWindow = [...spotByDate.keys()].sort();
      for (const d of datesInWindow) {
        const spot = spotByDate.get(d)!;
        const candidates = await db
          .select({
            iv: optionsFlowPerStrikeTable.impliedVolatility,
            strike: optionsFlowPerStrikeTable.strike,
            dte: optionsFlowPerStrikeTable.dte,
          })
          .from(optionsFlowPerStrikeTable)
          .where(and(
            eq(optionsFlowPerStrikeTable.underlyingSymbol, sym),
            eq(optionsFlowPerStrikeTable.date, d),
            sql`${optionsFlowPerStrikeTable.impliedVolatility} IS NOT NULL`,
          ));
        if (candidates.length === 0) continue;
        const iv30dRaw = selectBackfillIv30d(spot, candidates);
        const iv30d = validateIv30PathB(sym, iv30dRaw, "historicalIVBackfill:median");
        if (iv30d == null) continue;

        // Only write if equity_daily has no iv yet OR matches our format range (idempotent)
        const existing = await db
          .select({ iv: equityDailyTable.iv30d })
          .from(equityDailyTable)
          .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, d)))
          .limit(1);
        if (existing.length === 0) continue;
        if (existing[0].iv == null && iv30d != null) {
          await db.update(equityDailyTable)
            .set({ iv30d, ivrSource: "real_iv" })
            .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, d)));
          report.equityRowsIVUpdated++;
        }
      }

      report.symbolsProcessed++;
      logger.info({
        sym, done: report.symbolsProcessed, total: allSymbols.length,
        contractsForSym: contracts.length,
        symRowsInserted, symRowsWithIV,
        contractsListed: report.contractsListed,
        flowRowsInserted: report.flowRowsInserted,
        equityRowsIVUpdated: report.equityRowsIVUpdated,
      }, "Historical IV backfill: symbol complete");
    } catch (e) {
      const msg = `${sym}: ${(e as Error).message}`;
      report.errors.push(msg);
      logger.warn({ sym, error: (e as Error).message }, "Historical IV backfill: symbol failed");
    }
    await sleep(80);
  }

  // ---------- 6. Recompute IVR for all symbols, all dates ----------
  logger.info("Historical IV backfill: recomputing IVR for all symbols");
  for (const sym of allSymbols) {
    const dates = await db
      .select({ date: equityDailyTable.date, iv: equityDailyTable.iv30d })
      .from(equityDailyTable)
      .where(and(
        eq(equityDailyTable.symbol, sym),
        sql`${equityDailyTable.iv30d} IS NOT NULL`,
      ));
    for (const row of dates) {
      const ivr = await computeIVRForSymbol(sym, row.date, row.iv);
      const existing = await db.select({ ivr: equityDailyTable.ivr })
        .from(equityDailyTable)
        .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, row.date)))
        .limit(1);
      const oldIvr = existing[0]?.ivr ?? null;
      if (ivr !== oldIvr) {
        await db.update(equityDailyTable)
          .set({ ivr })
          .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, row.date)));
        if (ivr != null) report.ivrRowsUpdated++;
      }
    }
  }

  logger.info(report, "Historical IV backfill: complete");
  return report;
}

// Suppress unused import warning for isNull (kept for future filtering work)
void isNull;
