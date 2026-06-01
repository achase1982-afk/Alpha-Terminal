import type { Request, Response, NextFunction } from "express";

/**
 * Ensures Clerk middleware sees a Bearer token from the standard
 * Authorization header or a query param (EventSource cannot send headers).
 *
 * - `clerk_token` — used by WebSocket and SSE fallbacks
 * - `accessToken` — legacy market-route query param
 */
export function clerkAuthBridge(req: Request, _res: Response, next: NextFunction) {
  const existing = req.headers.authorization;
  if (typeof existing === "string" && existing.trim()) {
    next();
    return;
  }

  const clerkToken = req.query["clerk_token"];
  const legacyToken = req.query["accessToken"];
  const fromQuery =
    typeof clerkToken === "string" && clerkToken.trim()
      ? clerkToken
      : typeof legacyToken === "string" && legacyToken.trim()
        ? legacyToken
        : null;

  if (fromQuery) {
    req.headers.authorization = `Bearer ${fromQuery.trim()}`;
  }

  next();
}
