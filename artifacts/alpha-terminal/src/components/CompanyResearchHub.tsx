import { useState, useEffect, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Loader2 } from "lucide-react";

const API_BASE = "/api";

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

interface TechnicalSnapshot {
  trend: string | null;
  trendSignal: "bullish" | "neutral" | "bearish" | null;
  rsi: number | null;
  rsiLabel: string | null;
  resistance1: number | null;
  support1: number | null;
  resistance2: number | null;
  support2: number | null;
  shortTermOutlook: string | null;
  error?: string;
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
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtNum(n: number | null, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[8px] text-muted-foreground font-bold tracking-tighter uppercase">{label}</span>
      <span className="text-xs font-mono font-semibold text-white tabular-nums">{value}</span>
    </div>
  );
}

interface CompanyResearchHubProps {
  candles?: Array<{ datetime: string; open: number; high: number; low: number; close: number; volume: number }>;
}

export function CompanyResearchHub({ candles }: CompanyResearchHubProps) {
  const { symbol, accessToken } = useTerminalStore();
  const { data: quoteData } = useQuote(symbol);

  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [technicals, setTechnicals] = useState<TechnicalSnapshot | null>(null);
  const [techLoading, setTechLoading] = useState(false);

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

  const [techFetchedFor, setTechFetchedFor] = useState<string | null>(null);

  useEffect(() => {
    fetchFundamentals();
  }, [fetchFundamentals]);

  useEffect(() => {
    if (!symbol || !quoteData || techFetchedFor === symbol) return;
    let cancelled = false;

    (async () => {
      setTechLoading(true);
      setTechFetchedFor(symbol);
      try {
        const quote = {
          symbol: quoteData.symbol,
          last: quoteData.last,
          bid: quoteData.bid,
          ask: quoteData.ask,
          change: quoteData.change,
          changePct: quoteData.changePct,
          volume: quoteData.volume,
          high: quoteData.high,
          low: quoteData.low,
          fiftyTwoWeekHigh: quoteData.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quoteData.fiftyTwoWeekLow,
          peRatio: quoteData.peRatio,
        };
        const res = await fetchWithAuth(`${API_BASE}/ai/technical-snapshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quote, candles: candles ?? [] }),
        });
        if (cancelled) return;
        const data = await res.json();
        setTechnicals(data);
      } catch {
        if (!cancelled) {
          setTechnicals({ trend: null, trendSignal: null, rsi: null, rsiLabel: null, resistance1: null, support1: null, resistance2: null, support2: null, shortTermOutlook: null, error: "Failed to load" });
        }
      } finally {
        if (!cancelled) setTechLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [symbol, quoteData]);

  const currentPrice = quoteData?.last;
  const high52 = fundamentals?.high52 ?? quoteData?.fiftyTwoWeekHigh;
  const low52 = fundamentals?.low52 ?? quoteData?.fiftyTwoWeekLow;

  const rangePosition = (() => {
    if (currentPrice == null || high52 == null || low52 == null || high52 === low52) return 50;
    return Math.max(0, Math.min(100, ((currentPrice - low52) / (high52 - low52)) * 100));
  })();

  const trendBorderColor = technicals?.trendSignal === "bullish"
    ? "border-terminal-success/30"
    : technicals?.trendSignal === "bearish"
      ? "border-terminal-danger/30"
      : "border-card-border";

  const trendTextColor = technicals?.trendSignal === "bullish"
    ? "text-terminal-success"
    : technicals?.trendSignal === "bearish"
      ? "text-terminal-danger"
      : "text-white";

  if (!accessToken) {
    return (
      <div className="p-6 text-center">
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
          Connect Schwab to view company data
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 animate-in fade-in duration-500">
      <section>
        <h3 className="text-primary text-[10px] font-black tracking-widest mb-3">FUNDAMENTALS</h3>
        {fundLoading ? (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        ) : fundamentals?.error ? (
          <p className="text-xs text-terminal-danger font-mono">{fundamentals.error}</p>
        ) : (
          <div className="grid grid-cols-3 gap-y-4 gap-x-2 bg-card/30 p-3 rounded-lg border border-card-border">
            <DataPoint label="MKT CAP" value={fmtMarketCap(fundamentals?.marketCap ?? null)} />
            <DataPoint label="SHARES" value={fmtShares(fundamentals?.sharesOutstanding ?? null)} />
            <DataPoint label="P/E RATIO" value={fmtNum(fundamentals?.peRatio ?? quoteData?.peRatio ?? null)} />
            <DataPoint label="EPS (TTM)" value={fmtNum(fundamentals?.eps ?? null)} />
            <DataPoint label="BETA" value={fmtNum(fundamentals?.beta ?? null)} />
            <DataPoint label="DIV YIELD" value={fmtPct(fundamentals?.dividendYield ?? null)} />
          </div>
        )}

        {(high52 != null || low52 != null) && (
          <div className="mt-4 px-1">
            <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
              <span>52W LOW {low52 != null ? `$${low52.toFixed(2)}` : "—"}</span>
              {currentPrice != null && (
                <span className="text-primary">CURRENT ${currentPrice.toFixed(2)}</span>
              )}
              <span>52W HIGH {high52 != null ? `$${high52.toFixed(2)}` : "—"}</span>
            </div>
            <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden relative">
              <div className="absolute h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 w-full opacity-30" />
              <div
                className="absolute h-full w-1 bg-white shadow-[0_0_8px_white]"
                style={{ left: `${rangePosition}%` }}
              />
            </div>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-primary text-[10px] font-black tracking-widest mb-3">TECHNICAL ANALYSIS</h3>
        {techLoading ? (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        ) : technicals?.error ? (
          <p className="text-xs text-terminal-danger font-mono">{technicals.error}</p>
        ) : technicals ? (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className={`bg-[#1a1a1a] p-3 rounded border ${trendBorderColor}`}>
                <span className="text-[9px] text-muted-foreground block">TREND</span>
                <span className={`${trendTextColor} font-bold text-sm uppercase`}>
                  {technicals.trend ?? "—"}
                </span>
              </div>
              <div className="bg-[#1a1a1a] p-3 rounded border border-card-border">
                <span className="text-[9px] text-muted-foreground block">RSI (14)</span>
                <span className="text-white font-bold text-sm tabular-nums">
                  {technicals.rsi != null ? `${technicals.rsi.toFixed(1)}` : "—"}
                  {technicals.rsiLabel && (
                    <span className="text-muted-foreground text-xs ml-1">({technicals.rsiLabel})</span>
                  )}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {technicals.resistance1 != null && (
                <div className="flex justify-between items-center p-2 bg-card border-l-2 border-l-terminal-danger">
                  <span className="text-[10px] font-bold">RESISTANCE 1</span>
                  <span className="font-mono text-xs tabular-nums">${technicals.resistance1.toFixed(2)}</span>
                </div>
              )}
              {technicals.resistance2 != null && (
                <div className="flex justify-between items-center p-2 bg-card border-l-2 border-l-terminal-danger/50">
                  <span className="text-[10px] font-bold text-muted-foreground">RESISTANCE 2</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">${technicals.resistance2.toFixed(2)}</span>
                </div>
              )}
              {technicals.support1 != null && (
                <div className="flex justify-between items-center p-2 bg-card border-l-2 border-l-terminal-success">
                  <span className="text-[10px] font-bold">SUPPORT 1</span>
                  <span className="font-mono text-xs tabular-nums">${technicals.support1.toFixed(2)}</span>
                </div>
              )}
              {technicals.support2 != null && (
                <div className="flex justify-between items-center p-2 bg-card border-l-2 border-l-terminal-success/50">
                  <span className="text-[10px] font-bold text-muted-foreground">SUPPORT 2</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">${technicals.support2.toFixed(2)}</span>
                </div>
              )}
            </div>

            {technicals.shortTermOutlook && (
              <div className="mt-3 p-3 bg-[#1a1a1a] rounded border border-card-border">
                <span className="text-[9px] text-muted-foreground block mb-1">SHORT-TERM OUTLOOK</span>
                <span className="text-xs text-white/90 leading-relaxed">{technicals.shortTermOutlook}</span>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground font-mono">No data available</p>
        )}
      </section>
    </div>
  );
}
