const NO_LIMIT_PRICE = new Set(["MARKET", "STOP", "TRAILING_STOP", "MARKET_ON_CLOSE", "EXERCISE"]);

/**
 * Walk a Schwab order, including TRIGGER and OCO children, and drop prices
 * Schwab rejects on market, stop, and trailing-stop orders.
 */
export function prepareSchwabOrderForSend<T extends Record<string, unknown>>(order: T): T {
  const next: Record<string, unknown> = { ...order };
  const children = next.childOrderStrategies;
  if (Array.isArray(children)) {
    next.childOrderStrategies = children.map((child) =>
      child && typeof child === "object"
        ? prepareSchwabOrderForSend(child as Record<string, unknown>)
        : child,
    );
  }
  if (next.orderStrategyType === "OCO") {
    delete next.price;
    delete next.stopPrice;
    delete next.orderType;
    delete next.orderLegCollection;
  }
  const orderType = typeof next.orderType === "string" ? next.orderType : "";
  if (NO_LIMIT_PRICE.has(orderType)) {
    delete next.price;
  } else if (
    next.price != null &&
    (typeof next.price !== "number" || !(next.price > 0) || !Number.isFinite(next.price))
  ) {
    delete next.price;
  }
  return next as T;
}
