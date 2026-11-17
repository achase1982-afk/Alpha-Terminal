/** Owner-enabled live Schwab submit from Active Trader (auto-send + review confirm). */
export const AT_ORDER_SEND_ENABLED = true;

/** Vertical ladder mode ships after spread routing is production-ready. */
export const AT_VERTICAL_LADDER_ENABLED = false;

export function atOrderSendAllowed(): boolean {
  return AT_ORDER_SEND_ENABLED;
}