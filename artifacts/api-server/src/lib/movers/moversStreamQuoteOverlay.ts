import type { MoversFeed } from "@workspace/movers-types";
import { getQuoteBySymbol } from "../schwabStreamer.js";

function schwabApiSymbol(display: string): string {
  const u = display.trim().toUpperCase();
  if (u.startsWith("$")) return u;
  return u;
}

/** Overlay live stream last price onto movers tradeable situations. */
export function overlayMoversFeedFromStream(feed: MoversFeed): void {
  for (const situation of feed.situations ?? []) {
    for (const row of situation.tickers ?? []) {
      const sym = row.symbol?.trim().toUpperCase();
      if (!sym) continue;
      const snap = getQuoteBySymbol(schwabApiSymbol(sym));
      if (snap?.last == null) continue;
      row.price = snap.last;
    }
  }
}