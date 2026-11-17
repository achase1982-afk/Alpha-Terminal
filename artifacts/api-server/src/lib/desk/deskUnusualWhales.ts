import { deskEnv } from "./deskEnv.js";
import { deskTouchFeed, deskMarkFeedError, deskMarkFeedNotConfigured } from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const UW_BASE = "https://api.unusualwhales.com";
const CACHE_TTL_MS = 60_000;

let cacheBody: unknown[] | null = null;
let cacheAt = 0;

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

export function getUwApiKey(): string {
  return deskEnv("UW_API_KEY_NEW", "UW_API_KEY");
}

export async function deskFetchUwFlow(): Promise<{ alerts: unknown[]; asOfMs: number }> {
  const key = getUwApiKey();
  if (!key) {
    deskMarkFeedNotConfigured("uw_flow");
    return { alerts: [], asOfMs: Date.now() };
  }

  if (cacheBody && Date.now() - cacheAt < CACHE_TTL_MS) {
    deskTouchFeed("uw_flow");
    return { alerts: cacheBody, asOfMs: cacheAt };
  }

  const release = await uwSemaphore.acquire();
  try {
    const url = `${UW_BASE}/api/option-trades/flow-alerts?limit=100`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "UW-CLIENT-API-ID": "100001",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const msg = `uw_flow_http_${res.status}`;
      deskMarkFeedError("uw_flow", msg);
      logger.warn({ status: res.status }, "Desk UW flow fetch failed");
      return { alerts: cacheBody ?? [], asOfMs: cacheAt || Date.now() };
    }
    const json = (await res.json()) as { data?: unknown[] } | unknown[];
    const alerts = Array.isArray(json)
      ? json
      : Array.isArray((json as { data?: unknown[] }).data)
        ? (json as { data: unknown[] }).data
        : [];
    cacheBody = alerts;
    cacheAt = Date.now();
    deskTouchFeed("uw_flow");
    return { alerts, asOfMs: cacheAt };
  } catch (err) {
    deskMarkFeedError("uw_flow", "uw_flow_fetch_error");
    logger.warn({ err }, "Desk UW flow error");
    return { alerts: cacheBody ?? [], asOfMs: cacheAt || Date.now() };
  } finally {
    release();
  }
}