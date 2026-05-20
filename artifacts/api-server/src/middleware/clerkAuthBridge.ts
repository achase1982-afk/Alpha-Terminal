import type { Request, Response, NextFunction } from "express";

/**
 * Ensures Clerk middleware sees a Bearer token from either the standard
 * Authorization header or the legacy `accessToken` query parameter.
 */
export function clerkAuthBridge(req: Request, _res: Response, next: NextFunction) {
  const existing = req.headers.authorization;
  if (typeof existing === "string" && existing.trim()) {
    next();
    return;
  }

  const fromQuery = req.query["accessToken"];
  if (typeof fromQuery === "string" && fromQuery.trim()) {
    req.headers.authorization = `Bearer ${fromQuery.trim()}`;
  }

  next();
}
