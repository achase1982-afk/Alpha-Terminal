import { useEffect, useMemo, useRef, useState } from "react";
import { AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import {
  readStockDraft,
  stockLimitNotional,
  writeStockDraft,
  type AtStockDraft,
  type AtStockSide,
} from "@/lib/active-trader/atStockDraft";
import { AT_LADDER_ROW_H } from "@/lib/active-trader/atLadderLayout";
import { useEquityTapeStore } from "@/lib/active-trader/equityTapeStore";
import {
  reduceStockTop,
  stockBestPrice,
  stockLadderAnchor,
  stockLadderPrices,
  stockPriceKey,
  stockSizeByPrice,
  EMPTY_STOCK_TOP,
  type StockLevel,
  type StockTopBook,
} from "@/lib/active-trader/stockLadderBook";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { LiveQuote } from "@/lib/store";
import { useTerminalStore } from "@/lib/store";
import { BORDER, WHITE } from "@/components/options/optionsTheme";

const GRID = "minmax(0,1fr) 96px minmax(0,1fr)";

function fmtPx(price: number): string {
  return price.toFixed(2);
}

function fmtSize(size: number): string {
  return Math.round(size).toLocaleString("en-US");
}

function fmtNotional(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const EMPTY_PRINTS: { price: number; size: number; ts: number }[] = [];

function printWash(intensity: number): string | undefined {
  if (!(intensity > 0)) return undefined;
  const alpha = 0.18 + 0.6 * Math.min(1, intensity);
  return `rgba(6, 148, 64, ${alpha.toFixed(3)})`;
}

export function StockLadderBody({ symbol }: { symbol: string }) {
  const upper = symbol.toUpperCase();
  const quote = useTerminalStore((s) => {
    return (s.streamPrices[upper] ?? s.streamPrices[upper.replace(/^\$/, "")]) as LiveQuote | undefined;
  });
  const streamStatus = useTerminalStore((s) => s.streamStatus);
  const venueBooks = useEquityTapeStore((s) => s.books[upper]);
  const prints = useEquityTapeStore((s) => s.prints[upper] ?? EMPTY_PRINTS);
  const [book, setBook] = useState<StockTopBook>(EMPTY_STOCK_TOP);
  const [draft, setDraft] = useState<AtStockDraft>(() => readStockDraft(symbol));
  const [prices, setPrices] = useState<number[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(readStockDraft(symbol));
    setBook(EMPTY_STOCK_TOP);
    setPrices([]);
  }, [symbol]);

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym || sym.startsWith("/") || sym.startsWith("$")) return;
    void fetchWithAuth("/api/stream/equity-tape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [sym] }),
    }).catch(() => {});
  }, [symbol, streamStatus]);

  useEffect(() => {
    setBook((prev) => reduceStockTop(prev, quote));
  }, [quote]);

  const depthBids = useMemo<StockLevel[]>(
    () => [...(venueBooks?.NYSE?.bids ?? []), ...(venueBooks?.NASDAQ?.bids ?? [])],
    [venueBooks],
  );
  const depthAsks = useMemo<StockLevel[]>(
    () => [...(venueBooks?.NYSE?.asks ?? []), ...(venueBooks?.NASDAQ?.asks ?? [])],
    [venueBooks],
  );
  const bidSizes = useMemo(() => stockSizeByPrice(depthBids), [depthBids]);
  const askSizes = useMemo(() => stockSizeByPrice(depthAsks), [depthAsks]);
  const printShares = useMemo(() => stockSizeByPrice(prints), [prints]);
  const printPeak = useMemo(() => {
    let max = 0;
    for (const size of printShares.values()) if (size > max) max = size;
    return max;
  }, [printShares]);

  const anchor = stockLadderAnchor(
    book,
    quote?.last ?? null,
    stockBestPrice(depthBids, "bid"),
    stockBestPrice(depthAsks, "ask"),
  );
  useEffect(() => {
    if (anchor == null) return;
    setPrices((prev) => {
      if (prev.length === 0) return stockLadderPrices(anchor);
      const top = prev[0]!;
      const bottom = prev[prev.length - 1]!;
      if (anchor > bottom && anchor < top) return prev;
      return stockLadderPrices(anchor);
    });
  }, [anchor]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || prices.length === 0) return;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      frames += 1;
      const mid = prices[Math.floor(prices.length / 2)];
      const row = mid == null
        ? null
        : el.querySelector<HTMLElement>(`[data-at-stock-price="${stockPriceKey(mid)}"]`);
      if (row && el.clientHeight > 0) {
        el.scrollTop = Math.max(0, row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2);
        return;
      }
      if (frames < 8) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [prices]);

  const bidKey = book.bid ? stockPriceKey(book.bid.price) : null;
  const askKey = book.ask ? stockPriceKey(book.ask.price) : null;
  const notional = useMemo(() => stockLimitNotional(draft), [draft]);

  const apply = (next: AtStockDraft) => {
    setDraft(writeStockDraft(symbol, next));
  };

  const tapSide = (side: AtStockSide, price: number) => {
    apply({ ...draft, side, limitPrice: price });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0" data-at-stock-ladder={symbol}>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" data-at-stock-scroll>
        {prices.map((price) => {
          const key = stockPriceKey(price);
          const depthBid = bidSizes.get(key) ?? 0;
          const depthAsk = askSizes.get(key) ?? 0;
          const bidSize = depthBid > 0 ? depthBid : bidKey === key ? book.bid?.size ?? null : null;
          const askSize = depthAsk > 0 ? depthAsk : askKey === key ? book.ask?.size ?? null : null;
          const traded = printShares.get(key) ?? 0;
          const intensity = printPeak > 0 ? traded / printPeak : 0;
          const wash = printWash(intensity);
          const selected = draft.limitPrice != null && stockPriceKey(draft.limitPrice) === key;
          return (
            <div
              key={key}
              data-at-stock-price={key}
              data-at-stock-traded={traded > 0 ? String(Math.round(traded)) : undefined}
              className="grid items-center"
              style={{
                gridTemplateColumns: GRID,
                height: AT_LADDER_ROW_H,
                borderBottom: `1px solid ${BORDER}`,
                background: wash ?? (selected ? "rgba(255,255,255,0.04)" : "transparent"),
                boxSizing: "border-box",
              }}
            >
              <button
                type="button"
                data-at-stock-bid={key}
                className="h-full text-right num"
                style={{ color: WHITE, fontSize: 13, background: "transparent", border: "none", paddingRight: 8 }}
                onClick={() => bidSize != null && book.bid && tapSide("SELL", book.bid.price)}
              >
                {bidSize != null ? fmtSize(bidSize) : ""}
              </button>
              <button
                type="button"
                className="h-full text-center num"
                style={{ color: WHITE, fontSize: 16, fontWeight: 600, background: "transparent", border: "none" }}
                onClick={() => apply({ ...draft, limitPrice: price })}
              >
                {fmtPx(price)}
              </button>
              <button
                type="button"
                data-at-stock-ask={key}
                className="h-full text-left num"
                style={{ color: WHITE, fontSize: 13, background: "transparent", border: "none", paddingLeft: 8 }}
                onClick={() => askSize != null && book.ask && tapSide("BUY", book.ask.price)}
              >
                {askSize != null ? fmtSize(askSize) : ""}
              </button>
            </div>
          );
        })}
      </div>
      <div
        data-at-stock-draft
        className="shrink-0 flex items-center gap-3"
        style={{
          height: 44,
          padding: "0 12px",
          borderTop: `1px solid ${BORDER}`,
          color: AT_LABEL,
          fontSize: 13,
        }}
      >
        <span data-at-stock-side style={{ color: WHITE, fontWeight: 700 }}>{draft.side}</span>
        <label className="inline-flex items-center gap-1">
          <span>Shares</span>
          <input
            data-at-stock-shares
            inputMode="numeric"
            value={draft.shares}
            onChange={(e) => {
              const shares = Math.max(1, Math.floor(Number(e.target.value) || 1));
              apply({ ...draft, shares });
            }}
            style={{
              width: 72,
              height: 28,
              background: "transparent",
              color: WHITE,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              padding: "0 6px",
            }}
          />
        </label>
        <span className="num" data-at-stock-limit style={{ color: WHITE }}>
          {draft.limitPrice != null ? fmtPx(draft.limitPrice) : "—"}
        </span>
        <span className="num ml-auto" data-at-stock-notional style={{ color: WHITE, fontWeight: 600 }}>
          {notional != null ? fmtNotional(notional) : "—"}
        </span>
      </div>
    </div>
  );
}
