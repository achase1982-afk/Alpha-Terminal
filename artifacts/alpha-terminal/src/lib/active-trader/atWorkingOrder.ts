import { occRoot } from "@/lib/active-trader/optionSeries";

/** Weekly roots that share the Active Trader ticker with the standard root. */
const TICKER_FAMILY: Record<string, string> = {
  SPXW: "SPX",
  NDXP: "NDX",
  RUTW: "RUT",
};

export type ReportedOrderLeg = {
  symbol?: string;
  underlyingSymbol?: string;
  assetType?: string;
};

/** Schwab order row as returned by `/api/portfolio/orders`. */
export type ReportedOrder = {
  orderId: number;
  orderType?: string;
  status?: string;
  remainingQuantity?: number;
  price?: number | null;
  legs?: ReportedOrderLeg[];
};

export type WorkingSpreadRow = {
  orderId: number;
  remaining: number;
  limit: number;
};

export function tickerFamily(symbol: string | null | undefined): string {
  const raw = (symbol ?? "").trim().replace(/^\$/, "").replace(/^\./, "").toUpperCase();
  return TICKER_FAMILY[raw] ?? raw;
}

function optionLegs(order: ReportedOrder): ReportedOrderLeg[] {
  return (order.legs ?? []).filter((leg) => {
    const asset = (leg.assetType ?? "").toUpperCase();
    return asset === "OPTION" || asset === "INDEX_OPTION" || asset === "FUTURE_OPTION";
  });
}

function legTicker(leg: ReportedOrderLeg): string | null {
  const underlying = tickerFamily(leg.underlyingSymbol);
  if (underlying) return underlying;
  const root = occRoot(leg.symbol);
  return root ? tickerFamily(root) : null;
}

/**
 * The newest order Schwab itself reports as WORKING for this ticker.
 * Stop and trail orders are not the spread's net limit. Status is read from
 * the order, never from a parent or from the send toast.
 */
export function workingSpreadRow(orders: readonly ReportedOrder[], ticker: string): WorkingSpreadRow | null {
  const want = tickerFamily(ticker);
  if (!want) return null;
  for (const order of orders) {
    if ((order.status ?? "").toUpperCase() !== "WORKING") continue;
    const type = (order.orderType ?? "").toUpperCase();
    if (type.includes("STOP") || type.includes("TRAIL")) continue;
    const remaining = order.remainingQuantity;
    if (typeof remaining !== "number" || !(remaining > 0)) continue;
    const limit = order.price;
    if (typeof limit !== "number" || !(Number.isFinite(limit) && limit > 0)) continue;
    const legs = optionLegs(order);
    if (legs.length === 0) continue;
    const matches = legs.every((leg) => {
      const symbol = leg.symbol?.trim() ?? "";
      if (!symbol || occRoot(symbol) == null) return false;
      return legTicker(leg) === want;
    });
    if (!matches) continue;
    return { orderId: order.orderId, remaining, limit };
  }
  return null;
}
