const FUTURES_SLASH_SYMBOL = /^\.?\//;

export type SchwabOrderLegInstrument = {
  symbol?: string;
  assetType?: string;
};

export type SchwabOrderLeg = {
  instrument?: SchwabOrderLegInstrument;
};

export type SchwabOrderNode = {
  orderLegCollection?: SchwabOrderLeg[];
  childOrderStrategies?: SchwabOrderNode[];
};

export function isBlockedFuturesTradeSymbol(symbol: string): boolean {
  const s = symbol.trim();
  if (!s) return false;
  return FUTURES_SLASH_SYMBOL.test(s);
}

export function isBlockedFuturesAssetType(assetType: string | undefined): boolean {
  if (!assetType) return false;
  const u = assetType.toUpperCase();
  return u === "FUTURE" || u === "FUTURE_OPTION";
}

export function orderLegReferencesBlockedFutures(leg: SchwabOrderLeg): boolean {
  const sym = leg.instrument?.symbol;
  if (typeof sym === "string" && isBlockedFuturesTradeSymbol(sym)) return true;
  return isBlockedFuturesAssetType(leg.instrument?.assetType);
}

export function orderReferencesBlockedFutures(order: SchwabOrderNode): boolean {
  const walk = (node: SchwabOrderNode): boolean => {
    for (const leg of node.orderLegCollection ?? []) {
      if (orderLegReferencesBlockedFutures(leg)) return true;
    }
    for (const child of node.childOrderStrategies ?? []) {
      if (child && typeof child === "object" && walk(child)) return true;
    }
    return false;
  };
  return walk(order);
}