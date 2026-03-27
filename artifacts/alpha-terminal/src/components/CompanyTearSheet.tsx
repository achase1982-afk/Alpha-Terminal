import { useState, useEffect, useCallback, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  X, Building2, TrendingUp, Newspaper, ShieldAlert,
  Loader2, Users, BarChart3, Landmark, DollarSign,
  Activity, ChevronRight, Brain, Tag, AlertTriangle
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = "/api";

interface FundamentalData {
  symbol: string;
  companyName: string | null;
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

interface CompanyTearSheetProps {
  isOpen: boolean;
  onClose: () => void;
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

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-[#0D1117] border border-card-border rounded-lg p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className="font-mono text-sm text-foreground font-semibold">{value}</span>
    </div>
  );
}

export function CompanyTearSheet({ isOpen, onClose }: CompanyTearSheetProps) {
  const { symbol, accessToken, aiModel } = useTerminalStore();

  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiTimedOut, setAiTimedOut] = useState(false);
  const aiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken || !symbol) return;

    setFundLoading(true);
    setAiLoading(true);
    setAiTimedOut(false);
    setFundamentals(null);
    setAiResult(null);

    if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
    aiTimeoutRef.current = setTimeout(() => {
      setAiLoading(prev => {
        if (prev) setAiTimedOut(true);
        return false;
      });
    }, 10_000);

    const fundPromise = fetch(
      `${API_BASE}/market/fundamentals?symbol=${encodeURIComponent(symbol)}&accessToken=${encodeURIComponent(accessToken)}`
    )
      .then(res => res.json() as Promise<FundamentalData>)
      .then(data => setFundamentals(data))
      .catch(() => {
        setFundamentals({
          symbol, companyName: null, description: null, exchange: null, assetType: null,
          marketCap: null, sharesOutstanding: null, peRatio: null, pbRatio: null,
          dividendYield: null, dividendAmount: null, eps: null, beta: null,
          high52: null, low52: null, sector: null, industry: null, error: "Failed to load"
        });
      })
      .finally(() => setFundLoading(false));

    const aiPromise = fetch(`${API_BASE}/ai/sympathy-plays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, model: aiModel, temperature: 0.3 }),
    })
      .then(res => res.json() as Promise<{ response?: string }>)
      .then(data => {
        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
        setAiResult(data.response ?? null);
        setAiTimedOut(false);
        setAiLoading(false);
      })
      .catch(() => {
        if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
        setAiResult(null);
        setAiTimedOut(true);
        setAiLoading(false);
      });

    await Promise.allSettled([fundPromise, aiPromise]);
  }, [symbol, accessToken, aiModel]);

  useEffect(() => {
    if (isOpen) fetchData();
    return () => {
      if (aiTimeoutRef.current) clearTimeout(aiTimeoutRef.current);
    };
  }, [isOpen, fetchData]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" style={{ background: "#0A0F16" }}>
      <div className="flex items-center justify-between px-4 h-12 border-b border-card-border bg-[#0D1117] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono text-xs font-bold text-primary tracking-wider">
            COMPANY PROFILE: {symbol}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors shrink-0"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4 max-w-3xl mx-auto w-full">
        {fundLoading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <span className="font-mono text-xs text-primary animate-pulse tracking-widest">LOADING FUNDAMENTALS...</span>
          </div>
        ) : fundamentals?.error ? (
          <div className="bg-card border border-card-border rounded-xl p-6 text-center">
            <span className="font-mono text-xs text-muted-foreground">{fundamentals.error}</span>
          </div>
        ) : fundamentals ? (
          <>
            {/* ── Company Header ── */}
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-card-border">
                <div className="flex items-start gap-2">
                  <Building2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-foreground tracking-wider">{symbol}</span>
                      {fundamentals.exchange && (
                        <span className="font-mono text-[9px] text-muted-foreground bg-card-border px-1.5 py-0.5 rounded">
                          {fundamentals.exchange}
                        </span>
                      )}
                      {fundamentals.assetType && (
                        <span className="font-mono text-[9px] text-muted-foreground bg-card-border px-1.5 py-0.5 rounded">
                          {fundamentals.assetType}
                        </span>
                      )}
                    </div>
                    {fundamentals.companyName && (
                      <p className="text-sm text-gray-300 mt-1 leading-snug">{fundamentals.companyName}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Sector & Industry Badges ── */}
              {(fundamentals.sector || fundamentals.industry) && (
                <div className="px-4 py-2.5 border-b border-card-border flex items-center gap-2 flex-wrap bg-[#0D1117]">
                  <Tag className="w-3 h-3 text-muted-foreground shrink-0" />
                  {fundamentals.sector && (
                    <span className="font-mono text-[10px] text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                      {fundamentals.sector}
                    </span>
                  )}
                  {fundamentals.industry && (
                    <span className="font-mono text-[10px] text-gray-300 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                      {fundamentals.industry}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ── Fundamental Metrics Grid ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <MetricCard
                icon={<DollarSign className="w-3 h-3 text-primary" />}
                label="Market Cap"
                value={fmtMarketCap(fundamentals.marketCap)}
              />
              <MetricCard
                icon={<Users className="w-3 h-3 text-primary" />}
                label="Shares Out"
                value={fmtShares(fundamentals.sharesOutstanding)}
              />
              <MetricCard
                icon={<BarChart3 className="w-3 h-3 text-primary" />}
                label="P/E Ratio"
                value={fmtNum(fundamentals.peRatio)}
              />
              <MetricCard
                icon={<Activity className="w-3 h-3 text-primary" />}
                label="EPS (TTM)"
                value={fundamentals.eps != null ? `$${fmtNum(fundamentals.eps)}` : "—"}
              />
              <MetricCard
                icon={<TrendingUp className="w-3 h-3 text-primary" />}
                label="Beta"
                value={fmtNum(fundamentals.beta)}
              />
              <MetricCard
                icon={<Landmark className="w-3 h-3 text-primary" />}
                label="Div Yield"
                value={fundamentals.dividendYield != null ? `${fmtNum(fundamentals.dividendYield)}%` : "—"}
              />
            </div>

            {/* ── 52-Week Range ── */}
            {(fundamentals.high52 != null || fundamentals.low52 != null) && (
              <div className="bg-card border border-card-border rounded-xl p-4">
                <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">52-Week Range</span>
                <div className="flex items-center gap-3 mt-2">
                  <span className="font-mono text-sm text-red-400">${fmtNum(fundamentals.low52)}</span>
                  <div className="flex-1 h-1.5 bg-card-border rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-red-500 via-primary to-emerald-500 rounded-full" style={{ width: "100%" }} />
                  </div>
                  <span className="font-mono text-sm text-emerald-400">${fmtNum(fundamentals.high52)}</span>
                </div>
              </div>
            )}

            {/* ── Business Description ── */}
            {fundamentals.description && (
              <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  <span className="font-mono text-xs font-bold text-foreground tracking-wider">BUSINESS DESCRIPTION</span>
                </div>
                <div className="px-4 py-3 bg-[#0D1117]">
                  <p className="text-sm text-gray-300 leading-relaxed">{fundamentals.description}</p>
                </div>
              </div>
            )}
          </>
        ) : null}

        {/* ── AI Analyst Briefing ── */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs font-bold text-foreground tracking-wider">AI ANALYST BRIEFING</span>
          </div>
          <div className="p-4 bg-[#0D1117]">
            {aiLoading && !aiTimedOut ? (
              <div className="flex items-center gap-3 py-6 justify-center">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
                <span className="font-mono text-[10px] text-primary animate-pulse tracking-widest">
                  AI GENERATING BRIEFING...
                </span>
              </div>
            ) : aiTimedOut ? (
              <div className="flex items-center gap-3 py-6 justify-center">
                <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">
                  Analysis unavailable at this time
                </span>
              </div>
            ) : aiResult ? (
              <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-li:text-gray-300
                prose-strong:text-primary prose-a:text-primary">
                <ReactMarkdown>{aiResult}</ReactMarkdown>
              </div>
            ) : (
              <div className="flex items-center gap-3 py-6 justify-center">
                <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">
                  Analysis unavailable at this time
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Recent Headlines (placeholder) ── */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs font-bold text-foreground tracking-wider">RECENT HEADLINES</span>
          </div>
          <div className="p-4 bg-[#0D1117] flex flex-col items-center justify-center py-8 gap-2">
            <Newspaper className="w-6 h-6 text-muted-foreground/30" />
            <span className="font-mono text-[10px] text-muted-foreground/50 tracking-wider text-center">
              NEWS FEED INTEGRATION COMING SOON
            </span>
            <span className="font-mono text-[9px] text-muted-foreground/30">
              Real-time headlines & sentiment analysis
            </span>
          </div>
        </div>

        {/* ── Institutional Flow (premium placeholder) ── */}
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500/70" />
            <span className="font-mono text-xs font-bold text-foreground tracking-wider">INSTITUTIONAL FLOW</span>
            <span className="font-mono text-[8px] text-amber-500/60 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full ml-auto">
              PREMIUM
            </span>
          </div>
          <div className="p-4 bg-[#0D1117] flex flex-col items-center justify-center py-8 gap-2">
            <ShieldAlert className="w-6 h-6 text-amber-500/20" />
            <span className="font-mono text-[10px] text-amber-500/40 tracking-wider text-center">
              DATA FEED UNAVAILABLE OR RESTRICTED
            </span>
            <span className="font-mono text-[9px] text-muted-foreground/30 text-center max-w-xs">
              Dark pool prints, insider transactions & 13F institutional holdings require premium data feed
            </span>
            <button className="mt-2 font-mono text-[9px] text-primary/60 hover:text-primary flex items-center gap-1 transition-colors">
              LEARN MORE <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  );
}
