import { getQuoteBySymbol } from "./schwabStreamer.js";

export type ScannerQuoteRow = {
  price?: number | null;
  volume?: number | null;
  avgVolume20d?: number | null;
  impliedVolatility?: number | null;
};

function schwabApiSymbol(display: string): string {
  const u = display.trim().toUpperCase();
  if (u.startsWith("$")) return u;
  if (["VIX", "VVIX", "VIX9D", "VIX3M", "VIX1D"].includes(u)) return `$${u}`;
  return u;
}

/** Overlay L1 stream marks on scanner quote rows where subscribed. */
export function overlayScannerQuotesFromStream<T extends ScannerQuoteRow>(
  tickers: string[],
  quoteMap: Map<string, T>,
): void {
  for (const raw of tickers) {
    const symbol = raw.trim().toUpperCase();
    const snap = getQuoteBySymbol(schwabApiSymbol(symbol));
    if (snap?.last == null) continue;
    const prev = quoteMap.get(symbol) ?? ({} as T);
    quoteMap.set(symbol, { ...prev, price: snap.last });
  }
}