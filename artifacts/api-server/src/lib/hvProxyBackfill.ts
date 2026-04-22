import { db, equityDailyTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { validateIv30 } from "./ivSanityFloor";
import { computeIVRForSymbol } from "./ivNormalize";

const POLYGON_API = "https://api.polygon.io";

// Volatility risk premium: implied vol systematically prints above realized
// because option sellers demand a risk premium. Empirical ranges:
//   broad index ETFs (SPY/QQQ/DIA/IWM): 1.05–1.15
//   sector ETFs:                        1.10–1.20
//   single-name large caps:             1.15–1.30 (skew + earnings vol-of-vol)
// This is a fallback only — once we have 60+ days of canonical chain IV
// (Path A) the proxy is overridden.
const HV_WINDOW = 30;
const ANNUALIZE = Math.sqrt(252);

const BROAD_INDEX = new Set(["SPY", "QQQ", "DIA", "IWM", "VTI", "VOO"]);
const SECTOR_ETFS = ["XLE", "XLF", "XLK", "XLU", "XLV", "XLI", "XLP", "XLY", "XLB"];
const SECTOR_ETF_SET = new Set([...SECTOR_ETFS, "XLC", "XLRE"]);

// Single-name VRP tiers (applied only when symbol is NOT a broad index or sector ETF).
// High-beta names carry larger skew and earnings vol-of-vol -> wider IV-vs-HV spread.
// Mega-cap defensives (stable cash-flow blue chips, payment networks, staples,
// large pharma) trade with a tighter premium because realized tail risk is lower.
const HIGH_BETA = new Set([
  "TSLA", "NVDA", "AMD", "SMCI", "PLTR", "CRWD", "MU", "MRVL",
  "COIN", "HOOD", "RIVN", "DKNG", "ROKU", "PATH", "SNOW", "DDOG",
  "SHOP", "CRDO", "APP",
  "BA", "UAL", "DAL", "LUV",
  "OXY", "DVN", "FANG", "MPC",
]);
const MEGA_CAP_DEFENSIVES = new Set([
  "AAPL", "MSFT", "GOOGL", "GOOG",
  "JNJ", "PFE", "MRK", "ABBV", "UNH", "AMGN", "BMY", "MDT",
  "PG", "KO", "PEP", "WMT", "COST", "MCD",
  "V", "MA", "HON",
]);

export function vrpMultiplierFor(symbol: string): number {
  const s = symbol.toUpperCase();
  if (BROAD_INDEX.has(s)) return 1.08;
  if (SECTOR_ETF_SET.has(s)) return 1.12;
  if (HIGH_BETA.has(s)) return 1.30;
  if (MEGA_CAP_DEFENSIVES.has(s)) return 1.15;
  return 1.20;
}

interface DailyBar { date: string; close: number }

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url: string, attempts = 3, timeoutMs = 30000): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      return r;
    } catch (e) {
      clearTimeout(t);
      if (i === attempts - 1) {
        logger.warn({ url: url.split("?")[0], error: (e as Error).message }, "hvProxy.fetchWithRetry failed");
        return null;
      }
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

async function fetchDailyAggs(symbol: string, fromDate: string, toDate: string, apiKey: string): Promise<DailyBar[]> {
  const url = `${POLYGON_API}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=400&apiKey=${apiKey}`;
  const r = await fetchWithRetry(url);
  if (!r || !r.ok) return [];
  const json = await r.json() as { results?: Array<Record<string, unknown>> };
  const out: DailyBar[] = [];
  for (const bar of (json.results ?? [])) {
    const ts = bar["t"] as number | undefined;
    const c = bar["c"] as number | undefined;
    if (!ts || !c || c <= 0) continue;
    out.push({ date: new Date(ts).toISOString().slice(0, 10), close: c });
  }
  return out;
}

/**
 * Compute rolling realized vol over a trailing N-day window of log returns.
 * Returns array of { date, hv } where hv is annualized stdev × sqrt(252).
 * Sample stdev uses N-1 denominator. The first (HV_WINDOW) returns produce no HV.
 */
export function computeRollingHV(bars: DailyBar[], window = HV_WINDOW): Array<{ date: string; hv: number }> {
  if (bars.length < window + 1) return [];
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const cur = bars[i].close;
    if (prev <= 0 || cur <= 0) { returns.push(NaN); continue; }
    returns.push(Math.log(cur / prev));
  }
  // returns[i] corresponds to bars[i+1] (the close-to-close return ending at bars[i+1]).
  const out: Array<{ date: string; hv: number }> = [];
  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1);
    if (slice.some(v => !Number.isFinite(v))) continue;
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1);
    const hv = Math.sqrt(variance) * ANNUALIZE;
    out.push({ date: bars[i + 1].date, hv });
  }
  return out;
}

export interface HvProxyReport {
  symbolsProcessed: number;
  rowsWritten: number;
  rowsRejectedByFloor: number;
  ivrRowsUpdated: number;
  errors: string[];
  daysBack: number;
}

export interface HvProxyJob {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  symbolsTotal: number;
  daysBack: number;
  report: HvProxyReport | null;
  error: string | null;
}

const jobs = new Map<string, HvProxyJob>();
let activeJobId: string | null = null;

export function getHvProxyJob(id: string): HvProxyJob | null { return jobs.get(id) ?? null; }
export function listHvProxyJobs(): HvProxyJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function startHvProxyBackfillJob(symbols: string[], daysBack: number): HvProxyJob {
  // Atomic check-and-claim. If another job is active, return a synthetic
  // "rejected" job without registering it in the jobs map.
  if (activeJobId && jobs.get(activeJobId)?.status === "running") {
    return {
      id: "rejected",
      status: "failed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      symbolsTotal: 0,
      daysBack,
      report: null,
      error: `another hv-proxy backfill is already running: ${activeJobId}`,
    };
  }
  const id = `hvproxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeJobId = id;
  const job: HvProxyJob = {
    id, status: "running", startedAt: new Date().toISOString(), completedAt: null,
    symbolsTotal: new Set([...symbols, ...SECTOR_ETFS].map(s => s.toUpperCase())).size,
    daysBack, report: null, error: null,
  };
  jobs.set(id, job);
  void backfillHvProxy(symbols, daysBack)
    .then((report) => {
      job.status = "completed";
      job.report = report;
      job.completedAt = new Date().toISOString();
      logger.info({ id, report }, "hvProxyBackfill: job completed");
    })
    .catch((e) => {
      job.status = "failed";
      job.error = (e as Error).message;
      job.completedAt = new Date().toISOString();
      logger.error({ id, error: job.error }, "hvProxyBackfill: job failed");
    })
    .finally(() => { if (activeJobId === id) activeJobId = null; });
  return job;
}

export async function backfillHvProxy(symbols: string[], daysBack: number): Promise<HvProxyReport> {
  const report: HvProxyReport = {
    symbolsProcessed: 0, rowsWritten: 0, rowsRejectedByFloor: 0,
    ivrRowsUpdated: 0, errors: [], daysBack,
  };
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    report.errors.push("POLYGON_API_KEY missing");
    return report;
  }

  const allSymbols = [...new Set([...symbols, ...SECTOR_ETFS].map(s => s.toUpperCase()))];

  // We need HV_WINDOW extra days of price history before the earliest target
  // date to compute the trailing realized vol on day 1.
  const padDays = HV_WINDOW + 10;
  const now = new Date();
  const fromDate = new Date(now.getTime() - (daysBack + padDays) * 86_400_000).toISOString().slice(0, 10);
  const toDate = now.toISOString().slice(0, 10);
  const earliestTargetDate = new Date(now.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);

  for (const sym of allSymbols) {
    try {
      const bars = await fetchDailyAggs(sym, fromDate, toDate, apiKey);
      if (bars.length < HV_WINDOW + 5) {
        report.errors.push(`${sym}: insufficient bars (${bars.length})`);
        continue;
      }
      const hvSeries = computeRollingHV(bars, HV_WINDOW);
      const vrp = vrpMultiplierFor(sym);
      let symRows = 0;
      let symRejected = 0;
      const targetDates: string[] = [];

      for (const { date, hv } of hvSeries) {
        if (date < earliestTargetDate) continue;
        const proxyIv = hv * vrp;
        const validated = validateIv30(sym, proxyIv, "hvProxyBackfill");
        if (validated == null) { symRejected++; continue; }

        // Upsert row for (sym, date). NEVER write iv_30d here — that column
        // is reserved for real chain/flow IV. We only populate the proxy
        // column + hv_30d. ivr_source is set only when the row didn't already
        // have a real-IV source claim.
        await db.execute(sql`
          INSERT INTO equity_daily (symbol, date, close, iv_30d_proxy, hv_30d, ivr_source)
          VALUES (
            ${sym}, ${date},
            ${bars.find(b => b.date === date)?.close ?? null},
            ${validated}, ${hv}, 'hv_proxy'
          )
          ON CONFLICT (symbol, date) DO UPDATE SET
            iv_30d_proxy = EXCLUDED.iv_30d_proxy,
            hv_30d = EXCLUDED.hv_30d,
            ivr_source = COALESCE(equity_daily.ivr_source, EXCLUDED.ivr_source)
        `);
        symRows++;
        targetDates.push(date);
      }
      report.rowsWritten += symRows;
      report.rowsRejectedByFloor += symRejected;
      report.symbolsProcessed++;

      // Recompute IVR for every newly-written date using the proxy column,
      // which now provides a uniform 252d history for back-solving IVR.
      for (const d of targetDates) {
        const ivr = await computeIVRForSymbol(sym, d);
        if (ivr != null) {
          await db.update(equityDailyTable)
            .set({ ivr })
            .where(and(eq(equityDailyTable.symbol, sym), eq(equityDailyTable.date, d)));
          report.ivrRowsUpdated++;
        }
      }

      logger.info({ sym, symRows, symRejected }, "hvProxyBackfill: symbol complete");
    } catch (e) {
      const msg = (e as Error).message;
      report.errors.push(`${sym}: ${msg}`);
      logger.error({ sym, error: msg }, "hvProxyBackfill: symbol failed");
    }
  }

  return report;
}
