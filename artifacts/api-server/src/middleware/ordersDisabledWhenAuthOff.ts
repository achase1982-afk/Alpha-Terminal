import type { Request, Response, NextFunction } from "express";
import {
  ORDERS_DISABLED_ERROR,
  isSchwabTradingDisabled,
} from "../lib/schwabTradingGate.js";

const ORDERS_DISABLED_BODY = { error: ORDERS_DISABLED_ERROR } as const;

type BlockRule = {
  method: string;
  path: string;
  matchBody?: (body: unknown) => boolean;
};

/** Schwab/broker order mutations blocked while reviewer auth-off mode is active. */
const BLOCKED: BlockRule[] = [
  { method: "POST", path: "/portfolio/place-order" },
  { method: "DELETE", path: "/portfolio/cancel-order" },
  { method: "POST", path: "/auto-trade/start" },
  {
    method: "POST",
    path: "/engine/control",
    matchBody: (body) => {
      const action = (body as { action?: string } | null)?.action;
      return action === "start";
    },
  },
];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Desk API is read/market-data today; fail closed on any future trade POSTs. */
export function blockDeskBrokerOrdersWhenAuthDisabled(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isSchwabTradingDisabled()) {
    next();
    return;
  }
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }
  if (req.path === "/health" && req.method === "POST") {
    next();
    return;
  }
  res.status(403).json(ORDERS_DISABLED_BODY);
}

export function blockBrokerOrdersWhenAuthDisabled(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isSchwabTradingDisabled()) {
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