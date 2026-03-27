import { useState, useEffect, useCallback, useMemo } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import {
  X, Building2, TrendingUp, Activity,
  DollarSign, BarChart3, Users, Landmark, ShieldCheck,
  Loader2, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

const API_BASE = "/api";

interface FundamentalData {
  symbol: string;
  description: string | null;
  exchange: string | null;
  assetType: string | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  dividendAmount: number | null;
  eps: number | null;
  beta: number | null;
  high52: number | null;
  low52: number | null;
  sector: string | null;
  industry: string | null;
  error?: string;
}

interface TearSheetData {
  livePrice: number | null;
  dayChange: number | null;
  dayChangePercent: number | null;
  companyName: string | null;
  exchange: string | null;
  assetType: string | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  pbRatio: number | null;
  eps: number | null;
  beta: number | null;
  dividendYield: number | null;
  dividendAmount: number | null;
  sector: string | null;
  industry: string | null;
}

function useTearSheet(symbol: string) {
  const { accessToken } = useTerminalStore();
  const { data: quote, isLoading: quoteLoading } = useQuote(symbol);

  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);

  const fetchFundamentals = useCallback(async () => {
    if (!accessToken || !symbol) return;
    setFundLoading(true);
    setFundError(null);
    try {
      const res = await fetch(
        `${API_BASE}/market/fundamentals?symbol=${encodeURIComponent(symbol)}&accessToken=${encodeURIComponent(accessToken)}`
      );
      const data = await res.json() as FundamentalData;
      if (data.error) {
        setFundError(data.error);
        setFundamentals(null);
      } else {
        setFundamentals(data);
      }
    } catch {
      setFundError("Failed to load fundamentals");
      setFundamentals(null);
    } finally {
      setFundLoading(false);
    }
  }, [symbol, accessToken]);

  useEffect(() => {
    fetchFundamentals();
  }, [fetchFundamentals]);

  const tearSheet: TearSheetData | null = useMemo(() => {
    if (!quote && !fundamentals) return null;
    return {
      livePrice: quote?.last ?? null,
      dayChange: quote?.change ?? null,
      dayChangePercent: quote?.changePct ?? null,
      companyName: quote?.description ?? fundamentals?.description ?? null,
      exchange: fundamentals?.exchange ?? null,
      assetType: fundamentals?.assetType ?? null,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      volume: quote?.volume ?? null,
      dayHigh: quote?.high ?? null,
      dayLow: quote?.low ?? null,
      fiftyTwoWeekHigh: quote?.fiftyTwoWeekHigh ?? fundamentals?.high52 ?? null,
      fiftyTwoWeekLow: quote?.fiftyTwoWeekLow ?? fundamentals?.low52 ?? null,
      marketCap: fundamentals?.marketCap ?? null,
      sharesOutstanding: fundamentals?.sharesOutstanding ?? null,
      peRatio: quote?.peRatio ?? fundamentals?.peRatio ?? null,
      pbRatio: fundamentals?.pbRatio ?? null,
      eps: fundamentals?.eps ?? null,
      beta: fundamentals?.beta ?? null,
      dividendYield: fundamentals?.dividendYield ?? null,
      dividendAmount: fundamentals?.dividendAmount ?? null,
      sector: fundamentals?.sector ?? null,
      industry: fundamentals?.industry ?? null,
    };
  }, [quote, fundamentals]);

  return {
    data: tearSheet,
    isLoading: quoteLoading || fundLoading,
    fundError,
  };
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-white/[0.04] ${className}`} />
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-white/[0.04]">
      <td className="py-3 px-4"><SkeletonBlock className="h-4 w-32" /></td>
      <td className="py-3 px-4 text-right"><SkeletonBlock className="h-4 w-20 ml-auto" /></td>
      <td className="py-3 px-4 text-right"><SkeletonBlock className="h-4 w-24 ml-auto" /></td>
      <td className="py-3 px-4 text-right"><SkeletonBlock className="h-4 w-16 ml-auto" /></td>
      <td className="py-3 px-4 text-right"><SkeletonBlock className="h-4 w-20 ml-auto" /></td>
    </tr>
  );
}

function fmtCurrency(n: number | null, digits = 2): string {
  if (n == null || isNaN(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtPct(n: number | null): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtChange(n: number | null): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function fmtLargeNum(n: number | null): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtShares(n: number | null): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtNum(n: number | null, decimals = 2): string {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(decimals);
}

function fmtVol(n: number | null): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function HeroHeader({ symbol, data }: { symbol: string; data: TearSheetData | null }) {
  const isPositive = (data?.dayChange ?? 0) >= 0;
  const isFlat = data?.dayChange === 0 || data?.dayChange == null;
  const changeColor = isFlat ? "text-gray-400" : isPositive ? "text-emerald-400" : "text-red-400";
  const changeBg = isFlat ? "bg-gray-500/10" : isPositive ? "bg-emerald-500/10" : "bg-red-500/10";
  const ChangeIcon = isFlat ? Minus : isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full blur-[160px] opacity-20"
          style={{ background: isPositive ? "#00E676" : "#FF1744" }}
        />
      </div>

      <div className="relative px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white tabular-nums">
                {symbol}
              </h1>
              {data?.exchange && (
                <span className="text-[10px] font-mono text-gray-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full uppercase tracking-widest">
                  {data.exchange}
                </span>
              )}
              {data?.assetType && (
                <span className="text-[10px] font-mono text-gray-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full uppercase tracking-widest">
                  {data.assetType}
                </span>
              )}
            </div>
            {data?.companyName ? (
              <p className="text-sm text-gray-400 truncate max-w-[300px] sm:max-w-[400px]">
                {data.companyName}
              </p>
            ) : (
              <SkeletonBlock className="h-4 w-48 mt-1" />
            )}
          </div>
        </div>

        <div className="flex items-end gap-4 flex-wrap">
          <div>
            {data?.livePrice != null ? (
              <span className="text-4xl sm:text-5xl font-black text-white tabular-nums tracking-tight leading-none">
                {fmtCurrency(data.livePrice)}
              </span>
            ) : (
              <SkeletonBlock className="h-12 w-48" />
            )}
          </div>

          <div className="flex items-center gap-2 pb-1">
            {data?.dayChange != null ? (
              <>
                <div className={`flex items-center gap-1 ${changeBg} ${changeColor} px-2.5 py-1 rounded-full`}>
                  <ChangeIcon className="w-3.5 h-3.5" />
                  <span className="text-sm font-bold tabular-nums">{fmtChange(data.dayChange)}</span>
                </div>
                <span className={`text-sm font-bold tabular-nums ${changeColor}`}>
                  ({fmtPct(data.dayChangePercent)})
                </span>
              </>
            ) : (
              <SkeletonBlock className="h-7 w-32" />
            )}
          </div>
        </div>

        {(data?.bid != null || data?.ask != null || data?.volume != null) && (
          <div className="flex items-center gap-4 mt-3 text-[11px] font-mono text-gray-500">
            {data.bid != null && (
              <span>BID <span className="text-gray-300 tabular-nums">{fmtCurrency(data.bid)}</span></span>
            )}
            {data.ask != null && (
              <span>ASK <span className="text-gray-300 tabular-nums">{fmtCurrency(data.ask)}</span></span>
            )}
            {data.volume != null && (
              <span>VOL <span className="text-gray-300 tabular-nums">{fmtVol(data.volume)}</span></span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3.5 flex flex-col gap-1.5 hover:border-white/[0.1] transition-colors">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest leading-none">{label}</span>
      </div>
      <span className="text-sm font-bold text-white tabular-nums">{value}</span>
    </div>
  );
}

function FiftyTwoWeekBar({ high, low, current }: { high: number | null; low: number | null; current: number | null }) {
  if (high == null || low == null) return null;

  const range = high - low;
  const pct = range > 0 && current != null ? Math.min(Math.max(((current - low) / range) * 100, 0), 100) : 50;

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">52-Week Range</span>
        {current != null && (
          <span className="text-[10px] font-mono text-gray-400 tabular-nums">
            Current: {fmtCurrency(current)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-red-400 tabular-nums shrink-0">{fmtCurrency(low)}</span>
        <div className="flex-1 relative h-2 bg-white/[0.04] rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500/60 via-primary/60 to-emerald-500/60"
            style={{ width: "100%" }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-primary shadow-lg shadow-primary/30"
            style={{ left: `calc(${pct}% - 6px)` }}
          />
        </div>
        <span className="text-xs font-mono text-emerald-400 tabular-nums shrink-0">{fmtCurrency(high)}</span>
      </div>
    </div>
  );
}

function InstitutionalOwnershipCard() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
            Institutional Ownership (13F)
          </span>
        </div>
        <span className="text-[9px] font-mono text-amber-400/70 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
          DATA PENDING
        </span>
      </div>

      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left py-2.5 px-4 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-medium">Institution</th>
              <th className="text-right py-2.5 px-4 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-medium">Shares</th>
              <th className="text-right py-2.5 px-4 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-medium">Value</th>
              <th className="text-right py-2.5 px-4 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-medium">Change</th>
              <th className="text-right py-2.5 px-4 text-[10px] font-mono text-gray-500 uppercase tracking-wider font-medium">Filing</th>
            </tr>
          </thead>
          <tbody>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </tbody>
        </table>
      </div>

      <div className="px-5 py-4 border-t border-white/[0.06] bg-white/[0.01]">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-primary/50 animate-spin" />
            <span className="text-[11px] font-mono text-gray-500">
              13F / Institutional ownership data pending...
            </span>
          </div>
          <p className="text-[10px] text-gray-600 text-center max-w-sm">
            Institutional holder data from SEC 13F filings requires a dedicated data feed.
            Skeleton rows will populate once the backend endpoint is built.
          </p>
        </div>
      </div>
    </div>
  );
}

function TradingMetricsGrid({ data }: { data: TearSheetData | null }) {
  if (!data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3.5">
            <SkeletonBlock className="h-3 w-16 mb-2" />
            <SkeletonBlock className="h-5 w-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
      <StatCard
        icon={<DollarSign className="w-3 h-3 text-primary" />}
        label="Market Cap"
        value={fmtLargeNum(data.marketCap)}
      />
      <StatCard
        icon={<Users className="w-3 h-3 text-primary" />}
        label="Shares Out"
        value={fmtShares(data.sharesOutstanding)}
      />
      <StatCard
        icon={<BarChart3 className="w-3 h-3 text-primary" />}
        label="P/E Ratio"
        value={fmtNum(data.peRatio)}
      />
      <StatCard
        icon={<Activity className="w-3 h-3 text-primary" />}
        label="EPS (TTM)"
        value={data.eps != null ? fmtCurrency(data.eps) : "—"}
      />
      <StatCard
        icon={<TrendingUp className="w-3 h-3 text-primary" />}
        label="Beta"
        value={fmtNum(data.beta)}
      />
      <StatCard
        icon={<Landmark className="w-3 h-3 text-primary" />}
        label="Div Yield"
        value={data.dividendYield != null ? `${fmtNum(data.dividendYield)}%` : "—"}
      />
      <StatCard
        icon={<BarChart3 className="w-3 h-3 text-primary" />}
        label="P/B Ratio"
        value={fmtNum(data.pbRatio)}
      />
      <StatCard
        icon={<DollarSign className="w-3 h-3 text-primary" />}
        label="Day Range"
        value={data.dayHigh != null && data.dayLow != null
          ? `${fmtCurrency(data.dayLow, 2)} – ${fmtCurrency(data.dayHigh, 2)}`
          : "—"
        }
      />
    </div>
  );
}

interface InstitutionalTearSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function InstitutionalTearSheet({ isOpen, onClose }: InstitutionalTearSheetProps) {
  const { symbol } = useTerminalStore();
  const { data, isLoading, fundError } = useTearSheet(symbol);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "#060A10" }}>
      <div className="flex items-center justify-between px-4 sm:px-5 h-12 border-b border-white/[0.06] bg-[#0A0F16] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Building2 className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono text-xs font-bold text-primary tracking-wider truncate">
            INSTITUTIONAL TEAR SHEET
          </span>
          <span className="hidden sm:inline text-[10px] font-mono text-gray-500 bg-white/[0.04] px-2 py-0.5 rounded">
            {symbol}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          aria-label="Close tear sheet"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="max-w-4xl mx-auto w-full">
          <HeroHeader symbol={symbol} data={data} />

          <div className="px-4 sm:px-6 pb-8 space-y-4">
            {isLoading && !data ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <span className="font-mono text-xs text-primary/70 animate-pulse tracking-widest">
                  LOADING TEAR SHEET...
                </span>
              </div>
            ) : fundError && !data ? (
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-8 text-center">
                <span className="font-mono text-xs text-gray-500">{fundError}</span>
              </div>
            ) : (
              <>
                <TradingMetricsGrid data={data} />

                <FiftyTwoWeekBar
                  high={data?.fiftyTwoWeekHigh ?? null}
                  low={data?.fiftyTwoWeekLow ?? null}
                  current={data?.livePrice ?? null}
                />

                {(data?.sector || data?.industry) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {data?.sector && (
                      <span className="text-[10px] font-mono text-gray-400 bg-white/[0.04] border border-white/[0.06] px-3 py-1.5 rounded-lg">
                        SECTOR: <span className="text-gray-200">{data.sector}</span>
                      </span>
                    )}
                    {data?.industry && (
                      <span className="text-[10px] font-mono text-gray-400 bg-white/[0.04] border border-white/[0.06] px-3 py-1.5 rounded-lg">
                        INDUSTRY: <span className="text-gray-200">{data.industry}</span>
                      </span>
                    )}
                  </div>
                )}

                <InstitutionalOwnershipCard />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
