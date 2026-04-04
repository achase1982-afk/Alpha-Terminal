import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { X, ChevronDown, Minus, Plus, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type OrderSide = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | "TRAILING_STOP";
type Duration = "DAY" | "GOOD_TILL_CANCEL" | "FILL_OR_KILL";
type Session = "NORMAL" | "AM" | "PM" | "SEAMLESS";
type ConfirmStage = "form" | "review" | "submitting" | "success" | "error";

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "MARKET", label: "Market" },
  { value: "LIMIT", label: "Limit" },
  { value: "STOP", label: "Stop" },
  { value: "STOP_LIMIT", label: "Stop Limit" },
  { value: "TRAILING_STOP", label: "Trail Stop" },
];

const DURATIONS: { value: Duration; label: string }[] = [
  { value: "DAY", label: "Day" },
  { value: "GOOD_TILL_CANCEL", label: "GTC" },
  { value: "FILL_OR_KILL", label: "FOK" },
];

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface OrderTicketProps {
  isOpen: boolean;
  onClose: () => void;
  initialSide?: OrderSide;
  optionSymbol?: string;
  optionInstruction?: string;
}

export function OrderTicket({ isOpen, onClose, initialSide, optionSymbol, optionInstruction }: OrderTicketProps) {
  const symbol = useTerminalStore((s) => s.symbol);
  const { data: quote } = useQuote(symbol);

  const [side, setSide] = useState<OrderSide>(initialSide ?? "BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [trailOffset, setTrailOffset] = useState("");
  const [duration, setDuration] = useState<Duration>("DAY");
  const [session, setSession] = useState<Session>("NORMAL");
  const [extendedHours, setExtendedHours] = useState(false);
  const [stage, setStage] = useState<ConfirmStage>("form");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [accountHash, setAccountHash] = useState<string | null>(null);
  const [showOrderType, setShowOrderType] = useState(false);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const isOption = !!optionSymbol;
  const displaySymbol = optionSymbol ?? symbol;

  useEffect(() => {
    if (!isOpen) return;
    setSide(initialSide ?? "BUY");
    setOrderType("LIMIT");
    setQuantity(1);
    setLimitPrice("");
    setStopPrice("");
    setTrailOffset("");
    setDuration("DAY");
    setSession("NORMAL");
    setExtendedHours(false);
    setStage("form");
    setOrderId(null);
    setErrorMsg("");
    setShowOrderType(false);
  }, [isOpen, initialSide]);

  useEffect(() => {
    if (!isOpen) return;
    fetchWithAuth("/api/portfolio/account-hash")
      .then((r) => r.json())
      .then((d) => { if (d.hashValue) setAccountHash(d.hashValue); })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && quote?.ask != null && !limitPrice) {
      setLimitPrice(quote.ask.toFixed(2));
    }
  }, [isOpen, quote?.ask]);

  const needsLimit = orderType === "LIMIT" || orderType === "STOP_LIMIT";
  const needsStop = orderType === "STOP" || orderType === "STOP_LIMIT";
  const needsTrail = orderType === "TRAILING_STOP";

  const estimatedCost = useMemo(() => {
    const price =
      orderType === "MARKET"
        ? (side === "BUY" ? quote?.ask : quote?.bid) ?? quote?.last
        : needsLimit
          ? parseFloat(limitPrice) || null
          : needsStop
            ? parseFloat(stopPrice) || null
            : quote?.last;
    if (!price) return null;
    const multiplier = isOption ? 100 : 1;
    return price * quantity * multiplier;
  }, [orderType, side, quote?.ask, quote?.bid, quote?.last, limitPrice, stopPrice, quantity, needsLimit, needsStop, isOption]);

  const isValid = useMemo(() => {
    if (quantity <= 0) return false;
    if (needsLimit && (!limitPrice || parseFloat(limitPrice) <= 0)) return false;
    if (needsStop && (!stopPrice || parseFloat(stopPrice) <= 0)) return false;
    if (needsTrail && (!trailOffset || parseFloat(trailOffset) <= 0)) return false;
    if (!accountHash) return false;
    return true;
  }, [quantity, needsLimit, limitPrice, needsStop, stopPrice, needsTrail, trailOffset, accountHash]);

  const buildSchwabOrder = useCallback(() => {
    const order: Record<string, unknown> = {
      orderType: orderType,
      session: extendedHours ? "SEAMLESS" : "NORMAL",
      duration: duration,
      orderStrategyType: "SINGLE",
      orderLegCollection: [
        {
          instruction: isOption ? (optionInstruction ?? (side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_CLOSE")) : side,
          quantity: quantity,
          instrument: {
            symbol: displaySymbol,
            assetType: isOption ? "OPTION" : "EQUITY",
          },
        },
      ],
    };

    if (needsLimit) order.price = limitPrice;
    if (needsStop) order.stopPrice = stopPrice;
    if (needsTrail) {
      order.stopPriceLinkBasis = "LAST";
      order.stopPriceLinkType = "VALUE";
      order.stopPriceOffset = trailOffset;
    }

    return order;
  }, [orderType, extendedHours, duration, side, quantity, displaySymbol, isOption, optionInstruction, needsLimit, limitPrice, needsStop, stopPrice, needsTrail, trailOffset]);

  const handleSubmit = useCallback(async () => {
    if (!accountHash) return;
    setStage("submitting");
    try {
      const order = buildSchwabOrder();
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
    } catch (err: any) {
      setErrorMsg(err.message || "Network error");
      setStage("error");
    }
  }, [accountHash, buildSchwabOrder]);

  if (!isOpen) return null;

  const isBuy = side === "BUY";
  const sideColor = isBuy ? "#00d166" : "#f23645";
  const changePct = quote?.changePct;
  const changeColor = (changePct ?? 0) >= 0 ? "#00d166" : "#f23645";

  return (
    <div className="fixed inset-0 z-[210] flex flex-col" style={{ background: "#0a0a0a" }}>

      <header className="shrink-0 flex items-center h-12 px-4 border-b" style={{ borderColor: "#1f1f23", background: "#111113" }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-[15px] text-[#fafafa] tracking-wide">{symbol}</span>
            <span className="font-mono text-[13px]" style={{ color: changeColor }}>
              {fmt(quote?.last)} {changePct != null ? `${changePct >= 0 ? "+" : ""}${fmt(changePct)}%` : ""}
            </span>
          </div>
          {isOption && (
            <p className="font-mono text-[10px] text-[#71717a] truncate">{optionSymbol}</p>
          )}
        </div>
        <span className="font-mono font-bold text-[11px] tracking-widest text-[#71717a] mr-4">ORDER TICKET</span>
        <button onClick={onClose} className="p-2 -mr-2 rounded-lg text-[#71717a] active:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </header>

      {stage === "form" || stage === "review" ? (
        <div className="flex-1 overflow-y-auto pb-32">
          <div className="p-4 space-y-5">

            <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid #27272a" }}>
              {(["BUY", "SELL"] as OrderSide[]).map((s) => {
                const active = side === s;
                const bg = active
                  ? s === "BUY" ? "rgba(0,209,102,0.15)" : "rgba(242,54,69,0.15)"
                  : "transparent";
                const clr = active
                  ? s === "BUY" ? "#00d166" : "#f23645"
                  : "#52525b";
                const bdr = active
                  ? s === "BUY" ? "#00d166" : "#f23645"
                  : "transparent";
                return (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className="flex-1 py-3.5 font-mono font-bold text-[14px] tracking-wider transition-all duration-150"
                    style={{ background: bg, color: clr, borderBottom: `2px solid ${bdr}` }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            <div>
              <label className="font-mono text-[11px] text-[#71717a] tracking-wider block mb-1.5">ORDER TYPE</label>
              <button
                onClick={() => setShowOrderType(!showOrderType)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl font-mono text-[13px] text-[#e4e4e7] transition-colors"
                style={{ background: "#1a1a1e", border: "1px solid #27272a" }}
              >
                {ORDER_TYPES.find((t) => t.value === orderType)?.label}
                <ChevronDown className="w-4 h-4 text-[#52525b]" />
              </button>
              {showOrderType && (
                <div className="mt-1 rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: "1px solid #27272a" }}>
                  {ORDER_TYPES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => { setOrderType(t.value); setShowOrderType(false); }}
                      className="w-full text-left px-4 py-2.5 font-mono text-[13px] transition-colors"
                      style={{
                        color: orderType === t.value ? "#FFB800" : "#a1a1aa",
                        background: orderType === t.value ? "rgba(255,184,0,0.06)" : "transparent",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="font-mono text-[11px] text-[#71717a] tracking-wider block mb-1.5">QUANTITY {isOption ? "(CONTRACTS)" : "(SHARES)"}</label>
              <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: "1px solid #27272a" }}>
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-4 py-3 text-[#a1a1aa] active:text-white transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  ref={qtyInputRef}
                  type="number"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v >= 0) setQuantity(v);
                  }}
                  className="flex-1 text-center font-mono text-[18px] font-bold text-[#fafafa] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  style={{ minWidth: 0 }}
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-4 py-3 text-[#a1a1aa] active:text-white transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                {[1, 5, 10, 25, 50, 100].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuantity(q)}
                    className="flex-1 py-1.5 rounded-lg font-mono text-[11px] font-medium transition-colors"
                    style={{
                      color: quantity === q ? "#FFB800" : "#52525b",
                      background: quantity === q ? "rgba(255,184,0,0.08)" : "#141416",
                      border: `1px solid ${quantity === q ? "rgba(255,184,0,0.3)" : "#27272a"}`,
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {needsLimit && (
              <div>
                <label className="font-mono text-[11px] text-[#71717a] tracking-wider block mb-1.5">LIMIT PRICE</label>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: "1px solid #27272a" }}>
                  <span className="pl-4 font-mono text-[13px] text-[#52525b]">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-2 py-3 font-mono text-[15px] text-[#fafafa] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <div className="flex flex-col gap-0.5 pr-2">
                    <button
                      onClick={() => { if (quote?.bid != null) setLimitPrice(quote.bid.toFixed(2)); }}
                      className="px-2 py-1 rounded font-mono text-[10px] font-bold transition-colors"
                      style={{ color: "#00d166", background: "rgba(0,209,102,0.08)" }}
                    >
                      BID {fmt(quote?.bid)}
                    </button>
                    <button
                      onClick={() => { if (quote?.ask != null) setLimitPrice(quote.ask.toFixed(2)); }}
                      className="px-2 py-1 rounded font-mono text-[10px] font-bold transition-colors"
                      style={{ color: "#f23645", background: "rgba(242,54,69,0.08)" }}
                    >
                      ASK {fmt(quote?.ask)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {needsStop && (
              <div>
                <label className="font-mono text-[11px] text-[#71717a] tracking-wider block mb-1.5">STOP PRICE</label>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: "1px solid #27272a" }}>
                  <span className="pl-4 font-mono text-[13px] text-[#52525b]">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={stopPrice}
                    onChange={(e) => setStopPrice(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-2 py-3 font-mono text-[15px] text-[#fafafa] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
              </div>
            )}

            {needsTrail && (
              <div>
                <label className="font-mono text-[11px] text-[#71717a] tracking-wider block mb-1.5">TRAIL AMOUNT ($)</label>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: "#1a1a1e", border: "1px solid #27272a" }}>
                  <span className="pl-4 font-mono text-[13px] text-[#52525b]">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={trailOffset}
                    onChange={(e) => setTrailOffset(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 px-2 py-3 font-mono text-[15px] text-[#fafafa] bg-transparent outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="font-mono text-[11px] text-[#71717a] tracking-wider block mb-1.5">TIME IN FORCE</label>
              <div className="flex gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDuration(d.value)}
                    className="flex-1 py-2.5 rounded-xl font-mono text-[12px] font-bold tracking-wider transition-all duration-150"
                    style={{
                      color: duration === d.value ? "#FFB800" : "#71717a",
                      background: duration === d.value ? "rgba(255,184,0,0.08)" : "#1a1a1e",
                      border: `1px solid ${duration === d.value ? "rgba(255,184,0,0.3)" : "#27272a"}`,
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <span className="font-mono text-[12px] text-[#a1a1aa]">Extended Hours</span>
              <button
                onClick={() => setExtendedHours(!extendedHours)}
                className="relative w-11 h-6 rounded-full transition-colors duration-200"
                style={{ background: extendedHours ? "#FFB800" : "#27272a" }}
              >
                <div
                  className="absolute top-0.5 w-5 h-5 rounded-full transition-transform duration-200"
                  style={{
                    background: extendedHours ? "#0a0a0a" : "#52525b",
                    transform: extendedHours ? "translateX(22px)" : "translateX(2px)",
                  }}
                />
              </button>
            </div>

            <div className="rounded-xl p-4 space-y-2" style={{ background: "#141416", border: "1px solid #1f1f23" }}>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Side</span>
                <span className="font-mono text-[12px] font-bold" style={{ color: sideColor }}>{side}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Symbol</span>
                <span className="font-mono text-[12px] text-[#e4e4e7]">{displaySymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Qty</span>
                <span className="font-mono text-[12px] text-[#e4e4e7]">{quantity} {isOption ? "contracts" : "shares"}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Type</span>
                <span className="font-mono text-[12px] text-[#e4e4e7]">{ORDER_TYPES.find((t) => t.value === orderType)?.label}</span>
              </div>
              {needsLimit && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px] text-[#71717a]">Limit</span>
                  <span className="font-mono text-[12px] text-[#e4e4e7]">${limitPrice || "—"}</span>
                </div>
              )}
              {needsStop && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px] text-[#71717a]">Stop</span>
                  <span className="font-mono text-[12px] text-[#e4e4e7]">${stopPrice || "—"}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Duration</span>
                <span className="font-mono text-[12px] text-[#e4e4e7]">{DURATIONS.find((d) => d.value === duration)?.label}</span>
              </div>
              {extendedHours && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px] text-[#71717a]">Session</span>
                  <span className="font-mono text-[12px] text-[#FFB800]">Extended</span>
                </div>
              )}
              <div className="border-t my-2" style={{ borderColor: "#1f1f23" }} />
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Est. {side === "BUY" ? "Cost" : "Credit"}</span>
                <span className="font-mono text-[14px] font-bold text-[#fafafa]">
                  {estimatedCost != null ? fmtCurrency(estimatedCost) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Bid / Ask</span>
                <span className="font-mono text-[12px] text-[#a1a1aa]">
                  {fmt(quote?.bid)} / {fmt(quote?.ask)}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : stage === "submitting" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin" style={{ color: "#FFB800" }} />
          <p className="font-mono text-[13px] text-[#a1a1aa]">Submitting order...</p>
        </div>
      ) : stage === "success" ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <CheckCircle2 className="w-14 h-14" style={{ color: "#00d166" }} />
          <p className="font-mono text-[16px] font-bold text-[#fafafa]">Order Placed</p>
          <p className="font-mono text-[12px] text-[#71717a] text-center">
            {side} {quantity} {isOption ? "contract(s)" : "share(s)"} of {displaySymbol}
          </p>
          {orderId && (
            <p className="font-mono text-[11px] text-[#52525b]">Order ID: {orderId}</p>
          )}
          <button
            onClick={onClose}
            className="mt-4 w-full max-w-xs py-3 rounded-xl font-mono text-[13px] font-bold tracking-wider transition-colors"
            style={{ background: "#1a1a1e", color: "#e4e4e7", border: "1px solid #27272a" }}
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <AlertTriangle className="w-14 h-14" style={{ color: "#f23645" }} />
          <p className="font-mono text-[16px] font-bold text-[#fafafa]">Order Failed</p>
          <p className="font-mono text-[12px] text-[#f23645] text-center max-w-sm">{errorMsg}</p>
          <div className="flex gap-3 mt-4 w-full max-w-xs">
            <button
              onClick={() => setStage("form")}
              className="flex-1 py-3 rounded-xl font-mono text-[13px] font-bold tracking-wider"
              style={{ background: "#1a1a1e", color: "#e4e4e7", border: "1px solid #27272a" }}
            >
              Edit Order
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-mono text-[13px] font-bold tracking-wider"
              style={{ background: "#1a1a1e", color: "#71717a", border: "1px solid #27272a" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {(stage === "form") && (
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-8" style={{ background: "linear-gradient(transparent, #0a0a0a 20%)" }}>
          <button
            onClick={() => setStage("review")}
            disabled={!isValid}
            className="w-full py-4 rounded-xl font-mono text-[14px] font-bold tracking-wider transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
            style={{
              background: isValid
                ? `linear-gradient(180deg, ${isBuy ? "#00d166" : "#f23645"} 0%, ${isBuy ? "#00a854" : "#cc2d3a"} 100%)`
                : "#27272a",
              color: isValid ? "#fff" : "#52525b",
              boxShadow: isValid ? `0 4px 20px ${isBuy ? "rgba(0,209,102,0.3)" : "rgba(242,54,69,0.3)"}` : "none",
            }}
          >
            Review {side} Order
          </button>
        </div>
      )}

      {stage === "review" && (
        <div className="fixed inset-0 z-[220] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div
            className="w-full max-w-lg rounded-t-2xl p-6 space-y-4 animate-in slide-in-from-bottom duration-300"
            style={{ background: "#141416", border: "1px solid #27272a", borderBottom: "none" }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-mono font-bold text-[15px] text-[#fafafa] tracking-wider">Confirm Order</h3>
              <button onClick={() => setStage("form")} className="p-1 text-[#71717a]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 rounded-xl p-4" style={{ background: "#0a0a0c", border: "1px solid #1f1f23" }}>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Action</span>
                <span className="font-mono text-[13px] font-bold" style={{ color: sideColor }}>
                  {isOption ? (optionInstruction ?? (side === "BUY" ? "BUY TO OPEN" : "SELL TO CLOSE")) : side}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Symbol</span>
                <span className="font-mono text-[13px] text-[#e4e4e7]">{displaySymbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Quantity</span>
                <span className="font-mono text-[13px] text-[#e4e4e7]">{quantity}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Order Type</span>
                <span className="font-mono text-[13px] text-[#e4e4e7]">{ORDER_TYPES.find((t) => t.value === orderType)?.label}</span>
              </div>
              {needsLimit && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px] text-[#71717a]">Limit Price</span>
                  <span className="font-mono text-[13px] text-[#e4e4e7]">${limitPrice}</span>
                </div>
              )}
              {needsStop && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px] text-[#71717a]">Stop Price</span>
                  <span className="font-mono text-[13px] text-[#e4e4e7]">${stopPrice}</span>
                </div>
              )}
              {needsTrail && (
                <div className="flex justify-between">
                  <span className="font-mono text-[11px] text-[#71717a]">Trail Amount</span>
                  <span className="font-mono text-[13px] text-[#e4e4e7]">${trailOffset}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="font-mono text-[11px] text-[#71717a]">Duration</span>
                <span className="font-mono text-[13px] text-[#e4e4e7]">{DURATIONS.find((d) => d.value === duration)?.label}{extendedHours ? " + Ext Hours" : ""}</span>
              </div>
              <div className="border-t my-2" style={{ borderColor: "#1f1f23" }} />
              <div className="flex justify-between">
                <span className="font-mono text-[12px] text-[#a1a1aa]">Est. {side === "BUY" ? "Cost" : "Credit"}</span>
                <span className="font-mono text-[16px] font-bold text-[#fafafa]">
                  {estimatedCost != null ? fmtCurrency(estimatedCost) : "—"}
                </span>
              </div>
            </div>

            <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.15)" }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#FFB800" }} />
              <p className="font-mono text-[10px] text-[#FFB800] leading-relaxed">
                This will place a live order with Schwab. Please verify all details before confirming.
              </p>
            </div>

            <div className="flex gap-3 pt-2 pb-4">
              <button
                onClick={() => setStage("form")}
                className="flex-1 py-3.5 rounded-xl font-mono text-[13px] font-bold tracking-wider"
                style={{ background: "#1a1a1e", color: "#a1a1aa", border: "1px solid #27272a" }}
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                className="flex-[2] py-3.5 rounded-xl font-mono text-[14px] font-bold tracking-wider active:scale-[0.98] transition-transform"
                style={{
                  background: `linear-gradient(180deg, ${isBuy ? "#00d166" : "#f23645"} 0%, ${isBuy ? "#00a854" : "#cc2d3a"} 100%)`,
                  color: "#fff",
                  boxShadow: `0 4px 20px ${isBuy ? "rgba(0,209,102,0.3)" : "rgba(242,54,69,0.3)"}`,
                }}
              >
                Confirm {side}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
