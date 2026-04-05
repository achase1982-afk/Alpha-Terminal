import { useState, useEffect, memo, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Zap, SlidersHorizontal, TrendingUp, TrendingDown, Minus, ChevronUp, ChevronDown, AlertTriangle, Search } from "lucide-react";
import { useScanCache } from "@/hooks/useScanCache";

const API_BASE = "/api";

const UNIVERSES: Record<string, { label: string; symbols: string[] }> = {
  sp100: {
    label: "S&P 500 Top 100",
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
  highbeta: {
    label: "High Volatility / Beta",
    symbols: [
      "TSLA","NVDA","AMD","SMCI","COIN","MSTR","PLTR","RIVN","LCID","NIO",
      "SOFI","HOOD","RBLX","SNAP","SQ","SHOP","ROKU","ENPH","SEDG","FSLR",
      "MRNA","BNTX","ARKK","UPST","AFRM","DKNG","PENN","CRWD","NET","DDOG",
      "SNOW","U","ABNB","DASH","MELI","SE","GRAB","BABA","JD","PDD",
      "RIOT","MARA","CLSK","HUT","GME","AMC","BBBY","CVNA","LAZR","IONQ",
      "RGTI","QBTS","SOUN","JOBY","ACHR","LUNR","RKLB","SPCE","PLUG","FCEL",
    ],
  },
};

type SortKey = "symbol" | "direction" | "confidence" | "changePct";
type SortDir = "asc" | "desc";

interface ScannerSetup {
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: "HIGH" | "MILD" | "LOW";
  strategy: string;
  price: number;
  changePct: number;
  rationale: string;
  riskNote: string;
  ivr?: number | null;
  pcRatio?: number | null;
  expectedMove?: number | null;
}

interface ScannerQuote {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  volume: number;
  high: number;
  low: number;
}

function dirColor(dir: string) {
  if (dir === "BULLISH") return "#00d166";
  if (dir === "BEARISH") return "#f23645";
  return "#ffb800";
}

function dirIcon(dir: string) {
  if (dir === "BULLISH") return <TrendingUp className="w-3 h-3" />;
  if (dir === "BEARISH") return <TrendingDown className="w-3 h-3" />;
  return <Minus className="w-3 h-3" />;
}

const CONF_ORDER: Record<string, number> = { HIGH: 3, MILD: 2, LOW: 1 };

function confBadge(conf: string) {
  const c = conf === "HIGH" ? "#ffb800" : conf === "MILD" ? "#ffb800" : "#6B7280";
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ color: c, border: `1px solid ${c}40` }}>
      {conf}
    </span>
  );
}

function SortHeader({ label, sortKey, currentKey, currentDir, onSort }: {
  label: string; sortKey: SortKey; currentKey: SortKey; currentDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <button onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold transition-colors hover:text-white"
      style={{ color: active ? "#ffb800" : "#6B7280" }}>
      {label}
      {active && (currentDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
    </button>
  );
}

const LiveAiRow = memo(function LiveAiRow({ setup, index, onSelect }: {
  setup: ScannerSetup; index: number; onSelect: (sym: string) => void;
}) {
  const { data } = useQuote(setup.symbol);
  const livePrice = data?.last ?? setup.price;
  const liveChangePct = data?.changePct ?? setup.changePct;
  const dc = dirColor(setup.direction);
  const [tapped, setTapped] = useState(false);

  const handleTap = useCallback(() => {
    setTapped(true);
    setTimeout(() => setTapped(false), 400);
    onSelect(setup.symbol);
  }, [onSelect, setup.symbol]);

  return (
    <tr className="border-b border-card-border/50 transition-colors"
      style={{
        ...(index % 2 === 0 ? { background: "rgba(13,17,23,0.4)" } : {}),
        ...(tapped ? { background: "transparent" } : {}),
      }}>
      <td className="px-3 py-2.5">
        <button onClick={handleTap}
          className="font-bold text-sm tracking-wider transition-all active:scale-95"
          style={{ color: tapped ? "#FFB800" : dc }}>
          {setup.symbol}
          <span className="text-[8px] ml-1 opacity-60">→</span>
        </button>
        <div className="text-[10px] text-gray-500 tabular-nums">${livePrice.toFixed(2)}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: dc }}>
          {dirIcon(setup.direction)}
          {setup.direction}
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5 max-w-[140px] truncate" title={setup.strategy}>
          {setup.strategy}
        </div>
        {(setup.ivr != null || setup.expectedMove != null) && (
          <div className="flex items-center gap-2 mt-0.5">
            {setup.ivr != null && (
              <span className="text-[9px] font-mono tabular-nums" style={{ color: setup.ivr > 50 ? "#FFB800" : setup.ivr < 30 ? "#00d166" : "#6B7280" }}>
                IVR:{setup.ivr}%
              </span>
            )}
            {setup.expectedMove != null && (
              <span className="text-[9px] font-mono tabular-nums text-gray-500">
                EM:±${setup.expectedMove.toFixed(2)}
              </span>
            )}
            {setup.pcRatio != null && (
              <span className="text-[9px] font-mono tabular-nums text-gray-500">
                P/C:{setup.pcRatio.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">{confBadge(setup.confidence)}</td>
      <td className="px-3 py-2.5">
        <span className="text-xs font-bold tabular-nums"
          style={{ color: liveChangePct >= 0 ? "#00d166" : "#f23645" }}>
          {liveChangePct >= 0 ? "+" : ""}{liveChangePct.toFixed(2)}%
        </span>
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <p className="text-[11px] text-gray-300 leading-snug max-w-xs">
          {setup.rationale}
        </p>
        {setup.riskNote && (
          <p className="text-[9px] text-yellow-600/70 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
            {setup.riskNote}
          </p>
        )}
      </td>
    </tr>
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
      <span className="text-sm font-bold text-gray-200 tabular-nums w-20 shrink-0">${livePrice.toFixed(2)}</span>
      <span className="text-xs font-bold tabular-nums w-16 shrink-0" style={{ color }}>
        {isUp ? "▲" : "▼"} {Math.abs(liveChangePct).toFixed(2)}%
      </span>
      <span className="text-[10px] text-gray-500 tabular-nums">Vol {(liveVolume / 1e6).toFixed(1)}M</span>
      <span className="ml-auto text-[10px] text-gray-600 group-hover:text-primary transition-colors">VIEW →</span>
    </button>
  );
});

export function MarketScanner({ subscribeEquitySymbols, onNavigateToSymbol }: {
  subscribeEquitySymbols?: (symbols: string[]) => void;
  onNavigateToSymbol?: (sym: string) => void;
}) {
  const { accessToken, aiFeatureSettings, setSymbol } = useTerminalStore();
  const aiModel = aiFeatureSettings.scanner.model;
  const aiTemp = aiFeatureSettings.scanner.temperature;
  const { cachedData: scanCache, setCachedData: setScanCache } = useScanCache();

  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [universe, setUniverse] = useState("sp100");
  const [customTickers, setCustomTickers] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [isScanning, setIsScanning] = useState(false);
  const [aiSetups, setAiSetups] = useState<ScannerSetup[]>([]);
  const [marketSummary, setMarketSummary] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [manualQuotes, setManualQuotes] = useState<ScannerQuote[]>([]);
  const [scanCount, setScanCount] = useState<number | null>(null);

  const scanCacheRestoredRef = useRef(false);
  useEffect(() => {
    if (scanCacheRestoredRef.current || !scanCache) return;
    scanCacheRestoredRef.current = true;
    const r = scanCache.results;
    if (r?.aiSetups) setAiSetups(r.aiSetups);
    if (r?.marketSummary) setMarketSummary(r.marketSummary);
    if (r?.manualQuotes) setManualQuotes(r.manualQuotes);
    if (r?.scanCount != null) setScanCount(r.scanCount);
  }, [scanCache]);

  const [sortKey, setSortKey] = useState<SortKey>("confidence");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [minChangePct, setMinChangePct] = useState(0);
  const [maxChangePct, setMaxChangePct] = useState(15);
  const [minVolume, setMinVolume] = useState(1);
  const [minPrice, setMinPrice] = useState(5);
  const [maxPrice, setMaxPrice] = useState(1000);

  const getSymbols = (): string[] => {
    if (universe === "custom") {
      return customTickers.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    }
    return UNIVERSES[universe]?.symbols ?? [];
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedSetups = [...aiSetups].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "symbol") cmp = a.symbol.localeCompare(b.symbol);
    else if (sortKey === "direction") cmp = a.direction.localeCompare(b.direction);
    else if (sortKey === "confidence") cmp = (CONF_ORDER[a.confidence] ?? 0) - (CONF_ORDER[b.confidence] ?? 0);
    else if (sortKey === "changePct") cmp = a.changePct - b.changePct;
    return sortDir === "desc" ? -cmp : cmp;
  });

  const handleScan = async () => {
    if (!accessToken) return;
    const syms = getSymbols();
    if (!syms.length) { setRawError("No symbols to scan. Add tickers to your Custom Watchlist."); return; }

    setIsScanning(true);
    setRawError(null);
    setAiSetups([]);
    setManualQuotes([]);
    setMarketSummary("");
    setScanCount(syms.length);

    try {
      const payload =
        mode === "ai"
          ? { symbols: syms, accessToken, mode: "ai", model: aiModel, temperature: aiTemp, maxResults }
          : {
              symbols: syms, accessToken, mode: "manual",
              filters: { minChangePct, maxChangePct, minVolume, minPrice, maxPrice },
            };

      const res = await fetchWithAuth(`${API_BASE}/ai/market-scanner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json() as {
        setups?: ScannerSetup[];
        quotes?: ScannerQuote[];
        marketSummary?: string;
        rawResponse?: string;
        error?: string;
      };

      if (data.error && data.error !== "no_data") {
        setRawError(data.error);
      } else if (mode === "ai") {
        const setups = data.setups ?? [];
        setAiSetups(setups);
        setMarketSummary(data.marketSummary ?? "");
        if (!setups.length && data.rawResponse) setRawError(data.rawResponse);
        if (setups.length && subscribeEquitySymbols) {
          subscribeEquitySymbols(setups.map(s => s.symbol));
        }
        setScanCache({
          results: { aiSetups: setups, marketSummary: data.marketSummary ?? "", manualQuotes: [], scanCount: syms.length },
          timestamp: Date.now(),
        });
      } else {
        const quotes = data.quotes ?? [];
        setManualQuotes(quotes);
        if (quotes.length && subscribeEquitySymbols) {
          subscribeEquitySymbols(quotes.map(q => q.symbol));
        }
        setScanCache({
          results: { aiSetups: [], marketSummary: "", manualQuotes: quotes, scanCount: syms.length },
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      setRawError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const hasResults = mode === "ai" ? aiSetups.length > 0 : manualQuotes.length > 0;
  const currentSyms = getSymbols();

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto pb-6">
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="flex border-b border-card-border">
          {(["ai", "manual"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${
                mode === m
                  ? "bg-[#18181B] text-white border-b-[#FFB800]"
                  : "bg-transparent text-muted-foreground border-b-transparent hover:text-foreground hover:bg-secondary/20"
              }`}
            >
              {m === "ai" ? (
                <span className="flex items-center justify-center gap-2">
                  <Zap className="w-3.5 h-3.5" /> AI DISCOVERY
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
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
                <Search className="w-3 h-3" /> Scan Universe
              </Label>
              <select
                value={universe}
                onChange={e => setUniverse(e.target.value)}
                className="w-full h-8 rounded-md border border-card-border bg-card text-foreground text-xs px-2 focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                {Object.entries(UNIVERSES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label} ({v.symbols.length})</option>
                ))}
                <option value="custom">Custom Watchlist</option>
              </select>
            </div>

            {mode === "ai" && (
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                  Max Results
                </Label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxResults}
                  onChange={e => setMaxResults(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-full h-8 rounded-md border border-card-border bg-card text-foreground text-xs px-2 tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            )}
          </div>

          {universe === "custom" && (
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                Custom Watchlist (comma-separated)
              </Label>
              <textarea
                value={customTickers}
                onChange={e => setCustomTickers(e.target.value.toUpperCase())}
                placeholder="AAPL, MSFT, NVDA, TSLA, AMD..."
                rows={2}
                className="w-full rounded-md border border-card-border bg-card text-foreground text-xs px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 uppercase"
              />
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            Scanning <span className="text-primary font-bold">{currentSyms.length} tickers</span>
            {mode === "ai" && <> — AI will return up to <span className="font-bold" style={{ color: "#ffb800" }}>{maxResults} setups</span></>}
          </div>
        </div>

        {mode === "manual" && (
          <div className="p-4 bg-[#0c0c0c] border-t border-card-border grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase">
                <span>Min Change %</span>
                <span style={{ color: "#00d166" }}>{minChangePct >= 0 ? "+" : ""}{minChangePct}%</span>
              </div>
              <Slider value={[minChangePct]} onValueChange={v => setMinChangePct(v[0])} min={-15} max={15} step={0.5} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase">
                <span>Max Change %</span>
                <span style={{ color: "#00d166" }}>+{maxChangePct}%</span>
              </div>
              <Slider value={[maxChangePct]} onValueChange={v => setMaxChangePct(v[0])} min={0} max={30} step={0.5} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase">
                <span>Min Volume</span>
                <span style={{ color: "#ffb800" }}>{minVolume}M+</span>
              </div>
              <Slider value={[minVolume]} onValueChange={v => setMinVolume(v[0])} min={0} max={100} step={1} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase">
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

        <div className="px-4 pb-4 pt-3 bg-[#0c0c0c] border-t border-card-border">
          <Button
            onClick={handleScan}
            disabled={!accessToken || isScanning || currentSyms.length === 0}
            className="w-full font-bold font-mono tracking-wider"
            style={{
              fontSize: 13, padding: "8px 12px",
              background: "#000", color: "#FFB800", border: "1px solid #FFB800",
            }}
          >
            {isScanning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-[#FFB800] border-t-transparent rounded-full animate-spin" />
                {mode === "ai" ? "RUNNING SCAN..." : "FILTERING MARKET..."}
              </span>
            ) : (
              <span className="flex items-center justify-center">
                {mode === "ai"
                  ? `SCAN ${currentSyms.length} STOCKS`
                  : "APPLY FILTERS & SCAN"}
              </span>
            )}
          </Button>
          {!accessToken && (
            <p className="text-[10px] text-destructive mt-2 text-center">
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
            <p className="text-[10px] text-muted-foreground">
              {mode === "ai" ? "Fetching L1 quotes → AI analysis → ranking setups" : "Fetching market data..."}
            </p>
          </div>
        </div>
      )}

      {rawError && !isScanning && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-xs text-destructive font-bold mb-2">SCAN ERROR</p>
          <p className="text-[10px] text-destructive/80">{rawError}</p>
        </div>
      )}

      {mode === "ai" && !isScanning && aiSetups.length > 0 && (
        <div className="space-y-3">
          {marketSummary && (
            <div className="px-4 py-3 rounded-xl border text-sm text-gray-300 leading-relaxed"
              style={{ borderColor: "rgba(255,184,0,0.2)" }}>
              <span className="text-[9px] font-bold" style={{ color: "#ffb800" }}>MARKET REGIME  </span>
              {marketSummary}
            </div>
          )}

          <div className="rounded-xl border border-card-border overflow-hidden bg-card">
            <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-card-border" style={{ background: "#0c0c0c" }}>
                  <th className="px-3 py-2.5">
                    <SortHeader label="Ticker" sortKey="symbol" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-3 py-2.5">
                    <SortHeader label="Strategy" sortKey="direction" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-3 py-2.5">
                    <SortHeader label="Confidence" sortKey="confidence" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-3 py-2.5">
                    <SortHeader label="Chg %" sortKey="changePct" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-3 py-2.5 hidden md:table-cell">
                    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">AI Thesis</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedSetups.map((s, i) => (
                  <LiveAiRow key={s.symbol} setup={s} index={i} onSelect={onNavigateToSymbol ?? setSymbol} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[9px] text-muted-foreground/50 text-center">
            AI-generated. Not financial advice. Always verify independently.
          </p>
        </div>
      )}

      {mode === "manual" && !isScanning && manualQuotes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <Label className="text-[10px] text-muted-foreground uppercase">
              {manualQuotes.length} STOCKS MATCHED — CLICK TO LOAD
            </Label>
            <span className="text-[9px] text-muted-foreground">Sorted by | Change % |</span>
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
    </div>
  );
}
