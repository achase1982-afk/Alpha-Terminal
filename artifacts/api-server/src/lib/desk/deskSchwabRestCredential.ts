import { getBestAccessToken } from "../tokenStore.js";
import { logger } from "../logger.js";
import { deskSchwab2RateLimited } from "./deskSchwab2RateLimit.js";
import {
  getSchwab2ValidAccessToken,
  hasSchwab2Tokens,
  isSchwab2TokenStoreDead,
} from "./deskSchwab2TokenStore.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotAuthorized,
  deskMarkAuthFail,
} from "./deskFeedFreshness.js";
import type { DeskSchwabRestApp } from "./deskSchwabRestApp.js";

export type { DeskSchwabRestApp } from "./deskSchwabRestApp.js";
export { deskSchwabRestAppFromDeskSource } from "./deskSchwabRestApp.js";

export type DeskSchwabRestResolution = {
  app: DeskSchwabRestApp;
  token: string | null;
  /** API / caller hint (`app1` for `source=schwab`, else app2). */
  preferred: DeskSchwabRestApp;
  fellBack: boolean;
};

async function tryApp2AccessToken(): Promise<string | null> {
  if (isSchwab2TokenStoreDead() || !hasSchwab2Tokens()) {
    deskMarkFeedNotAuthorized("schwab2_rest", "schwab2_oauth_required", "schwab_rest_2");
    return null;
  }
  const token = await getSchwab2ValidAccessToken();
  if (!token) {
    deskMarkFeedAuthError("schwab2_rest", "schwab2_token_unavailable", "schwab_rest_2");
    return null;
  }
  return token;
}

function tryApp1AccessToken(): string | null {
  const token = getBestAccessToken();
  if (!token) {
    deskMarkFeedNotAuthorized("schwab_quotes_rest", "schwab_oauth_required", "schwab");
    deskMarkAuthFail("schwab_quotes_rest");
    return null;
  }
  return token;
}

/**
 * Credential pick honors `preferred`: app1-first for `source=schwab`, app2-first otherwise,
 * with fallback to the other app when the preferred side has no token.
 */
export async function deskSchwabRestResolve(
  preferred: DeskSchwabRestApp = "app2",
): Promise<DeskSchwabRestResolution> {
  const tryPrimary =
    preferred === "app1"
      ? (): Promise<string | null> | string | null => tryApp1AccessToken()
      : (): Promise<string | null> | string | null => tryApp2AccessToken();
  const trySecondary =
    preferred === "app1"
      ? (): Promise<string | null> | string | null => tryApp2AccessToken()
      : (): Promise<string | null> | string | null => tryApp1AccessToken();

  const primaryToken = await Promise.resolve(tryPrimary());
  if (primaryToken) {
    return { app: preferred, token: primaryToken, preferred, fellBack: false };
  }

  const secondaryApp: DeskSchwabRestApp = preferred === "app1" ? "app2" : "app1";
  const secondaryToken = await Promise.resolve(trySecondary());
  if (secondaryToken) {
    if (preferred === "app2") {
      logger.info("Desk Schwab REST: app2 unavailable — using app1");
      deskMarkFeedError("schwab2_rest", "schwab_rest_fallback_to_app1", "schwab_rest_2");
    } else {
      logger.info("Desk Schwab REST: app1 unavailable — using app2");
    }
    return { app: secondaryApp, token: secondaryToken, preferred, fellBack: true };
  }

  return { app: preferred, token: null, preferred, fellBack: false };
}

export async function deskSchwabRestAccessToken(app: DeskSchwabRestApp = "app2"): Promise<string | null> {
  const r = await deskSchwabRestResolve(app);
  return r.token;
}

async function rawFetch(
  app: DeskSchwabRestApp,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (app === "app2") {
    return deskSchwab2MarketFetch(url, init, timeoutMs);
  }
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal });
}

export type DeskSchwabRestFetchResult = DeskSchwabRestResolution & { res: Response };

/** Run a Schwab REST GET/POST; on app2 401/403 with token, retry once on app1. */
export async function deskSchwabRestFetch(
  preferred: DeskSchwabRestApp,
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<DeskSchwabRestFetchResult> {
  const first = await deskSchwabRestResolve(preferred);
  if (!first.token) {
    const res = new Response(null, { status: 401, statusText: "No Schwab REST token" });
    return { ...first, res };
  }

  let res = await rawFetch(first.app, url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${first.token}` } }, timeoutMs);
  if (
    first.app === "app2" &&
    first.token &&
    (res.status === 401 || res.status === 403)
  ) {
    deskSchwabMarkApp2AuthFailure(res.status);
    const app1 = tryApp1AccessToken();
    if (app1) {
      logger.info({ status: res.status }, "Desk Schwab REST: app2 HTTP auth error — retry on app1");
      deskMarkFeedError("schwab2_rest", "schwab_rest_fallback_to_app1", "schwab_rest_2");
      res = await rawFetch(
        "app1",
        url,
        { ...init, headers: { ...init.headers, Authorization: `Bearer ${app1}` } },
        timeoutMs,
      );
      return { app: "app1", token: app1, preferred, fellBack: true, res };
    }
  }

  return { ...first, res };
}

export async function deskSchwab2MarketFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  return deskSchwab2RateLimited(async () => {
    const signal = init?.signal ?? AbortSignal.timeout(timeoutMs);
    return fetch(url, { ...init, signal });
  }, timeoutMs);
}

export function deskSchwabMarkApp2AuthFailure(status: number): void {
  if (status === 401 || status === 403) {
    deskMarkFeedAuthError("schwab2_rest", `http_${status}`, "schwab_rest_2");
  }
}

export function deskSchwabQuotesFeed(app: DeskSchwabRestApp): "schwab_quotes_rest" | "schwab2_rest" {
  return app === "app2" ? "schwab2_rest" : "schwab_quotes_rest";
}

export function deskSchwabChainsFeed(app: DeskSchwabRestApp): "schwab_chains" | "schwab2_rest" {
  return app === "app2" ? "schwab2_rest" : "schwab_chains";
}

export function deskSchwabApiSourceLabel(app: DeskSchwabRestApp): "schwab" | "schwab2" {
  return app === "app2" ? "schwab2" : "schwab";
}