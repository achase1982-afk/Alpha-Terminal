import { useState, useEffect, useCallback, useRef, useMemo, memo, type TouchEvent as ReactTouchEvent } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { consumeStream } from "@/lib/consumeStream";
import { useTechnicalsCache } from "@/hooks/useTechnicalsCache";
import { AiThinkingFeed } from "@/components/ai-shared/AiThinkingFeed";
import { Loader2, Activity, RefreshCw } from "lucide-react";
import {
  useGetQuote, useGetPriceHistory,
} from "@workspace/api-client-react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const API_BASE = "/api";

const C = {
  bg: "#000",
  card: "#111",
  border: "#1c1c1c",
  borderHi: "#2a2a2a",
  text: "#ffffff",
  textSoft: "#d4d4d4",
  textMuted: "#999",
  textDim: "#555",
  label: "#808080",
  dim: "#4a4a4a",
  gold: "#d4a843",
  green: "#00e676",
  red: "#ff5252",
  cyan: "#4dd0e1",
  amber: "#ffb74d",
  purple: "#b388ff",
};

const f = `'SFMono-Regular', 'SF Mono', ui-monospace, 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace`;
const tt: React.CSSProperties = { background: "#111", border: `1px solid ${C.borderHi}`, borderRadius: 0, fontFamily: f, fontSize: 13, color: C.text, padding: "8px 12px" };
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

function genMockData(ticker: string) {
  const s = ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  let seed = s;
  const rng = (min: number, max: number) => {
    seed = (seed * 9301 + 49297) % 233280;
    const x = seed / 233280;
    return min + x * (max - min);
  };
  const price = +rng(50, 500).toFixed(2);

  const rev = [
    { yr: "FY21", val: +rng(20, 100).toFixed(1) },
    { yr: "FY22", val: +rng(25, 120).toFixed(1) },
    { yr: "FY23", val: +rng(30, 140).toFixed(1) },
    { yr: "FY24", val: +rng(35, 160).toFixed(1) },
    { yr: "FY25E", val: +rng(40, 180).toFixed(1) },
  ];
  const epsData = rev.map(d => ({ yr: d.yr, val: +(d.val / rng(10, 25)).toFixed(2) }));
  const margins = [
    { k: "Gross Margin", v: +rng(30, 75).toFixed(1) },
    { k: "Op Margin", v: +rng(10, 40).toFixed(1) },
    { k: "Net Margin", v: +rng(5, 25).toFixed(1) },
    { k: "FCF Margin", v: +rng(8, 30).toFixed(1) },
  ];
  const bs = {
    assets: +rng(50, 500).toFixed(1), liab: +rng(20, 250).toFixed(1),
    equity: +rng(30, 250).toFixed(1), cash: +rng(5, 80).toFixed(1),
    debt: +rng(10, 150).toFixed(1), curRatio: +rng(0.8, 3).toFixed(2),
    deRatio: +rng(0.2, 2.5).toFixed(2),
  };
  const cf = [
    { yr: "FY22", op: +rng(5, 40).toFixed(1), inv: +(-rng(3, 20)).toFixed(1), fin: +(-rng(2, 15)).toFixed(1) },
    { yr: "FY23", op: +rng(8, 50).toFixed(1), inv: +(-rng(4, 25)).toFixed(1), fin: +(-rng(3, 18)).toFixed(1) },
    { yr: "FY24", op: +rng(10, 60).toFixed(1), inv: +(-rng(5, 30)).toFixed(1), fin: +(-rng(2, 20)).toFixed(1) },
  ];
  const filings = [
    { type: "10-K", date: "2025-02-15", desc: "Annual Report", acc: "0001234567-25-000123", period: "FY2024" },
    { type: "10-Q", date: "2024-11-05", desc: "Quarterly Report", acc: "0001234567-24-000456", period: "Q3 2024" },
    { type: "10-Q", date: "2024-08-02", desc: "Quarterly Report", acc: "0001234567-24-000321", period: "Q2 2024" },
    { type: "10-Q", date: "2024-05-03", desc: "Quarterly Report", acc: "0001234567-24-000111", period: "Q1 2024" },
    { type: "8-K", date: "2025-01-28", desc: "Earnings Release", acc: "0001234567-25-000089", period: "–" },
    { type: "8-K", date: "2024-12-10", desc: "Material Event", acc: "0001234567-24-000777", period: "–" },
    { type: "DEF 14A", date: "2025-03-20", desc: "Proxy Statement", acc: "0001234567-25-000234", period: "2025 Mtg" },
    { type: "SC 13G/A", date: "2025-02-14", desc: "Ownership Amend", acc: "0001234567-25-000100", period: "–" },
    { type: "4", date: "2025-03-15", desc: "Insider Tx - CEO", acc: "0001234567-25-000345", period: "–" },
    { type: "4", date: "2025-03-01", desc: "Insider Tx - CFO", acc: "0001234567-25-000300", period: "–" },
    { type: "S-3", date: "2024-09-20", desc: "Shelf Registration", acc: "0001234567-24-000555", period: "–" },
    { type: "10-K", date: "2024-02-16", desc: "Annual Report", acc: "0001234567-24-000012", period: "FY2023" },
  ];
  const holders = [
    { name: "Vanguard Group", pct: +rng(5, 12).toFixed(2), chg: "+0.3%" },
    { name: "BlackRock", pct: +rng(4, 10).toFixed(2), chg: "-0.1%" },
    { name: "State Street", pct: +rng(2, 7).toFixed(2), chg: "+0.2%" },
    { name: "Fidelity Mgmt", pct: +rng(1.5, 5).toFixed(2), chg: "+0.5%" },
    { name: "Capital Research", pct: +rng(1, 4).toFixed(2), chg: "-0.4%" },
    { name: "T. Rowe Price", pct: +rng(0.8, 3.5).toFixed(2), chg: "+0.1%" },
    { name: "Wellington Mgmt", pct: +rng(0.5, 3).toFixed(2), chg: "0.0%" },
    { name: "Geode Capital", pct: +rng(0.4, 2).toFixed(2), chg: "+0.2%" },
  ];
  const insiders = [
    { name: "J. Smith", title: "CEO", action: "SELL", shares: "50,000", date: "03/15", price: `$${(price * 0.98).toFixed(2)}` },
    { name: "J. Doe", title: "CFO", action: "BUY", shares: "25,000", date: "03/01", price: `$${(price * 0.97).toFixed(2)}` },
    { name: "B. Wilson", title: "CTO", action: "SELL", shares: "15,000", date: "02/20", price: `$${(price * 0.95).toFixed(2)}` },
    { name: "A. Chen", title: "EVP", action: "BUY", shares: "10,000", date: "02/10", price: `$${(price * 1.01).toFixed(2)}` },
  ];
  const cik = `000${Math.floor(rng(1000000, 9999999))}`;
  const mktCapStr = `$${(price * rng(0.5, 5)).toFixed(1)}B`;
  return { rev, epsData, margins, bs, cf, filings, holders, insiders, cik, mktCapStr, price,
    pe: rng(15, 60).toFixed(1), fwdPe: rng(12, 45).toFixed(1),
  };
}

function Sec({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 14, fontFamily: f, fontWeight: 300, color: C.gold, letterSpacing: 2, textTransform: "uppercase", padding: "20px 0 12px" }}>{children}</div>;
}

function FundGrid({ items }: { items: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, padding: "16px 18px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 0" }}>
      {items.map((it, i) => (
        <div key={i}>
          <div style={{ fontSize: 11, fontFamily: f, fontWeight: 300, color: C.label, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>{it.label}</div>
          <div style={{ fontSize: 20, fontFamily: f, fontWeight: 300, color: it.color || C.text }}>{it.value}</div>
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
        <span style={{ fontSize: 11, fontFamily: f, color: C.green, fontWeight: 300, letterSpacing: 1 }}>${current}</span>
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
      <span style={{ fontSize: 12, color: color || C.text, fontFamily: f, fontWeight: 300 }}>{value}</span>
    </div>
  );
}

function Tag({ children, color = C.label }: { children: React.ReactNode; color?: string }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", fontSize: 12, fontFamily: f, fontWeight: 300, color, border: `1px solid ${color}55`, letterSpacing: 0.5 }}>{children}</span>;
}

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
}

function parseAiAnalysis(text: string): AiAnalysis | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && (parsed.priceAction || parsed.support || parsed.outlook)) return parsed;
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
  const mock = useMemo(() => genMockData(quoteData?.symbol || "AAPL"), [quoteData?.symbol]);

  const pe = fund?.peRatio ?? quoteData?.peRatio ?? null;
  const eps = fund?.eps ?? null;
  const beta = fund?.beta ?? null;
  const divYield = fund?.dividendYield ?? null;
  const chg = quoteData?.netChange ?? 0;

  const biasColor = ai?.priceAction?.bias?.includes("Bullish") ? C.green : ai?.priceAction?.bias?.includes("Bearish") ? C.red : C.gold;

  return (
    <>
      <Sec>FUNDAMENTALS</Sec>
      <FundGrid items={[
        { label: "Mkt Cap", value: fmtMarketCap(fund?.marketCap ?? null) },
        { label: "Shares", value: fmtShares(fund?.sharesOutstanding ?? null) },
        { label: "P/E", value: pe != null ? pe.toFixed(1) : "—" },
        { label: "EPS", value: eps != null ? eps.toFixed(2) : "—" },
        { label: "Beta", value: beta != null ? beta.toFixed(2) : "—" },
        { label: "Div Yld", value: divYield != null ? `${divYield.toFixed(2)}%` : "—" },
      ]} />
      {high52 != null && low52 != null && currentPrice != null && (
        <RangeBar lo={low52} hi={high52} current={currentPrice.toFixed(2)} />
      )}

      {ai?.priceAction && (
        <>
          <Sec>PRICE ACTION</Sec>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1.5, marginBottom: 4 }}>STATUS</div>
                <div style={{ fontSize: 20, fontFamily: f, fontWeight: 300, color: C.text }}>{ai.priceAction.status}</div>
              </div>
              <span style={{ padding: "4px 12px", fontSize: 13, fontFamily: f, fontWeight: 300, color: biasColor, border: `1px solid ${biasColor}55`, borderRadius: 2 }}>
                {ai.priceAction.bias?.includes("Bullish") ? "▲" : ai.priceAction.bias?.includes("Bearish") ? "▼" : "◆"} {ai.priceAction.bias}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 18px" }}>
              <div>
                <div style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1.5, marginBottom: 4 }}>TREND</div>
                <div style={{ fontSize: 14, fontFamily: f, color: C.textSoft, lineHeight: 1.4 }}>{ai.priceAction.trend}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1.5, marginBottom: 4 }}>MOMENTUM</div>
                <div style={{ fontSize: 14, fontFamily: f, color: chg >= 0 ? C.green : C.red, lineHeight: 1.4 }}>{ai.priceAction.momentum}</div>
              </div>
            </div>
          </div>
        </>
      )}

      {(ai?.support || ai?.resistance) && (
        <>
          <Sec>SUPPORT / RESISTANCE</Sec>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {([["▼ SUPPORT", ai?.support, C.red], ["▲ RESISTANCE", ai?.resistance, C.green]] as [string, typeof ai.support, string][]).map(([title, levels, color], idx) => (
              <div key={idx} style={{ background: C.card, border: `1px solid ${C.border}`, padding: "14px" }}>
                <div style={{ fontSize: 12, fontFamily: f, fontWeight: 300, color, letterSpacing: 1.5, marginBottom: 10 }}>{title}</div>
                {(levels || []).map((s, i) => (
                  <div key={i} style={{ padding: "7px 0", borderBottom: i < (levels?.length ?? 0) - 1 ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontFamily: f, color: C.label, textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</span>
                      <span style={{ fontSize: 16, fontFamily: f, fontWeight: 300, color }}>{s.level}</span>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: f, color: C.dim, marginTop: 2 }}>{s.note}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      <Sec>30-DAY PRICE</Sec>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={priceHist}>
          <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.gold} stopOpacity={0.15} /><stop offset="95%" stopColor={C.gold} stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
          <XAxis dataKey="w" tick={{ fill: C.label, fontSize: 10, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis tick={{ fill: C.label, fontSize: 10, fontFamily: f }} domain={["auto", "auto"]} axisLine={{ stroke: C.border }} tickLine={false} />
          <Tooltip contentStyle={tt} />
          <Area type="monotone" dataKey="p" stroke={C.gold} fill="url(#pg)" strokeWidth={2} dot={false} name="Price" />
        </AreaChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={50}>
        <BarChart data={volHist}>
          <XAxis dataKey="d" tick={false} axisLine={{ stroke: C.border }} />
          <YAxis tick={false} axisLine={false} />
          <Bar dataKey="v" fill={C.dim} radius={[1, 1, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {ai?.chartPattern && (
        <>
          <Sec>CHART PATTERNS</Sec>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, padding: "16px 18px" }}>
            {([["Recent Pattern", ai.chartPattern.recent], ["Trading Range", ai.chartPattern.range], ["Current Setup", ai.chartPattern.setup]] as [string, string][]).map(([l, v], i) => (
              <div key={i} style={{ borderBottom: i < 2 ? `1px solid ${C.border}` : "none", paddingBottom: i < 2 ? 12 : 0, marginBottom: i < 2 ? 12 : 0 }}>
                <div style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1.5, marginBottom: 4 }}>{l.toUpperCase()}</div>
                <div style={{ fontSize: 15, fontFamily: f, color: C.textSoft, lineHeight: 1.4 }}>{v}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {ai?.volumeAnalysis && (
        <>
          <Sec>VOLUME ANALYSIS</Sec>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1.5 }}>TODAY</div>
                <div style={{ fontSize: 22, fontFamily: f, fontWeight: 300, color: C.text, marginTop: 4 }}>{ai.volumeAnalysis.today}</div>
              </div>
              <Tag color={ai.volumeAnalysis.todayLabel === "elevated" ? C.amber : C.label}>{ai.volumeAnalysis.todayLabel?.toUpperCase()}</Tag>
            </div>
            {ai.volumeAnalysis.elevated && ai.volumeAnalysis.elevated.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1.5, marginBottom: 8 }}>ELEVATED EVENTS</div>
                <div style={{ display: "flex", gap: 20, marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
                  {ai.volumeAnalysis.elevated.map((e, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 12, fontFamily: f, color: C.label }}>{e.date}</div>
                      <div style={{ fontSize: 16, fontFamily: f, fontWeight: 300, color: C.amber, marginTop: 2 }}>{e.vol}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {([["Pattern", ai.volumeAnalysis.pattern], ["Signal", ai.volumeAnalysis.signal]] as [string, string][]).map(([l, v], i) => (
              <div key={i} style={{ marginBottom: i === 0 ? 8 : 0 }}>
                <span style={{ fontSize: 14, fontFamily: f, fontWeight: 300, color: C.text }}>{l}: </span>
                <span style={{ fontSize: 14, fontFamily: f, color: C.textSoft }}>{v}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {ai?.risks && ai.risks.length > 0 && (
        <>
          <Sec>RISK ASSESSMENT</Sec>
          {ai.risks.map((r, i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ width: 4, minHeight: 20, marginTop: 2, background: r.severity === "high" ? C.red : C.amber, flexShrink: 0, borderRadius: 2 }} />
              <div>
                <span style={{ fontSize: 15, fontFamily: f, fontWeight: 300, color: C.text }}>{r.type}: </span>
                <span style={{ fontSize: 15, fontFamily: f, color: C.textSoft }}>{r.desc}</span>
              </div>
            </div>
          ))}
          {ai.criticalLevels && ai.criticalLevels.length > 0 && (
            <div style={{ marginTop: 10, padding: "10px 0" }}>
              <div style={{ fontSize: 11, fontFamily: f, color: C.label, letterSpacing: 1.5, marginBottom: 8 }}>CRITICAL LEVELS</div>
              {ai.criticalLevels.map((cl, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                  <span style={{ fontSize: 18, fontFamily: f, fontWeight: 300, color: cl.direction?.includes("bearish") ? C.red : C.green }}>{cl.level}</span>
                  <span style={{ fontSize: 13, fontFamily: f, color: C.label }}>{cl.direction}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {ai?.outlook && (
        <>
          <Sec>TRADING OUTLOOK</Sec>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {([["SHORT", ai.outlook.shortTerm, C.cyan], ["MEDIUM", ai.outlook.mediumTerm, C.purple]] as [string, typeof ai.outlook.shortTerm, string][]).map(([title, data, color], idx) => (
              data ? (
                <div key={idx} style={{ background: C.card, border: `1px solid ${C.border}`, padding: "14px" }}>
                  <div style={{ fontSize: 12, fontFamily: f, fontWeight: 300, color, letterSpacing: 1.5, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 11, fontFamily: f, color: C.label, marginBottom: 8 }}>{data.timeframe}</div>
                  {data.points?.map((p, i) => (
                    <div key={i} style={{ fontSize: 14, fontFamily: f, color: C.textSoft, padding: "4px 0 4px 10px", borderLeft: `3px solid ${C.border}`, marginBottom: 6, lineHeight: 1.4 }}>{p}</div>
                  ))}
                </div>
              ) : null
            ))}
          </div>

          {ai.outlook.targets && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, padding: "16px 18px", marginTop: 12 }}>
              <div style={{ fontSize: 12, fontFamily: f, fontWeight: 300, color: C.gold, letterSpacing: 1.5, marginBottom: 12 }}>PRICE TARGETS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {([["▲ UPSIDE", ai.outlook.targets.upside, C.green], ["▼ DOWNSIDE", ai.outlook.targets.downside, C.red]] as [string, string[], string][]).map(([title, targets, color], idx) => (
                  <div key={idx}>
                    <div style={{ fontSize: 12, fontFamily: f, color, fontWeight: 300, letterSpacing: 1, marginBottom: 6 }}>{title}</div>
                    {(targets || []).map((t, i) => (
                      <div key={i} style={{ fontSize: 17, fontFamily: f, fontWeight: 300, color: C.text, padding: "3px 0" }}>{t}</div>
                    ))}
                  </div>
                ))}
              </div>
              {ai.outlook.rangePosition && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 13, fontFamily: f, color: C.label }}>
                  52W: <span style={{ color: C.textSoft, fontWeight: 300 }}>{ai.outlook.rangePosition.pctFromLow}%</span> from low, <span style={{ color: C.textSoft, fontWeight: 300 }}>{ai.outlook.rangePosition.pctFromHigh}%</span> from high
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Sec>MARGINS</Sec>
      {mock.margins.map((m, i) => {
        const mc = m.v > 20 ? C.green : m.v > 10 ? C.gold : C.red;
        return (
          <div key={i} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontFamily: f, color: C.textSoft }}>{m.k}</span>
              <span style={{ fontSize: 16, fontFamily: f, color: mc, fontWeight: 300 }}>{m.v}%</span>
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
              <div style={{ height: 4, width: `${Math.min(m.v, 100)}%`, background: mc, borderRadius: 2 }} />
            </div>
          </div>
        );
      })}
    </>
  );
});

const SubFinancials = memo(function SubFinancials({ ticker }: { ticker: string }) {
  const [view, setView] = useState("income");
  const mock = useMemo(() => genMockData(ticker), [ticker]);

  return (
    <>
      <div style={{ display: "flex", gap: 6, padding: "14px 0 8px" }}>
        {FINANCIALS_TABS.map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{
            padding: "4px 12px", fontSize: 10, fontFamily: f, fontWeight: 300,
            color: view === id ? "#000" : C.textMuted,
            background: view === id ? C.gold : "transparent",
            border: `1px solid ${view === id ? C.gold : C.borderHi}`,
            borderRadius: 14, cursor: "pointer", letterSpacing: 0.5,
          }}>{label}</button>
        ))}
      </div>

      {view === "income" && (
        <>
          <Sec>REVENUE ($B)</Sec>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={mock.rev}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="yr" tick={{ fill: C.textDim, fontSize: 10, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fill: C.textDim, fontSize: 10, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
              <Tooltip contentStyle={tt} />
              <Bar dataKey="val" fill={C.gold} radius={[2, 2, 0, 0]} name="Revenue" />
            </BarChart>
          </ResponsiveContainer>
          <Sec>EPS TREND</Sec>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={mock.epsData}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="yr" tick={{ fill: C.textDim, fontSize: 10, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fill: C.textDim, fontSize: 10, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
              <Tooltip contentStyle={tt} />
              <Line type="monotone" dataKey="val" stroke={C.green} strokeWidth={2} dot={{ fill: C.green, r: 3, strokeWidth: 0 }} name="EPS" />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}

      {view === "balance" && (
        <>
          <Sec>BALANCE SHEET ($B)</Sec>
          <FundGrid items={[
            { label: "Total Assets", value: `$${mock.bs.assets}B` },
            { label: "Liabilities", value: `$${mock.bs.liab}B`, color: C.red },
            { label: "Equity", value: `$${mock.bs.equity}B`, color: C.green },
            { label: "Cash", value: `$${mock.bs.cash}B`, color: C.gold },
            { label: "Debt", value: `$${mock.bs.debt}B`, color: C.red },
            { label: "Cur Ratio", value: String(mock.bs.curRatio), color: +mock.bs.curRatio >= 1.5 ? C.green : C.gold },
          ]} />
          <div style={{ marginTop: 12 }}>
            <MetricRow label="Debt/Equity" value={String(mock.bs.deRatio)} color={+mock.bs.deRatio <= 1 ? C.green : C.red} />
          </div>
        </>
      )}

      {view === "cashflow" && (
        <>
          <Sec>CASH FLOW ($B)</Sec>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={mock.cf}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="yr" tick={{ fill: C.textDim, fontSize: 10, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={{ fill: C.textDim, fontSize: 10, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
              <Tooltip contentStyle={tt} />
              <Bar dataKey="op" fill={C.green} name="Operating" radius={[2, 2, 0, 0]} />
              <Bar dataKey="inv" fill={C.gold} name="Investing" radius={[2, 2, 0, 0]} />
              <Bar dataKey="fin" fill={C.textDim} name="Financing" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 14, padding: "6px 0" }}>
            {CF_LEGEND.map(([l, c]) => (
              <span key={l} style={{ fontSize: 10, fontFamily: f, color: C.textDim }}><span style={{ color: c }}>■</span> {l}</span>
            ))}
          </div>
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
  const [filter, setFilter] = useState("ALL");
  const [exp, setExp] = useState<number | null>(null);
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
      setExp(null);
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
          style={{ display: "block", margin: "10px auto 0", fontSize: 10, fontFamily: f, color: C.gold, background: "transparent", border: `1px solid ${C.gold}44`, padding: "4px 12px", cursor: "pointer" }}>
          RETRY
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 8px" }}>
        <div>
          <span style={{ fontSize: 12, fontFamily: f, fontWeight: 300, color: C.gold, letterSpacing: 1.5 }}>SEC EDGAR</span>
          {cik && <span style={{ fontSize: 10, fontFamily: f, color: C.textDim, marginLeft: 10 }}>CIK {cik}</span>}
        </div>
        <a href={cikNumeric
            ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNumeric}&type=&dateb=&owner=include&count=40`
            : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&CIK=&type=&dateb=&owner=include&count=40`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 9, fontFamily: f, fontWeight: 300, color: C.gold, textDecoration: "none", letterSpacing: 1, padding: "3px 8px", border: `1px solid ${C.gold}44` }}>
          EDGAR ↗
        </a>
      </div>

      <div style={{ fontSize: 10, fontFamily: f, color: C.textDim, paddingBottom: 8 }}>
        {filings.length} filings loaded • Real-time EDGAR data
      </div>

      <div style={{ display: "flex", gap: 5, paddingBottom: 10, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        {types.map(t => {
          const count = t === "ALL" ? filings.length : filings.filter(fi => fi.formType === t || fi.formType.startsWith(t + "/")).length;
          return (
            <button key={t} onClick={() => { setFilter(t); setExp(null); }} style={{
              padding: "2px 8px", fontSize: 9, fontFamily: f, fontWeight: 300,
              color: filter === t ? "#000" : C.textDim,
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
        const isExp = exp === i;
        const c = tc[fi.formType] || tc[fi.formType.split("/")[0]] || C.textDim;
        return (
          <div key={fi.id || i} onClick={() => setExp(isExp ? null : i)}
            style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: isExp ? "#060606" : "transparent" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <Tag color={c}>{fi.formType}</Tag>
                <span style={{ fontSize: 11, fontFamily: f, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fi.description}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 8 }}>
                <span style={{ fontSize: 9, fontFamily: f, color: C.textDim }}>{fi.filedAt}</span>
                <span style={{ fontSize: 9, color: C.textDim, display: "inline-block", transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
              </div>
            </div>
            {isExp && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontFamily: f, color: C.textDim, marginBottom: 8, wordBreak: "break-all" }}>
                  <span style={{ letterSpacing: 1 }}>ACC </span><span style={{ color: C.textMuted }}>{fi.accessionNo}</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <a href={fi.url}
                    target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    style={{ fontSize: 9, fontFamily: f, fontWeight: 300, color: c, textDecoration: "none", padding: "2px 7px", border: `1px solid ${c}44`, letterSpacing: 0.5 }}>VIEW FILING ↗</a>
                  <a href={`https://efts.sec.gov/LATEST/search-index?q=%22${fi.accessionNo}%22`}
                    target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    style={{ fontSize: 9, fontFamily: f, fontWeight: 300, color: C.textDim, textDecoration: "none", padding: "2px 7px", border: `1px solid ${C.borderHi}`, letterSpacing: 0.5 }}>FULL TEXT ↗</a>
                </div>
              </div>
            )}
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
            style={{ fontSize: 10, fontFamily: f, color: C.gold, textDecoration: "none", padding: "7px 8px", border: `1px solid ${C.border}`, display: "block" }}>
            {label} ↗
          </a>
        ))}
      </div>
    </>
  );
});

const SubOwnership = memo(function SubOwnership({ ticker }: { ticker: string }) {
  const mock = useMemo(() => genMockData(ticker), [ticker]);
  return (
    <>
      <Sec>INSTITUTIONAL HOLDERS</Sec>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "5px 0", borderBottom: `1px solid ${C.borderHi}` }}>
        {["INSTITUTION", "% OUT", "CHG"].map((h, i) => (
          <span key={i} style={{ fontSize: 9, fontFamily: f, fontWeight: 300, color: C.textDim, letterSpacing: 1.5, textAlign: i > 0 ? "right" : "left" }}>{h}</span>
        ))}
      </div>
      {mock.holders.map((h, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, fontFamily: f, color: C.text }}>{h.name}</span>
          <span style={{ fontSize: 11, fontFamily: f, color: C.gold, textAlign: "right", fontWeight: 300 }}>{h.pct}%</span>
          <span style={{ fontSize: 11, fontFamily: f, textAlign: "right", color: h.chg.startsWith("+") ? C.green : h.chg.startsWith("-") ? C.red : C.textDim }}>{h.chg}</span>
        </div>
      ))}

      <Sec>INSIDER TRANSACTIONS</Sec>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.6fr 1fr 0.6fr", padding: "5px 0", borderBottom: `1px solid ${C.borderHi}` }}>
        {["NAME", "TITLE", "TYPE", "SHARES", "DATE"].map((h, i) => (
          <span key={i} style={{ fontSize: 9, fontFamily: f, fontWeight: 300, color: C.textDim, letterSpacing: 1.2, textAlign: i >= 3 ? "right" : "left" }}>{h}</span>
        ))}
      </div>
      {mock.insiders.map((t, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.6fr 1fr 0.6fr", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, fontFamily: f, color: C.text }}>{t.name}</span>
          <span style={{ fontSize: 11, fontFamily: f, color: C.textMuted }}>{t.title}</span>
          <span style={{ fontSize: 11, fontFamily: f, color: t.action === "BUY" ? C.green : C.red, fontWeight: 300 }}>{t.action}</span>
          <span style={{ fontSize: 11, fontFamily: f, color: C.text, textAlign: "right" }}>{t.shares}</span>
          <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, textAlign: "right" }}>{t.date}</span>
        </div>
      ))}
    </>
  );
});

const SubValuation = memo(function SubValuation({ ticker, fund }: { ticker: string; fund: FundamentalData | null }) {
  const mock = useMemo(() => genMockData(ticker), [ticker]);
  const pe = fund?.peRatio ?? +mock.pe;
  const fwdPe = +mock.fwdPe;
  const mktCapNum = fund?.marketCap ? fund.marketCap / 1e9 : parseFloat(mock.mktCapStr.replace(/[$B]/g, ""));

  const multiples = [
    { m: "P/E (TTM)", co: +pe.toFixed(1), sec: +(pe * 0.85).toFixed(1), sp: 22.5 },
    { m: "Fwd P/E", co: +fwdPe.toFixed(1), sec: +(fwdPe * 0.9).toFixed(1), sp: 19.8 },
    { m: "EV/Rev", co: +(mktCapNum / (mock.rev[3]?.val || 1)).toFixed(1), sec: 6.2, sp: 3.1 },
    { m: "EV/EBITDA", co: +(pe * 0.65).toFixed(1), sec: +(pe * 0.55).toFixed(1), sp: 14.2 },
    { m: "P/B", co: +(mktCapNum / (+mock.bs.equity || 1)).toFixed(1), sec: 5.8, sp: 4.2 },
  ];

  return (
    <>
      <Sec>VALUATION MULTIPLES</Sec>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", padding: "5px 0", borderBottom: `1px solid ${C.borderHi}` }}>
        {["METRIC", ticker, "SECTOR", "S&P", "vs SEC"].map((h, i) => (
          <span key={i} style={{ fontSize: 9, fontFamily: f, fontWeight: 300, color: C.textDim, letterSpacing: 1.2, textAlign: i > 0 ? "right" : "left" }}>{h}</span>
        ))}
      </div>
      {multiples.map((m, i) => {
        const diff = ((m.co - m.sec) / m.sec * 100).toFixed(0);
        const over = +diff > 0;
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, fontFamily: f, color: C.textMuted, fontWeight: 300 }}>{m.m}</span>
            <span style={{ fontSize: 11, fontFamily: f, color: C.gold, textAlign: "right", fontWeight: 300 }}>{m.co}</span>
            <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, textAlign: "right" }}>{m.sec}</span>
            <span style={{ fontSize: 11, fontFamily: f, color: C.textDim, textAlign: "right" }}>{m.sp}</span>
            <span style={{ fontSize: 11, fontFamily: f, color: over ? C.red : C.green, textAlign: "right", fontWeight: 300 }}>{over ? "+" : ""}{diff}%</span>
          </div>
        );
      })}

      <Sec>COMPARATIVE</Sec>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={multiples}>
          <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
          <XAxis dataKey="m" tick={{ fill: C.textDim, fontSize: 8, fontFamily: f }} interval={0} angle={-15} textAnchor="end" height={40} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis tick={{ fill: C.textDim, fontSize: 9, fontFamily: f }} axisLine={{ stroke: C.border }} tickLine={false} />
          <Tooltip contentStyle={tt} />
          <Bar dataKey="co" fill={C.gold} name={ticker} radius={[2, 2, 0, 0]} />
          <Bar dataKey="sec" fill={C.textDim} name="Sector" radius={[2, 2, 0, 0]} />
          <Bar dataKey="sp" fill={C.borderHi} name="S&P 500" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", gap: 14, padding: "6px 0" }}>
        {([[ticker, C.gold], ["Sector", C.textDim], ["S&P 500", C.borderHi]] as const).map(([l, c]) => (
          <span key={l} style={{ fontSize: 10, fontFamily: f, color: C.textDim }}><span style={{ color: c as string }}>■</span> {l}</span>
        ))}
      </div>
    </>
  );
});


interface CompanyResearchHubProps {
  candles?: CandleData[];
}

export function CompanyResearchHub({ candles }: CompanyResearchHubProps) {
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
    cacheRestoredRef.current = false;
    setTaShowResult(false);
    setTaStreamingText("");
    setTaThinkingTokens([]);
    setPage(0);
  }, [symbol]);

  useEffect(() => {
    if (cacheRestoredRef.current) return;
    cacheRestoredRef.current = true;
    if (technicalsCache) {
      setAnalysisResult(technicalsCache.analysisResult);
      setTaThinkingTokens(technicalsCache.thinkingTokens);
      setTaShowResult(true);
    }
  }, [symbol, technicalsCache]);

  const handleRunTA = useCallback(async () => {
    if (!quote || !history?.candles) return;
    const runId = ++taRunRef.current;
    setAnalysisResult(null);
    setTaStreamingText("");
    setTaThinkingTokens([]);
    setTaShowResult(true);
    setTaStreaming(true);

    let accumulated = "";
    const collectedThinking: string[] = [];
    await consumeStream(
      `${API_BASE}/ai/technical-analysis/stream`,
      { quote, candles: history.candles, model: aiModel, temperature: aiTemp },
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
  }, [quote, history, aiModel, aiTemp, setAnalysisResult, setTechnicalsCache]);

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
      <div className="p-6 text-center">
        <p className="font-mono text-xs text-muted-foreground tracking-widest">
          Connect Brokerage For Company Data
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: f }}>
      <div style={{ display: "flex", gap: 6, padding: "10px 16px", overflowX: "auto", borderBottom: `1px solid ${C.border}` }}>
        {SUB_LABELS.map((label, i) => (
          <button key={label} onClick={() => setPage(i)} style={{
            padding: "5px 14px", fontSize: 11, fontFamily: f, fontWeight: 300,
            color: page === i ? "#000" : C.textMuted,
            background: page === i ? C.gold : "transparent",
            border: `1px solid ${page === i ? C.gold : C.borderHi}`,
            borderRadius: 14, cursor: "pointer", letterSpacing: 0.3, whiteSpace: "nowrap",
          }}>{label}</button>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4, flexShrink: 0 }}>
          {SUB_LABELS.map((_, i) => (
            <div key={i} style={{ width: 5, height: 5, borderRadius: 3, background: page === i ? C.gold : C.borderHi, transition: "background 0.2s" }} />
          ))}
        </div>
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
            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 40px" }}>
              <div style={{ paddingTop: 12, paddingBottom: 4 }}>
                {!taShowResult ? (
                  <button
                    onClick={() => handleRunTA()}
                    disabled={taStreaming || !accessToken || !quote || !history?.candles}
                    style={{
                      width: "100%", padding: "10px 0", fontSize: 11, fontFamily: f, fontWeight: 300,
                      color: "#000",
                      background: C.gold,
                      border: `1px solid ${C.gold}`,
                      cursor: "pointer",
                      letterSpacing: 1.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}
                  >
                    <Activity style={{ width: 14, height: 14 }} />
                    RUN AI ANALYSIS
                  </button>
                ) : taStreaming ? (
                  <div style={{ background: C.card, border: `1px solid ${C.gold}25`, padding: 16, marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <Loader2 style={{ width: 14, height: 14, color: C.gold }} className="animate-spin" />
                      <span style={{ fontSize: 11, fontFamily: f, fontWeight: 300, color: C.gold, letterSpacing: 1 }}>ANALYZING...</span>
                    </div>
                    <AiThinkingFeed texts={taThinkingTokens} isStreaming={true} />
                  </div>
                ) : analysisResult ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Activity style={{ width: 14, height: 14, color: C.gold }} />
                      <span style={{ fontSize: 12, fontFamily: f, fontWeight: 300, color: C.gold, letterSpacing: 1 }}>AI ANALYSIS</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRunTA(); }}
                      disabled={taStreaming || !quote || !history?.candles}
                      style={{
                        fontSize: 10, fontFamily: f, fontWeight: 300, color: C.textMuted,
                        background: "transparent", border: "none",
                        padding: 0, cursor: "pointer", letterSpacing: 0.5,
                        display: "flex", alignItems: "center", gap: 5,
                      }}
                    >
                      <RefreshCw style={{ width: 13, height: 13 }} />
                      REFRESH
                    </button>
                  </div>
                ) : null}
              </div>

              <SubOverview fund={fundamentals} quoteData={quoteData} priceHist={priceHist} volHist={volHist} ai={analysisResult ? parseAiAnalysis(analysisResult) : null} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 40px" }}>
              <SubFinancials ticker={symbol} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 40px" }}>
              <SubSEC ticker={symbol} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 40px" }}>
              <SubOwnership ticker={symbol} />
            </div>

            <div style={{ width: "100%", flexShrink: 0, padding: "0 16px 40px" }}>
              <SubValuation ticker={symbol} fund={fundamentals} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
