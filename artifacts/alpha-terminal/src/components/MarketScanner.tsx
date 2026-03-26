import { useState } from "react";
import { useTerminalStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Zap, SlidersHorizontal, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

const API_BASE = "/api";

// Top 50 most liquid US equity symbols
const SCANNER_SYMBOLS = [
  "AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AMD","AVGO","NFLX",
  "ORCL","CRM","INTC","QCOM","MU","SMCI","NOW","PLTR","COIN","MSTR",
  "JPM","BAC","GS","MS","WFC","C","V","MA","PYPL","SQ",
  "UNH","LLY","JNJ","PFE","ABBV","CVX","XOM","OXY","SLB","HAL",
  "COST","WMT","TGT","HD","LOW","DIS","T","VZ","SPOT","UBER",
];

type Direction = "BULLISH" | "BEARISH" | "NEUTRAL";
type Confidence = "HIGH" | "MILD" | "LOW";

interface ScannerSetup {
  symbol: string;
  direction: Direction;
  confidence: Confidence;
  strategy: string;
  price: number;
  changePct: number;
  rationale: string;
  riskNote: string;
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

// ── Color utilities ────────────────────────────────────────────────────────────
function directionStyle(dir: Direction) {
  if (dir === "BULLISH")  return { color: "#00E676", label: "BULLISH",  icon: <TrendingUp  className="w-3.5 h-3.5" /> };
  if (dir === "BEARISH")  return { color: "#FF1744", label: "BEARISH",  icon: <TrendingDown className="w-3.5 h-3.5" /> };
  return                         { color: "#00BFFF", label: "NEUTRAL",  icon: <Minus        className="w-3.5 h-3.5" /> };
}

function confidenceStyle(conf: Confidence) {
  if (conf === "HIGH")  return { color: "#FFD700", bg: "rgba(255,215,0,0.08)",  border: "rgba(255,215,0,0.3)",  label: "HIGH CONFIDENCE" };
  if (conf === "MILD")  return { color: "#00BFFF", bg: "rgba(0,191,255,0.08)", border: "rgba(0,191,255,0.3)",  label: "MILD CONFIDENCE" };
  return                       { color: "#9CA3AF", bg: "rgba(156,163,175,0.06)", border: "rgba(156,163,175,0.2)", label: "LOW CONFIDENCE"  };
}

// ── Setup card ─────────────────────────────────────────────────────────────────
function SetupCard({ setup, rank }: { setup: ScannerSetup; rank: number }) {
  const { setSymbol } = useTerminalStore();
  const dir = directionStyle(setup.direction);
  const conf = confidenceStyle(setup.confidence);

  return (
    <div
      className="rounded-xl border overflow-hidden transition-all duration-200 hover:scale-[1.01]"
      style={{ borderColor: conf.border, background: conf.bg }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: conf.border }}>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-gray-500 font-bold">#{rank}</span>
          <button
            onClick={() => setSymbol(setup.symbol)}
            className="font-mono font-black text-xl tracking-widest transition-opacity hover:opacity-70"
            style={{ color: dir.color }}
          >
            {setup.symbol}
          </button>
          <div className="flex items-center gap-1.5 font-mono text-xs font-bold"
            style={{ color: dir.color }}>
            {dir.icon}
            {dir.label}
          </div>
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded-full"
            style={{ color: conf.color, background: conf.bg, border: `1px solid ${conf.border}` }}>
            {conf.label}
          </span>
          <span className="font-mono text-xs font-bold"
            style={{ color: setup.changePct >= 0 ? "#00E676" : "#FF1744" }}>
            {setup.changePct >= 0 ? "+" : ""}{setup.changePct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-gray-500 uppercase tracking-widest shrink-0">Strategy</span>
          <span className="font-mono text-xs font-bold" style={{ color: conf.color }}>
            {setup.strategy}
          </span>
          {setup.price > 0 && (
            <span className="ml-auto font-mono text-xs text-gray-300 font-semibold">
              ${setup.price.toFixed(2)}
            </span>
          )}
        </div>

        <div className="font-sans text-xs text-gray-300 leading-relaxed border-l-2 pl-3"
          style={{ borderColor: conf.border }}>
          {setup.rationale}
        </div>

        {setup.riskNote && (
          <div className="flex items-start gap-1.5 text-[10px] font-mono text-yellow-600/80">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            {setup.riskNote}
          </div>
        )}

        <button
          onClick={() => setSymbol(setup.symbol)}
          className="w-full mt-1 py-1.5 rounded font-mono text-[10px] font-bold border transition-all hover:opacity-80"
          style={{ color: dir.color, borderColor: dir.color, background: `${dir.color}10` }}
        >
          → LOAD {setup.symbol} INTO DASHBOARD
        </button>
      </div>
    </div>
  );
}

// ── Manual result row ──────────────────────────────────────────────────────────
function ManualRow({ q }: { q: ScannerQuote }) {
  const { setSymbol } = useTerminalStore();
  const isUp = q.changePct >= 0;
  const color = isUp ? "#00E676" : "#FF1744";

  return (
    <button
      onClick={() => setSymbol(q.symbol)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-card-border bg-card
        hover:border-primary/40 hover:bg-primary/5 transition-all text-left group"
    >
      <span className="font-mono font-black text-sm w-16 shrink-0" style={{ color }}>
        {q.symbol}
      </span>
      <span className="font-mono text-sm font-bold text-gray-200 tabular-nums w-20 shrink-0">
        ${q.last.toFixed(2)}
      </span>
      <span className="font-mono text-xs font-bold tabular-nums w-16 shrink-0" style={{ color }}>
        {isUp ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%
      </span>
      <span className="font-mono text-[10px] text-gray-500 tabular-nums">
        Vol {(q.volume / 1e6).toFixed(1)}M
      </span>
      <span className="ml-auto font-mono text-[10px] text-gray-600 group-hover:text-primary transition-colors">
        LOAD →
      </span>
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export function MarketScanner() {
  const { accessToken, aiModel, aiTemp } = useTerminalStore();

  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [isScanning, setIsScanning] = useState(false);
  const [aiSetups, setAiSetups] = useState<ScannerSetup[]>([]);
  const [marketSummary, setMarketSummary] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [manualQuotes, setManualQuotes] = useState<ScannerQuote[]>([]);

  // Manual filter state
  const [minChangePct, setMinChangePct] = useState(0);
  const [maxChangePct, setMaxChangePct] = useState(15);
  const [minVolume, setMinVolume] = useState(1);       // in millions
  const [minPrice, setMinPrice] = useState(5);
  const [maxPrice, setMaxPrice] = useState(1000);

  const handleScan = async () => {
    if (!accessToken) return;
    setIsScanning(true);
    setRawError(null);
    setAiSetups([]);
    setManualQuotes([]);
    setMarketSummary("");

    try {
      const payload =
        mode === "ai"
          ? { symbols: SCANNER_SYMBOLS, accessToken, mode: "ai", model: aiModel, temperature: aiTemp }
          : {
              symbols: SCANNER_SYMBOLS, accessToken, mode: "manual",
              filters: { minChangePct, maxChangePct, minVolume, minPrice, maxPrice },
            };

      const res = await fetch(`${API_BASE}/ai/market-scanner`, {
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
        setAiSetups(data.setups ?? []);
        setMarketSummary(data.marketSummary ?? "");
        if (!data.setups?.length && data.rawResponse) setRawError(data.rawResponse);
      } else {
        setManualQuotes(data.quotes ?? []);
      }
    } catch (err) {
      setRawError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const hasResults = mode === "ai" ? aiSetups.length > 0 : manualQuotes.length > 0;

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto pb-6">
      {/* ── Mode Selector ── */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="flex border-b border-card-border">
          {(["ai", "manual"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-3 font-mono text-xs font-bold uppercase tracking-widest transition-all ${
                mode === m
                  ? "bg-primary/15 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/20"
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

        {/* ── Manual Filters ── */}
        {mode === "manual" && (
          <div className="p-4 bg-[#0D1117] grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-[10px] text-muted-foreground uppercase">
                <span>Min Change %</span>
                <span style={{ color: "#00E676" }}>{minChangePct >= 0 ? "+" : ""}{minChangePct}%</span>
              </div>
              <Slider value={[minChangePct]} onValueChange={v => setMinChangePct(v[0])} min={-15} max={15} step={0.5} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-[10px] text-muted-foreground uppercase">
                <span>Max Change %</span>
                <span style={{ color: "#00E676" }}>+{maxChangePct}%</span>
              </div>
              <Slider value={[maxChangePct]} onValueChange={v => setMaxChangePct(v[0])} min={0} max={30} step={0.5} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-[10px] text-muted-foreground uppercase">
                <span>Min Volume</span>
                <span style={{ color: "#00BFFF" }}>{minVolume}M+</span>
              </div>
              <Slider value={[minVolume]} onValueChange={v => setMinVolume(v[0])} min={0} max={100} step={1} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-[10px] text-muted-foreground uppercase">
                <span>Price Range</span>
                <span style={{ color: "#00BFFF" }}>${minPrice} – ${maxPrice}</span>
              </div>
              <div className="flex gap-3 items-center">
                <Slider value={[minPrice]} onValueChange={v => setMinPrice(v[0])} min={0} max={500} step={5} className="flex-1" />
                <Slider value={[maxPrice]} onValueChange={v => setMaxPrice(v[0])} min={50} max={2000} step={25} className="flex-1" />
              </div>
            </div>
          </div>
        )}

        {/* ── AI Mode description ── */}
        {mode === "ai" && !hasResults && !isScanning && (
          <div className="p-4 bg-[#0D1117] text-center font-mono text-[10px] text-muted-foreground leading-relaxed">
            Batch-fetches L1 quotes for <span className="text-primary font-bold">{SCANNER_SYMBOLS.length} top active stocks</span>, then passes the data to Gemini to identify the{" "}
            <span style={{ color: "#FFD700" }} className="font-bold">TOP 3 highest-probability setups</span> — each with direction, confidence, strategy, and rationale.
          </div>
        )}

        {/* ── Scan Button ── */}
        <div className="px-4 pb-4 pt-3 bg-[#0D1117] border-t border-card-border">
          <Button
            onClick={handleScan}
            disabled={!accessToken || isScanning}
            className="w-full font-mono text-xs font-bold h-10"
            style={
              !isScanning
                ? { background: "linear-gradient(135deg, #00E676 0%, #00BCD4 100%)", color: "#000" }
                : {}
            }
          >
            {isScanning ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {mode === "ai" ? "RUNNING AI SCAN..." : "FILTERING MARKET..."}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {mode === "ai" ? <><Zap className="w-4 h-4" /> SCAN {SCANNER_SYMBOLS.length} STOCKS WITH AI</> : <><SlidersHorizontal className="w-4 h-4" /> APPLY FILTERS & SCAN</>}
              </span>
            )}
          </Button>
          {!accessToken && (
            <p className="text-[10px] font-mono text-destructive mt-2 text-center">
              Connect Schwab to enable the Market Scanner
            </p>
          )}
        </div>
      </div>

      {/* ── Loading ── */}
      {isScanning && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-card rounded-xl border border-card-border">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <p className="font-mono text-sm text-primary animate-pulse font-bold">
              {mode === "ai" ? "SCANNING 50 STOCKS..." : "APPLYING FILTERS..."}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {mode === "ai" ? "Fetching L1 quotes → AI analysis → ranking setups" : "Fetching market data..."}
            </p>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {rawError && !isScanning && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="font-mono text-xs text-destructive font-bold mb-2">SCAN ERROR</p>
          <p className="font-mono text-[10px] text-destructive/80">{rawError}</p>
        </div>
      )}

      {/* ── AI Results ── */}
      {mode === "ai" && !isScanning && aiSetups.length > 0 && (
        <div className="space-y-4">
          {marketSummary && (
            <div className="px-4 py-3 rounded-xl border font-sans text-sm text-gray-300 leading-relaxed"
              style={{ background: "rgba(0,191,255,0.05)", borderColor: "rgba(0,191,255,0.2)" }}>
              <span className="font-mono text-[9px] font-bold" style={{ color: "#00BFFF" }}>MARKET REGIME  </span>
              {marketSummary}
            </div>
          )}
          {aiSetups.map((setup, i) => (
            <SetupCard key={setup.symbol} setup={setup} rank={i + 1} />
          ))}
          <p className="font-mono text-[9px] text-muted-foreground/50 text-center">
            AI-generated. Not financial advice. Always verify independently.
          </p>
        </div>
      )}

      {/* ── Manual Results ── */}
      {mode === "manual" && !isScanning && manualQuotes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <Label className="font-mono text-[10px] text-muted-foreground uppercase">
              {manualQuotes.length} STOCKS MATCHED — CLICK TO LOAD
            </Label>
            <span className="font-mono text-[9px] text-muted-foreground">Sorted by | Δ% |</span>
          </div>
          <div className="space-y-1.5">
            {manualQuotes.map(q => <ManualRow key={q.symbol} q={q} />)}
          </div>
        </div>
      )}

      {mode === "manual" && !isScanning && manualQuotes.length === 0 && hasResults === false && !rawError && (
        <div className="py-16 text-center font-mono text-xs text-muted-foreground/40 bg-card border border-card-border rounded-xl">
          No stocks matched your filters. Try widening the ranges.
        </div>
      )}
    </div>
  );
}
