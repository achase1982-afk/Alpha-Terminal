import type { Response } from "express";
import { isAuthDisabled } from "./authMode.js";

export const ORDERS_DISABLED_ERROR = "orders_disabled_no_auth" as const;

/**
 * Fail closed: when app auth is disabled (reviewer mode), no Schwab/broker
 * order writes — regardless of VITE_AT_ORDER_SEND, engine config, etc.
 */
export function isSchwabTradingDisabled(): boolean {
  return isAuthDisabled();
}

/** HTTP handlers: respond 403 and return true when trading is blocked. */
export function refuseSchwabTradingJson(res: Response): boolean {
  if (!isSchwabTradingDisabled()) return false;
  res.status(403).json({ error: ORDERS_DISABLED_ERROR });
  return true;
}

/** Background jobs / engine: skip broker order API calls. */
export function schwabTradingBlocked(): boolean {
  return isSchwabTradingDisabled();
}