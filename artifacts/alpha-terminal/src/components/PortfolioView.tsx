import { useState, useEffect, useCallback, useMemo } from "react";
import { useTerminalStore } from "@/lib/store";
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
} from "lucide-react";

const GOLD = "#FFB800";
const UP = "#00d166";
const DOWN = "#f23645";
const MUTED = "#6b7280";
const CARD_BG = "#0c0c0c";
const CARD_BORDER = "#2a2a2e";
const DIM = "#52525b";
const TEXT = "#e4e4e7";

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
  if (n > 0) return UP;
  if (n < 0) return DOWN;
  return MUTED;
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

function formatOptionSymbol(sym: string): string {
  const match = sym.trim().match(/^(\w+)\s+(\d{6})([CP])(\d{8})$/);
  if (!match) return sym.trim();
  const [, underlying, dateStr, pc, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;
  const mm = dateStr.slice(0, 2);
  const dd = dateStr.slice(2, 4);
  const yy = dateStr.slice(4, 6);
  return `${underlying} ${mm}/${dd}/${yy} $${strike} ${pc === "C" ? "Call" : "Put"}`;
}

function statusColor(status: string): string {
  switch (status) {
    case "FILLED": return UP;
    case "CANCELED": case "REJECTED": case "EXPIRED": return DOWN;
    case "WORKING": case "PENDING_ACTIVATION": return GOLD;
    default: return MUTED;
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className="text-[9px] font-light uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color: statusColor(status), background: `${statusColor(status)}10` }}
    >
      {status}
    </span>
  );
}

function PositionRow({ pos, onSelect, onTrade }: { pos: Position; onSelect: (sym: string) => void; onTrade?: (sym: string, side: "BUY" | "SELL", optionSymbol?: string, optionInstruction?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isOption = pos.assetType === "OPTION";
  const isShort = pos.shortQuantity > 0;
  const qty = isShort ? pos.shortQuantity : pos.longQuantity;
  const displaySymbol = isOption ? pos.underlyingSymbol : pos.symbol;
  const displayLabel = isOption ? formatOptionSymbol(pos.symbol) : pos.symbol;
  const closeSide: "BUY" | "SELL" = isShort ? "BUY" : "SELL";
  const totalPL = pos.longOpenProfitLoss;
  const totalPLPct = pos.averagePrice > 0 ? (totalPL / (pos.averagePrice * qty * (isOption ? 100 : 1))) * 100 : 0;
  const portfolioPct = 0;

  return (
    <div className="border-b" style={{ borderColor: CARD_BORDER }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isOption ? (
            <span className="text-[9px] font-light px-1 py-0.5 rounded shrink-0" style={{ color: pos.putCall === "CALL" ? UP : DOWN }}>
              {pos.putCall === "CALL" ? "C" : "P"}
            </span>
          ) : (
            <span className="text-[9px] font-light px-1 py-0.5 rounded shrink-0" style={{ color: UP }}>EQ</span>
          )}
          <div className="flex flex-col items-start min-w-0">
            <span className="font-mono text-[11px] font-light text-white truncate max-w-[130px]">{displayLabel}</span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[9px] text-zinc-500">{fmtQty(pos.longQuantity, pos.shortQuantity)} @ {fmtCurrency(pos.averagePrice)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className="font-mono text-[11px] font-light text-white tabular-nums">{fmtCurrency(pos.marketValue)}</span>
          <div className="flex items-center gap-0.5">
            {totalPL !== 0 ? (
              totalPL > 0 ? <ArrowUpRight className="w-2.5 h-2.5" style={{ color: UP }} /> : <ArrowDownRight className="w-2.5 h-2.5" style={{ color: DOWN }} />
            ) : (
              <Minus className="w-2.5 h-2.5" style={{ color: MUTED }} />
            )}
            <span className="font-mono text-[10px] tabular-nums" style={{ color: plColor(totalPL) }}>
              {fmtCurrency(totalPL)} ({fmtPct(totalPLPct)})
            </span>
          </div>
        </div>

        {onTrade && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isOption) {
                const instruction = isShort ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE";
                onTrade(pos.underlyingSymbol, closeSide, pos.symbol, instruction);
              } else {
                onTrade(displaySymbol, closeSide);
              }
            }}
            className="ml-1 px-2 py-1 rounded font-mono text-[9px] font-light tracking-wider shrink-0 transition-colors active:opacity-70"
            style={{ color: GOLD, background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.2)" }}
          >
            TRADE
          </button>
        )}

        {expanded ? (
          <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 ml-6" style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 pt-2">
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Qty</span>
              <p className="font-mono text-[11px] text-white tabular-nums">
                {fmtQty(pos.longQuantity, pos.shortQuantity)}
                {isOption && <span className="text-zinc-500 ml-1">({isShort ? "short" : "long"})</span>}
              </p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Avg Price</span>
              <p className="font-mono text-[11px] text-white tabular-nums">{fmtCurrency(pos.averagePrice)}</p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Day P&L</span>
              <p className="font-mono text-[11px] tabular-nums" style={{ color: plColor(pos.currentDayProfitLoss) }}>
                {fmtCurrency(pos.currentDayProfitLoss)}
              </p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Total P&L</span>
              <p className="font-mono text-[11px] tabular-nums" style={{ color: plColor(totalPL) }}>
                {fmtCurrency(totalPL)}
              </p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">% Return</span>
              <p className="font-mono text-[11px] tabular-nums" style={{ color: plColor(totalPLPct) }}>{fmtPct(totalPLPct)}</p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Maint. Req</span>
              <p className="font-mono text-[11px] text-white tabular-nums">{fmtCurrency(pos.maintenanceRequirement)}</p>
            </div>
          </div>
          <div className="pt-1 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(displaySymbol); }}
              className="text-[9px] font-mono font-light uppercase tracking-widest py-1 px-2 rounded transition-colors hover:bg-white/5 cursor-pointer"
              style={{ color: GOLD }}
            >
              View {displaySymbol} →
            </button>
          </div>
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
    <div className="border-b" style={{ borderColor: CARD_BORDER }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03] transition-colors cursor-pointer"
      >
        <div className="flex flex-col items-start min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-light px-1 py-0.5 rounded shrink-0" style={{ color: isBuy ? UP : DOWN }}>
              {primaryLeg?.instruction?.replace(/_/g, " ") ?? "—"}
            </span>
            {isMultiLeg && (
              <span className="text-[9px] font-mono text-zinc-500">+{order.legs.length - 1} leg{order.legs.length > 2 ? "s" : ""}</span>
            )}
          </div>
          <span className="font-mono text-[10px] font-light text-white truncate max-w-[180px]">{displaySymbol}</span>
        </div>

        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <StatusBadge status={order.status} />
          <span className="font-mono text-[9px] text-zinc-500">{timeAgo(order.enteredTime)}</span>
        </div>

        {isOpen && onCancel && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(order.orderId); }}
            className="ml-1 p-1 rounded transition-colors active:opacity-70"
            style={{ color: DOWN }}
            title="Cancel order"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        )}

        {expanded ? (
          <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-zinc-500 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 ml-2" style={{ borderTop: `1px solid ${CARD_BORDER}` }}>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 pt-2">
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Type</span>
              <p className="font-mono text-[11px] text-white">{order.orderType.replace(/_/g, " ")}</p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Price</span>
              <p className="font-mono text-[11px] text-white tabular-nums">{order.price != null ? fmtCurrency(order.price) : "MKT"}</p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Filled</span>
              <p className="font-mono text-[11px] text-white tabular-nums">{order.filledQuantity} / {order.filledQuantity + order.remainingQuantity}</p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Duration</span>
              <p className="font-mono text-[11px] text-white">{order.duration}</p>
            </div>
            <div>
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Session</span>
              <p className="font-mono text-[11px] text-white">{order.session}</p>
            </div>
            {order.complexStrategy !== "NONE" && (
              <div>
                <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Strategy</span>
                <p className="font-mono text-[11px] text-white">{order.complexStrategy.replace(/_/g, " ")}</p>
              </div>
            )}
          </div>

          {order.legs.length > 1 && (
            <div className="space-y-1 pt-1">
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Legs</span>
              {order.legs.map((leg, i) => (
                <div key={i} className="flex items-center gap-2 pl-2">
                  <span className="text-[8px] font-light px-1 rounded" style={{ color: leg.instruction?.includes("BUY") ? UP : DOWN }}>
                    {leg.instruction?.replace(/_/g, " ")}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-300 truncate">
                    {leg.quantity}x {leg.assetType === "OPTION" ? formatOptionSymbol(leg.symbol) : leg.symbol}
                  </span>
                </div>
              ))}
            </div>
          )}

          {order.fills.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">Fills</span>
              {order.fills.map((f, i) => (
                <div key={i} className="flex items-center gap-2 pl-2">
                  <span className="font-mono text-[10px] text-zinc-300 tabular-nums">{f.quantity}x @ {fmtCurrency(f.price)}</span>
                  <span className="font-mono text-[9px] text-zinc-500">{timeAgo(f.time)}</span>
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
    <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: CARD_BORDER }}>
      <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">{label}</span>
      <span className="font-mono text-[11px] font-light tabular-nums" style={{ color: color ?? "#fff" }}>{value}</span>
    </div>
  );
}

function MarginBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const barColor = pct > 80 ? DOWN : pct > 50 ? GOLD : UP;
  return (
    <div className="rounded-xl p-3" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">Margin Utilization</span>
        <span className="font-mono text-[11px] font-light tabular-nums" style={{ color: barColor }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1a1a1e" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <div className="flex justify-between mt-1">
        <span className="font-mono text-[8px] text-zinc-600">{fmtCurrency(used)} used</span>
        <span className="font-mono text-[8px] text-zinc-600">{fmtCurrency(total)} total</span>
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

  const fetchAccount = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/portfolio/accounts");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.length > 0) setAccount(data[0]);
      setLastRefresh(new Date());
    } catch (err) {
      setError("Failed to load portfolio data");
    } finally {
      setLoading(false);
    }
  }, []);

  const [ordersError, setOrdersError] = useState(false);

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

  useEffect(() => {
    if (accessToken) {
      fetchAccount();
      fetchOrders();
      fetchWithAuth("/api/portfolio/account-hash")
        .then(r => r.json())
        .then(d => { if (d.hashValue) setAccountHash(d.hashValue); })
        .catch(() => {});
    }
  }, [accessToken, fetchAccount, fetchOrders]);

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

  const equityPositions = useMemo(
    () => (account?.positions ?? []).filter((p) => p.assetType === "EQUITY"),
    [account]
  );
  const optionPositions = useMemo(
    () => (account?.positions ?? []).filter((p) => p.assetType === "OPTION"),
    [account]
  );

  const totalUnrealized = useMemo(() => {
    return (account?.positions ?? []).reduce((sum, p) => sum + p.longOpenProfitLoss, 0);
  }, [account]);

  const totalMarketValue = useMemo(() => {
    return (account?.positions ?? []).reduce((sum, p) => sum + p.marketValue, 0);
  }, [account]);

  const unrealizedPct = totalMarketValue > 0 ? (totalUnrealized / (totalMarketValue - totalUnrealized)) * 100 : 0;

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
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 min-h-[60vh]">
        <Briefcase className="w-12 h-12 text-primary/30" />
        <p className="font-mono text-sm text-muted-foreground text-center">CONNECT SCHWAB TO VIEW PORTFOLIO</p>
      </div>
    );
  }

  if (loading && !account) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 min-h-[60vh]">
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
        <p className="font-mono text-xs text-zinc-500 tracking-wider">LOADING PORTFOLIO...</p>
      </div>
    );
  }

  if (error && !account) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 min-h-[60vh]">
        <AlertCircle className="w-8 h-8 text-red-500/50" />
        <p className="font-mono text-xs text-red-500/70">{error}</p>
        <button onClick={fetchAccount} className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded cursor-pointer hover:bg-white/5 transition-colors" style={{ color: GOLD }}>
          Retry
        </button>
      </div>
    );
  }

  const bal = account?.balances;
  const dayPL = account?.dayPL ?? 0;
  const totalPL = account?.totalPL ?? 0;
  const marginUsed = (bal?.maintenanceRequirement ?? 0);
  const marginTotal = (bal?.equity ?? 0);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 pt-3 pb-2 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4" style={{ color: GOLD }} />
            <span className="font-mono text-xs font-light text-white tracking-wider">PORTFOLIO</span>
          </div>
          <div className="flex items-center gap-2">
            {lastRefresh && (
              <span className="font-mono text-[9px] text-zinc-600">LAST UPDATED {timeAgo(lastRefresh.toISOString())}</span>
            )}
            <button onClick={() => { fetchAccount(); fetchOrders(); }} className="p-1.5 rounded hover:bg-white/5 transition-colors cursor-pointer" disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 text-zinc-500 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="rounded-xl p-3 space-y-2" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">Net Liquidation</span>
            <span className="font-mono text-[9px] text-zinc-600 uppercase">
              {account?.type ?? ""} · {account?.accountNumber ?? ""}
            </span>
          </div>
          <p className="font-mono text-2xl font-light text-white tabular-nums leading-tight">
            {fmtCurrency(bal?.liquidationValue ?? 0)}
          </p>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div>
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Day P&L</span>
              <p className="font-mono text-sm font-light tabular-nums" style={{ color: plColor(dayPL) }}>
                {dayPL >= 0 ? "+" : ""}{fmtCurrency(dayPL)}
              </p>
            </div>
            <div>
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Total P&L</span>
              <p className="font-mono text-sm font-light tabular-nums" style={{ color: plColor(totalPL) }}>
                {totalPL >= 0 ? "+" : ""}{fmtCurrency(totalPL)}
              </p>
            </div>
            <div>
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Buying Power</span>
              <p className="font-mono text-sm font-light text-white tabular-nums">
                {fmtCurrency(bal?.buyingPower ?? 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-0 rounded-lg overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
          {(["positions", "orders", "balance"] as SubTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              className="flex-1 py-2 font-mono text-[10px] font-light uppercase tracking-widest transition-colors cursor-pointer relative"
              style={{ color: subTab === tab ? GOLD : MUTED, background: "transparent" }}
            >
              {tab === "positions" && <BarChart3 className="w-3 h-3 mx-auto mb-0.5" />}
              {tab === "orders" && <Clock className="w-3 h-3 mx-auto mb-0.5" />}
              {tab === "balance" && <DollarSign className="w-3 h-3 mx-auto mb-0.5" />}
              {tab}
              {subTab === tab && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ background: GOLD }} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {subTab === "positions" && (
          <div>
            {(equityPositions.length > 0 || optionPositions.length > 0) && (
              <div className="px-3 py-2 flex items-center justify-between" style={{ background: CARD_BG, borderBottom: `1px solid ${CARD_BORDER}` }}>
                <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">Unrealized P&L</span>
                <span className="font-mono text-[12px] font-light tabular-nums" style={{ color: plColor(totalUnrealized) }}>
                  {totalUnrealized >= 0 ? "+" : ""}{fmtCurrency(totalUnrealized)} ({fmtPct(unrealizedPct)})
                </span>
              </div>
            )}

            {equityPositions.length > 0 && (
              <div>
                <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ background: CARD_BG }}>
                  <TrendingUp className="w-3 h-3" style={{ color: UP }} />
                  <span className="font-mono text-[9px] font-light uppercase tracking-widest" style={{ color: UP }}>Equities</span>
                  <span className="font-mono text-[9px] text-zinc-600 ml-auto">{equityPositions.length}</span>
                </div>
                {equityPositions.map((pos) => (
                  <PositionRow key={pos.cusip} pos={pos} onSelect={handleSelectSymbol} onTrade={onTrade} />
                ))}
              </div>
            )}

            {optionPositions.length > 0 && (
              <div>
                <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ background: CARD_BG }}>
                  <BarChart3 className="w-3 h-3" style={{ color: "#22d3ee" }} />
                  <span className="font-mono text-[9px] font-light uppercase tracking-widest" style={{ color: "#22d3ee" }}>Options</span>
                  <span className="font-mono text-[9px] text-zinc-600 ml-auto">{optionPositions.length}</span>
                </div>
                {optionPositions.map((pos) => (
                  <PositionRow key={pos.cusip} pos={pos} onSelect={handleSelectSymbol} onTrade={onTrade} />
                ))}
              </div>
            )}

            {equityPositions.length === 0 && optionPositions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Briefcase className="w-8 h-8 text-zinc-700" />
                <p className="font-mono text-xs text-zinc-600">No open positions</p>
              </div>
            )}
          </div>
        )}

        {subTab === "orders" && (
          <div>
            <div className="px-3 py-2 space-y-2" style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
              <div className="flex gap-1 overflow-x-auto">
                {ORDER_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setOrderFilter(f.value)}
                    className="px-2.5 py-1.5 rounded-lg font-mono text-[10px] font-light tracking-wider whitespace-nowrap transition-colors shrink-0"
                    style={{
                      color: orderFilter === f.value ? GOLD : DIM,
                      background: orderFilter === f.value ? "rgba(255,184,0,0.08)" : "transparent",
                      border: `1px solid ${orderFilter === f.value ? "rgba(255,184,0,0.25)" : "transparent"}`,
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center rounded-lg overflow-hidden" style={{ background: "#141416", border: `1px solid ${CARD_BORDER}` }}>
                <Search className="w-3.5 h-3.5 ml-2.5" style={{ color: DIM }} />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search orders..."
                  className="flex-1 px-2 py-1.5 font-mono text-[11px] bg-transparent outline-none text-white placeholder:text-zinc-600"
                />
                {orderSearch && (
                  <button onClick={() => setOrderSearch("")} className="pr-2" style={{ color: DIM }}>
                    <XCircle className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {ordersLoading && orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <RefreshCw className="w-5 h-5 animate-spin" style={{ color: GOLD }} />
                <p className="font-mono text-[10px] text-zinc-500 tracking-wider">LOADING ORDERS...</p>
              </div>
            ) : ordersError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <AlertCircle className="w-6 h-6 text-red-500/50" />
                <p className="font-mono text-xs text-red-500/70">Failed to load orders</p>
                <button onClick={fetchOrders} className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded cursor-pointer hover:bg-white/5 transition-colors" style={{ color: GOLD }}>
                  Retry
                </button>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Clock className="w-8 h-8 text-zinc-700" />
                <p className="font-mono text-xs text-zinc-600">{orderFilter === "ALL" && !orderSearch ? "No recent orders" : "No matching orders"}</p>
              </div>
            ) : (
              <>
                <div className="px-3 py-1.5 flex items-center gap-1.5" style={{ background: CARD_BG }}>
                  <Clock className="w-3 h-3" style={{ color: GOLD }} />
                  <span className="font-mono text-[9px] font-light uppercase tracking-widest" style={{ color: GOLD }}>
                    {orderFilter === "ALL" ? "All" : orderFilter} Orders
                  </span>
                  <span className="font-mono text-[9px] text-zinc-600 ml-auto">{filteredOrders.length}</span>
                </div>
                {filteredOrders.map((order) => (
                  <OrderRow key={order.orderId} order={order} onCancel={handleCancelOrder} />
                ))}
              </>
            )}
          </div>
        )}

        {subTab === "balance" && bal && (
          <div className="px-3 pb-4 space-y-3">
            <MarginBar used={marginUsed} total={marginTotal} />

            <div>
              <div className="py-1.5 flex items-center gap-1.5 mb-1">
                <DollarSign className="w-3 h-3" style={{ color: GOLD }} />
                <span className="font-mono text-[9px] font-light uppercase tracking-widest" style={{ color: GOLD }}>Account Details</span>
              </div>
              <div className="rounded-xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
                <div className="px-3">
                  <BalanceStat label="Equity" value={fmtCurrency(bal.equity)} />
                  <BalanceStat label="Cash Balance" value={fmtCurrency(bal.cashBalance)} />
                  <BalanceStat label="Available Funds" value={fmtCurrency(bal.availableFunds)} />
                  <BalanceStat label="Margin Balance" value={fmtCurrency(bal.marginBalance)} color={bal.marginBalance < 0 ? DOWN : undefined} />
                  <BalanceStat label="Buying Power" value={fmtCurrency(bal.buyingPower)} />
                  <BalanceStat label="DT Buying Power" value={fmtCurrency(bal.dayTradingBuyingPower)} />
                  <BalanceStat label="Maintenance Req" value={fmtCurrency(bal.maintenanceRequirement)} />
                  <BalanceStat label="SMA" value={fmtCurrency(bal.sma)} />
                </div>
              </div>
            </div>

            <div>
              <div className="py-1.5 flex items-center gap-1.5 mb-1">
                <BarChart3 className="w-3 h-3" style={{ color: GOLD }} />
                <span className="font-mono text-[9px] font-light uppercase tracking-widest" style={{ color: GOLD }}>Market Values</span>
              </div>
              <div className="rounded-xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
                <div className="px-3">
                  <BalanceStat label="Long Stock" value={fmtCurrency(bal.longMarketValue)} />
                  <BalanceStat label="Short Stock" value={fmtCurrency(bal.shortMarketValue)} />
                  <BalanceStat label="Long Options" value={fmtCurrency(bal.longOptionMarketValue)} />
                  <BalanceStat label="Short Options" value={fmtCurrency(bal.shortOptionMarketValue)} color={bal.shortOptionMarketValue < 0 ? DOWN : undefined} />
                  <BalanceStat label="Bond Value" value={fmtCurrency(bal.bondValue)} />
                  <BalanceStat label="Pending Deposits" value={fmtCurrency(bal.pendingDeposits)} />
                </div>
              </div>
            </div>

            {account && (
              <div>
                <div className="py-1.5 flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-3 h-3" style={{ color: GOLD }} />
                  <span className="font-mono text-[9px] font-light uppercase tracking-widest" style={{ color: GOLD }}>Risk Metrics</span>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
                  <div className="px-3">
                    <BalanceStat label="Account Type" value={account.type} />
                    <BalanceStat label="Day Trader" value={account.isDayTrader ? "YES" : "NO"} color={account.isDayTrader ? GOLD : undefined} />
                    <BalanceStat label="Round Trips" value={String(account.roundTrips)} color={account.roundTrips >= 3 ? DOWN : undefined} />
                    <BalanceStat label="Margin Usage" value={`${marginTotal > 0 ? ((marginUsed / marginTotal) * 100).toFixed(1) : "0"}%`} color={marginTotal > 0 && (marginUsed / marginTotal) > 0.8 ? DOWN : undefined} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
