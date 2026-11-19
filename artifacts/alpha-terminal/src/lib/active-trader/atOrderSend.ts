import { isAuthDisabled } from "@/lib/authMode";

/** Live Schwab submit — off unless explicitly enabled at build time (`VITE_AT_ORDER_SEND=1`). */
export const AT_ORDER_SEND_ENABLED =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_AT_ORDER_SEND === "1";

const ORDERS_ALLOW_WITHOUT_AUTH =
  typeof import.meta !== "undefined" &&
  (import.meta.env?.VITE_ORDERS_ALLOW_WITHOUT_AUTH === "1" ||
    import.meta.env?.VITE_ORDERS_ALLOW_WITHOUT_AUTH === "true");

export function atOrderSendAllowed(): boolean {
  if (!AT_ORDER_SEND_ENABLED) return false;
  if (isAuthDisabled() && !ORDERS_ALLOW_WITHOUT_AUTH) return false;
  return true;
}

/**
 * Why a live send cannot be routed. Null when `atOrderSendAllowed()` is true.
 * Preview-only (the build flag) is a different sentence from a signed-out live route.
 */
export function atOrderSendUnavailableReason(): string | null {
  if (!AT_ORDER_SEND_ENABLED) return "Preview only. Live routing is off.";
  if (isAuthDisabled() && !ORDERS_ALLOW_WITHOUT_AUTH) {
    return "Live routing is off until you sign in.";
  }
  return null;
}