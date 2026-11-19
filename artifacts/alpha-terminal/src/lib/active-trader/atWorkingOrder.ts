import { occRoot, seriesRootFromExpiration } from "@/lib/active-trader/optionSeries";

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
  orderId: number | string;
  orderType?: string;
  status?: string;
  remainingQuantity?: number;
  price?: number | null;
  legs?: ReportedOrderLeg[];
};

export type VerifiedOrderReport = {
  accountHash: string;
  orders: ReportedOrder[];
};

/** The order that was submitted, kept after the draft closes. */
export type WorkingOrderAnchor = {
  orderId: string | null;
  accountHash: string;
  occSymbols: string[];
};

export type WorkingSpreadRow = {
  orderId: number | string;
  remaining: number;
  limit: number;
};

export function tickerFamily(symbol: string | null | undefined): string {
  const raw = (symbol ?? "").trim().replace(/^\$/, "").replace(/^\./, "").toUpperCase();
  return TICKER_FAMILY[raw] ?? raw;
}

/** Collapse a Schwab OCC symbol. A full contract used as `underlyingSymbol` still parses. */
export function normalizeOccSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  let raw = symbol.trim().toUpperCase();
  if (raw.startsWith(".")) raw = raw.slice(1);
  raw = raw.replace(/\s+/g, "");
  if (!occRoot(raw)) return null;
  return raw;
}

export function isVerifiedOrderReport(data: unknown): data is VerifiedOrderReport {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const row = data as { accountHash?: unknown; orders?: unknown };
  return typeof row.accountHash === "string" && row.accountHash.length > 0 && Array.isArray(row.orders);
}

function optionLegs(order: ReportedOrder): ReportedOrderLeg[] {
  return (order.legs ?? []).filter((leg) => {
    const asset = (leg.assetType ?? "").toUpperCase();
    return asset === "OPTION" || asset === "INDEX_OPTION" || asset === "FUTURE_OPTION";
  });
}

function legContract(leg: ReportedOrderLeg): string | null {
  return normalizeOccSymbol(leg.symbol) ?? normalizeOccSymbol(leg.underlyingSymbol);
}

function legTicker(leg: ReportedOrderLeg): string | null {
  const contract = legContract(leg);
  if (contract) {
    const root = occRoot(contract);
    return root ? tickerFamily(root) : null;
  }
  const underlying = (leg.underlyingSymbol ?? "").trim();
  if (!underlying || normalizeOccSymbol(underlying)) return null;
  const family = tickerFamily(underlying);
  return family || null;
}

function orderOnTicker(order: ReportedOrder, ticker: string): boolean {
  const want = tickerFamily(ticker);
  const legs = optionLegs(order);
  if (!want || legs.length === 0) return false;
  return legs.every((leg) => legTicker(leg) === want);
}

function occOnSelectedExpiry(symbol: string, selectedExpiration: string): boolean {
  const root = occRoot(symbol);
  if (!root) return false;
  const suffix = symbol.slice(-15);
  const yymmdd = suffix.slice(0, 6);
  const ymd = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  if (selectedExpiration.slice(0, 10) !== ymd) return false;
  const series = seriesRootFromExpiration(selectedExpiration);
  if (series) return series.toUpperCase() === root.toUpperCase();
  return true;
}

function sameContractSet(order: ReportedOrder, occSymbols: readonly string[]): boolean {
  const want = occSymbols
    .map((symbol) => normalizeOccSymbol(symbol))
    .filter((symbol): symbol is string => !!symbol)
    .sort();
  const got = optionLegs(order)
    .map((leg) => legContract(leg))
    .filter((symbol): symbol is string => !!symbol)
    .sort();
  if (want.length === 0 || got.length !== want.length) return false;
  return got.every((symbol, index) => symbol === want[index]);
}

function onSelectedExpiry(order: ReportedOrder, selectedExpiration: string): boolean {
  const contracts = optionLegs(order)
    .map((leg) => legContract(leg))
    .filter((symbol): symbol is string => !!symbol);
  if (contracts.length === 0) return false;
  return contracts.every((symbol) => occOnSelectedExpiry(symbol, selectedExpiration));
}

/** The order's own status. A stop or trail is not this spread's net limit. */
function workingEntry(order: ReportedOrder): { remaining: number; limit: number } | null {
  if ((order.status ?? "").toUpperCase() !== "WORKING") return null;
  const type = (order.orderType ?? "").toUpperCase();
  if (type.includes("STOP") || type.includes("TRAIL")) return null;
  const remaining = order.remainingQuantity;
  if (typeof remaining !== "number" || !(remaining > 0)) return null;
  const limit = order.price;
  if (typeof limit !== "number" || !(Number.isFinite(limit) && limit > 0)) return null;
  return { remaining, limit };
}

/**
 * The submitted order, after Schwab reports it WORKING.
 * Without that id, only an order whose OCC symbols are the submitted contracts
 * on the selected expiry qualifies. Another order on the same ticker does not.
 */
export function workingSpreadRow(
  orders: readonly ReportedOrder[],
  anchor: WorkingOrderAnchor,
  selectedExpiration: string | null,
  ticker: string,
): WorkingSpreadRow | null {
  const submittedId = anchor.orderId?.trim() ?? "";
  if (submittedId) {
    const match = orders.find((order) => String(order.orderId) === submittedId);
    if (!match || !orderOnTicker(match, ticker)) return null;
    const working = workingEntry(match);
    if (!working) return null;
    return { orderId: match.orderId, remaining: working.remaining, limit: working.limit };
  }
  if (!selectedExpiration) return null;
  for (const order of orders) {
    const working = workingEntry(order);
    if (!working || !orderOnTicker(order, ticker)) continue;
    if (!sameContractSet(order, anchor.occSymbols)) continue;
    if (!onSelectedExpiry(order, selectedExpiration)) continue;
    return { orderId: order.orderId, remaining: working.remaining, limit: working.limit };
  }
  return null;
}
