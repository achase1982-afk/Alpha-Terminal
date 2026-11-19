import { useEffect, useMemo, useRef, useState } from "react";
import { AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import {
  readStockDraft,
  stockLimitNotional,
  writeStockDraft,
  type AtStockDraft,
  type AtStockSide,
} from "@/lib/active-trader/atStockDraft";
import { useEquityTapeStore } from "@/lib/active-trader/equityTapeStore";
import {
  epochMs,
  reduceStockTop,
  stockBestPrice,
  stockBookByPrice,
  stockFeedMark,
  stockHeatTone,
  stockLadderAnchor,
  stockLadderPrices,
  stockPeak,
  stockPriceKey,
  stockSizeByPrice,
  STOCK_LADDER_GRID,
  STOCK_PRINT_WINDOW_MS,
  EMPTY_STOCK_TOP,
  type StockLevel,
  type StockPriceSize,
  type StockTopBook,
} from "@/lib/active-trader/stockLadderBook";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { LiveQuote } from "@/lib/store";
import { useTerminalStore } from "@/lib/store";
import { BORDER, WHITE } from "@/components/options/optionsTheme";

const ROW_H = 52;
const PANEL = "#060709";
const PRICE_BG = "#22262A";

const VOLUME_SCALE = { dark: [10, 48, 86], bright: [110, 245, 255] } as const;
const BID_SCALE = { dark: [6, 64, 36], bright: [120, 255, 160] } as const;
const ASK_SCALE = { dark: [92, 18, 22], bright: [255, 168, 158] } as const;

const FEED_COPY = {
  live: "",
  stale: "Feed stale",
  unavailable: "Feed unavailable",
  connecting: "Feed connecting",
} as const;

function fmtPx(price: number): string {
  return price.toFixed(2);
}

function fmtSize(size: number): string {
  return Math.round(size).toLocaleString("en-US");
}

function fmtNotional(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function feedLabel(source: string | null | undefined): string {
  if (!source) return "NBBO";
  if (source === "IBKR_CBOE_ONE") return "CBOE";
  if (source === "IBKR_PRO") return "IBKR";
  return source;
}

function sizeSource(row: StockPriceSize): string {
  if (row.parts.length === 1) return row.parts[0]!.venue;
  return row.parts
    .map((part) => `${part.venue === "NASDAQ" ? "NDQ" : part.venue} ${fmtSize(part.size)}`)
    .join(" · ");
}

function mixTile(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): { bg: string; ink: string } {
  const u = Math.min(1, Math.max(0, t));
  const rgb = [
    Math.round(from[0] + (to[0] - from[0]) * u),
    Math.round(from[1] + (to[1] - from[1]) * u),
    Math.round(from[2] + (to[2] - from[2]) * u),
  ] as const;
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return {
    bg: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    ink: lum > 0.58 ? "#10151A" : "#F4F7FA",
  };
}

const EMPTY_PRINTS: { price: number; size: number; ts: number }[] = [];

function HeatTile({
  count,
  peak,
  source,
  scale,
  dataAttr,
  onPress,
}: {
  count: number;
  peak: number;
  source: string;
  scale: { dark: readonly [number, number, number]; bright: readonly [number, number, number] };
  dataAttr: Record<string, string | undefined>;
  onPress: () => void;
}) {
  const populated = count > 0;
  const tone = populated ? stockHeatTone(count, peak) : 0;
  const color = populated ? mixTile(scale.dark, scale.bright, tone) : null;
  return (
    <button
      type="button"
      onClick={populated ? onPress : undefined}
      {...dataAttr}
      style={{
        height: "100%",
        width: "100%",
        margin: 0,
        padding: "2px 3px",
        boxSizing: "border-box",
        border: "none",
        background: color?.bg ?? "transparent",
        color: color?.ink ?? "transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1.05,
        boxShadow: populated ? "inset -1px 0 0 rgba(0,0,0,0.28)" : "none",
        WebkitAppearance: "none",
        opacity: 1,
      }}
    >
      {populated ? (
        <>
          <span className="num" style={{ fontSize: 16, fontWeight: 700 }}>
            {fmtSize(count)}
          </span>
          {source ? (
            <span style={{ marginTop: 2, fontSize: 9, fontWeight: 600, letterSpacing: "0.01em" }}>
              {source}
            </span>
          ) : null}
        </>
      ) : null}
    </button>
  );
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
  const [now, setNow] = useState(() => Date.now());
  const [follow, setFollow] = useState(true);
  const [recenterNonce, setRecenterNonce] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const programmatic = useRef(false);

  useEffect(() => {
    followRef.current = true;
    setFollow(true);
    setDraft(readStockDraft(symbol));
    setBook(EMPTY_STOCK_TOP);
    setPrices([]);
  }, [symbol]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (programmatic.current) return;
      if (!followRef.current) return;
      followRef.current = false;
      setFollow(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [symbol]);

  const depthSeen =
    (venueBooks?.NYSE?.bids.length ?? 0) +
      (venueBooks?.NYSE?.asks.length ?? 0) +
      (venueBooks?.NASDAQ?.bids.length ?? 0) +
      (venueBooks?.NASDAQ?.asks.length ?? 0) >
    0;
  const bidBook = useMemo(
    () =>
      stockBookByPrice([
        { venue: "NYSE", levels: venueBooks?.NYSE?.bids ?? [] },
        { venue: "NASDAQ", levels: venueBooks?.NASDAQ?.bids ?? [] },
      ]),
    [venueBooks],
  );
  const askBook = useMemo(
    () =>
      stockBookByPrice([
        { venue: "NYSE", levels: venueBooks?.NYSE?.asks ?? [] },
        { venue: "NASDAQ", levels: venueBooks?.NASDAQ?.asks ?? [] },
      ]),
    [venueBooks],
  );
  const depthBids = useMemo<StockLevel[]>(
    () => [...(venueBooks?.NYSE?.bids ?? []), ...(venueBooks?.NASDAQ?.bids ?? [])],
    [venueBooks],
  );
  const depthAsks = useMemo<StockLevel[]>(
    () => [...(venueBooks?.NYSE?.asks ?? []), ...(venueBooks?.NASDAQ?.asks ?? [])],
    [venueBooks],
  );
  const tradedShares = useMemo(() => {
    const live = prints.filter((print) => now - print.ts <= STOCK_PRINT_WINDOW_MS);
    return stockSizeByPrice(live);
  }, [prints, now]);

  const sizePeak = useMemo(() => {
    const sizes: number[] = [];
    for (const row of bidBook.values()) sizes.push(row.total);
    for (const row of askBook.values()) sizes.push(row.total);
    if (!depthSeen) {
      if (book.bid) sizes.push(book.bid.size);
      if (book.ask) sizes.push(book.ask.size);
    }
    return stockPeak(sizes);
  }, [askBook, bidBook, book.ask, book.bid, depthSeen]);
  const volumePeak = useMemo(() => stockPeak(tradedShares.values()), [tradedShares]);

  const bestBid = depthSeen ? stockBestPrice(depthBids, "bid") : book.bid?.price ?? null;
  const bestAsk = depthSeen ? stockBestPrice(depthAsks, "ask") : book.ask?.price ?? null;
  const bestBidKey = bestBid != null ? stockPriceKey(bestBid) : null;
  const bestAskKey = bestAsk != null ? stockPriceKey(bestAsk) : null;

  const anchor = stockLadderAnchor(
    depthSeen ? EMPTY_STOCK_TOP : book,
    quote?.last ?? quote?.extendedLast ?? null,
    bestBid,
    bestAsk,
  );
  useEffect(() => {
    if (anchor == null || !follow) return;
    setPrices((prev) => {
      if (prev.length === 0) return stockLadderPrices(anchor);
      const top = prev[0]!;
      const bottom = prev[prev.length - 1]!;
      if (anchor > bottom && anchor < top) return prev;
      return stockLadderPrices(anchor);
    });
  }, [anchor, follow]);

  useEffect(() => {
    if (!follow || prices.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    let frames = 0;
    let raf = 0;
    let clearTimer = 0;
    const place = () => {
      programmatic.current = true;
      const bidEl = bestBidKey
        ? el.querySelector<HTMLElement>(`[data-at-stock-price="${bestBidKey}"]`)
        : null;
      const askEl = bestAskKey
        ? el.querySelector<HTMLElement>(`[data-at-stock-price="${bestAskKey}"]`)
        : null;
      if (bidEl && askEl && el.clientHeight > 0) {
        const top = Math.min(bidEl.offsetTop, askEl.offsetTop);
        const bottom = Math.max(
          bidEl.offsetTop + bidEl.offsetHeight,
          askEl.offsetTop + askEl.offsetHeight,
        );
        const span = bottom - top;
        el.scrollTop =
          span <= el.clientHeight
            ? Math.max(0, top - (el.clientHeight - span) / 2)
            : Math.max(0, (top + bottom) / 2 - el.clientHeight / 2);
      } else {
        const mid = prices[Math.floor(prices.length / 2)];
        const row =
          mid == null
            ? null
            : el.querySelector<HTMLElement>(`[data-at-stock-price="${stockPriceKey(mid)}"]`);
        if (row && el.clientHeight > 0) {
          el.scrollTop = Math.max(0, row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2);
        }
      }
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => {
        programmatic.current = false;
      }, 350);
    };
    const tick = () => {
      frames += 1;
      if (el.clientHeight > 0) {
        place();
        return;
      }
      if (frames < 8) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clearTimer);
    };
  }, [bestAskKey, bestBidKey, follow, prices, recenterNonce]);

  const newestMs = useMemo(() => {
    const candidates = [
      epochMs(quote?.ts),
      epochMs(venueBooks?.NYSE?.ts),
      epochMs(venueBooks?.NASDAQ?.ts),
      prints.length > 0 ? epochMs(prints[prints.length - 1]?.ts) : null,
    ];
    let best: number | null = null;
    for (const ms of candidates) {
      if (ms == null) continue;
      if (best == null || ms > best) best = ms;
    }
    return best;
  }, [prints, quote?.ts, venueBooks]);
  const feed = stockFeedMark({ streamStatus, newestMs, now });

  const notional = useMemo(() => stockLimitNotional(draft), [draft]);
  const apply = (next: AtStockDraft) => {
    setDraft(writeStockDraft(symbol, next));
  };
  const pauseFollow = () => {
    followRef.current = false;
    setFollow(false);
  };
  const stage = (side: AtStockSide | null, price: number) => {
    pauseFollow();
    apply(side == null ? { ...draft, limitPrice: price } : { ...draft, side, limitPrice: price });
  };
  const recenter = () => {
    followRef.current = true;
    setFollow(true);
    if (anchor != null) setPrices(stockLadderPrices(anchor));
    setRecenterNonce((n) => n + 1);
  };

  const l1Bid = !depthSeen && book.bid
    ? { total: book.bid.size, parts: [{ venue: feedLabel(quote?.quoteSource), size: book.bid.size }] }
    : null;
  const l1Ask = !depthSeen && book.ask
    ? { total: book.ask.size, parts: [{ venue: feedLabel(quote?.quoteSource), size: book.ask.size }] }
    : null;

  return (
    <div className="flex flex-col flex-1 min-h-0" data-at-stock-ladder={symbol} style={{ background: PANEL }}>
      <div
        className="shrink-0 flex items-center justify-between"
        style={{ height: 28, padding: "0 8px", borderBottom: `1px solid ${BORDER}` }}
      >
        <span
          data-at-stock-feed={feed}
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: feed === "stale" ? "#E2B340" : feed === "unavailable" ? "#FF8A80" : "#9AA4AD",
          }}
        >
          {FEED_COPY[feed]}
        </span>
        <button
          type="button"
          data-at-stock-recenter
          data-at-stock-follow={follow ? "1" : "0"}
          onClick={recenter}
          style={{
            height: 22,
            padding: "0 8px",
            borderRadius: 6,
            border: `1px solid ${follow ? BORDER : "#E2B340"}`,
            background: follow ? "transparent" : "#3A2E10",
            color: follow ? AT_LABEL : "#F4E2A8",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          Recenter
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" data-at-stock-scroll>
        {prices.map((price) => {
          const key = stockPriceKey(price);
          const traded = tradedShares.get(key) ?? 0;
          const bidRow = bidBook.get(key) ?? (l1Bid && bestBidKey === key ? l1Bid : null);
          const askRow = askBook.get(key) ?? (l1Ask && bestAskKey === key ? l1Ask : null);
          const bidSize = bidRow?.total ?? 0;
          const askSize = askRow?.total ?? 0;
          const selected = draft.limitPrice != null && stockPriceKey(draft.limitPrice) === key;
          const atBid = bestBidKey === key;
          const atAsk = bestAskKey === key;
          return (
            <div
              key={key}
              data-at-stock-price={key}
              data-at-stock-traded={traded > 0 ? String(Math.round(traded)) : undefined}
              className="grid"
              style={{
                gridTemplateColumns: STOCK_LADDER_GRID,
                height: ROW_H,
                borderBottom: `1px solid ${BORDER}`,
                background: PANEL,
                boxSizing: "border-box",
              }}
            >
              <HeatTile
                count={traded}
                peak={volumePeak}
                source=""
                scale={{
                  dark: VOLUME_SCALE.dark,
                  bright: VOLUME_SCALE.bright,
                }}
                dataAttr={{
                  "data-at-stock-volume": key,
                  "data-at-stock-volume-tone": traded > 0 ? stockHeatTone(traded, volumePeak).toFixed(3) : undefined,
                }}
                onPress={() => stage(null, price)}
              />
              <HeatTile
                count={bidSize}
                peak={sizePeak}
                source={bidRow ? sizeSource(bidRow) : ""}
                scale={{ dark: BID_SCALE.dark, bright: BID_SCALE.bright }}
                dataAttr={{
                  "data-at-stock-bid": key,
                  "data-at-stock-bid-tone": bidSize > 0 ? stockHeatTone(bidSize, sizePeak).toFixed(3) : undefined,
                }}
                onPress={() => stage("SELL", price)}
              />
              <button
                type="button"
                data-at-stock-best-bid={atBid ? "1" : undefined}
                data-at-stock-best-ask={atAsk ? "1" : undefined}
                className="h-full num"
                onClick={() => stage(null, price)}
                style={{
                  color: WHITE,
                  fontSize: 15,
                  fontWeight: 700,
                  background: PRICE_BG,
                  border: "none",
                  boxShadow: atBid
                    ? "inset 3px 0 0 #3DDC84"
                    : atAsk
                      ? "inset 3px 0 0 #FF6B63"
                      : "none",
                  outline: selected ? "1px solid #F4F7FA" : "none",
                  outlineOffset: -1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1.05,
                  padding: 0,
                }}
              >
                <span>{fmtPx(price)}</span>
                {atBid || atAsk ? (
                  <span
                    style={{
                      marginTop: 2,
                      fontSize: 9,
                      fontWeight: 800,
                      letterSpacing: "0.06em",
                      color: atBid ? "#3DDC84" : "#FF6B63",
                    }}
                  >
                    {atBid && atAsk ? "BID · ASK" : atBid ? "BID" : "ASK"}
                  </span>
                ) : null}
              </button>
              <HeatTile
                count={askSize}
                peak={sizePeak}
                source={askRow ? sizeSource(askRow) : ""}
                scale={{ dark: ASK_SCALE.dark, bright: ASK_SCALE.bright }}
                dataAttr={{
                  "data-at-stock-ask": key,
                  "data-at-stock-ask-tone": askSize > 0 ? stockHeatTone(askSize, sizePeak).toFixed(3) : undefined,
                }}
                onPress={() => stage("BUY", price)}
              />
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
