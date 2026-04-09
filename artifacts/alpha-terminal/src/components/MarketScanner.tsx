import { useState, useEffect, memo, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import { useTerminalStore } from "@/lib/store";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { SlidersHorizontal, ChevronDown, AlertTriangle, Search, List, Crosshair, Send, Shield, BarChart3, Plus, Filter, RefreshCw, Pencil, Trash2, Loader2 } from "lucide-react";
import { useScanCache } from "@/hooks/useScanCache";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { useScannerUniverses } from "@/hooks/useScannerUniverses";
import { ScreenBuilder } from "./ScreenBuilder";
import { WatchlistEditor } from "./WatchlistEditor";

const API_BASE = "/api";


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
  directionalLean?: "BULLISH" | "BEARISH" | "MIXED";
  scanMode?: "DISCOVERY" | "MOMENTUM";
  flowDataAvailable?: boolean;
  discoveryComponents?: {
    setupQuality: number;
    accumulation: number;
    ivSetup: number;
    flowDivergence: number;
    emergingRS: number;
  };
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
  scanMode?: "DISCOVERY" | "MOMENTUM";
}

const MOMENTUM_BARS: { key: keyof DetComponentScores; label: string; max: number; color: string }[] = [
  { key: "trendAlignment", label: "TREND", max: 25, color: "#26a69a" },
  { key: "relativeStrength", label: "RS", max: 20, color: "#42a5f5" },
  { key: "volumeConfirmation", label: "VOL", max: 20, color: "#ab47bc" },
  { key: "ivrScore", label: "IVR", max: 20, color: "#ffb800" },
  { key: "optionsLiquidity", label: "OPT LIQ", max: 15, color: "#ef5350" },
];

const DISCOVERY_BARS: { key: keyof NonNullable<DetCandidate["discoveryComponents"]>; label: string; max: number; color: string }[] = [
  { key: "setupQuality", label: "SETUP", max: 20, color: "#26a69a" },
  { key: "accumulation", label: "ACCUM", max: 15, color: "#ab47bc" },
  { key: "ivSetup", label: "IV SET", max: 25, color: "#ffb800" },
  { key: "flowDivergence", label: "FLOW", max: 25, color: "#42a5f5" },
  { key: "emergingRS", label: "RS", max: 15, color: "#ef5350" },
];

const LEAN_COLORS: Record<string, string> = {
  BULLISH: "#2ecc71",
  BEARISH: "#ff4b5c",
  MIXED: "#FFB800",
};

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
  const isDiscovery = candidate.scanMode === "DISCOVERY";
  const lean = candidate.directionalLean;

  const scoreBars = isDiscovery && candidate.discoveryComponents
    ? DISCOVERY_BARS.map(bar => ({
        label: bar.label,
        max: bar.max,
        color: bar.color,
        val: candidate.discoveryComponents![bar.key as keyof NonNullable<DetCandidate["discoveryComponents"]>] ?? 0,
      }))
    : MOMENTUM_BARS.map(bar => ({
        label: bar.label,
        max: bar.max,
        color: bar.color,
        val: candidate.components[bar.key as keyof DetComponentScores] ?? 0,
      }));

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
        <div className="ml-auto flex items-center gap-2">
          {lean && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums"
              style={{ color: LEAN_COLORS[lean], background: `${LEAN_COLORS[lean]}18`, border: `1px solid ${LEAN_COLORS[lean]}40` }}>
              {lean}
            </span>
          )}
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
            {scoreBars.map(bar => {
              const pct = Math.round((bar.val / bar.max) * 100);
              return (
                <div key={bar.label} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-zinc-500 w-[52px] text-right shrink-0">{bar.label}</span>
                  <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: "#1a1a1a" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bar.color }} />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-zinc-400 w-8 text-right">{Math.round(bar.val)}/{bar.max}</span>
                </div>
              );
            })}
          </div>
          {isDiscovery && candidate.flowDataAvailable === false && (
            <div className="mt-2 flex items-center gap-1 text-[10px]" style={{ color: "#6B7280" }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-600" />
              Flow data unavailable — score renormalized
            </div>
          )}
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
              {candidate.ivr.toFixed(1)}%
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
          Bias: {candidate.pulseBias} · Composite: {typeof candidate.pulseComposite === 'number' ? candidate.pulseComposite.toFixed(1) : candidate.pulseComposite}
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

function UniverseDropdown({ value, onChange, presets, watchlists, screens, onCreateScreen, onEditScreen, onDeleteScreen, onRefreshScreen, refreshingScreenId, onCreateWatchlist, onEditWatchlist, onDeleteWatchlist }: {
  value: string;
  onChange: (v: string) => void;
  presets: Record<string, { label: string; description: string; count: number }>;
  watchlists: Array<{ id: number; name: string; symbols: string[]; isProtected?: boolean }>;
  screens: Array<{ id: number; name: string; cachedCount: number | null; cachedAt: string | null; isDefault: boolean }>;
  onCreateScreen: () => void;
  onEditScreen?: (id: number) => void;
  onDeleteScreen?: (id: number) => void;
  onRefreshScreen?: (id: number) => void;
  refreshingScreenId?: number | null;
  onCreateWatchlist?: () => void;
  onEditWatchlist?: (id: number) => void;
  onDeleteWatchlist?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent | TouchEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick as any);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick as any);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  let selectedLabel = value;
  let selectedCount: number | string = 0;
  if (value.startsWith("preset:")) {
    const p = presets[value.slice(7)];
    selectedLabel = p?.label ?? value;
    selectedCount = p?.count ?? 0;
  } else if (value.startsWith("watchlist:")) {
    const wl = watchlists.find(w => w.id === parseInt(value.slice(10)));
    selectedLabel = wl?.name ?? "Watchlist";
    selectedCount = wl?.symbols?.length ?? 0;
  } else if (value.startsWith("screen:")) {
    const sc = screens.find(s => s.id === parseInt(value.slice(7)));
    selectedLabel = sc?.name ?? "Screen";
    selectedCount = sc?.cachedCount ?? "—";
  }

  const maxH = typeof window !== "undefined" ? Math.min(560, window.innerHeight - pos.top - 16) : 400;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full min-h-[44px] rounded-md border border-card-border bg-card text-foreground text-sm px-3 py-2 flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors hover:border-zinc-600"
      >
        <span className="font-medium leading-snug">{selectedLabel} <span className="text-zinc-500 font-normal">({selectedCount})</span></span>
        <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && ReactDOM.createPortal(
        <div
          ref={panelRef}
          className="rounded-lg border border-zinc-700/80 bg-[#141414] shadow-2xl shadow-black/60 overflow-hidden"
          style={{ position: "fixed", zIndex: 9999, top: pos.top, left: pos.left, width: pos.width, maxHeight: maxH }}
        >
          <div
            className="overflow-y-auto overscroll-contain"
            style={{ maxHeight: maxH, WebkitOverflowScrolling: "touch" as any }}
            onTouchMove={e => e.stopPropagation()}
          >
            <div className="px-3 pt-3 pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Presets</span>
            </div>
            {Object.entries(presets).map(([key, p]) => {
              const pKey = `preset:${key}`;
              return (
                <button
                  key={key}
                  onClick={() => { onChange(pKey); setOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 text-sm transition-colors ${
                    value === pKey ? "bg-[#FFB800]/10 text-[#FFB800]" : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                  }`}
                >
                  <span className="font-medium leading-snug">{p.label}</span>
                  <span className={`text-xs tabular-nums shrink-0 ${value === pKey ? "text-[#FFB800]/60" : "text-zinc-600"}`}>{p.count}</span>
                </button>
              );
            })}

            {screens.length > 0 && (
              <>
                <div className="mx-3 my-1.5 border-t border-zinc-700/50" />
                <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Dynamic Screens</span>
                </div>
                {screens.map(sc => {
                  const scKey = `screen:${sc.id}`;
                  const isActive = value === scKey;
                  return (
                    <div key={sc.id}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
                        isActive ? "bg-[#FFB800]/10 text-[#FFB800]" : "text-zinc-300 hover:bg-zinc-800/60"
                      }`}
                    >
                      <button onClick={() => { onChange(scKey); setOpen(false); }} className="flex-1 text-left">
                        <span className="font-medium leading-snug">{sc.name}</span>
                        {sc.cachedAt && (
                          <span className="text-[9px] text-zinc-600 ml-1.5">
                            {new Date(sc.cachedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </button>
                      <span className={`text-xs tabular-nums shrink-0 ${isActive ? "text-[#FFB800]/60" : "text-zinc-600"}`}>
                        {sc.cachedCount ?? "—"}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {onRefreshScreen && (
                          <button onClick={(e) => { e.stopPropagation(); onRefreshScreen(sc.id); }}
                            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                            title="Refresh screen">
                            {refreshingScreenId === sc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          </button>
                        )}
                        {onEditScreen && (
                          <button onClick={(e) => { e.stopPropagation(); onEditScreen(sc.id); setOpen(false); }}
                            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                            title="Edit screen">
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                        {onDeleteScreen && !sc.isDefault && (
                          <button onClick={(e) => { e.stopPropagation(); onDeleteScreen(sc.id); }}
                            className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                            title="Delete screen">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            <div className="mx-3 my-1.5 border-t border-zinc-700/50" />
            <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
              <List className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Custom Watchlists</span>
            </div>
            {watchlists.map(wl => {
              const wlKey = `watchlist:${wl.id}`;
              const isActive = value === wlKey;
              return (
                <div key={wl.id}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
                    isActive ? "bg-[#FFB800]/10 text-[#FFB800]" : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <button onClick={() => { onChange(wlKey); setOpen(false); }} className="flex-1 text-left">
                    <span className="font-medium leading-snug">{wl.name}</span>
                  </button>
                  <span className={`text-xs tabular-nums shrink-0 ${isActive ? "text-[#FFB800]/60" : "text-zinc-600"}`}>{wl.symbols.length}</span>
                  <div className="flex items-center gap-0.5">
                    {onEditWatchlist && (
                      <button onClick={(e) => { e.stopPropagation(); onEditWatchlist(wl.id); setOpen(false); }}
                        className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="Edit watchlist">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {onDeleteWatchlist && !wl.isProtected && (
                      <button onClick={(e) => { e.stopPropagation(); onDeleteWatchlist(wl.id); }}
                        className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                        title="Delete watchlist">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {onCreateWatchlist && (
              <button
                onClick={() => { onCreateWatchlist(); setOpen(false); }}
                className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span className="font-medium">New Watchlist</span>
              </button>
            )}

            <div className="mx-3 my-1.5 border-t border-zinc-700/50" />
            <button
              onClick={() => { onCreateScreen(); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 flex items-center gap-2 text-sm text-zinc-400 hover:text-[#FFB800] hover:bg-zinc-800/60 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="font-medium">Create Dynamic Screen</span>
            </button>

            <div className="h-2" />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export function MarketScanner({ subscribeEquitySymbols, onNavigateToSymbol, onSendToStrategist }: {
  subscribeEquitySymbols?: (symbols: string[]) => void;
  onNavigateToSymbol?: (sym: string) => void;
  onSendToStrategist?: (sym: string, candidate: DetCandidate) => void;
}) {
  const { accessToken, setSymbol } = useTerminalStore();
  const { pulseData } = useMarketPulseStore();
  const shockActive = pulseData?.shockState === "ACTIVE";
  const { cachedData: scanCache, setCachedData: setScanCache } = useScanCache();
  const universeData = useScannerUniverses();

  const [mode, setMode] = useState<"manual" | "deterministic">("deterministic");
  const [scanMode, setScanMode] = useState<"DISCOVERY" | "MOMENTUM">("DISCOVERY");
  const [universe, setUniverse] = useState("preset:sp500");
  const [isScanning, setIsScanning] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [manualQuotes, setManualQuotes] = useState<ScannerQuote[]>([]);
  const [scanCount, setScanCount] = useState<number | null>(null);
  const [resolvedSymbols, setResolvedSymbols] = useState<string[]>([]);

  const [detResult, setDetResult] = useState<DetScanResult | null>(null);
  const [detError, setDetError] = useState<string | null>(null);

  const [showScreenBuilder, setShowScreenBuilder] = useState(false);
  const [editingScreen, setEditingScreen] = useState<number | null>(null);
  const [refreshingScreenId, setRefreshingScreenId] = useState<number | null>(null);
  const [showWatchlistEditor, setShowWatchlistEditor] = useState(false);
  const [editingWatchlistId, setEditingWatchlistId] = useState<number | null>(null);

  const scanCacheRestoredRef = useRef(false);
  useEffect(() => {
    if (scanCacheRestoredRef.current || !scanCache) return;
    scanCacheRestoredRef.current = true;
    const r = scanCache.results;
    if (r?.manualQuotes) setManualQuotes(r.manualQuotes);
    if (r?.scanCount != null) setScanCount(r.scanCount);
    if (r?.detResult) setDetResult(r.detResult as DetScanResult);
    if (r?.universe) setUniverse(r.universe);
  }, [scanCache]);

  const [minChangePct, setMinChangePct] = useState(0);
  const [maxChangePct, setMaxChangePct] = useState(15);
  const [minVolume, setMinVolume] = useState(1);
  const [minPrice, setMinPrice] = useState(5);
  const [maxPrice, setMaxPrice] = useState(1000);

  useEffect(() => {
    let cancelled = false;
    universeData.getSymbols(universe).then(syms => {
      if (!cancelled) setResolvedSymbols(syms);
    });
    return () => { cancelled = true; };
  }, [universe, universeData.getSymbols, universeData.watchlists]);

  const handleManualScan = async () => {
    const syms = resolvedSymbols.length > 0 ? resolvedSymbols : await universeData.getSymbols(universe);
    if (!syms.length) { setRawError("No symbols to scan. Select a market universe or a watchlist with symbols."); return; }

    setIsScanning(true);
    setRawError(null);
    setScanCount(syms.length);

    try {
      const payload = {
        symbols: syms, accessToken: accessToken || "", mode: "manual",
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
          results: { manualQuotes: quotes, scanCount: syms.length, universe },
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
    const syms = resolvedSymbols.length > 0 ? resolvedSymbols : await universeData.getSymbols(universe);
    if (!syms.length) { setDetError("No symbols to scan. Select a market universe or a watchlist with symbols."); return; }

    setIsScanning(true);
    setDetError(null);
    setScanCount(syms.length);

    try {
      const res = await fetchWithAuth(`${API_BASE}/ai/deterministic-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: syms, accessToken: accessToken || "", scanMode }),
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
          results: { manualQuotes: [], scanCount: syms.length, detResult: data, universe },
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      setDetError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleRefreshScreen = async (id: number) => {
    setRefreshingScreenId(id);
    await universeData.runScreen(id);
    if (universe === `screen:${id}`) {
      const syms = await universeData.getSymbols(`screen:${id}`);
      setResolvedSymbols(syms);
    }
    setRefreshingScreenId(null);
  };

  const hasResults = mode === "manual" ? manualQuotes.length > 0 : (detResult?.candidates?.length ?? 0) > 0;
  const currentSymCount = resolvedSymbols.length;

  const editScreenObj = editingScreen != null ? universeData.screens.find(s => s.id === editingScreen) ?? null : null;

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
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="flex border-b border-card-border">
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
              <UniverseDropdown
                value={universe}
                onChange={setUniverse}
                presets={universeData.presets}
                watchlists={universeData.watchlists}
                screens={universeData.screens}
                onCreateScreen={() => { setEditingScreen(null); setShowScreenBuilder(true); }}
                onEditScreen={(id) => { setEditingScreen(id); setShowScreenBuilder(true); }}
                onDeleteScreen={async (id) => {
                  await universeData.deleteScreen(id);
                  if (universe === `screen:${id}`) setUniverse("preset:sp500");
                }}
                onRefreshScreen={handleRefreshScreen}
                refreshingScreenId={refreshingScreenId}
                onCreateWatchlist={() => { setEditingWatchlistId(null); setShowWatchlistEditor(true); }}
                onEditWatchlist={(id) => { setEditingWatchlistId(id); setShowWatchlistEditor(true); }}
                onDeleteWatchlist={async (id) => {
                  await universeData.deleteWatchlist(id);
                  if (universe === `watchlist:${id}`) setUniverse("preset:sp500");
                }}
              />
            </div>

          </div>

          {mode === "deterministic" && (
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setScanMode("DISCOVERY")}
                className={`text-[11px] font-bold px-3 py-1.5 rounded transition-all ${scanMode === "DISCOVERY" ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                style={scanMode === "DISCOVERY" ? { background: "#18181b", border: "1px solid #FFB800", color: "#FFB800" } : { background: "transparent", border: "1px solid #2a2a2a" }}
              >
                DISCOVERY
                <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded font-bold" style={{ background: "rgba(255,184,0,0.15)", color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)" }}>BETA</span>
              </button>
              <button
                onClick={() => setScanMode("MOMENTUM")}
                className={`text-[11px] font-bold px-3 py-1.5 rounded transition-all ${scanMode === "MOMENTUM" ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                style={scanMode === "MOMENTUM" ? { background: "#18181b", border: "1px solid #6B7280", color: "#b8bcc8" } : { background: "transparent", border: "1px solid #2a2a2a" }}
              >
                MOMENTUM
              </button>
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            {universeData.loading ? (
              <span className="text-zinc-500">Loading universes...</span>
            ) : (
              <>
                Scanning <span className="text-primary font-bold">{currentSymCount} tickers</span>
                {mode === "deterministic" && scanMode === "DISCOVERY" && <> — Setup Quality + Accumulation + IV Setup + Flow + Emerging RS (top 5, min 55)</>}
                {mode === "deterministic" && scanMode === "MOMENTUM" && <> — Trend + RS + Volume + IVR + Options Liquidity (top 5, min 60)</>}
              </>
            )}
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

        <div className="px-4 pb-4 pt-3 bg-[#0c0c0c] border-t border-card-border">
          <button
            onClick={mode === "deterministic" ? handleDeterministicScan : handleManualScan}
            disabled={!accessToken || isScanning || currentSymCount === 0 || shockActive}
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
                  ? `SCAN ${currentSymCount} STOCKS`
                  : "APPLY FILTERS & SCAN"}
              </span>
            )}
          </button>
          {!accessToken && (
            <div className="mt-2 flex justify-center">
              <ConnectBrokerPrompt label="Connect Brokerage For Market Scanner" compact />
            </div>
          )}
        </div>
      </div>

      {isScanning && !(mode === "deterministic" && detResult) && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-card rounded-xl border border-card-border">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm text-primary animate-pulse font-bold">
              SCANNING {scanCount ?? currentSymCount} TICKERS...
            </p>
            <p className="text-[11px] text-muted-foreground">
              {mode === "deterministic"
                ? scanMode === "DISCOVERY"
                  ? "Filtering → OBV + HV + IV + Polygon flow → Discovery scoring → Ranking"
                  : "Filtering universe → Scoring → Ranking → Enriching"
                : "Fetching market data..."}
            </p>
          </div>
        </div>
      )}

      {isScanning && mode === "deterministic" && detResult && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-primary/20 bg-primary/5">
          <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-[11px] font-mono text-primary/80 animate-pulse">
            RESCANNING {scanCount ?? currentSymCount} TICKERS — results will update when complete
          </span>
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
            <div className="flex items-center gap-2">
              {detResult.scanMode === "DISCOVERY" || !detResult.scanMode ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: "#FFB800", background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.3)" }}>
                  DISCOVERY BETA
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: "#6B7280", background: "#18181b", border: "1px solid #2a2a2a" }}>
                  MOMENTUM
                </span>
              )}
              <span className="text-[10px] text-zinc-600 tabular-nums">
                {new Date(detResult.scanTimestamp).toLocaleTimeString()}
              </span>
            </div>
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

      {showScreenBuilder && (
        <ScreenBuilder
          onClose={() => { setShowScreenBuilder(false); setEditingScreen(null); }}
          onSave={async (name, filters) => {
            const screen = await universeData.createScreen(name, filters);
            if (screen) setUniverse(`screen:${screen.id}`);
          }}
          onPreview={universeData.previewScreen}
          editScreen={editScreenObj as any}
          onUpdate={universeData.updateScreen}
        />
      )}

      {showWatchlistEditor && (
        <WatchlistEditor
          watchlist={editingWatchlistId != null ? universeData.watchlists.find(w => w.id === editingWatchlistId) ?? null : null}
          onClose={() => { setShowWatchlistEditor(false); setEditingWatchlistId(null); }}
          onCreate={async (name, symbols) => {
            const wl = await universeData.createWatchlist(name, symbols);
            if (wl) setUniverse(`watchlist:${wl.id}`);
          }}
          onUpdate={async (id, data) => {
            await universeData.updateWatchlist(id, data);
          }}
          onAddSymbol={universeData.addSymbolToWatchlist}
          onRemoveSymbol={universeData.removeSymbolFromWatchlist}
        />
      )}
    </div>
  );
}
