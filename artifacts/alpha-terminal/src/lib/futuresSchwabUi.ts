import { isBlockedFuturesTradeSymbol } from "@workspace/order-ticket-math";

export function isFuturesDisplaySymbol(symbol: string): boolean {
  return isBlockedFuturesTradeSymbol(symbol);
}

export function futuresChainPlaceholderPrimary(): string {
  return "No options chain for futures through the Schwab API";
}

export function futuresRootForPlaceholder(symbol: string): string {
  const bare = symbol.replace(/^\//, "").toUpperCase();
  const m = bare.match(/^([A-Z0-9]{1,4})[FGHJKMNQUVXZ]\d{2}$/);
  return m ? m[1]! : bare;
}

/** Extra copy for ES/MES roots — both trade at Schwab but REST chain is unavailable. */
export function futuresChainPlaceholderSecondary(symbol: string): string | null {
  const root = futuresRootForPlaceholder(symbol);
  if (root === "ES" || root === "MES") {
    return "ES and MES options trade at Schwab but this API can't list them.";
  }
  return null;
}

export const FUTURES_ORDER_BLOCK_MESSAGE =
  "Futures can be quoted here, but the Schwab Trader API doesn't accept futures or futures-options orders.";