/**
 * Schwab REST source for the `$`-prefixed index indicators (VIX family, rate
 * indices, and whatever breadth indices the account is entitled to).
 *
 * These used to arrive only over the IBKR stream. IBKR is no longer funded, so
 * they come from `marketdata/v1/quotes` instead: one batched poll covers the
 * whole set. Schwab does not carry every ThinkorSwim symbol through the API, so
 * the poller learns which ones it rejects and stops asking, retrying
 * occasionally in case the entitlement changes. Nothing here throws: a symbol
 * Schwab will not serve is simply absent, and the pulse engine already scores
 * every cluster from whatever subset it is given.
 */
import { SCHWAB_MARKETDATA, SCHWAB_QUOTES_BATCH_SIZE } from "./schwabBatchQuotes.js";
import { getBestAccessToken } from "./tokenStore.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "schwabIndexQuotes" });

export interface IndexQuote {
  symbol: string;
  last: number | null;
  close: number | null;
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  ts: number;
}

/** Consecutive empty responses before a symbol is parked as unsupported. */
const MISS_LIMIT = 3;
/** How long a parked symbol stays parked before one more attempt. */
const RETRY_PARKED_MS = 6 * 60 * 60 * 1000;
const QUOTE_TTL_MS = 10 * 60 * 1000;

const registered = new Set<string>();
const cache = new Map<string, IndexQuote>();
const misses = new Map<string, number>();
const parkedAt = new Map<string, number>();

let pollTimer: NodeJS.Timeout | null = null;
let lastPollAt = 0;
let lastPollOk = false;

/**
 * Symbols this process should poll. Callers register at module load; the pulse
 * symbol table is the only caller today. Registration is additive and idempotent.
 */
export function registerSchwabIndexSymbols(symbols: readonly string[]): void {
  for (const s of symbols) {
    const u = s.trim().toUpperCase();
    if (u) registered.add(u);
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Schwab returns index quotes under `quote`; some index rows use `regular` only. */
export function parseIndexQuoteEntry(symbol: string, entry: unknown): IndexQuote | null {
  if (!entry || typeof entry !== "object") return null;
  const root = entry as Record<string, unknown>;
  const q = (root.quote ?? root.regular ?? root) as Record<string, unknown>;
  if (!q || typeof q !== "object") return null;

  const last = num(q.lastPrice) ?? num(q.mark) ?? num(q.regularMarketLastPrice) ?? num(q.closePrice);
  if (last === null) return null;
  const close = num(q.closePrice) ?? num(q.regularMarketPreviousClose);
  const change = num(q.netChange) ?? (close !== null ? last - close : null);
  const changePct =
    num(q.netPercentChange) ??
    num(q.netPercentChangeInDouble) ??
    (close !== null && close !== 0 ? ((last - close) / close) * 100 : null);

  return {
    symbol,
    last,
    close,
    change,
    changePct,
    high: num(q.highPrice) ?? num(q.highPrice52Week),
    low: num(q.lowPrice),
    volume: num(q.totalVolume),
    ts: Date.now(),
  };
}

/** Symbols due for a request this cycle: everything registered except parked ones. */
export function selectPollSymbols(now = Date.now()): string[] {
  const out: string[] = [];
  for (const s of registered) {
    const parked = parkedAt.get(s);
    if (parked !== undefined && now - parked < RETRY_PARKED_MS) continue;
    out.push(s);
  }
  return out;
}

async function fetchBatch(batch: string[], token: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `${SCHWAB_MARKETDATA}/quotes?symbols=${encodeURIComponent(batch.join(","))}&fields=quote`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** One poll pass. Returns how many symbols produced a usable quote. */
export async function pollSchwabIndexQuotes(): Promise<{ requested: number; filled: number; parked: number }> {
  const token = getBestAccessToken();
  const symbols = selectPollSymbols();
  if (!token || symbols.length === 0) {
    lastPollAt = Date.now();
    lastPollOk = false;
    return { requested: symbols.length, filled: 0, parked: parkedAt.size };
  }

  let filled = 0;
  let anyResponse = false;

  for (let i = 0; i < symbols.length; i += SCHWAB_QUOTES_BATCH_SIZE) {
    const batch = symbols.slice(i, i + SCHWAB_QUOTES_BATCH_SIZE);
    const json = await fetchBatch(batch, token);
    if (!json) continue;
    anyResponse = true;
    for (const sym of batch) {
      const parsed = parseIndexQuoteEntry(sym, json[sym] ?? json[sym.toUpperCase()]);
      if (parsed) {
        cache.set(sym, parsed);
        misses.delete(sym);
        parkedAt.delete(sym);
        filled += 1;
      } else {
        const n = (misses.get(sym) ?? 0) + 1;
        misses.set(sym, n);
        if (n >= MISS_LIMIT && !parkedAt.has(sym)) {
          parkedAt.set(sym, Date.now());
          log.info({ symbol: sym }, "Schwab does not serve this index symbol; parked");
        }
      }
    }
  }

  lastPollAt = Date.now();
  lastPollOk = anyResponse;
  return { requested: symbols.length, filled, parked: parkedAt.size };
}

/** Cached quote for a display symbol, or null when absent or older than the TTL. */
export function getSchwabIndexQuote(display: string, now = Date.now()): IndexQuote | null {
  const q = cache.get(display.trim().toUpperCase());
  if (!q) return null;
  if (now - q.ts > QUOTE_TTL_MS) return null;
  return q;
}

export function getSchwabIndexQuoteDiagnostics(): {
  registered: number;
  cached: number;
  parked: string[];
  lastPollAt: number;
  lastPollOk: boolean;
} {
  return {
    registered: registered.size,
    cached: cache.size,
    parked: [...parkedAt.keys()].sort(),
    lastPollAt,
    lastPollOk,
  };
}

/** Starts the background poll loop. Idempotent; the timer never holds the process open. */
export function startSchwabIndexQuotePolling(intervalMs = 30_000): void {
  if (pollTimer) return;
  void pollSchwabIndexQuotes().catch(() => {});
  pollTimer = setInterval(() => {
    void pollSchwabIndexQuotes().catch((err) => log.warn({ err }, "index quote poll failed"));
  }, intervalMs);
  pollTimer.unref?.();
}

export function stopSchwabIndexQuotePolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Test seam. */
export function __resetSchwabIndexQuotes(): void {
  registered.clear();
  cache.clear();
  misses.clear();
  parkedAt.clear();
  lastPollAt = 0;
  lastPollOk = false;
}
