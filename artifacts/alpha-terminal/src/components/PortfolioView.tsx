import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import { useTerminalStore } from "@/lib/store";
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

type SubTab = "positions" | "orders" | "balance" | "journal";
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
const DEFAULT_COLUMNS: ColumnKey[] = ["mark", "plPct", "plDay", "mktVal"];
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
  description: string;
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

const getOuterGridCols = (n: number): string =>
  `minmax(140px, max-content) repeat(${n}, max-content)`;

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
  const totalPL = opt.longOpenProfitLoss;
  const totalPLPctOpt = opt.averagePrice > 0 ? (totalPL / (opt.averagePrice * qty * 100)) * 100 : 0;
  const markPx = qty > 0 ? opt.marketValue / (qty * 100) : 0;

  const tickDir = useValueFlash(markPx);
  const markColor = tickDir === "up" ? C.green : tickDir === "down" ? C.red : C.text;

  const rowBg = isSelected ? `${C.gold}08` : "transparent";
  const stickyBg = isSelected ? "#1a1700" : "#000";
  const bd = `1px solid ${C.border}`;

  return (
    <div style={{ display: "contents" }}>
      <div className="pf-sticky-col" style={{ background: stickyBg, borderBottom: bd, display: "flex", flexDirection: "column", gap: 1, padding: "5px 6px 5px 20px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Checkbox checked={isSelected} onToggle={e => { e.stopPropagation(); toggleKey(optKey); }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: opt.putCall === "CALL" ? "#4ade80" : "#fb923c", flexShrink: 0 }}>
            {opt.putCall === "CALL" ? "C" : "P"}
          </span>
          <span style={{ fontSize: 11, color: C.dim, whiteSpace: "nowrap" }}>
            {(() => { const d = formatOptionExpiry(opt.symbol); return d ? `${d.day} ${d.mon} ${d.yr}` : ""; })()}
          </span>
        </div>
        <div style={{ fontSize: 11, color: C.text, paddingLeft: 22 }}>
          {(() => { const d = formatOptionExpiry(opt.symbol); return d ? d.strike : ""; })()}{" "}
          <span style={{ color: C.dim }}>{isShort ? `-${qty}` : `+${qty}`}</span>
        </div>
      </div>
      {visibleColumns.includes("mark") && <span style={{ fontSize: 14, color: markColor, textAlign: "center", fontVariantNumeric: "tabular-nums", transition: "color 0.15s", padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap" }}>${markPx.toFixed(2)}</span>}
      {visibleColumns.includes("cost") && <span style={{ fontSize: 14, color: C.textDim, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap" }}>${opt.averagePrice.toFixed(2)}</span>}
      {visibleColumns.includes("qty") && <span style={{ fontSize: 14, color: C.text, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap" }}>{isShort ? `-${qty}` : `+${qty}`}</span>}
      {visibleColumns.includes("mktVal") && <span style={{ fontSize: 14, color: C.text, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap" }}>{fmtCompact(opt.marketValue)}</span>}
      {visibleColumns.includes("plOpen") && <span style={{ fontSize: 14, fontWeight: 500, color: plColor(totalPL), textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap" }}>{fmtCurrency(totalPL)}</span>}
      {visibleColumns.includes("plPct") && <span style={{ fontSize: 14, color: plColor(totalPL), textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap" }}>{fmtPct(totalPLPctOpt)}</span>}
      {visibleColumns.includes("plDay") && <span style={{ fontSize: 14, color: plColor(opt.currentDayProfitLoss), textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap" }}>{fmtCurrency(opt.currentDayProfitLoss)}</span>}
      {visibleColumns.includes("maint") && <span style={{ fontSize: 14, color: C.textDim, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap" }}>{opt.maintenanceRequirement > 0 ? fmtCompact(opt.maintenanceRequirement) : "—"}</span>}
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
  const costBasis = group.totalMarketValue - group.totalPL;
  const totalPLPct = Math.abs(costBasis) > 0.01 ? (group.totalPL / Math.abs(costBasis)) * 100 : 0;
  const eqKey = `${group.underlying}:EQ`;
  const eqSelected = eq != null && selectedKeys.has(eqKey);
  const someSelected = eqSelected || group.options.some(o => selectedKeys.has(`${group.underlying}:${o.cusip}`));

  const eqTickDir = useTickFlash(group.underlying);
  const markColor = eqTickDir === "up" ? C.green : eqTickDir === "down" ? C.red : C.text;
  const streamPrice = useTerminalStore(s => (s.streamPrices[group.underlying.toUpperCase()] as { last?: number } | undefined)?.last ?? null);

  const bd = `1px solid ${C.border}`;
  const rowBg = someSelected ? `${C.gold}06` : "transparent";
  const stickyBg = someSelected ? "#121008" : "#000";

  const dataCellStyle = (color: string, bold?: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: bold ? 500 : undefined, color,
    textAlign: "center", fontVariantNumeric: "tabular-nums",
    padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap",
  });

  if (!hasOptions) {
    return (
      <div style={{ display: "contents" }}>
        <div className="pf-sticky-col" style={{ background: eqSelected ? "#121008" : "#000", borderBottom: bd, display: "flex", alignItems: "center", padding: "6px 8px 6px 10px", minWidth: 0 }}>
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
        {visibleColumns.includes("mark") && (() => {
          const eqQty = eq ? (eq.longQuantity || eq.shortQuantity) : 0;
          const markPx = eq && eqQty > 0 ? eq.marketValue / eqQty : null;
          return <span style={{ ...dataCellStyle(markPx != null ? markColor : C.dim), transition: "color 0.15s" }}>{markPx != null ? `$${markPx.toFixed(2)}` : "—"}</span>;
        })()}
        {visibleColumns.includes("cost") && <span style={dataCellStyle(C.textDim)}>{eq ? `$${eq.averagePrice.toFixed(2)}` : "—"}</span>}
        {visibleColumns.includes("qty") && <span style={dataCellStyle(C.textDim)}>{eq ? fmtQty(eq.longQuantity, eq.shortQuantity) : "—"}</span>}
        {visibleColumns.includes("mktVal") && <span style={dataCellStyle(C.text)}>{fmtCompact(group.totalMarketValue)}</span>}
        {visibleColumns.includes("plOpen") && <span style={dataCellStyle(plColor(group.totalPL), true)}>{fmtCurrency(group.totalPL)}</span>}
        {visibleColumns.includes("plPct") && <span style={dataCellStyle(plColor(group.totalPL))}>{fmtPct(totalPLPct)}</span>}
        {visibleColumns.includes("plDay") && <span style={dataCellStyle(plColor(group.totalDayPL), true)}>{fmtCurrency(group.totalDayPL)}</span>}
        {visibleColumns.includes("maint") && <span style={dataCellStyle(C.textDim)}>{group.totalMaint > 0 ? fmtCompact(group.totalMaint) : "—"}</span>}
      </div>
    );
  }

  const groupDataCell = (color: string, bold?: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: bold ? 500 : undefined, color,
    textAlign: "center", fontVariantNumeric: "tabular-nums",
    padding: CP, background: rowBg, borderBottom: bd, whiteSpace: "nowrap", cursor: "pointer",
  });

  return (
    <>
      <div style={{ display: "contents" }} onClick={() => setExpanded(!expanded)}>
        <div className="pf-sticky-col" style={{ background: stickyBg, borderBottom: bd, display: "flex", alignItems: "center", padding: "6px 8px 6px 10px", minWidth: 0, cursor: "pointer" }}>
          <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {expanded ? <ChevronDown style={{ width: 15, height: 15, color: C.dim }} /> : <ChevronRight style={{ width: 15, height: 15, color: C.dim }} />}
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span onClick={e => { e.stopPropagation(); onSelect(group.underlying); }} style={{ fontSize: 14, fontWeight: 600, color: C.text, whiteSpace: "nowrap", cursor: "pointer" }}>{group.underlying}</span>
            {(COMPANY_NAMES[group.underlying] ?? group.description) && <span style={{ fontSize: 12, color: C.gold, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{COMPANY_NAMES[group.underlying] ?? group.description}</span>}
          </div>
        </div>
        {visibleColumns.includes("mark") && (() => {
          let markPx: number | null = null;
          if (eq) { const eqQty = eq.longQuantity || eq.shortQuantity; if (eqQty > 0) markPx = eq.marketValue / eqQty; }
          if (markPx == null && streamPrice != null) markPx = streamPrice;
          return <span style={{ ...groupDataCell(markPx != null ? markColor : C.dim), transition: "color 0.15s" }}>{markPx != null ? `$${markPx.toFixed(2)}` : "—"}</span>;
        })()}
        {visibleColumns.includes("cost") && (() => {
          if (eq) return <span style={groupDataCell(C.textDim)}>${eq.averagePrice.toFixed(2)}</span>;
          const tc = group.options.reduce((s, o) => s + (o.longQuantity || o.shortQuantity), 0);
          const avg = tc > 0 ? group.options.reduce((s, o) => s + o.averagePrice * (o.longQuantity || o.shortQuantity), 0) / tc : null;
          return <span style={groupDataCell(C.textDim)}>{avg != null ? `$${avg.toFixed(2)}` : "—"}</span>;
        })()}
        {visibleColumns.includes("qty") && (() => {
          if (eq && hasOptions) return <span style={groupDataCell(C.dim)}>—</span>;
          return <span style={groupDataCell(C.textDim)}>{eq ? fmtQty(eq.longQuantity, eq.shortQuantity) : hasOptions ? `${group.options.length}c` : "—"}</span>;
        })()}
        {visibleColumns.includes("mktVal") && <span style={groupDataCell(C.text)}>{fmtCompact(group.totalMarketValue)}</span>}
        {visibleColumns.includes("plOpen") && <span style={groupDataCell(plColor(group.totalPL), true)}>{fmtCurrency(group.totalPL)}</span>}
        {visibleColumns.includes("plPct") && <span style={groupDataCell(plColor(group.totalPL))}>{fmtPct(totalPLPct)}</span>}
        {visibleColumns.includes("plDay") && <span style={groupDataCell(plColor(group.totalDayPL), true)}>{fmtCurrency(group.totalDayPL)}</span>}
        {visibleColumns.includes("maint") && <span style={groupDataCell(C.textDim)}>{group.totalMaint > 0 ? fmtCompact(group.totalMaint) : "—"}</span>}
      </div>

      {expanded && (
        <>
          {eq && (() => {
            const eqPLPct = eq.averagePrice > 0 ? (eq.longOpenProfitLoss / (eq.averagePrice * (eq.shortQuantity > 0 ? eq.shortQuantity : eq.longQuantity))) * 100 : 0;
            const subBg = eqSelected ? `${C.gold}08` : "transparent";
            const subStickyBg = eqSelected ? "#1a1700" : "#000";
            const subCell = (color: string, bold?: boolean): React.CSSProperties => ({ fontSize: 14, fontWeight: bold ? 500 : undefined, color, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: subBg, borderBottom: bd, whiteSpace: "nowrap" });
            return (
              <div style={{ display: "contents" }}>
                <div className="pf-sticky-col" style={{ background: subStickyBg, borderBottom: bd, display: "flex", alignItems: "center", gap: 6, padding: "7px 6px 7px 20px", minWidth: 0 }}>
                  {hasOptions && <Checkbox checked={!!eqSelected} onToggle={e => { e.stopPropagation(); toggleKey(eqKey); }} />}
                  <span style={{ fontSize: 12, color: C.text, whiteSpace: "nowrap" }}>{fmtQty(eq.longQuantity, eq.shortQuantity)}</span>
                </div>
                {visibleColumns.includes("mark") && (() => { const eqQty = eq.longQuantity || eq.shortQuantity; const markPx = eqQty > 0 ? eq.marketValue / eqQty : 0; return <span style={{ ...subCell(markColor), transition: "color 0.15s" }}>${markPx.toFixed(2)}</span>; })()}
                {visibleColumns.includes("cost") && <span style={subCell(C.textDim)}>${eq.averagePrice.toFixed(2)}</span>}
                {visibleColumns.includes("qty") && <span style={subCell(C.text)}>{fmtQty(eq.longQuantity, eq.shortQuantity)}</span>}
                {visibleColumns.includes("mktVal") && <span style={subCell(C.text)}>{fmtCompact(eq.marketValue)}</span>}
                {visibleColumns.includes("plOpen") && <span style={subCell(plColor(eq.longOpenProfitLoss), true)}>{fmtCurrency(eq.longOpenProfitLoss)}</span>}
                {visibleColumns.includes("plPct") && <span style={subCell(plColor(eq.longOpenProfitLoss))}>{fmtPct(eqPLPct)}</span>}
                {visibleColumns.includes("plDay") && <span style={subCell(plColor(eq.currentDayProfitLoss))}>{fmtCurrency(eq.currentDayProfitLoss)}</span>}
                {visibleColumns.includes("maint") && <span style={subCell(C.textDim)}>{eq.maintenanceRequirement > 0 ? fmtCompact(eq.maintenanceRequirement) : "—"}</span>}
              </div>
            );
          })()}
          {group.options.map(opt => (
            <OptionRow key={opt.cusip} opt={opt} underlying={group.underlying} selectedKeys={selectedKeys} toggleKey={toggleKey} visibleColumns={visibleColumns} />
          ))}
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
  const { connect, isNavigating } = useBrokerConnect();
  return (
    <button
      onClick={connect}
      disabled={isNavigating}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "10px 24px", borderRadius: 8,
        border: `1px solid ${C.gold}4d`, background: `${C.gold}0d`,
        color: C.gold, fontSize: 12, fontFamily: f,
        letterSpacing: 1, textTransform: "uppercase" as const,
        cursor: "pointer", transition: "all 0.15s",
      }}
    >
      {isNavigating ? (
        <><Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />REDIRECTING...</>
      ) : (
        <><ExternalLink style={{ width: 14, height: 14 }} />RECONNECT SCHWAB</>
      )}
    </button>
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
    fetchWithAuth("/api/portfolio/accounts").then(r => r.ok ? r.json() : Promise.reject()).then(data => { if (data.length > 0) { setAccount(data[0]); setLastRefresh(new Date()); } setLoading(false); }).catch(() => { if (!usePortfolioStreamStore.getState().account) setError("Failed to load portfolio data"); setLoading(false); });
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

  const outerGridCols = useMemo(() => getOuterGridCols(visibleColumns.length), [visibleColumns.length]);

  const symbolGroups = useMemo(() => {
    const positions = account?.positions ?? [];
    const groupMap = new Map<string, SymbolGroup>();
    for (const pos of positions) {
      const key = (pos.assetType === "OPTION" ? pos.underlyingSymbol : pos.symbol).toUpperCase();
      if (!groupMap.has(key)) groupMap.set(key, { underlying: key, description: "", equity: null, options: [], totalMarketValue: 0, totalDayPL: 0, totalPL: 0, totalMaint: 0 });
      const g = groupMap.get(key)!;
      if (pos.assetType === "OPTION") g.options.push(pos); else { g.equity = pos; if (pos.description) g.description = pos.description; }
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
                borderBottom: subTab === tab ? `2px solid ${C.gold}` : "2px solid transparent", cursor: "pointer",
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
            <div className="pf-hscroll" style={{ overflowX: "auto", width: "100%", overscrollBehavior: "auto" }}>
              <style>{`.pf-hscroll::-webkit-scrollbar { display: none; } .pf-hscroll { scrollbar-width: none; -ms-overflow-style: none; touch-action: pan-x pan-y; } .pf-sticky-col { position: sticky; left: 0; z-index: 2; }`}</style>

              {showColumnSettings && ReactDOM.createPortal(
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setShowColumnSettings(false)} />
                  <div style={{ position: "fixed", top: "120px", left: "8px", zIndex: 50, background: "#161616", border: `1px solid ${C.borderHi}`, borderRadius: 6, width: 260, padding: 0, fontFamily: f, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }} onClick={e => e.stopPropagation()}>
                    <div style={{ padding: "10px 14px 8px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>Columns</span>
                      <span style={{ fontSize: 11, color: C.dim }}>{visibleColumns.length}/{ALL_COLUMNS.length} on</span>
                    </div>
                    {ALL_COLUMNS.map((col, i) => {
                      const on = visibleColumns.includes(col.key);
                      return (
                        <button key={col.key} onClick={() => toggleColumn(col.key)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: on ? `${C.gold}06` : "transparent", border: "none", borderBottom: i < ALL_COLUMNS.length - 1 ? `1px solid ${C.border}` : "none", cursor: "pointer", fontFamily: f, textAlign: "left" }}>
                          <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${on ? C.gold : C.dim}`, background: on ? `${C.gold}20` : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {on && <Check style={{ width: 11, height: 11, color: C.gold }} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: on ? 600 : 400, color: on ? C.text : C.dim }}>{col.label}</div>
                            <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{col.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>,
                document.body
              )}

              <div style={{ display: "grid", gridTemplateColumns: outerGridCols, alignItems: "center" }}>
                <div className="pf-sticky-col" style={{ zIndex: 3, background: "#0e0e0e", display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 12px", borderBottom: `1px solid ${C.borderHi}` }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>Symbol</span>
                  <button onClick={() => setShowColumnSettings(x => !x)} style={{ padding: 2, background: "transparent", border: "none", cursor: "pointer" }}>
                    <Settings style={{ width: 13, height: 13, color: showColumnSettings ? C.gold : C.dim }} />
                  </button>
                </div>
                {ALL_COLUMNS.filter(c => visibleColumns.includes(c.key)).map(c => (
                  <div key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 8px", background: "#0e0e0e", borderBottom: `1px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: 0.6 }}>{c.label}</span>
                  </div>
                ))}

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

                {symbolGroups.length > 0 && (
                  <>
                    <div className="pf-sticky-col" style={{ background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, padding: "8px 8px 8px 12px" }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: C.textMuted, whiteSpace: "nowrap" }}>Totals</span>
                    </div>
                    {visibleColumns.includes("mark")   && <span style={{ fontSize: 14, color: C.dim, textAlign: "center", padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>—</span>}
                    {visibleColumns.includes("cost")   && <span style={{ fontSize: 14, color: C.dim, textAlign: "center", padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>—</span>}
                    {visibleColumns.includes("qty")    && <span style={{ fontSize: 14, color: C.dim, textAlign: "center", padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>—</span>}
                    {visibleColumns.includes("mktVal") && <span style={{ fontSize: 14, fontWeight: 500, color: C.text, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>{fmtCompact(totalMarketValue)}</span>}
                    {visibleColumns.includes("plOpen") && <span style={{ fontSize: 14, fontWeight: 500, color: plColor(totalUnrealized), textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>{fmtCurrency(totalUnrealized)}</span>}
                    {visibleColumns.includes("plPct")  && <span style={{ fontSize: 14, fontWeight: 500, color: plColor(totalUnrealized), textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>{fmtPct(unrealizedPct)}</span>}
                    {visibleColumns.includes("plDay")  && <span style={{ fontSize: 14, fontWeight: 600, color: plColor(totalDayPLPositions), textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>{fmtCurrency(totalDayPLPositions)}</span>}
                    {visibleColumns.includes("maint")  && (() => {
                      const totalMaint = (account?.positions ?? []).reduce((s, p) => s + p.maintenanceRequirement, 0);
                      return <span style={{ fontSize: 14, color: C.textDim, textAlign: "center", fontVariantNumeric: "tabular-nums", padding: CP, background: "#0e0e0e", borderTop: `2px solid ${C.borderHi}`, whiteSpace: "nowrap" }}>{totalMaint > 0 ? fmtCompact(totalMaint) : "—"}</span>;
                    })()}
                  </>
                )}
              </div>

              {symbolGroups.length === 0 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
                  <div style={{ fontSize: 14, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>No open positions</div>
                </div>
              )}
            </div>

            {symbolGroups.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: "4px 0", background: "#000" }}>
                {[
                  { label: "P/L Day:", value: `${fmtCurrency(totalDayPLPositions)} (${dayReturnPct >= 0 ? "+" : ""}${dayReturnPct.toFixed(1)}%)`, color: plColor(totalDayPLPositions) },
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
