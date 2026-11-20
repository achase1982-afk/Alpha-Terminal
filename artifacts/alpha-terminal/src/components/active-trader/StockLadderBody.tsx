import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AtInstrumentModePill } from "./AtInstrumentModePill";
import { AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import {
  readStockDraft,
  stockLimitNotional,
  writeStockDraft,
  type AtStockDraft,
  type AtStockSide,
} from "@/lib/active-trader/atStockDraft";
import {
  AT_LADDER_STRIKE_BG,
  AT_LADDER_THIN_SEP,
  AT_LADDER_COL_HDR_H,
  AT_LADDER_GROUP_HDR_H,
  AT_STOCK_LADDER_GRID,
  AT_LADDER_ROW_H,
} from "@/lib/active-trader/atLadderLayout";
import { useEquityTapeStore } from "@/lib/active-trader/equityTapeStore";
import {
  reduceStockTop,
  stockBestPrice,
  stockBookSizeIntensity,
  stockBookSizeHeatColor,
  stockLadderAnchor,
  stockLadderPrices,
  stockPriceKey,
  stockSizeByPrice,
  stockVolumeHeatColor,
  EMPTY_STOCK_TOP,
  type StockLevel,
  type StockTopBook,
} from "@/lib/active-trader/stockLadderBook";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { LiveQuote } from "@/lib/store";
import { useTerminalStore } from "@/lib/store";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import type { SchwabAccountSummary, SchwabPosition } from "@/lib/schwab-account-types";
import { AT_HEADER_BG } from "@/lib/active-trader/atChromeContrast";
import { toast } from "@/hooks/use-toast";
import { BORDER, WHITE } from "@/components/options/optionsTheme";
import { SpotRecenterPill } from "@/components/options/SpotRecenterPill";

function fmtPx(price: number): string {
  return price.toFixed(2);
}

function fmtSize(size: number): string {
  return Math.round(size).toLocaleString("en-US");
}

function fmtVolume(size: number): string {
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(size >= 10_000_000 ? 0 : 1)}M`;
  if (size >= 1_000) return `${(size / 1_000).toFixed(size >= 100_000 ? 0 : 1)}K`;
  return fmtSize(size);
}

function fmtNotional(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const EMPTY_PRINTS: { price: number; size: number; ts: number }[] = [];
const EMPTY_VOLUME: Record<string, number> = {};

type EquityTapeSeedResponse = {
  sessionDate?: string;
  volumeByPrice?: Record<string, Record<string, number>>;
};

type StockInstruction = "BUY" | "SELL_SHORT" | "SELL" | "BUY_TO_COVER";

type StockReportedOrder = {
  orderId: number;
  status?: string;
};

const ACTIVE_ORDER_STATUSES = new Set([
  "ACCEPTED",
  "AWAITING_CONDITION",
  "AWAITING_MANUAL_REVIEW",
  "AWAITING_PARENT_ORDER",
  "AWAITING_STOP_CONDITION",
  "AWAITING_UR_OUT",
  "PENDING_ACTIVATION",
  "QUEUED",
  "WORKING",
]);

function stockOrderPayload(input: {
  symbol: string;
  instruction: StockInstruction;
  shares: number;
  orderType: "LIMIT" | "MARKET";
  price?: number;
}): Record<string, unknown> {
  return {
    orderType: input.orderType,
    session: input.orderType === "LIMIT" ? "SEAMLESS" : "NORMAL",
    duration: "DAY",
    orderStrategyType: "SINGLE",
    ...(input.orderType === "LIMIT" && input.price != null
      ? { price: Number(input.price.toFixed(2)) }
      : {}),
    orderLegCollection: [
      {
        instruction: input.instruction,
        quantity: input.shares,
        instrument: { symbol: input.symbol, assetType: "EQUITY" },
      },
    ],
  };
}

async function responseMessage(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  return data?.message ?? data?.error ?? `Request failed (${res.status})`;
}

export function StockLadderBody({
  symbol,
  onToggleTemplate,
  onOpenStockTicket,
}: {
  symbol: string;
  onToggleTemplate: () => void;
  onOpenStockTicket?: (draft: { side: AtStockSide; quantity: number; limitPrice?: number | null }) => void;
}) {
  const upper = symbol.toUpperCase();
  const quote = useTerminalStore((s) => {
    return (s.streamPrices[upper] ?? s.streamPrices[upper.replace(/^\$/, "")]) as LiveQuote | undefined;
  });
  const streamStatus = useTerminalStore((s) => s.streamStatus);
  const venueBooks = useEquityTapeStore((s) => s.books[upper]);
  const prints = useEquityTapeStore((s) => s.prints[upper] ?? EMPTY_PRINTS);
  const accumVolumeByPrice = useEquityTapeStore((s) => s.volumeByPrice[upper] ?? EMPTY_VOLUME);
  const [book, setBook] = useState<StockTopBook>(EMPTY_STOCK_TOP);
  const [draft, setDraft] = useState<AtStockDraft>(() => readStockDraft(symbol));
  const [prices, setPrices] = useState<number[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [anchorOffCenter, setAnchorOffCenter] = useState(false);
  const tradingAccountHash = useSchwabAccountStore((s) =>
    s.orderTicketAccountHash ??
    (s.viewSelection !== "all" ? s.viewSelection : s.defaultTradingAccountHash),
  );
  const accounts = usePortfolioStreamStore((s) => s.accounts);

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
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as EquityTapeSeedResponse;
        if (!data.sessionDate) return;
        useEquityTapeStore.getState().seedVolumeProfile({
          symbol: sym,
          sessionDate: data.sessionDate,
          volumeByPrice: data.volumeByPrice?.[sym] ?? {},
        });
      })
      .catch(() => {});
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
  const bidPeak = useMemo(() => {
    let max = book.bid?.size ?? 0;
    for (const size of bidSizes.values()) max = Math.max(max, size);
    return max;
  }, [bidSizes, book.bid?.size]);
  const askPeak = useMemo(() => {
    let max = book.ask?.size ?? 0;
    for (const size of askSizes.values()) max = Math.max(max, size);
    return max;
  }, [askSizes, book.ask?.size]);
  const printShares = useMemo(() => stockSizeByPrice(prints), [prints]);
  /** Accumulated volume per price: session accumulation, falling back to the recent print window. */
  const accumShares = useMemo(() => {
    const out = new Map<string, number>();
    for (const [key, size] of printShares) out.set(key, size);
    for (const [key, size] of Object.entries(accumVolumeByPrice)) {
      if (size > (out.get(key) ?? 0)) out.set(key, size);
    }
    return out;
  }, [printShares, accumVolumeByPrice]);
  const accumPeak = useMemo(() => {
    let max = 0;
    for (const price of prices) {
      const size = accumShares.get(stockPriceKey(price)) ?? 0;
      if (size > max) max = size;
    }
    return max;
  }, [accumShares, prices]);

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

  const scrollStockToAnchor = useCallback(() => {
    const el = scrollRef.current;
    if (!el || anchor == null) return;
    const row = el.querySelector<HTMLElement>(`[data-at-stock-price="${stockPriceKey(anchor)}"]`);
    if (!row) return;
    const top = row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2;
    el.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [anchor]);

  const measureStockAnchor = useCallback(() => {
    const el = scrollRef.current;
    if (!el || anchor == null) {
      setAnchorOffCenter(false);
      return;
    }
    const row = el.querySelector<HTMLElement>(`[data-at-stock-price="${stockPriceKey(anchor)}"]`);
    if (!row) {
      setAnchorOffCenter(false);
      return;
    }
    const cRect = el.getBoundingClientRect();
    const tRect = row.getBoundingClientRect();
    const rowCenter = tRect.top + tRect.height / 2 - cRect.top;
    setAnchorOffCenter(Math.abs(rowCenter - el.clientHeight / 2) > 56);
  }, [anchor]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureStockAnchor);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    measureStockAnchor();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [measureStockAnchor, prices.length]);

  const bidKey = book.bid ? stockPriceKey(book.bid.price) : null;
  const askKey = book.ask ? stockPriceKey(book.ask.price) : null;
  const notional = useMemo(() => stockLimitNotional(draft), [draft]);

  const apply = useCallback((next: AtStockDraft) => {
    setDraft(writeStockDraft(symbol, next));
  }, [symbol]);

  const fetchCurrentOrders = useCallback(async (): Promise<StockReportedOrder[]> => {
    if (!tradingAccountHash) return [];
    const res = await fetchWithAuth(
      `/api/portfolio/orders?accountHash=${encodeURIComponent(tradingAccountHash)}&accountIdentity=1&days=2`,
    );
    if (!res.ok) throw new Error(await responseMessage(res));
    const data = (await res.json()) as { orders?: StockReportedOrder[] };
    return Array.isArray(data.orders) ? data.orders : [];
  }, [tradingAccountHash]);

  const placeStockOrder = useCallback(async (
    instruction: StockInstruction,
    orderType: "LIMIT" | "MARKET",
    price?: number,
  ) => {
    if (!tradingAccountHash || actionBusy) return;
    const shares = Math.max(1, draft.shares);
    const busyKey = `${instruction}-${orderType}`;
    setActionBusy(busyKey);
    try {
      const res = await fetchWithAuth("/api/portfolio/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountHash: tradingAccountHash,
          order: stockOrderPayload({ symbol: upper, instruction, shares, orderType, price }),
        }),
      });
      if (!res.ok) throw new Error(await responseMessage(res));
      toast({
        title: `${instruction.replaceAll("_", " ")} sent`,
        description: `${shares} ${upper}${price != null ? ` @ ${price.toFixed(2)}` : " at market"}`,
      });
    } catch (error) {
      toast({
        title: "Order rejected",
        description: error instanceof Error ? error.message : "Unable to place order",
        variant: "destructive",
      });
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, draft.shares, tradingAccountHash, upper]);

  const tapLimit = useCallback((side: AtStockSide, price: number) => {
    apply({ ...draft, side, limitPrice: price });
    if (onOpenStockTicket) {
      onOpenStockTicket({ side, quantity: Math.max(1, draft.shares), limitPrice: price });
      return;
    }
    void placeStockOrder(side === "BUY" ? "BUY" : "SELL_SHORT", "LIMIT", price);
  }, [apply, draft, onOpenStockTicket, placeStockOrder]);

  const cancelWorkingOrders = useCallback(async (): Promise<number> => {
    if (!tradingAccountHash) return 0;
    const live = await fetchCurrentOrders();
    const cancelable = live.filter((order) =>
      ACTIVE_ORDER_STATUSES.has((order.status ?? "").toUpperCase()),
    );
    let canceled = 0;
    for (const order of cancelable) {
      const res = await fetchWithAuth("/api/portfolio/cancel-order", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountHash: tradingAccountHash,
          orderId: String(order.orderId),
        }),
      });
      if (res.ok) canceled += 1;
    }
    return canceled;
  }, [fetchCurrentOrders, tradingAccountHash]);

  const handleCancelAll = useCallback(async () => {
    if (!tradingAccountHash || actionBusy) return;
    setActionBusy("cancel");
    try {
      const canceled = await cancelWorkingOrders();
      toast({
        title: canceled > 0 ? "Orders canceled" : "No working orders",
        description: canceled > 0 ? `${canceled} pending order${canceled === 1 ? "" : "s"} canceled` : undefined,
      });
    } catch (error) {
      toast({
        title: "Cancel failed",
        description: error instanceof Error ? error.message : "Unable to cancel orders",
        variant: "destructive",
      });
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, cancelWorkingOrders, tradingAccountHash]);

  const handleFlatten = useCallback(async () => {
    if (!tradingAccountHash || actionBusy) return;
    setActionBusy("flatten");
    try {
      await cancelWorkingOrders();
      const res = await fetchWithAuth("/api/portfolio/accounts");
      if (!res.ok) throw new Error(await responseMessage(res));
      const freshAccounts = (await res.json()) as SchwabAccountSummary[];
      const account =
        freshAccounts.find((item) => item.hashValue === tradingAccountHash) ??
        accounts.find((item) => item.hashValue === tradingAccountHash);
      const positions = (account?.positions ?? []).filter(
        (position: SchwabPosition) =>
          position.assetType.toUpperCase() === "EQUITY" &&
          (position.longQuantity > 0 || position.shortQuantity > 0),
      );
      let closed = 0;
      for (const position of positions) {
        const instruction: StockInstruction =
          position.shortQuantity > 0 ? "BUY_TO_COVER" : "SELL";
        const shares =
          position.shortQuantity > 0 ? position.shortQuantity : position.longQuantity;
        const closeRes = await fetchWithAuth("/api/portfolio/place-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountHash: tradingAccountHash,
            order: stockOrderPayload({
              symbol: position.symbol,
              instruction,
              shares,
              orderType: "MARKET",
            }),
          }),
        });
        if (closeRes.ok) closed += 1;
      }
      toast({
        title: closed > 0 ? "Flatten orders sent" : "No equity positions",
        description: closed > 0 ? `${closed} market closing order${closed === 1 ? "" : "s"} sent` : undefined,
      });
    } catch (error) {
      toast({
        title: "Flatten failed",
        description: error instanceof Error ? error.message : "Unable to flatten positions",
        variant: "destructive",
      });
    } finally {
      setActionBusy(null);
    }
  }, [accounts, actionBusy, cancelWorkingOrders, tradingAccountHash]);

  return (
    <div className="flex flex-col flex-1 min-h-0" data-at-stock-ladder={symbol}>
      <div
        className="grid grid-cols-4 shrink-0"
        data-at-stock-actions
        style={{
          height: 44,
          background: "#050606",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <button
          type="button"
          disabled={!tradingAccountHash || !!actionBusy}
          onClick={() => {
            if (onOpenStockTicket) {
              onOpenStockTicket({ side: "BUY", quantity: Math.max(1, draft.shares), limitPrice: null });
              return;
            }
            void placeStockOrder("BUY", "MARKET");
          }}
          style={{
            border: "none",
            borderRight: `1px solid ${BORDER}`,
            background: "rgba(0, 209, 102, 0.15)",
            color: "#82f2b6",
            fontSize: 10,
            fontWeight: 750,
            letterSpacing: "0.03em",
          }}
        >
          BUY STOCK
        </button>
        <button
          type="button"
          disabled={!tradingAccountHash || !!actionBusy}
          onClick={() => {
            if (onOpenStockTicket) {
              onOpenStockTicket({ side: "SELL", quantity: Math.max(1, draft.shares), limitPrice: null });
              return;
            }
            void placeStockOrder("SELL_SHORT", "MARKET");
          }}
          style={{
            border: "none",
            borderRight: `1px solid ${BORDER}`,
            background: "rgba(242, 54, 69, 0.15)",
            color: "#ff929b",
            fontSize: 10,
            fontWeight: 750,
            letterSpacing: "0.03em",
          }}
        >
          SELL STOCK
        </button>
        <button
          type="button"
          disabled={!tradingAccountHash || !!actionBusy}
          onClick={() => void handleCancelAll()}
          style={{
            border: "none",
            borderRight: `1px solid ${BORDER}`,
            background: "#111315",
            color: WHITE,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {actionBusy === "cancel" ? "CANCELING" : "CANCEL"}
        </button>
        <button
          type="button"
          disabled={!tradingAccountHash || !!actionBusy}
          onClick={() => void handleFlatten()}
          style={{
            border: "none",
            background: actionBusy === "flatten" ? "rgba(251,191,36,0.18)" : "#111315",
            color: actionBusy === "flatten" ? "#fbd46c" : WHITE,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {actionBusy === "flatten" ? "FLATTENING" : "FLATTEN"}
        </button>
      </div>
      <div
        className="grid items-center shrink-0"
        style={{
          height: AT_LADDER_GROUP_HDR_H,
          gridTemplateColumns: AT_STOCK_LADDER_GRID,
          background: AT_HEADER_BG,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <span />
        <span />
        <span className="flex items-center justify-center">
          <AtInstrumentModePill template="stock" onToggle={onToggleTemplate} />
        </span>
        <span />
        <span />
      </div>
      <div
        className="grid items-center shrink-0 at-ladder-num"
        style={{
          height: AT_LADDER_COL_HDR_H,
          gridTemplateColumns: AT_STOCK_LADDER_GRID,
          fontSize: 8,
          color: AT_LABEL,
          fontWeight: 650,
          letterSpacing: "0.02em",
          background: AT_HEADER_BG,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <span className="text-center">VOL</span>
        <span className="text-center">BID SIZE</span>
        <span className="text-center" style={{ fontSize: 11 }}>PRICE</span>
        <span className="text-center">ASK SIZE</span>
        <span aria-hidden />
      </div>
      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="h-full min-h-0 overflow-y-auto" data-at-stock-scroll>
        {prices.map((price) => {
          const key = stockPriceKey(price);
          const depthBid = bidSizes.get(key) ?? 0;
          const depthAsk = askSizes.get(key) ?? 0;
          const bidSize = depthBid > 0 ? depthBid : bidKey === key ? book.bid?.size ?? null : null;
          const askSize = depthAsk > 0 ? depthAsk : askKey === key ? book.ask?.size ?? null : null;
          const traded = accumShares.get(key) ?? 0;
          const intensity = accumPeak > 0 ? traded / accumPeak : 0;
          const volumeHeat = stockVolumeHeatColor(intensity);
          const volumeFill = `${Math.round(intensity * 100)}%`;
          const bidIntensity = stockBookSizeIntensity(bidSize, bidPeak);
          const askIntensity = stockBookSizeIntensity(askSize, askPeak);
          const selected = draft.limitPrice != null && stockPriceKey(draft.limitPrice) === key;
          return (
            <div
              key={key}
              data-at-stock-price={key}
              data-at-stock-traded={traded > 0 ? String(Math.round(traded)) : undefined}
              data-at-stock-accum-volume={traded > 0 ? String(Math.round(traded)) : undefined}
              className="grid items-stretch"
              style={{
                gridTemplateColumns: AT_STOCK_LADDER_GRID,
                height: AT_LADDER_ROW_H,
                borderBottom: `1px solid ${BORDER}`,
                background: "transparent",
                boxSizing: "border-box",
              }}
            >
              {/* One real volume-at-price profile: fill and hue both scale with the actual print total. */}
              <span
                data-at-stock-volume={key}
                aria-label={traded > 0 ? `Accumulated volume ${fmtSize(traded)} shares` : undefined}
                title={traded > 0 ? `${fmtSize(traded)} shares today` : undefined}
                className="relative flex items-center justify-center h-full num overflow-hidden"
                style={{
                  color: WHITE,
                  fontSize: 10,
                  background: "#07101a",
                  borderRight: `1px solid ${AT_LADDER_THIN_SEP}`,
                }}
              >
                {volumeHeat ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: volumeFill,
                      background: volumeHeat,
                      transition: "width 180ms cubic-bezier(.16,1,.3,1), background-color 180ms ease-out",
                    }}
                  />
                ) : null}
                <span className="relative z-[1]">{traded > 0 ? fmtVolume(traded) : ""}</span>
              </span>
              <button
                type="button"
                data-at-stock-bid={key}
                aria-label={`Buy ${draft.shares} ${upper} limit at ${key}${bidSize != null ? `; bid size ${fmtSize(bidSize)}` : ""}`}
                disabled={!tradingAccountHash || !!actionBusy}
                className="relative h-full text-center num overflow-hidden"
                style={{
                  color: WHITE,
                  fontSize: 12,
                  background: "#0b1711",
                  border: "none",
                  padding: "0 2px",
                  boxShadow: bidIntensity >= 0.75 ? "inset 0 0 0 1px rgba(130,242,182,.52)" : "none",
                }}
                onClick={() => tapLimit("BUY", price)}
              >
                {bidIntensity > 0 ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 right-0"
                    style={{
                      width: `${Math.round(bidIntensity * 100)}%`,
                      background: `linear-gradient(90deg, rgba(0,209,102,.12), ${stockBookSizeHeatColor("bid", bidSize, bidPeak)})`,
                      transition: "width 160ms cubic-bezier(.16,1,.3,1), background-color 160ms ease-out",
                    }}
                  />
                ) : null}
                <span className="relative z-[1]">{bidSize != null ? fmtSize(bidSize) : ""}</span>
              </button>
              {/* Price bar: same gray as the options / SPX strike column (`AT_LADDER_STRIKE_BG`). */}
              <button
                type="button"
                data-at-stock-price-bar={key}
                className="h-full text-center num"
                style={{
                  color: WHITE,
                  fontSize: 16,
                  fontWeight: 600,
                  background: AT_LADDER_STRIKE_BG,
                  border: "none",
                  borderLeft: `1px solid ${AT_LADDER_THIN_SEP}`,
                  borderRight: `1px solid ${AT_LADDER_THIN_SEP}`,
                  boxShadow: selected ? `inset 0 0 0 1px ${WHITE}` : "none",
                  padding: 0,
                }}
                onClick={() => {
                  apply({ ...draft, limitPrice: price });
                  onOpenStockTicket?.({
                    side: draft.side,
                    quantity: Math.max(1, draft.shares),
                    limitPrice: price,
                  });
                }}
              >
                {fmtPx(price)}
              </button>
              <button
                type="button"
                data-at-stock-ask={key}
                aria-label={`Sell short ${draft.shares} ${upper} limit at ${key}${askSize != null ? `; ask size ${fmtSize(askSize)}` : ""}`}
                disabled={!tradingAccountHash || !!actionBusy}
                className="relative h-full text-center num overflow-hidden"
                style={{
                  color: WHITE,
                  fontSize: 12,
                  background: "#1a0f12",
                  border: "none",
                  padding: "0 2px",
                  boxShadow: askIntensity >= 0.75 ? "inset 0 0 0 1px rgba(255,146,155,.52)" : "none",
                }}
                onClick={() => tapLimit("SELL", price)}
              >
                {askIntensity > 0 ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: `${Math.round(askIntensity * 100)}%`,
                      background: `linear-gradient(90deg, ${stockBookSizeHeatColor("ask", askSize, askPeak)}, rgba(242,54,69,.12))`,
                      transition: "width 160ms cubic-bezier(.16,1,.3,1), background-color 160ms ease-out",
                    }}
                  />
                ) : null}
                <span className="relative z-[1]">{askSize != null ? fmtSize(askSize) : ""}</span>
              </button>
              <span aria-hidden data-at-stock-balance-rail={key} style={{ background: "#050607" }} />
            </div>
          );
        })}
      </div>
      <SpotRecenterPill
        visible={anchorOffCenter && prices.length > 0}
        onClick={scrollStockToAnchor}
        dataAttribute="data-at-stock-recenter"
      />
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
