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

const f = `'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

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

function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${n < 0 ? "-" : ""}$${(abs / 1e3).toFixed(1)}K`;
  return fmtCurrency(n);
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtQty(long: number, short: number): string {
  if (short > 0) return `-${short}`;
  return `+${long}`;
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
  const strikeStr = strike % 1 === 0 ? String(strike) : strike.toFixed(1);
  const prefix = includeUnderlying ? `${underlying} ` : "";
  return `${prefix}${mm}/${dd}/${yy} ${strikeStr}${pc === "C" ? "C" : "P"}`;
}

function statusColor(status: string): string {
  switch (status) {
    case "FILLED": return C.green;
    case "CANCELED": case "REJECTED": case "EXPIRED": return C.red;
    case "WORKING": case "PENDING_ACTIVATION": return C.gold;
    default: return C.textDim;
  }
}

const gridCols = "minmax(0,1fr) 72px 58px 72px";

function PositionTableRow({
  group,
  onSelect,
  onTrade,
}: {
  group: SymbolGroup;
  onSelect: (sym: string) => void;
  onTrade?: (symbol: string, side: "BUY" | "SELL", optionSymbol?: string, optionInstruction?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const eq = group.equity;
  const hasOptions = group.options.length > 0;
  const eqIsShort = eq ? eq.shortQuantity > 0 : false;
  const costBasis = group.totalMarketValue - group.totalPL;
  const totalPLPct = Math.abs(costBasis) > 0.01 ? (group.totalPL / Math.abs(costBasis)) * 100 : 0;

  const qtyStr = eq
    ? `${fmtQty(eq.longQuantity, eq.shortQuantity)}`
    : "";
  const optStr = hasOptions ? `${group.options.length}opt` : "";
  const details = [qtyStr, optStr].filter(Boolean).join(" ");

  return (
    <>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          borderBottom: `1px solid ${C.border}`,
          cursor: "pointer",
          fontFamily: f,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#ffffff04")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          {expanded
            ? <ChevronDown style={{ width: 10, height: 10, color: C.dim, flexShrink: 0 }} />
            : <ChevronRight style={{ width: 10, height: 10, color: C.dim, flexShrink: 0 }} />}
          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, letterSpacing: 0.3 }}>{group.underlying}</span>
          <span style={{ fontSize: 10, color: C.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{details}</span>
        </div>
        <span style={{ fontSize: 11, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {fmtCompact(group.totalMarketValue)}
        </span>
        <span style={{ fontSize: 11, color: plColor(group.totalPL), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {fmtPct(totalPLPct)}
        </span>
        <span style={{ fontSize: 11, color: plColor(group.totalDayPL), textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
          {fmtCurrency(group.totalDayPL)}
        </span>
      </button>

      {expanded && (
        <div style={{ borderBottom: `1px solid ${C.border}`, background: "#0a0a0a" }}>
          {eq && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                alignItems: "center",
                padding: "5px 10px 5px 27px",
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 10, color: C.textDim }}>
                  {fmtQty(eq.longQuantity, eq.shortQuantity)} @ {fmtCurrency(eq.averagePrice)}
                </span>
              </div>
              <span style={{ fontSize: 10, color: C.textMuted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmtCompact(eq.marketValue)}
              </span>
              <span style={{ fontSize: 10, color: plColor(eq.longOpenProfitLoss), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {eq.averagePrice > 0 ? fmtPct((eq.longOpenProfitLoss / (eq.averagePrice * (eq.shortQuantity > 0 ? eq.shortQuantity : eq.longQuantity))) * 100) : "—"}
              </span>
              <span style={{ fontSize: 10, color: plColor(eq.currentDayProfitLoss), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmtCurrency(eq.currentDayProfitLoss)}
              </span>
            </div>
          )}

          {group.options.map(opt => {
            const isShort = opt.shortQuantity > 0;
            const qty = isShort ? opt.shortQuantity : opt.longQuantity;
            const totalPL = opt.longOpenProfitLoss;
            const totalPLPctOpt = opt.averagePrice > 0 ? (totalPL / (opt.averagePrice * qty * 100)) * 100 : 0;
            const closeSide: "BUY" | "SELL" = isShort ? "BUY" : "SELL";

            return (
              <div
                key={opt.cusip}
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  alignItems: "center",
                  padding: "4px 10px 4px 27px",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: opt.putCall === "CALL" ? "#4ade80" : "#fb923c", width: 8, flexShrink: 0 }}>
                    {opt.putCall === "CALL" ? "C" : "P"}
                  </span>
                  <span style={{ fontSize: 10, color: C.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {formatOptionSymbol(opt.symbol, false)} ×{fmtQty(opt.longQuantity, opt.shortQuantity).replace("+", "")}
                  </span>
                </div>
                <span style={{ fontSize: 10, color: C.textMuted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmtCompact(opt.marketValue)}
                </span>
                <span style={{ fontSize: 10, color: plColor(totalPL), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmtPct(totalPLPctOpt)}
                </span>
                <span style={{ fontSize: 10, color: plColor(opt.currentDayProfitLoss), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmtCurrency(opt.currentDayProfitLoss)}
                </span>
              </div>
            );
          })}

          <div style={{ padding: "5px 10px 5px 27px", display: "flex", gap: 8 }}>
            <button
              onClick={() => onSelect(group.underlying)}
              style={{ fontSize: 10, fontWeight: 600, fontFamily: f, color: C.gold, background: "transparent", border: "none", cursor: "pointer", padding: 0, letterSpacing: 0.5, textTransform: "uppercase" }}
            >
              CHART →
            </button>
            {onTrade && eq && (
              <button
                onClick={() => onTrade(group.underlying, eqIsShort ? "BUY" : "SELL")}
                style={{ fontSize: 10, fontWeight: 600, fontFamily: f, color: C.gold, background: "transparent", border: "none", cursor: "pointer", padding: 0, letterSpacing: 0.5, textTransform: "uppercase" }}
              >
                TRADE
              </button>
            )}
            {onTrade && hasOptions && group.options.map(opt => {
              const isShort = opt.shortQuantity > 0;
              return (
                <button
                  key={opt.cusip}
                  onClick={() => onTrade(opt.underlyingSymbol, isShort ? "BUY" : "SELL", opt.symbol, isShort ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE")}
                  style={{ fontSize: 10, fontWeight: 600, fontFamily: f, color: C.textDim, background: "transparent", border: "none", cursor: "pointer", padding: 0, letterSpacing: 0.5, textTransform: "uppercase" }}
                >
                  CLOSE {opt.putCall === "CALL" ? "C" : "P"}
                </button>
              );
            })}
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
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: f,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#ffffff04")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, flex: 1, gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: isBuy ? C.green : C.red, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {primaryLeg?.instruction?.replace(/_/g, " ") ?? "—"}
            </span>
            {isMultiLeg && (
              <span style={{ fontSize: 10, color: C.textDim }}>+{order.legs.length - 1} leg{order.legs.length > 2 ? "s" : ""}</span>
            )}
          </div>
          <span style={{ fontSize: 11, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
            {displaySymbol}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: statusColor(order.status), textTransform: "uppercase", letterSpacing: 0.5 }}>
            {order.status}
          </span>
          <span style={{ fontSize: 10, color: C.dim }}>{timeAgo(order.enteredTime)}</span>
        </div>

        {isOpen && onCancel && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(order.orderId); }}
            style={{ marginLeft: 2, padding: 2, background: "transparent", border: "none", cursor: "pointer", color: C.red }}
          >
            <XCircle style={{ width: 12, height: 12 }} />
          </button>
        )}

        {expanded
          ? <ChevronDown style={{ color: C.dim, width: 10, height: 10, flexShrink: 0 }} />
          : <ChevronRight style={{ color: C.dim, width: 10, height: 10, flexShrink: 0 }} />}
      </button>

      {expanded && (
        <div style={{ padding: "6px 10px 8px 18px", borderTop: `1px solid ${C.border}`, background: "#0a0a0a" }}>
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
                <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                <div style={{ fontSize: 11, color: C.text }}>{value}</div>
              </div>
            ))}
          </div>

          {order.legs.length > 1 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Legs</div>
              {order.legs.map((leg, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 6, marginBottom: 1 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: leg.instruction?.includes("BUY") ? C.green : C.red }}>
                    {leg.instruction?.replace(/_/g, " ")}
                  </span>
                  <span style={{ fontSize: 10, color: C.textDim }}>
                    {leg.quantity}× {leg.assetType === "OPTION" ? formatOptionSymbol(leg.symbol) : leg.symbol}
                  </span>
                </div>
              ))}
            </div>
          )}

          {order.fills.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Fills</div>
              {order.fills.map((fill, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 6, marginBottom: 1 }}>
                  <span style={{ fontSize: 10, color: C.textDim, fontVariantNumeric: "tabular-nums" }}>{fill.quantity}× @ {fmtCurrency(fill.price)}</span>
                  <span style={{ fontSize: 10, color: C.dim }}>{timeAgo(fill.time)}</span>
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

  const grossMarketValue = useMemo(() => symbolGroups.reduce((s, g) => s + Math.abs(g.totalMarketValue), 0), [symbolGroups]);
  const totalDayPLPositions = useMemo(() => symbolGroups.reduce((s, g) => s + g.totalDayPL, 0), [symbolGroups]);
  const bestPerformer = useMemo(() => symbolGroups.length > 0 ? symbolGroups.reduce((best, g) => g.totalDayPL > best.totalDayPL ? g : best, symbolGroups[0]) : null, [symbolGroups]);
  const worstPerformer = useMemo(() => symbolGroups.length > 0 ? symbolGroups.reduce((worst, g) => g.totalDayPL < worst.totalDayPL ? g : worst, symbolGroups[0]) : null, [symbolGroups]);

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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32, minHeight: "60vh", fontFamily: f }}>
        <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 1.5, textTransform: "uppercase" }}>CONNECT SCHWAB TO VIEW PORTFOLIO</div>
      </div>
    );
  }

  if (loading && !account) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 32, minHeight: "60vh", fontFamily: f }}>
        <RefreshCw className="animate-spin" style={{ width: 16, height: 16, color: C.gold }} />
        <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 1, textTransform: "uppercase" }}>LOADING PORTFOLIO</div>
      </div>
    );
  }

  if (error && !account) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 32, minHeight: "60vh", fontFamily: f }}>
        <div style={{ fontSize: 11, color: `${C.red}cc` }}>{error}</div>
        <button onClick={() => fetchAccount()} style={{ fontSize: 10, color: C.gold, background: "transparent", border: "none", cursor: "pointer", letterSpacing: 1, fontFamily: f, textTransform: "uppercase" }}>
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
  const marginPct = marginTotal > 0 ? (marginUsed / marginTotal) * 100 : 0;
  const prevDayValue = (bal?.liquidationValue ?? 0) - dayPL;
  const dayReturnPct = prevDayValue > 0 ? (dayPL / prevDayValue) * 100 : 0;
  const dayTradesLeft = account ? (account.isDayTrader ? null : Math.max(0, 3 - account.roundTrips)) : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, fontFamily: f }}>
      <div style={{ borderBottom: `1px solid ${C.borderHi}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.5 }}>
              ····{(account?.accountNumber ?? "").slice(-4)}
            </span>
            <span style={{ fontSize: 10, color: C.dim }}>·</span>
            <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase" }}>{account?.type ?? ""}</span>
            <span style={{ width: 5, height: 5, borderRadius: 3, background: C.green, display: "inline-block" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {lastRefresh && <span style={{ fontSize: 10, color: C.dim }}>{timeAgo(lastRefresh.toISOString())}</span>}
            <button
              onClick={() => { fetchAccount(); fetchOrders(); }}
              disabled={loading}
              style={{ padding: 3, background: "transparent", border: "none", cursor: "pointer" }}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} style={{ width: 12, height: 12, color: C.dim }} />
            </button>
          </div>
        </div>

        <div style={{ padding: "4px 10px 6px" }}>
          <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>Net Liquidating Value</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: C.text, fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>
              {fmtCurrency(bal?.liquidationValue ?? 0)}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: plColor(dayPL), fontVariantNumeric: "tabular-nums" }}>
              {dayPL >= 0 ? "+" : ""}{fmtCurrency(dayPL)}
            </span>
            <span style={{ fontSize: 10, color: plColor(dayPL), fontVariantNumeric: "tabular-nums" }}>
              ({dayReturnPct >= 0 ? "+" : ""}{dayReturnPct.toFixed(2)}%)
            </span>
          </div>
        </div>

        {isMarginCall && (
          <div style={{ margin: "0 10px 6px", padding: "5px 8px", background: `${C.red}12`, borderLeft: `2px solid ${C.red}`, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle style={{ color: C.red, width: 12, height: 12, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: 1 }}>
              MARGIN CALL — IMMEDIATE ACTION REQUIRED
            </span>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: dayTradesLeft !== null ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr", padding: "0 10px 8px", gap: 0 }}>
          {[
            ["P/L Open", fmtCurrency(totalPL), plColor(totalPL)],
            ["Buying Pwr", fmtCurrency(bal?.buyingPower ?? 0), (bal?.buyingPower ?? 0) < 0 ? C.red : C.text],
            ["Margin", `${marginPct.toFixed(0)}%`, marginPct > 80 ? C.red : marginPct > 50 ? C.gold : C.text],
            ...(dayTradesLeft !== null ? [["Day Trades", `${dayTradesLeft} left`, dayTradesLeft === 0 ? C.red : dayTradesLeft === 1 ? C.gold : C.text]] : []),
          ].map(([label, value, color]) => (
            <div key={label as string} style={{ padding: "4px 0" }}>
              <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 1 }}>{label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: color as string, fontVariantNumeric: "tabular-nums" }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", borderTop: `1px solid ${C.borderHi}` }}>
          {(["positions", "orders", "balance"] as SubTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              style={{
                flex: 1,
                padding: "7px 0",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                fontFamily: f,
                color: subTab === tab ? C.gold : C.dim,
                background: "transparent",
                border: "none",
                borderBottom: subTab === tab ? `2px solid ${C.gold}` : "2px solid transparent",
                cursor: "pointer",
              }}
            >
              {tab === "balance" ? "balances" : tab}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {subTab === "positions" && (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                padding: "5px 10px",
                borderBottom: `1px solid ${C.borderHi}`,
                background: "#0e0e0e",
                position: "sticky",
                top: 0,
                zIndex: 1,
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 1 }}>Symbol</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.8, textAlign: "right" }}>Mkt Val</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.8, textAlign: "right" }}>P/L %</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.8, textAlign: "right" }}>P/L Day</span>
            </div>

            {symbolGroups.map(group => (
              <PositionTableRow key={group.underlying} group={group} onSelect={handleSelectSymbol} onTrade={onTrade} />
            ))}

            {symbolGroups.length > 0 && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    padding: "6px 10px",
                    borderTop: `2px solid ${C.borderHi}`,
                    borderBottom: `1px solid ${C.border}`,
                    background: "#0e0e0e",
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 0.5 }}>TOTAL</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.text, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtCompact(totalMarketValue)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: plColor(totalUnrealized), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtPct(unrealizedPct)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: plColor(totalDayPLPositions), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtCurrency(totalDayPLPositions)}
                  </span>
                </div>

                <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
                  {[
                    ["P/L Day:", totalDayPLPositions],
                    ["P/L Open:", totalUnrealized],
                    ["Net Liq:", bal?.liquidationValue ?? 0],
                  ].map(([label, val]) => (
                    <div key={label as string} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: C.textDim }}>{label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: typeof val === "number" && label !== "Net Liq:" ? plColor(val as number) : C.text, fontVariantNumeric: "tabular-nums" }}>
                        {fmtCurrency(val as number)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {symbolGroups.length === 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
                <div style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>No open positions</div>
              </div>
            )}
          </div>
        )}

        {subTab === "orders" && (
          <div>
            <div style={{ padding: "6px 10px", display: "flex", flexDirection: "column", gap: 6, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", gap: 0 }}>
                {ORDER_FILTERS.map((fil) => (
                  <button
                    key={fil.value}
                    onClick={() => setOrderFilter(fil.value)}
                    style={{
                      padding: "4px 8px",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: 0.8,
                      fontFamily: f,
                      textTransform: "uppercase",
                      cursor: "pointer",
                      color: orderFilter === fil.value ? C.gold : C.dim,
                      background: "transparent",
                      border: "none",
                      borderBottom: orderFilter === fil.value ? `1px solid ${C.gold}` : "1px solid transparent",
                    }}
                  >
                    {fil.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <Search style={{ width: 12, height: 12, marginLeft: 8, color: C.dim, flexShrink: 0 }} />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search orders..."
                  style={{ flex: 1, padding: "5px 6px", fontSize: 10, fontFamily: f, background: "transparent", border: "none", outline: "none", color: C.text }}
                />
                {orderSearch && (
                  <button onClick={() => setOrderSearch("")} style={{ paddingRight: 6, background: "transparent", border: "none", cursor: "pointer", color: C.dim }}>
                    <XCircle style={{ width: 10, height: 10 }} />
                  </button>
                )}
              </div>
            </div>

            {ordersLoading && orders.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
                <RefreshCw className="animate-spin" style={{ width: 14, height: 14, color: C.gold }} />
                <div style={{ fontSize: 10, color: C.textDim, letterSpacing: 1, textTransform: "uppercase" }}>Loading orders</div>
              </div>
            ) : ordersError ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
                <div style={{ fontSize: 10, color: `${C.red}cc` }}>Failed to load orders</div>
                <button onClick={fetchOrders} style={{ fontSize: 10, color: C.gold, background: "transparent", border: "none", cursor: "pointer", letterSpacing: 1, fontFamily: f, textTransform: "uppercase" }}>
                  RETRY
                </button>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 6 }}>
                <div style={{ fontSize: 11, color: C.textDim }}>{orderFilter === "ALL" && !orderSearch ? "No recent orders" : "No matching orders"}</div>
              </div>
            ) : (
              <>
                <div style={{ padding: "4px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.border}`, background: "#0e0e0e" }}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>
                    {orderFilter === "ALL" ? "All" : orderFilter} Orders
                  </span>
                  <span style={{ fontSize: 10, color: C.dim }}>{filteredOrders.length}</span>
                </div>
                {filteredOrders.map((order) => (
                  <OrderRow key={order.orderId} order={order} onCancel={handleCancelOrder} />
                ))}
              </>
            )}
          </div>
        )}

        {subTab === "balance" && bal && (
          <div>
            <div style={{ padding: "6px 10px", borderBottom: `1px solid ${C.borderHi}`, background: "#0e0e0e" }}>
              <span style={{ fontSize: 9, fontWeight: 600, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>Account Summary</span>
            </div>

            {[
              ["Net Liquidating Value", fmtCurrency(bal.liquidationValue), C.text],
              ...(dayTradesLeft !== null ? [["Day Trades Left", String(dayTradesLeft), dayTradesLeft === 0 ? C.red : C.text]] : []),
              ["Stock Buying Power", fmtCurrency(bal.buyingPower), (bal.buyingPower) < 0 ? C.red : C.text],
              ["Option Buying Power", fmtCurrency(bal.availableFunds), bal.availableFunds < 0 ? C.red : C.text],
              ["Available Funds For Trading", fmtCurrency(bal.availableFunds), bal.availableFunds < 0 ? C.red : C.text],
              ["Cash & Sweep Vehicle", fmtCurrency(bal.cashBalance), bal.cashBalance < 0 ? C.red : C.text],
              ["Cash Balance", fmtCurrency(bal.cashBalance), undefined],
              ["Equity Percentage", `${marginTotal > 0 ? ((bal.equity / (bal.longMarketValue || 1)) * 100).toFixed(2) : "0.00"}%`, undefined],
              ["Long Marginable Value", fmtCurrency(bal.longMarketValue), undefined],
              ["Long Stock Value", fmtCurrency(bal.longMarketValue), undefined],
              ["Maintenance Requirement", fmtCurrency(bal.maintenanceRequirement), undefined],
              ["Margin Balance", fmtCurrency(bal.marginBalance), bal.marginBalance < 0 ? C.red : undefined],
              ["Margin Equity", fmtCurrency(bal.equity), undefined],
              ["Money Market Balance", fmtCurrency(bal.moneyMarketFund), undefined],
              ["Short Balance", fmtCurrency(bal.shortMarketValue), undefined],
              ["Short Marginable Value", fmtCurrency(bal.shortOptionMarketValue), undefined],
              ["SMA", fmtCurrency(bal.sma), undefined],
            ].map(([label, value, color]) => (
              <div
                key={label as string}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "7px 10px",
                  borderBottom: `1px solid ${C.border}`,
                  fontFamily: f,
                }}
              >
                <span style={{ fontSize: 11, color: C.textMuted }}>{label}:</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: (color as string) ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
              </div>
            ))}

            {account && (
              <>
                <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.borderHi}`, background: "#0e0e0e", marginTop: 0 }}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>Risk & Market Values</span>
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
                  <div
                    key={label as string}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "7px 10px",
                      borderBottom: `1px solid ${C.border}`,
                      fontFamily: f,
                    }}
                  >
                    <span style={{ fontSize: 11, color: C.textMuted }}>{label}:</span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: (color as string) ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
