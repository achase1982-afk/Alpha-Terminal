import { logger } from "./logger.js";
import { SWEEP_CONDITION_CODES, BLOCK_MIN_SIZE } from "./optionsConditionCodes.js";
import { fetchPolygonChain, type PolygonParsedContract } from "./polygonChain.js";
import {
  ensureConnected,
  isEnabled as polygonOptionsWsEnabled,
  onTrade,
  subscribeContracts,
  unsubscribeContracts,
  type PolygonOptionTrade,
} from "./polygonOptionsWs.js";

// ── Unusual Flow Scan orchestrator ───────────────────────────────────
//
// Given a list of underlying tickers, fetch each ticker's options chain,
// pick a bounded set of candidate contracts (ATM ± N strikes over near
// expiries), subscribe to their real-time trade tape for durationSec,
// compute unusual-flow metrics (sweep count, block count, premium flow,
// vol/OI, aggressor imbalance), and return a ranked result per ticker.
//
// Budgets (enforced here, not just in the WS client):
//   * MAX_CONTRACTS_PER_TICKER — caps per-ticker contract count
//   * MAX_TOTAL_CONTRACTS       — caps union across tickers (stays
//     well under Polygon's 1000-sub-per-connection ceiling)
//
// All timing is local to each scan so parallel/overlapping scans are
// isolated (the WS client's ref-counted sub layer handles overlap).

const MAX_CONTRACTS_PER_TICKER = 20;
const MAX_TOTAL_CONTRACTS = 800;
const DEFAULT_DURATION_SEC = 20;
const SWEEP_WINDOW_MS = 100;
const SWEEP_MIN_LEGS = 3;

export interface FlowScanInput {
  tickers: string[];
  durationSec?: number;
  minPremium?: number; // $USD per print floor for "top premium"
}

export interface FlowContractMetric {
  symbol: string;          // OCC "O:..."
  underlying: string;
  strike: number;
  expiration: string;
  type: "C" | "P";
  liveVolume: number;      // contracts traded during window
  liveNotional: number;    // sum(price * size * 100)
  openInterest: number;
  dayVolume: number;
  volOiRatio: number;
  sweepPrints: number;
  blockPrints: number;
  largestPrintSize: number;
  largestPrintPremium: number;
  tradeCount: number;
}

export interface FlowTickerResult {
  ticker: string;
  score: number;
  scoreReason: string;
  totalPrints: number;
  totalLiveVolume: number;
  totalLiveNotional: number;
  callNotional: number;
  putNotional: number;
  callPutNotionalRatio: number | null;
  sweepPrints: number;
  blockPrints: number;
  contractsSubscribed: number;
  topContracts: FlowContractMetric[];
  largestPrint: {
    symbol: string;
    size: number;
    price: number;
    premium: number;
    timestamp: number;
  } | null;
  error?: string;
}

export interface FlowScanResult {
  jobId: string;
  status: "queued" | "running" | "complete" | "error";
  durationSec: number;
  contractsSubscribed: number;
  startedAt: number | null;
  completedAt: number | null;
  tickers: FlowTickerResult[];
  error?: string;
}

// ── Job store (in-memory) ────────────────────────────────────────────

const jobs = new Map<string, FlowScanResult>();
const JOB_TTL_MS = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs.entries()) {
    const ref = j.completedAt ?? j.startedAt ?? now;
    if (now - ref > JOB_TTL_MS) jobs.delete(id);
  }
}, 60_000).unref?.();

export function getFlowScanJob(jobId: string): FlowScanResult | undefined {
  return jobs.get(jobId);
}

// ── Contract selection ──────────────────────────────────────────────

interface CandidateMeta {
  symbol: string;
  underlying: string;
  strike: number;
  expiration: string;
  type: "C" | "P";
  openInterest: number;
  dayVolume: number;
}

function selectCandidates(
  ticker: string,
  chain: { calls: PolygonParsedContract[]; puts: PolygonParsedContract[]; underlyingPrice?: number },
  limit: number,
): CandidateMeta[] {
  const { calls, puts, underlyingPrice } = chain;
  if (!underlyingPrice) return [];

  // Collect distinct expirations up to 45 DTE, sort ascending.
  const expirations = new Set<string>();
  for (const c of calls) if ((c.dte ?? 999) <= 45) expirations.add(c.expiration);
  for (const p of puts) if ((p.dte ?? 999) <= 45) expirations.add(p.expiration);
  const sortedExps = [...expirations].sort();

  // Score candidates: proximity to ATM + has OCC symbol + prefer near expiries.
  const scored: Array<CandidateMeta & { _score: number }> = [];

  for (const list of [calls, puts]) {
    const isCall = list === calls;
    for (const c of list) {
      if (!c.schwabSymbol) continue;
      if ((c.dte ?? 999) > 45) continue;
      const moneyness = Math.abs(c.strike - underlyingPrice) / underlyingPrice;
      if (moneyness > 0.15) continue; // ±15% strike band
      const expIdx = sortedExps.indexOf(c.expiration);
      // Lower score = better.
      const score =
        moneyness * 100 +
        Math.max(0, expIdx) * 2 -
        Math.log10(1 + (c.volume ?? 0)) * 3 -
        Math.log10(1 + (c.openInterest ?? 0)) * 1.5;

      const occ = toPolygonOcc(c.schwabSymbol);
      if (!occ) continue;

      scored.push({
        symbol: occ,
        underlying: ticker.toUpperCase(),
        strike: c.strike,
        expiration: c.expiration,
        type: isCall ? "C" : "P",
        openInterest: c.openInterest ?? 0,
        dayVolume: c.volume ?? 0,
        _score: score,
      });
    }
  }

  scored.sort((a, b) => a._score - b._score);
  return scored.slice(0, limit).map(({ _score: _s, ...rest }) => rest);
}

/**
 * Convert Schwab OCC format "SPY   251219C00450000" (6-char root padded
 * with spaces) to Polygon "O:SPY251219C00450000".
 */
function toPolygonOcc(schwabSym: string): string | null {
  const collapsed = schwabSym.replace(/\s+/g, "");
  if (!/^[A-Z\.\/]{1,6}\d{6}[CP]\d{8}$/.test(collapsed)) return null;
  return `O:${collapsed}`;
}

// ── Scan execution ───────────────────────────────────────────────────

interface TradeBucket {
  trades: PolygonOptionTrade[];
  contracts: Map<string, CandidateMeta>;
}

function randJobId(): string {
  return `flow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Fire-and-forget: starts the scan, returns the job id immediately. */
export function startFlowScan(input: FlowScanInput): FlowScanResult {
  const jobId = randJobId();
  const durationSec = Math.min(Math.max(input.durationSec ?? DEFAULT_DURATION_SEC, 5), 90);
  const job: FlowScanResult = {
    jobId,
    status: "queued",
    durationSec,
    contractsSubscribed: 0,
    startedAt: null,
    completedAt: null,
    tickers: input.tickers.map(t => ({
      ticker: t.toUpperCase(),
      score: 0,
      scoreReason: "",
      totalPrints: 0,
      totalLiveVolume: 0,
      totalLiveNotional: 0,
      callNotional: 0,
      putNotional: 0,
      callPutNotionalRatio: null,
      sweepPrints: 0,
      blockPrints: 0,
      contractsSubscribed: 0,
      topContracts: [],
      largestPrint: null,
    })),
  };
  jobs.set(jobId, job);

  void runFlowScan(job, input).catch(err => {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.completedAt = Date.now();
    logger.error({ err, jobId }, "Unusual flow scan failed");
  });

  return job;
}

async function runFlowScan(job: FlowScanResult, input: FlowScanInput): Promise<void> {
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) throw new Error("POLYGON_API_KEY not set");
  if (!polygonOptionsWsEnabled()) throw new Error("POLYGON_OPTIONS_WS_ENABLED is not set");

  job.status = "running";
  job.startedAt = Date.now();

  // 1) Fetch chains in parallel, select candidates per ticker.
  const perTicker = new Map<string, { meta: CandidateMeta[]; chain: Awaited<ReturnType<typeof fetchPolygonChain>> }>();
  await Promise.all(job.tickers.map(async (tr) => {
    try {
      const chain = await fetchPolygonChain(tr.ticker, apiKey, { maxDte: 45, maxPages: 6, log: logger });
      if (!chain) {
        tr.error = "no_chain";
        perTicker.set(tr.ticker, { meta: [], chain: null });
        return;
      }
      const cands = selectCandidates(tr.ticker, chain, MAX_CONTRACTS_PER_TICKER);
      perTicker.set(tr.ticker, { meta: cands, chain });
    } catch (err) {
      tr.error = err instanceof Error ? err.message : String(err);
      perTicker.set(tr.ticker, { meta: [], chain: null });
    }
  }));

  // 2) Flatten + cap under MAX_TOTAL_CONTRACTS (fair-share).
  const allMeta: CandidateMeta[] = [];
  let budget = MAX_TOTAL_CONTRACTS;
  const tickerCount = Math.max(1, [...perTicker.values()].filter(v => v.meta.length).length);
  const fairShare = Math.max(1, Math.floor(budget / tickerCount));
  for (const [t, v] of perTicker.entries()) {
    const take = Math.min(v.meta.length, fairShare);
    for (let i = 0; i < take && budget > 0; i++) {
      allMeta.push(v.meta[i]!);
      budget--;
    }
    const tr = job.tickers.find(x => x.ticker === t);
    if (tr) tr.contractsSubscribed = take;
  }
  // Second pass: any leftover budget spreads across tickers whose meta
  // exceeded fair share (keeps the fuller-chain tickers well covered).
  if (budget > 0) {
    for (const [, v] of perTicker.entries()) {
      for (let i = fairShare; i < v.meta.length && budget > 0; i++) {
        allMeta.push(v.meta[i]!);
        budget--;
      }
      if (budget <= 0) break;
    }
  }

  job.contractsSubscribed = allMeta.length;
  if (!allMeta.length) {
    job.status = "complete";
    job.completedAt = Date.now();
    return;
  }

  // 3) Build buckets keyed by OCC symbol, plus one per ticker.
  const byContract = new Map<string, CandidateMeta>();
  const byTicker = new Map<string, TradeBucket>();
  for (const m of allMeta) {
    byContract.set(m.symbol, m);
    if (!byTicker.has(m.underlying)) byTicker.set(m.underlying, { trades: [], contracts: new Map() });
    byTicker.get(m.underlying)!.contracts.set(m.symbol, m);
  }

  // 4) Register trade listener (scoped) + subscribe.
  const handler = (t: PolygonOptionTrade) => {
    const meta = byContract.get(t.sym);
    if (!meta) return;
    const bucket = byTicker.get(meta.underlying);
    if (bucket) bucket.trades.push(t);
  };
  const unregister = onTrade(handler);

  const syms = allMeta.map(m => m.symbol);
  try {
    await ensureConnected();
    await subscribeContracts(syms);
  } catch (err) {
    unregister();
    throw err;
  }

  // 5) Record for durationSec.
  await new Promise<void>(resolve => setTimeout(resolve, job.durationSec * 1000));

  // 6) Unsubscribe + unregister.
  try { unsubscribeContracts(syms); } catch (err) { logger.warn({ err }, "flow scan: unsubscribe failed"); }
  unregister();

  // 7) Compute metrics per ticker.
  for (const tr of job.tickers) {
    const bucket = byTicker.get(tr.ticker);
    if (!bucket) continue;
    computeTickerMetrics(tr, bucket);
  }

  // 8) Composite score + rank.
  for (const tr of job.tickers) {
    scoreTicker(tr);
  }
  job.tickers.sort((a, b) => b.score - a.score);

  job.status = "complete";
  job.completedAt = Date.now();
}

function computeTickerMetrics(tr: FlowTickerResult, bucket: TradeBucket): void {
  const byContract = new Map<string, {
    meta: CandidateMeta;
    trades: PolygonOptionTrade[];
    liveVolume: number;
    liveNotional: number;
    sweepPrints: number;
    blockPrints: number;
    largestPrintSize: number;
    largestPrintPremium: number;
  }>();

  for (const [sym, meta] of bucket.contracts.entries()) {
    byContract.set(sym, {
      meta,
      trades: [],
      liveVolume: 0,
      liveNotional: 0,
      sweepPrints: 0,
      blockPrints: 0,
      largestPrintSize: 0,
      largestPrintPremium: 0,
    });
  }

  for (const t of bucket.trades) {
    const entry = byContract.get(t.sym);
    if (!entry) continue;
    entry.trades.push(t);
    const notional = t.price * t.size * 100;
    entry.liveVolume += t.size;
    entry.liveNotional += notional;
    if (t.size >= BLOCK_MIN_SIZE) entry.blockPrints++;
    if (t.conditions.some(c => SWEEP_CONDITION_CODES.has(c))) entry.sweepPrints++;
    if (t.size > entry.largestPrintSize) {
      entry.largestPrintSize = t.size;
      entry.largestPrintPremium = notional;
    }
    if (entry.meta.type === "C") tr.callNotional += notional;
    else tr.putNotional += notional;

    if (!tr.largestPrint || t.size > tr.largestPrint.size) {
      tr.largestPrint = {
        symbol: t.sym,
        size: t.size,
        price: t.price,
        premium: notional,
        timestamp: t.timestamp,
      };
    }
  }

  // Sweep detection (time-clustered): for each contract, scan for
  // windows of SWEEP_WINDOW_MS containing ≥ SWEEP_MIN_LEGS prints.
  for (const entry of byContract.values()) {
    if (entry.trades.length < SWEEP_MIN_LEGS) continue;
    entry.trades.sort((a, b) => a.timestamp - b.timestamp);
    let i = 0;
    for (let j = 0; j < entry.trades.length; j++) {
      while (entry.trades[j]!.timestamp - entry.trades[i]!.timestamp > SWEEP_WINDOW_MS) i++;
      if (j - i + 1 >= SWEEP_MIN_LEGS) {
        entry.sweepPrints++;
        i = j + 1; // don't double-count overlapping windows
      }
    }
  }

  const contractMetrics: FlowContractMetric[] = [];
  for (const entry of byContract.values()) {
    const totalVol = entry.meta.dayVolume + entry.liveVolume;
    const volOiRatio = entry.meta.openInterest > 0 ? totalVol / entry.meta.openInterest : 0;
    contractMetrics.push({
      symbol: entry.meta.symbol,
      underlying: entry.meta.underlying,
      strike: entry.meta.strike,
      expiration: entry.meta.expiration,
      type: entry.meta.type,
      liveVolume: entry.liveVolume,
      liveNotional: entry.liveNotional,
      openInterest: entry.meta.openInterest,
      dayVolume: entry.meta.dayVolume,
      volOiRatio,
      sweepPrints: entry.sweepPrints,
      blockPrints: entry.blockPrints,
      largestPrintSize: entry.largestPrintSize,
      largestPrintPremium: entry.largestPrintPremium,
      tradeCount: entry.trades.length,
    });
    tr.totalPrints += entry.trades.length;
    tr.totalLiveVolume += entry.liveVolume;
    tr.totalLiveNotional += entry.liveNotional;
    tr.sweepPrints += entry.sweepPrints;
    tr.blockPrints += entry.blockPrints;
  }

  contractMetrics.sort((a, b) => b.liveNotional - a.liveNotional);
  tr.topContracts = contractMetrics.slice(0, 6);
  tr.callPutNotionalRatio = tr.putNotional > 0 ? tr.callNotional / tr.putNotional : null;
}

function scoreTicker(tr: FlowTickerResult): void {
  // Composite 0-100ish score. Transparent formula so orchestrator output
  // is explainable in UI / logs:
  //   notional contribution:   log10(1 + notional)   × 10
  //   sweep contribution:      sweepPrints           × 4
  //   block contribution:      blockPrints           × 3
  //   vol/OI contribution:     max(top volOi ratio)  × 10 (capped at 30)
  //   skew contribution:       abs(log2 call/put)    × 4  (capped at 12)
  const notionalPts = Math.log10(1 + tr.totalLiveNotional) * 10;
  const sweepPts = tr.sweepPrints * 4;
  const blockPts = tr.blockPrints * 3;
  const topVolOi = tr.topContracts.reduce((m, c) => Math.max(m, c.volOiRatio), 0);
  const volOiPts = Math.min(30, topVolOi * 10);
  let skewPts = 0;
  if (tr.callPutNotionalRatio && tr.callPutNotionalRatio > 0 && isFinite(tr.callPutNotionalRatio)) {
    skewPts = Math.min(12, Math.abs(Math.log2(tr.callPutNotionalRatio)) * 4);
  }
  tr.score = Math.round((notionalPts + sweepPts + blockPts + volOiPts + skewPts) * 10) / 10;
  tr.scoreReason = `notional=${notionalPts.toFixed(1)} sweep=${sweepPts.toFixed(1)} block=${blockPts.toFixed(1)} volOi=${volOiPts.toFixed(1)} skew=${skewPts.toFixed(1)}`;
}
