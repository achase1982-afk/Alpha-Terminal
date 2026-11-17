import pLimit from "p-limit";
import { deskEnv } from "./deskEnv.js";
import { DESK_DEFAULT_NEWS_SYMBOLS } from "./deskDefaultNewsSymbols.js";
import { logger } from "../logger.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedRateLimited,
} from "./deskFeedFreshness.js";

const log = {
  warn: (o: unknown, m?: string) => logger.warn(o, m),
  info: (o: unknown, m?: string) => logger.info(o, m),
};

export const FINNHUB_DESK_CALL_TIMEOUT_MS = 5_000;
export const FINNHUB_DESK_COMPANY_CONCURRENCY = 4;
export const FINNHUB_DESK_MAX_PER_MINUTE = 60;
export const FINNHUB_ONDEMAND_MAX_PER_MINUTE = 45;
export const FINNHUB_BACKGROUND_MAX_PER_MINUTE = 15;
export const FINNHUB_BACKGROUND_SLOT_BUDGET_MS = 1_000;
export const FINNHUB_ONDEMAND_SLOT_BUDGET_MS = 2_000;
const FINNHUB_RATE_WINDOW_MS = 60_000;

export type DeskFinnhubLoadMode = "background" | "ondemand";

type FinnhubRateSlot = { at: number; mode: DeskFinnhubLoadMode };

const recentFinnhubCallTimes: FinnhubRateSlot[] = [];
const companyFetchLimit = pLimit(FINNHUB_DESK_COMPANY_CONCURRENCY);

export class DeskFinnhubClientRateLimitError extends Error {
  readonly retryAfterSec: number;

  constructor(retryAfterSec: number) {
    super("finnhub_client_rate_limited");
    this.name = "DeskFinnhubClientRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

function pruneFinnhubRateWindow(now: number): void {
  while (recentFinnhubCallTimes.length > 0 && now - recentFinnhubCallTimes[0]!.at >= FINNHUB_RATE_WINDOW_MS) {
    recentFinnhubCallTimes.shift();
  }
}

function finnhubRateCounts(now: number): {
  total: number;
  ondemand: number;
  background: number;
} {
  pruneFinnhubRateWindow(now);
  let ondemand = 0;
  let background = 0;
  for (const slot of recentFinnhubCallTimes) {
    if (slot.mode === "ondemand") ondemand += 1;
    else background += 1;
  }
  return { total: recentFinnhubCallTimes.length, ondemand, background };
}

function finnhubModeCap(mode: DeskFinnhubLoadMode): number {
  return mode === "ondemand" ? FINNHUB_ONDEMAND_MAX_PER_MINUTE : FINNHUB_BACKGROUND_MAX_PER_MINUTE;
}

function finnhubSlotAvailable(mode: DeskFinnhubLoadMode, now: number): boolean {
  const counts = finnhubRateCounts(now);
  if (counts.total >= FINNHUB_DESK_MAX_PER_MINUTE) return false;
  if (mode === "ondemand" && counts.ondemand >= FINNHUB_ONDEMAND_MAX_PER_MINUTE) return false;
  if (mode === "background" && counts.background >= FINNHUB_BACKGROUND_MAX_PER_MINUTE) return false;
  return true;
}

function finnhubRetryAfterSec(now: number, mode: DeskFinnhubLoadMode): number {
  pruneFinnhubRateWindow(now);
  let waitMs = 1_000;
  if (recentFinnhubCallTimes.length > 0) {
    const oldest = recentFinnhubCallTimes[0]!.at;
    waitMs = Math.max(FINNHUB_RATE_WINDOW_MS - (now - oldest) + 25, 50);
  }
  const counts = finnhubRateCounts(now);
  const modeCount = mode === "ondemand" ? counts.ondemand : counts.background;
  const modeCap = finnhubModeCap(mode);
  if (modeCount >= modeCap) {
    for (const slot of recentFinnhubCallTimes) {
      if (slot.mode !== mode) continue;
      const slotWait = FINNHUB_RATE_WINDOW_MS - (now - slot.at) + 25;
      if (slotWait > 0) waitMs = Math.min(waitMs, slotWait);
    }
  }
  return Math.max(1, Math.ceil(waitMs / 1000));
}

function recordFinnhubRateSlot(mode: DeskFinnhubLoadMode, at = Date.now()): void {
  pruneFinnhubRateWindow(at);
  recentFinnhubCallTimes.push({ at, mode });
}

async function tryAcquireFinnhubRateSlot(
  mode: DeskFinnhubLoadMode,
  budgetMs: number,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const now = Date.now();
    if (finnhubSlotAvailable(mode, now)) {
      recordFinnhubRateSlot(mode, now);
      return { ok: true };
    }
    const remaining = deadline - now;
    if (remaining <= 0) break;
    const waitMs = Math.min(50, remaining);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return { ok: false, retryAfterSec: finnhubRetryAfterSec(Date.now(), mode) };
}

async function finnhubDeskHttpGet(url: string, mode: DeskFinnhubLoadMode, slotBudgetMs: number): Promise<Response> {
  const slot = await tryAcquireFinnhubRateSlot(mode, slotBudgetMs);
  if (!slot.ok) {
    if (mode === "ondemand") {
      throw new DeskFinnhubClientRateLimitError(slot.retryAfterSec);
    }
    throw new DeskFinnhubRateSlotSkippedError();
  }
  return fetch(url, { signal: AbortSignal.timeout(FINNHUB_DESK_CALL_TIMEOUT_MS) });
}

class DeskFinnhubRateSlotSkippedError extends Error {
  constructor() {
    super("finnhub_rate_slot_skipped");
    this.name = "DeskFinnhubRateSlotSkippedError";
  }
}

export type DeskFinnhubFetchResult = {
  ok: boolean;
  status: number;
  articles: unknown[];
  skippedRateCap?: boolean;
  clientRateLimited?: boolean;
};

export function getFinnhubDeskApiKey(): string {
  return deskEnv("FINNHUB_API_KEY");
}

export async function fetchFinnhubMarketGeneralNews(
  apiKey: string,
  mode: DeskFinnhubLoadMode,
  slotBudgetMs: number,
): Promise<DeskFinnhubFetchResult> {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(apiKey)}`;
  try {
    const res = await finnhubDeskHttpGet(url, mode, slotBudgetMs);
    if (!res.ok) {
      log.warn({ status: res.status }, "Finnhub general news HTTP failed");
      return { ok: false, status: res.status, articles: [] };
    }
    const raw = await res.json();
    return { ok: true, status: res.status, articles: Array.isArray(raw) ? raw : [] };
  } catch (err) {
    if (err instanceof DeskFinnhubClientRateLimitError) throw err;
    if (err instanceof DeskFinnhubRateSlotSkippedError) {
      return { ok: false, status: 0, articles: [], skippedRateCap: true };
    }
    log.warn({ err }, "Finnhub general news fetch failed");
    return { ok: false, status: 0, articles: [] };
  }
}

export async function deskFetchFinnhubCompanyNews(
  symbol: string,
  apiKey: string,
  mode: DeskFinnhubLoadMode,
  slotBudgetMs: number,
): Promise<DeskFinnhubFetchResult> {
  const clean = symbol.trim().toUpperCase();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = oneWeekAgo.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(clean)}&from=${fromDate}&to=${toDate}&token=${encodeURIComponent(apiKey)}`;
  try {
    const res = await finnhubDeskHttpGet(url, mode, slotBudgetMs);
    if (!res.ok) {
      log.warn({ status: res.status, symbol: clean }, "Finnhub company news HTTP failed");
      return { ok: false, status: res.status, articles: [] };
    }
    const raw = (await res.json()) as unknown;
    return { ok: true, status: res.status, articles: Array.isArray(raw) ? raw : [] };
  } catch (err) {
    if (err instanceof DeskFinnhubClientRateLimitError) throw err;
    if (err instanceof DeskFinnhubRateSlotSkippedError) {
      return { ok: false, status: 0, articles: [], skippedRateCap: true };
    }
    log.warn({ err, symbol: clean }, "Finnhub company news fetch failed");
    return { ok: false, status: 0, articles: [] };
  }
}

export function deskApplyFinnhubHttpStatus(status: number): void {
  if (status === 401 || status === 403) {
    deskMarkFeedAuthError("news", `finnhub_http_${status}`, "finnhub");
    return;
  }
  if (status === 429) {
    deskMarkFeedRateLimited("news", `finnhub_http_${status}`, "finnhub");
    return;
  }
  if (status > 0) {
    deskMarkFeedError("news", `finnhub_http_${status}`, "finnhub");
  } else if (status === 0) {
    deskMarkFeedError("news", "finnhub_fetch_error", "finnhub");
  }
}

export async function deskLoadFinnhubDeskArticles(
  symbols: string[],
  mode: DeskFinnhubLoadMode = "ondemand",
): Promise<{
  articles: unknown[];
  hadHttp2xx: boolean;
  lastErrorStatus?: number;
  skippedRateCap?: boolean;
  clientRateLimited?: boolean;
  retryAfterSec?: number;
  missingSymbols?: string[];
}> {
  const key = getFinnhubDeskApiKey();
  if (!key) return { articles: [], hadHttp2xx: false };

  const perCallSlotBudgetMs =
    mode === "background" ? FINNHUB_BACKGROUND_SLOT_BUDGET_MS : FINNHUB_ONDEMAND_SLOT_BUDGET_MS;

  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const deskSyms = uniq.length ? uniq : [...DESK_DEFAULT_NEWS_SYMBOLS];
  const all: unknown[] = [];
  let hadHttp2xx = false;
  let lastErrorStatus: number | undefined;
  let skippedRateCap = false;
  let clientRateLimited = false;
  let retryAfterSec: number | undefined;
  const missingSymbols: string[] = [];

  let general: DeskFinnhubFetchResult;
  try {
    general = await fetchFinnhubMarketGeneralNews(key, mode, perCallSlotBudgetMs);
  } catch (err) {
    if (err instanceof DeskFinnhubClientRateLimitError) {
      return {
        articles: [],
        hadHttp2xx: false,
        clientRateLimited: true,
        skippedRateCap: true,
        retryAfterSec: err.retryAfterSec,
      };
    }
    throw err;
  }
  if (general.skippedRateCap || general.clientRateLimited) {
    skippedRateCap = true;
    clientRateLimited = Boolean(general.clientRateLimited);
    if (general.clientRateLimited && mode === "ondemand") {
      retryAfterSec = retryAfterSec ?? finnhubRetryAfterSec(Date.now(), mode);
    }
  } else if (general.ok) {
    hadHttp2xx = true;
    for (const a of general.articles) all.push(a);
  } else if (general.status > 0) {
    lastErrorStatus = general.status;
  }

  const companyResults = await Promise.all(
    deskSyms.map((sym) =>
      companyFetchLimit(async () => {
        try {
          const r = await deskFetchFinnhubCompanyNews(sym, key, mode, perCallSlotBudgetMs);
          return { sym, r };
        } catch (err) {
          if (err instanceof DeskFinnhubClientRateLimitError) {
            return {
              sym,
              r: {
                ok: false,
                status: 0,
                articles: [],
                skippedRateCap: true,
                clientRateLimited: true,
              } satisfies DeskFinnhubFetchResult,
              retryAfterSec: err.retryAfterSec,
            };
          }
          throw err;
        }
      }),
    ),
  );

  for (const row of companyResults) {
    const { sym, r } = row;
    const slotRetry = "retryAfterSec" in row ? row.retryAfterSec : undefined;
    if (r.skippedRateCap || r.clientRateLimited) {
      skippedRateCap = true;
      clientRateLimited = clientRateLimited || Boolean(r.clientRateLimited);
      if (slotRetry != null) retryAfterSec = slotRetry;
      if (mode === "ondemand") missingSymbols.push(sym);
      continue;
    }
    if (r.ok) {
      hadHttp2xx = true;
      for (const a of r.articles) all.push(a);
    } else if (r.status > 0) {
      lastErrorStatus = r.status;
    }
  }

  return {
    articles: all,
    hadHttp2xx,
    lastErrorStatus,
    skippedRateCap: skippedRateCap || undefined,
    clientRateLimited: clientRateLimited || undefined,
    retryAfterSec,
    missingSymbols: missingSymbols.length ? [...new Set(missingSymbols)] : undefined,
  };
}

export function deskResetFinnhubRateLimitForTests(): void {
  recentFinnhubCallTimes.length = 0;
}

/** Pre-fill rate slots without HTTP (tests). */
export function deskSimulateFinnhubRateSlotsForTests(
  mode: DeskFinnhubLoadMode,
  count: number,
  at = Date.now(),
  reset = true,
): void {
  if (reset) deskResetFinnhubRateLimitForTests();
  for (let i = 0; i < count; i += 1) {
    recordFinnhubRateSlot(mode, at - i);
  }
}
