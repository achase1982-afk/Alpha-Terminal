import type { Request, Response, NextFunction } from "express";
import { isAuthDisabled } from "../lib/authMode.js";

const ORDERS_DISABLED_BODY = { error: "orders_disabled_no_auth" } as const;

type BlockRule = {
  method: string;
  path: string;
  matchBody?: (body: unknown) => boolean;
};

/** Schwab/broker order mutations blocked while app auth is disabled (reviewer mode). */
const BLOCKED: BlockRule[] = [
  { method: "POST", path: "/portfolio/place-order" },
  { method: "DELETE", path: "/portfolio/cancel-order" },
  { method: "POST", path: "/auto-trade/start" },
  { method: "POST", path: "/auto-trade/stop" },
  {
    method: "POST",
    path: "/engine/control",
    matchBody: (body) => {
      const action = (body as { action?: string } | null)?.action;
      return action === "start" || action === "kill";
    },
  },
];

export function blockBrokerOrdersWhenAuthDisabled(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isAuthDisabled()) {
    next();
    return;
  }

  for (const rule of BLOCKED) {
    if (req.method !== rule.method || req.path !== rule.path) continue;
    if (rule.matchBody && !rule.matchBody(req.body)) continue;
    res.status(403).json(ORDERS_DISABLED_BODY);
    return;
  }

  next();
}