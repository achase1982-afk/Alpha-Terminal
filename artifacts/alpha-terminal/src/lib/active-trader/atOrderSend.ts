import { isAuthDisabled } from "@/lib/authMode";

/** Live Schwab submit — off unless explicitly enabled at build time (`VITE_AT_ORDER_SEND=1`). */
export const AT_ORDER_SEND_ENABLED =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_AT_ORDER_SEND === "1";

const ORDERS_ALLOW_WITHOUT_AUTH =
  typeof import.meta !== "undefined" &&
  (import.meta.env?.VITE_ORDERS_ALLOW_WITHOUT_AUTH === "1" ||
    import.meta.env?.VITE_ORDERS_ALLOW_WITHOUT_AUTH === "true");

/** Vertical ladder mode ships in a follow-up PR. */
export const AT_VERTICAL_LADDER_ENABLED = false;

export function atOrderSendAllowed(): boolean {
  if (!AT_ORDER_SEND_ENABLED) return false;
  if (isAuthDisabled() && !ORDERS_ALLOW_WITHOUT_AUTH) return false;
  return true;
}