import { DESK_UW_CACHE_TTL_MS } from "../../deskPollCadence.js";
import { deskEnv } from "../../deskEnv.js";
import { deskTouchFeed, deskMarkFeedNotConfigured } from "../../deskFeedFreshness.js";
import { deskApplyUwHttpFeedStatus } from "./deskUwStatus.js";
import { deskFilterUwFlowAlerts, deskUwFlowTickerQuery } from "./deskUwFlow.js";
import { logger } from "../../../logger.js";
import { deskUwAddonEnabled } from "./deskUwEnabled.js";
import { deskUwClearLastHttpStatus, deskUwPollPaused } from "./deskUwPollControl.js";

const UW_BASE = "https://api.unusualwhales.com";

const FLOW_CACHE_ALL = "__all__";
const FLOW_CACHE_SPX = "__spx__";

const cacheBody = new Map<string, unknown[]>();
const cacheAt = new Map<string, number>();

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return () => this.release();
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const uwSemaphore = new Semaphore(3);

export async function withUwConcurrencySlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = await uwSemaphore.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

export function getUwApiKey(): string {
  return deskEnv("UW_API_KEY_NEW", "UW_API_KEY");
}

export type DeskUwFlowResult = {
  ok: boolean;
  alerts: unknown[];
  asOfMs: number;
  status?: number;
  error?: string;
  symbol?: string;
};

function cacheFresh(cacheKey: string, now = Date.now()): boolean {
  const hitAt = cacheAt.get(cacheKey);
  return hitAt != null && now - hitAt <= DESK_UW_CACHE_TTL_MS;
}

function readFlowCache(cacheKey: string, symbol: string | undefined, now = Date.now()): DeskUwFlowResult | null {
  const hit = cacheBody.get(cacheKey);
  const hitAt = cacheAt.get(cacheKey);
  if (!hit || hitAt == null || now - hitAt > DESK_UW_CACHE_TTL_MS) return null;
  const filtered = deskFilterUwFlowAlerts(hit, symbol);
  return { ok: true, alerts: filtered, asOfMs: hitAt, symbol: symbol?.trim().toUpperCase() };
}

export function deskGetCachedUwFlow(symbol?: string, now = Date.now()): DeskUwFlowResult | null {
  const sym = symbol?.trim().toUpperCase();
  if (sym === "SPX" || sym === "SPXW") {
    const spx = readFlowCache(FLOW_CACHE_SPX, sym, now);
    if (spx) return spx;
  }
  return readFlowCache(FLOW_CACHE_ALL, symbol, now);
}

export function deskSeedUwFlowCacheForTests(alerts: unknown[], atMs = Date.now()): void {
  cacheBody.set(FLOW_CACHE_ALL, alerts);
  cacheAt.set(FLOW_CACHE_ALL, atMs);
}

export function deskSeedUwFlowSpxCacheForTests(alerts: unknown[], atMs = Date.now()): void {
  cacheBody.set(FLOW_CACHE_SPX, alerts);
  cacheAt.set(FLOW_CACHE_SPX, atMs);
}

async function deskFetchUwFlowBucket(cacheKey: string, tickerSymbol?: string): Promise<void> {
  if (deskUwPollPaused()) return;
  const key = getUwApiKey();
  if (!key) {
    deskMarkFeedNotConfigured("uw_flow", "unusual_whales");
    return;
  }

  await withUwConcurrencySlot(async () => {
    const params = new URLSearchParams({ limit: "100" });
    const tickers = tickerSymbol ? deskUwFlowTickerQuery(tickerSymbol) : undefined;
    if (tickers) params.set("ticker_symbol", tickers);

    const url = `${UW_BASE}/api/option-trades/flow-alerts?${params}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "UW-CLIENT-API-ID": "100001",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const retryAfterSec = Number(res.headers.get("Retry-After")) || undefined;
    if (!res.ok) {
      deskApplyUwHttpFeedStatus("uw_flow", res.status, "unusual_whales", retryAfterSec);
      logger.warn({ status: res.status, cacheKey, tickerSymbol }, "Desk UW flow fetch failed");
      return;
    }
    const json = (await res.json()) as { data?: unknown[] } | unknown[];
    const raw = Array.isArray(json)
      ? json
      : Array.isArray((json as { data?: unknown[] }).data)
        ? (json as { data: unknown[] }).data
        : [];
    const at = Date.now();
    cacheBody.set(cacheKey, raw);
    cacheAt.set(cacheKey, at);
    deskUwClearLastHttpStatus();
    if (cacheKey === FLOW_CACHE_ALL) {
      deskTouchFeed("uw_flow", at, "unusual_whales");
    }
  });
}

/** Poller-only: fetches flow from UW when addon enabled and not backed off. */
export async function deskRefreshUwFlow(): Promise<void> {
  if (!deskUwAddonEnabled() || deskUwPollPaused()) return;
  const key = getUwApiKey();
  if (!key) {
    deskMarkFeedNotConfigured("uw_flow", "unusual_whales");
    return;
  }

  try {
    await deskFetchUwFlowBucket(FLOW_CACHE_ALL);
    if (!deskUwPollPaused()) await deskFetchUwFlowBucket(FLOW_CACHE_SPX, "SPX");
  } catch (err) {
    deskApplyUwHttpFeedStatus("uw_flow", 0);
    logger.warn({ err }, "Desk UW flow error");
  }
}

export function deskResetUwFlowCacheForTests(): void {
  cacheBody.clear();
  cacheAt.clear();
}
