import { useState, useMemo, useCallback, useEffect } from "react";
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
  type LimitTickContext,
} from "@workspace/order-ticket-math";
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

const MONO = "'SFMono-Regular', 'SF Mono', ui-monospace, 'Cascadia Code', 'Consolas', monospace";
const BG = "#000000";
const BORDER = "#1a1a1a";
const GOLD = "#fbbf24";
const UP = "#00d166";
const DOWN = "#f23645";
const WHITE = "#f0f0f0";
const GRAY = "#a1a1aa";
const MUTED = "#52525b";
const DIM = "#3f3f46";
const DIVIDER = "#1a1a1a";

type Stage = "form" | "review" | "submitting" | "success" | "error";

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function resolveCloseInstruction(
  schwabSymbol: string,
  side: "bid" | "ask",
  accounts: ReturnType<typeof useSchwabAccountStore.getState>["accounts"],
): StrategyLeg["direction"] {
  const openBuy = side === "ask";
  for (const acct of accounts) {
    for (const pos of acct.positions) {
      if (pos.symbol !== schwabSymbol && pos.symbol.trim() !== schwabSymbol.trim()) continue;
      const long = pos.longQuantity ?? 0;
      const short = pos.shortQuantity ?? 0;
      if (short > 0 && openBuy) return "BUY_TO_CLOSE";
      if (long > 0 && !openBuy) return "SELL_TO_CLOSE";
    }
  }
  return openBuy ? "BUY_TO_OPEN" : "SELL_TO_OPEN";
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
}: OptionsChainOrderSheetProps) {
  const symbol = useTerminalStore((s) => s.symbol);
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
    }
  }, [legs.length]);

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
      const mid = leg.bid != null && leg.ask != null ? (leg.bid + leg.ask) / 2 : null;
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
        })),
        limitPrice: submittedLimit ?? spreadPrices?.spreadMid ?? null,
        spreadQuantity: quantity,
        isCredit,
      }),
    [pricedLegs, symbol, submittedLimit, spreadPrices, quantity, isCredit],
  );

  const netDebitForName = summary?.grossNotional != null ? (isCredit ? -summary.grossNotional : summary.grossNotional) : 0;
  const strategyId = useMemo(() => detectStrategyType(legs, netDebitForName), [legs, netDebitForName]);

  useEffect(() => {
    if (spreadPrices?.spreadMid != null && !limitPrice && stage === "form") {
      setLimitPrice(displaySubmittedLimit(limitTickCtx, spreadPrices.spreadMid));
    }
  }, [spreadPrices, limitPrice, limitTickCtx, stage]);

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
      setLimitPrice(displaySubmittedLimit(limitTickCtx, rounded));
      setPriceError("");
    },
    [limitPrice, limitTickCtx, spreadPrices, symbol],
  );

  const buildSchwabOrder = useCallback(
    (priceOverride?: number) => {
      const parsed = priceOverride ?? schwabPriceFromTicket(limitTickCtx, limitPrice);
      const getSymParts = (sym: string) => ({ date: sym.substring(6, 12), cp: sym.charAt(12) });
      let complexType = "CUSTOM";
      if (legs.length === 1) complexType = "NONE";
      else if (legs.length === 2) {
        const p0 = getSymParts(legs[0].schwabSymbol);
        const p1 = getSymParts(legs[1].schwabSymbol);
        if (p0.date === p1.date && p0.cp === p1.cp) complexType = "VERTICAL";
        else if (p0.date === p1.date) complexType = "STRANGLE";
      } else if (legs.length === 4) {
        const cps = legs.map((l) => getSymParts(l.schwabSymbol).cp);
        if (cps.filter((c) => c === "C").length === 2 && cps.filter((c) => c === "P").length === 2) {
          complexType = "IRON_CONDOR";
        }
      }
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
      setPriceError("Set a valid limit price (Mid / Nat or enter manually).");
      return;
    }
    setReviewLimitSnapped(px);
    setPriceError("");
    setStage("review");
  }, [snapLimitForSubmit]);

  const handleSubmit = useCallback(async () => {
    if (!demoFixture && !accountHash) return;
    if (demoFixture) {
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
      if (!res.ok || data.error) {
        setErrorMsg(data.message || data.error || "Order rejected");
        setStage("error");
        return;
      }
      setOrderId(data.orderId ?? "—");
      setStage("success");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setStage("error");
    }
  }, [accountHash, buildSchwabOrder, snapLimitForSubmit, demoFixture]);

  const isValid =
    legs.length > 0 &&
    submittedLimit != null &&
    submittedLimit > 0 &&
    quantity > 0 &&
    (demoFixture || !!accountHash);

  if (legs.length === 0) return null;

  const sheetHeight = collapsed ? 52 : "min(72vh, 520px)";

  return (
    <div
      className="fixed left-0 right-0 z-[110] flex flex-col"
      style={{
        bottom: 64,
        height: sheetHeight,
        background: `linear-gradient(180deg, #0a0a0a 0%, #000000 100%)`,
        borderTop: `1px solid ${GOLD}30`,
        boxShadow: `0 -8px 32px rgba(0,0,0,0.85)`,
        fontFamily: MONO,
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
          {summary?.spreadMid != null && (
            <span className="text-[11px] tabular-nums" style={{ color: WHITE }}>
              Mid {fmt(summary.spreadMid)}
            </span>
          )}
          <button
            type="button"
            onClick={onClearAll}
            className="text-[10px] px-2 py-1 tracking-wider"
            style={{ color: GRAY, border: `1px solid ${BORDER}`, borderRadius: 6 }}
          >
            CLEAR
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
          {stage === "success" ? (
            <div className="py-6 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8" style={{ color: UP }} />
              <p className="text-[13px]" style={{ color: WHITE }}>Sent to Schwab</p>
              {orderId && <p className="text-[10px]" style={{ color: MUTED }}>Order {orderId}</p>}
              <button type="button" onClick={onClearAll} className="mt-2 text-[12px] px-4 py-2" style={{ background: GOLD, color: "#000", borderRadius: 8 }}>
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
              <div className="py-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]" style={{ color: GRAY }}>
                <div>
                  <span style={{ color: DIM }}>Nat </span>
                  <span style={{ color: WHITE }}>
                    {fmt(isCredit ? summary?.spreadBid : summary?.spreadAsk)}
                  </span>
                </div>
                <div>
                  <span style={{ color: DIM }}>Mid </span>
                  <span style={{ color: WHITE }}>{fmt(summary?.spreadMid)}</span>
                </div>
                <div>
                  <span style={{ color: DIM }}>Max P </span>
                  <span style={{ color: UP }}>{summary?.maxProfit != null ? fmtCurrency(summary.maxProfit) : "—"}</span>
                </div>
                <div>
                  <span style={{ color: DIM }}>Max L </span>
                  <span style={{ color: DOWN }}>{summary?.maxLoss != null ? fmtCurrency(summary.maxLoss) : "∞"}</span>
                </div>
                <div className="col-span-2">
                  <span style={{ color: DIM }}>BE </span>
                  <span style={{ color: WHITE }}>
                    {summary?.breakevens.length ? summary.breakevens.map((b) => `$${b.toFixed(2)}`).join(" / ") : "—"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[10px] py-1" style={{ borderTop: `1px dashed ${DIVIDER}`, color: GRAY }}>
                <span>Δ {fmt(summary?.netDelta, 1)}</span>
                <span>Γ {fmt(summary?.netGamma, 2)}</span>
                <span>Θ {fmt(summary?.netTheta, 2)}</span>
                <span>V {fmt(summary?.netVega, 2)}</span>
                <span>POP {summary?.pop != null ? `${summary.pop.toFixed(0)}%` : "—"}</span>
                <span>BP {summary?.buyingPowerEffect != null ? fmtCurrency(summary.buyingPowerEffect) : "—"}</span>
              </div>

              <div className="mt-2 space-y-1">
                {pricedLegs.map((leg) => {
                  const isBuy = leg.direction.startsWith("BUY");
                  return (
                    <div key={leg.id} className="flex items-center gap-2 text-[10px]" style={{ color: GRAY }}>
                      <span style={{ color: isBuy ? UP : DOWN, width: 28 }}>{isBuy ? "B" : "S"}</span>
                      <span className="tabular-nums" style={{ color: WHITE }}>
                        {leg.strike} {leg.optionType === "CALL" ? "C" : "P"}
                      </span>
                      <LegQtyStepper
                        qty={leg.quantity}
                        onChange={(q: number) => onLegQuantityChange(leg.id, q)}
                      />
                      <button type="button" onClick={() => onRemoveLeg(leg.id)} aria-label="Remove leg">
                        <X className="w-3 h-3" style={{ color: MUTED }} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-[9px]" style={{ color: DIM }}>
                  Order
                  <select
                    value="LIMIT"
                    disabled
                    className="mt-0.5 w-full text-[11px] px-2 py-1"
                    style={{ background: "#0a0a0a", border: `1px solid ${BORDER}`, color: WHITE, borderRadius: 6 }}
                  >
                    <option value="LIMIT">Limit</option>
                  </select>
                </label>
                <label className="text-[9px]" style={{ color: DIM }}>
                  TIF
                  <select
                    value={timeInForce}
                    onChange={(e) => setTimeInForce(e.target.value as "DAY" | "GTC")}
                    className="mt-0.5 w-full text-[11px] px-2 py-1"
                    style={{ background: "#0a0a0a", border: `1px solid ${BORDER}`, color: WHITE, borderRadius: 6 }}
                  >
                    <option value="DAY">DAY</option>
                    <option value="GTC">GTC</option>
                  </select>
                </label>
              </div>

              <div className="mt-2">
                <div className="text-[9px] mb-1" style={{ color: DIM }}>Net {isCredit ? "credit" : "debit"}</div>
                <div className="flex items-center gap-1" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "4px 8px" }}>
                  <button type="button" onClick={() => nudgePrice("down")} aria-label="Tick down">
                    <Minus className="w-3.5 h-3.5" style={{ color: GRAY }} />
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={limitPrice}
                    onChange={(e) => {
                      setLimitPrice(e.target.value);
                      setPriceError("");
                    }}
                    onBlur={() => {
                      const snapped = resolveSubmittedLimit(limitTickCtx, limitPrice);
                      if (snapped != null) setLimitPrice(displaySubmittedLimit(limitTickCtx, snapped));
                    }}
                    className="flex-1 text-[12px] text-right bg-transparent outline-none tabular-nums"
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
                      if (px != null) setLimitPrice(displaySubmittedLimit(limitTickCtx, px));
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
                      if (px != null) setLimitPrice(displaySubmittedLimit(limitTickCtx, px));
                    }}
                    style={{ color: GRAY }}
                  >
                    Nat {fmt(isCredit ? spreadPrices?.spreadBid : spreadPrices?.spreadAsk)}
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

              {priceError && (
                <p className="mt-2 text-[10px]" style={{ color: DOWN }}>{priceError}</p>
              )}

              <button
                type="button"
                disabled={!isValid}
                onClick={validateAndReview}
                className="mt-3 w-full text-[13px] font-bold tracking-wider py-2.5 disabled:opacity-40"
                style={{ background: GOLD, color: "#000", borderRadius: 8 }}
                data-testid="chain-sheet-review"
              >
                Review
              </button>
            </>
          )}
        </div>
      )}

      {stage === "review" && !collapsed && (
        <div
          className="absolute inset-0 flex flex-col justify-end"
          style={{ background: "rgba(0,0,0,0.55)" }}
          data-testid="chain-sheet-confirm"
        >
          <div
            className="p-3 space-y-2 animate-in slide-in-from-bottom duration-300"
            style={{ background: BG, borderTop: `1px solid ${GOLD}40`, borderRadius: "14px 14px 0 0" }}
          >
            <div className="flex justify-between items-center">
              <span className="text-[12px] font-bold" style={{ color: WHITE }}>Order Confirmation</span>
              <button type="button" onClick={() => setStage("form")} aria-label="Close">
                <X className="w-4 h-4" style={{ color: MUTED }} />
              </button>
            </div>
            <ButtonRow label="Strategy" value={strategyId.name} />
            <ButtonRow label="Net" value={`$${displaySubmittedLimit(limitTickCtx, reviewLimitSnapped ?? submittedLimit)}`} />
            <ButtonRow label="Qty" value={`${quantity} spread${quantity !== 1 ? "s" : ""}`} />
            <ButtonRow label="TIF" value={timeInForce} />
            {legs.map((leg, i) => (
              <div key={i} className="text-[10px]" style={{ color: GRAY }}>
                {leg.direction.startsWith("BUY") ? "BTO" : "STO"} {leg.quantity * quantity}× {leg.strike} {leg.optionType}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStage("form")}
                className="flex-1 py-2 text-[11px]"
                style={{ border: `1px solid ${BORDER}`, color: GRAY, borderRadius: 8 }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                className="flex-[2] py-2 text-[12px] font-bold"
                style={{ background: GOLD, color: "#000", borderRadius: 8 }}
                data-testid="chain-sheet-send"
              >
                Send to Schwab
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ButtonRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: WHITE }}>{value}</span>
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
    contract: { strike: number; expiration: string; schwabSymbol?: string; streamKey?: string; bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number };
    type: "CALL" | "PUT";
    side: "bid" | "ask";
    quantity?: number;
  }>,
  symbol: string,
  accounts: ReturnType<typeof useSchwabAccountStore.getState>["accounts"],
  buildSchwabOptionKey: (sym: string, exp: string, strike: number, cp: "C" | "P") => string,
): StrategyLeg[] {
  return entries.map((l) => {
    const schwabSymbol =
      l.contract.schwabSymbol ||
      buildSchwabOptionKey(symbol, l.contract.expiration, l.contract.strike, l.type === "CALL" ? "C" : "P");
    return {
      id: l.key,
      optionType: l.type,
      direction: resolveCloseInstruction(schwabSymbol, l.side, accounts),
      strike: l.contract.strike,
      expiration: l.contract.expiration,
      quantity: l.quantity ?? 1,
      bid: l.contract.bid,
      ask: l.contract.ask,
      delta: l.contract.delta,
      gamma: l.contract.gamma,
      theta: l.contract.theta,
      vega: l.contract.vega,
      iv: l.contract.iv,
      schwabSymbol,
    };
  });
}