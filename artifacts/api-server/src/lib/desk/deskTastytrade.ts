import { deskEnv } from "./deskEnv.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const OAUTH_URL = "https://api.tastyworks.com/oauth/token";
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

  const clientSecret = deskEnv("TASTYTRADE_CLIENT_SECRET").trim();
  const refreshToken = deskEnv("TASTYTRADE_REFRESH_TOKEN").trim();

  tokenRefreshInFlight = (async () => {
    try {
      const form = new URLSearchParams();
      form.set("grant_type", "refresh_token");
      form.set("refresh_token", refreshToken);
      form.set("client_secret", clientSecret);

      const res = await fetch(OAUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        json = { raw };
      }
      if (res.status === 401 || res.status === 403) {
        const detail = String(json.error ?? json.message ?? raw).slice(0, 200);
        deskMarkFeedAuthError("tastytrade", `tastytrade_oauth_${res.status}:${detail}`, SOURCE);
        tokenCache = null;
        return null;
      }
      if (!res.ok) {
        const detail = String(json.error ?? json.message ?? json.error_description ?? raw).slice(0, 200);
        logger.warn(
          {
            status: res.status,
            detail,
            oauthUrl: OAUTH_URL,
            envKeys: [
              "TASTYTRADE_CLIENT_SECRET",
              "DESK_TASTYTRADE_CLIENT_SECRET",
              "TASTYTRADE_REFRESH_TOKEN",
              "DESK_TASTYTRADE_REFRESH_TOKEN",
            ],
            bodyFields: ["grant_type", "refresh_token", "client_secret"],
          },
          "Desk Tastytrade OAuth refresh failed",
        );
        if (res.status === 400 && /invalid_grant|client secret|mismatch/i.test(detail)) {
          deskMarkFeedAuthError(
            "tastytrade",
            "tastytrade_oauth_credential_mismatch_check_env",
            SOURCE,
          );
        } else {
          deskMarkFeedError("tastytrade", `tastytrade_oauth_${res.status}:${detail}`, SOURCE);
        }
        return null;
      }
      const data = json.data as Record<string, unknown> | undefined;
      const access =
        (json.access_token as string) ??
        (data?.["access-token"] as string) ??
        (data?.access_token as string) ??
        "";
      const expiresIn =
        (json.expires_in as number) ??
        (data?.["expires-in"] as number) ??
        (data?.expires_in as number) ??
        3600;
      if (!access) {
        deskMarkFeedError("tastytrade", "tastytrade_oauth_empty", SOURCE);
        return null;
      }
      tokenCache = { accessToken: access, expiresAtMs: now + expiresIn * 1000 };
      deskTouchFeed("tastytrade", now, SOURCE);
      return access;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "tastytrade_oauth_error";
      deskMarkFeedError("tastytrade", msg, SOURCE);
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
