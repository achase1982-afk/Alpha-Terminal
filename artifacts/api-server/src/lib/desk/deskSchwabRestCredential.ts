import { getBestAccessToken } from "../tokenStore.js";
import { deskSchwab2RateLimited } from "./deskSchwab2RateLimit.js";
import { getSchwab2ValidAccessToken, hasSchwab2Tokens } from "./deskSchwab2TokenStore.js";
import { deskMarkFeedAuthError, deskMarkFeedNotAuthorized } from "./deskFeedFreshness.js";
import type { DeskSchwabRestApp } from "./deskSchwabRestApp.js";

export type { DeskSchwabRestApp } from "./deskSchwabRestApp.js";
export { deskSchwabRestAppFromDeskSource } from "./deskSchwabRestApp.js";

export async function deskSchwabRestAccessToken(app: DeskSchwabRestApp): Promise<string | null> {
  if (app === "app1") {
    return getBestAccessToken();
  }
  if (!hasSchwab2Tokens()) {
    deskMarkFeedNotAuthorized("schwab2_rest", "schwab2_oauth_required", "schwab_rest_2");
    return null;
  }
  return getSchwab2ValidAccessToken();
}

export async function deskSchwab2MarketFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return deskSchwab2RateLimited(() => fetch(url, init));
}

export function deskSchwabMarkApp2AuthFailure(status: number): void {
  if (status === 401 || status === 403) {
    deskMarkFeedAuthError("schwab2_rest", `http_${status}`, "schwab_rest_2");
  }
}