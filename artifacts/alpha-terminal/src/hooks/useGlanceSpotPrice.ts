import { useMemo } from "react";
import { useTerminalStore } from "@/lib/store";
import type { DeskFlowLivePx } from "@/lib/active-trader/deskFlowAggregator";

type SpotSample = { price: number; tsMs: number };

function streamKey(symbol: string): string {
  const u = symbol.toUpperCase();
  return u;
}

/** Freshest L1 between app streamer quote and desk-flow `px` frames. */
export function useGlanceSpotPrice(
  symbol: string,
  underlyingPrice: number | null | undefined,
  deskPx: DeskFlowLivePx | null | undefined,
): number | null {
  const streamQuote = useTerminalStore((s) => s.streamPrices[streamKey(symbol)]);

  return useMemo(() => {
    const candidates: SpotSample[] = [];
    const streamLast = streamQuote?.last ?? streamQuote?.regularLast ?? null;
    const streamTs = streamQuote?.ts ?? 0;
    if (streamLast != null) candidates.push({ price: streamLast, tsMs: streamTs });
    if (underlyingPrice != null && Number.isFinite(underlyingPrice)) {
      candidates.push({ price: underlyingPrice, tsMs: streamTs });
    }
    if (deskPx?.last != null && Number.isFinite(deskPx.last)) {
      candidates.push({ price: deskPx.last, tsMs: deskPx.srcTsMs });
    } else if (deskPx?.bid != null && deskPx?.ask != null) {
      const mid = (deskPx.bid + deskPx.ask) / 2;
      candidates.push({ price: mid, tsMs: deskPx.srcTsMs });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.tsMs - a.tsMs);
    return candidates[0]!.price;
  }, [streamQuote, underlyingPrice, deskPx]);
}