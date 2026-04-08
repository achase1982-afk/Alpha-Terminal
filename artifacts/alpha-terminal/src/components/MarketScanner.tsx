import { useState, useEffect, memo, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { SlidersHorizontal, ChevronDown, AlertTriangle, Search, List, Crosshair, Send, Shield, BarChart3 } from "lucide-react";
import { useScanCache } from "@/hooks/useScanCache";
import { useMarketPulseStore } from "@/stores/marketPulseStore";

const API_BASE = "/api";

const UNIVERSES: Record<string, { label: string; count: number; symbols: string[] }> = {
  sp100: {
    label: "S&P 500 Top 100",
    count: 100,
    symbols: [
      "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","BRK.B","LLY","AVGO",
      "JPM","TSLA","UNH","XOM","V","MA","PG","COST","JNJ","HD",
      "ABBV","WMT","NFLX","BAC","CRM","ORCL","CVX","MRK","AMD","KO",
      "PEP","LIN","TMO","ACN","CSCO","MCD","ADBE","WFC","ABT","IBM",
      "GE","DHR","PM","ISRG","CAT","INTU","QCOM","VZ","TXN","CMCSA",
      "NOW","AMGN","PFE","AXP","GS","BKNG","SPGI","MS","LOW","NEE",
      "T","BLK","RTX","UNP","DE","AMAT","SYK","VRTX","MDLZ","SCHW",
      "ETN","LRCX","CB","PGR","C","REGN","BSX","ADI","MU","PANW",
      "FI","KLAC","SO","MMC","SBUX","DUK","SNPS","TMUS","CL","CDNS",
      "HCA","CME","TGT","WM","ICE","MCO","PYPL","ZTS","PH","SLB",
    ],
  },
  ndx100: {
    label: "Nasdaq 100",
    count: 100,
    symbols: [
      "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","AVGO","TSLA","COST",
      "NFLX","AMD","ADBE","QCOM","PEP","LIN","CSCO","INTU","TXN","CMCSA",
      "AMGN","ISRG","BKNG","AMAT","VRTX","LRCX","PANW","ADI","MU","KLAC",
      "SNPS","CDNS","REGN","MELI","PYPL","MDLZ","MAR","FTNT","ORLY","CHTR",
      "CTAS","MNST","DASH","ABNB","KDP","PCAR","MRVL","AEP","NXPI","KHC",
      "DXCM","ODFL","CPRT","FANG","PAYX","EXC","ROST","FAST","IDXX","CTSH",
      "GEHC","VRSK","AZN","CCEP","CSGP","EA","BKR","GFS","ON","BIIB",
      "TTD","XEL","TEAM","ANSS","ZS","CDW","ILMN","MDB","DDOG","WBD",
      "SMCI","COIN","ARM","CEG","CRWD","MSTR","APP","PLTR","HOOD","WDAY",
      "SPLK","PDD","RIVN","LCID","ENPH","SEDG","FSLR","MRNA","ZM","ROKU",
    ],
  },
  megacap: {
    label: "Mega Cap Tech",
    count: 20,
    symbols: [
      "AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AVGO","NFLX","AMD",
      "CRM","ORCL","ADBE","INTU","NOW","QCOM","TXN","AMAT","MU","LRCX",
    ],
  },
  highbeta: {
    label: "High Volatility / Beta",
    count: 60,
    symbols: [
      "TSLA","NVDA","AMD","SMCI","COIN","MSTR","PLTR","RIVN","LCID","NIO",
      "SOFI","HOOD","RBLX","SNAP","SQ","SHOP","ROKU","ENPH","SEDG","FSLR",
      "MRNA","BNTX","ARKK","UPST","AFRM","DKNG","PENN","CRWD","NET","DDOG",
      "SNOW","U","ABNB","DASH","MELI","SE","GRAB","BABA","JD","PDD",
      "RIOT","MARA","CLSK","HUT","GME","AMC","BBBY","CVNA","LAZR","IONQ",
      "RGTI","QBTS","SOUN","JOBY","ACHR","LUNR","RKLB","SPCE","PLUG","FCEL",
    ],
  },
  lowbeta: {
    label: "Low Beta / Defensive",
    count: 30,
    symbols: [
      "JNJ","PG","KO","PEP","CL","WMT","COST","MCD","ABT","TMO",
      "UNH","LLY","ABBV","MRK","PFE","AMGN","VRTX","SO","DUK","NEE",
      "AEP","XEL","EXC","WM","RSG","MMC","CB","PGR","TRV","ALL",
    ],
  },
};


interface ScannerQuote {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  volume: number;
  high: number;
  low: number;
}

interface DetComponentScores {
  trendAlignment: number;
  relativeStrength: number;
  volumeConfirmation: number;
  ivrScore: number;
  optionsLiquidity: number;
}

export interface DetCandidate {
  symbol: string;
  totalScore: number;
  components: DetComponentScores;
  price: number;
  changePct: number;
  sector: string;
  keyStatLabel: string;
  keyStatValue: string;
  ivr: number;
  atmIV: number;
  atmSpreadPct: number;
  hasWeeklyOptions: boolean;
  upcomingEvents: Array<{ date: string; title: string; importance: string }>;
  microOverrideEligible: boolean;
  pulseComposite: number;
  pulseConfidence: number;
  pulseBias: string;
  scanTimestamp?: number;
}

interface DetScanResult {
  candidates: DetCandidate[];
  filterSummary: {
    totalScanned: number;
    passedFilters: number;
    scoredAboveThreshold: number;
  };
  scanTimestamp: number;
  pulseBias: string;
}

const SCORE_BARS: { key: keyof DetComponentScores; label: string; max: number; color: string }[] = [
  { key: "trendAlignment", label: "TREND", max: 25, color: "#26a69a" },
  { key: "relativeStrength", label: "RS", max: 20, color: "#42a5f5" },
  { key: "volumeConfirmation", label: "VOL", max: 20, color: "#ab47bc" },
  { key: "ivrScore", label: "IVR", max: 20, color: "#ffb800" },
  { key: "optionsLiquidity", label: "OPT LIQ", max: 15, color: "#ef5350" },
];

const DeterministicCard = memo(function DeterministicCard({
  candidate, rank, onSelect, onSendToStrategist,
}: {
  candidate: DetCandidate; rank: number;
  onSelect: (sym: string) => void;
  onSendToStrategist?: (sym: string, candidate: DetCandidate) => void;
}) {
  const { data } = useQuote(candidate.symbol);
  const livePrice = data?.last ?? candidate.price;
  const liveChangePct = data?.changePct ?? candidate.changePct;
  const isUp = liveChangePct >= 0;

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden hover:border-zinc-600 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border/50" style={{ background: "#0c0c0c" }}>
        <span className="text-[11px] font-bold tabular-nums w-5 text-zinc-600">#{rank}</span>
        <button onClick={() => onSelect(candidate.symbol)}
          className="font-bold text-sm tracking-wider hover:text-[#FFB800] transition-colors active:scale-95"
          style={{ color: isUp ? "#26a69a" : "#f23645" }}>
          {candidate.symbol}
        </button>
        <span className="text-[11px] text-zinc-500 font-medium">{candidate.sector}</span>
        <div className="ml-auto flex items-center gap-3">
          {candidate.microOverrideEligible && (
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ color: "#FFB800", background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.3)" }}>
              <Shield className="w-3 h-3" /> MICRO-OVERRIDE
            </span>
          )}
          <span className="text-lg font-bold font-mono tabular-nums"
            style={{ color: candidate.totalScore >= 80 ? "#26a69a" : candidate.totalScore >= 60 ? "#FFB800" : "#6B7280" }}>
            {candidate.totalScore}
          </span>
        </div>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2">
        <div>
          <div className="text-[11px] text-zinc-500 uppercase mb-1.5">Score Breakdown</div>
          <div className="space-y-1.5">
            {SCORE_BARS.map(bar => {
              const val = candidate.components[bar.key];
              const pct = Math.round((val / bar.max) * 100);
              return (
                <div key={bar.key} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-zinc-500 w-[52px] text-right shrink-0">{bar.label}</span>
                  <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: "#1a1a1a" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bar.color }} />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-zinc-400 w-8 text-right">{val}/{bar.max}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-[11px] text-zinc-500">Price</span>
            <span className="text-sm font-bold text-zinc-200 tabular-nums">${livePrice.toFixed(2)}
              <span className="text-[11px] ml-1 font-normal" style={{ color: isUp ? "#26a69a" : "#f23645" }}>
                {isUp ? "+" : ""}{liveChangePct.toFixed(2)}%
              </span>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[11px] text-zinc-500">IVR</span>
            <span className="text-sm font-mono tabular-nums"
              style={{ color: candidate.ivr > 50 ? "#FFB800" : candidate.ivr < 30 ? "#26a69a" : "#6B7280" }}>
              {candidate.ivr}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[11px] text-zinc-500">ATM Spread</span>
            <span className="text-sm font-mono tabular-nums text-zinc-300">{candidate.atmSpreadPct.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[11px] text-zinc-500">{candidate.keyStatLabel}</span>
            <span className="text-sm font-mono tabular-nums text-zinc-300">{candidate.keyStatValue}</span>
          </div>
          {candidate.hasWeeklyOptions && (
            <span className="text-[10px] text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5 inline-block">WEEKLYS</span>
          )}
        </div>
      </div>

      {candidate.upcomingEvents.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {candidate.upcomingEvents.map((ev, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border"
                style={{
                  color: ev.importance?.toUpperCase() === "HIGH" ? "#f23645" : "#FFB800",
                  borderColor: ev.importance?.toUpperCase() === "HIGH" ? "rgba(242,54,69,0.3)" : "rgba(255,184,0,0.2)",
                  background: ev.importance?.toUpperCase() === "HIGH" ? "rgba(242,54,69,0.08)" : "rgba(255,184,0,0.05)",
                }}>
                {ev.title} {ev.date}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-2.5 border-t border-card-border/50 flex items-center justify-between" style={{ background: "#0a0a0a" }}>
        <span className="text-[10px] text-zinc-600">
          Bias: {candidate.pulseBias} · Composite: {candidate.pulseComposite}
        </span>
        {onSendToStrategist && (
          <button onClick={() => onSendToStrategist(candidate.symbol, candidate)}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded transition-all hover:bg-[#FFB800]/15 active:scale-95"
            style={{ color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)" }}>
            <Send className="w-3 h-3" /> SEND TO STRATEGIST
          </button>
        )}
      </div>
    </div>
  );
});


const LiveManualRow = memo(function LiveManualRow({ q, onSelect }: {
  q: ScannerQuote; onSelect: (sym: string) => void;
}) {
  const { data } = useQuote(q.symbol);
  const livePrice = data?.last ?? q.last;
  const liveChangePct = data?.changePct ?? q.changePct;
  const liveVolume = data?.volume ?? q.volume;
  const isUp = liveChangePct >= 0;
  const color = isUp ? "#00d166" : "#f23645";
  const [tapped, setTapped] = useState(false);

  const handleTap = useCallback(() => {
    setTapped(true);
    setTimeout(() => setTapped(false), 400);
    onSelect(q.symbol);
  }, [onSelect, q.symbol]);

  return (
    <button onClick={handleTap}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border bg-card
        hover:border-primary/40 transition-all text-left group active:scale-[0.98]"
      style={{ borderColor: tapped ? "rgba(255,184,0,0.5)" : undefined }}>
      <span className="font-bold text-sm w-16 shrink-0" style={{ color: tapped ? "#FFB800" : color }}>{q.symbol}</span>
      <span className="text-sm font-bold text-zinc-200 tabular-nums w-20 shrink-0">${livePrice.toFixed(2)}</span>
      <span className="text-xs font-bold tabular-nums w-16 shrink-0" style={{ color }}>
        {isUp ? "▲" : "▼"} {Math.abs(liveChangePct).toFixed(2)}%
      </span>
      <span className="text-[11px] text-zinc-500 tabular-nums">Vol {(liveVolume / 1e6).toFixed(1)}M</span>
      <span className="ml-auto text-[11px] text-zinc-500 group-hover:text-primary transition-colors">VIEW →</span>
    </button>
  );
});

function UniverseDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const watchlists = useTerminalStore(s => s.watchlists);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick as any);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick as any);
    };
  }, [open]);

  const isWatchlist = value.startsWith("wl:");
  const selectedLabel = isWatchlist
    ? watchlists[value.slice(3)]?.name ?? "Watchlist"
    : UNIVERSES[value]?.label ?? value;
  const selectedCount = isWatchlist
    ? watchlists[value.slice(3)]?.symbols?.length ?? 0
    : UNIVERSES[value]?.symbols?.length ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full min-h-[44px] rounded-md border border-card-border bg-card text-foreground text-sm px-3 py-2 flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors hover:border-zinc-600"
      >
        <span className="font-medium leading-snug">{selectedLabel} <span className="text-zinc-500 font-normal">({selectedCount})</span></span>
        <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 left-0 right-0 rounded-lg border border-zinc-700/80 bg-[#141414] shadow-2xl shadow-black/60 overflow-hidden"
          style={{ maxHeight: "min(500px, 60vh)" }}
        >
          <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: "min(500px, 60vh)", WebkitOverflowScrolling: "touch" as any }}>
            <div className="px-3 pt-3 pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Markets</span>
            </div>
            {Object.entries(UNIVERSES).map(([key, u]) => (
              <button
                key={key}
                onClick={() => { onChange(key); setOpen(false); }}
                className={`w-full text-left px-3 py-3 flex items-center justify-between gap-3 text-sm transition-colors ${
                  value === key ? "bg-[#FFB800]/10 text-[#FFB800]" : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                }`}
              >
                <span className="font-medium leading-snug">{u.label}</span>
                <span className={`text-xs tabular-nums shrink-0 ${value === key ? "text-[#FFB800]/60" : "text-zinc-600"}`}>{u.symbols.length}</span>
              </button>
            ))}

            {Object.keys(watchlists).length > 0 && (
              <>
                <div className="mx-3 my-1.5 border-t border-zinc-700/50" />
                <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
                  <List className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Watchlists</span>
                </div>
                {Object.entries(watchlists).map(([id, wl]) => {
                  const wlKey = `wl:${id}`;
                  return (
                    <button
                      key={id}
                      onClick={() => { onChange(wlKey); setOpen(false); }}
                      className={`w-full text-left px-3 py-3 flex items-center justify-between gap-3 text-sm transition-colors ${
                        value === wlKey ? "bg-[#FFB800]/10 text-[#FFB800]" : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                      }`}
                    >
                      <span className="font-medium leading-snug">{wl.name}</span>
                      <span className={`text-xs tabular-nums shrink-0 ${value === wlKey ? "text-[#FFB800]/60" : "text-zinc-600"}`}>{wl.symbols.length}</span>
                    </button>
                  );
                })}
              </>
            )}
            <div className="h-2" />
          </div>
        </div>
      )}
    </div>
  );
}

export function MarketScanner({ subscribeEquitySymbols, onNavigateToSymbol, onSendToStrategist }: {
  subscribeEquitySymbols?: (symbols: string[]) => void;
  onNavigateToSymbol?: (sym: string) => void;
  onSendToStrategist?: (sym: string, candidate: DetCandidate) => void;
}) {
  const { accessToken, setSymbol, watchlists } = useTerminalStore();
  const { pulseData } = useMarketPulseStore();
  const shockActive = pulseData?.shockState === "ACTIVE";
  const { cachedData: scanCache, setCachedData: setScanCache } = useScanCache();

  const [mode, setMode] = useState<"manual" | "deterministic">("deterministic");
  const [universe, setUniverse] = useState("sp100");
  const [isScanning, setIsScanning] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [manualQuotes, setManualQuotes] = useState<ScannerQuote[]>([]);
  const [scanCount, setScanCount] = useState<number | null>(null);

  const [detResult, setDetResult] = useState<DetScanResult | null>(null);
  const [detError, setDetError] = useState<string | null>(null);

  const scanCacheRestoredRef = useRef(false);
  useEffect(() => {
    if (scanCacheRestoredRef.current || !scanCache) return;
    scanCacheRestoredRef.current = true;
    const r = scanCache.results;
    if (r?.manualQuotes) setManualQuotes(r.manualQuotes);
    if (r?.scanCount != null) setScanCount(r.scanCount);
    if (r?.detResult) setDetResult(r.detResult as DetScanResult);
  }, [scanCache]);

  const [minChangePct, setMinChangePct] = useState(0);
  const [maxChangePct, setMaxChangePct] = useState(15);
  const [minVolume, setMinVolume] = useState(1);
  const [minPrice, setMinPrice] = useState(5);
  const [maxPrice, setMaxPrice] = useState(1000);

  const getSymbols = (): string[] => {
    if (universe.startsWith("wl:")) {
      const wlId = universe.slice(3);
      return watchlists[wlId]?.symbols ?? [];
    }
    return UNIVERSES[universe]?.symbols ?? [];
  };

  const handleManualScan = async () => {
    if (!accessToken) return;
    const syms = getSymbols();
    if (!syms.length) { setRawError("No symbols to scan. Select a market universe or a watchlist with symbols."); return; }

    setIsScanning(true);
    setRawError(null);
    setManualQuotes([]);
    setScanCount(syms.length);

    try {
      const payload = {
        symbols: syms, accessToken, mode: "manual",
        filters: { minChangePct, maxChangePct, minVolume, minPrice, maxPrice },
      };

      const res = await fetchWithAuth(`${API_BASE}/ai/market-scanner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json() as {
        quotes?: ScannerQuote[];
        error?: string;
      };

      if (data.error && data.error !== "no_data") {
        setRawError(data.error);
      } else {
        const quotes = data.quotes ?? [];
        setManualQuotes(quotes);
        if (quotes.length && subscribeEquitySymbols) {
          subscribeEquitySymbols(quotes.map(q => q.symbol));
        }
        setScanCache({
          results: { manualQuotes: quotes, scanCount: syms.length },
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      setRawError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleDeterministicScan = async () => {
    if (!accessToken) return;
    const syms = getSymbols();
    if (!syms.length) { setDetError("No symbols to scan. Select a market universe or a watchlist with symbols."); return; }

    setIsScanning(true);
    setDetError(null);
    setDetResult(null);
    setScanCount(syms.length);

    try {
      const res = await fetchWithAuth(`${API_BASE}/ai/deterministic-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: syms, accessToken }),
      });

      const data = await res.json() as DetScanResult & { error?: string; message?: string };

      if (data.error === "shock_active") {
        setDetError(data.message ?? "Scanning paused — regime shock active");
      } else if (data.error) {
        setDetError(data.error);
      } else {
        if (data.scanTimestamp && data.candidates) {
          for (const c of data.candidates) {
            c.scanTimestamp = data.scanTimestamp;
          }
        }
        setDetResult(data);
        if (data.candidates?.length && subscribeEquitySymbols) {
          subscribeEquitySymbols(data.candidates.map(c => c.symbol));
        }
        setScanCache({
          results: { manualQuotes: [], scanCount: syms.length, detResult: data },
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      setDetError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const hasResults = mode === "manual" ? manualQuotes.length > 0 : (detResult?.candidates?.length ?? 0) > 0;
  const currentSyms = getSymbols();

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto pb-6">
      {shockActive && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-red-500/10 border-red-500/30">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="font-mono text-xs font-bold text-red-400 uppercase tracking-wider">Scanning Paused — Regime Shock Active</p>
            <p className="font-mono text-[10px] text-red-400/70 mt-0.5">
              {(pulseData?.activeTriggers?.length ?? 0)} trigger{(pulseData?.activeTriggers?.length ?? 0) !== 1 ? "s" : ""} fired. New scans disabled until shock clears.
            </p>
          </div>
        </div>
      )}
      <div className="bg-card border border-card-border rounded-xl overflow-visible">
        <div className="flex border-b border-card-border rounded-t-xl overflow-hidden">
          {(["deterministic", "manual"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-3 text-sm font-bold uppercase tracking-widest transition-all border-b-2 ${
                mode === m
                  ? "bg-[#18181B] text-white border-b-[#FFB800]"
                  : "bg-transparent text-muted-foreground border-b-transparent hover:text-foreground hover:bg-secondary/20"
              }`}
            >
              {m === "deterministic" ? (
                <span className="flex items-center justify-center gap-2">
                  <Crosshair className="w-3.5 h-3.5" /> DETERMINISTIC
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <SlidersHorizontal className="w-3.5 h-3.5" /> MANUAL FILTER
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-4 bg-[#0c0c0c] space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" /> Scan Universe
              </Label>
              <UniverseDropdown value={universe} onChange={setUniverse} />
            </div>

          </div>

          <div className="text-xs text-muted-foreground">
            Scanning <span className="text-primary font-bold">{currentSyms.length} tickers</span>
            {mode === "deterministic" && <> — Hard scoring: Trend + RS + Volume + IVR + Options Liquidity (top 5, min 60)</>}
          </div>
        </div>

        {mode === "manual" && (
          <div className="p-4 bg-[#0c0c0c] border-t border-card-border grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
                <span>Min Change %</span>
                <span style={{ color: "#00d166" }}>{minChangePct >= 0 ? "+" : ""}{minChangePct}%</span>
              </div>
              <Slider value={[minChangePct]} onValueChange={v => setMinChangePct(v[0])} min={-15} max={15} step={0.5} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
                <span>Max Change %</span>
                <span style={{ color: "#00d166" }}>+{maxChangePct}%</span>
              </div>
              <Slider value={[maxChangePct]} onValueChange={v => setMaxChangePct(v[0])} min={0} max={30} step={0.5} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
                <span>Min Volume</span>
                <span style={{ color: "#ffb800" }}>{minVolume}M+</span>
              </div>
              <Slider value={[minVolume]} onValueChange={v => setMinVolume(v[0])} min={0} max={100} step={1} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
                <span>Price Range</span>
                <span style={{ color: "#ffb800" }}>${minPrice} – ${maxPrice}</span>
              </div>
              <div className="flex gap-3 items-center">
                <Slider value={[minPrice]} onValueChange={v => setMinPrice(v[0])} min={0} max={500} step={5} className="flex-1" />
                <Slider value={[maxPrice]} onValueChange={v => setMaxPrice(v[0])} min={50} max={2000} step={25} className="flex-1" />
              </div>
            </div>
          </div>
        )}

        <div className="px-4 pb-4 pt-3 bg-[#0c0c0c] border-t border-card-border rounded-b-xl">
          <button
            onClick={mode === "deterministic" ? handleDeterministicScan : handleManualScan}
            disabled={!accessToken || isScanning || currentSyms.length === 0 || shockActive}
            className="font-bold font-mono tracking-wider mx-auto block rounded-lg disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 active:brightness-110 transition-all"
            style={{
              fontSize: 13, padding: "10px",
              background: "#18181b", color: "#FFB800", border: "none",
              cursor: "pointer",
            }}
          >
            {isScanning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-[#FFB800] border-t-transparent rounded-full animate-spin" />
                {mode === "deterministic" ? "SCORING CANDIDATES..." : "FILTERING MARKET..."}
              </span>
            ) : (
              <span className="flex items-center justify-center">
                {mode === "deterministic"
                  ? `SCAN ${currentSyms.length} STOCKS`
                  : "APPLY FILTERS & SCAN"}
              </span>
            )}
          </button>
          {!accessToken && (
            <p className="text-[11px] text-destructive mt-2 text-center">
              Connect Brokerage For Market Scanner
            </p>
          )}
        </div>
      </div>

      {isScanning && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-card rounded-xl border border-card-border">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm text-primary animate-pulse font-bold">
              SCANNING {scanCount ?? currentSyms.length} TICKERS...
            </p>
            <p className="text-[11px] text-muted-foreground">
              {mode === "deterministic" ? "Filtering universe → Scoring → Ranking → Enriching" : "Fetching market data..."}
            </p>
          </div>
        </div>
      )}

      {rawError && !isScanning && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-xs text-destructive font-bold mb-2">SCAN ERROR</p>
          <p className="text-[11px] text-destructive/80">{rawError}</p>
        </div>
      )}

      {mode === "manual" && !isScanning && manualQuotes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <Label className="text-[11px] text-muted-foreground uppercase">
              {manualQuotes.length} STOCKS MATCHED — CLICK TO LOAD
            </Label>
            <span className="text-[11px] text-muted-foreground">Sorted by | Change % |</span>
          </div>
          <div className="space-y-1.5">
            {manualQuotes.map(q => (
              <LiveManualRow key={q.symbol} q={q} onSelect={onNavigateToSymbol ?? setSymbol} />
            ))}
          </div>
        </div>
      )}

      {mode === "manual" && !isScanning && manualQuotes.length === 0 && !hasResults && !rawError && (
        <div className="py-16 text-center text-xs text-muted-foreground/40 bg-card border border-card-border rounded-xl">
          No stocks matched your filters. Try widening the ranges.
        </div>
      )}

      {mode === "deterministic" && detError && !isScanning && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-xs text-destructive font-bold mb-2">SCAN ERROR</p>
          <p className="text-[11px] text-destructive/80">{detError}</p>
        </div>
      )}

      {mode === "deterministic" && !isScanning && detResult && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-4 h-4 text-zinc-500" />
              <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">
                {detResult.filterSummary.totalScanned} scanned
                <span className="text-zinc-600 mx-1">|</span>
                {detResult.filterSummary.passedFilters} passed filters
                <span className="text-zinc-600 mx-1">|</span>
                <span style={{ color: "#FFB800" }}>{detResult.filterSummary.scoredAboveThreshold} above threshold</span>
              </span>
            </div>
            <span className="text-[10px] text-zinc-600 tabular-nums">
              {new Date(detResult.scanTimestamp).toLocaleTimeString()}
            </span>
          </div>

          {detResult.candidates.length > 0 ? (
            <div className="space-y-2">
              {detResult.candidates.map((c, i) => (
                <DeterministicCard
                  key={c.symbol}
                  candidate={c}
                  rank={i + 1}
                  onSelect={onNavigateToSymbol ?? setSymbol}
                  onSendToStrategist={onSendToStrategist}
                />
              ))}
            </div>
          ) : (
            <div className="py-16 text-center bg-card border border-card-border rounded-xl">
              <p className="text-sm font-bold text-zinc-400 mb-1">Cash Is a Position</p>
              <p className="text-[11px] text-zinc-600">No candidates scored above threshold. Stand aside or re-evaluate universe.</p>
            </div>
          )}
        </div>
      )}

      {mode === "deterministic" && !isScanning && !detResult && !detError && (
        <div className="py-16 text-center text-xs text-muted-foreground/40 bg-card border border-card-border rounded-xl">
          Select a universe and run a deterministic scan to find trade candidates.
        </div>
      )}
    </div>
  );
}
