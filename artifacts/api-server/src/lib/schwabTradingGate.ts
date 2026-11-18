import type { Response } from "express";
import { isAuthDisabled, isOrdersAllowWithoutAuth } from "./authMode.js";

export const ORDERS_DISABLED_ERROR = "orders_disabled_no_auth" as const;

/**
 * Manual broker writes (place/cancel) while auth is off — allowed only when
 * `ORDERS_ALLOW_WITHOUT_AUTH` is set (Anthony acceptance of URL-risk).
 */
export function isManualSchwabTradingDisabled(): boolean {
  return isAuthDisabled() && !isOrdersAllowWithoutAuth();
}

/** Automated paths (engine, auto-trade) stay blocked whenever auth is disabled. */
export function isAutomatedSchwabTradingDisabled(): boolean {
  return isAuthDisabled();
}

/** @deprecated use isManualSchwabTradingDisabled */
export function isSchwabTradingDisabled(): boolean {
  return isManualSchwabTradingDisabled();
}

/** HTTP handlers: respond 403 and return true when manual trading is blocked. */
export function refuseSchwabTradingJson(res: Response): boolean {
  if (!isManualSchwabTradingDisabled()) return false;
  res.status(403).json({ error: ORDERS_DISABLED_ERROR });
  return true;
}

/** Background jobs / engine: skip broker order API calls when auth off (no override). */
export function schwabTradingBlocked(): boolean {
  return isAutomatedSchwabTradingDisabled();
}