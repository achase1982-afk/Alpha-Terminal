import { buildDeskHealthFeeds } from "../desk/deskFeedFreshness.js";
import {
  deskGetCachedLiveGamma0dte,
  deskRefreshLiveGamma0dte,
  deskUwExtractRows,
} from "../desk/addons/unusualWhales/deskUwGamma.js";
import { deskSessionDateEt } from "../desk/deskEt.js";
import { priorNyTradingSessionYmd } from "../getMarketContext.js";
import { refreshDeskUwLiveFeeds } from "../desk/addons/unusualWhales/deskUwLiveFeeds.js";
import { computeZonesFromUwGamma0dte } from "@workspace/order-ticket-math";

export const AT_GAMMA_GLANCE_TICKERS = new Set(["SPX", "SPY", "QQQ", "NVDA"]);
export const AT_GAMMA_GLANCE_CACHE_TTL_MS = 30_000;

type CacheEntry = { payload: AtGammaGlancePayload; expiresAt: number };
const appCache = new Map<string, CacheEntry>();

export type AtGammaGlancePayload = {
  zones: ReturnType<typeof computeZonesFromUwGamma0dte> & { glanceCaption?: string };
  sessionClosed: boolean;
  glanceCaption?: string;
  source: "unusual_whales";
  asOfMs?: number;
  expiry?: string;
  rowCount?: number;
  unavailable?: boolean;
};

function formatEtTimeShort(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    hour12: true,
  });
}

export function resetAtGammaGlanceCacheForTests(): void {
  appCache.clear();
}

function expiryCandidates(sessionDate: string): string[] {
  const prior = priorNyTradingSessionYmd(sessionDate);
  return prior && prior !== sessionDate ? [sessionDate, prior] : [sessionDate];
}

async function loadUwGamma0dteSnapshot(ticker: string, sessionDate: string) {
  await refreshDeskUwLiveFeeds(true);
  for (const expiry of expiryCandidates(sessionDate)) {
    let snap = deskGetCachedLiveGamma0dte(expiry, ticker);
    if (snap?.data?.data?.length) return snap;
    await deskRefreshLiveGamma0dte(expiry, ticker);
    snap = deskGetCachedLiveGamma0dte(expiry, ticker);
    if (snap?.data?.data?.length) return snap;
  }
  return null;
}

export async function buildAtGammaGlancePayload(tickerRaw: string): Promise<AtGammaGlancePayload> {
  const ticker = tickerRaw.replace(/^\$/, "").toUpperCase();
  const cacheKey = `${ticker}|${deskSessionDateEt()}`;
  const hit = appCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.payload;

  const feedRow = buildDeskHealthFeeds().find((f) => f.feed === "live_gamma_0dte");
  const sessionClosed = feedRow?.status === "session_closed";
  const sessionDate = deskSessionDateEt();

  if (!AT_GAMMA_GLANCE_TICKERS.has(ticker)) {
    const payload: AtGammaGlancePayload = {
      zones: {
        callWall: null,
        putWall: null,
        flip: null,
        netGexUsdPer1Pct: null,
        env: null,
        asOfLabel: "\u2014",
      },
      sessionClosed,
      glanceCaption: sessionClosed ? "Closed" : undefined,
      source: "unusual_whales",
      unavailable: true,
    };
    appCache.set(cacheKey, { payload, expiresAt: Date.now() + AT_GAMMA_GLANCE_CACHE_TTL_MS });
    return payload;
  }

  const snap0 = await loadUwGamma0dteSnapshot(ticker, sessionDate);
  if (!snap0?.data?.data?.length) {
    const payload: AtGammaGlancePayload = {
      zones: {
        callWall: null,
        putWall: null,
        flip: null,
        netGexUsdPer1Pct: null,
        env: null,
        asOfLabel: "\u2014",
      },
      sessionClosed,
      glanceCaption: sessionClosed ? "Closed" : undefined,
      source: "unusual_whales",
      unavailable: true,
    };
    appCache.set(cacheKey, { payload, expiresAt: Date.now() + AT_GAMMA_GLANCE_CACHE_TTL_MS });
    return payload;
  }

  const rows = deskUwExtractRows(snap0.data);
  const asOfMs = snap0.asOfMs;
  const asOfEt = formatEtTimeShort(asOfMs);
  const zones = computeZonesFromUwGamma0dte(rows, { spot: null, asOfLabel: asOfEt });
  const glanceCaption = sessionClosed ? `Closed \u00b7 as of ${asOfEt}` : undefined;
  const payload: AtGammaGlancePayload = {
    zones: { ...zones, glanceCaption },
    sessionClosed,
    glanceCaption,
    source: "unusual_whales",
    asOfMs,
    expiry: snap0.expiry ?? sessionDate,
    rowCount: snap0.row_count,
    unavailable: false,
  };
  appCache.set(cacheKey, { payload, expiresAt: Date.now() + AT_GAMMA_GLANCE_CACHE_TTL_MS });
  return payload;
}