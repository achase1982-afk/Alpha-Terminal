import { useEffect, useMemo, useState } from "react";
import { AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import {
  readStockDraft,
  stockLimitNotional,
  writeStockDraft,
  type AtStockDraft,
  type AtStockSide,
} from "@/lib/active-trader/atStockDraft";
import { AT_LADDER_ROW_H } from "@/lib/active-trader/atLadderLayout";
import {
  reduceStockTop,
  stockLadderAnchor,
  stockLadderPrices,
  stockPriceKey,
  EMPTY_STOCK_TOP,
  type StockTopBook,
} from "@/lib/active-trader/stockLadderBook";
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

export function StockLadderBody({ symbol }: { symbol: string }) {
  const quote = useTerminalStore((s) => {
    const upper = symbol.toUpperCase();
    return (s.streamPrices[upper] ?? s.streamPrices[upper.replace(/^\$/, "")]) as LiveQuote | undefined;
  });
  const [book, setBook] = useState<StockTopBook>(EMPTY_STOCK_TOP);
  const [draft, setDraft] = useState<AtStockDraft>(() => readStockDraft(symbol));
  const [prices, setPrices] = useState<number[]>([]);

  useEffect(() => {
    setDraft(readStockDraft(symbol));
    setBook(EMPTY_STOCK_TOP);
    setPrices([]);
  }, [symbol]);

  useEffect(() => {
    setBook((prev) => reduceStockTop(prev, quote));
  }, [quote]);

  const anchor = stockLadderAnchor(book, quote?.last ?? null);
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
      <div className="flex-1 min-h-0 overflow-y-auto" data-at-stock-scroll>
        {prices.map((price) => {
          const key = stockPriceKey(price);
          const bidSize = bidKey === key ? book.bid?.size : null;
          const askSize = askKey === key ? book.ask?.size : null;
          const selected = draft.limitPrice != null && stockPriceKey(draft.limitPrice) === key;
          return (
            <div
              key={key}
              data-at-stock-price={key}
              className="grid items-center"
              style={{
                gridTemplateColumns: GRID,
                height: AT_LADDER_ROW_H,
                borderBottom: `1px solid ${BORDER}`,
                background: selected ? "rgba(255,255,255,0.04)" : "transparent",
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
