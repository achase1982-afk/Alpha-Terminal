import type { Request, Response, NextFunction } from "express";
import { AUTH_DISABLED_ERROR, refuseAuthDisabledClientOp } from "../lib/authDisabledClientGuard.js";
import { isAuthDisabled } from "../lib/authMode.js";

export { AUTH_DISABLED_ERROR };

type WriteRule = { methods: Set<string>; paths: string[]; pathPrefix?: string };

/** Block paid AI, admin backfill, and settings writes in reviewer (auth-off) mode. */
const REVIEWER_WRITE_RULES: WriteRule[] = [
  { methods: new Set(["POST"]), paths: ["/chat/message", "/ai/chat"] },
  {
    methods: new Set(["PUT", "POST", "PATCH"]),
    paths: [
      "/portfolio/preferences",
      "/auto-trade/config",
      "/watchlists/terminal",
      "/dashboard-layout/",
      "/strategist/settings",
      "/catalysts/settings",
      "/ai-lab/config",
      "/ai-lab/settings/update",
      "/push/system-alerts",
      "/engine/config",
    ],
    pathPrefix: "/ai-lab/prompts/",
  },
];

function pathMatches(req: Request, rule: WriteRule): boolean {
  if (!rule.methods.has(req.method)) return false;
  if (rule.paths.includes(req.path)) return true;
  if (rule.pathPrefix && req.path.startsWith(rule.pathPrefix)) return true;
  return false;
}

export function blockReviewerModeWrites(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthDisabled()) {
    next();
    return;
  }
  for (const rule of REVIEWER_WRITE_RULES) {
    if (pathMatches(req, rule)) {
      refuseAuthDisabledClientOp(res);
      return;
    }
  }
  next();
}

/** Mounted at `/api/admin/run-full-backfill` — POST enqueue blocked in reviewer mode. */
export function blockReviewerBackfillPost(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthDisabled()) {
    next();
    return;
  }
  if (req.method === "POST" && req.path === "/") {
    refuseAuthDisabledClientOp(res);
    return;
  }
  next();
}