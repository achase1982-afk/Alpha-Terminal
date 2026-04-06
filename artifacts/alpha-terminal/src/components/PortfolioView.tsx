import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Briefcase,
  TrendingUp,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  DollarSign,
  BarChart3,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertCircle,
  Search,
  XCircle,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

const C = {
  bg: "#0c0c0c",
  card: "#18181b",
  border: "#27272a80",
  borderHi: "#3f3f46",
  text: "#e4e4e7",
  textMuted: "#a1a1aa",
  textDim: "#71717a",
  dim: "#52525b",
  gold: "#FFB800",
  green: "#00d166",
  red: "#f23645",
  cyan: "#22d3ee",
};

const f = `'SFMono-Regular','SF Mono',ui-monospace,'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace`;

type SubTab = "positions" | "orders" | "balance";
type OrderFilter = "ALL" | "WORKING" | "FILLED" | "CANCELED" | "REJECTED";

interface Position {
  symbol: string;
  underlyingSymbol: string;
  description: string;
  assetType: string;
  putCall: string | null;
  cusip: string;
  longQuantity: number;
  shortQuantity: number;
  averagePrice: number;
  marketValue: number;
  currentDayProfitLoss: number;
  currentDayProfitLossPercentage: number;
  longOpenProfitLoss: number;
  maintenanceRequirement: number;
  settledLongQuantity: number;
  settledShortQuantity: number;
  previousSessionLongQuantity: number;
}

interface Balances {
  liquidationValue: number;
  equity: number;
  buyingPower: number;
  dayTradingBuyingPower: number;
  cashBalance: number;
  availableFunds: number;
  marginBalance: number;
  maintenanceRequirement: number;
  longMarketValue: number;
  shortMarketValue: number;
  longOptionMarketValue: number;
  shortOptionMarketValue: number;
  moneyMarketFund: number;
  mutualFundValue: number;
  bondValue: number;
  pendingDeposits: number;
  sma: number;
}

interface Account {
  accountNumber: string;
  type: string;
  isDayTrader: boolean;
  roundTrips: number;
  balances: Balances;
  initialBalances: { accountValue: number; equity: number; liquidationValue: number };
  dayPL: number;
  totalPL: number;
  positions: Position[];
}

interface Order {
  orderId: number;
  orderType: string;
  session: string;
  duration: string;
  status: string;
  filledQuantity: number;
  remainingQuantity: number;
  price: number | null;
  complexStrategy: string;
  enteredTime: string;
  closeTime: string | null;
  legs: {
    instruction: string;
    quantity: number;
    symbol: string;
    underlyingSymbol: string;
    assetType: string;
    putCall: string | null;
    description: string;
  }[];
  fills: { legId: number; price: number; quantity: number; time: string }[];
  tag: string | null;
}

interface SymbolGroup {
  underlying: string;
  equity: Position | null;
  options: Position[];
  totalMarketValue: number;
  totalDayPL: number;
  totalPL: number;
}

function fmtCurrency(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${str}` : `$${str}`;
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtQty(long: number, short: number): string {
  if (short > 0) return `-${short}`;
  return `${long}`;
}

function plColor(n: number): string {
  if (n > 0) return C.green;
  if (n < 0) return C.red;
  return C.textDim;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatOptionSymbol(sym: string, includeUnderlying = true): string {
  const match = sym.trim().match(/^(\w+)\s+(\d{6})([CP])(\d{8})$/);
  if (!match) return sym.trim();
  const [, underlying, dateStr, pc, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;
  const mm = dateStr.slice(0, 2);
  const dd = dateStr.slice(2, 4);
  const yy = dateStr.slice(4, 6);
  const prefix = includeUnderlying ? `${underlying} ` : "";
  return `${prefix}${mm}/${dd}/${yy} $${strike} ${pc === "C" ? "Call" : "Put"}`;
}

function statusColor(status: string): string {
  switch (status) {
    case "FILLED": return C.green;
    case "CANCELED": case "REJECTED": case "EXPIRED": return C.red;
    case "WORKING": case "PENDING_ACTIVATION": return C.gold;
    default: return C.textDim;
  }
}


function MarginCallBanner() {
  const [pulse, setPulse] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 1200);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      style={{
        background: `linear-gradient(90deg, ${C.red}18, ${C.red}30, ${C.red}18)`,
        border: `1px solid ${C.red}`,
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: f,
        transition: "opacity 0.3s",
        opacity: pulse ? 1 : 0.85,
      }}
    >
      <AlertTriangle style={{ color: C.red, width: 20, height: 20, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.red, letterSpacing: 1.5, textTransform: "uppercase" }}>
          MARGIN CALL
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
          Equity below maintenance requirement. Deposit funds or close positions.
        </div>
      </div>
    </div>
  );
}

function DayTradesIndicator({ roundTrips, isDayTrader }: { roundTrips: number; isDayTrader: boolean }) {
  if (isDayTrader) return null;
  const remaining = Math.max(0, 3 - roundTrips);
  const color = remaining === 0 ? C.red : remaining === 1 ? C.gold : C.green;

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontFamily: f,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Clock style={{ color: C.textDim, width: 14, height: 14 }} />
        <span style={{ fontSize: 11, color: C.textMuted, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 600 }}>
          Day Trades Left
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", gap: 3 }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                background: i < remaining ? color : C.dim,
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: f, minWidth: 20, textAlign: "right" }}>
          {remaining}/3
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.8,
        padding: "2px 6px",
        borderRadius: 4,
        fontFamily: f,
        color: statusColor(status),
        background: `${statusColor(status)}15`,
      }}
    >
      {status}
    </span>
  );
}

function OptionRow({ pos, onTrade }: { pos: Position; onTrade?: (symbol: string, side: "BUY" | "SELL", optionSymbol?: string, optionInstruction?: string) => void }) {
  const isShort = pos.shortQuantity > 0;
  const qty = isShort ? pos.shortQuantity : pos.longQuantity;
  const totalPL = pos.longOpenProfitLoss;
  const totalPLPct = pos.averagePrice > 0 ? (totalPL / (pos.averagePrice * qty * 100)) * 100 : 0;
  const closeSide: "BUY" | "SELL" = isShort ? "BUY" : "SELL";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0 5px 20px",
        borderBottom: `1px solid ${C.border}`,
        fontFamily: f,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: pos.putCall === "CALL" ? C.green : C.red,
          width: 14,
          flexShrink: 0,
        }}
      >
        {pos.putCall === "CALL" ? "C" : "P"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: C.text, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {formatOptionSymbol(pos.symbol, false)}
        </div>
        <div style={{ fontSize: 11, color: C.textDim }}>
          {fmtQty(pos.longQuantity, pos.shortQuantity)} @ {fmtCurrency(pos.averagePrice)}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: C.text, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
          {fmtCurrency(pos.marketValue)}
        </div>
        <div style={{ fontSize: 11, color: plColor(totalPL), fontVariantNumeric: "tabular-nums" }}>
          {fmtCurrency(totalPL)} ({fmtPct(totalPLPct)})
        </div>
      </div>
      {onTrade && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const instruction = isShort ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE";
            onTrade(pos.underlyingSymbol, closeSide, pos.symbol, instruction);
          }}
          style={{
            fontSize: 11,
            fontWeight: 700,
            fontFamily: f,
            letterSpacing: 0.8,
            color: C.gold,
            background: `${C.gold}12`,
            border: `1px solid ${C.gold}30`,
            borderRadius: 6,
            padding: "3px 8px",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          CLOSE
        </button>
      )}
    </div>
  );
}

function SymbolGroupRow({
  group,
  onSelect,
  onTrade,
}: {
  group: SymbolGroup;
  onSelect: (sym: string) => void;
  onTrade?: (symbol: string, side: "BUY" | "SELL", optionSymbol?: string, optionInstruction?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOptions = group.options.length > 0;
  const eq = group.equity;
  const eqQty = eq ? (eq.shortQuantity > 0 ? eq.shortQuantity : eq.longQuantity) : 0;
  const eqIsShort = eq ? eq.shortQuantity > 0 : false;
  const eqPL = eq?.longOpenProfitLoss ?? 0;
  const eqPLPct = eq && eq.averagePrice > 0 ? (eqPL / (eq.averagePrice * eqQty)) * 100 : 0;

  return (
    <div style={{ borderBottom: `1px solid ${C.borderHi}` }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: f,
          transition: "background 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = `${C.text}05`)}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: 0.5 }}>
            {group.underlying}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {eq && (
              <span style={{ fontSize: 11, fontWeight: 600, color: C.green, background: `${C.green}15`, padding: "1px 5px", borderRadius: 4 }}>
                {fmtQty(eq.longQuantity, eq.shortQuantity)} SHR
              </span>
            )}
            {hasOptions && (
              <span style={{ fontSize: 11, fontWeight: 600, color: C.cyan, background: `${C.cyan}15`, padding: "1px 5px", borderRadius: 4 }}>
                {group.options.length} OPT
              </span>
            )}
          </div>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontVariantNumeric: "tabular-nums" }}>
            {fmtCurrency(group.totalMarketValue)}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
            {group.totalPL !== 0 ? (
              group.totalPL > 0 ? <ArrowUpRight style={{ color: C.green, width: 11, height: 11 }} /> : <ArrowDownRight style={{ color: C.red, width: 11, height: 11 }} />
            ) : (
              <Minus style={{ color: C.textDim, width: 11, height: 11 }} />
            )}
            <span style={{ fontSize: 11, color: plColor(group.totalPL), fontVariantNumeric: "tabular-nums" }}>
              {fmtCurrency(group.totalPL)}
            </span>
          </div>
        </div>

        {expanded ? (
          <ChevronDown style={{ color: C.textDim, width: 14, height: 14, flexShrink: 0 }} />
        ) : (
          <ChevronRight style={{ color: C.textDim, width: 14, height: 14, flexShrink: 0 }} />
        )}
      </button>

      {expanded && (
        <div style={{ background: `${C.card}80`, borderTop: `1px solid ${C.border}` }}>
          {eq && (
            <div style={{ padding: "8px 12px 8px 20px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>EQUITY</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px" }}>
                <div>
                  <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Qty</div>
                  <div style={{ fontSize: 12, color: C.text, fontVariantNumeric: "tabular-nums" }}>
                    {fmtQty(eq.longQuantity, eq.shortQuantity)}{eqIsShort ? " (short)" : ""}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Avg Price</div>
                  <div style={{ fontSize: 12, color: C.text, fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(eq.averagePrice)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Mkt Value</div>
                  <div style={{ fontSize: 12, color: C.text, fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(eq.marketValue)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Day P&L</div>
                  <div style={{ fontSize: 12, color: plColor(eq.currentDayProfitLoss), fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(eq.currentDayProfitLoss)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Total P&L</div>
                  <div style={{ fontSize: 12, color: plColor(eqPL), fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(eqPL)} ({fmtPct(eqPLPct)})</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Maint Req</div>
                  <div style={{ fontSize: 12, color: C.text, fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(eq.maintenanceRequirement)}</div>
                </div>
              </div>
              <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                <button
                  onClick={() => onSelect(group.underlying)}
                  style={{ fontSize: 11, fontWeight: 700, fontFamily: f, color: C.gold, background: "transparent", border: "none", cursor: "pointer", padding: 0, letterSpacing: 0.8 }}
                >
                  VIEW CHART →
                </button>
                {onTrade && (
                  <button
                    onClick={() => onTrade(group.underlying, eqIsShort ? "BUY" : "SELL")}
                    style={{ fontSize: 11, fontWeight: 700, fontFamily: f, color: C.gold, background: `${C.gold}12`, border: `1px solid ${C.gold}30`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", letterSpacing: 0.8 }}
                  >
                    TRADE
                  </button>
                )}
              </div>
            </div>
          )}

          {hasOptions && (
            <div>
              <div style={{ padding: "6px 12px 4px 20px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.cyan, letterSpacing: 0.8 }}>OPTIONS</span>
                <span style={{ fontSize: 11, color: C.textDim }}>{group.options.length}</span>
              </div>
              {group.options.map(opt => (
                <OptionRow key={opt.cusip} pos={opt} onTrade={onTrade} />
              ))}
            </div>
          )}

          {!eq && !hasOptions && (
            <div style={{ padding: "6px 12px" }}>
              <button
                onClick={() => onSelect(group.underlying)}
                style={{ fontSize: 11, fontWeight: 700, fontFamily: f, color: C.gold, background: "transparent", border: "none", cursor: "pointer", padding: 0, letterSpacing: 0.8 }}
              >
                VIEW CHART →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, onCancel }: { order: Order; onCancel?: (orderId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const primaryLeg = order.legs[0];
  const isMultiLeg = order.legs.length > 1;
  const displaySymbol = primaryLeg
    ? primaryLeg.assetType === "OPTION"
      ? formatOptionSymbol(primaryLeg.symbol)
      : primaryLeg.symbol
    : "—";
  const isBuy = primaryLeg?.instruction?.includes("BUY");
  const isOpen = order.status === "WORKING" || order.status === "PENDING_ACTIVATION";

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: f,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, flex: 1, gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: isBuy ? C.green : C.red }}>
              {primaryLeg?.instruction?.replace(/_/g, " ") ?? "—"}
            </span>
            {isMultiLeg && (
              <span style={{ fontSize: 11, color: C.textDim }}>+{order.legs.length - 1} leg{order.legs.length > 2 ? "s" : ""}</span>
            )}
          </div>
          <span style={{ fontSize: 11, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
            {displaySymbol}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
          <StatusBadge status={order.status} />
          <span style={{ fontSize: 11, color: C.textDim }}>{timeAgo(order.enteredTime)}</span>
        </div>

        {isOpen && onCancel && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(order.orderId); }}
            style={{ marginLeft: 4, padding: 4, borderRadius: 4, background: "transparent", border: "none", cursor: "pointer", color: C.red }}
          >
            <XCircle style={{ width: 14, height: 14 }} />
          </button>
        )}

        {expanded ? (
          <ChevronDown style={{ color: C.textDim, width: 14, height: 14, flexShrink: 0 }} />
        ) : (
          <ChevronRight style={{ color: C.textDim, width: 14, height: 14, flexShrink: 0 }} />
        )}
      </button>

      {expanded && (
        <div style={{ padding: "8px 12px 10px 20px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px" }}>
            {[
              ["Type", order.orderType.replace(/_/g, " ")],
              ["Price", order.price != null ? fmtCurrency(order.price) : "MKT"],
              ["Filled", `${order.filledQuantity} / ${order.filledQuantity + order.remainingQuantity}`],
              ["Duration", order.duration],
              ["Session", order.session],
              ...(order.complexStrategy !== "NONE" ? [["Strategy", order.complexStrategy.replace(/_/g, " ")]] : []),
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 12, color: C.text }}>{value}</div>
              </div>
            ))}
          </div>

          {order.legs.length > 1 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>Legs</div>
              {order.legs.map((leg, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: leg.instruction?.includes("BUY") ? C.green : C.red }}>
                    {leg.instruction?.replace(/_/g, " ")}
                  </span>
                  <span style={{ fontSize: 11, color: C.textMuted }}>
                    {leg.quantity}x {leg.assetType === "OPTION" ? formatOptionSymbol(leg.symbol) : leg.symbol}
                  </span>
                </div>
              ))}
            </div>
          )}

          {order.fills.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>Fills</div>
              {order.fills.map((fill, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 11, color: C.textMuted, fontVariantNumeric: "tabular-nums" }}>{fill.quantity}x @ {fmtCurrency(fill.price)}</span>
                  <span style={{ fontSize: 11, color: C.textDim }}>{timeAgo(fill.time)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BalanceStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontFamily: f }}>
      <span style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: color ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function MarginBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const barColor = pct > 80 ? C.red : pct > 50 ? C.gold : C.green;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, fontFamily: f }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: 0.8 }}>Margin Utilization</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: barColor, fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, overflow: "hidden", background: C.dim }}>
        <div style={{ height: "100%", borderRadius: 3, transition: "width 0.5s", width: `${pct}%`, background: barColor }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontSize: 11, color: C.textDim }}>{fmtCurrency(used)} used</span>
        <span style={{ fontSize: 11, color: C.textDim }}>{fmtCurrency(total)} total</span>
      </div>
    </div>
  );
}

const ORDER_FILTERS: { value: OrderFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "WORKING", label: "Open" },
  { value: "FILLED", label: "Filled" },
  { value: "CANCELED", label: "Canceled" },
  { value: "REJECTED", label: "Rejected" },
];

interface PortfolioViewProps {
  onNavigateToSymbol?: (sym: string) => void;
  onTrade?: (symbol: string, side: "BUY" | "SELL", optionSymbol?: string, optionInstruction?: string) => void;
}

export function PortfolioView({ onNavigateToSymbol, onTrade }: PortfolioViewProps) {
  const { accessToken, setSymbol } = useTerminalStore();

  const wsAccount = usePortfolioStreamStore((s) => s.account);
  const wsOrders = usePortfolioStreamStore((s) => s.orders);
  const wsLastUpdate = usePortfolioStreamStore((s) => s.lastUpdate);

  const [subTab, setSubTab] = useState<SubTab>("positions");
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("ALL");
  const [orderSearch, setOrderSearch] = useState("");
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [accountHash, setAccountHash] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState(false);
  const wsSubSentRef = useRef(false);

  useEffect(() => {
    if (wsAccount) {
      setAccount(wsAccount as Account);
      setLastRefresh(wsLastUpdate);
      setLoading(false);
      setError(null);
    }
  }, [wsAccount, wsLastUpdate]);

  useEffect(() => {
    if (wsOrders && wsOrders.length > 0) {
      setOrders(wsOrders as Order[]);
      setOrdersLoading(false);
      setOrdersError(false);
    }
  }, [wsOrders]);

  useEffect(() => {
    if (!accessToken) return;

    const sendSubscribe = () => {
      const ws = (window as any).__alphaWs as WebSocket | undefined;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "subscribePortfolio" }));
        wsSubSentRef.current = true;
        return true;
      }
      return false;
    };

    if (!sendSubscribe()) {
      const retry = setInterval(() => {
        if (sendSubscribe()) clearInterval(retry);
      }, 500);
      const timeout = setTimeout(() => clearInterval(retry), 10_000);
      var cleanup = () => { clearInterval(retry); clearTimeout(timeout); };
    }

    fetchWithAuth("/api/portfolio/accounts")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { if (data.length > 0 && !wsAccount) { setAccount(data[0]); setLastRefresh(new Date()); setLoading(false); } })
      .catch(() => { if (!wsAccount) setError("Failed to load portfolio data"); setLoading(false); });

    fetchWithAuth("/api/portfolio/orders?days=30")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { if (!wsOrders?.length) setOrders(data); })
      .catch(() => {});

    fetchWithAuth("/api/portfolio/account-hash")
      .then(r => r.json())
      .then(d => { if (d.hashValue) setAccountHash(d.hashValue); })
      .catch(() => {});

    return () => {
      cleanup?.();
      const ws = (window as any).__alphaWs as WebSocket | undefined;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: "unsubscribePortfolio" }));
      }
      wsSubSentRef.current = false;
    };
  }, [accessToken]);

  const fetchAccount = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/portfolio/accounts");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.length > 0) setAccount(data[0]);
      setLastRefresh(new Date());
    } catch {
      if (!silent) setError("Failed to load portfolio data");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(false);
    try {
      const res = await fetchWithAuth("/api/portfolio/orders?days=30");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setOrders(data);
    } catch {
      setOrdersError(true);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  const handleSelectSymbol = useCallback((sym: string) => {
    setSymbol(sym);
    onNavigateToSymbol?.(sym);
  }, [setSymbol, onNavigateToSymbol]);

  const handleCancelOrder = useCallback(async (orderId: number) => {
    if (!accountHash) return;
    setCancellingId(orderId);
    try {
      await fetchWithAuth("/api/portfolio/cancel-order", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHash, orderId: String(orderId) }),
      });
      fetchOrders();
    } catch {} finally {
      setCancellingId(null);
    }
  }, [accountHash, fetchOrders]);

  const symbolGroups = useMemo(() => {
    const positions = account?.positions ?? [];
    const groupMap = new Map<string, SymbolGroup>();

    for (const pos of positions) {
      const key = (pos.assetType === "OPTION" ? pos.underlyingSymbol : pos.symbol).toUpperCase();
      if (!groupMap.has(key)) {
        groupMap.set(key, { underlying: key, equity: null, options: [], totalMarketValue: 0, totalDayPL: 0, totalPL: 0 });
      }
      const g = groupMap.get(key)!;
      if (pos.assetType === "OPTION") {
        g.options.push(pos);
      } else {
        g.equity = pos;
      }
      g.totalMarketValue += pos.marketValue;
      g.totalDayPL += pos.currentDayProfitLoss;
      g.totalPL += pos.longOpenProfitLoss;
    }

    return Array.from(groupMap.values()).sort((a, b) => Math.abs(b.totalMarketValue) - Math.abs(a.totalMarketValue));
  }, [account]);

  const totalUnrealized = useMemo(() => {
    return (account?.positions ?? []).reduce((sum, p) => sum + p.longOpenProfitLoss, 0);
  }, [account]);

  const totalMarketValue = useMemo(() => {
    return (account?.positions ?? []).reduce((sum, p) => sum + p.marketValue, 0);
  }, [account]);

  const unrealizedPct = totalMarketValue > 0 ? (totalUnrealized / (totalMarketValue - totalUnrealized)) * 100 : 0;

  const isMarginCall = useMemo(() => {
    if (!account?.balances) return false;
    const bal = account.balances;
    return bal.equity > 0 && bal.maintenanceRequirement > 0 && bal.equity < bal.maintenanceRequirement;
  }, [account]);

  const filteredOrders = useMemo(() => {
    let filtered = orders;
    if (orderFilter !== "ALL") {
      filtered = filtered.filter(o => o.status === orderFilter);
    }
    if (orderSearch.trim()) {
      const q = orderSearch.trim().toUpperCase();
      filtered = filtered.filter(o =>
        o.legs.some(l => l.symbol.toUpperCase().includes(q) || l.underlyingSymbol?.toUpperCase().includes(q))
      );
    }
    return filtered;
  }, [orders, orderFilter, orderSearch]);

  if (!accessToken) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 32, minHeight: "60vh", fontFamily: f }}>
        <Briefcase style={{ width: 48, height: 48, color: C.dim }} />
        <p style={{ fontSize: 12, color: C.textDim, letterSpacing: 1 }}>CONNECT SCHWAB TO VIEW PORTFOLIO</p>
      </div>
    );
  }

  if (loading && !account) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32, minHeight: "60vh", fontFamily: f }}>
        <RefreshCw className="animate-spin" style={{ width: 24, height: 24, color: C.gold }} />
        <p style={{ fontSize: 11, color: C.textDim, letterSpacing: 1 }}>LOADING PORTFOLIO...</p>
      </div>
    );
  }

  if (error && !account) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32, minHeight: "60vh", fontFamily: f }}>
        <AlertCircle style={{ width: 32, height: 32, color: `${C.red}80` }} />
        <p style={{ fontSize: 12, color: `${C.red}aa` }}>{error}</p>
        <button onClick={() => fetchAccount()} style={{ fontSize: 11, color: C.gold, background: "transparent", border: "none", cursor: "pointer", letterSpacing: 1, fontFamily: f }}>
          RETRY
        </button>
      </div>
    );
  }

  const bal = account?.balances;
  const dayPL = account?.dayPL ?? 0;
  const totalPL = account?.totalPL ?? 0;
  const marginUsed = bal?.maintenanceRequirement ?? 0;
  const marginTotal = bal?.equity ?? 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontFamily: f }}>
      <div style={{ padding: "12px 12px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Briefcase style={{ width: 16, height: 16, color: C.gold }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text, letterSpacing: 1.2 }}>PORTFOLIO</span>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: C.green, display: "inline-block" }} title="Live updates active" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {lastRefresh && (
              <span style={{ fontSize: 11, color: C.dim }}>{timeAgo(lastRefresh.toISOString())}</span>
            )}
            <button
              onClick={() => { fetchAccount(); fetchOrders(); }}
              disabled={loading}
              style={{ padding: 6, borderRadius: 6, background: "transparent", border: "none", cursor: "pointer" }}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} style={{ width: 14, height: 14, color: C.textDim }} />
            </button>
          </div>
        </div>

        {isMarginCall && <MarginCallBanner />}

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Net Liquidation</span>
            <span style={{ fontSize: 11, color: C.dim }}>
              {account?.type ?? ""} · {account?.accountNumber ?? ""}
            </span>
          </div>
          <p style={{ fontSize: 24, fontWeight: 700, color: C.text, fontVariantNumeric: "tabular-nums", lineHeight: 1.2, margin: 0 }}>
            {fmtCurrency(bal?.liquidationValue ?? 0)}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Day P&L</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: plColor(dayPL), fontVariantNumeric: "tabular-nums" }}>
                {dayPL >= 0 ? "+" : ""}{fmtCurrency(dayPL)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Total P&L</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: plColor(totalPL), fontVariantNumeric: "tabular-nums" }}>
                {totalPL >= 0 ? "+" : ""}{fmtCurrency(totalPL)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Buying Power</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, fontVariantNumeric: "tabular-nums" }}>
                {fmtCurrency(bal?.buyingPower ?? 0)}
              </div>
            </div>
          </div>
        </div>

        {account && <DayTradesIndicator roundTrips={account.roundTrips} isDayTrader={account.isDayTrader} />}

        <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", background: C.card, border: `1px solid ${C.border}` }}>
          {(["positions", "orders", "balance"] as SubTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              style={{
                flex: 1,
                padding: "8px 0",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 1,
                fontFamily: f,
                color: subTab === tab ? C.gold : C.textDim,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                position: "relative",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                {tab === "positions" && <BarChart3 style={{ width: 14, height: 14 }} />}
                {tab === "orders" && <Clock style={{ width: 14, height: 14 }} />}
                {tab === "balance" && <DollarSign style={{ width: 14, height: 14 }} />}
                {tab}
              </div>
              {subTab === tab && (
                <div style={{ position: "absolute", bottom: 0, left: 8, right: 8, height: 2, borderRadius: 1, background: C.gold }} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {subTab === "positions" && (
          <div>
            {symbolGroups.length > 0 && (
              <div style={{ padding: "6px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.8, textTransform: "uppercase" }}>Unrealized P&L</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: plColor(totalUnrealized), fontVariantNumeric: "tabular-nums" }}>
                  {totalUnrealized >= 0 ? "+" : ""}{fmtCurrency(totalUnrealized)} ({fmtPct(unrealizedPct)})
                </span>
              </div>
            )}

            <div style={{ padding: "4px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 11, color: C.textMuted, letterSpacing: 0.8, fontWeight: 600 }}>
                {symbolGroups.length} SYMBOL{symbolGroups.length !== 1 ? "S" : ""}
              </span>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {(account?.positions ?? []).length} POSITION{(account?.positions ?? []).length !== 1 ? "S" : ""}
              </span>
            </div>

            {symbolGroups.map(group => (
              <SymbolGroupRow key={group.underlying} group={group} onSelect={handleSelectSymbol} onTrade={onTrade} />
            ))}

            {symbolGroups.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 0", gap: 12 }}>
                <Briefcase style={{ width: 32, height: 32, color: C.dim }} />
                <p style={{ fontSize: 12, color: C.textDim }}>No open positions</p>
              </div>
            )}
          </div>
        )}

        {subTab === "orders" && (
          <div>
            <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
                {ORDER_FILTERS.map((fil) => (
                  <button
                    key={fil.value}
                    onClick={() => setOrderFilter(fil.value)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      fontFamily: f,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      cursor: "pointer",
                      color: orderFilter === fil.value ? C.gold : C.dim,
                      background: orderFilter === fil.value ? `${C.gold}12` : "transparent",
                      border: `1px solid ${orderFilter === fil.value ? `${C.gold}40` : "transparent"}`,
                    }}
                  >
                    {fil.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", borderRadius: 6, overflow: "hidden", background: C.card, border: `1px solid ${C.border}` }}>
                <Search style={{ width: 14, height: 14, marginLeft: 10, color: C.dim, flexShrink: 0 }} />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search orders..."
                  style={{ flex: 1, padding: "6px 8px", fontSize: 11, fontFamily: f, background: "transparent", border: "none", outline: "none", color: C.text }}
                />
                {orderSearch && (
                  <button onClick={() => setOrderSearch("")} style={{ paddingRight: 8, background: "transparent", border: "none", cursor: "pointer", color: C.dim }}>
                    <XCircle style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            </div>

            {ordersLoading && orders.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 0", gap: 12 }}>
                <RefreshCw className="animate-spin" style={{ width: 20, height: 20, color: C.gold }} />
                <p style={{ fontSize: 11, color: C.textDim, letterSpacing: 1 }}>LOADING ORDERS...</p>
              </div>
            ) : ordersError ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 0", gap: 12 }}>
                <AlertCircle style={{ width: 24, height: 24, color: `${C.red}80` }} />
                <p style={{ fontSize: 12, color: `${C.red}aa` }}>Failed to load orders</p>
                <button onClick={fetchOrders} style={{ fontSize: 11, color: C.gold, background: "transparent", border: "none", cursor: "pointer", letterSpacing: 1, fontFamily: f }}>
                  RETRY
                </button>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "64px 0", gap: 12 }}>
                <Clock style={{ width: 32, height: 32, color: C.dim }} />
                <p style={{ fontSize: 12, color: C.textDim }}>{orderFilter === "ALL" && !orderSearch ? "No recent orders" : "No matching orders"}</p>
              </div>
            ) : (
              <>
                <div style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 6, background: C.bg }}>
                  <Clock style={{ width: 12, height: 12, color: C.gold }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.gold, letterSpacing: 0.8, textTransform: "uppercase" }}>
                    {orderFilter === "ALL" ? "All" : orderFilter} Orders
                  </span>
                  <span style={{ fontSize: 11, color: C.textDim, marginLeft: "auto" }}>{filteredOrders.length}</span>
                </div>
                {filteredOrders.map((order) => (
                  <OrderRow key={order.orderId} order={order} onCancel={handleCancelOrder} />
                ))}
              </>
            )}
          </div>
        )}

        {subTab === "balance" && bal && (
          <div style={{ padding: "8px 12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            <MarginBar used={marginUsed} total={marginTotal} />

            {[
              {
                icon: <DollarSign style={{ width: 14, height: 14, color: C.gold }} />,
                title: "Account Details",
                items: [
                  ["Equity", fmtCurrency(bal.equity)],
                  ["Cash Balance", fmtCurrency(bal.cashBalance)],
                  ["Available Funds", fmtCurrency(bal.availableFunds)],
                  ["Margin Balance", fmtCurrency(bal.marginBalance), bal.marginBalance < 0 ? C.red : undefined],
                  ["Buying Power", fmtCurrency(bal.buyingPower)],
                  ["DT Buying Power", fmtCurrency(bal.dayTradingBuyingPower)],
                  ["Maintenance Req", fmtCurrency(bal.maintenanceRequirement)],
                  ["SMA", fmtCurrency(bal.sma)],
                ],
              },
              {
                icon: <BarChart3 style={{ width: 14, height: 14, color: C.gold }} />,
                title: "Market Values",
                items: [
                  ["Long Stock", fmtCurrency(bal.longMarketValue)],
                  ["Short Stock", fmtCurrency(bal.shortMarketValue)],
                  ["Long Options", fmtCurrency(bal.longOptionMarketValue)],
                  ["Short Options", fmtCurrency(bal.shortOptionMarketValue), bal.shortOptionMarketValue < 0 ? C.red : undefined],
                  ["Bond Value", fmtCurrency(bal.bondValue)],
                  ["Pending Deposits", fmtCurrency(bal.pendingDeposits)],
                ],
              },
              ...(account ? [{
                icon: <ShieldCheck style={{ width: 14, height: 14, color: C.gold }} />,
                title: "Risk Metrics",
                items: [
                  ["Account Type", account.type],
                  ["Day Trader", account.isDayTrader ? "YES" : "NO", account.isDayTrader ? C.gold : undefined],
                  ["Round Trips (5d)", String(account.roundTrips), account.roundTrips >= 3 ? C.red : undefined],
                  ["Margin Usage", `${marginTotal > 0 ? ((marginUsed / marginTotal) * 100).toFixed(1) : "0"}%`, marginTotal > 0 && (marginUsed / marginTotal) > 0.8 ? C.red : undefined],
                ],
              }] : []),
            ].map(section => (
              <div key={section.title}>
                <div style={{ padding: "6px 0", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  {section.icon}
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.gold, letterSpacing: 0.8, textTransform: "uppercase" }}>{section.title}</span>
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", padding: "0 12px" }}>
                  {section.items.map(([label, value, color]) => (
                    <BalanceStat key={label} label={label as string} value={value as string} color={color as string | undefined} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
