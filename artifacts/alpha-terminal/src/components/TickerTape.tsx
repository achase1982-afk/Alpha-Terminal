import { useState, useRef, useEffect } from "react";
import { Settings, X, Plus, TrendingUp, TrendingDown, Wifi, WifiOff } from "lucide-react";
import { useTerminalStore } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";

const SEPARATOR = "◆";

function TickerItem({ symbol, accessToken }: { symbol: string; accessToken: string }) {
  const { data, isLoading } = useGetQuote(
    { symbol, accessToken },
    { query: { enabled: !!accessToken, refetchInterval: 15000, staleTime: 10000 } }
  );

  const isPositive = (data?.change ?? 0) >= 0;

  if (!accessToken) {
    return (
      <span className="inline-flex items-center gap-2 px-5 font-mono text-[11px] whitespace-nowrap">
        <span className="text-muted-foreground/60">{symbol}</span>
        <span className="text-muted-foreground/40">--</span>
      </span>
    );
  }

  if (isLoading || !data) {
    return (
      <span className="inline-flex items-center gap-2 px-5 font-mono text-[11px] whitespace-nowrap">
        <span className="text-muted-foreground">{symbol}</span>
        <span className="text-muted-foreground/50 animate-pulse">···</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 px-5 font-mono text-[11px] whitespace-nowrap">
      <span className="text-muted-foreground tracking-wider">{symbol}</span>
      <span className="text-foreground font-bold tabular-nums">
        {data.last != null ? `$${data.last.toFixed(2)}` : "--"}
      </span>
      <span className={`flex items-center gap-0.5 tabular-nums ${isPositive ? "text-primary" : "text-destructive"}`}>
        {isPositive
          ? <TrendingUp className="w-2.5 h-2.5" />
          : <TrendingDown className="w-2.5 h-2.5" />}
        {data.change != null
          ? `${isPositive ? "+" : ""}${data.change.toFixed(2)} (${isPositive ? "+" : ""}${(data.changePct ?? 0).toFixed(2)}%)`
          : "--"}
      </span>
      <span className="text-muted-foreground/30 text-[9px]">{SEPARATOR}</span>
    </span>
  );
}

export function TickerTape() {
  const { accessToken, tickerTapeSymbols, setTickerTapeSymbols } = useTerminalStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close settings when clicking outside
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  // Focus input when settings opens
  useEffect(() => {
    if (settingsOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [settingsOpen]);

  const addTicker = () => {
    const sym = newTicker.trim().toUpperCase();
    if (!sym || tickerTapeSymbols.includes(sym)) { setNewTicker(""); return; }
    setTickerTapeSymbols([...tickerTapeSymbols, sym]);
    setNewTicker("");
  };

  const removeTicker = (sym: string) => {
    setTickerTapeSymbols(tickerTapeSymbols.filter(s => s !== sym));
  };

  const symbols = tickerTapeSymbols.length > 0 ? tickerTapeSymbols : ["SPY", "QQQ", "IWM", "DIA", "VIX"];

  return (
    <div className="relative flex items-center h-8 border-b border-card-border bg-[#0D1117]/80 backdrop-blur-sm shrink-0 overflow-hidden z-10">

      {/* Left fade */}
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[#0D1117] to-transparent z-10 pointer-events-none" />

      {/* Scrolling content */}
      <div className="flex-1 overflow-hidden">
        <div className="ticker-scroll flex w-max">
          {/* First pass */}
          {symbols.map(sym => (
            <TickerItem key={`a-${sym}`} symbol={sym} accessToken={accessToken || ""} />
          ))}
          {/* Duplicate for seamless loop */}
          {symbols.map(sym => (
            <TickerItem key={`b-${sym}`} symbol={sym} accessToken={accessToken || ""} />
          ))}
        </div>
      </div>

      {/* Right fade */}
      <div className="absolute right-8 top-0 bottom-0 w-8 bg-gradient-to-l from-[#0D1117] to-transparent z-10 pointer-events-none" />

      {/* Connection indicator + Settings gear */}
      <div className="flex items-center gap-1.5 px-2 shrink-0 z-20 bg-[#0D1117]/90 border-l border-card-border h-full">
        {accessToken
          ? <Wifi className="w-3 h-3 text-primary/70" />
          : <WifiOff className="w-3 h-3 text-muted-foreground/40" />}
        <button
          onClick={() => setSettingsOpen(s => !s)}
          className="text-muted-foreground hover:text-primary transition-colors"
          aria-label="Ticker settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Settings panel */}
      {settingsOpen && (
        <div
          ref={settingsRef}
          className="absolute top-full right-0 mt-1 w-56 bg-card border border-card-border rounded-lg shadow-xl z-50 p-3 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Ticker Tape</span>
            <button onClick={() => setSettingsOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Current tickers */}
          <div className="flex flex-wrap gap-1.5">
            {symbols.map(sym => (
              <span key={sym} className="inline-flex items-center gap-1 bg-primary/10 border border-primary/20 rounded px-2 py-0.5 font-mono text-[10px] text-primary">
                {sym}
                <button
                  onClick={() => removeTicker(sym)}
                  className="text-primary/60 hover:text-destructive transition-colors ml-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>

          {/* Add ticker input */}
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              value={newTicker}
              onChange={e => setNewTicker(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && addTicker()}
              placeholder="Add symbol..."
              maxLength={6}
              className="flex-1 bg-background border border-card-border rounded px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 uppercase"
            />
            <button
              onClick={addTicker}
              disabled={!newTicker.trim()}
              className="bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary rounded px-2 py-1 transition-colors disabled:opacity-30"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {!accessToken && (
            <p className="font-mono text-[9px] text-muted-foreground/60 leading-tight">
              Connect Schwab to see live prices
            </p>
          )}
        </div>
      )}
    </div>
  );
}
