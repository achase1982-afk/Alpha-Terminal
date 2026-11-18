import type { Request } from "express";
import { isAuthDisabled } from "./authMode.js";
import { getAccessToken, getBestAccessToken } from "./tokenStore.js";

/**
 * Resolve Schwab market API bearer token for a request.
 * Reviewer mode (auth off): always use server-stored tokens — never accept browser query tokens.
 */
export function schwabAccessTokenFromRequest(
  req: Request,
  preferBest = false,
): string | null {
  if (isAuthDisabled()) {
    return getBestAccessToken() ?? getAccessToken("market") ?? getAccessToken("trader");
  }
  const fromQuery = req.query["accessToken"];
  if (typeof fromQuery === "string" && fromQuery.trim()) {
    return fromQuery.trim();
  }
  if (preferBest) {
    return getBestAccessToken() ?? getAccessToken("market");
  }
  return getAccessToken("market");
}