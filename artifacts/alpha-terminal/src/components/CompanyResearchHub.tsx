import { useState, useEffect, useCallback, useRef, useMemo, memo, type TouchEvent as ReactTouchEvent } from "react";
import { useTerminalStore } from "@/lib/store";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { consumeStream } from "@/lib/consumeStream";
import { useTechnicalsCache } from "@/hooks/useTechnicalsCache";
import { AiThinkingFeed } from "@/components/ai-shared/AiThinkingFeed";
import { Loader2, Activity, RefreshCw, Clock, X, ExternalLink } from "lucide-react";
import {
  useGetQuote, useGetPriceHistory,
} from "@workspace/api-client-react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const API_BASE = "/api";

const C = {
  bg: "#0c0c0c",
  card: "#18181b",
  border: "#27272a80",
  borderHi: "#3f3f46",
  text: "#e4e4e7",
  textSoft: "#d4d4d8",
  textMuted: "#a1a1aa",
  textDim: "#71717a",
  label: "#a1a1aa",
  dim: "#52525b",
  gold: "#FFB800",
  green: "#00d166",
  red: "#f23645",
  cyan: "#4dd0e1",
  amber: "#ffb74d",
  purple: "#b388ff",
};

const f = `'SFMono-Regular', 'SF Mono', ui-monospace, 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace`;
const tt: React.CSSProperties = { background: C.card, border: `1px solid ${C.borderHi}`, borderRadius: 8, fontFamily: f, fontSize: 13, color: C.text, padding: "8px 12px" };
const SUB_LABELS = ["Overview", "Financials", "SEC", "Ownership", "Valuation"] as const;
const FINANCIALS_TABS = [["income", "Income"], ["balance", "Balance"], ["cashflow", "Cash Flow"]] as const;
const CF_LEGEND = [["Operating", C.green], ["Investing", C.gold], ["Financing", C.textDim]] as const;
const SEC_FILTER_TYPES = ["ALL", "10-K", "10-Q", "8-K", "DEF 14A", "4", "SC 13G"] as const;
const SEC_TYPE_COLORS: Record<string, string> = { "10-K": C.gold, "10-Q": C.cyan, "8-K": C.amber, "DEF 14A": C.purple, "4": C.green, "SC 13G": C.textMuted, "SC 13G/A": C.textMuted, "S-3": C.textDim, "S-1": C.textDim };

interface FundamentalData {
  symbol: string;
  marketCap: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  eps: number | null;
  beta: number | null;
  dividendYield: number | null;
  high52: number | null;
  low52: number | null;
  error?: string;
}

interface CandleData {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function fmtMarketCap(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtShares(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString();
}

function fmtNum(n: number | null, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}


function Sec({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 14, fontFamily: f, fontWeight: 700, color: C.gold, letterSpacing: 2, textTransform: "uppercase", padding: "20px 0 12px" }}>{children}</div>;
}

function FundGrid({ items }: { items: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, padding: "16px 18px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 0" }}>
      {items.map((it, i) => (
        <div key={i}>
          <div style={{ fontSize: 11, fontFamily: f, fontWeight: 600, color: C.label, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>{it.label}</div>
          <div style={{ fontSize: 20, fontFamily: f, fontWeight: 700, color: it.color || C.text }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function RangeBar({ lo, hi, current }: { lo: number; hi: number; current: string }) {
  const pct = Math.max(0, Math.min(100, ((parseFloat(current) - lo) / (hi - lo)) * 100));
  return (
    <div style={{ padding: "12px 0 6px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1 }}>52W LOW <span style={{ color: C.textSoft }}>${lo.toFixed(2)}</span></span>
        <span style={{ fontSize: 11, fontFamily: f, color: C.green, fontWeight: 700, letterSpacing: 1 }}>${current}</span>
        <span style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1 }}>52W HIGH <span style={{ color: C.textSoft }}>${hi.toFixed(2)}</span></span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: `linear-gradient(to right, ${C.red}, ${C.gold} 50%, ${C.green})`, position: "relative" }}>
        <div style={{
          position: "absolute", top: -3, left: `${pct}%`, transform: "translateX(-50%)",
          width: 14, height: 14, borderRadius: 7, background: C.text, border: `3px solid ${C.bg}`,
        }} />
      </div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.textMuted, fontFamily: f }}>{label}</span>
      <span style={{ fontSize: 12, color: color || C.text, fontFamily: f, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Tag({ children, color = C.label }: { children: React.ReactNode; color?: string }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", fontSize: 12, fontFamily: f, fontWeight: 700, color, border: `1px solid ${color}55`, letterSpacing: 0.5 }}>{children}</span>;
}

function Badge({ children, color = C.gold }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{
      background: color + "18",
      border: `1px solid ${color}55`,
      color: color,
      fontSize: 11,
      fontFamily: f,
      letterSpacing: "0.12em",
      padding: "2px 7px",
      borderRadius: 6,
      textTransform: "uppercase",
      fontWeight: 700,
    }}>{children}</span>
  );
}

function CollapseSection({ label, children, defaultOpen = true }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          cursor: "pointer", paddingBottom: 8, marginBottom: 10,
          borderBottom: `1px solid ${C.border}`, userSelect: "none",
        }}
      >
        <span style={{ fontSize: 11, fontFamily: f, letterSpacing: "0.18em", color: C.gold, fontWeight: 700, textTransform: "uppercase" }}>{label}</span>
        <span style={{ color: C.textMuted, fontSize: 11 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && children}
    </div>
  );
}

type MGridItem = [string, React.ReactNode, string?];
function MGrid({ items }: { items: MGridItem[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 4 }}>
      {items.map(([label, value, sub], i) => (
        <div key={i}>
          <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2, fontFamily: f }}>{label}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.text, fontFamily: f, lineHeight: 1.2 }}>{value ?? <span style={{ color: C.textMuted }}>—</span>}</div>
          {sub && <div style={{ fontSize: 11, color: C.textDim, marginTop: 1, fontFamily: f }}>{sub}</div>}
        </div>
      ))}
    </div>
  );
}

function HeroMetrics({ items }: { items: [string, string, string, string][] }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`,
      gap: 1, marginBottom: 16, background: C.border, borderRadius: 6, overflow: "hidden",
    }}>
      {items.map(([label, value, sub, color]) => (
        <div key={label} style={{ background: C.card, padding: "12px 10px" }}>
          <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.12em", fontFamily: f, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: f }}>{value}</div>
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: f, marginTop: 2 }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

function SectorBar({ sector, weight, color }: { sector: string; weight: number; color: string }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: C.textDim, fontFamily: f }}>{sector}</span>
        <span style={{ fontSize: 11, color: C.text, fontFamily: f }}>{weight}%</span>
      </div>
      <div style={{ background: C.border, borderRadius: 2, height: 4, overflow: "hidden" }}>
        <div style={{ width: `${(weight / 35) * 100}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

const ETF_TICKERS = new Set(["SPY","QQQ","IWM","DIA","VOO","VTI","ARKK","XLF","XLE","XLK","XLV","XLY","XLP","XLI","XLB","XLU","XLRE","XLC","GLD","SLV","TLT","HYG","LQD","EEM","EFA","VEA","VWO","BND","AGG","SCHD","VIG","VYM","JEPI","JEPQ","IVV","VGT","SOXX","SMH","IBB","XBI","KWEB","ARKW","ARKG","ARKF","SQQQ","TQQQ","SPXL","SPXS","UVXY","VXX","USO","UNG"]);
function isETF(symbol: string): boolean {
  return ETF_TICKERS.has(symbol.toUpperCase());
}

const pos = (v: string) => <span style={{ color: C.green }}>{v}</span>;
const neg = (v: string) => <span style={{ color: C.red }}>{v}</span>;

interface AiAnalysis {
  priceAction?: { status: string; trend: string; momentum: string; bias: string };
  support?: { level: string; label: string; note: string }[];
  resistance?: { level: string; label: string; note: string }[];
  chartPattern?: { recent: string; range: string; setup: string };
  volumeAnalysis?: { today: string; todayLabel: string; elevated?: { date: string; vol: string }[]; pattern: string; signal: string };
  risks?: { type: string; desc: string; severity: string }[];
  criticalLevels?: { level: string; direction: string }[];
  outlook?: {
    shortTerm?: { timeframe: string; points: string[] };
    mediumTerm?: { timeframe: string; points: string[] };
    targets?: { upside: string[]; downside: string[] };
    rangePosition?: { pctFromLow: number; pctFromHigh: number };
  };
  valuation?: { peTrailing?: string; peForward?: string; peg?: string; priceBook?: string; priceSales?: string; evRevenue?: string; evEbitda?: string; earningsYield?: string };
  profitability?: { grossMargin?: string; opMargin?: string; netMargin?: string; ebitdaMargin?: string; roe?: string; roa?: string; roic?: string };
  growth?: { revYoY?: string; epsYoY?: string; fwdRevGrowth?: string; fwdEpsGrowth?: string };
  balanceSheet?: { totalDebt?: string; netDebt?: string; debtEquity?: string; currentRatio?: string; quickRatio?: string; interestCoverage?: string };
  cashFlow?: { fcfTTM?: string; fcfYield?: string; fcfPerShare?: string; fcfMargin?: string; capexRevenue?: string };
  dividends?: { yield?: string; annualDiv?: string; payoutRatio?: string; exDivDate?: string; frequency?: string };
  shareStructure?: { sharesShort?: string; shortPctFloat?: string; daysToCover?: string; instOwnership?: string; insiderOwnership?: string };
  earningsAnalyst?: { nextEarnings?: string; lastEpsSurprise?: string; consensus?: string; meanTarget?: string; numAnalysts?: string; impliedMove?: string };
  optionsProfile?: { ivRank?: string; ivPercentile?: string; iv30d?: string; putCallRatio?: string; shortInterest?: string; borrowRate?: string };
}

function parseAiAnalysis(text: string): AiAnalysis | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && (parsed.priceAction || parsed.support || parsed.outlook || parsed.valuation)) return parsed;
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch { /* nope */ }
    }
    const braceStart = text.indexOf("{");
    const braceEnd = text.lastIndexOf("}");
    if (braceStart >= 0 && braceEnd > braceStart) {
      try {
        const sub = text.slice(braceStart, braceEnd + 1);
        const p = JSON.parse(sub);
        if (p && typeof p === "object") return p;
      } catch { /* nope */ }
    }
  }
  return null;
}


interface QuoteInfo {
  symbol?: string;
  last?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  peRatio?: number;
  netChange?: number;
}

const SubOverview = memo(function SubOverview({ fund, quoteData, priceHist, volHist, ai }: {
  fund: FundamentalData | null;
  quoteData: QuoteInfo | null;
  priceHist: { w: string; p: number }[];
  volHist: { d: string; v: number }[];
  ai: AiAnalysis | null;
}) {
  const currentPrice = quoteData?.last;
  const high52 = fund?.high52 ?? quoteData?.fiftyTwoWeekHigh;
  const low52 = fund?.low52 ?? quoteData?.fiftyTwoWeekLow;
  const pe = fund?.peRatio ?? quoteData?.peRatio ?? null;
  const eps = fund?.eps ?? null;
  const beta = fund?.beta ?? null;
  const divYield = fund?.dividendYield ?? null;
  const chg = quoteData?.netChange ?? 0;
  const biasColor = ai?.priceAction?.bias?.includes("Bullish") ? C.green : ai?.priceAction?.bias?.includes("Bearish") ? C.red : C.gold;

  const colorVal = (v: string | undefined | null) => {
    if (!v) return <span style={{ color: C.textMuted }}>—</span>;
    const s = String(v);
    if (s.startsWith("+") || s.startsWith("$") && !s.includes("-")) return <span style={{ color: C.green }}>{s}</span>;
    if (s.startsWith("-")) return <span style={{ color: C.red }}>{s}</span>;
    return s;
  };

  const realPrice = currentPrice ?? 0;
  const meanTargetStr = ai?.earningsAnalyst?.meanTarget;
  const meanTarget = meanTargetStr ? +meanTargetStr.replace("$", "").replace(",", "") : null;
  const actualUpside = meanTarget != null && realPrice > 0 ? ((meanTarget - realPrice) / realPrice * 100) : null;

  return (
    <>



      {ai?.valuation && (
        <CollapseSection label="Valuation">
          <MGrid items={[
            ["P/E Trailing", ai.valuation.peTrailing ?? "—"],
            ["P/E Forward", ai.valuation.peForward ?? "—"],
            ["PEG Ratio", ai.valuation.peg ?? "—"],
            ["Price / Book", ai.valuation.priceBook ?? "—"],
            ["Price / Sales", ai.valuation.priceSales ?? "—"],
            ["EV / Revenue", ai.valuation.evRevenue ?? "—"],
            ["EV / EBITDA", ai.valuation.evEbitda ?? "—"],
            ["Earnings Yield", ai.valuation.earningsYield ?? "—"],
          ]} />
        </CollapseSection>
      )}

      {ai?.profitability && (
        <CollapseSection label="Profitability & Efficiency">
          <MGrid items={[
            ["Gross Margin", ai.profitability.grossMargin ?? "—"],
            ["Operating Margin", ai.profitability.opMargin ?? "—"],
            ["Net Margin", ai.profitability.netMargin ?? "—"],
            ["EBITDA Margin", ai.profitability.ebitdaMargin ?? "—"],
            ["ROE", ai.profitability.roe ?? "—"],
            ["ROA", ai.profitability.roa ?? "—"],
            ["ROIC", ai.profitability.roic ?? "—"],
          ]} />
        </CollapseSection>
      )}

      {ai?.growth && (
        <CollapseSection label="Growth & Thesis">
          <MGrid items={[
            ["Revenue Growth YoY", colorVal(ai.growth.revYoY)],
            ["EPS Growth YoY", colorVal(ai.growth.epsYoY)],
            ["Fwd Rev Growth", colorVal(ai.growth.fwdRevGrowth)],
            ["Fwd EPS Growth", colorVal(ai.growth.fwdEpsGrowth)],
          ]} />
        </CollapseSection>
      )}

      {ai?.balanceSheet && (
        <CollapseSection label="Balance Sheet">
          <MGrid items={[
            ["Total Debt", ai.balanceSheet.totalDebt ?? "—"],
            ["Net Debt", ai.balanceSheet.netDebt ?? "—"],
            ["Debt / Equity", ai.balanceSheet.debtEquity ?? "—"],
            ["Current Ratio", ai.balanceSheet.currentRatio ?? "—"],
            ["Quick Ratio", ai.balanceSheet.quickRatio ?? "—"],
            ["Interest Coverage", ai.balanceSheet.interestCoverage ?? "—"],
          ]} />
        </CollapseSection>
      )}

      {ai?.cashFlow && (
        <CollapseSection label="Cash Flow">
          <MGrid items={[
            ["FCF (TTM)", ai.cashFlow.fcfTTM ?? "—"],
            ["FCF Yield", ai.cashFlow.fcfYield ?? "—"],
            ["FCF Per Share", ai.cashFlow.fcfPerShare ?? "—"],
            ["FCF Margin", ai.cashFlow.fcfMargin ?? "—"],
            ["CapEx / Revenue", ai.cashFlow.capexRevenue ?? "—"],
          ]} />
        </CollapseSection>
      )}

      {ai?.dividends && (
        <CollapseSection label="Dividends" defaultOpen={false}>
          <MGrid items={[
            ["Dividend Yield", ai.dividends.yield ?? "—"],
            ["Annual Div/Share", ai.dividends.annualDiv ?? "—"],
            ["Payout Ratio", ai.dividends.payoutRatio ?? "—"],
            ["Ex-Div Date", ai.dividends.exDivDate ?? "—"],
            ["Frequency", ai.dividends.frequency ?? "—"],
          ]} />
        </CollapseSection>
      )}

      {ai?.shareStructure && (
        <CollapseSection label="Share Structure">
          <MGrid items={[
            ["Market Cap", fmtMarketCap(fund?.marketCap ?? null)],
            ["Shares Outstanding", fmtShares(fund?.sharesOutstanding ?? null)],
            ["Shares Short", ai.shareStructure.sharesShort ?? "—"],
            ["Short % Float", ai.shareStructure.shortPctFloat ?? "—"],
            ["Days to Cover", ai.shareStructure.daysToCover ?? "—"],
            ["Inst. Ownership", ai.shareStructure.instOwnership ?? "—"],
            ["Insider Ownership", ai.shareStructure.insiderOwnership ?? "—"],
          ]} />
        </CollapseSection>
      )}

      {ai?.earningsAnalyst && (
        <CollapseSection label="Earnings & Analyst">
          <MGrid items={[
            ["Next Earnings", ai.earningsAnalyst.nextEarnings ?? "—"],
            ["Last EPS Surprise", colorVal(ai.earningsAnalyst.lastEpsSurprise)],
            ["Consensus", ai.earningsAnalyst.consensus ? <Badge key="consensus" color={ai.earningsAnalyst.consensus.includes("BUY") ? C.green : ai.earningsAnalyst.consensus.includes("SELL") ? C.red : C.gold}>{ai.earningsAnalyst.consensus}</Badge> : "—"],
            ["Mean Price Target", meanTargetStr ?? "—"],
            ...(actualUpside != null ? [[
              actualUpside >= 0 ? "Upside to Target" : "Downside to Target",
              actualUpside >= 0
                ? pos(`+${actualUpside.toFixed(1)}%`)
                : neg(`${actualUpside.toFixed(1)}%`),
            ] as MGridItem] : []),
            ["# of Analysts", ai.earningsAnalyst.numAnalysts ?? "—"],
            ["Implied Move", ai.earningsAnalyst.impliedMove ?? "—", "Next earnings"],
          ]} />
        </CollapseSection>
      )}

      {ai?.optionsProfile && (
        <CollapseSection label="Options Profile">
          <MGrid items={[
            ["IV Rank", ai.optionsProfile.ivRank ?? "—"],
            ["IV Percentile", ai.optionsProfile.ivPercentile ?? "—"],
            ["30D Implied Vol", ai.optionsProfile.iv30d ?? "—"],
            ["Put/Call Ratio (OI)", ai.optionsProfile.putCallRatio ?? "—"],
            ["Short Interest", ai.optionsProfile.shortInterest ?? "—"],
            ["Borrow Rate", ai.optionsProfile.borrowRate ?? "—"],
          ]} />
        </CollapseSection>
      )}


      {ai?.priceAction && (
        <CollapseSection label="Price Action">
          <MGrid items={[
            ["Status", ai.priceAction.status],
            ["Bias", <Badge key="bias" color={biasColor}>{ai.priceAction.bias?.includes("Bullish") ? "▲" : ai.priceAction.bias?.includes("Bearish") ? "▼" : "◆"} {ai.priceAction.bias}</Badge>],
            ["Trend", ai.priceAction.trend],
            ["Momentum", <span key="mom" style={{ color: chg >= 0 ? C.green : C.red }}>{ai.priceAction.momentum}</span>],
          ]} />
        </CollapseSection>
      )}

      {(ai?.support || ai?.resistance) && (
        <CollapseSection label="Support / Resistance">
          <MGrid items={[
            ...(ai?.support || []).map((s) => [`▼ ${s.label}`, <span key={s.label} style={{ color: C.red }}>{s.level}</span>, s.note] as MGridItem),
            ...(ai?.resistance || []).map((s) => [`▲ ${s.label}`, <span key={s.label} style={{ color: C.green }}>{s.level}</span>, s.note] as MGridItem),
          ]} />
        </CollapseSection>
      )}

      {ai?.chartPattern && (
        <CollapseSection label="Chart Patterns">
          <MGrid items={[
            ["Recent Pattern", ai.chartPattern.recent],
            ["Trading Range", ai.chartPattern.range],
            ["Current Setup", ai.chartPattern.setup],
          ]} />
        </CollapseSection>
      )}

      {ai?.volumeAnalysis && (
        <CollapseSection label="Volume Analysis">
          <MGrid items={[
            ["Today", ai.volumeAnalysis.today],
            ["Activity", <Badge key="vol-label" color={ai.volumeAnalysis.todayLabel === "elevated" || ai.volumeAnalysis.todayLabel === "heavy" ? C.amber : C.label}>{ai.volumeAnalysis.todayLabel?.toUpperCase()}</Badge>],
            ["Pattern", ai.volumeAnalysis.pattern],
            ["Signal", ai.volumeAnalysis.signal],
            ...(ai.volumeAnalysis.elevated || []).map((e) => [e.date, <span key={e.date} style={{ color: C.amber }}>{e.vol}</span>, "Elevated"] as MGridItem),
          ]} />
        </CollapseSection>
      )}

      {ai?.risks && ai.risks.length > 0 && (
        <CollapseSection label="Risk Assessment">
          <MGrid items={[
            ...ai.risks.map((r) => [r.type, r.desc, r.severity === "high" ? "HIGH" : "MEDIUM"] as MGridItem),
            ...(ai.criticalLevels || []).map((cl) => ["Critical Level", <span key={cl.level} style={{ color: cl.direction?.includes("bearish") ? C.red : C.green }}>{cl.level}</span>, cl.direction] as MGridItem),
          ]} />
        </CollapseSection>
      )}

      {ai?.outlook && (
        <CollapseSection label="Trading Outlook">
          <MGrid items={[
            ...(ai.outlook.shortTerm?.points || []).map((p, i) => [`Short (${ai.outlook!.shortTerm!.timeframe})`, p] as MGridItem).slice(0, 2),
            ...(ai.outlook.mediumTerm?.points || []).map((p, i) => [`Medium (${ai.outlook!.mediumTerm!.timeframe})`, p] as MGridItem).slice(0, 2),
            ...(ai.outlook.targets?.upside || []).map((t) => ["▲ Upside Target", <span key={t} style={{ color: C.green }}>{t}</span>] as MGridItem),
            ...(ai.outlook.targets?.downside || []).map((t) => ["▼ Downside Target", <span key={t} style={{ color: C.red }}>{t}</span>] as MGridItem),
            ...(ai.outlook.rangePosition ? [["52W From Low", `${ai.outlook.rangePosition.pctFromLow}%`] as MGridItem, ["52W From High", `${ai.outlook.rangePosition.pctFromHigh}%`] as MGridItem] : []),
          ]} />
        </CollapseSection>
      )}
    </>
  );
});

interface FinancialPeriod {
  end: string;
  val: number;
  form: string;
  fy: number;
  fp: string;
  filed: string;
}

interface CompanyFinancialsData {
  revenue: FinancialPeriod[];
  netIncome: FinancialPeriod[];
  operatingIncome: FinancialPeriod[];
  eps: FinancialPeriod[];
  totalAssets: FinancialPeriod[];
  totalLiabilities: FinancialPeriod[];
  stockholdersEquity: FinancialPeriod[];
  cash: FinancialPeriod[];
  sharesOutstanding: FinancialPeriod[];
  grossProfit: FinancialPeriod[];
}

function useCompanyFinancials(ticker: string) {
  const [data, setData] = useState<CompanyFinancialsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    if (fetchedRef.current === ticker && retryCount === 0) return;
    fetchedRef.current = ticker;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/sec/company-financials?symbol=${encodeURIComponent(ticker)}`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json.financials || null);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load financials");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, retryCount]);

  return { data, loading, error, retry: () => { setRetryCount(c => c + 1); } };
}


interface AnalystRating {
  id: string;
  date: string;
  ticker: string;
  name: string;
  analyst: string;
  analystName: string;
  actionCompany: string;
  ratingCurrent: string;
  ratingPrior: string;
  ptCurrent: string | null;
  ptPrior: string | null;
  ptPctChange: string | null;
  importance: number;
  url: string;
}

const actionColors: Record<string, string> = {
  Upgrades: C.green,
  Downgrades: C.red,
  Initiates: C.gold,
  Maintains: C.textMuted,
  Reiterates: C.textMuted,
};

interface AnalystInsight {
  id: string;
  date: string;
  firm: string;
  action: string;
  rating: string;
  priceTarget: string | null;
  summary: string;
  ticker: string;
  name: string;
}

const SubAnalystRatings = memo(function SubAnalystRatings({ ticker }: { ticker: string }) {
  const [ratings, setRatings] = useState<AnalystRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [insightsList, setInsightsList] = useState<AnalystInsight[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRatings([]);
    setInsightsList([]);
    Promise.all([
      fetch(`${API_BASE}/market/analyst-ratings?symbol=${ticker}`).then(r => r.json()).catch(() => ({ ratings: [] })),
      fetch(`${API_BASE}/market/analyst-insights?symbol=${ticker}`).then(r => r.json()).catch(() => ({ insights: [] })),
    ]).then(([ratingsData, insightsData]) => {
      if (cancelled) return;
      setRatings(ratingsData.ratings || []);
      setInsightsList(insightsData.insights || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, textAlign: "center" }}>
        <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: C.gold }} />
        <p className="font-mono text-xs mt-2" style={{ color: C.textDim }}>Loading analyst data...</p>
      </div>
    );
  }

  if (ratings.length === 0 && insightsList.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 className="font-mono font-bold text-xs tracking-widest" style={{ color: C.gold }}>ANALYST RATINGS</h3>

      {insightsList.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {insightsList.slice(0, 3).map(ins => (
            <div key={ins.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span className="font-mono text-[11px] font-bold" style={{ color: C.gold }}>{ins.firm}</span>
                <span className="font-mono text-[10px]" style={{ color: C.textDim }}>{ins.rating}</span>
                {ins.priceTarget && <span className="font-mono text-[10px] font-bold" style={{ color: C.text }}>PT ${parseFloat(ins.priceTarget).toFixed(0)}</span>}
                <span className="font-mono text-[10px]" style={{ color: C.textDim }}>{ins.date}</span>
              </div>
              <p className="font-mono text-[11px] leading-relaxed" style={{ color: C.textSoft }}>{ins.summary}</p>
            </div>
          ))}
        </div>
      )}

      {ratings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ratings.slice(0, 10).map(r => {
            const actionColor = actionColors[r.actionCompany] || C.textMuted;
            const ptChange = r.ptPrior && r.ptCurrent
              ? parseFloat(r.ptCurrent) - parseFloat(r.ptPrior)
              : null;

            return (
              <div
                key={r.id}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span className="font-mono text-[11px] font-bold" style={{ color: actionColor }}>
                      {r.actionCompany.toUpperCase()}
                    </span>
                    <span className="font-mono text-[11px]" style={{ color: C.textMuted }}>
                      {r.analystName || r.analyst}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                    <span className="font-mono text-[11px]" style={{ color: C.text }}>{r.ratingCurrent}</span>
                    {r.ratingPrior && r.ratingPrior !== r.ratingCurrent && (
                      <span className="font-mono text-[10px]" style={{ color: C.textDim }}>
                        (was {r.ratingPrior})
                      </span>
                    )}
                    {r.ptCurrent && (
                      <span className="font-mono text-[11px] font-bold" style={{ color: C.text }}>
                        PT ${parseFloat(r.ptCurrent).toFixed(0)}
                      </span>
                    )}
                    {ptChange !== null && ptChange !== 0 && (
                      <span className="font-mono text-[10px]" style={{ color: ptChange > 0 ? C.green : C.red }}>
                        {ptChange > 0 ? "▲" : "▼"} ${Math.abs(ptChange).toFixed(0)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-mono text-[10px] shrink-0" style={{ color: C.textDim }}>
                  {r.date}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

const SubFinancials = memo(function SubFinancials({ ticker }: { ticker: string }) {
  const [view, setView] = useState("income");
  const { data: fin, loading, error, retry } = useCompanyFinancials(ticker);

  const revChart = useMemo(() => {
    if (!fin) return [];
    return fin.revenue
      .filter(r => r.form === "10-K")
      .slice(-5)
      .map(r => ({ yr: `FY${String(r.fy).slice(-2)}`, val: +(r.val / 1e9).toFixed(1) }));
  }, [fin]);

  const epsChart = useMemo(() => {
    if (!fin) return [];
    return fin.eps
      .filter(r => r.form === "10-K")
      .slice(-5)
      .map(r => ({ yr: `FY${String(r.fy).slice(-2)}`, val: +r.val.toFixed(2) }));
  }, [fin]);

  const bsData = useMemo(() => {
    if (!fin) return null;
    const latest = (arr: FinancialPeriod[]) => arr.filter(r => r.form === "10-K").slice(-1)[0];
    const a = latest(fin.totalAssets);
    const l = latest(fin.totalLiabilities);
    const e = latest(fin.stockholdersEquity);
    const c = latest(fin.cash);
    const assets = a ? a.val / 1e9 : 0;
    const liab = l ? l.val / 1e9 : 0;
    const equity = e ? e.val / 1e9 : 0;
    const cash = c ? c.val / 1e9 : 0;
    const curRatio = liab > 0 ? assets / liab : 0;
    const deRatio = equity > 0 ? liab / equity : 0;
    return {
      assets: assets.toFixed(1),
      liab: liab.toFixed(1),
      equity: equity.toFixed(1),
      cash: cash.toFixed(1),
      curRatio: curRatio.toFixed(2),
      deRatio: deRatio.toFixed(2),
    };
  }, [fin]);

  const cfChart = useMemo(() => {
    if (!fin) return [];
    const annualNI = fin.netIncome.filter(r => r.form === "10-K").slice(-3);
    const annualOI = fin.operatingIncome.filter(r => r.form === "10-K").slice(-3);
    return annualNI.map((ni, i) => ({
      yr: `FY${String(ni.fy).slice(-2)}`,
      op: annualOI[i] ? +(annualOI[i].val / 1e9).toFixed(1) : 0,
      inv: 0,
      fin: +(ni.val / 1e9).toFixed(1),
    }));
  }, [fin]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, marginLeft: 10 }}>Loading financials...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center" }}>
        <span style={{ fontSize: 11, fontFamily: f, color: C.red }}>{error}</span>
        <button onClick={retry}
          style={{ display: "block", margin: "10px auto 0", fontSize: 11, fontFamily: f, color: C.gold, background: "transparent", border: `1px solid ${C.gold}44`, padding: "4px 12px", cursor: "pointer" }}>
          RETRY
        </button>
      </div>
    );
  }

  if (!fin) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", fontSize: 11, fontFamily: f, color: C.textDim }}>
        No financial data available
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 4px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {FINANCIALS_TABS.map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} style={{
              padding: "4px 12px", fontSize: 11, fontFamily: f, fontWeight: 600,
              color: view === id ? C.bg : C.textMuted,
              background: view === id ? C.gold : "transparent",
              border: `1px solid ${view === id ? C.gold : C.borderHi}`,
              borderRadius: 14, cursor: "pointer", letterSpacing: 0.5,
            }}>{label}</button>
          ))}
        </div>
        <span style={{ fontSize: 11, fontFamily: f, color: C.textDim }}>SEC XBRL</span>
      </div>

      {view === "income" && (
        <>
          {revChart.length > 0 && (
            <>
              <Sec>REVENUE ($B)</Sec>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={revChart}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="yr" tick={{ fill: C.textDim, fontSize: 11, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis tick={{ fill: C.textDim, fontSize: 11, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <Tooltip contentStyle={tt} />
                  <Bar dataKey="val" fill={C.gold} radius={[2, 2, 0, 0]} name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
          {epsChart.length > 0 && (
            <>
              <Sec>EPS TREND</Sec>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={epsChart}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="yr" tick={{ fill: C.textDim, fontSize: 11, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis tick={{ fill: C.textDim, fontSize: 11, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <Tooltip contentStyle={tt} />
                  <Line type="monotone" dataKey="val" stroke={C.green} strokeWidth={2} dot={{ fill: C.green, r: 3, strokeWidth: 0 }} name="EPS" />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
          {revChart.length === 0 && epsChart.length === 0 && (
            <div style={{ padding: "20px 0", textAlign: "center", fontSize: 11, fontFamily: f, color: C.textDim }}>
              No income statement data available
            </div>
          )}
        </>
      )}

      {view === "balance" && bsData && (
        <>
          <Sec>BALANCE SHEET ($B)</Sec>
          <FundGrid items={[
            { label: "Total Assets", value: `$${bsData.assets}B` },
            { label: "Liabilities", value: `$${bsData.liab}B`, color: C.red },
            { label: "Equity", value: `$${bsData.equity}B`, color: C.green },
            { label: "Cash", value: `$${bsData.cash}B`, color: C.gold },
            { label: "Cur Ratio", value: bsData.curRatio, color: +bsData.curRatio >= 1.5 ? C.green : C.gold },
          ]} />
          <div style={{ marginTop: 12 }}>
            <MetricRow label="Debt/Equity" value={bsData.deRatio} color={+bsData.deRatio <= 1 ? C.green : C.red} />
          </div>
        </>
      )}

      {view === "balance" && !bsData && (
        <div style={{ padding: "20px 0", textAlign: "center", fontSize: 11, fontFamily: f, color: C.textDim }}>
          No balance sheet data available
        </div>
      )}

      {view === "cashflow" && (
        <>
          <Sec>INCOME BREAKDOWN ($B)</Sec>
          {cfChart.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cfChart}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="yr" tick={{ fill: C.textDim, fontSize: 11, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <YAxis tick={{ fill: C.textDim, fontSize: 11, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
                  <Tooltip contentStyle={tt} />
                  <Bar dataKey="op" fill={C.green} name="Operating Income" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="fin" fill={C.gold} name="Net Income" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", gap: 14, padding: "6px 0" }}>
                {[["Operating", C.green], ["Net Income", C.gold]].map(([l, c]) => (
                  <span key={l} style={{ fontSize: 11, fontFamily: f, color: C.textDim }}><span style={{ color: c as string }}>■</span> {l}</span>
                ))}
              </div>
            </>
          ) : (
            <div style={{ padding: "20px 0", textAlign: "center", fontSize: 11, fontFamily: f, color: C.textDim }}>
              No cash flow data available
            </div>
          )}
        </>
      )}
    </>
  );
});

interface EdgarFiling {
  id: string;
  formType: string;
  filedAt: string;
  description: string;
  url: string;
  accessionNo: string;
}

interface SecFilingsResponse {
  filings: EdgarFiling[];
  cik: string | null;
  symbol: string;
  error?: string;
}

const SubSEC = memo(function SubSEC({ ticker }: { ticker: string }) {
  const { openBrowser } = useTerminalStore();
  const [filter, setFilter] = useState("ALL");
  const [data, setData] = useState<SecFilingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ticker || fetchedRef.current === ticker) return;
    fetchedRef.current = ticker;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setFilter("ALL");
      try {
        const res = await fetch(`${API_BASE}/sec/filings?symbol=${encodeURIComponent(ticker)}`);
        if (!res.ok) throw new Error(`SEC API returned ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load SEC filings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  const types = SEC_FILTER_TYPES;
  const tc = SEC_TYPE_COLORS;

  const filings = data?.filings ?? [];
  const cik = data?.cik;
  const cikNumeric = cik ? String(parseInt(cik)) : null;

  const filtered = filter === "ALL"
    ? filings
    : filings.filter(fi => fi.formType === filter || fi.formType.startsWith(filter + "/"));

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, marginLeft: 10 }}>Loading SEC filings...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center" }}>
        <span style={{ fontSize: 11, fontFamily: f, color: C.red }}>{error}</span>
        <button onClick={() => { fetchedRef.current = null; setData(null); setError(null); }}
          style={{ display: "block", margin: "10px auto 0", fontSize: 11, fontFamily: f, color: C.gold, background: "transparent", border: `1px solid ${C.gold}44`, padding: "4px 12px", cursor: "pointer" }}>
          RETRY
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 8px" }}>
        <div>
          <span style={{ fontSize: 12, fontFamily: f, fontWeight: 700, color: C.gold, letterSpacing: 1.5 }}>SEC EDGAR</span>
          {cik && <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, marginLeft: 10 }}>CIK {cik}</span>}
        </div>
        <a href={cikNumeric
            ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNumeric}&type=&dateb=&owner=include&count=40`
            : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&CIK=&type=&dateb=&owner=include&count=40`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, fontFamily: f, fontWeight: 700, color: C.gold, textDecoration: "none", letterSpacing: 1, padding: "3px 8px", border: `1px solid ${C.gold}44` }}>
          EDGAR ↗
        </a>
      </div>

      <div style={{ fontSize: 11, fontFamily: f, color: C.textDim, paddingBottom: 8 }}>
        {filings.length} filings loaded • Real-time EDGAR data
      </div>

      <div style={{ display: "flex", gap: 5, paddingBottom: 10, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        {types.map(t => {
          const count = t === "ALL" ? filings.length : filings.filter(fi => fi.formType === t || fi.formType.startsWith(t + "/")).length;
          return (
            <button key={t} onClick={() => { setFilter(t); }} style={{
              padding: "2px 8px", fontSize: 11, fontFamily: f, fontWeight: 600,
              color: filter === t ? C.bg : C.textDim,
              background: filter === t ? (tc[t] || C.gold) : "transparent",
              border: `1px solid ${filter === t ? "transparent" : C.borderHi}`,
              cursor: "pointer", letterSpacing: 0.5,
              opacity: count === 0 && t !== "ALL" ? 0.35 : 1,
            }}>{t} {count > 0 && t !== "ALL" ? `(${count})` : ""}</button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: "20px 0", textAlign: "center", fontSize: 11, fontFamily: f, color: C.textDim }}>
          No {filter === "ALL" ? "" : filter + " "}filings found
        </div>
      )}

      {filtered.map((fi, i) => {
        const c = tc[fi.formType] || tc[fi.formType.split("/")[0]] || C.textDim;
        return (
          <div key={fi.id || i} onClick={() => {
              const contentUrl = `${API_BASE}/sec/filing-content?url=${encodeURIComponent(fi.url)}`;
              openBrowser(contentUrl, `${fi.formType} — ${fi.description}`, "SEC EDGAR");
            }}
            style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <Tag color={c}>{fi.formType}</Tag>
                <span style={{ fontSize: 11, fontFamily: f, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fi.description}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 8 }}>
                <span style={{ fontSize: 11, fontFamily: f, color: C.textDim }}>{fi.filedAt}</span>
              </div>
            </div>
          </div>
        );
      })}

      <Sec>QUICK LINKS</Sec>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {[
          ["Full-Text Search", `https://efts.sec.gov/LATEST/search-index?q=${ticker}`],
          ["Insider Filings", cikNumeric ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNumeric}&type=4&count=40` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=4&count=40`],
          ["Ownership (13F)", cikNumeric ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNumeric}&type=SC%2013&count=40` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=SC%2013&count=40`],
          ["Annual Reports", cikNumeric ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNumeric}&type=10-K&count=10` : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=10-K&count=10`],
        ].map(([label, url], i) => (
          <a key={i} href={url as string} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, fontFamily: f, color: C.gold, textDecoration: "none", padding: "7px 8px", border: `1px solid ${C.border}`, display: "block" }}>
            {label} ↗
          </a>
        ))}
      </div>
    </>
  );
});

interface InsiderTxn {
  ownerName: string;
  officerTitle: string;
  transactionDate: string;
  shares: number;
  pricePerShare: number | null;
  acquiredOrDisposed: string;
  filingUrl: string;
}

interface InstHolder {
  name: string;
  shares: number;
  percentOfClass: number;
  filingDate: string;
  formType: string;
}

const SubOwnership = memo(function SubOwnership({ ticker }: { ticker: string }) {
  const { openBrowser } = useTerminalStore();
  const [insiders, setInsiders] = useState<InsiderTxn[]>([]);
  const [holders, setHolders] = useState<InstHolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    if (fetchedRef.current === ticker && retryCount === 0) return;
    fetchedRef.current = ticker;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [insRes, holdRes] = await Promise.all([
          fetch(`${API_BASE}/sec/insider-transactions?symbol=${encodeURIComponent(ticker)}`),
          fetch(`${API_BASE}/sec/institutional-holders?symbol=${encodeURIComponent(ticker)}`),
        ]);
        if (!insRes.ok || !holdRes.ok) throw new Error("Failed to load ownership data");
        const insJson = await insRes.json();
        const holdJson = await holdRes.json();
        if (!cancelled) {
          setInsiders(insJson.transactions || []);
          setHolders(holdJson.holders || []);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load ownership data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, retryCount]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, marginLeft: 10 }}>Loading ownership data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center" }}>
        <span style={{ fontSize: 11, fontFamily: f, color: C.red }}>{error}</span>
        <button onClick={() => { setRetryCount(c => c + 1); }}
          style={{ display: "block", margin: "10px auto 0", fontSize: 11, fontFamily: f, color: C.gold, background: "transparent", border: `1px solid ${C.gold}44`, padding: "4px 12px", cursor: "pointer" }}>
          RETRY
        </button>
      </div>
    );
  }

  const decodeHtml = (s: string) => {
    if (!s) return s;
    const doc = new DOMParser().parseFromString(s, "text/html");
    return doc.documentElement.textContent ?? s;
  };

  const hdrStyle: React.CSSProperties = {
    fontSize: 11, fontFamily: f, fontWeight: 700, color: C.textMuted,
    letterSpacing: 1.2, textTransform: "uppercase", padding: "4px 0",
    borderBottom: `1px solid ${C.borderHi}`, whiteSpace: "nowrap",
  };
  const cellStyle: React.CSSProperties = {
    fontSize: 12, fontFamily: f, color: C.gold, padding: "5px 0",
    borderBottom: `1px solid ${C.border}`, lineHeight: 1.35,
  };
  const dimCell: React.CSSProperties = { ...cellStyle, color: C.textDim };

  return (
    <div style={{ padding: "2px 0" }}>
      <div style={{ fontSize: 11, fontFamily: f, fontWeight: 700, color: C.gold, letterSpacing: 2, textTransform: "uppercase", padding: "14px 0 6px", borderBottom: `1px solid ${C.borderHi}` }}>
        INSTITUTIONAL HOLDERS
      </div>
      {holders.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: f, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "52%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...hdrStyle, textAlign: "left" }}>HOLDER</th>
                <th style={{ ...hdrStyle, textAlign: "right" }}>% CLASS</th>
                <th style={{ ...hdrStyle, textAlign: "right" }}>SHARES</th>
                <th style={{ ...hdrStyle, textAlign: "right" }}>FILED</th>
              </tr>
            </thead>
            <tbody>
              {holders.map((h, i) => (
                <tr key={i}>
                  <td style={{ ...cellStyle, color: C.text, whiteSpace: "normal", wordBreak: "break-word", paddingRight: 6 }}>
                    {decodeHtml(h.name)}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right", fontWeight: 600 }}>
                    {h.percentOfClass > 0 ? `${h.percentOfClass.toFixed(1)}%` : "—"}
                  </td>
                  <td style={{ ...dimCell, textAlign: "right", fontSize: 11 }}>
                    {h.shares > 0 ? (h.shares >= 1e6 ? `${(h.shares / 1e6).toFixed(1)}M` : h.shares.toLocaleString()) : "—"}
                  </td>
                  <td style={{ ...dimCell, textAlign: "right", fontSize: 11 }}>
                    {h.filingDate || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: "10px 0", fontSize: 11, fontFamily: f, color: C.textDim }}>
          No SC 13G/D filings found
        </div>
      )}

      <div style={{ fontSize: 11, fontFamily: f, fontWeight: 700, color: C.gold, letterSpacing: 2, textTransform: "uppercase", padding: "18px 0 6px", borderBottom: `1px solid ${C.borderHi}` }}>
        INSIDER TRANSACTIONS
      </div>
      {insiders.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: f, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "30%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...hdrStyle, textAlign: "left" }}>NAME</th>
                <th style={{ ...hdrStyle, textAlign: "left" }}>TITLE</th>
                <th style={{ ...hdrStyle, textAlign: "center" }}>TYPE</th>
                <th style={{ ...hdrStyle, textAlign: "right" }}>SHARES</th>
                <th style={{ ...hdrStyle, textAlign: "right" }}>DATE</th>
              </tr>
            </thead>
            <tbody>
              {insiders.slice(0, 25).map((t, i) => {
                const isBuy = t.acquiredOrDisposed === "A";
                const action = isBuy ? "BUY" : "SELL";
                return (
                  <tr key={i}>
                    <td style={{ ...cellStyle, color: t.filingUrl ? C.gold : C.text, cursor: t.filingUrl ? "pointer" : "default", whiteSpace: "normal", wordBreak: "break-word", paddingRight: 4 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (t.filingUrl) {
                          const contentUrl = `${API_BASE}/sec/filing-content?url=${encodeURIComponent(t.filingUrl)}`;
                          openBrowser(contentUrl, `Form 4 — ${t.ownerName}`, "SEC EDGAR");
                        }
                      }}
                    >
                      {t.ownerName || "—"}
                    </td>
                    <td style={{ ...dimCell, fontSize: 11, whiteSpace: "normal", wordBreak: "break-word", paddingRight: 4 }}>
                      {t.officerTitle || "—"}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "center", color: isBuy ? C.green : C.red, fontWeight: 700, fontSize: 11 }}>
                      {action}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {t.shares?.toLocaleString() || "—"}
                    </td>
                    <td style={{ ...dimCell, textAlign: "right", fontSize: 11 }}>
                      {t.transactionDate || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: "10px 0", fontSize: 11, fontFamily: f, color: C.textDim }}>
          No Form 4 insider transactions found
        </div>
      )}
      <div style={{ fontSize: 11, fontFamily: f, color: C.dim, padding: "8px 0 0", textAlign: "right", letterSpacing: 0.5 }}>
        Source: SEC EDGAR Form 4 & SC 13G/D
      </div>
    </div>
  );
});

const SubValuation = memo(function SubValuation({ ticker, fund }: { ticker: string; fund: FundamentalData | null }) {
  const { data: fin, loading } = useCompanyFinancials(ticker);

  const metrics = useMemo(() => {
    if (!fin || !fund) return null;
    const mktCap = fund.marketCap || 0;
    const price = fund.eps && fund.peRatio ? fund.eps * fund.peRatio : 0;

    const latestAnnual = (arr: FinancialPeriod[]) => arr.filter(r => r.form === "10-K").slice(-1)[0];
    const latestRev = latestAnnual(fin.revenue);
    const latestNI = latestAnnual(fin.netIncome);
    const latestEquity = latestAnnual(fin.stockholdersEquity);
    const latestAssets = latestAnnual(fin.totalAssets);
    const latestGP = latestAnnual(fin.grossProfit);
    const latestOI = latestAnnual(fin.operatingIncome);

    const revenue = latestRev?.val || 0;
    const netIncome = latestNI?.val || 0;
    const equity = latestEquity?.val || 0;
    const assets = latestAssets?.val || 0;
    const grossProfit = latestGP?.val || 0;
    const opIncome = latestOI?.val || 0;

    const pe = fund.peRatio || (netIncome > 0 && mktCap > 0 ? mktCap / netIncome : null);
    const ps = revenue > 0 && mktCap > 0 ? mktCap / revenue : null;
    const pb = equity > 0 && mktCap > 0 ? mktCap / equity : null;
    const evRev = revenue > 0 && mktCap > 0 ? mktCap / revenue : null;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : null;
    const opMargin = revenue > 0 ? (opIncome / revenue) * 100 : null;
    const netMargin = revenue > 0 ? (netIncome / revenue) * 100 : null;
    const roe = equity > 0 ? (netIncome / equity) * 100 : null;
    const roa = assets > 0 ? (netIncome / assets) * 100 : null;

    const revHistory = fin.revenue.filter(r => r.form === "10-K").slice(-2);
    const revGrowth = revHistory.length === 2 && revHistory[0].val > 0
      ? ((revHistory[1].val - revHistory[0].val) / revHistory[0].val) * 100
      : null;

    return { pe, ps, pb, evRev, grossMargin, opMargin, netMargin, roe, roa, revGrowth, revenue, mktCap };
  }, [fin, fund]);

  const multiples = useMemo(() => {
    if (!metrics) return [];
    const items: { m: string; co: number; sp: number }[] = [];
    if (metrics.pe != null) items.push({ m: "P/E (TTM)", co: +metrics.pe.toFixed(1), sp: 22.5 });
    if (metrics.ps != null) items.push({ m: "P/S", co: +metrics.ps.toFixed(1), sp: 3.1 });
    if (metrics.evRev != null) items.push({ m: "EV/Rev", co: +metrics.evRev.toFixed(1), sp: 3.1 });
    if (metrics.pb != null) items.push({ m: "P/B", co: +metrics.pb.toFixed(1), sp: 4.2 });
    return items;
  }, [metrics]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, marginLeft: 10 }}>Loading valuation data...</span>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", fontSize: 11, fontFamily: f, color: C.textDim }}>
        {!fund ? "Waiting for price data..." : "No financial data available for valuation"}
      </div>
    );
  }

  return (
    <>
      <Sec>VALUATION MULTIPLES</Sec>
      {multiples.length > 0 ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", padding: "5px 0", borderBottom: `1px solid ${C.borderHi}` }}>
            {["METRIC", ticker, "S&P 500", "vs S&P"].map((h, i) => (
              <span key={i} style={{ fontSize: 11, fontFamily: f, fontWeight: 700, color: C.textDim, letterSpacing: 1.2, textAlign: i > 0 ? "right" : "left" }}>{h}</span>
            ))}
          </div>
          {multiples.map((m, i) => {
            const diffNum = m.sp > 0 ? (m.co - m.sp) / m.sp * 100 : null;
            const diff = diffNum != null ? diffNum.toFixed(0) : "—";
            const over = diffNum != null && diffNum > 0;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11, fontFamily: f, color: C.textMuted, fontWeight: 600 }}>{m.m}</span>
                <span style={{ fontSize: 11, fontFamily: f, color: C.gold, textAlign: "right", fontWeight: 600 }}>{m.co}x</span>
                <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, textAlign: "right" }}>{m.sp}x</span>
                <span style={{ fontSize: 11, fontFamily: f, color: over ? C.red : C.green, textAlign: "right", fontWeight: 600 }}>{over ? "+" : ""}{diff}%</span>
              </div>
            );
          })}

          <Sec>COMPARATIVE</Sec>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={multiples}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="m" tick={{ fill: C.textDim, fontSize: 11, fontFamily: f }} interval={0} angle={-15} textAnchor="end" height={40} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fill: C.textDim, fontSize: 11, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
              <Tooltip contentStyle={tt} />
              <Bar dataKey="co" fill={C.gold} name={ticker} radius={[2, 2, 0, 0]} />
              <Bar dataKey="sp" fill={C.borderHi} name="S&P 500" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 14, padding: "6px 0" }}>
            {([[ticker, C.gold], ["S&P 500", C.borderHi]] as const).map(([l, c]) => (
              <span key={l} style={{ fontSize: 11, fontFamily: f, color: C.textDim }}><span style={{ color: c as string }}>■</span> {l}</span>
            ))}
          </div>
        </>
      ) : (
        <div style={{ padding: "12px 0", fontSize: 11, fontFamily: f, color: C.textDim }}>No multiples available</div>
      )}

      <Sec>PROFITABILITY</Sec>
      <FundGrid items={[
        { label: "Gross Margin", value: metrics.grossMargin != null ? `${metrics.grossMargin.toFixed(1)}%` : "—", color: C.green },
        { label: "Op Margin", value: metrics.opMargin != null ? `${metrics.opMargin.toFixed(1)}%` : "—", color: C.gold },
        { label: "Net Margin", value: metrics.netMargin != null ? `${metrics.netMargin.toFixed(1)}%` : "—" },
        { label: "ROE", value: metrics.roe != null ? `${metrics.roe.toFixed(1)}%` : "—", color: C.cyan },
        { label: "ROA", value: metrics.roa != null ? `${metrics.roa.toFixed(1)}%` : "—", color: C.amber },
        { label: "Rev Growth", value: metrics.revGrowth != null ? `${metrics.revGrowth > 0 ? "+" : ""}${metrics.revGrowth.toFixed(1)}%` : "—", color: metrics.revGrowth != null ? (metrics.revGrowth >= 0 ? C.green : C.red) : undefined },
      ]} />

      <div style={{ fontSize: 11, fontFamily: f, color: C.textDim, padding: "8px 0 0", textAlign: "right" }}>
        Source: SEC XBRL + Schwab
      </div>
    </>
  );
});


interface CompanyResearchHubProps {
  candles?: CandleData[];
  stickyOffset?: number;
}

export function CompanyResearchHub({ candles, stickyOffset = 0 }: CompanyResearchHubProps) {
  const { symbol, accessToken, aiFeatureSettings, analysisResult, setAnalysisResult } = useTerminalStore();
  const aiModel = aiFeatureSettings.technicals.model;
  const aiTemp = aiFeatureSettings.technicals.temperature;
  const { data: quoteData } = useQuote(symbol);
  const { cachedData: technicalsCache, setCachedData: setTechnicalsCache } = useTechnicalsCache(symbol);

  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [page, setPage] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const swiping = useRef(false);
  const locked = useRef<"h" | "v" | null>(null);
  const dragDelta = useRef(0);
  const sliderRef = useRef<HTMLDivElement>(null);

  const [taStreaming, setTaStreaming] = useState(false);
  const [taStreamingText, setTaStreamingText] = useState("");
  const [taThinkingTokens, setTaThinkingTokens] = useState<string[]>([]);
  const [taShowResult, setTaShowResult] = useState(false);
  const taRunRef = useRef(0);
  const [taElapsed, setTaElapsed] = useState(0);
  const taStartRef = useRef(Date.now());
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  const [taCompletedAt, setTaCompletedAt] = useState<number | null>(null);
  const [taAge, setTaAge] = useState("");
  const cacheRestoredRef = useRef(false);

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );
  const { data: history } = useGetPriceHistory(
    { symbol, accessToken: accessToken || "", periodType: "month", period: 3, frequencyType: "daily", frequency: 1 },
    { query: { enabled: !!accessToken } }
  );

  useEffect(() => {
    if (!taStreaming) return;
    const id = setInterval(() => {
      setTaElapsed(Math.floor((Date.now() - taStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [taStreaming]);

  useEffect(() => {
    if (thinkingScrollRef.current) thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
  }, [taThinkingTokens]);

  useEffect(() => {
    if (taCompletedAt == null) { setTaAge(""); return; }
    const tick = () => {
      const mins = Math.floor((Date.now() - taCompletedAt) / 60_000);
      setTaAge(mins < 1 ? "Just now" : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [taCompletedAt]);

  useEffect(() => {
    cacheRestoredRef.current = false;
    setTaShowResult(false);
    setAnalysisResult(null);
    setTaStreamingText("");
    setTaThinkingTokens([]);
    setPage(0);
  }, [symbol]);

  useEffect(() => {
    if (cacheRestoredRef.current) return;
    cacheRestoredRef.current = true;
  }, [symbol, technicalsCache]);

  const handleRunTA = useCallback(async () => {
    if (!quote || !history?.candles) return;
    const runId = ++taRunRef.current;
    setAnalysisResult(null);
    setTaStreamingText("");
    setTaThinkingTokens([]);
    setTaShowResult(true);
    setTaStreaming(true);
    setTaElapsed(0);
    taStartRef.current = Date.now();

    let accumulated = "";
    const collectedThinking: string[] = [];
    await consumeStream(
      `${API_BASE}/ai/technical-analysis/stream`,
      { quote, candles: history.candles, model: aiModel, temperature: aiTemp, fundamentals: fundamentals ? { marketCap: fundamentals.marketCap, sharesOutstanding: fundamentals.sharesOutstanding, peRatio: fundamentals.peRatio, eps: fundamentals.eps, beta: fundamentals.beta, dividendYield: fundamentals.dividendYield, high52: fundamentals.high52, low52: fundamentals.low52 } : undefined },
      (chunk) => {
        if (taRunRef.current !== runId) return;
        accumulated += chunk;
        setTaStreamingText(accumulated);
      },
      () => {
        if (taRunRef.current !== runId) return;
        setAnalysisResult(accumulated);
        setTaStreamingText("");
        setTaStreaming(false);
        setTaCompletedAt(Date.now());
        setTechnicalsCache({
          analysisResult: accumulated,
          thinkingTokens: collectedThinking,
          timestamp: Date.now(),
        });
      },
      (err) => {
        if (taRunRef.current !== runId) return;
        setAnalysisResult(`**Analysis failed:** ${err}`);
        setTaStreamingText("");
        setTaStreaming(false);
      },
      (reasoning) => {
        if (taRunRef.current !== runId) return;
        collectedThinking.push(reasoning);
        setTaThinkingTokens((prev) => [...prev, reasoning]);
      },
    );
  }, [quote, history, aiModel, aiTemp, fundamentals, setAnalysisResult, setTechnicalsCache]);

  const fetchFundamentals = useCallback(async () => {
    if (!accessToken || !symbol) return;
    setFundLoading(true);
    try {
      const res = await fetchWithAuth(
        `${API_BASE}/market/fundamentals?symbol=${encodeURIComponent(symbol)}&accessToken=${encodeURIComponent(accessToken)}`
      );
      const data = await res.json();
      setFundamentals(data);
    } catch {
      setFundamentals({ symbol, marketCap: null, sharesOutstanding: null, peRatio: null, eps: null, beta: null, dividendYield: null, high52: null, low52: null, error: "Failed to load" });
    } finally {
      setFundLoading(false);
    }
  }, [symbol, accessToken]);

  useEffect(() => {
    fetchFundamentals();
  }, [fetchFundamentals]);

  const priceHist = useMemo(() => {
    const src = candles ?? history?.candles;
    if (!Array.isArray(src) || src.length === 0) return [];
    return (src as CandleData[]).map((c, i) => ({
      w: i % Math.max(1, Math.floor(src.length / 8)) === 0
        ? new Date(c.datetime).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "",
      p: c.close,
    }));
  }, [candles, history]);

  const volHist = useMemo(() => {
    const src = candles ?? history?.candles;
    if (!Array.isArray(src) || src.length === 0) return [];
    const last20 = (src as CandleData[]).slice(-20);
    return last20.map((c, i) => ({
      d: `${i + 1}`,
      v: c.volume,
    }));
  }, [candles, history]);

  const setSliderOffset = useCallback((offset: number, animate: boolean) => {
    if (!sliderRef.current) return;
    sliderRef.current.style.transition = animate ? "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)" : "none";
    sliderRef.current.style.transform = `translateX(calc(${-page * 100}% + ${offset}px))`;
  }, [page]);

  const handleTouchStart = useCallback((e: ReactTouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    swiping.current = true;
    locked.current = null;
    dragDelta.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: ReactTouchEvent) => {
    if (!swiping.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    if (!locked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        locked.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
    }

    if (locked.current === "h") {
      e.preventDefault();
      let clamped = dx;
      if ((page === 0 && dx > 0) || (page === SUB_LABELS.length - 1 && dx < 0)) {
        clamped = dx * 0.25;
      }
      dragDelta.current = clamped;
      setSliderOffset(clamped, false);
    }
  }, [page, setSliderOffset]);

  const finishSwipe = useCallback(() => {
    if (!swiping.current) return;
    swiping.current = false;
    const threshold = 50;
    const delta = dragDelta.current;
    if (locked.current === "h") {
      if (delta < -threshold && page < SUB_LABELS.length - 1) {
        setPage(p => p + 1);
      } else if (delta > threshold && page > 0) {
        setPage(p => p - 1);
      }
    }
    locked.current = null;
    dragDelta.current = 0;
    setSliderOffset(0, true);
  }, [page, setSliderOffset]);

  if (!accessToken) {
    return (
      <div className="p-6 flex justify-center">
        <ConnectBrokerPrompt label="Connect Brokerage For Company Data" />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: f }}>
      <div style={{ position: "sticky", top: stickyOffset, zIndex: 30, background: C.bg, display: "flex", gap: 4, padding: "8px 16px", overflowX: "auto", borderBottom: `1px solid ${C.border}` }}>
        {SUB_LABELS.map((label, i) => (
          <button key={label} onClick={() => setPage(i)} style={{
            padding: "6px 12px", fontSize: 12, fontFamily: f, fontWeight: 700,
            color: page === i ? C.text : C.textDim,
            background: page === i ? C.borderHi : "transparent",
            border: "none",
            borderRadius: 9999, cursor: "pointer", letterSpacing: 0.5, whiteSpace: "nowrap",
            transition: "all 0.2s",
          }}>{label}</button>
        ))}
      </div>

      {fundLoading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
      ) : (
        <div
          style={{ overflow: "hidden", touchAction: "pan-y" }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={finishSwipe}
          onTouchCancel={finishSwipe}
        >
          <div
            ref={sliderRef}
            style={{
              display: "flex",
              transform: `translateX(${-page * 100}%)`,
              transition: "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
              willChange: "transform",
            }}
          >
            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 16px" }}>
              {!taShowResult ? (
                <div>
                  <div className="flex items-center justify-between py-2 border-b border-card-border/30">
                    <div>
                      <h2 className="font-mono font-bold text-sm text-[#e4e4e7] tracking-wider">TECHNICAL ANALYSIS</h2>
                      <p className="font-mono text-[11px] text-[#71717a] tracking-widest">Company Analysis</p>
                    </div>
                  </div>
                  <div className="p-8 text-center">
                    <div className="relative mx-auto mb-3 w-8 h-8">
                      <Activity className="w-8 h-8 text-[#FFB800] relative" style={{ opacity: 0.5 }} />
                    </div>
                    <p className="font-mono text-xs text-[#71717a] mb-4">No Technical Analysis generated yet</p>
                    <button
                      onClick={() => handleRunTA()}
                      disabled={taStreaming || !accessToken || !quote || !history?.candles}
                      className="inline-flex items-center justify-center rounded-lg font-mono font-bold tracking-wider transition-colors active:scale-95 active:brightness-110"
                      style={{
                        padding: "10px 24px", fontSize: 13, fontFamily: f, fontWeight: 700,
                        color: C.gold,
                        background: C.bg,
                        border: `1px solid ${C.borderHi}`,
                        outline: "none",
                        cursor: "pointer",
                        letterSpacing: "0.08em",
                      }}
                    >
                      Run Analysis
                    </button>
                  </div>
                </div>
              ) : taStreaming ? (
                <div className="space-y-3" style={{ paddingTop: 12 }}>
                  <div className="rounded-xl border overflow-hidden" style={{ background: "#111113", borderColor: "rgba(255,184,0,0.3)" }}>
                    <div className="px-4 py-2.5 flex items-center gap-3" style={{ background: "transparent" }}>
                      <span className="relative flex h-3 w-3 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB800] opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FFB800]" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-[#FFB800] tracking-wider">REASONING</span>
                          <span className="font-mono text-xs tabular-nums text-[#71717a]">{taElapsed}s</span>
                        </div>
                      </div>
                    </div>
                    <div className="h-1 bg-[#2A2A2C]">
                      <div className="h-full transition-all duration-1000 ease-out" style={{ width: `${Math.min((taElapsed / 20) * 100, 95)}%`, background: "linear-gradient(90deg, #FFB800, #FF8C00)" }} />
                    </div>
                    <div className="px-4 py-3 space-y-1.5">
                      {[
                        { label: "LOADING MARKET DATA", done: true },
                        { label: "REASONING", done: false, active: true },
                      ].map((s) => (
                        <div key={s.label} className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: s.done ? "#00d166" : s.active ? "#FFB800" : "#2A2A2C", boxShadow: s.active ? "0 0 6px rgba(255,184,0,0.5)" : "none" }} />
                          <span className="font-mono text-[11px] tracking-wider" style={{ color: s.done ? C.green : s.active ? C.gold : C.dim, fontWeight: s.active ? 700 : 400 }}>{s.label}</span>
                          {s.done && <span className="font-mono text-[11px] text-[#00d166]">✓</span>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {taThinkingTokens.length > 0 && (
                    <div className="rounded-xl border overflow-hidden" style={{ background: "#111113", borderColor: "rgba(16,185,129,0.3)" }}>
                      <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: "rgba(16,185,129,0.06)" }}>
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                        </span>
                        <span className="font-mono text-[11px] text-emerald-400 uppercase tracking-widest font-bold">Live Claude Reasoning</span>
                      </div>
                      <div ref={thinkingScrollRef} className="max-h-[200px] overflow-y-auto px-4 py-3" style={{ scrollBehavior: "smooth" }}>
                        <div className="border-l-2 border-emerald-500/40 pl-3">
                          <p className="font-mono text-[11px] text-[#c4c4cc] leading-[1.7] whitespace-pre-wrap break-words">
                            {taThinkingTokens.join("")}
                            <span className="inline-block w-1.5 h-3.5 bg-emerald-500 ml-0.5 animate-pulse align-text-bottom" />
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : analysisResult ? (
                <div className="flex items-center justify-between py-2.5" style={{ paddingTop: 12, paddingBottom: 8 }}>
                  <div>
                    <h2 className="font-mono font-bold text-sm text-[#e4e4e7] tracking-wider">TECHNICAL ANALYSIS</h2>
                    <p className="font-mono text-[11px] text-[#71717a] tracking-widest">Company Analysis</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {taAge && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-[#71717a]" />
                        <span className="font-mono text-[11px] tracking-wider text-[#71717a]">{taAge}</span>
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRunTA(); }}
                      disabled={taStreaming || !quote || !history?.candles}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-mono text-[11px] font-bold uppercase tracking-wider transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-[1px]"
                      style={{
                        background: "linear-gradient(180deg, #2A2A2C 0%, #1E1E20 100%)",
                        color: "#a1a1aa",
                        border: "1px solid #3a3a3c",
                        borderBottom: "2px solid #1a1a1c",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
                      }}
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ) : null}

              <SubOverview fund={fundamentals} quoteData={(quoteData as unknown as QuoteInfo) ?? null} priceHist={priceHist} volHist={volHist} ai={analysisResult ? parseAiAnalysis(analysisResult) : null} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 16px" }}>
              <SubAnalystRatings ticker={symbol} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 16px" }}>
              <SubFinancials ticker={symbol} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 16px" }}>
              <SubSEC ticker={symbol} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 16px" }}>
              <SubOwnership ticker={symbol} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 16px" }}>
              <SubValuation ticker={symbol} fund={fundamentals} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
