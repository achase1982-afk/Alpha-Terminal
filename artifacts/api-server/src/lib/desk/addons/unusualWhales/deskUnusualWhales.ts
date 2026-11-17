import { deskEnv } from "../../deskEnv.js";
import { deskTouchFeed, deskMarkFeedNotConfigured } from "../../deskFeedFreshness.js";
import { deskApplyUwHttpFeedStatus } from "./deskUwStatus.js";
import { deskFilterUwFlowAlerts, deskUwFlowTickerQuery } from "./deskUwFlow.js";
import { logger } from "../../../logger.js";
import { deskUwAddonEnabled } from "./deskUwEnabled.js";
import { deskUwPollPaused } from "./deskUwPollControl.js";

const UW_BASE = "https://api.unusualwhales.com";
const CACHE_TTL_MS = 60_000;

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

function flowCacheKey(symbol?: string): string {
  const s = symbol?.trim();
  return s ? s.toUpperCase() : "__all__";
}

export function deskGetCachedUwFlow(symbol?: string): DeskUwFlowResult | null {
  const cacheKey = flowCacheKey(symbol);
  const hit = cacheBody.get(cacheKey);
  const hitAt = cacheAt.get(cacheKey);
  if (!hit || hitAt == null || Date.now() - hitAt > CACHE_TTL_MS) return null;
  const filtered = deskFilterUwFlowAlerts(hit, symbol);
  return { ok: true, alerts: filtered, asOfMs: hitAt, symbol: symbol?.trim().toUpperCase() };
}

/** Poller-only: fetches flow from UW when addon enabled and not backed off. */
export async function deskRefreshUwFlow(symbol?: string): Promise<void> {
  if (!deskUwAddonEnabled() || deskUwPollPaused()) return;
  const key = getUwApiKey();
  if (!key) {
    deskMarkFeedNotConfigured("uw_flow", "unusual_whales");
    return;
  }

  try {
    await withUwConcurrencySlot(async () => {
      const params = new URLSearchParams({ limit: "100" });
      const tickers = deskUwFlowTickerQuery(symbol);
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
        logger.warn({ status: res.status, symbol }, "Desk UW flow fetch failed");
        return;
      }
      const json = (await res.json()) as { data?: unknown[] } | unknown[];
      const raw = Array.isArray(json)
        ? json
        : Array.isArray((json as { data?: unknown[] }).data)
          ? (json as { data: unknown[] }).data
          : [];
      const cacheKey = flowCacheKey(symbol);
      cacheBody.set(cacheKey, raw);
      const at = Date.now();
      cacheAt.set(cacheKey, at);
      deskTouchFeed("uw_flow", at, "unusual_whales");
    });
  } catch (err) {
    deskApplyUwHttpFeedStatus("uw_flow", 0);
    logger.warn({ err, symbol }, "Desk UW flow error");
  }
}

export function deskResetUwFlowCacheForTests(): void {
  cacheBody.clear();
  cacheAt.clear();
}