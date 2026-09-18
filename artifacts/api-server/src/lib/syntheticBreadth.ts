/**
 * Breadth measured over the Liquid Core universe, from Schwab REST quotes.
 *
 * The NYSE and NASDAQ breadth indices ($ADVN, $DECN, $UVOL, $DVOL, $TRIN, $ADD)
 * reached this process only through the IBKR stream. With IBKR gone they are
 * absent, which silently zeroed the breadth cluster and dragged directional
 * conviction toward NEUTRAL on every run.
 *
 * This computes the same ratios directly: advancers, decliners, up volume, and
 * down volume across the ~120 single stocks in the Liquid Core universe, split
 * by primary listing. It is participation breadth over the names the desk
 * actually trades, not the full exchange tape, so it is labelled as a proxy
 * everywhere it surfaces. The ratio components the pulse engine scores
 * (advancers over decliners, up over down volume, and TRIN) are scale free, so
 * the existing thresholds carry over unchanged. The net-advance line is rescaled
 * to a notional 3,000-issue exchange so its absolute thresholds still mean what
 * they meant.
 */
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";
import { fetchSchwabBatchQuotesForSymbolsBestToken } from "./schwabBatchQuotes.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "syntheticBreadth" });

/** Index, leveraged, and commodity trackers are not issues; counting them double counts the tape. */
const NON_ISSUE_SYMBOLS = new Set(["SPY", "QQQ", "IWM", "DIA", "TQQQ", "GLD", "SLV", "USO"]);

/** Notional exchange size the net-advance line is scaled to, matching $ADD thresholds. */
export const ADD_SCALE_ISSUES = 3000;
/** Below this many priced names an exchange leg is not reported at all. */
export const MIN_SAMPLE_PER_EXCHANGE = 20;
const BREADTH_TTL_MS = 10 * 60 * 1000;

export interface ExchangeBreadth {
  advn: number;
  decn: number;
  unchanged: number;
  uvol: number;
  dvol: number;
  /** Net advancers rescaled to a 3,000-issue exchange. */
  add: number;
  /** (advancers/decliners) ÷ (up volume/down volume); null when either leg is zero. */
  trin: number | null;
  sampleSize: number;
}

export interface SyntheticBreadth {
  nyse: ExchangeBreadth | null;
  nasdaq: ExchangeBreadth | null;
  asOf: number;
  /** Fraction of requested names that came back priced. */
  coverage: number;
  source: "schwab_liquid_core_proxy";
}

export interface BreadthInputQuote {
  symbol: string;
  changePct: number | null;
  volume: number | null;
}

function nyseNames(): string[] {
  return LIQUID_CORE_SYMBOLS.filter((e) => e.primaryListing === "NYSE" && !NON_ISSUE_SYMBOLS.has(e.symbol)).map((e) => e.symbol);
}

function nasdaqNames(): string[] {
  return LIQUID_CORE_SYMBOLS.filter((e) => e.primaryListing === "NASDAQ" && !NON_ISSUE_SYMBOLS.has(e.symbol)).map((e) => e.symbol);
}

/** All single-stock Liquid Core names, both venues. */
export function breadthUniverse(): string[] {
  return [...nyseNames(), ...nasdaqNames()];
}

/** Pure tally over one venue's quotes. Exported for tests. */
export function tallyExchange(quotes: readonly BreadthInputQuote[]): ExchangeBreadth | null {
  let advn = 0;
  let decn = 0;
  let unchanged = 0;
  let uvol = 0;
  let dvol = 0;
  let sampleSize = 0;

  for (const q of quotes) {
    if (q.changePct === null || !Number.isFinite(q.changePct)) continue;
    sampleSize += 1;
    const vol = q.volume !== null && Number.isFinite(q.volume) && q.volume > 0 ? q.volume : 0;
    if (q.changePct > 0) {
      advn += 1;
      uvol += vol;
    } else if (q.changePct < 0) {
      decn += 1;
      dvol += vol;
    } else {
      unchanged += 1;
    }
  }

  if (sampleSize < MIN_SAMPLE_PER_EXCHANGE) return null;

  const directional = advn + decn;
  const add = directional > 0 ? Math.round(((advn - decn) / directional) * ADD_SCALE_ISSUES) : 0;
  const trin = decn > 0 && dvol > 0 && uvol > 0 ? (advn / decn) / (uvol / dvol) : null;

  return {
    advn,
    decn,
    unchanged,
    uvol,
    dvol,
    add,
    trin: trin === null || !Number.isFinite(trin) ? null : Math.round(trin * 1000) / 1000,
    sampleSize,
  };
}

let cached: SyntheticBreadth | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let inFlight = false;

/** Fetches one snapshot and recomputes the proxy. Never throws. */
export async function refreshSyntheticBreadth(): Promise<SyntheticBreadth | null> {
  if (inFlight) return cached;
  inFlight = true;
  try {
    const nyse = nyseNames();
    const nasdaq = nasdaqNames();
    const all = [...nyse, ...nasdaq];
    const quotes = await fetchSchwabBatchQuotesForSymbolsBestToken(all);
    if (quotes.size === 0) return cached;

    const pick = (syms: string[]): BreadthInputQuote[] => {
      const out: BreadthInputQuote[] = [];
      for (const s of syms) {
        const q = quotes.get(s.toUpperCase());
        if (!q) continue;
        out.push({ symbol: s, changePct: q.changePct, volume: q.volume });
      }
      return out;
    };

    const next: SyntheticBreadth = {
      nyse: tallyExchange(pick(nyse)),
      nasdaq: tallyExchange(pick(nasdaq)),
      asOf: Date.now(),
      coverage: Math.round((quotes.size / Math.max(1, all.length)) * 1000) / 1000,
      source: "schwab_liquid_core_proxy",
    };
    if (next.nyse === null && next.nasdaq === null) return cached;
    cached = next;
    return cached;
  } catch (err) {
    log.warn({ err }, "synthetic breadth refresh failed");
    return cached;
  } finally {
    inFlight = false;
  }
}

/** Last computed proxy, or null when stale or never computed. */
export function getSyntheticBreadth(now = Date.now()): SyntheticBreadth | null {
  if (!cached) return null;
  if (now - cached.asOf > BREADTH_TTL_MS) return null;
  return cached;
}

/** Starts the refresh loop. Idempotent; the timer never holds the process open. */
export function startSyntheticBreadthPolling(intervalMs = 60_000): void {
  if (refreshTimer) return;
  void refreshSyntheticBreadth().catch(() => {});
  refreshTimer = setInterval(() => {
    void refreshSyntheticBreadth().catch((err) => log.warn({ err }, "synthetic breadth poll failed"));
  }, intervalMs);
  refreshTimer.unref?.();
}

export function stopSyntheticBreadthPolling(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/** Test seam. */
export function __setSyntheticBreadthForTest(value: SyntheticBreadth | null): void {
  cached = value;
}
