import { useState, useEffect, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  X, RefreshCw, DollarSign, TrendingUp, TrendingDown,
  Wallet, ShieldCheck, ArrowUpDown, Clock, AlertTriangle,
  Briefcase, BarChart3, Activity, Landmark
} from "lucide-react";

const API_BASE = "/api";

interface Position {
  symbol: string;
  description: string | null;
  assetType: string | null;
  quantity: number;
  isLong: boolean;
  averagePrice: number | null;
  currentDayProfitLoss: number | null;
  currentDayProfitLossPercentage: number | null;
  marketValue: number | null;
  maintenanceRequirement: number | null;
}

interface Balances {
  liquidationValue: number | null;
  cashBalance: number | null;
  availableFunds: number | null;
  buyingPower: number | null;
  equity: number | null;
  longMarketValue: number | null;
  shortMarketValue: number | null;
  marginBalance: number | null;
  maintenanceRequirement: number | null;
  moneyMarketFund: number | null;
  cashAvailableForTrading: number | null;
  cashAvailableForWithdrawal: number | null;
  dayTradingBuyingPower: number | null;
  accountValue: number | null;
}

interface Account {
  accountNumber: string;
  type: string;
  isClosingOnlyRestricted: boolean;
  isDayTrader: boolean;
  roundTrips: number;
  balances: Balances;
  projectedBalances: {
    availableFunds: number | null;
    buyingPower: number | null;
    dayTradingBuyingPower: number | null;
    cashAvailableForWithdrawal: number | null;
  };
  positions: Position[];
}

interface Transaction {
  transactionId: string | null;
  type: string | null;
  description: string | null;
  date: string | null;
  settlementDate: string | null;
  netAmount: number | null;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  instruction: string | null;
}

interface Order {
  orderId: string | null;
  status: string | null;
  enteredTime: string | null;
  closedTime: string | null;
  orderType: string | null;
  instruction: string | null;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  filledQuantity: number | null;
  remainingQuantity: number | null;
  duration: string | null;
  session: string | null;
}

type Tab = "overview" | "positions" | "orders" | "transactions";

function fmtCurrency(val: number | null | undefined): string {
  if (val == null) return "\u2014";
  const prefix = val < 0 ? "-$" : "$";
  return `${prefix}${Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateTime(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  try {
    return new Date(dateStr).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

function PnlValue({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">{"\u2014"}</span>;
  const color = value > 0 ? "#00d166" : value < 0 ? "#f23645" : "#6B7280";
  return <span style={{ color }} className="tabular-nums">{fmtCurrency(value)}</span>;
}

function PnlPct({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">{"\u2014"}</span>;
  const color = value > 0 ? "#00d166" : value < 0 ? "#f23645" : "#6B7280";
  const sign = value > 0 ? "+" : "";
  return <span style={{ color }} className="tabular-nums">{sign}{value.toFixed(2)}%</span>;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">{"\u2014"}</span>;
  const colors: Record<string, string> = {
    FILLED: "#00d166", WORKING: "#FFB800", PENDING_ACTIVATION: "#FFB800",
    CANCELED: "#6B7280", REJECTED: "#f23645", EXPIRED: "#6B7280",
  };
  const c = colors[status] ?? "#6B7280";
  return (
    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider"
      style={{ color: c, backgroundColor: `${c}15`, border: `1px solid ${c}30` }}>
      {status}
    </span>
  );
}

function MetricCard({ label, value, icon: Icon, sub }: {
  label: string; value: string; icon: typeof DollarSign; sub?: string;
}) {
  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3 text-primary/60" />
        <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">{label}</span>
      </div>
      <span className="font-mono text-sm text-foreground font-bold tabular-nums">{value}</span>
      {sub && <span className="font-mono text-[9px] text-muted-foreground/60">{sub}</span>}
    </div>
  );
}

function SectionHeader({ title, icon: Icon }: { title: string; icon: typeof Briefcase }) {
  return (
    <div className="flex items-center gap-2 mb-3 pt-1">
      <Icon className="w-3.5 h-3.5 text-primary" />
      <span className="font-mono text-[10px] text-primary uppercase tracking-[0.15em] font-bold">{title}</span>
      <div className="flex-1 h-px bg-[#1e1e1e]" />
    </div>
  );
}

function ThCell({ children }: { children: string }) {
  return (
    <th className="text-left font-mono text-[9px] text-muted-foreground uppercase tracking-widest py-2 px-3 whitespace-nowrap">
      {children}
    </th>
  );
}

function TdCell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-2.5 px-3 font-mono text-xs tabular-nums ${className}`}>{children}</td>;
}

export function AccountInfo({ onClose }: { onClose: () => void }) {
  const { traderAccessToken, accessToken, setSymbol } = useTerminalStore();
  const token = traderAccessToken || accessToken;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!token) {
      setError("Connect Schwab to view account information");
      setLoading(false);
      return;
    }
    setRefreshing(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [acctRes, txRes, orderRes] = await Promise.allSettled([
        fetch(`${API_BASE}/account/summary`, { headers }),
        fetch(`${API_BASE}/account/transactions`, { headers }),
        fetch(`${API_BASE}/account/orders`, { headers }),
      ]);

      let acctOk = false;
      if (acctRes.status === "fulfilled" && acctRes.value.ok) {
        const data = await acctRes.value.json();
        setAccounts(data.accounts ?? []);
        acctOk = true;
      } else if (acctRes.status === "fulfilled") {
        const errData = await acctRes.value.json().catch(() => ({}));
        if ((errData as any)?.error === "unauthorized") {
          setError("Session expired \u2014 reconnect Schwab");
        } else {
          setError("Failed to load account data");
        }
      } else {
        setError("Network error \u2014 could not reach server");
      }

      if (txRes.status === "fulfilled" && txRes.value.ok) {
        const data = await txRes.value.json();
        setTransactions(data.transactions ?? []);
      }
      if (orderRes.status === "fulfilled" && orderRes.value.ok) {
        const data = await orderRes.value.json();
        setOrders(data.orders ?? []);
      }

      if (acctOk) setLastRefresh(new Date());
    } catch {
      setError("Failed to fetch account data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const acct = accounts[0] ?? null;
  const bal = acct?.balances;
  const totalPnl = acct?.positions?.reduce((s, p) => s + (p.currentDayProfitLoss ?? 0), 0) ?? null;
  const totalMktVal = acct?.positions?.reduce((s, p) => s + (p.marketValue ?? 0), 0) ?? null;

  const tabs: { key: Tab; label: string; icon: typeof Briefcase }[] = [
    { key: "overview", label: "OVERVIEW", icon: BarChart3 },
    { key: "positions", label: "POSITIONS", icon: Briefcase },
    { key: "orders", label: "ORDERS", icon: ArrowUpDown },
    { key: "transactions", label: "ACTIVITY", icon: Clock },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1e1e1e] bg-[#0a0a0a] rounded-t-xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
              <Landmark className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-mono text-sm font-bold text-foreground tracking-wider">ACCOUNT INFORMATION</h2>
              <div className="flex items-center gap-2">
                {acct && <span className="font-mono text-[9px] text-muted-foreground tracking-wider">{acct.type} {"\u2022\u2022"}{acct.accountNumber.slice(-4)}</span>}
                {lastRefresh && <span className="font-mono text-[9px] text-muted-foreground/40">Updated {lastRefresh.toLocaleTimeString()}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void fetchData()} disabled={refreshing}
              className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[#1e1e1e] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-0 px-4 pt-2 border-b border-[#1e1e1e] shrink-0 bg-[#0a0a0a]">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 font-mono text-[10px] tracking-wider transition-all border-b-2 ${
                tab === t.key ? "text-primary border-primary" : "text-muted-foreground border-transparent hover:text-foreground hover:border-[#333]"
              }`}>
              <t.icon className="w-3 h-3" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && !acct ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="w-5 h-5 animate-spin text-primary mr-3" />
              <span className="font-mono text-xs text-muted-foreground tracking-wider">LOADING ACCOUNT DATA...</span>
            </div>
          ) : error && !acct ? (
            <div className="flex items-center justify-center h-48">
              <AlertTriangle className="w-5 h-5 text-[#f23645] mr-3" />
              <span className="font-mono text-xs text-muted-foreground tracking-wider">{error.toUpperCase()}</span>
            </div>
          ) : tab === "overview" ? (
            <OverviewTab acct={acct} bal={bal ?? null} totalPnl={totalPnl} totalMktVal={totalMktVal} />
          ) : tab === "positions" ? (
            <PositionsTab positions={acct?.positions ?? []} onSymbolClick={(sym) => { setSymbol(sym); onClose(); }} />
          ) : tab === "orders" ? (
            <OrdersTab orders={orders} />
          ) : (
            <TransactionsTab transactions={transactions} />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ acct, bal, totalPnl, totalMktVal }: {
  acct: Account | null; bal: Balances | null; totalPnl: number | null; totalMktVal: number | null;
}) {
  if (!acct || !bal) return null;
  return (
    <div className="space-y-5">
      <SectionHeader title="Account Summary" icon={Wallet} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Account Value" value={fmtCurrency(bal.accountValue)} icon={DollarSign} />
        <MetricCard label="Buying Power" value={fmtCurrency(bal.buyingPower)} icon={TrendingUp} />
        <MetricCard label="Cash Balance" value={fmtCurrency(bal.cashBalance)} icon={Wallet} />
        <MetricCard label="Day P&L" value={fmtCurrency(totalPnl)} icon={totalPnl && totalPnl >= 0 ? TrendingUp : TrendingDown} />
      </div>
      <SectionHeader title="Equity & Margin" icon={ShieldCheck} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Equity" value={fmtCurrency(bal.equity)} icon={BarChart3} />
        <MetricCard label="Long Mkt Value" value={fmtCurrency(bal.longMarketValue)} icon={TrendingUp} />
        <MetricCard label="Short Mkt Value" value={fmtCurrency(bal.shortMarketValue)} icon={TrendingDown} />
        <MetricCard label="Margin Balance" value={fmtCurrency(bal.marginBalance)} icon={Landmark} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Maintenance Req" value={fmtCurrency(bal.maintenanceRequirement)} icon={ShieldCheck} />
        <MetricCard label="Cash for Trading" value={fmtCurrency(bal.cashAvailableForTrading)} icon={DollarSign} />
        <MetricCard label="Cash for Withdrawal" value={fmtCurrency(bal.cashAvailableForWithdrawal)} icon={Wallet} />
        <MetricCard label="DT Buying Power" value={fmtCurrency(bal.dayTradingBuyingPower)} icon={Activity} />
      </div>
      <SectionHeader title="Account Details" icon={Briefcase} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Account Type" value={acct.type} icon={Briefcase} />
        <MetricCard label="Day Trader" value={acct.isDayTrader ? "YES" : "NO"} icon={Activity} sub={`${acct.roundTrips} round trips`} />
        <MetricCard label="Positions" value={String(acct.positions.length)} icon={BarChart3} />
        <MetricCard label="Portfolio Value" value={fmtCurrency(totalMktVal)} icon={DollarSign} />
      </div>
    </div>
  );
}

function PositionsTab({ positions, onSymbolClick }: { positions: Position[]; onSymbolClick: (sym: string) => void }) {
  if (positions.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <span className="font-mono text-xs tracking-wider">NO OPEN POSITIONS</span>
      </div>
    );
  }
  return (
    <div>
      <SectionHeader title={`Open Positions (${positions.length})`} icon={Briefcase} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e1e1e]">
              <ThCell>Symbol</ThCell><ThCell>Type</ThCell><ThCell>Qty</ThCell><ThCell>Avg Price</ThCell>
              <ThCell>Mkt Value</ThCell><ThCell>Day P&L</ThCell><ThCell>Day %</ThCell><ThCell>Maint Req</ThCell>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                <TdCell>
                  <button onClick={() => p.assetType === "EQUITY" && onSymbolClick(p.symbol)}
                    className={`font-bold tracking-wider ${p.assetType === "EQUITY" ? "text-primary hover:underline cursor-pointer" : "text-foreground"}`}>
                    {p.symbol}
                  </button>
                  {p.description && <div className="text-[9px] text-muted-foreground/50 truncate max-w-[200px]">{p.description}</div>}
                </TdCell>
                <TdCell className="text-[10px] text-muted-foreground">{p.assetType ?? "\u2014"}</TdCell>
                <TdCell className="text-foreground">{p.isLong ? "" : "-"}{p.quantity}</TdCell>
                <TdCell className="text-foreground">{fmtCurrency(p.averagePrice)}</TdCell>
                <TdCell className="text-foreground">{fmtCurrency(p.marketValue)}</TdCell>
                <TdCell><PnlValue value={p.currentDayProfitLoss} /></TdCell>
                <TdCell><PnlPct value={p.currentDayProfitLossPercentage} /></TdCell>
                <TdCell className="text-muted-foreground">{fmtCurrency(p.maintenanceRequirement)}</TdCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrdersTab({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <span className="font-mono text-xs tracking-wider">NO RECENT ORDERS</span>
      </div>
    );
  }
  return (
    <div>
      <SectionHeader title={`Recent Orders (${orders.length})`} icon={ArrowUpDown} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e1e1e]">
              <ThCell>Symbol</ThCell><ThCell>Side</ThCell><ThCell>Type</ThCell><ThCell>Qty</ThCell>
              <ThCell>Price</ThCell><ThCell>Filled</ThCell><ThCell>Status</ThCell><ThCell>Time</ThCell>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={i} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                <TdCell className="text-primary font-bold tracking-wider">{o.symbol ?? "\u2014"}</TdCell>
                <TdCell>
                  <span style={{ color: o.instruction === "BUY" ? "#00d166" : o.instruction === "SELL" ? "#f23645" : "#6B7280" }} className="font-bold">
                    {o.instruction ?? "\u2014"}
                  </span>
                </TdCell>
                <TdCell className="text-muted-foreground">{o.orderType ?? "\u2014"}</TdCell>
                <TdCell className="text-foreground">{o.quantity ?? "\u2014"}</TdCell>
                <TdCell className="text-foreground">{fmtCurrency(o.price)}</TdCell>
                <TdCell className="text-foreground">{o.filledQuantity ?? "\u2014"}</TdCell>
                <TdCell><StatusBadge status={o.status} /></TdCell>
                <TdCell className="text-muted-foreground text-[10px]">{fmtDateTime(o.enteredTime)}</TdCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionsTab({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <span className="font-mono text-xs tracking-wider">NO RECENT TRANSACTIONS</span>
      </div>
    );
  }
  return (
    <div>
      <SectionHeader title={`Recent Activity (${transactions.length})`} icon={Clock} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e1e1e]">
              <ThCell>Date</ThCell><ThCell>Type</ThCell><ThCell>Symbol</ThCell><ThCell>Side</ThCell>
              <ThCell>Qty</ThCell><ThCell>Price</ThCell><ThCell>Net Amount</ThCell><ThCell>Settlement</ThCell>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx, i) => (
              <tr key={i} className="border-b border-[#111] hover:bg-[#111] transition-colors">
                <TdCell className="text-muted-foreground text-[10px]">{fmtDateTime(tx.date)}</TdCell>
                <TdCell className="text-muted-foreground text-[10px]">{tx.type ?? "\u2014"}</TdCell>
                <TdCell className="text-primary font-bold tracking-wider">{tx.symbol ?? "\u2014"}</TdCell>
                <TdCell>
                  <span style={{ color: tx.instruction === "BUY" ? "#00d166" : tx.instruction === "SELL" ? "#f23645" : "#6B7280" }}>
                    {tx.instruction ?? "\u2014"}
                  </span>
                </TdCell>
                <TdCell className="text-foreground">{tx.quantity ?? "\u2014"}</TdCell>
                <TdCell className="text-foreground">{fmtCurrency(tx.price)}</TdCell>
                <TdCell><PnlValue value={tx.netAmount} /></TdCell>
                <TdCell className="text-muted-foreground text-[10px]">{fmtDateTime(tx.settlementDate)}</TdCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
