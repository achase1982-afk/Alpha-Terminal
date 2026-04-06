import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  RefreshCw,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Search,
  XCircle,
  AlertTriangle,
  Settings,
  X,
  Check,
} from "lucide-react";

const C = {
  bg: "#0c0c0c",
  card: "#18181b",
  border: "#27272a80",
  borderHi: "#3f3f46",
  text: "#e4e4e7",
  textMuted: "#d4d4d8",
  textDim: "#a1a1aa",
  dim: "#71717a",
  gold: "#FFB800",
  green: "#00d166",
  red: "#dc2626",
  cyan: "#22d3ee",
};

const f = `'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

type SubTab = "positions" | "orders" | "balance";
type OrderFilter = "ALL" | "WORKING" | "FILLED" | "CANCELED" | "REJECTED";
type MetricKey = "plOpen" | "buyingPower" | "margin" | "availableFunds" | "cashBalance" | "posEquity";
type ColumnKey = "mark" | "cost" | "qty" | "mktVal" | "plOpen" | "plPct" | "plDay" | "maint";

const ALL_METRICS: { key: MetricKey; label: string }[] = [
  { key: "plOpen", label: "P/L Open" },
  { key: "buyingPower", label: "Buying Power" },
  { key: "margin", label: "Margin %" },
  { key: "availableFunds", label: "Available Funds" },
  { key: "cashBalance", label: "Cash Balance" },
  { key: "posEquity", label: "Position Equity" },
];
const DEFAULT_METRICS: MetricKey[] = ["plOpen", "buyingPower", "availableFunds", "margin"];
const METRICS_STORAGE_KEY = "alpha_visible_metrics";

const ALL_COLUMNS: { key: ColumnKey; label: string; desc: string }[] = [
  { key: "mark",   label: "Mark",    desc: "Current price per share / contract" },
  { key: "cost",   label: "Cost",    desc: "Avg price paid per share / contract" },
  { key: "qty",    label: "Qty",     desc: "Number of shares or contracts" },
  { key: "mktVal", label: "Mkt Val", desc: "Total position market value" },
  { key: "plOpen", label: "P/L $",   desc: "Unrealized P/L in dollars" },
  { key: "plPct",  label: "P/L %",   desc: "Unrealized P/L as a percentage" },
  { key: "plDay",  label: "P/L Day", desc: "Today's P/L in dollars" },
  { key: "maint",  label: "Maint",   desc: "Maintenance margin requirement" },
];
const DEFAULT_COLUMNS: ColumnKey[] = ["mark", "mktVal", "plPct", "plDay"];
const COLUMNS_STORAGE_KEY = "alpha_visible_columns";

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
  totalMaint: number;
}

function fmtCurrency(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${str}` : `$${str}`;
}
function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${n < 0 ? "-" : ""}$${(abs / 1e3).toFixed(1)}K`;
  return fmtCurrency(n);
}
function fmtPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function fmtQty(long: number, short: number): string {
  return short > 0 ? `-${short}` : `+${long}`;
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
  return `${Math.floor(hrs / 24)}d ago`;
}
function formatOptionSymbol(sym: string, includeUnderlying = true): string {
  const match = sym.trim().match(/^(\w+)\s+(\d{6})([CP])(\d{8})$/);
  if (!match) return sym.trim();
  const [, underlying, dateStr, pc, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;
  const strikeStr = strike % 1 === 0 ? String(strike) : strike.toFixed(1);
  const prefix = includeUnderlying ? `${underlying} ` : "";
  return `${prefix}${dateStr.slice(0, 2)}/${dateStr.slice(2, 4)}/${dateStr.slice(4, 6)} ${strikeStr}${pc}`;
}
function statusColor(status: string): string {
  switch (status) {
    case "FILLED": return C.green;
    case "CANCELED": case "REJECTED": case "EXPIRED": return C.red;
    case "WORKING": case "PENDING_ACTIVATION": return C.gold;
    default: return C.textDim;
  }
}

const getGridCols = (visibleCols: ColumnKey[]): string => {
  let cols = "minmax(0,1fr)";
  if (visibleCols.includes("mark"))   cols += " 65px";
  if (visibleCols.includes("cost"))   cols += " 65px";
  if (visibleCols.includes("qty"))    cols += " 50px";
  if (visibleCols.includes("mktVal")) cols += " 80px";
  if (visibleCols.includes("plOpen")) cols += " 80px";
  if (visibleCols.includes("plPct"))  cols += " 60px";
  if (visibleCols.includes("plDay"))  cols += " 80px";
  if (visibleCols.includes("maint"))  cols += " 70px";
  return cols;
};

function Checkbox({ checked, onToggle }: { checked: boolean; onToggle: (e: React.MouseEvent) => void }) {
  return (
    <div
      onClick={onToggle}
      style={{
        width: 15,
        height: 15,
        border: `1px solid ${checked ? C.gold : C.dim}`,
        borderRadius: 3,
        background: checked ? `${C.gold}22` : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      {checked && <div style={{ width: 7, height: 7, background: C.gold, borderRadius: 1 }} />}
    </div>
  );
}

function PositionTableRow({
  group,
  onSelect,
  onTrade,
  selectedKeys,
  toggleKey,
  visibleColumns,
}: {
  group: SymbolGroup;
  onSelect: (sym: string) => void;
  onTrade?: (symbol: string, side: "BUY" | "SELL", optionSymbol?: string, optionInstruction?: string) => void;
  selectedKeys: Set<string>;
  toggleKey: (key: string) => void;
  visibleColumns: ColumnKey[];
}) {
  const [expanded, setExpanded] = useState(false);
  const eq = group.equity;
  const hasOptions = group.options.length > 0;
  const eqIsShort = eq ? eq.shortQuantity > 0 : false;
  const costBasis = group.totalMarketValue - group.totalPL;
  const totalPLPct = Math.abs(costBasis) > 0.01 ? (group.totalPL / Math.abs(costBasis)) * 100 : 0;
  const eqKey = `${group.underlying}:EQ`;
  const eqSelected = hasOptions && eq && selectedKeys.has(eqKey);
  const someSelected = eqSelected || group.options.some(o => selectedKeys.has(`${group.underlying}:${o.cusip}`));

  const qtyStr = eq ? fmtQty(eq.longQuantity, eq.shortQuantity) : "";
  const optStr = hasOptions ? `${group.options.length}opt` : "";
  const details = [qtyStr, optStr].filter(Boolean).join(" ");
  const gridCols = useMemo(() => getGridCols(visibleColumns), [visibleColumns]);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          padding: "8px 12px",
          background: someSelected ? `${C.gold}06` : "transparent",
          borderBottom: `1px solid ${C.border}`,
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={e => { if (!someSelected) (e.currentTarget as HTMLDivElement).style.background = "#ffffff05"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = someSelected ? `${C.gold}06` : "transparent"; }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {expanded
            ? <ChevronDown style={{ width: 12, height: 12, color: C.dim, flexShrink: 0 }} />
            : <ChevronRight style={{ width: 12, height: 12, color: C.dim, flexShrink: 0 }} />}
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{group.underlying}</span>
          <span style={{ fontSize: 12, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{details}</span>
        </div>
        {visibleColumns.includes("mark") && (() => {
          const eqQty = eq ? (eq.longQuantity || eq.shortQuantity) : 0;
          const markPx = eq && eqQty > 0 ? eq.marketValue / eqQty : null;
          return <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{markPx != null ? `$${markPx.toFixed(2)}` : "—"}</span>;
        })()}
        {visibleColumns.includes("cost") && (() => {
          return <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{eq ? `$${eq.averagePrice.toFixed(2)}` : "—"}</span>;
        })()}
        {visibleColumns.includes("qty") && (() => {
          const eqQty = eq ? fmtQty(eq.longQuantity, eq.shortQuantity) : "";
          const optQty = group.options.length > 0 ? `${group.options.length}c` : "";
          return <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{[eqQty, optQty].filter(Boolean).join(" ") || "—"}</span>;
        })()}
        {visibleColumns.includes("mktVal") && <span style={{ fontSize: 14, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {fmtCompact(group.totalMarketValue)}
        </span>}
        {visibleColumns.includes("plOpen") && <span style={{ fontSize: 13, fontWeight: 500, color: plColor(group.totalPL), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {fmtCurrency(group.totalPL)}
        </span>}
        {visibleColumns.includes("plPct") && <span style={{ fontSize: 13, color: plColor(group.totalPL), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {fmtPct(totalPLPct)}
        </span>}
        {visibleColumns.includes("plDay") && <span style={{ fontSize: 14, fontWeight: 500, color: plColor(group.totalDayPL), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {fmtCurrency(group.totalDayPL)}
        </span>}
        {visibleColumns.includes("maint") && <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {group.totalMaint > 0 ? fmtCompact(group.totalMaint) : "—"}
        </span>}
      </div>

      {expanded && (
        <div style={{ borderBottom: `1px solid ${C.borderHi}`, background: "#0a0a0a" }}>
          {eq && (() => {
            const eqPLPct = eq.averagePrice > 0
              ? (eq.longOpenProfitLoss / (eq.averagePrice * (eq.shortQuantity > 0 ? eq.shortQuantity : eq.longQuantity))) * 100
              : 0;
            return (
              <div style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "center", padding: "7px 12px 7px 26px", borderBottom: `1px solid ${C.border}`, background: eqSelected ? `${C.gold}08` : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  {hasOptions && <Checkbox checked={!!eqSelected} onToggle={e => { e.stopPropagation(); toggleKey(eqKey); }} />}
                  <span style={{ fontSize: 13, color: C.text }}>
                    {fmtQty(eq.longQuantity, eq.shortQuantity)} @ {fmtCurrency(eq.averagePrice)}
                  </span>
                </div>
                {visibleColumns.includes("mark") && (() => {
                  const eqQty = eq.longQuantity || eq.shortQuantity;
                  const markPx = eqQty > 0 ? eq.marketValue / eqQty : 0;
                  return <span style={{ fontSize: 13, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${markPx.toFixed(2)}</span>;
                })()}
                {visibleColumns.includes("cost") && <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${eq.averagePrice.toFixed(2)}</span>}
                {visibleColumns.includes("qty") && <span style={{ fontSize: 13, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtQty(eq.longQuantity, eq.shortQuantity)}</span>}
                {visibleColumns.includes("mktVal") && <span style={{ fontSize: 13, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCompact(eq.marketValue)}</span>}
                {visibleColumns.includes("plOpen") && <span style={{ fontSize: 13, fontWeight: 500, color: plColor(eq.longOpenProfitLoss), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(eq.longOpenProfitLoss)}</span>}
                {visibleColumns.includes("plPct") && <span style={{ fontSize: 13, color: plColor(eq.longOpenProfitLoss), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtPct(eqPLPct)}</span>}
                {visibleColumns.includes("plDay") && <span style={{ fontSize: 13, color: plColor(eq.currentDayProfitLoss), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(eq.currentDayProfitLoss)}</span>}
                {visibleColumns.includes("maint") && <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{eq.maintenanceRequirement > 0 ? fmtCompact(eq.maintenanceRequirement) : "—"}</span>}
              </div>
            );
          })()}

          {group.options.map(opt => {
            const isShort = opt.shortQuantity > 0;
            const qty = isShort ? opt.shortQuantity : opt.longQuantity;
            const optKey = `${group.underlying}:${opt.cusip}`;
            const isSelected = selectedKeys.has(optKey);
            const totalPL = opt.longOpenProfitLoss;
            const totalPLPctOpt = opt.averagePrice > 0 ? (totalPL / (opt.averagePrice * qty * 100)) * 100 : 0;

            return (
              <div
                key={opt.cusip}
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  alignItems: "center",
                  padding: "7px 12px 7px 26px",
                  borderBottom: `1px solid ${C.border}`,
                  background: isSelected ? `${C.gold}08` : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Checkbox checked={isSelected} onToggle={e => { e.stopPropagation(); toggleKey(optKey); }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: opt.putCall === "CALL" ? "#4ade80" : "#fb923c", flexShrink: 0 }}>
                    {opt.putCall === "CALL" ? "C" : "P"}
                  </span>
                  <span style={{ fontSize: 13, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {formatOptionSymbol(opt.symbol, false)} ×{fmtQty(opt.longQuantity, opt.shortQuantity).replace("+", "")}
                  </span>
                </div>
                {visibleColumns.includes("mark") && (() => {
                  const markPx = qty > 0 ? opt.marketValue / (qty * 100) : 0;
                  return <span style={{ fontSize: 13, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${markPx.toFixed(2)}</span>;
                })()}
                {visibleColumns.includes("cost") && <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${opt.averagePrice.toFixed(2)}</span>}
                {visibleColumns.includes("qty") && <span style={{ fontSize: 13, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{isShort ? `-${qty}` : `+${qty}`}</span>}
                {visibleColumns.includes("mktVal") && <span style={{ fontSize: 13, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCompact(opt.marketValue)}</span>}
                {visibleColumns.includes("plOpen") && <span style={{ fontSize: 13, fontWeight: 500, color: plColor(totalPL), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(totalPL)}</span>}
                {visibleColumns.includes("plPct") && <span style={{ fontSize: 13, color: plColor(totalPL), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtPct(totalPLPctOpt)}</span>}
                {visibleColumns.includes("plDay") && <span style={{ fontSize: 13, color: plColor(opt.currentDayProfitLoss), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(opt.currentDayProfitLoss)}</span>}
                {visibleColumns.includes("maint") && <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{opt.maintenanceRequirement > 0 ? fmtCompact(opt.maintenanceRequirement) : "—"}</span>}
              </div>
            );
          })}

          <div style={{ padding: "7px 12px 7px 26px", display: "flex", gap: 12, borderBottom: `1px solid ${C.border}` }}>
            <button onClick={e => { e.stopPropagation(); onSelect(group.underlying); }} style={{ fontSize: 12, fontWeight: 500, fontFamily: f, color: C.gold, background: "transparent", border: "none", cursor: "pointer", padding: 0, letterSpacing: 0.3, textTransform: "uppercase" }}>Chart →</button>
            {onTrade && eq && !hasOptions && (
              <button onClick={e => { e.stopPropagation(); onTrade(group.underlying, eqIsShort ? "BUY" : "SELL"); }} style={{ fontSize: 12, fontWeight: 500, fontFamily: f, color: C.gold, background: "transparent", border: "none", cursor: "pointer", padding: 0, letterSpacing: 0.3, textTransform: "uppercase" }}>Sell</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function OrderRow({ order, onCancel }: { order: Order; onCancel?: (orderId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const primaryLeg = order.legs[0];
  const isMultiLeg = order.legs.length > 1;
  const displaySymbol = primaryLeg
    ? primaryLeg.assetType === "OPTION" ? formatOptionSymbol(primaryLeg.symbol) : primaryLeg.symbol
    : "—";
  const isBuy = primaryLeg?.instruction?.includes("BUY");
  const isOpen = order.status === "WORKING" || order.status === "PENDING_ACTIVATION";

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "transparent", border: "none", cursor: "pointer", fontFamily: f }}
        onMouseEnter={e => (e.currentTarget.style.background = "#ffffff04")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, flex: 1, gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: isBuy ? C.green : C.red, textTransform: "uppercase", letterSpacing: 0.3 }}>
              {primaryLeg?.instruction?.replace(/_/g, " ") ?? "—"}
            </span>
            {isMultiLeg && <span style={{ fontSize: 12, color: C.textDim }}>+{order.legs.length - 1} leg{order.legs.length > 2 ? "s" : ""}</span>}
          </div>
          <span style={{ fontSize: 13, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
            {displaySymbol}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: statusColor(order.status), textTransform: "uppercase", letterSpacing: 0.3 }}>{order.status}</span>
          <span style={{ fontSize: 12, color: C.dim }}>{timeAgo(order.enteredTime)}</span>
        </div>
        {isOpen && onCancel && (
          <button onClick={e => { e.stopPropagation(); onCancel(order.orderId); }} style={{ marginLeft: 2, padding: 2, background: "transparent", border: "none", cursor: "pointer", color: C.red }}>
            <XCircle style={{ width: 13, height: 13 }} />
          </button>
        )}
        {expanded ? <ChevronDown style={{ color: C.dim, width: 11, height: 11, flexShrink: 0 }} /> : <ChevronRight style={{ color: C.dim, width: 11, height: 11, flexShrink: 0 }} />}
      </button>

      {expanded && (
        <div style={{ padding: "6px 10px 8px 20px", borderTop: `1px solid ${C.border}`, background: "#0a0a0a" }}>
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
                <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                <div style={{ fontSize: 13, color: C.text }}>{value}</div>
              </div>
            ))}
          </div>
          {order.legs.length > 1 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Legs</div>
              {order.legs.map((leg, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 6, marginBottom: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: leg.instruction?.includes("BUY") ? C.green : C.red }}>{leg.instruction?.replace(/_/g, " ")}</span>
                  <span style={{ fontSize: 12, color: C.textDim }}>{leg.quantity}× {leg.assetType === "OPTION" ? formatOptionSymbol(leg.symbol) : leg.symbol}</span>
                </div>
              ))}
            </div>
          )}
          {order.fills.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Fills</div>
              {order.fills.map((fill, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 6, marginBottom: 1 }}>
                  <span style={{ fontSize: 12, color: C.textDim, fontVariantNumeric: "tabular-nums" }}>{fill.quantity}× @ {fmtCurrency(fill.price)}</span>
                  <span style={{ fontSize: 12, color: C.dim }}>{timeAgo(fill.time)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [marginCallExpanded, setMarginCallExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [visibleMetrics, setVisibleMetrics] = useState<MetricKey[]>(() => {
    try {
      const stored = localStorage.getItem(METRICS_STORAGE_KEY);
      if (stored) return JSON.parse(stored) as MetricKey[];
    } catch {}
    return DEFAULT_METRICS;
  });
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    try {
      const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (stored) return JSON.parse(stored) as ColumnKey[];
    } catch {}
    return DEFAULT_COLUMNS;
  });

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleMetric = useCallback((key: MetricKey) => {
    setVisibleMetrics(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try { localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (wsAccount) { setAccount(wsAccount as unknown as Account); setLastRefresh(wsLastUpdate); setLoading(false); setError(null); }
  }, [wsAccount, wsLastUpdate]);

  useEffect(() => {
    if (wsOrders && wsOrders.length > 0) { setOrders(wsOrders as Order[]); setOrdersLoading(false); setOrdersError(false); }
  }, [wsOrders]);

  useEffect(() => {
    if (!accessToken) return;
    const sendSubscribe = () => {
      const ws = (window as any).__alphaWs as WebSocket | undefined;
      if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ action: "subscribePortfolio" })); wsSubSentRef.current = true; return true; }
      return false;
    };
    if (!sendSubscribe()) {
      const retry = setInterval(() => { if (sendSubscribe()) clearInterval(retry); }, 500);
      const timeout = setTimeout(() => clearInterval(retry), 10_000);
      var cleanup = () => { clearInterval(retry); clearTimeout(timeout); };
    }
    fetchWithAuth("/api/portfolio/accounts").then(r => r.ok ? r.json() : Promise.reject()).then(data => { if (data.length > 0 && !wsAccount) { setAccount(data[0]); setLastRefresh(new Date()); setLoading(false); } }).catch(() => { if (!wsAccount) setError("Failed to load portfolio data"); setLoading(false); });
    fetchWithAuth("/api/portfolio/orders?days=30").then(r => r.ok ? r.json() : Promise.reject()).then(data => { if (!wsOrders?.length) setOrders(data); }).catch(() => {});
    fetchWithAuth("/api/portfolio/account-hash").then(r => r.json()).then(d => { if (d.hashValue) setAccountHash(d.hashValue); }).catch(() => {});
    return () => {
      cleanup?.();
      const ws = (window as any).__alphaWs as WebSocket | undefined;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "unsubscribePortfolio" }));
      wsSubSentRef.current = false;
    };
  }, [accessToken]);

  const fetchAccount = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/portfolio/accounts");
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.length > 0) setAccount(data[0]);
      setLastRefresh(new Date());
    } catch { if (!silent) setError("Failed to load portfolio data"); }
    finally { if (!silent) setLoading(false); }
  }, []);

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true); setOrdersError(false);
    try {
      const res = await fetchWithAuth("/api/portfolio/orders?days=30");
      if (!res.ok) throw new Error();
      setOrders(await res.json());
    } catch { setOrdersError(true); }
    finally { setOrdersLoading(false); }
  }, []);

  const handleSelectSymbol = useCallback((sym: string) => { setSymbol(sym); onNavigateToSymbol?.(sym); }, [setSymbol, onNavigateToSymbol]);

  const handleCancelOrder = useCallback(async (orderId: number) => {
    if (!accountHash) return;
    setCancellingId(orderId);
    try { await fetchWithAuth("/api/portfolio/cancel-order", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountHash, orderId: String(orderId) }) }); fetchOrders(); }
    catch {} finally { setCancellingId(null); }
  }, [accountHash, fetchOrders]);

  const gridCols = useMemo(() => getGridCols(visibleColumns), [visibleColumns]);

  const symbolGroups = useMemo(() => {
    const positions = account?.positions ?? [];
    const groupMap = new Map<string, SymbolGroup>();
    for (const pos of positions) {
      const key = (pos.assetType === "OPTION" ? pos.underlyingSymbol : pos.symbol).toUpperCase();
      if (!groupMap.has(key)) groupMap.set(key, { underlying: key, equity: null, options: [], totalMarketValue: 0, totalDayPL: 0, totalPL: 0, totalMaint: 0 });
      const g = groupMap.get(key)!;
      if (pos.assetType === "OPTION") g.options.push(pos); else g.equity = pos;
      g.totalMarketValue += pos.marketValue;
      g.totalDayPL += pos.currentDayProfitLoss;
      g.totalPL += pos.longOpenProfitLoss;
      g.totalMaint += pos.maintenanceRequirement;
    }
    return Array.from(groupMap.values()).sort((a, b) => Math.abs(b.totalMarketValue) - Math.abs(a.totalMarketValue));
  }, [account]);

  const totalUnrealized = useMemo(() => (account?.positions ?? []).reduce((s, p) => s + p.longOpenProfitLoss, 0), [account]);
  const totalMarketValue = useMemo(() => (account?.positions ?? []).reduce((s, p) => s + p.marketValue, 0), [account]);
  const unrealizedPct = Math.abs(totalMarketValue - totalUnrealized) > 0.01 ? (totalUnrealized / (totalMarketValue - totalUnrealized)) * 100 : 0;
  const grossMarketValue = useMemo(() => symbolGroups.reduce((s, g) => s + Math.abs(g.totalMarketValue), 0), [symbolGroups]);
  const totalDayPLPositions = useMemo(() => symbolGroups.reduce((s, g) => s + g.totalDayPL, 0), [symbolGroups]);
  const bestPerformer = useMemo(() => symbolGroups.length > 0 ? symbolGroups.reduce((b, g) => g.totalDayPL > b.totalDayPL ? g : b, symbolGroups[0]) : null, [symbolGroups]);
  const worstPerformer = useMemo(() => symbolGroups.length > 0 ? symbolGroups.reduce((w, g) => g.totalDayPL < w.totalDayPL ? g : w, symbolGroups[0]) : null, [symbolGroups]);

  const isMarginCall = useMemo(() => {
    if (!account?.balances) return false;
    const bal = account.balances;
    return bal.equity > 0 && bal.maintenanceRequirement > 0 && bal.equity < bal.maintenanceRequirement;
  }, [account]);

  const filteredOrders = useMemo(() => {
    let f2 = orders;
    if (orderFilter !== "ALL") f2 = f2.filter(o => o.status === orderFilter);
    if (orderSearch.trim()) { const q = orderSearch.trim().toUpperCase(); f2 = f2.filter(o => o.legs.some(l => l.symbol.toUpperCase().includes(q) || l.underlyingSymbol?.toUpperCase().includes(q))); }
    return f2;
  }, [orders, orderFilter, orderSearch]);

  const hasEqSelected = useMemo(() => [...selectedKeys].some(k => k.endsWith(":EQ")), [selectedKeys]);
  const hasOptSelected = useMemo(() => [...selectedKeys].some(k => !k.endsWith(":EQ")), [selectedKeys]);

  const handleCloseSelected = useCallback(() => {
    if (!onTrade) return;
    for (const key of selectedKeys) {
      const [underlying, rest] = key.split(":");
      if (rest === "EQ") {
        const grp = symbolGroups.find(g => g.underlying === underlying);
        if (grp?.equity) {
          const eq = grp.equity;
          onTrade(underlying, eq.shortQuantity > 0 ? "BUY" : "SELL");
        }
      } else {
        for (const grp of symbolGroups) {
          const opt = grp.options.find(o => o.cusip === rest);
          if (opt) { onTrade(opt.underlyingSymbol, opt.shortQuantity > 0 ? "BUY" : "SELL", opt.symbol, opt.shortQuantity > 0 ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE"); break; }
        }
      }
    }
    setSelectedKeys(new Set());
  }, [selectedKeys, symbolGroups, onTrade]);

  const handleRollSelected = useCallback(() => {
    const first = [...selectedKeys].find(k => !k.endsWith(":EQ"));
    if (!first) return;
    const underlying = first.split(":")[0];
    handleSelectSymbol(underlying);
    setSelectedKeys(new Set());
  }, [selectedKeys, handleSelectSymbol]);

  if (!accessToken) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: f }}>
      <div style={{ fontSize: 13, color: C.textDim, letterSpacing: 1.5, textTransform: "uppercase" }}>CONNECT SCHWAB TO VIEW PORTFOLIO</div>
    </div>
  );
  if (loading && !account) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: f }}>
      <RefreshCw className="animate-spin" style={{ width: 16, height: 16, color: C.gold }} />
      <div style={{ fontSize: 13, color: C.textDim, letterSpacing: 1, textTransform: "uppercase" }}>LOADING PORTFOLIO</div>
    </div>
  );
  if (error && !account) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: f }}>
      <div style={{ fontSize: 13, color: `${C.red}cc` }}>{error}</div>
      <button onClick={() => fetchAccount()} style={{ fontSize: 13, color: C.gold, background: "transparent", border: "none", cursor: "pointer", fontFamily: f, textTransform: "uppercase" }}>RETRY</button>
    </div>
  );

  const bal = account?.balances;
  const dayPL = account?.dayPL ?? 0;
  const totalPL = account?.totalPL ?? 0;
  const marginUsed = bal?.maintenanceRequirement ?? 0;
  const marginTotal = bal?.equity ?? 0;
  const marginPct = marginTotal > 0 ? (marginUsed / marginTotal) * 100 : 0;
  const marginDeficiency = Math.max(0, marginUsed - marginTotal);
  const prevDayValue = (bal?.liquidationValue ?? 0) - dayPL;
  const dayReturnPct = prevDayValue > 0 ? (dayPL / prevDayValue) * 100 : 0;
  const dayTradesLeft = account ? (account.isDayTrader ? null : Math.max(0, 3 - account.roundTrips)) : null;

  const metricValues: Record<MetricKey, { label: string; value: string; color: string }> = {
    plOpen: { label: "P/L Open", value: fmtCurrency(totalPL), color: plColor(totalPL) },
    buyingPower: { label: "Buying Pwr", value: fmtCurrency(bal?.buyingPower ?? 0), color: (bal?.buyingPower ?? 0) < 0 ? C.red : C.text },
    margin: { label: "Margin", value: `${marginPct.toFixed(0)}%`, color: marginPct > 80 ? C.red : marginPct > 50 ? C.gold : C.text },
    availableFunds: { label: "Avail Funds", value: fmtCurrency(bal?.availableFunds ?? 0), color: (bal?.availableFunds ?? 0) < 0 ? C.red : C.text },
    cashBalance: { label: "Cash Bal", value: fmtCurrency(bal?.cashBalance ?? 0), color: C.text },
    posEquity: { label: "Pos Equity", value: fmtCurrency(bal?.equity ?? 0), color: C.text },
  };

  const shownMetrics = visibleMetrics
    .filter(k => metricValues[k])
    .map(k => metricValues[k]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontFamily: f, position: "relative" }}>
      {showSettings && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 50, background: "#000000cc", display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
          onClick={() => setShowSettings(false)}
        >
          <div
            style={{ margin: "48px 8px 0", background: "#1a1a1a", border: `1px solid ${C.borderHi}`, width: 220, padding: 0, fontFamily: f }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Display Metrics</span>
              <button onClick={() => setShowSettings(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: C.dim, padding: 0 }}>
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
            {ALL_METRICS.map(m => {
              const on = visibleMetrics.includes(m.key);
              return (
                <button
                  key={m.key}
                  onClick={() => toggleMetric(m.key)}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", fontFamily: f }}
                >
                  <span style={{ fontSize: 13, color: on ? C.text : C.dim }}>{m.label}</span>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: `1px solid ${on ? C.gold : C.dim}`, background: on ? `${C.gold}22` : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {on && <Check style={{ width: 10, height: 10, color: C.gold }} />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ borderBottom: `1px solid ${C.borderHi}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 12, color: C.dim }}>····{(account?.accountNumber ?? "").slice(-4)}</span>
            <span style={{ fontSize: 12, color: C.dim }}>·</span>
            <span style={{ fontSize: 12, color: C.dim, textTransform: "uppercase" }}>{account?.type ?? ""}</span>
            <span style={{ width: 5, height: 5, borderRadius: 3, background: C.green, display: "inline-block" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {lastRefresh && <span style={{ fontSize: 11, color: C.dim }}>{timeAgo(lastRefresh.toISOString())}</span>}
            <button onClick={() => { fetchAccount(); fetchOrders(); }} disabled={loading} style={{ padding: 3, background: "transparent", border: "none", cursor: "pointer" }}>
              <RefreshCw className={loading ? "animate-spin" : ""} style={{ width: 12, height: 12, color: C.dim }} />
            </button>
            <button onClick={() => setShowSettings(s => !s)} style={{ padding: 3, background: "transparent", border: "none", cursor: "pointer" }}>
              <Settings style={{ width: 12, height: 12, color: showSettings ? C.gold : C.dim }} />
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "0 12px 8px", gap: 4 }}>
          <div>
            <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Net Liq Value</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text, fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>
              {fmtCurrency(bal?.liquidationValue ?? 0)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Available $</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: (bal?.availableFunds ?? 0) < 0 ? C.red : C.text, fontVariantNumeric: "tabular-nums" }}>
              {fmtCurrency(bal?.availableFunds ?? 0)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Buying Power</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: (bal?.buyingPower ?? 0) < 0 ? C.red : C.text, fontVariantNumeric: "tabular-nums" }}>
              {fmtCurrency(bal?.buyingPower ?? 0)}
            </div>
          </div>
        </div>

        {isMarginCall && (
          <button
            onClick={() => setMarginCallExpanded(x => !x)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "9px 12px", background: C.gold, border: "none", cursor: "pointer", fontFamily: f }}
          >
            <AlertTriangle style={{ color: "#000", width: 15, height: 15, flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: "#000", textTransform: "uppercase", letterSpacing: 1 }}>
              CALL ALERT — IMMEDIATE ACTION REQUIRED
            </span>
            {marginCallExpanded ? <ChevronDown style={{ width: 13, height: 13, color: "#000", marginLeft: "auto" }} /> : <ChevronRight style={{ width: 13, height: 13, color: "#000", marginLeft: "auto" }} />}
          </button>
        )}
        {isMarginCall && marginCallExpanded && (
          <div style={{ background: `${C.gold}12`, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              ["Margin Equity", fmtCurrency(marginTotal), C.text],
              ["Maint. Requirement", fmtCurrency(marginUsed), C.text],
              ["Deficiency", fmtCurrency(marginDeficiency), C.red],
            ].map(([label, val, clr]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: C.textMuted }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: clr as string, fontVariantNumeric: "tabular-nums" }}>{val}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", borderTop: `1px solid ${C.borderHi}` }}>
          {(["positions", "orders", "balance"] as SubTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              style={{
                flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.8,
                fontFamily: f, color: subTab === tab ? C.gold : C.dim, background: "transparent", border: "none",
                borderBottom: subTab === tab ? `2px solid ${C.gold}` : "2px solid transparent", cursor: "pointer",
              }}
            >
              {tab === "balance" ? "Balances" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {subTab === "positions" && (
          <div>
            <div style={{
              display: "grid", gridTemplateColumns: gridCols, padding: "6px 12px",
              borderBottom: `1px solid ${C.borderHi}`, background: "#0e0e0e",
              position: "sticky", top: 0, zIndex: 1,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>Symbol</span>
                <button onClick={() => setShowColumnSettings(x => !x)} style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer" }}>
                  <Settings style={{ width: 13, height: 13, color: showColumnSettings ? C.gold : C.dim }} />
                </button>
              </div>
              {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(c => (
                <span key={c.key} style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.6, textAlign: "right" }}>{c.label}</span>
              ))}
            </div>

            {showColumnSettings && (
              <div style={{ position: "fixed", inset: 0, zIndex: 49, background: "transparent" }} onClick={() => setShowColumnSettings(false)} />
            )}
            {showColumnSettings && (
              <div
                style={{ position: "absolute", top: "54px", left: "8px", zIndex: 50, background: "#161616", border: `1px solid ${C.borderHi}`, borderRadius: 6, width: 260, padding: 0, fontFamily: f, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{ padding: "10px 14px 8px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Columns</span>
                  <span style={{ fontSize: 11, color: C.dim }}>{visibleColumns.length}/{ALL_COLUMNS.length} on</span>
                </div>
                {ALL_COLUMNS.map((col, i) => {
                  const on = visibleColumns.includes(col.key);
                  return (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col.key)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: on ? `${C.gold}06` : "transparent", border: "none", borderBottom: i < ALL_COLUMNS.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer", fontFamily: f, textAlign: "left" }}
                    >
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${on ? C.gold : C.dim}`, background: on ? `${C.gold}20` : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {on && <Check style={{ width: 11, height: 11, color: C.gold }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: on ? 600 : 400, color: on ? C.text : C.dim }}>{col.label}</div>
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{col.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {symbolGroups.map(group => (
              <PositionTableRow
                key={group.underlying}
                group={group}
                onSelect={handleSelectSymbol}
                onTrade={onTrade}
                selectedKeys={selectedKeys}
                toggleKey={toggleKey}
                visibleColumns={visibleColumns}
              />
            ))}

            {symbolGroups.length > 0 && (
              <div style={{
                display: "grid", gridTemplateColumns: gridCols, padding: "8px 12px",
                borderTop: `2px solid ${C.borderHi}`, background: "#0e0e0e",
              }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: C.textMuted }}>Overall Totals</span>
                {visibleColumns.includes("mark")   && <span style={{ fontSize: 13, color: C.dim, textAlign: "right" }}>—</span>}
                {visibleColumns.includes("cost")   && <span style={{ fontSize: 13, color: C.dim, textAlign: "right" }}>—</span>}
                {visibleColumns.includes("qty")    && <span style={{ fontSize: 13, color: C.dim, textAlign: "right" }}>—</span>}
                {visibleColumns.includes("mktVal") && <span style={{ fontSize: 14, fontWeight: 500, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCompact(totalMarketValue)}</span>}
                {visibleColumns.includes("plOpen") && <span style={{ fontSize: 14, fontWeight: 500, color: plColor(totalUnrealized), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(totalUnrealized)}</span>}
                {visibleColumns.includes("plPct")  && <span style={{ fontSize: 14, fontWeight: 500, color: plColor(totalUnrealized), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtPct(unrealizedPct)}</span>}
                {visibleColumns.includes("plDay")  && <span style={{ fontSize: 14, fontWeight: 600, color: plColor(totalDayPLPositions), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtCurrency(totalDayPLPositions)}</span>}
                {visibleColumns.includes("maint")  && (() => {
                  const totalMaint = (account?.positions ?? []).reduce((s, p) => s + p.maintenanceRequirement, 0);
                  return <span style={{ fontSize: 13, color: C.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{totalMaint > 0 ? fmtCompact(totalMaint) : "—"}</span>;
                })()}
              </div>
            )}

            {symbolGroups.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: "4px 0" }}>
                {[
                  { label: "P/L Day:", value: `${fmtCurrency(totalDayPLPositions)} (${dayReturnPct >= 0 ? "+" : ""}${dayReturnPct.toFixed(1)}%)`, color: plColor(totalDayPLPositions) },
                  { label: "P/L Open:", value: fmtCurrency(totalUnrealized), color: plColor(totalUnrealized) },
                  { label: "Net Liq:", value: fmtCurrency(bal?.liquidationValue ?? 0), color: C.text },
                  { label: "Available $:", value: fmtCurrency(bal?.availableFunds ?? 0), color: (bal?.availableFunds ?? 0) < 0 ? C.red : C.text },
                  { label: "Position Equity:", value: fmtCurrency(bal?.equity ?? 0), color: C.text },
                  ...(dayTradesLeft !== null ? [{ label: "Day Trades Left:", value: String(dayTradesLeft), color: dayTradesLeft === 0 ? C.red : dayTradesLeft === 1 ? C.gold : C.text }] : []),
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 12px" }}>
                    <span style={{ fontSize: 13, color: C.textMuted }}>{row.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: row.color, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            {symbolGroups.length === 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
                <div style={{ fontSize: 13, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>No open positions</div>
              </div>
            )}
          </div>
        )}

        {subTab === "orders" && (
          <div>
            <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 6, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex" }}>
                {ORDER_FILTERS.map(fil => (
                  <button
                    key={fil.value}
                    onClick={() => setOrderFilter(fil.value)}
                    style={{
                      padding: "4px 10px", fontSize: 12, fontWeight: 500, letterSpacing: 0.5, fontFamily: f,
                      textTransform: "uppercase", cursor: "pointer", color: orderFilter === fil.value ? C.gold : C.dim,
                      background: "transparent", border: "none",
                      borderBottom: orderFilter === fil.value ? `1px solid ${C.gold}` : "1px solid transparent",
                    }}
                  >
                    {fil.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.border}` }}>
                <Search style={{ width: 13, height: 13, marginLeft: 8, color: C.dim, flexShrink: 0 }} />
                <input type="text" value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Search orders..." style={{ flex: 1, padding: "5px 7px", fontSize: 13, fontFamily: f, background: "transparent", border: "none", outline: "none", color: C.text }} />
                {orderSearch && <button onClick={() => setOrderSearch("")} style={{ paddingRight: 6, background: "transparent", border: "none", cursor: "pointer", color: C.dim }}><XCircle style={{ width: 12, height: 12 }} /></button>}
              </div>
            </div>
            {ordersLoading && orders.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
                <RefreshCw className="animate-spin" style={{ width: 14, height: 14, color: C.gold }} />
                <div style={{ fontSize: 13, color: C.textDim, letterSpacing: 1, textTransform: "uppercase" }}>Loading orders</div>
              </div>
            ) : ordersError ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
                <div style={{ fontSize: 13, color: `${C.red}cc` }}>Failed to load orders</div>
                <button onClick={fetchOrders} style={{ fontSize: 13, color: C.gold, background: "transparent", border: "none", cursor: "pointer", letterSpacing: 1, fontFamily: f, textTransform: "uppercase" }}>RETRY</button>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
                <div style={{ fontSize: 13, color: C.textDim }}>{orderFilter === "ALL" && !orderSearch ? "No recent orders" : "No matching orders"}</div>
              </div>
            ) : (
              <>
                <div style={{ padding: "5px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.border}`, background: "#0e0e0e" }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: C.dim, letterSpacing: 0.8, textTransform: "uppercase" }}>{orderFilter === "ALL" ? "All" : orderFilter} Orders</span>
                  <span style={{ fontSize: 12, color: C.dim }}>{filteredOrders.length}</span>
                </div>
                {filteredOrders.map(order => <OrderRow key={order.orderId} order={order} onCancel={handleCancelOrder} />)}
              </>
            )}
          </div>
        )}

        {subTab === "balance" && bal && (
          <div>
            <div style={{ padding: "7px 10px", borderBottom: `1px solid ${C.borderHi}`, background: "#0e0e0e" }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>Account Summary</span>
            </div>
            {[
              ["Net Liquidating Value", fmtCurrency(bal.liquidationValue), C.text],
              ...(dayTradesLeft !== null ? [["Day Trades Left", String(dayTradesLeft), dayTradesLeft === 0 ? C.red : C.text]] : []),
              ["Stock Buying Power", fmtCurrency(bal.buyingPower), bal.buyingPower < 0 ? C.red : C.text],
              ["Option Buying Power", fmtCurrency(bal.availableFunds), bal.availableFunds < 0 ? C.red : C.text],
              ["Available Funds For Trading", fmtCurrency(bal.availableFunds), bal.availableFunds < 0 ? C.red : C.text],
              ["Cash & Sweep Vehicle", fmtCurrency(bal.cashBalance), bal.cashBalance < 0 ? C.red : C.text],
              ["Cash Balance", fmtCurrency(bal.cashBalance), undefined],
              ["Maintenance Requirement", fmtCurrency(bal.maintenanceRequirement), undefined],
              ["Margin Balance", fmtCurrency(bal.marginBalance), bal.marginBalance < 0 ? C.red : undefined],
              ["Margin Equity", fmtCurrency(bal.equity), undefined],
              ["Money Market Balance", fmtCurrency(bal.moneyMarketFund), undefined],
              ["Long Stock Value", fmtCurrency(bal.longMarketValue), undefined],
              ["Short Balance", fmtCurrency(bal.shortMarketValue), undefined],
              ["SMA", fmtCurrency(bal.sma), undefined],
            ].map(([label, value, color]) => (
              <div key={label as string} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderBottom: `1px solid ${C.border}`, fontFamily: f }}>
                <span style={{ fontSize: 13, color: C.textMuted }}>{label}:</span>
                <span style={{ fontSize: 13, fontWeight: 400, color: (color as string) ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
              </div>
            ))}
            {account && (
              <>
                <div style={{ padding: "7px 10px", borderBottom: `1px solid ${C.borderHi}`, background: "#0e0e0e" }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>Risk & Market Values</span>
                </div>
                {[
                  ["Account Type", account.type, undefined],
                  ["Day Trader Status", account.isDayTrader ? "YES" : "NO", account.isDayTrader ? C.gold : undefined],
                  ["Round Trips (5d)", String(account.roundTrips), account.roundTrips >= 3 ? C.red : undefined],
                  ["Margin Utilization", `${marginPct.toFixed(1)}%`, marginPct > 80 ? C.red : marginPct > 50 ? C.gold : undefined],
                  ["Long Options", fmtCurrency(bal.longOptionMarketValue), undefined],
                  ["Short Options", fmtCurrency(bal.shortOptionMarketValue), bal.shortOptionMarketValue < 0 ? C.red : undefined],
                  ["Bond Value", fmtCurrency(bal.bondValue), undefined],
                  ["Pending Deposits", fmtCurrency(bal.pendingDeposits), undefined],
                  ["DT Buying Power", fmtCurrency(bal.dayTradingBuyingPower), undefined],
                ].map(([label, value, color]) => (
                  <div key={label as string} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderBottom: `1px solid ${C.border}`, fontFamily: f }}>
                    <span style={{ fontSize: 13, color: C.textMuted }}>{label}:</span>
                    <span style={{ fontSize: 13, fontWeight: 400, color: (color as string) ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {selectedKeys.size > 0 && (
        <div style={{
          position: "sticky", bottom: 0, left: 0, right: 0,
          background: "#141414", borderTop: `1px solid ${C.borderHi}`,
          padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, zIndex: 20,
        }}>
          <button
            onClick={() => setSelectedKeys(new Set())}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: C.dim, background: "transparent", border: "none", cursor: "pointer", fontFamily: f, padding: "4px 6px" }}
          >
            <X style={{ width: 13, height: 13 }} />
            <span>{selectedKeys.size}</span>
          </button>
          <div style={{ flex: 1 }} />
          {hasOptSelected && (
            <button
              onClick={handleRollSelected}
              style={{
                fontSize: 13, fontWeight: 500, fontFamily: f, color: C.gold, letterSpacing: 0.3,
                background: "transparent", border: `1px solid ${C.gold}40`, cursor: "pointer",
                padding: "6px 16px",
              }}
            >
              Roll Selected
            </button>
          )}
          <button
            onClick={handleCloseSelected}
            style={{
              fontSize: 13, fontWeight: 500, fontFamily: f, color: "#000", letterSpacing: 0.3,
              background: C.gold, border: "none", cursor: "pointer",
              padding: "6px 16px",
            }}
          >
            Close Selected
          </button>
        </div>
      )}
    </div>
  );
}
