import { useState, useEffect, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  X, Building2, TrendingUp, Newspaper, ShieldAlert,
  Loader2, ChevronRight
} from "lucide-react";
import ReactMarkdown from "react-markdown";

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

interface CompanyTearSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

function fmtNum(n: number | null, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

export function CompanyTearSheet({ isOpen, onClose }: CompanyTearSheetProps) {
  const { symbol, accessToken, aiFeatureSettings } = useTerminalStore();
  const aiModel = aiFeatureSettings.technicals.model;
  const aiTemp = aiFeatureSettings.technicals.temperature;
  const anthropicOpusEffort = aiFeatureSettings.technicals.anthropicOpusEffort;
  const anthropicOpusSpeed = aiFeatureSettings.technicals.anthropicOpusSpeed;

  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [sympathyResult, setSympathyResult] = useState<string | null>(null);
  const [sympathyLoading, setSympathyLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken || !symbol) return;

    setFundLoading(true);
    setSympathyLoading(true);
    setFundamentals(null);
    setSympathyResult(null);

    try {
      const res = await fetchWithAuth(
        `${API_BASE}/market/fundamentals?symbol=${encodeURIComponent(symbol)}`
      );
      const data = await res.json() as FundamentalData;
      setFundamentals(data);
    } catch {
      setFundamentals({ symbol, description: null, exchange: null, assetType: null, marketCap: null, sharesOutstanding: null, peRatio: null, pbRatio: null, dividendYield: null, dividendAmount: null, eps: null, beta: null, high52: null, low52: null, sector: null, industry: null, error: "Failed to load" });
    } finally {
      setFundLoading(false);
    }

    try {
      const res = await fetchWithAuth(`${API_BASE}/ai/sympathy-plays`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          model: aiModel,
          temperature: aiTemp,
          anthropic_opus_effort: anthropicOpusEffort,
          anthropic_opus_speed: anthropicOpusSpeed,
        }),
      });
      const data = await res.json() as { response?: string };
      setSympathyResult(data.response ?? null);
    } catch {
      setSympathyResult("Unable to generate sympathy plays.");
    } finally {
      setSympathyLoading(false);
    }
  }, [symbol, accessToken, aiModel]);

  useEffect(() => {
    if (isOpen) fetchData();
  }, [isOpen, fetchData]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "#0c0c0c" }}>
      <div className="flex items-center justify-between px-4 h-12 border-b border-card-border bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono text-xs font-bold text-primary tracking-wider truncate">
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
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                <span className="font-mono text-xs font-bold text-foreground tracking-wider">{symbol}</span>
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
              {fundamentals.description && (
                <div className="px-4 py-3 bg-[#0c0c0c]">
                  <p className="text-sm text-gray-300 leading-relaxed">{fundamentals.description}</p>
                </div>
              )}
            </div>


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
          </>
        ) : null}

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs font-bold text-foreground tracking-wider">SYMPATHY & COMPETITORS</span>
          </div>
          <div className="p-4 bg-[#0c0c0c]">
            {sympathyLoading ? (
              <div className="flex items-center gap-3 py-6 justify-center">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
                <span className="font-mono text-[10px] text-primary animate-pulse tracking-widest">
                  AI ANALYZING CORRELATIONS...
                </span>
              </div>
            ) : sympathyResult ? (
              <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-li:text-gray-300
                prose-strong:text-primary prose-a:text-primary">
                <ReactMarkdown>{sympathyResult}</ReactMarkdown>
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground text-center py-4">No data available</p>
            )}
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-primary" />
            <span className="font-mono text-xs font-bold text-foreground tracking-wider">RECENT HEADLINES</span>
          </div>
          <div className="p-4 bg-[#0c0c0c] flex flex-col items-center justify-center py-8 gap-2">
            <Newspaper className="w-6 h-6 text-muted-foreground/30" />
            <span className="font-mono text-[10px] text-muted-foreground/50 tracking-wider text-center">
              NEWS FEED INTEGRATION COMING SOON
            </span>
            <span className="font-mono text-[9px] text-muted-foreground/30">
              Real-time headlines & sentiment analysis
            </span>
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-card-border flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500/70" />
            <span className="font-mono text-xs font-bold text-foreground tracking-wider">INSTITUTIONAL FLOW</span>
            <span className="font-mono text-[8px] text-amber-500/60 border border-amber-500/20 px-1.5 py-0.5 rounded-full ml-auto">
              PREMIUM
            </span>
          </div>
          <div className="p-4 bg-[#0c0c0c] flex flex-col items-center justify-center py-8 gap-2">
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
