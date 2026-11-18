import { useState, useMemo, useCallback, useEffect, useRef, type CSSProperties } from "react";
import {
  aggregateSpreadNBBO,
  computeChainTicketSummary,
  displaySubmittedLimit,
  mergeLegStreamQuotes,
  optionPremiumTickForSymbol,
  parseCanonicalLimit,
  resolveSubmittedLimit,
  roundOptionPriceToTick,
  schwabPriceFromTicket,
  inferNetCreditFromLegStructure,
  inferSchwabComplexOrderStrategyType,
  midpointFromBidAsk,
  chainLegHydrateKey,
  quoteSideState,
  formatNetGreekDisplay,
  type LimitTickContext,
} from "@workspace/order-ticket-math";
import { AT_SHEET_FULL_VH, AT_SHEET_PEEK_VH } from "@/lib/active-trader/atSheetLayout";
import {
  resolveChainLegInstructions,
  type SchwabAccountRow,
} from "@/lib/chainOrderLegInstructions";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTerminalStore } from "@/lib/store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import {
  detectStrategyType,
  type StrategyLeg,
} from "@/components/StrategyBuilder";
import {
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeOrderEconomics } from "@workspace/order-ticket-math";
import { estimateSchwabOptionFees, computeOrderNetCash } from "@/lib/orders/schwabOrderFees";
import { humanInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import { interpretBracketPlaceOrderResult } from "@/lib/active-trader/bracketPlaceOrderResult";

const SYS_FONT =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const BG = "#000000";
const BORDER = "#2a2a2a";
const GOLD = "#fbbf24";
const UP = "#00d166";
const DOWN = "#f23645";
const WHITE = "#f0f0f0";
const GRAY = "#a1a1aa";
const MUTED = "#71717a";
const DIM = "#52525b";
const DIVIDER = "#1a1a1a";
const LABEL_STYLE: CSSProperties = { fontSize: 12, color: GRAY, letterSpacing: "-0.02em" };
const VALUE_STYLE: CSSProperties = { fontSize: 14, color: WHITE, fontVariantNumeric: "tabular-nums" };
/** Clear bottom nav (~76px) + home indicator. */
const SHEET_BOTTOM_OFFSET = "calc(76px + max(env(safe-area-inset-bottom, 0px), 12px))";

type Stage = "form" | "review" | "submitting" | "success" | "error";

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export interface OptionsChainOrderSheetProps {
  legs: StrategyLeg[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onClearAll: () => void;
  onLegQuantityChange: (legId: string, quantity: number) => void;
  onRemoveLeg: (legId: string) => void;
  subscribeOptionSymbols?: (
    symbols: string[],
    opts?: import("@/lib/optionHoldClient").OptionHoldPostOpts,
  ) => Promise<string | void | undefined>;
  /** Fixture / screenshot harness only — never enables real submit bypass in prod. */
  demoFixture?: boolean;
  /** Dev fixture: open in-sheet confirm on mount (after quotes/limit hydrate). */
  openReviewOnMount?: boolean;
  /** TP/SL or other rows below limit (Active Trader). Receives spread limit + credit flag. */
  extrasAfterLimit?:
    | React.ReactNode
    | ((ctx: { limitPerShare: number | null; isCredit: boolean; legCount: number }) => React.ReactNode);
  /** Show preview send label instead of live Schwab send. */
  sendPreviewOnly?: boolean;
  /** Compact peek height (~38vh) vs full sheet (~58vh). */
  sheetPeek?: boolean;
  onSheetPeekChange?: (peek: boolean) => void;
}

export function OptionsChainOrderSheet({
  legs,
  collapsed,
  onCollapsedChange,
  onClearAll,
  onLegQuantityChange,
  onRemoveLeg,
  subscribeOptionSymbols,
  demoFixture,
  openReviewOnMount,
  extrasAfterLimit,
  sendPreviewOnly,
  sheetPeek = true,
  onSheetPeekChange,
}: OptionsChainOrderSheetProps) {
  const symbol = useTerminalStore((s) => s.symbol);
  const underlyingSpot = useTerminalStore((s) => {
    const u = symbol.toUpperCase();
    const alt = u.startsWith("$") ? u.slice(1) : `$${u}`;
    const q = s.streamPrices[u] ?? s.streamPrices[alt];
    return q?.last ?? q?.regularLast ?? q?.extendedLast ?? null;
  });
  const accounts = useSchwabAccountStore((s) => s.accounts);
  const accountHash = useSchwabAccountStore((s) => s.tradingAccountHash());
  const optionTicks = useOptionsStreamStore((s) => s.ticks);

  const [limitPrice, setLimitPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [timeInForce, setTimeInForce] = useState<"DAY" | "GTC">("DAY");
  const [stage, setStage] = useState<Stage>("form");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [priceError, setPriceError] = useState("");
  const [reviewLimitSnapped, setReviewLimitSnapped] = useState<number | null>(null);
  const limitUserEditedRef = useRef(false);
  const legsHydrateKeyRef = useRef("");

  const pricedLegs = useMemo(
    () => legs.map((leg) => mergeLegStreamQuotes(leg, optionTicks[leg.schwabSymbol])),
    [legs, optionTicks],
  );

  useEffect(() => {
    const symbols = legs.map((l) => l.schwabSymbol).filter(Boolean);
    if (symbols.length > 0 && subscribeOptionSymbols) {
      void subscribeOptionSymbols([...new Set(symbols)]);
    }
  }, [legs, subscribeOptionSymbols]);

  useEffect(() => {
    if (legs.length === 0) {
      setStage("form");
      setLimitPrice("");
      setQuantity(1);
      limitUserEditedRef.current = false;
      legsHydrateKeyRef.current = "";
    }
  }, [legs.length]);

  const legsHydrateKey = useMemo(
    () =>
      chainLegHydrateKey(
        legs.map((l) => ({
          id: l.id,
          direction: l.direction,
          strike: l.strike,
          quantity: l.quantity,
          schwabSymbol: l.schwabSymbol,
        })),
      ),
    [legs],
  );

  const limitTickCtx = useMemo((): LimitTickContext => ({ underlyingSymbol: symbol, isOption: true }), [symbol]);

  const spreadPrices = useMemo(() => {
    if (pricedLegs.length === 0) return null;
    const agg = aggregateSpreadNBBO(
      pricedLegs.map((l) => ({
        instruction: l.direction,
        bid: l.bid,
        ask: l.ask,
        quantity: l.quantity,
      })),
    );
    if (!agg) return null;
    const roundedMid = agg.mid != null ? parseCanonicalLimit(agg.mid, limitTickCtx) : null;
    return { spreadBid: agg.bid, spreadMid: roundedMid, spreadAsk: agg.ask, crossed: agg.crossed };
  }, [pricedLegs, limitTickCtx]);

  const submittedLimit = useMemo(
    () => resolveSubmittedLimit(limitTickCtx, limitPrice),
    [limitTickCtx, limitPrice],
  );

  const isCredit = useMemo(() => {
    const econLegs = pricedLegs.map((l) => ({
      strike: l.strike,
      optionType: l.optionType,
      instruction: l.direction,
      quantity: l.quantity,
    }));
    const inferred = inferNetCreditFromLegStructure(econLegs);
    if (inferred != null) return inferred;
    let netMid = 0;
    let complete = true;
    for (const leg of pricedLegs) {
      const mid = midpointFromBidAsk(leg.bid, leg.ask);
      if (mid == null) {
        complete = false;
        break;
      }
      netMid += leg.direction.startsWith("BUY") ? mid * leg.quantity : -mid * leg.quantity;
    }
    if (complete && Math.abs(netMid) > 1e-6) return netMid < 0;
    return false;
  }, [pricedLegs]);

  const summary = useMemo(
    () =>
      computeChainTicketSummary({
        underlyingSymbol: symbol,
        legs: pricedLegs.map((l) => ({
          strike: l.strike,
          optionType: l.optionType,
          instruction: l.direction,
          expiration: l.expiration.split(":")[0].trim(),
          quantity: l.quantity,
          bid: l.bid,
          ask: l.ask,
          delta: l.delta,
          gamma: l.gamma,
          theta: l.theta,
          vega: l.vega,
          iv: l.iv,
        })),
        limitPrice: submittedLimit ?? spreadPrices?.spreadMid ?? null,
        spreadQuantity: quantity,
        isCredit,
        spotPrice: underlyingSpot,
      }),
    [pricedLegs, symbol, submittedLimit, spreadPrices, quantity, isCredit, underlyingSpot],
  );

  const buyingPowerDisplay = useMemo(
    () => summary?.buyingPowerEffect ?? null,
    [summary?.buyingPowerEffect],
  );

  const feeAdjustedNetCash = useMemo(() => {
    if (summary?.grossNotional == null) return null;
    const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * quantity;
    const fees = estimateSchwabOptionFees(totalContracts);
    const cash = computeOrderNetCash(Math.abs(summary.grossNotional), isCredit, totalContracts, fees);
    return isCredit ? cash.net : -cash.net;
  }, [summary?.grossNotional, legs, quantity, isCredit]);

  const netDebitForName = summary?.grossNotional != null ? (isCredit ? -summary.grossNotional : summary.grossNotional) : 0;
  const strategyId = useMemo(() => detectStrategyType(legs, netDebitForName), [legs, netDebitForName]);

  const allLegsQuoted = useMemo(
    () => pricedLegs.length > 0 && pricedLegs.every((l) => quoteSideState(l.bid, l.ask) === "ok"),
    [pricedLegs],
  );

  useEffect(() => {
    if (legs.length === 0 || stage !== "form") return;
    const keyChanged = legsHydrateKeyRef.current !== legsHydrateKey;
    if (keyChanged) {
      legsHydrateKeyRef.current = legsHydrateKey;
      if (!limitUserEditedRef.current && !allLegsQuoted) {
        setLimitPrice("");
      }
    }
    if (!allLegsQuoted || spreadPrices?.spreadMid == null) return;
    if (keyChanged) {
      if (!limitUserEditedRef.current) {
        setLimitPrice(displaySubmittedLimit(limitTickCtx, spreadPrices.spreadMid));
      }
      return;
    }
    if (!limitUserEditedRef.current && !limitPrice.trim()) {
      setLimitPrice(displaySubmittedLimit(limitTickCtx, spreadPrices.spreadMid));
    }
  }, [legsHydrateKey, legs.length, spreadPrices?.spreadMid, limitTickCtx, stage, limitPrice, allLegsQuoted]);

  const snapLimitForSubmit = useCallback((): number | null => {
    const snapped = resolveSubmittedLimit(limitTickCtx, limitPrice);
    if (snapped == null) return null;
    setLimitPrice(displaySubmittedLimit(limitTickCtx, snapped));
    return snapped;
  }, [limitTickCtx, limitPrice]);

  const nudgePrice = useCallback(
    (dir: "up" | "down") => {
      const base = parseCanonicalLimit(limitPrice, limitTickCtx) ?? spreadPrices?.spreadMid;
      if (base == null) return;
      const tick = optionPremiumTickForSymbol(symbol, base) ?? 0.01;
      const raw = dir === "up" ? base + tick : Math.max(tick, base - tick);
      const rounded = roundOptionPriceToTick(raw, limitTickCtx, dir === "up" ? "up" : "down");
      limitUserEditedRef.current = true;
      setLimitPrice(displaySubmittedLimit(limitTickCtx, rounded));
      setPriceError("");
    },
    [limitPrice, limitTickCtx, spreadPrices, symbol],
  );

  const buildSchwabOrder = useCallback(
    (priceOverride?: number) => {
      const parsed = priceOverride ?? schwabPriceFromTicket(limitTickCtx, limitPrice);
      const complexType = inferSchwabComplexOrderStrategyType(
        legs.map((leg) => ({
          strike: leg.strike,
          optionType: leg.optionType,
          instruction: leg.direction,
          quantity: leg.quantity,
          expiration: leg.expiration,
          schwabSymbol: leg.schwabSymbol,
        })),
      );
      return {
        orderType: isCredit ? "NET_CREDIT" : "NET_DEBIT",
        session: "NORMAL",
        duration: timeInForce,
        complexOrderStrategyType: complexType,
        orderStrategyType: "SINGLE",
        orderLegCollection: legs.map((leg) => ({
          instruction: leg.direction,
          quantity: leg.quantity * quantity,
          instrument: { symbol: leg.schwabSymbol, assetType: "OPTION" },
        })),
        price: parsed > 0 ? parsed : undefined,
      };
    },
    [isCredit, timeInForce, legs, quantity, limitPrice, limitTickCtx],
  );

  const validateAndReview = useCallback(() => {
    const px = snapLimitForSubmit();
    if (px == null || px <= 0) {
      setPriceError("Set a valid limit price (Mid / Natural or enter manually).");
      return;
    }
    setReviewLimitSnapped(px);
    setPriceError("");
    setStage("review");
  }, [snapLimitForSubmit]);

  const openReviewRef = useRef(false);
  const placeOrderInFlightRef = useRef(false);
  const [sendLocked, setSendLocked] = useState(false);
  useEffect(() => {
    if (!openReviewOnMount || openReviewRef.current || legs.length === 0) return;
    const px = submittedLimit ?? spreadPrices?.spreadMid;
    if (px == null || px <= 0) return;
    openReviewRef.current = true;
    const t = window.setTimeout(() => validateAndReview(), 500);
    return () => window.clearTimeout(t);
  }, [openReviewOnMount, legs.length, submittedLimit, spreadPrices?.spreadMid, validateAndReview]);

  const handleSubmit = useCallback(async () => {
    if (sendPreviewOnly) return;
    if (placeOrderInFlightRef.current || stage === "submitting") return;
    if (!demoFixture && !accountHash) return;
    if (demoFixture) {
      placeOrderInFlightRef.current = true;
      setSendLocked(true);
      setOrderId("SCREENSHOT-DEMO");
      setStage("success");
      return;
    }
    const px = snapLimitForSubmit();
    if (px == null || px <= 0) {
      setPriceError("A limit price is required.");
      setStage("form");
      return;
    }
    placeOrderInFlightRef.current = true;
    setSendLocked(true);
    setReviewLimitSnapped(px);
    setStage("submitting");
    try {
      const order = buildSchwabOrder(px);
      const res = await fetchWithAuth("/api/portfolio/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHash, order }),
      });
      const data = await res.json();
      const partial = demoFixture ? interpretBracketPlaceOrderResult(data) : null;
      if (!res.ok || data.error) {
        placeOrderInFlightRef.current = false;
        setSendLocked(false);
        setErrorMsg(data.message || data.error || "Order rejected");
        setStage("error");
        return;
      }
      if (demoFixture && partial?.entryAccepted && !partial.exitsAccepted && partial.userMessage) {
        setOrderId(partial.orderId ?? "—");
        setErrorMsg(`${partial.userMessage} (fixture harness — requires broker exit status fields)`);
        setStage("error");
        return;
      }
      setOrderId(data.orderId ?? partial?.orderId ?? "—");
      setStage("success");
    } catch (err: unknown) {
      placeOrderInFlightRef.current = false;
      setSendLocked(false);
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setStage("error");
    }
  }, [accountHash, buildSchwabOrder, snapLimitForSubmit, demoFixture, stage, sendPreviewOnly]);

  const handleClearAllClick = useCallback(() => {
    limitUserEditedRef.current = false;
    legsHydrateKeyRef.current = "";
    onClearAll();
  }, [onClearAll]);

  const isValid =
    legs.length > 0 &&
    submittedLimit != null &&
    submittedLimit > 0 &&
    quantity > 0 &&
    (demoFixture || !!accountHash || !!sendPreviewOnly);

  if (legs.length === 0) return null;

  const sheetHeight = collapsed ? 52 : sheetPeek ? AT_SHEET_PEEK_VH : AT_SHEET_FULL_VH;

  return (
    <div
      className="fixed left-0 right-0 z-[110] flex flex-col"
      style={{
        bottom: SHEET_BOTTOM_OFFSET,
        height: sheetHeight,
        background: `linear-gradient(180deg, #0a0a0a 0%, #000000 100%)`,
        borderTop: `1px solid ${GOLD}30`,
        boxShadow: `0 -8px 32px rgba(0,0,0,0.85)`,
        fontFamily: SYS_FONT,
        transition: "height 0.25s ease",
      }}
      data-testid="options-chain-order-sheet"
    >
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 cursor-pointer"
        style={{ borderBottom: collapsed ? "none" : `1px solid ${BORDER}` }}
        onClick={() => onCollapsedChange(!collapsed)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2 min-w-0">
          {collapsed ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: GOLD }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: GOLD }} />}
          <span className="text-[12px] font-bold tracking-wider truncate" style={{ color: strategyId.color }}>
            {strategyId.name}
          </span>
          <span className="text-[10px]" style={{ color: GRAY }}>
            {legs.length} leg{legs.length !== 1 ? "s" : ""} · {isCredit ? "Cr" : "Dr"}
          </span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {!collapsed && onSheetPeekChange ? (
            <button
              type="button"
              className="text-[9px] px-1.5 py-0.5 tracking-wider"
              style={{ color: GRAY, border: `1px solid ${BORDER}`, borderRadius: 6 }}
              onClick={() => onSheetPeekChange(!sheetPeek)}
            >
              {sheetPeek ? "Expand" : "Peek"}
            </button>
          ) : null}
          {summary?.spreadMid != null && (
            <span className="text-[11px] tabular-nums" style={{ color: WHITE }}>
              Mid {fmt(summary.spreadMid)}
            </span>
          )}
          <button
            type="button"
            onClick={handleClearAllClick}
            className="text-[10px] px-2 py-1 tracking-wider"
            style={{ color: GRAY, border: `1px solid ${BORDER}`, borderRadius: 6 }}
          >
            CLEAR
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-2">
          {stage === "success" ? (
            <div className="py-6 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8" style={{ color: UP }} />
              <p className="text-[13px]" style={{ color: WHITE }}>Sent to Schwab</p>
              {orderId && <p className="text-[10px]" style={{ color: MUTED }}>Order {orderId}</p>}
              <button type="button" onClick={handleClearAllClick} className="mt-2 text-[12px] px-4 py-2" style={{ background: GOLD, color: "#000", borderRadius: 8 }}>
                Done
              </button>
            </div>
          ) : stage === "submitting" ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: GOLD }} />
            </div>
          ) : stage === "error" ? (
            <div className="py-4 text-center">
              <p className="text-[12px]" style={{ color: DOWN }}>{errorMsg}</p>
              <button type="button" onClick={() => setStage("form")} className="mt-2 text-[11px]" style={{ color: GRAY }}>
                Edit order
              </button>
            </div>
          ) : (
            <>
              <div
                className="py-2 grid grid-cols-2 gap-x-4 gap-y-2"
                style={{ borderBottom: `1px solid ${BORDER}` }}
              >
                <StatCell label="Natural" value={fmt(isCredit ? summary?.spreadBid : summary?.spreadAsk)} />
                <StatCell label="Mid" value={fmt(summary?.spreadMid)} />
                <StatCell
                  label="Max profit"
                  value={summary?.maxProfit != null ? fmtCurrency(summary.maxProfit) : "—"}
                  valueColor={UP}
                />
                <StatCell
                  label="Max loss"
                  value={summary?.maxLoss != null ? fmtCurrency(summary.maxLoss) : "—"}
                  valueColor={DOWN}
                />
                <div className="col-span-2 flex items-baseline justify-between gap-2">
                  <span style={LABEL_STYLE}>Breakeven</span>
                  <span style={VALUE_STYLE}>
                    {summary?.breakevens.length
                      ? summary.breakevens.map((b) => `$${b.toFixed(2)}`).join(" / ")
                      : "—"}
                  </span>
                </div>
              </div>

              <div
                className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-[13px]"
                style={{ borderBottom: `1px dashed ${DIVIDER}`, color: GRAY }}
              >
                <span style={VALUE_STYLE}>Δ {formatNetGreekDisplay(summary?.netDelta, 1) ?? "—"}</span>
                <span style={VALUE_STYLE}>Γ {formatNetGreekDisplay(summary?.netGamma, 2) ?? "—"}</span>
                <span style={VALUE_STYLE}>Θ {formatNetGreekDisplay(summary?.netTheta, 2) ?? "—"}</span>
                <span style={VALUE_STYLE}>V {formatNetGreekDisplay(summary?.netVega, 2) ?? "—"}</span>
                {summary?.pop != null && (
                  <span style={VALUE_STYLE}>POP {summary.pop.toFixed(0)}%</span>
                )}
                {buyingPowerDisplay != null && (
                  <span style={VALUE_STYLE}>
                    BP est {fmtCurrency(Math.abs(buyingPowerDisplay))}
                  </span>
                )}
              </div>

              <div className="mt-2 space-y-1.5">
                {pricedLegs.map((leg) => {
                  const isBuy = leg.direction.startsWith("BUY");
                  const mid = midpointFromBidAsk(leg.bid, leg.ask);
                  const quoteOk = quoteSideState(leg.bid, leg.ask) === "ok";
                  const typeLabel = leg.optionType === "CALL" ? "Call" : "Put";
                  return (
                    <div
                      key={leg.id}
                      className="flex items-center gap-2 py-1 px-1.5 rounded-md"
                      style={{ background: "#111", border: `1px solid ${BORDER}` }}
                    >
                      <span className="shrink-0 text-[13px] font-medium" style={{ color: isBuy ? UP : DOWN }}>
                        {isBuy ? "Buy" : "Sell"}
                      </span>
                      <span className="flex-1 min-w-0 text-[13px] tabular-nums truncate" style={{ color: WHITE }}>
                        {leg.strike} {typeLabel}
                      </span>
                      <span className="text-[11px] tabular-nums shrink-0" style={{ color: quoteOk ? MUTED : DOWN }}>
                        {quoteOk
                          ? `${leg.bid != null && leg.bid >= 0 ? fmt(leg.bid) : "—"} / ${leg.ask != null && leg.ask > 0 ? fmt(leg.ask) : "—"}${mid != null ? ` · ${fmt(mid)}` : ""}`
                          : "No quote"}
                      </span>
                      <LegQtyStepper
                        qty={leg.quantity}
                        onChange={(q: number) => onLegQuantityChange(leg.id, q)}
                      />
                      <button type="button" onClick={() => onRemoveLeg(leg.id)} aria-label="Remove leg">
                        <X className="w-3.5 h-3.5" style={{ color: MUTED }} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span style={LABEL_STYLE}>Order type</span>
                  <div
                    className="h-7 px-2 flex items-center rounded-md"
                    style={{ fontSize: 14, background: "#111", border: `1px solid ${BORDER}`, color: WHITE, fontFamily: SYS_FONT }}
                    aria-label="Order type Limit"
                  >
                    Limit
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span style={LABEL_STYLE}>Time in force</span>
                  <Select value={timeInForce} onValueChange={(v) => setTimeInForce(v as "DAY" | "GTC")}>
                    <SelectTrigger
                      className="h-7 px-2 border rounded-md text-white"
                      style={{ fontSize: 14, background: "#111", borderColor: BORDER, fontFamily: SYS_FONT }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAY">DAY</SelectItem>
                      <SelectItem value="GTC">GTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-2">
                <div className="text-[9px] mb-1" style={{ color: DIM }}>Net {isCredit ? "credit" : "debit"}</div>
                <div className="flex items-center gap-1" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "4px 8px" }}>
                  <button type="button" onClick={() => nudgePrice("down")} aria-label="Tick down">
                    <Minus className="w-3.5 h-3.5" style={{ color: GRAY }} />
                  </button>
                  <input
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="done"
                    value={limitPrice}
                    className="flex-1 text-[12px] text-right bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    onChange={(e) => {
                      limitUserEditedRef.current = true;
                      setLimitPrice(e.target.value);
                      setPriceError("");
                    }}
                    onBlur={() => {
                      const snapped = resolveSubmittedLimit(limitTickCtx, limitPrice);
                      if (snapped != null) setLimitPrice(displaySubmittedLimit(limitTickCtx, snapped));
                    }}
                    style={{ color: WHITE }}
                    data-testid="chain-sheet-limit"
                  />
                  <button type="button" onClick={() => nudgePrice("up")} aria-label="Tick up">
                    <Plus className="w-3.5 h-3.5" style={{ color: GRAY }} />
                  </button>
                </div>
                <div className="flex justify-between mt-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      const px = spreadPrices?.spreadMid;
                      if (px != null) {
                        limitUserEditedRef.current = false;
                        setLimitPrice(displaySubmittedLimit(limitTickCtx, px));
                      }
                    }}
                    style={{ color: GOLD }}
                  >
                    Mid {fmt(spreadPrices?.spreadMid)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const raw = isCredit ? spreadPrices?.spreadBid : spreadPrices?.spreadAsk;
                      const px = raw != null ? parseCanonicalLimit(raw, limitTickCtx) : null;
                      if (px != null) {
                        limitUserEditedRef.current = false;
                        setLimitPrice(displaySubmittedLimit(limitTickCtx, px));
                      }
                    }}
                    style={{ color: GRAY }}
                  >
                    Natural {fmt(isCredit ? spreadPrices?.spreadBid : spreadPrices?.spreadAsk)}
                  </button>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-[9px]" style={{ color: DIM }}>Spreads</span>
                <div className="inline-flex items-center" style={{ border: `1px solid ${BORDER}`, borderRadius: 8 }}>
                  <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="px-2 py-1">
                    <Minus className="w-3 h-3" style={{ color: GRAY }} />
                  </button>
                  <span className="text-[12px] px-2 tabular-nums" style={{ color: WHITE }}>{quantity}</span>
                  <button type="button" onClick={() => setQuantity(quantity + 1)} className="px-2 py-1">
                    <Plus className="w-3 h-3" style={{ color: GRAY }} />
                  </button>
                </div>
              </div>

              {typeof extrasAfterLimit === "function"
                ? extrasAfterLimit({
                    limitPerShare: submittedLimit ?? summary?.limitPerShare ?? spreadPrices?.spreadMid ?? null,
                    isCredit,
                    legCount: legs.length,
                  })
                : extrasAfterLimit}

              {priceError && (
                <p className="mt-2 text-[10px]" style={{ color: DOWN }}>{priceError}</p>
              )}
            </>
          )}
        </div>
        {stage === "form" && (
          <div
            className="shrink-0 px-3 pt-2 border-t"
            style={{
              borderColor: BORDER,
              paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
            }}
          >
            <button
              type="button"
              disabled={!isValid}
              onClick={validateAndReview}
              className="w-full text-[13px] font-bold tracking-wider py-2.5 disabled:opacity-40"
              style={{ background: GOLD, color: "#000", borderRadius: 8 }}
              data-testid="chain-sheet-review"
            >
              {sendPreviewOnly ? "Review (sending off)" : "Review"}
            </button>
          </div>
        )}
        </>
      )}

      {stage === "review" && !collapsed && (
        <ConfirmPanel
          strategyName={strategyId.name}
          strategyColor={strategyId.color}
          symbol={symbol}
          legs={legs}
          quantity={quantity}
          timeInForce={timeInForce}
          isCredit={isCredit}
          limitTickCtx={limitTickCtx}
          reviewLimitSnapped={reviewLimitSnapped}
          submittedLimit={submittedLimit}
          summary={summary}
          feeAdjustedNetCash={feeAdjustedNetCash}
          onBack={() => {
            placeOrderInFlightRef.current = false;
            setSendLocked(false);
            setStage("form");
          }}
          onSend={() => void handleSubmit()}
          sendDisabled={sendLocked || !!sendPreviewOnly}
          sendLabel={sendPreviewOnly ? "Sending off (preview)" : "Send to Schwab"}
        />
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  valueColor = WHITE,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span style={LABEL_STYLE}>{label}</span>
      <span style={{ ...VALUE_STYLE, color: valueColor }}>{value}</span>
    </div>
  );
}

function formatLegLine(
  leg: StrategyLeg,
  underlying: string,
  spreadQty: number,
): string {
  const type = leg.optionType === "CALL" ? "Call" : "Put";
  const sym = underlying.toUpperCase().replace(/^\$/, "");
  const instr = humanInstruction(leg.direction);
  return `${instr} · ${leg.quantity * spreadQty} × ${sym} ${leg.strike} ${type}`;
}

function ConfirmPanel({
  strategyName,
  strategyColor,
  symbol,
  legs,
  quantity,
  timeInForce,
  isCredit,
  limitTickCtx,
  reviewLimitSnapped,
  submittedLimit,
  summary,
  feeAdjustedNetCash,
  onBack,
  onSend,
  sendDisabled,
  sendLabel = "Send to Schwab",
}: {
  strategyName: string;
  strategyColor: string;
  symbol: string;
  legs: StrategyLeg[];
  quantity: number;
  timeInForce: string;
  isCredit: boolean;
  limitTickCtx: LimitTickContext;
  reviewLimitSnapped: number | null;
  submittedLimit: number | null;
  summary: ReturnType<typeof computeChainTicketSummary> | null;
  feeAdjustedNetCash: number | null;
  onBack: () => void;
  onSend: () => void;
  sendDisabled?: boolean;
  sendLabel?: string;
}) {
  const px = reviewLimitSnapped ?? submittedLimit ?? 0;
  const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * quantity;
  const fees = estimateSchwabOptionFees(totalContracts);
  const gross =
    summary?.grossNotional != null
      ? Math.abs(summary.grossNotional)
      : Math.abs(px) * quantity * 100;
  const cash = computeOrderNetCash(gross, isCredit, totalContracts, fees);
  const netCashAfterFees = feeAdjustedNetCash ?? (isCredit ? cash.net : -cash.net);
  const reviewEcon = computeOrderEconomics({
    underlyingSymbol: symbol,
    isOption: true,
    legs: legs.map((l) => ({
      strike: l.strike,
      optionType: l.optionType,
      instruction: l.direction,
      expiration: l.expiration.split(":")[0].trim(),
      quantity: l.quantity,
    })),
    limitPrice: px,
    quantity,
    isCredit,
    contractCount: totalContracts,
  });
  const maxLoss = reviewEcon?.maxRisk ?? summary?.maxLoss ?? null;
  const bpEffect = summary?.buyingPowerEffect ?? reviewEcon?.buyingPowerEffect ?? null;
  const bpKind = summary?.buyingPowerEffectKind ?? reviewEcon?.buyingPowerEffectKind ?? "estimated";

  return (
    <div
      className="absolute inset-0 flex flex-col justify-end z-10"
      style={{ background: "rgba(0,0,0,0.55)" }}
      data-testid="chain-sheet-confirm"
    >
      <div
        className="p-3 space-y-2 animate-in slide-in-from-bottom duration-300 max-h-[85%] overflow-y-auto"
        style={{ background: BG, borderTop: `1px solid ${GOLD}40`, borderRadius: "14px 14px 0 0" }}
      >
        <div className="flex justify-between items-center">
          <span className="text-[14px] font-semibold" style={{ color: WHITE }}>
            Order confirmation
          </span>
          <button type="button" onClick={onBack} aria-label="Close">
            <X className="w-4 h-4" style={{ color: MUTED }} />
          </button>
        </div>
        <div className="space-y-1 p-2.5 rounded-lg" style={{ background: "#111", border: `1px solid ${BORDER}` }}>
          <ButtonRow label="Strategy" value={strategyName} valueColor={strategyColor} />
          <ButtonRow label="Order type" value="Limit" />
          {legs.map((leg, i) => (
            <p key={i} className="text-[13px] leading-snug" style={{ color: WHITE }}>
              {formatLegLine(leg, symbol, quantity)}
            </p>
          ))}
          <ButtonRow
            label={`Net ${isCredit ? "credit" : "debit"}`}
            value={fmtCurrency(gross)}
          />
          <ButtonRow
            label={`Est. commissions (${totalContracts} × $0.65)`}
            value={fmtCurrency(fees.commission)}
          />
          <ButtonRow label="Est. regulatory fees" value={fmtCurrency(fees.regulatoryEst)} />
          <ButtonRow
            label={isCredit ? "Net credit (after est. fees)" : "Net debit (after est. fees)"}
            value={`${netCashAfterFees >= 0 ? "+" : "−"}${fmtCurrency(Math.abs(netCashAfterFees))}`}
            valueColor={netCashAfterFees >= 0 ? UP : DOWN}
            emphasize
          />
          <ButtonRow label="Time in force" value={timeInForce} />
          <ButtonRow
            label="Limit price"
            value={`$${displaySubmittedLimit(limitTickCtx, px)}`}
          />
          {maxLoss != null && (
            <ButtonRow label="Max loss" value={fmtCurrency(maxLoss)} valueColor={DOWN} />
          )}
          {bpEffect != null && (
            <ButtonRow
              label={
                bpKind === "cash_secured"
                  ? "Cash-secured collateral (est.)"
                  : "Buying power (est.)"
              }
              value={`−${fmtCurrency(Math.abs(bpEffect))}`}
              valueColor={DOWN}
            />
          )}
          {bpEffect == null && bpKind === "not_estimated" && (
            <ButtonRow label="Buying power" value="Not estimated" />
          )}
        </div>
        <div
          className="px-2 py-1.5 flex items-center gap-1.5"
          style={{ background: `${GOLD}08`, borderRadius: 8, border: `1px solid ${GOLD}33` }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: GOLD }} />
          <p className="text-[12px] leading-tight" style={{ color: `${GOLD}dd` }}>
            Live order via Schwab. Verify all details.
          </p>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 py-2.5 text-[13px]"
            style={{ border: `1px solid ${BORDER}`, color: GRAY, borderRadius: 8 }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sendDisabled}
            className="flex-[2] py-2.5 text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: GOLD, color: "#000", borderRadius: 8 }}
            data-testid="chain-sheet-send"
          >
            {sendLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ButtonRow({
  label,
  value,
  valueColor = WHITE,
  emphasize,
}: {
  label: string;
  value: string;
  valueColor?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 text-[13px]">
      <span style={{ color: MUTED }}>{label}</span>
      <span
        style={{
          color: valueColor,
          fontWeight: emphasize ? 600 : 400,
          fontSize: emphasize ? 14 : 13,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function LegQtyStepper({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <span className="inline-flex items-center" style={{ border: `1px solid ${BORDER}`, borderRadius: 6 }}>
      <button type="button" onClick={() => onChange(Math.max(1, qty - 1))} className="px-1">
        <Minus className="w-2.5 h-2.5" style={{ color: DIM }} />
      </button>
      <span className="px-1 text-[10px] tabular-nums" style={{ color: WHITE }}>{qty}</span>
      <button type="button" onClick={() => onChange(qty + 1)} className="px-1">
        <Plus className="w-2.5 h-2.5" style={{ color: DIM }} />
      </button>
    </span>
  );
}

/** Build StrategyLeg rows from chain selection + portfolio close detection. */
export function legsFromChainSelection(
  entries: Array<{
    key: string;
    contract: {
      strike: number;
      expiration: string;
      schwabSymbol?: string;
      streamKey?: string;
      bid?: number;
      ask?: number;
      delta?: number;
      gamma?: number;
      theta?: number;
      vega?: number;
      iv?: number;
      contractTs?: number;
    };
    type: "CALL" | "PUT";
    side: "bid" | "ask";
    quantity?: number;
  }>,
  symbol: string,
  accounts: SchwabAccountRow[],
  buildSchwabOptionKey: (sym: string, exp: string, strike: number, cp: "C" | "P") => string,
  tradingAccountHash: string | null,
): StrategyLeg[] {
  const rows: StrategyLeg[] = [];
  for (const l of entries) {
    const schwabSymbol =
      l.contract.schwabSymbol ||
      buildSchwabOptionKey(symbol, l.contract.expiration, l.contract.strike, l.type === "CALL" ? "C" : "P");
    const qty = l.quantity ?? 1;
    const { slices } = resolveChainLegInstructions(
      schwabSymbol,
      l.side,
      qty,
      accounts,
      tradingAccountHash,
    );
    const base = {
      optionType: l.type,
      strike: l.contract.strike,
      expiration: l.contract.expiration,
      bid: l.contract.bid,
      ask: l.contract.ask,
      delta: l.contract.delta,
      gamma: l.contract.gamma,
      theta: l.contract.theta,
      vega: l.contract.vega,
      iv: l.contract.iv,
      schwabSymbol,
      contractTs: l.contract.contractTs,
    };
    for (const [idx, slice] of slices.entries()) {
      rows.push({
        ...base,
        id: slices.length > 1 ? `${l.key}#${idx}:${slice.instruction}` : l.key,
        direction: slice.instruction,
        quantity: slice.quantity,
      });
    }
  }
  return rows;
}