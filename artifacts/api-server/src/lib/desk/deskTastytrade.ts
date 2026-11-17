import { deskEnv } from "./deskEnv.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const OAUTH_URL = "https://api.tastytrade.com/oauth/token";
const API_BASE = "https://api.tastytrade.com";
const SOURCE = "tastytrade_dxlink";

type TokenCache = { accessToken: string; expiresAtMs: number };

let tokenCache: TokenCache | null = null;
let tokenRefreshInFlight: Promise<string | null> | null = null;

export function tastytradeConfigured(): boolean {
  return Boolean(deskEnv("TASTYTRADE_CLIENT_SECRET") && deskEnv("TASTYTRADE_REFRESH_TOKEN"));
}

export async function deskTastytradeAccessToken(): Promise<string | null> {
  if (!tastytradeConfigured()) {
    deskMarkFeedNotConfigured("tastytrade", SOURCE);
    return null;
  }
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAtMs - 60_000) {
    return tokenCache.accessToken;
  }
  if (tokenRefreshInFlight) return tokenRefreshInFlight;

  const clientSecret = deskEnv("TASTYTRADE_CLIENT_SECRET");
  const refreshToken = deskEnv("TASTYTRADE_REFRESH_TOKEN");

  tokenRefreshInFlight = (async () => {
    try {
      const res = await fetch(OAUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) {
        deskMarkFeedAuthError("tastytrade", `tastytrade_oauth_${res.status}`, SOURCE);
        tokenCache = null;
        return null;
      }
      if (!res.ok) {
        deskMarkFeedError("tastytrade", `tastytrade_oauth_${res.status}`, SOURCE);
        return null;
      }
      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        "data"?: { "access-token"?: string; "expires-in"?: number };
      };
      const access =
        json.access_token ?? json.data?.["access-token"] ?? "";
      const expiresIn = json.expires_in ?? json.data?.["expires-in"] ?? 3600;
      if (!access) {
        deskMarkFeedError("tastytrade", "tastytrade_oauth_empty", SOURCE);
        return null;
      }
      tokenCache = { accessToken: access, expiresAtMs: now + expiresIn * 1000 };
      return access;
    } catch (err) {
      deskMarkFeedError("tastytrade", "tastytrade_oauth_error", SOURCE);
      logger.warn({ err }, "Desk Tastytrade OAuth failed");
      return null;
    } finally {
      tokenRefreshInFlight = null;
    }
  })();

  return tokenRefreshInFlight;
}

/** Read-only REST quote probe (DXLink stream is not opened on desk API). */
export async function deskProbeTastytrade(): Promise<void> {
  const token = await deskTastytradeAccessToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/market-data/by-type?equity=SPY`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) {
      deskMarkFeedAuthError("tastytrade", `tastytrade_http_${res.status}`, SOURCE);
      return;
    }
    if (!res.ok) {
      deskMarkFeedError("tastytrade", `tastytrade_http_${res.status}`, SOURCE);
      return;
    }
    deskTouchFeed("tastytrade", Date.now(), SOURCE);
  } catch (err) {
    deskMarkFeedError("tastytrade", "tastytrade_probe_error", SOURCE);
    logger.warn({ err }, "Desk Tastytrade probe failed");
  }
}

export async function deskTastytradeQuotes(
  symbols: string[],
): Promise<{ ok: boolean; quotes: unknown; asOfMs: number; status?: number; error?: string }> {
  const token = await deskTastytradeAccessToken();
  if (!token) {
    return { ok: false, quotes: null, asOfMs: Date.now(), status: 503, error: "not_configured" };
  }
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const equity = uniq.join(",");
  const url = `${API_BASE}/market-data/by-type?equity=${encodeURIComponent(equity)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    const err = `tastytrade_http_${res.status}`;
    deskMarkFeedAuthError("tastytrade", err, SOURCE);
    return { ok: false, quotes: null, asOfMs: Date.now(), status: res.status, error: err };
  }
  if (!res.ok) {
    deskMarkFeedError("tastytrade", `tastytrade_http_${res.status}`, SOURCE);
    return { ok: false, quotes: null, asOfMs: Date.now(), status: res.status, error: `tastytrade_http_${res.status}` };
  }
  const json = await res.json();
  const touch = Date.now();
  deskTouchFeed("tastytrade", touch, SOURCE);
  return { ok: true, quotes: json, asOfMs: touch };
}