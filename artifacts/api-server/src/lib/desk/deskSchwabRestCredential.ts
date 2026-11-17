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
 * Credential pick: prefer Schwab app 2 when it yields a token, otherwise app 1.
 * Records errors for the app that failed; logs and marks feed when falling back.
 */
export async function deskSchwabRestResolve(
  preferred: DeskSchwabRestApp = "app2",
): Promise<DeskSchwabRestResolution> {
  const app2 = await tryApp2AccessToken();
  if (app2) {
    return { app: "app2", token: app2, preferred, fellBack: false };
  }

  const app1 = tryApp1AccessToken();
  if (app1) {
    if (preferred === "app2") {
      logger.info("Desk Schwab REST: app2 unavailable — using app1");
      deskMarkFeedError("schwab2_rest", "schwab_rest_fallback_to_app1", "schwab_rest_2");
    }
    return { app: "app1", token: app1, preferred, fellBack: preferred === "app2" };
  }

  return { app: preferred, token: null, preferred, fellBack: false };
}

export async function deskSchwabRestAccessToken(app: DeskSchwabRestApp = "app2"): Promise<string | null> {
  const r = await deskSchwabRestResolve(app);
  return r.token;
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