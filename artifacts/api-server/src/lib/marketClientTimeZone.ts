import type { Request } from "express";
import { getMarketContext, type MarketContext } from "./getMarketContext.js";

const DEFAULT_TZ = "America/New_York";

/** Client IANA zone from JSON body, query `clientTimeZone`, or header `X-Client-Timezone`. */
export function readClientTimeZone(req: Request): string {
  const body = req.body as { clientTimeZone?: unknown } | undefined;
  if (typeof body?.clientTimeZone === "string" && body.clientTimeZone.trim().length > 0) {
    return body.clientTimeZone.trim();
  }
  const q = req.query["clientTimeZone"];
  if (typeof q === "string" && q.trim().length > 0) return q.trim();
  const h = req.headers["x-client-timezone"];
  if (typeof h === "string" && h.trim().length > 0) return h.trim();
  return DEFAULT_TZ;
}

export function resolveMarketContextForRequest(req: Request, now = new Date()): MarketContext {
  return getMarketContext(now, readClientTimeZone(req));
}
