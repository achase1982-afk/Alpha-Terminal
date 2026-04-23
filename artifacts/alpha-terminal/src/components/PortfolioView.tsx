import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import { useTerminalStore } from "@/lib/store";
import { useHeaderBottom } from "@/hooks/useHeaderBottom";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import { useBrokerConnect } from "@/hooks/useBrokerConnect";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Search,
  XCircle,
  AlertTriangle,
  Settings,
  X,
  Check,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { JournalTab } from "./JournalTab";
import type { OrderLeg } from "./OrderTicket";

const C = {
  bg: "#0c0c0c",
  card: "#18181b",
  border: "#27272a",
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

type SubTab = "positions" | "orders" | "balance" | "journal";
type OrderFilter = "ALL" | "WORKING" | "FILLED" | "CANCELED" | "REJECTED";
type MetricKey = "plOpen" | "buyingPower" | "margin" | "availableFunds" | "cashBalance" | "posEquity";
type ColumnKey =
  | "mark" | "last" | "cost" | "qty" | "mktVal" | "plOpen" | "plPct" | "plDay" | "maint"
  | "netLiq" | "markPctChg" | "markChg" | "plYtd" | "tradePrice" | "margin"
  | "delta" | "extrinsic" | "totalCost" | "todayClose" | "yesterdayClose"
  | "expiration" | "bwSpx" | "bwSpy" | "instrumentType" | "bpEffect" | "bwNdx";

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
  { key: "mark",           label: "Mark",           desc: "Current price per share / contract" },
  { key: "last",           label: "Last",           desc: "Last traded price" },
  { key: "plPct",          label: "P/L %",          desc: "Unrealized P/L as a percentage" },
  { key: "plDay",          label: "P/L Day",        desc: "Today's P/L in dollars" },
  { key: "plOpen",         label: "P/L Open",       desc: "Unrealized P/L in dollars" },
  { key: "netLiq",         label: "Net Liq",        desc: "Net liquidation value" },
  { key: "markPctChg",     label: "Mark %Chg",      desc: "Mark percent change today" },
  { key: "markChg",        label: "Mark Chg",       desc: "Mark dollar change today" },
  { key: "plYtd",          label: "P/L YTD",        desc: "Year-to-date P/L" },
  { key: "tradePrice",     label: "Trade Price",    desc: "Price at which position was opened" },
  { key: "margin",         label: "Margin",         desc: "Margin requirement" },
  { key: "delta",          label: "Delta",          desc: "Position delta" },
  { key: "extrinsic",      label: "Extrinsic",      desc: "Extrinsic value of option" },
  { key: "cost",           label: "Cost",           desc: "Avg price paid per share / contract" },
  { key: "totalCost",      label: "Total Cost",     desc: "Total cost basis" },
  { key: "todayClose",     label: "Today Close",    desc: "Today's closing price" },
  { key: "yesterdayClose",  label: "Yest Close",     desc: "Yesterday's closing price" },
  { key: "expiration",     label: "Expiration",     desc: "Option expiration date" },
  { key: "bwSpx",          label: "\u03B2 Wt SPX",  desc: "Beta-weighted delta vs SPX" },
  { key: "bwSpy",          label: "\u03B2 Wt SPY",  desc: "Beta-weighted delta vs SPY" },
  { key: "instrumentType", label: "Type",           desc: "Instrument type (Equity / Option)" },
  { key: "bpEffect",       label: "BP Effect",      desc: "Buying power effect" },
  { key: "qty",            label: "Qty",            desc: "Number of shares or contracts" },
  { key: "mktVal",         label: "Mkt Val",        desc: "Total position market value" },
  { key: "maint",          label: "Maint",          desc: "Maintenance margin requirement" },
  { key: "bwNdx",          label: "\u03B2 Wt NDX",  desc: "Beta-weighted delta vs NDX" },
];
const COLUMN_MAP = new Map(ALL_COLUMNS.map(c => [c.key, c]));
const DEFAULT_COLUMNS: ColumnKey[] = ["mark", "last", "plPct", "plDay", "plOpen", "netLiq", "markPctChg", "markChg"];
const COLUMNS_STORAGE_KEY = "alpha_visible_columns_v2";

interface CellVal { text: string; color: string; bold?: boolean }
const DASH: CellVal = { text: "\u2014", color: C.dim };

function getEquityCellVal(col: ColumnKey, pos: Position, streamLast?: number | null): CellVal {
  const qty = pos.longQuantity || pos.shortQuantity;
  const isShort = pos.shortQuantity > 0;
  const markPx = qty > 0 ? pos.marketValue / qty : null;
  switch (col) {
    case "mark": return { text: markPx != null ? `$${markPx.toFixed(2)}` : "\u2014", color: C.text };
    case "last": {
      if (streamLast != null) return { text: `$${streamLast.toFixed(2)}`, color: C.text };
      return DASH;
    }
    case "cost": return { text: `$${pos.averagePrice.toFixed(2)}`, color: C.textDim };
    case "tradePrice": return { text: `$${pos.averagePrice.toFixed(2)}`, color: C.textDim };
    case "qty": return { text: fmtQty(pos.longQuantity, pos.shortQuantity), color: C.textDim };
    case "mktVal": return { text: fmtCompact(pos.marketValue), color: C.text };
    case "netLiq": return { text: fmtCompact(pos.marketValue), color: C.text };
    case "plOpen": return { text: fmtCurrency(pos.longOpenProfitLoss), color: plColor(pos.longOpenProfitLoss), bold: true };
    case "plPct": {
      const pct = pos.averagePrice > 0 && qty > 0 ? (pos.longOpenProfitLoss / (pos.averagePrice * qty)) * 100 : 0;
      return { text: fmtPct(pct), color: plColor(pos.longOpenProfitLoss) };
    }
    case "plDay": return { text: fmtCurrency(pos.currentDayProfitLoss), color: plColor(pos.currentDayProfitLoss), bold: true };
    case "maint": return { text: pos.maintenanceRequirement > 0 ? fmtCompact(pos.maintenanceRequirement) : "\u2014", color: C.textDim };
    case "margin": return { text: pos.maintenanceRequirement > 0 ? fmtCompact(pos.maintenanceRequirement) : "\u2014", color: C.textDim };
    case "markPctChg": {
      if (markPx == null || qty === 0) return DASH;
      const dayChg = pos.currentDayProfitLoss / qty;
      const prev = markPx - dayChg;
      const pct = prev > 0 ? (dayChg / prev) * 100 : 0;
      return { text: fmtPct(pct), color: plColor(dayChg) };
    }
    case "markChg": {
      if (qty === 0) return DASH;
      const dayChg = pos.currentDayProfitLoss / qty;
      return { text: `${dayChg >= 0 ? "+" : ""}$${Math.abs(dayChg).toFixed(2)}`, color: plColor(dayChg) };
    }
    case "totalCost": {
      const tc = pos.averagePrice * qty;
      return { text: fmtCompact(isShort ? -tc : tc), color: C.textDim };
    }
    case "delta": return { text: isShort ? `-${qty}` : `+${qty}`, color: C.textDim };
    case "yesterdayClose": {
      if (markPx == null || qty === 0) return DASH;
      const dayChg = pos.currentDayProfitLoss / qty;
      return { text: `$${(markPx - dayChg).toFixed(2)}`, color: C.textDim };
    }
    case "instrumentType": return { text: "EQUITY", color: C.textDim };
    case "bpEffect": return { text: pos.maintenanceRequirement > 0 ? fmtCompact(-pos.maintenanceRequirement) : "\u2014", color: C.textDim };
    case "expiration": return DASH;
    case "extrinsic": return DASH;
    case "todayClose": return DASH;
    case "bwSpx": case "bwSpy": case "bwNdx": return DASH;
    case "plYtd": return DASH;
    default: return DASH;
  }
}

function getOptionCellVal(col: ColumnKey, opt: Position): CellVal {
  const isShort = opt.shortQuantity > 0;
  const qty = isShort ? opt.shortQuantity : opt.longQuantity;
  const markPx = qty > 0 ? opt.marketValue / (qty * 100) : 0;
  const totalPL = opt.longOpenProfitLoss;
  // TOS "P/L %" = unrealized P&L as a percentage of the original cost basis
  // (averagePrice × qty × 100), NOT current market value. Using market value
  // produced wildly off percentages (e.g. USB option showing 21% in-app vs
  // 6% on Think or Swim). Schwab returns averagePrice as a positive premium
  // for both long (debit paid) and short (credit collected) options, so
  // abs() keeps shorts correct.
  const costBasis = Math.abs(opt.averagePrice * qty * 100);
  const plPct = costBasis > 0.01 ? (totalPL / costBasis) * 100 : 0;
  switch (col) {
    case "mark": return { text: `$${markPx.toFixed(2)}`, color: C.text };
    case "last": {
      if (qty === 0) return DASH;
      const dayChg = opt.currentDayProfitLoss / (qty * 100);
      return { text: `$${(markPx - dayChg).toFixed(2)}`, color: C.text };
    }
    case "cost": return { text: `$${opt.averagePrice.toFixed(2)}`, color: C.textDim };
    case "tradePrice": return { text: `$${opt.averagePrice.toFixed(2)}`, color: C.textDim };
    case "qty": return { text: isShort ? `-${qty}` : `+${qty}`, color: C.text };
    case "mktVal": return { text: fmtCompact(opt.marketValue), color: C.text };
    case "netLiq": return { text: fmtCompact(opt.marketValue), color: C.text };
    case "plOpen": return { text: fmtCurrency(totalPL), color: plColor(totalPL), bold: true };
    case "plPct": return { text: fmtPct(plPct), color: plColor(totalPL) };
    case "plDay": return { text: fmtCurrency(opt.currentDayProfitLoss), color: plColor(opt.currentDayProfitLoss) };
    case "maint": return { text: opt.maintenanceRequirement > 0 ? fmtCompact(opt.maintenanceRequirement) : "\u2014", color: C.textDim };
    case "margin": return { text: opt.maintenanceRequirement > 0 ? fmtCompact(opt.maintenanceRequirement) : "\u2014", color: C.textDim };
    case "markPctChg": {
      if (qty === 0) return DASH;
      const dayChg = opt.currentDayProfitLoss / (qty * 100);
      const prev = markPx - dayChg;
      const pct = prev > 0 ? (dayChg / prev) * 100 : 0;
      return { text: fmtPct(pct), color: plColor(dayChg) };
    }
    case "markChg": {
      if (qty === 0) return DASH;
      const dayChg = opt.currentDayProfitLoss / (qty * 100);
      return { text: `${dayChg >= 0 ? "+" : ""}$${Math.abs(dayChg).toFixed(2)}`, color: plColor(dayChg) };
    }
    case "totalCost": {
      const tc = opt.averagePrice * qty * 100;
      return { text: fmtCompact(isShort ? -tc : tc), color: C.textDim };
    }
    case "delta": return DASH;
    case "extrinsic": return DASH;
    case "yesterdayClose": {
      if (qty === 0) return DASH;
      const dayChg = opt.currentDayProfitLoss / (qty * 100);
      return { text: `$${(markPx - dayChg).toFixed(2)}`, color: C.textDim };
    }
    case "expiration": {
      const d = formatOptionExpiry(opt.symbol);
      return d ? { text: `${d.day} ${d.mon} ${d.yr}`, color: C.textDim } : DASH;
    }
    case "instrumentType": return { text: opt.putCall === "CALL" ? "CALL" : "PUT", color: C.textDim };
    case "bpEffect": return { text: opt.maintenanceRequirement > 0 ? fmtCompact(-opt.maintenanceRequirement) : "\u2014", color: C.textDim };
    case "todayClose": return DASH;
    case "bwSpx": case "bwSpy": case "bwNdx": return DASH;
    case "plYtd": return DASH;
    default: return DASH;
  }
}

function renderCells(
  visibleColumns: ColumnKey[],
  getVal: (col: ColumnKey) => CellVal,
  baseStyle: (color: string, bold?: boolean) => React.CSSProperties,
  overrides?: Partial<Record<ColumnKey, { style?: React.CSSProperties }>>,
): React.ReactNode {
  return visibleColumns.map(key => {
    const v = getVal(key);
    const extra = overrides?.[key]?.style;
    return <td key={key} style={{ ...baseStyle(v.color, v.bold), ...extra }}>{v.text}</td>;
  });
}

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
  closePrice: number | null;
  currentDayCost: number | null;
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
  description: string;
  equity: Position | null;
  options: Position[];
  totalMarketValue: number;
  totalDayPL: number;
  totalPL: number;
  totalMaint: number;
  totalCost: number;
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
const COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", GOOGL: "Alphabet Inc.", GOOG: "Alphabet Inc.",
  AMZN: "Amazon.com Inc.", META: "Meta Platforms Inc.", NVDA: "NVIDIA Corp.", TSLA: "Tesla Inc.",
  SPY: "SPDR S&P 500 ETF", QQQ: "Invesco QQQ Trust", IWM: "iShares Russell 2000",
  DIA: "SPDR Dow Jones ETF", HYG: "iShares High Yield Corp", LQD: "iShares Invest Grade Corp",
  AMD: "Advanced Micro Devices", NFLX: "Netflix Inc.", CRM: "Salesforce Inc.", MRVL: "Marvell Technology",
  MU: "Micron Technology", AVGO: "Broadcom Inc.", QCOM: "Qualcomm Inc.", ARM: "Arm Holdings",
  SMCI: "Super Micro Computer", TSM: "Taiwan Semiconductor",
  INTC: "Intel Corp.", BA: "Boeing Co.", JPM: "JPMorgan Chase", GS: "Goldman Sachs",
  V: "Visa Inc.", MA: "Mastercard Inc.", WMT: "Walmart Inc.", DIS: "Walt Disney Co.",
  PYPL: "PayPal Holdings", SQ: "Block Inc.", COIN: "Coinbase Global",
  PLTR: "Palantir Technologies", SOFI: "SoFi Technologies", UBER: "Uber Technologies",
  SNOW: "Snowflake Inc.", NET: "Cloudflare Inc.", SHOP: "Shopify Inc.",
  ROKU: "Roku Inc.", RIVN: "Rivian Automotive", LCID: "Lucid Group Inc.",
  PANW: "Palo Alto Networks", CRWD: "CrowdStrike Holdings", ZS: "Zscaler Inc.",
  DDOG: "Datadog Inc.", MDB: "MongoDB Inc.", TTD: "The Trade Desk",
  ENPH: "Enphase Energy", FSLR: "First Solar Inc.", ON: "ON Semiconductor",
  ANET: "Arista Networks", NOW: "ServiceNow Inc.", ADBE: "Adobe Inc.",
  ORCL: "Oracle Corp.", IBM: "IBM Corp.", DELL: "Dell Technologies",
  GM: "General Motors", F: "Ford Motor Co.", SNAP: "Snap Inc.",
  PINS: "Pinterest Inc.", HOOD: "Robinhood Markets",
  COF: "Capital One Financial", PG: "Procter & Gamble", MDLN: "Medallion Financial",
  DJT: "Trump Media & Tech", MO: "Altria Group Inc.",
  SOXX: "iShares Semiconductor", XLF: "Financial Select SPDR", XLE: "Energy Select SPDR",
  GLD: "SPDR Gold Trust", SLV: "iShares Silver Trust", TLT: "iShares 20+ Year Treasury",
  USO: "United States Oil Fund", ARKK: "ARK Innovation ETF",
  NIO: "NIO Inc.", BABA: "Alibaba Group", JD: "JD.com Inc.",
  XOM: "Exxon Mobil Corp.", CVX: "Chevron Corp.", PFE: "Pfizer Inc.",
  MRNA: "Moderna Inc.", UNH: "UnitedHealth Group", LLY: "Eli Lilly & Co.",
  COST: "Costco Wholesale", HD: "Home Depot Inc.", LOW: "Lowe's Companies",
  TGT: "Target Corp.", KO: "Coca-Cola Co.", PEP: "PepsiCo Inc.",
  MCD: "McDonald's Corp.", SBUX: "Starbucks Corp.", NKE: "Nike Inc.",
  ABNB: "Airbnb Inc.", DASH: "DoorDash Inc.", LYFT: "Lyft Inc.",
};
const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function formatOptionSymbol(sym: string, includeUnderlying = true): string {
  const match = sym.trim().match(/^(\w+)\s+(\d{6})([CP])(\d{8})$/);
  if (!match) return sym.trim();
  const [, underlying, dateStr, pc, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;
  const strikeStr = strike % 1 === 0 ? String(strike) : strike.toFixed(1);
  const prefix = includeUnderlying ? `${underlying} ` : "";
  return `${prefix}${dateStr.slice(0, 2)}/${dateStr.slice(2, 4)}/${dateStr.slice(4, 6)} ${strikeStr}${pc}`;
}
function formatOptionExpiry(sym: string): { day: string; mon: string; yr: string; strike: string; pc: "C" | "P" } | null {
  const match = sym.trim().match(/^(\w+)\s+(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const [, , dateStr, pc, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;
  const strikeStr = strike % 1 === 0 ? String(strike) : strike.toFixed(1);
  const mo = parseInt(dateStr.slice(2, 4)) - 1;
  return { day: String(parseInt(dateStr.slice(4, 6))), mon: MONTH_ABBR[mo] ?? dateStr.slice(2, 4), yr: dateStr.slice(0, 2), strike: strikeStr, pc: pc as "C" | "P" };
}
function parseOptionSymbolDetails(sym: string): { putCall: "CALL" | "PUT"; strike: number; expiration: string } | null {
  const match = sym.trim().match(/^(\w+)\s+(\d{6})([CP])(\d{8})$/);
  if (!match) return null;
  const [, , dateStr, pc, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;
  const expiration = `${dateStr.slice(2, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(0, 2)}`;
  return { putCall: pc === "C" ? "CALL" : "PUT", strike, expiration };
}

function statusColor(status: string): string {
  switch (status) {
    case "FILLED": return C.green;
    case "CANCELED": case "REJECTED": case "EXPIRED": return C.red;
    case "WORKING": case "PENDING_ACTIVATION": return C.gold;
    default: return C.textDim;
  }
}

const CP = "8px 16px";
const SYM_COL_W = 150;

function useTickFlash(symbol: string): "up" | "down" | null {
  const price = useTerminalStore(s => (s.streamPrices[symbol.toUpperCase()] as { last?: number } | undefined)?.last);
  const prevRef = useRef<number | undefined>(undefined);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (price == null) return;
    if (prevRef.current != null && price !== prevRef.current) {
      setDir(price > prevRef.current ? "up" : "down");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setDir(null), 700);
    }
    prevRef.current = price;
  }, [price]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return dir;
}

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

function useValueFlash(value: number): "up" | "down" | null {
  const prevRef = useRef<number | undefined>(undefined);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevRef.current != null && value !== prevRef.current) {
      setDir(value > prevRef.current ? "up" : "down");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setDir(null), 700);
    }
    prevRef.current = value;
  }, [value]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return dir;
}


function detectSpreadType(options: Position[]): { type: string; label: string } | null {
  if (options.length !== 2) return null;
  const longs = options.filter(o => o.longQuantity > 0);
  const shorts = options.filter(o => o.shortQuantity > 0);
  if (longs.length !== 1 || shorts.length !== 1) return null;
  const longOpt = longs[0];
  const shortOpt = shorts[0];
  if (longOpt.putCall !== shortOpt.putCall) return null;
  const longDetails = parseOptionSymbolDetails(longOpt.symbol);
  const shortDetails = parseOptionSymbolDetails(shortOpt.symbol);
  if (!longDetails || !shortDetails) return null;
  if (longDetails.expiration !== shortDetails.expiration) return null;
  if (longDetails.strike === shortDetails.strike) return null;
  return { type: "vertical", label: "Vertical" };
}

function sortLegsLongFirst(options: Position[]): Position[] {
  return [...options].sort((a, b) => {
    const aLong = a.longQuantity > 0 ? 1 : 0;
    const bLong = b.longQuantity > 0 ? 1 : 0;
    return bLong - aLong;
  });
}

function OptionRow({
  opt, underlying, selectedKeys, toggleKey, visibleColumns,
}: {
  opt: Position;
  underlying: string;
  selectedKeys: Set<string>;
  toggleKey: (key: string) => void;
  visibleColumns: ColumnKey[];
}) {
  const isShort = opt.shortQuantity > 0;
  const qty = isShort ? opt.shortQuantity : opt.longQuantity;
  const optKey = `${underlying}:${opt.cusip}`;
  const isSelected = selectedKeys.has(optKey);
  const markPx = qty > 0 ? opt.marketValue / (qty * 100) : 0;

  const tickDir = useValueFlash(markPx);
  const markColor = tickDir === "up" ? C.green : tickDir === "down" ? C.red : C.text;

  const rowBg = "transparent";
  const stickyBg = "#000";

  const cellStyle = (color: string, bold?: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: bold ? 500 : undefined, color,
    textAlign: "center", fontVariantNumeric: "tabular-nums",
    padding: CP, background: rowBg, whiteSpace: "nowrap",
  });

  return (
    <tr>
      <td className="pf-sticky-col" style={{ background: stickyBg, padding: "5px 6px 5px 20px", minWidth: SYM_COL_W }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Checkbox checked={isSelected} onToggle={e => { e.stopPropagation(); toggleKey(optKey); }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
            {opt.putCall === "CALL" ? "C" : "P"}
          </span>
          <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>
            {(() => { const d = formatOptionExpiry(opt.symbol); return d ? `${d.day} ${d.mon} ${d.yr}` : ""; })()}
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.text, paddingLeft: 22 }}>
          {(() => { const d = formatOptionExpiry(opt.symbol); return d ? d.strike : ""; })()}{" "}
          <span style={{ color: isShort ? C.red : C.green, fontWeight: 600 }}>{isShort ? `-${qty}` : `+${qty}`}</span>
        </div>
      </td>
      {renderCells(visibleColumns, col => {
        const v = getOptionCellVal(col, opt);
        if (col === "mark") return { ...v, color: markColor };
        return v;
      }, cellStyle, { mark: { style: { transition: "color 0.15s" } } })}
    </tr>
  );
}

function SpreadSummaryRow({
  spread, underlying, options, selectedKeys, toggleKey, visibleColumns,
}: {
  spread: { type: string; label: string };
  underlying: string;
  options: Position[];
  selectedKeys: Set<string>;
  toggleKey: (key: string) => void;
  visibleColumns: ColumnKey[];
}) {
  const allKeys = options.map(o => `${underlying}:${o.cusip}`);
  const allSelected = allKeys.every(k => selectedKeys.has(k));

  const handleToggleAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (allSelected) {
      allKeys.forEach(k => { if (selectedKeys.has(k)) toggleKey(k); });
    } else {
      allKeys.forEach(k => { if (!selectedKeys.has(k)) toggleKey(k); });
    }
  };

  const spreadMark = (() => {
    const longOpt = options.find(o => o.longQuantity > 0);
    const shortOpt = options.find(o => o.shortQuantity > 0);
    if (!longOpt || !shortOpt) return 0;
    const longQty = longOpt.longQuantity;
    const shortQty = shortOpt.shortQuantity;
    const longMark = longQty > 0 ? Math.abs(longOpt.marketValue) / (longQty * 100) : 0;
    const shortMark = shortQty > 0 ? Math.abs(shortOpt.marketValue) / (shortQty * 100) : 0;
    return longMark - shortMark;
  })();

  const spreadPL = options.reduce((s, o) => s + o.longOpenProfitLoss, 0);
  const spreadDayPL = options.reduce((s, o) => s + o.currentDayProfitLoss, 0);
  const spreadMktVal = options.reduce((s, o) => s + o.marketValue, 0);
  const spreadCost = options.reduce((s, o) => {
    const qty = o.longQuantity > 0 ? o.longQuantity : -(o.shortQuantity || 0);
    return s + o.averagePrice * qty * 100;
  }, 0);
  // TOS "P/L %" = unrealized P&L as a percentage of the spread's net cost
  // basis (sum of signed leg averagePrice × qty × 100). Using current market
  // value as the denominator inflated percentages dramatically.
  const spreadPLPct = Math.abs(spreadCost) > 0.01 ? (spreadPL / Math.abs(spreadCost)) * 100 : 0;
  const spreadMaint = options.reduce((s, o) => s + o.maintenanceRequirement, 0);

  const rowBg = "transparent";
  const stickyBg = "#000";

  const cellStyle = (color: string, bold?: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: bold ? 500 : undefined, color,
    textAlign: "center", fontVariantNumeric: "tabular-nums",
    padding: CP, background: rowBg, whiteSpace: "nowrap",
  });

  const getVal = (col: ColumnKey): CellVal => {
    switch (col) {
      case "mark": return { text: `$${Math.abs(spreadMark).toFixed(2)}`, color: C.text };
      case "last": return { text: `$${Math.abs(spreadMark).toFixed(2)}`, color: C.text };
      case "mktVal": case "netLiq": return { text: fmtCompact(spreadMktVal), color: C.text };
      case "plOpen": return { text: fmtCurrency(spreadPL), color: plColor(spreadPL), bold: true };
      case "plPct": return { text: fmtPct(spreadPLPct), color: plColor(spreadPL) };
      case "plDay": return { text: fmtCurrency(spreadDayPL), color: plColor(spreadDayPL), bold: true };
      case "maint": case "margin": return { text: spreadMaint > 0 ? fmtCompact(spreadMaint) : "\u2014", color: C.textDim };
      case "bpEffect": return { text: spreadMaint > 0 ? fmtCompact(-spreadMaint) : "\u2014", color: C.textDim };
      case "instrumentType": return { text: "SPREAD", color: C.textDim };
      case "totalCost": return { text: Math.abs(spreadCost) > 0.01 ? fmtCompact(spreadCost) : "\u2014", color: C.textDim };
      case "markPctChg": {
        const prevMkt = spreadMktVal - spreadDayPL;
        const pct = Math.abs(prevMkt) > 0.01 ? (spreadDayPL / Math.abs(prevMkt)) * 100 : 0;
        return { text: fmtPct(pct), color: plColor(spreadDayPL) };
      }
      case "markChg": return { text: fmtCurrency(spreadDayPL), color: plColor(spreadDayPL) };
      default: return DASH;
    }
  };

  return (
    <tr>
      <td className="pf-sticky-col" style={{ background: stickyBg, padding: "5px 6px 5px 20px", minWidth: SYM_COL_W }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Checkbox checked={allSelected} onToggle={handleToggleAll} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{spread.label}</span>
        </div>
      </td>
      {renderCells(visibleColumns, getVal, cellStyle)}
    </tr>
  );
}

function PositionTableRow({
  group,
  onSelect,
  onTrade,
  selectedKeys,
  toggleKey,
  visibleColumns,
  earningsAlert,
}: {
  group: SymbolGroup;
  onSelect: (sym: string) => void;
  onTrade?: (symbol: string, side: "BUY" | "SELL", optionSymbol?: string, optionInstruction?: string) => void;
  selectedKeys: Set<string>;
  toggleKey: (key: string) => void;
  visibleColumns: ColumnKey[];
  earningsAlert?: { date: string; time: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const eq = group.equity;
  const hasOptions = group.options.length > 0;
  // TOS "P/L %" = unrealized P&L as a percentage of total cost basis
  // (equity averagePrice × qty + each option averagePrice × signed qty × 100).
  // Falls back to current market value if cost basis collapses to ~0 (which
  // can happen for true credit spreads where longs and shorts cancel).
  const totalPLPct = Math.abs(group.totalCost) > 0.01
    ? (group.totalPL / Math.abs(group.totalCost)) * 100
    : Math.abs(group.totalMarketValue) > 0.01
      ? (group.totalPL / Math.abs(group.totalMarketValue)) * 100
      : 0;
  const eqKey = `${group.underlying}:EQ`;
  const eqSelected = eq != null && selectedKeys.has(eqKey);
  const someSelected = eqSelected || group.options.some(o => selectedKeys.has(`${group.underlying}:${o.cusip}`));

  const eqTickDir = useTickFlash(group.underlying);
  const markColor = eqTickDir === "up" ? C.green : eqTickDir === "down" ? C.red : C.text;
  // Two distinct values:
  //   streamPrice       = Schwab field 3 LAST_PRICE — includes pre/post-market
  //                       trades, used for the Mark column so it ticks live
  //                       even when the regular session is closed.
  //   streamRegularLast = Schwab field 29 REGULAR_MARKET_LAST_PRICE — the last
  //                       trade of the most recent regular session, used for
  //                       the Last column.
  const streamQuote = useTerminalStore(s => s.streamPrices[group.underlying.toUpperCase()] as { last?: number; regularLast?: number } | undefined);
  const streamPrice = streamQuote?.last ?? streamQuote?.regularLast ?? null;
  const streamRegularLast = streamQuote?.regularLast ?? streamQuote?.last ?? null;

  const rowBg = "transparent";
  const stickyBg = "#000";

  const dataCellStyle = (color: string, bold?: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: bold ? 500 : undefined, color,
    textAlign: "center", fontVariantNumeric: "tabular-nums",
    padding: CP, background: rowBg, whiteSpace: "nowrap",
  });

  const getGroupVal = (col: ColumnKey): CellVal => {
    switch (col) {
      case "mark": {
        let markPx: number | null = null;
        if (eq) { const eqQty = eq.longQuantity || eq.shortQuantity; if (eqQty > 0) markPx = eq.marketValue / eqQty; }
        if (markPx == null && streamPrice != null) markPx = streamPrice;
        return { text: markPx != null ? `$${markPx.toFixed(2)}` : "\u2014", color: markPx != null ? markColor : C.dim };
      }
      case "last": {
        if (streamRegularLast != null) return { text: `$${streamRegularLast.toFixed(2)}`, color: C.text };
        return DASH;
      }
      case "cost": case "tradePrice": {
        if (eq) return { text: `$${eq.averagePrice.toFixed(2)}`, color: C.textDim };
        const tc = group.options.reduce((s, o) => s + (o.longQuantity || o.shortQuantity), 0);
        const avg = tc > 0 ? group.options.reduce((s, o) => s + o.averagePrice * (o.longQuantity || o.shortQuantity), 0) / tc : null;
        return { text: avg != null ? `$${avg.toFixed(2)}` : "\u2014", color: C.textDim };
      }
      case "qty": {
        if (eq && hasOptions) return DASH;
        return { text: eq ? fmtQty(eq.longQuantity, eq.shortQuantity) : hasOptions ? `${group.options.length}c` : "\u2014", color: C.textDim };
      }
      case "mktVal": case "netLiq": return { text: fmtCompact(group.totalMarketValue), color: C.text };
      case "plOpen": return { text: fmtCurrency(group.totalPL), color: plColor(group.totalPL), bold: true };
      case "plPct": return { text: fmtPct(totalPLPct), color: plColor(group.totalPL) };
      case "plDay": return { text: fmtCurrency(group.totalDayPL), color: plColor(group.totalDayPL), bold: true };
      case "maint": case "margin": return { text: group.totalMaint > 0 ? fmtCompact(group.totalMaint) : "\u2014", color: C.textDim };
      case "bpEffect": return { text: group.totalMaint > 0 ? fmtCompact(-group.totalMaint) : "\u2014", color: C.textDim };
      case "totalCost": {
        // Synthetic cost basis = current market value - unrealized P&L.
        // Kept here for the Total Cost column only; do NOT use it for
        // percent calculations (it collapses for option spreads).
        const costBasis = group.totalMarketValue - group.totalPL;
        return { text: fmtCompact(costBasis), color: C.textDim };
      }
      case "instrumentType": return { text: eq ? "EQUITY" : "OPTION", color: C.textDim };
      case "markPctChg": {
        const prevMkt = group.totalMarketValue - group.totalDayPL;
        const pct = Math.abs(prevMkt) > 0.01 ? (group.totalDayPL / Math.abs(prevMkt)) * 100 : 0;
        return { text: fmtPct(pct), color: plColor(group.totalDayPL) };
      }
      case "markChg": {
        if (!eq) return { text: fmtCurrency(group.totalDayPL), color: plColor(group.totalDayPL) };
        const eqQty = eq.longQuantity || eq.shortQuantity;
        if (eqQty === 0) return DASH;
        const dayChg = eq.currentDayProfitLoss / eqQty;
        return { text: `${dayChg >= 0 ? "+" : ""}$${Math.abs(dayChg).toFixed(2)}`, color: plColor(dayChg) };
      }
      case "delta": {
        if (eq) { const q = eq.longQuantity || eq.shortQuantity; return { text: eq.shortQuantity > 0 ? `-${q}` : `+${q}`, color: C.textDim }; }
        return DASH;
      }
      case "yesterdayClose": {
        if (!eq) return DASH;
        const eqQty = eq.longQuantity || eq.shortQuantity;
        if (eqQty === 0) return DASH;
        const markPx = eq.marketValue / eqQty;
        const dayChg = eq.currentDayProfitLoss / eqQty;
        return { text: `$${(markPx - dayChg).toFixed(2)}`, color: C.textDim };
      }
      case "expiration": return DASH;
      case "extrinsic": return DASH;
      case "todayClose": return DASH;
      case "bwSpx": case "bwSpy": case "bwNdx": return DASH;
      case "plYtd": return DASH;
      default: return DASH;
    }
  };

  if (!hasOptions) {
    return (
      <tr>
        <td className="pf-sticky-col" style={{ background: "#000", padding: "6px 8px 6px 10px", minWidth: SYM_COL_W }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div onClick={e => { e.stopPropagation(); toggleKey(eqKey); }} style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
              <div style={{ width: 15, height: 15, border: `1.5px solid ${eqSelected ? C.gold : C.dim}`, borderRadius: 3, background: eqSelected ? `${C.gold}22` : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s" }}>
                {eqSelected && <div style={{ width: 7, height: 7, background: C.gold, borderRadius: 1 }} />}
              </div>
            </div>
            <div onClick={e => { e.stopPropagation(); onSelect(group.underlying); }} style={{ display: "flex", flexDirection: "column", minWidth: 0, cursor: "pointer", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>{group.underlying}</span>
                {earningsAlert && <span title={`Earnings ${earningsAlert.date}${earningsAlert.time === "bmo" ? " BMO" : earningsAlert.time === "amc" ? " AMC" : ""}`} style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: "#fb923c", border: "1px solid rgba(251,146,60,0.4)", background: "rgba(251,146,60,0.1)", borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap" }}>EARN {earningsAlert.date.slice(5)}</span>}
              </div>
              {(COMPANY_NAMES[group.underlying] ?? group.description) && <span style={{ fontSize: 12, color: C.gold, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{COMPANY_NAMES[group.underlying] ?? group.description}</span>}
            </div>
          </div>
        </td>
        {renderCells(visibleColumns, getGroupVal, dataCellStyle, { mark: { style: { transition: "color 0.15s" } } })}
      </tr>
    );
  }

  const groupDataCell = (color: string, bold?: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: bold ? 500 : undefined, color,
    textAlign: "center", fontVariantNumeric: "tabular-nums",
    padding: CP, background: rowBg, whiteSpace: "nowrap", cursor: "pointer",
  });

  return (
    <>
      <tr onClick={() => setExpanded(!expanded)} style={{ cursor: "pointer" }}>
        <td className="pf-sticky-col" style={{ background: stickyBg, padding: "6px 8px 6px 10px", minWidth: SYM_COL_W }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {expanded ? <ChevronDown style={{ width: 15, height: 15, color: C.dim }} /> : <ChevronRight style={{ width: 15, height: 15, color: C.dim }} />}
            </div>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span onClick={e => { e.stopPropagation(); onSelect(group.underlying); }} style={{ fontSize: 14, fontWeight: 600, color: C.text, whiteSpace: "nowrap", cursor: "pointer" }}>{group.underlying}</span>
              {(COMPANY_NAMES[group.underlying] ?? group.description) && <span style={{ fontSize: 12, color: C.gold, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{COMPANY_NAMES[group.underlying] ?? group.description}</span>}
            </div>
          </div>
        </td>
        {renderCells(visibleColumns, getGroupVal, groupDataCell, { mark: { style: { transition: "color 0.15s" } } })}
      </tr>

      {expanded && (
        <>
          {eq && (() => {
            const subBg = "transparent";
            const subStickyBg = "#000";
            const subCell = (color: string, bold?: boolean): React.CSSProperties => ({ fontSize: 14, fontWeight: bold ? 500 : undefined, color, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: subBg, whiteSpace: "nowrap" });
            return (
              <tr>
                <td className="pf-sticky-col" style={{ background: subStickyBg, padding: "7px 6px 7px 20px", minWidth: SYM_COL_W }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {hasOptions && <Checkbox checked={!!eqSelected} onToggle={e => { e.stopPropagation(); toggleKey(eqKey); }} />}
                    <span style={{ fontSize: 12, color: C.text, whiteSpace: "nowrap" }}>{fmtQty(eq.longQuantity, eq.shortQuantity)}</span>
                  </div>
                </td>
                {renderCells(visibleColumns, col => {
                  const v = getEquityCellVal(col, eq, streamRegularLast);
                  if (col === "mark") return { ...v, color: markColor };
                  return v;
                }, subCell, { mark: { style: { transition: "color 0.15s" } } })}
              </tr>
            );
          })()}
          {(() => {
            const spread = detectSpreadType(group.options);
            const sortedOpts = sortLegsLongFirst(group.options);
            return (
              <>
                {spread && (
                  <SpreadSummaryRow spread={spread} underlying={group.underlying} options={sortedOpts} selectedKeys={selectedKeys} toggleKey={toggleKey} visibleColumns={visibleColumns} />
                )}
                {sortedOpts.map(opt => (
                  <OptionRow key={opt.cusip} opt={opt} underlying={group.underlying} selectedKeys={selectedKeys} toggleKey={toggleKey} visibleColumns={visibleColumns} />
                ))}
              </>
            );
          })()}
        </>
      )}
    </>
  );
}

function OrderRow({ order, onCancel }: { order: Order; onCancel?: (orderId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const primaryLeg = order.legs[0];
  const isMultiLeg = order.legs.length > 1;
  const displaySymbol = primaryLeg
    ? (primaryLeg.assetType === "OPTION" || primaryLeg.assetType === "INDEX_OPTION" || primaryLeg.assetType === "FUTURE_OPTION") ? formatOptionSymbol(primaryLeg.symbol) : primaryLeg.symbol
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
            <span style={{ fontSize: 14, fontWeight: 600, color: isBuy ? C.green : C.red, textTransform: "uppercase", letterSpacing: 0.3 }}>
              {primaryLeg?.instruction?.replace(/_/g, " ") ?? "—"}
            </span>
            {isMultiLeg && <span style={{ fontSize: 12, color: C.textDim }}>+{order.legs.length - 1} leg{order.legs.length > 2 ? "s" : ""}</span>}
          </div>
          <span style={{ fontSize: 14, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
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
        <div style={{ padding: "6px 10px 8px 20px", borderTop: `1px solid ${C.border}`, background: "#000" }}>
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
                <div style={{ fontSize: 14, color: C.text }}>{value}</div>
              </div>
            ))}
          </div>
          {order.legs.length > 1 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Legs</div>
              {order.legs.map((leg, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 6, marginBottom: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: leg.instruction?.includes("BUY") ? C.green : C.red }}>{leg.instruction?.replace(/_/g, " ")}</span>
                  <span style={{ fontSize: 12, color: C.textDim }}>{leg.quantity}× {(leg.assetType === "OPTION" || leg.assetType === "INDEX_OPTION" || leg.assetType === "FUTURE_OPTION") ? formatOptionSymbol(leg.symbol) : leg.symbol}</span>
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
  onTrade?: (
    symbol: string,
    side: "BUY" | "SELL",
    optionSymbol?: string,
    optionInstruction?: string,
    strategyLegs?: OrderLeg[],
    strategyNetPrice?: number,
    strategyIsCredit?: boolean,
    isClose?: boolean,
  ) => void;
  onRoll?: (symbol: string) => void;
}

function ReconnectSchwabButton() {
  const { oauthUrl, isNavigating, onClick } = useBrokerConnect();
  const disabled = !oauthUrl || isNavigating;
  return (
    <a
      href={oauthUrl ?? "#"}
      target="_blank"
      onClick={(e) => {
        if (!oauthUrl) { e.preventDefault(); return; }
        onClick();
      }}
      aria-disabled={disabled}
      role="button"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "10px 24px", borderRadius: 8,
        border: `1px solid ${C.gold}4d`, background: `${C.gold}0d`,
        color: C.gold, fontSize: 12, fontFamily: f,
        letterSpacing: 1, textTransform: "uppercase" as const,
        cursor: "pointer", transition: "all 0.15s",
        textDecoration: "none",
        opacity: disabled && !isNavigating ? 0.5 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {isNavigating ? (
        <><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />REDIRECTING...</>
      ) : (
        <><ExternalLink style={{ width: 14, height: 14 }} />RECONNECT SCHWAB</>
      )}
    </a>
  );
}

function ColumnSettingsPanel({
  visibleColumns,
  onToggle,
  onReorder,
  onReset,
  onClose,
}: {
  visibleColumns: ColumnKey[];
  onToggle: (key: ColumnKey) => void;
  onReorder: (cols: ColumnKey[]) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const headerBottom = useHeaderBottom();
  const dragIdx = useRef<number | null>(null);
  const dragStartY = useRef(0);
  const [activeDragIdx, setActiveDragIdx] = useState<number | null>(null);
  const ITEM_H = 44;

  const handlePointerDown = (e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragIdx.current = idx;
    dragStartY.current = e.clientY;
    setActiveDragIdx(idx);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragIdx.current == null) return;
    const delta = e.clientY - dragStartY.current;
    if (Math.abs(delta) >= ITEM_H * 0.6) {
      const dir = delta > 0 ? 1 : -1;
      const from = dragIdx.current;
      const to = from + dir;
      if (to >= 0 && to < visibleColumns.length) {
        const next = [...visibleColumns];
        [next[from], next[to]] = [next[to], next[from]];
        onReorder(next);
        dragIdx.current = to;
        dragStartY.current = e.clientY;
        setActiveDragIdx(to);
      }
    }
  };

  const handlePointerUp = () => {
    dragIdx.current = null;
    setActiveDragIdx(null);
  };

  const hiddenColumns = ALL_COLUMNS.filter(c => !visibleColumns.includes(c.key));

  return (
    <>
      <div style={{ position: "fixed", top: headerBottom, left: 0, right: 0, bottom: 0, zIndex: 49, background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div
        style={{
          position: "fixed", top: headerBottom, left: 0, right: 0, bottom: 0, zIndex: 50,
          background: "#111", fontFamily: f, display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>Position Settings</span>
            <span style={{ fontSize: 11, color: C.dim }}>Brokerage</span>
          </div>
          <button onClick={onClose} style={{ fontSize: 15, fontWeight: 600, color: C.gold, background: "transparent", border: "none", cursor: "pointer", fontFamily: f, padding: "4px 8px" }}>Close</button>
        </div>

        <div style={{ padding: "12px 16px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 1 }}>Visible Columns</span>
          <button onClick={onReset} style={{ fontSize: 12, fontWeight: 600, color: C.gold, background: "transparent", border: "none", cursor: "pointer", fontFamily: f, textTransform: "uppercase", letterSpacing: 0.5 }}>Reset</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {visibleColumns.map((key, idx) => {
            const col = COLUMN_MAP.get(key);
            if (!col) return null;
            const isActive = idx === activeDragIdx;
            return (
              <div
                key={key}
                style={{
                  display: "flex", alignItems: "center", padding: "0 16px", height: ITEM_H,
                  borderBottom: `1px solid ${C.border}`,
                  background: isActive ? "#1e1e1e" : "transparent",
                  transform: isActive ? "scale(1.02)" : "scale(1)",
                  boxShadow: isActive ? "0 4px 20px rgba(0,0,0,0.6)" : "none",
                  zIndex: isActive ? 10 : 0,
                  position: "relative",
                  transition: isActive ? "none" : "transform 0.15s ease, box-shadow 0.15s ease",
                  borderRadius: isActive ? 8 : 0,
                }}
              >
                <button
                  onClick={() => onToggle(key)}
                  style={{
                    width: 24, height: 24, borderRadius: 12, border: "none",
                    background: "#dc2626", display: "flex", alignItems: "center",
                    justifyContent: "center", cursor: "pointer", flexShrink: 0, marginRight: 12,
                  }}
                >
                  <div style={{ width: 10, height: 2, background: "#fff", borderRadius: 1 }} />
                </button>
                <span style={{ fontSize: 15, color: isActive ? "#fff" : C.text, flex: 1, fontWeight: isActive ? 600 : 400 }}>{col.label}</span>
                <div
                  onPointerDown={e => handlePointerDown(e, idx)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  style={{
                    width: 32, height: 32, display: "flex", alignItems: "center",
                    justifyContent: "center", cursor: isActive ? "grabbing" : "grab",
                    flexShrink: 0, touchAction: "none",
                  }}
                >
                  <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                    <rect y="0" width="16" height="2" rx="1" fill={isActive ? C.gold : C.dim} />
                    <rect y="5" width="16" height="2" rx="1" fill={isActive ? C.gold : C.dim} />
                    <rect y="10" width="16" height="2" rx="1" fill={isActive ? C.gold : C.dim} />
                  </svg>
                </div>
              </div>
            );
          })}

          {hiddenColumns.length > 0 && (
            <>
              <div style={{ padding: "16px 16px 6px" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 1 }}>Available Columns</span>
              </div>
              {hiddenColumns.map(col => (
                <div
                  key={col.key}
                  style={{
                    display: "flex", alignItems: "center", padding: "0 16px", height: ITEM_H,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <button
                    onClick={() => onToggle(col.key)}
                    style={{
                      width: 24, height: 24, borderRadius: 12, border: "none",
                      background: C.green, display: "flex", alignItems: "center",
                      justifyContent: "center", cursor: "pointer", flexShrink: 0, marginRight: 12,
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <rect x="4" y="0" width="2" height="10" rx="1" fill="#fff" />
                      <rect x="0" y="4" width="10" height="2" rx="1" fill="#fff" />
                    </svg>
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 15, color: C.dim }}>{col.label}</span>
                    <div style={{ fontSize: 11, color: C.dim, opacity: 0.6, marginTop: 1 }}>{col.desc}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function PortfolioView({ onNavigateToSymbol, onTrade, onRoll }: PortfolioViewProps) {
  const { accessToken, setSymbol } = useTerminalStore();
  const wsAccount = usePortfolioStreamStore((s) => s.account);
  const wsOrders = usePortfolioStreamStore((s) => s.orders);
  const wsLastUpdate = usePortfolioStreamStore((s) => s.lastUpdate);
  const portfolioStatus = usePortfolioStreamStore((s) => s.portfolioStatus);

  const [subTab, setSubTab] = useState<SubTab>("positions");
  const [account, setAccount] = useState<Account | null>(() => usePortfolioStreamStore.getState().account as Account | null);
  const [orders, setOrders] = useState<Order[]>(() => usePortfolioStreamStore.getState().orders as Order[]);
  const [loading, setLoading] = useState(() => !usePortfolioStreamStore.getState().account);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("ALL");
  const [orderSearch, setOrderSearch] = useState("");
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [accountHash, setAccountHash] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState(false);
  const wsSubSentRef = useRef(false);
  const [upcomingEarnings, setUpcomingEarnings] = useState<Map<string, { date: string; time: string }>>(new Map());

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
  type SortDir = "asc" | "desc";
  type SortField = ColumnKey | "symbol";
  const [sortKey, setSortKey] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Click cycles: none → desc → asc → none
  const cycleSort = useCallback((key: SortField) => {
    if (sortKey === key && sortDir === "asc") {
      setSortKey(null);
      setSortDir("desc");
      return;
    }
    if (sortKey === key && sortDir === "desc") {
      setSortDir("asc");
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  }, [sortKey, sortDir]);

  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    try {
      const stored = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ColumnKey[];
        const validKeys = new Set<string>(ALL_COLUMNS.map(c => c.key));
        const sanitized = [...new Set(parsed.filter(k => validKeys.has(k)))];
        if (sanitized.length > 0) return sanitized as ColumnKey[];
      }
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

  const reorderColumns = useCallback((newOrder: ColumnKey[]) => {
    setVisibleColumns(newOrder);
    try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(newOrder)); } catch {}
  }, []);

  const resetColumns = useCallback(() => {
    setVisibleColumns(DEFAULT_COLUMNS);
    try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(DEFAULT_COLUMNS)); } catch {}
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
    const fetchAccountsWithRetry = async (attempts = 3) => {
      for (let i = 0; i < attempts; i++) {
        try {
          const r = await fetchWithAuth("/api/portfolio/accounts");
          if (!r.ok) throw new Error();
          const data = await r.json();
          if (data.length > 0) { setAccount(data[0]); setLastRefresh(new Date()); }
          setLoading(false);
          return;
        } catch {
          if (i < attempts - 1) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        }
      }
      if (!usePortfolioStreamStore.getState().account) setError("Failed to load portfolio data");
      setLoading(false);
    };
    fetchAccountsWithRetry();
    fetchWithAuth("/api/portfolio/orders?days=30").then(r => r.ok ? r.json() : Promise.reject()).then(data => { setOrders(data); }).catch(() => {});
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


  const streamPricesAll = useTerminalStore(s => s.streamPrices);

  const symbolGroups = useMemo(() => {
    const positions = account?.positions ?? [];
    const groupMap = new Map<string, SymbolGroup>();
    for (const pos of positions) {
      // Schwab returns multiple option assetTypes: OPTION (equity), INDEX_OPTION
      // (SPX/SPXW/RUT/NDX), and FUTURE_OPTION (/ES, /NQ etc). All three should
      // group under their underlying — otherwise SPX/futures option legs vanish.
      const isOptionLike = pos.assetType === "OPTION" || pos.assetType === "INDEX_OPTION" || pos.assetType === "FUTURE_OPTION";
      const rawKey = isOptionLike ? (pos.underlyingSymbol || pos.symbol) : pos.symbol;
      const key = rawKey.toUpperCase();
      if (!groupMap.has(key)) groupMap.set(key, { underlying: key, description: "", equity: null, options: [], totalMarketValue: 0, totalDayPL: 0, totalPL: 0, totalMaint: 0, totalCost: 0 });
      const g = groupMap.get(key)!;
      if (isOptionLike) g.options.push(pos); else { g.equity = pos; if (pos.description) g.description = pos.description; }
      g.totalMarketValue += pos.marketValue;
      g.totalDayPL += pos.currentDayProfitLoss;
      g.totalPL += pos.longOpenProfitLoss;
      g.totalMaint += pos.maintenanceRequirement;
      // Cost basis: averagePrice × signed qty × (100 for options, 1 for equity).
      // Sign comes from long vs short; magnitude is the absolute capital
      // committed (debits add, credits subtract — the absolute total is what
      // we use as the percent denominator).
      const signedQty = pos.longQuantity > 0 ? pos.longQuantity : -(pos.shortQuantity || 0);
      const multiplier = isOptionLike ? 100 : 1;
      g.totalCost += pos.averagePrice * signedQty * multiplier;
    }
    const groups = Array.from(groupMap.values());

    // Default ordering: largest absolute net liq first.
    const defaultSort = (a: SymbolGroup, b: SymbolGroup) =>
      Math.abs(b.totalMarketValue) - Math.abs(a.totalMarketValue);

    if (!sortKey) {
      return groups.sort(defaultSort);
    }

    // Pull a sortable value out of a group for the chosen column.
    const valueFor = (g: SymbolGroup): number | string | null => {
      if (sortKey === "symbol") return g.underlying;
      const sq = streamPricesAll[g.underlying.toUpperCase()] as { last?: number; regularLast?: number; close?: number; change?: number; changePct?: number } | undefined;
      const lastPx = sq?.regularLast ?? sq?.last ?? null;
      const costBasis = g.totalMarketValue - g.totalPL;
      // Match the row-level P/L % formula: cost basis denominator, with
      // market-value fallback for credit spreads where cost collapses to ~0.
      const plPct = Math.abs(g.totalCost) > 0.01
        ? (g.totalPL / Math.abs(g.totalCost)) * 100
        : Math.abs(g.totalMarketValue) > 0.01
          ? (g.totalPL / Math.abs(g.totalMarketValue)) * 100
          : 0;
      const prev = g.totalMarketValue - g.totalDayPL;
      const dayPct = Math.abs(prev) > 0.01 ? (g.totalDayPL / Math.abs(prev)) * 100 : 0;
      switch (sortKey) {
        case "mark":
        case "last":
        case "todayClose":
        case "yesterdayClose":
          return lastPx;
        case "plOpen":     return g.totalPL;
        case "plPct":      return plPct;
        case "plDay":      return g.totalDayPL;
        case "markChg":    return g.totalDayPL;
        case "markPctChg": return dayPct;
        case "netLiq":
        case "mktVal":     return g.totalMarketValue;
        case "totalCost":  return costBasis;
        case "maint":
        case "margin":     return g.totalMaint;
        case "bpEffect":   return g.totalMaint > 0 ? -g.totalMaint : null;
        case "qty":        return g.equity ? (g.equity.longQuantity || g.equity.shortQuantity) : g.options.length;
        case "cost":
        case "tradePrice": {
          if (g.equity) return g.equity.averagePrice;
          const tc = g.options.reduce((s, o) => s + (o.longQuantity || o.shortQuantity), 0);
          return tc > 0 ? g.options.reduce((s, o) => s + o.averagePrice * (o.longQuantity || o.shortQuantity), 0) / tc : null;
        }
        case "instrumentType": return g.equity ? "EQUITY" : "OPTION";
        default: return null;
      }
    };

    const dirMul = sortDir === "asc" ? 1 : -1;
    return groups.sort((a, b) => {
      const va = valueFor(a);
      const vb = valueFor(b);
      // Push nulls to the bottom regardless of direction.
      if (va == null && vb == null) return defaultSort(a, b);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb) * dirMul;
      }
      return ((va as number) - (vb as number)) * dirMul;
    });
  }, [account, sortKey, sortDir, streamPricesAll]);

  const totalUnrealized = useMemo(() => (account?.positions ?? []).reduce((s, p) => s + p.longOpenProfitLoss, 0), [account]);
  const totalMarketValue = useMemo(() => (account?.positions ?? []).reduce((s, p) => s + p.marketValue, 0), [account]);
  const unrealizedPct = Math.abs(totalMarketValue - totalUnrealized) > 0.01 ? (totalUnrealized / (totalMarketValue - totalUnrealized)) * 100 : 0;
  const grossMarketValue = useMemo(() => symbolGroups.reduce((s, g) => s + Math.abs(g.totalMarketValue), 0), [symbolGroups]);
  const totalDayPLPositions = useMemo(() => symbolGroups.reduce((s, g) => s + g.totalDayPL, 0), [symbolGroups]);
  const bestPerformer = useMemo(() => symbolGroups.length > 0 ? symbolGroups.reduce((b, g) => g.totalDayPL > b.totalDayPL ? g : b, symbolGroups[0]) : null, [symbolGroups]);
  const worstPerformer = useMemo(() => symbolGroups.length > 0 ? symbolGroups.reduce((w, g) => g.totalDayPL < w.totalDayPL ? g : w, symbolGroups[0]) : null, [symbolGroups]);

  useEffect(() => {
    const optionUnderlyings = new Set<string>();
    for (const g of symbolGroups) {
      if (g.options.length > 0) optionUnderlyings.add(g.underlying);
    }
    if (optionUnderlyings.size === 0) { setUpcomingEarnings(new Map()); return; }
    fetchWithAuth("/api/market/earnings-calendar")
      .then(r => r.ok ? r.json() : null)
      .then((data: { earnings?: Array<{ date: string; ticker: string; time: string }> } | null) => {
        if (!data?.earnings) return;
        const now = new Date();
        const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const map = new Map<string, { date: string; time: string }>();
        for (const e of data.earnings) {
          const sym = e.ticker?.toUpperCase();
          if (!sym || !optionUnderlyings.has(sym)) continue;
          const d = new Date(e.date);
          if (d >= now && d <= sevenDaysOut) {
            if (!map.has(sym)) map.set(sym, { date: e.date, time: e.time ?? "" });
          }
        }
        setUpcomingEarnings(map);
      })
      .catch(() => {});
  }, [symbolGroups]);

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

    const keys = [...selectedKeys];

    for (const key of keys) {
      const [underlying, rest] = key.split(":");
      if (rest === "EQ") {
        const grp = symbolGroups.find(g => g.underlying === underlying);
        if (grp?.equity) {
          const eq = grp.equity;
          onTrade(underlying, eq.shortQuantity > 0 ? "BUY" : "SELL", undefined, undefined, undefined, undefined, undefined, true);
        }
      }
    }

    const optKeys = keys.filter(k => !k.split(":")[1]?.includes("EQ"));

    const optsByUnderlying = new Map<string, Position[]>();
    for (const key of optKeys) {
      const [underlying, cusip] = key.split(":");
      for (const grp of symbolGroups) {
        const opt = grp.options.find(o => o.cusip === cusip);
        if (opt) {
          if (!optsByUnderlying.has(underlying)) optsByUnderlying.set(underlying, []);
          optsByUnderlying.get(underlying)!.push(opt);
          break;
        }
      }
    }

    for (const [, opts] of optsByUnderlying) {
      if (opts.length === 1) {
        const opt = opts[0];
        const isShort = opt.shortQuantity > 0;
        const qty = isShort ? opt.shortQuantity : opt.longQuantity;
        const markPx = qty > 0 ? opt.marketValue / (qty * 100) : 0;
        onTrade(
          opt.underlyingSymbol,
          isShort ? "BUY" : "SELL",
          opt.symbol.trim(),
          isShort ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE",
          undefined,
          Math.abs(markPx),
          undefined,
          true,
        );
      } else {
        const underlying = opts[0].underlyingSymbol;
        const legs: OrderLeg[] = opts.map(opt => {
          const isShort = opt.shortQuantity > 0;
          const qty = isShort ? opt.shortQuantity : opt.longQuantity;
          const markPx = Math.abs(qty > 0 ? opt.marketValue / (qty * 100) : 0);
          const details = parseOptionSymbolDetails(opt.symbol);
          return {
            schwabSymbol: opt.symbol.trim(),
            instruction: isShort ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE",
            quantity: qty,
            optionType: opt.putCall ?? details?.putCall ?? "CALL",
            strike: details?.strike ?? 0,
            expiration: details?.expiration ?? "",
            bid: Math.max(0, markPx * 0.97),
            ask: markPx * 1.03,
          };
        });

        let netPrice = 0;
        for (const leg of legs) {
          const isSell = leg.instruction.startsWith("SELL");
          const mid = ((leg.bid ?? 0) + (leg.ask ?? 0)) / 2;
          netPrice += isSell ? mid : -mid;
        }
        const isCredit = netPrice > 0;

        onTrade(underlying, isCredit ? "SELL" : "BUY", undefined, undefined, legs, Math.abs(netPrice), isCredit, true);
      }
    }

    setSelectedKeys(new Set());
  }, [selectedKeys, symbolGroups, onTrade]);

  const handleRollSelected = useCallback(() => {
    if (!onTrade) return;
    const optKeys = [...selectedKeys].filter(k => !k.endsWith(":EQ"));
    if (optKeys.length === 0) return;

    const underlying = optKeys[0].split(":")[0];

    const sameUnderlying = optKeys.filter(k => k.split(":")[0] === underlying);

    const opts: Position[] = [];
    for (const key of sameUnderlying) {
      const [, cusip] = key.split(":");
      for (const grp of symbolGroups) {
        const opt = grp.options.find(o => o.cusip === cusip);
        if (opt) { opts.push(opt); break; }
      }
    }

    if (opts.length === 1) {
      const opt = opts[0];
      const isShort = opt.shortQuantity > 0;
      const qty = isShort ? opt.shortQuantity : opt.longQuantity;
      const markPx = Math.abs(qty > 0 ? opt.marketValue / (qty * 100) : 0);
      onTrade(
        opt.underlyingSymbol,
        isShort ? "BUY" : "SELL",
        opt.symbol.trim(),
        isShort ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE",
        undefined,
        markPx,
        undefined,
        true,
      );
    } else if (opts.length > 1) {
      const legs: OrderLeg[] = opts.map(opt => {
        const isShort = opt.shortQuantity > 0;
        const qty = isShort ? opt.shortQuantity : opt.longQuantity;
        const markPx = Math.abs(qty > 0 ? opt.marketValue / (qty * 100) : 0);
        const details = parseOptionSymbolDetails(opt.symbol);
        return {
          schwabSymbol: opt.symbol.trim(),
          instruction: isShort ? "BUY_TO_CLOSE" : "SELL_TO_CLOSE",
          quantity: qty,
          optionType: opt.putCall ?? details?.putCall ?? "CALL",
          strike: details?.strike ?? 0,
          expiration: details?.expiration ?? "",
          bid: Math.max(0, markPx * 0.97),
          ask: markPx * 1.03,
        };
      });

      let netPrice = 0;
      for (const leg of legs) {
        const isSell = leg.instruction.startsWith("SELL");
        const mid = ((leg.bid ?? 0) + (leg.ask ?? 0)) / 2;
        netPrice += isSell ? mid : -mid;
      }
      const isCredit = netPrice > 0;
      onTrade(underlying, isCredit ? "SELL" : "BUY", undefined, undefined, legs, Math.abs(netPrice), isCredit, true);
    }

    setSelectedKeys(new Set());

    setTimeout(() => {
      if (onRoll) onRoll(underlying);
    }, 300);
  }, [selectedKeys, symbolGroups, onTrade, onRoll]);

  const portfolioRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = portfolioRootRef.current;
    if (!el) return;
    const scrollParent = el.closest(".app-content") as HTMLElement | null;
    if (!scrollParent) return;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => { startY = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - startY;
      const atTop = scrollParent.scrollTop <= 0;
      const atBottom = scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 1;
      if ((atTop && dy > 0) || (atBottom && dy < 0)) {
        e.preventDefault();
      }
    };
    scrollParent.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollParent.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      scrollParent.removeEventListener("touchstart", onTouchStart);
      scrollParent.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  if (!accessToken) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: f }}>
      <ConnectBrokerPrompt label="Connect Brokerage To View Portfolio" />
    </div>
  );
  if (portfolioStatus.status === "no_token" && !account) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: f }}>
      <div style={{ fontSize: 14, color: C.gold, letterSpacing: 1, textTransform: "uppercase" }}>SCHWAB SESSION EXPIRED</div>
      <div style={{ fontSize: 12, color: C.textDim, maxWidth: 320, textAlign: "center", lineHeight: 1.5 }}>Your Schwab session has expired. Reconnect to resume live portfolio updates.</div>
      <ReconnectSchwabButton />
    </div>
  );
  if (loading && !account) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: f }}>
      <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: C.gold }} />
      <div style={{ fontSize: 14, color: C.textDim, letterSpacing: 1, textTransform: "uppercase" }}>LOADING PORTFOLIO</div>
    </div>
  );
  if (error && !account) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: f }}>
      <div style={{ fontSize: 14, color: `${C.red}cc` }}>{error}</div>
      <button onClick={() => fetchAccount()} style={{ fontSize: 14, color: C.gold, background: "transparent", border: "none", cursor: "pointer", fontFamily: f, textTransform: "uppercase" }}>RETRY</button>
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
    <div ref={portfolioRootRef} style={{ fontFamily: f, position: "relative", width: "100%", minWidth: 0, paddingBottom: 16 }}>
      {showSettings && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "#000000cc", display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}
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
                  <span style={{ fontSize: 14, color: on ? C.text : C.dim }}>{m.label}</span>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: `1px solid ${on ? C.gold : C.dim}`, background: on ? `${C.gold}22` : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {on && <Check style={{ width: 10, height: 10, color: C.gold }} />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: C.bg,
          borderBottom: `1px solid ${C.borderHi}`,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "8px 12px 10px", gap: 4 }}>
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
                <span style={{ fontSize: 14, color: C.textMuted }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: clr as string, fontVariantNumeric: "tabular-nums" }}>{val}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", borderTop: `1px solid ${C.borderHi}` }}>
          {(["positions", "orders", "balance", "journal"] as SubTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              style={{
                flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.8,
                fontFamily: f, color: subTab === tab ? C.gold : C.dim, background: "transparent", border: "none",
                borderBottom: "2px solid transparent", cursor: "pointer",
              }}
            >
              {tab === "balance" ? "Balances" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        {subTab === "positions" && (
          <>
            {upcomingEarnings.size > 0 && (
              <div style={{ padding: "8px 12px", background: "rgba(251,146,60,0.07)", borderBottom: "1px solid rgba(251,146,60,0.2)", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <AlertTriangle style={{ width: 13, height: 13, color: "#fb923c", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fb923c", textTransform: "uppercase", letterSpacing: 0.5, flexShrink: 0 }}>Earnings Alert:</span>
                {Array.from(upcomingEarnings.entries()).map(([sym, info]) => (
                  <span key={sym} style={{ fontSize: 11, color: "rgba(251,146,60,0.85)", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)", borderRadius: 3, padding: "1px 6px" }}>
                    {sym} {info.date.slice(5)}{info.time === "bmo" ? " BMO" : info.time === "amc" ? " AMC" : ""}
                  </span>
                ))}
                <span style={{ fontSize: 10, color: C.dim }}>— open options positions with earnings this week. Review your positions.</span>
              </div>
            )}
            <div className="pf-hscroll" style={{ overflowX: "auto", width: "100%", overscrollBehaviorX: "none", touchAction: "pan-x pan-y" }}>
              <style>{`.pf-hscroll::-webkit-scrollbar{display:none}.pf-hscroll{scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior-x:none;touch-action:pan-x pan-y}.pf-hscroll table{border-collapse:separate;border-spacing:0}.pf-sticky-col{position:-webkit-sticky;position:sticky;left:0;z-index:2}.pf-hscroll tbody td,.pf-hscroll tbody th,.pf-hscroll thead th{border-bottom:1px solid ${C.border}}`}</style>

              {showColumnSettings && ReactDOM.createPortal(
                <ColumnSettingsPanel
                  visibleColumns={visibleColumns}
                  onToggle={toggleColumn}
                  onReorder={reorderColumns}
                  onReset={resetColumns}
                  onClose={() => setShowColumnSettings(false)}
                />,
                document.body
              )}

              <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th className="pf-sticky-col" style={{ background: "#0e0e0e", padding: "6px 8px 6px 12px", borderBottom: `1px solid ${C.borderHi}`, minWidth: SYM_COL_W, textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          onClick={() => cycleSort("symbol")}
                          style={{ padding: 0, background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "inherit" }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 500, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>Symbol</span>
                          {sortKey === "symbol" && (
                            <span style={{ fontSize: 9, color: C.dim }}>{sortDir === "asc" ? "▲" : "▼"}</span>
                          )}
                        </button>
                        <button aria-label="Column settings" onClick={() => setShowColumnSettings(x => !x)} style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer" }}>
                          <Settings style={{ width: 13, height: 13, color: showColumnSettings ? C.gold : C.dim }} />
                        </button>
                      </div>
                    </th>
                    {visibleColumns.map(key => {
                      const col = COLUMN_MAP.get(key);
                      if (!col) return null;
                      const isActive = sortKey === key;
                      return (
                        <th key={key} style={{ padding: 0, background: "#0e0e0e", borderBottom: `1px solid ${C.borderHi}`, whiteSpace: "nowrap", textAlign: "center", fontWeight: 600 }}>
                          <button
                            onClick={() => cycleSort(key)}
                            style={{ padding: "6px 8px", background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, width: "100%", fontFamily: "inherit" }}
                          >
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.6 }}>{col.label}</span>
                            {isActive && <span style={{ fontSize: 9, color: C.dim }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {symbolGroups.map(group => (
                    <PositionTableRow
                      key={group.underlying}
                      group={group}
                      onSelect={handleSelectSymbol}
                      onTrade={onTrade}
                      selectedKeys={selectedKeys}
                      toggleKey={toggleKey}
                      visibleColumns={visibleColumns}
                      earningsAlert={upcomingEarnings.get(group.underlying)}
                    />
                  ))}
                </tbody>
                {symbolGroups.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="pf-sticky-col" style={{ background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, padding: "8px 8px 8px 12px", minWidth: SYM_COL_W }}>
                        <span style={{ fontSize: 14, fontWeight: 500, color: C.textMuted, whiteSpace: "nowrap" }}>Totals</span>
                      </td>
                      {(() => {
                        const totalMaint = (account?.positions ?? []).reduce((s, p) => s + p.maintenanceRequirement, 0);
                        const totalCostBasis = totalMarketValue - totalUnrealized;
                        const footStyle = (color: string, bold?: boolean): React.CSSProperties => ({
                          fontSize: 14, fontWeight: bold ? 600 : 500, color,
                          textAlign: "center", fontVariantNumeric: "tabular-nums",
                          padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap",
                        });
                        const getFootVal = (col: ColumnKey): CellVal => {
                          switch (col) {
                            case "mktVal": case "netLiq": return { text: fmtCompact(totalMarketValue), color: C.text, bold: true };
                            case "plOpen": return { text: fmtCurrency(totalUnrealized), color: plColor(totalUnrealized), bold: true };
                            case "plPct": return { text: fmtPct(unrealizedPct), color: plColor(totalUnrealized), bold: true };
                            case "plDay": return { text: fmtCurrency(totalDayPLPositions), color: plColor(totalDayPLPositions), bold: true };
                            case "maint": case "margin": return { text: totalMaint > 0 ? fmtCompact(totalMaint) : "\u2014", color: C.textDim };
                            case "totalCost": return { text: fmtCompact(totalCostBasis), color: C.textDim };
                            case "bpEffect": return { text: totalMaint > 0 ? fmtCompact(-totalMaint) : "\u2014", color: C.textDim };
                            case "markPctChg": {
                              const prev = totalMarketValue - totalDayPLPositions;
                              const pct = Math.abs(prev) > 0.01 ? (totalDayPLPositions / Math.abs(prev)) * 100 : 0;
                              return { text: fmtPct(pct), color: plColor(totalDayPLPositions) };
                            }
                            case "markChg": return { text: fmtCurrency(totalDayPLPositions), color: plColor(totalDayPLPositions) };
                            default: return { text: "\u2014", color: C.dim };
                          }
                        };
                        return renderCells(visibleColumns, getFootVal, footStyle);
                      })()}
                    </tr>
                  </tfoot>
                )}
              </table>

              {symbolGroups.length === 0 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
                  <div style={{ fontSize: 14, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>No open positions</div>
                </div>
              )}
            </div>

            {symbolGroups.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: "4px 0", background: "#000" }}>
                {[
                  { label: "P/L Day:", value: `${fmtCurrency(dayPL)} (${dayReturnPct >= 0 ? "+" : ""}${dayReturnPct.toFixed(1)}%)`, color: plColor(dayPL) },
                  { label: "P/L Open:", value: fmtCurrency(totalUnrealized), color: plColor(totalUnrealized) },
                  { label: "Net Liq:", value: fmtCurrency(bal?.liquidationValue ?? 0), color: C.text },
                  { label: "Available $:", value: fmtCurrency(bal?.availableFunds ?? 0), color: (bal?.availableFunds ?? 0) < 0 ? C.red : C.text },
                  { label: "Position Equity:", value: fmtCurrency(bal?.equity ?? 0), color: C.text },
                  ...(dayTradesLeft !== null ? [{ label: "Day Trades Left:", value: String(dayTradesLeft), color: dayTradesLeft === 0 ? C.red : dayTradesLeft === 1 ? C.gold : C.text }] : []),
                ].map(row => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 12px" }}>
                    <span style={{ fontSize: 14, color: C.textMuted }}>{row.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: row.color, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </>
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
                <input type="text" value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Search orders..." style={{ flex: 1, padding: "5px 7px", fontSize: 14, fontFamily: f, background: "transparent", border: "none", outline: "none", color: C.text }} />
                {orderSearch && <button onClick={() => setOrderSearch("")} style={{ paddingRight: 6, background: "transparent", border: "none", cursor: "pointer", color: C.dim }}><XCircle style={{ width: 12, height: 12 }} /></button>}
              </div>
            </div>
            {ordersLoading && orders.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
                <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: C.gold }} />
                <div style={{ fontSize: 14, color: C.textDim, letterSpacing: 1, textTransform: "uppercase" }}>Loading orders</div>
              </div>
            ) : ordersError ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8 }}>
                <div style={{ fontSize: 14, color: `${C.red}cc` }}>Failed to load orders</div>
                <button onClick={fetchOrders} style={{ fontSize: 14, color: C.gold, background: "transparent", border: "none", cursor: "pointer", letterSpacing: 1, fontFamily: f, textTransform: "uppercase" }}>RETRY</button>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
                <div style={{ fontSize: 14, color: C.textDim }}>{orderFilter === "ALL" && !orderSearch ? "No recent orders" : "No matching orders"}</div>
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
                <span style={{ fontSize: 14, color: C.textMuted }}>{label}:</span>
                <span style={{ fontSize: 14, fontWeight: 400, color: (color as string) ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
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
                    <span style={{ fontSize: 14, color: C.textMuted }}>{label}:</span>
                    <span style={{ fontSize: 14, fontWeight: 400, color: (color as string) ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {subTab === "journal" && (
          <JournalTab />
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
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14, color: C.dim, background: "transparent", border: "none", cursor: "pointer", fontFamily: f, padding: "4px 6px" }}
          >
            <X style={{ width: 13, height: 13 }} />
            <span>{selectedKeys.size}</span>
          </button>
          <div style={{ flex: 1 }} />
          {hasOptSelected && (
            <button
              onClick={handleRollSelected}
              style={{
                fontSize: 14, fontWeight: 500, fontFamily: f, color: C.gold, letterSpacing: 0.3,
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
              fontSize: 14, fontWeight: 500, fontFamily: f, color: "#000", letterSpacing: 0.3,
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
