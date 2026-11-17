import { timingSafeEqual, createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

let loggedMissingKey = false;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function deskBearerAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = (process.env.DESK_API_KEY ?? "").trim();
  if (!expected) {
    if (!loggedMissingKey) {
      loggedMissingKey = true;
      logger.warn("DESK_API_KEY is unset — /api/desk/v1 returning 503");
    }
    res.status(503).json({ error: "desk_api_unconfigured", message: "DESK_API_KEY is not set on the server" });
    return;
  }

  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1]?.trim() ?? "";
  if (!token || !safeEqual(token, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

/** Vitest: reset one-shot log guard */
export function resetDeskAuthLogGuardForTests(): void {
  loggedMissingKey = false;
}