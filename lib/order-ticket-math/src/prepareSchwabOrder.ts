import { coerceSchwabComplexOrderStrategyType } from "./schwabComplexStrategy.js";

const NO_LIMIT_PRICE = new Set(["MARKET", "STOP", "TRAILING_STOP", "MARKET_ON_CLOSE", "EXERCISE"]);

/** Pull the sentence out of a Schwab/Webull reject body so the ticket does not show raw JSON. */
export function readableBrokerRejectMessage(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  if (!text) return "Order rejected";
  let pick = text;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
      const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
      const error = typeof parsed.error === "string" ? parsed.error.trim() : "";
      if (message) pick = message;
      else if (error) pick = error;
    } catch {
      pick = text;
    }
  }
  return pick.length > 500 ? `${pick.slice(0, 499)}…` : pick;
}

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
  if ("complexOrderStrategyType" in next) {
    const coerced = coerceSchwabComplexOrderStrategyType(next.complexOrderStrategyType);
    if (coerced) next.complexOrderStrategyType = coerced;
    else delete next.complexOrderStrategyType;
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
