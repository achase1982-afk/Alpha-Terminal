import { isAuthDisabled } from "@/lib/authMode";

/** Owner-enabled live Schwab submit from Active Trader (auto-send + review confirm). */
export const AT_ORDER_SEND_ENABLED =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_AT_ORDER_SEND !== "0";

/** Vertical ladder mode ships in a follow-up PR. */
export const AT_VERTICAL_LADDER_ENABLED = false;

export function atOrderSendAllowed(): boolean {
  if (isAuthDisabled()) return false;
  return AT_ORDER_SEND_ENABLED;
}