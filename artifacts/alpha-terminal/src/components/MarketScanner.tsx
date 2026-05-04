import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ReactDOM from "react-dom";
import { useTerminalStore } from "@/lib/store";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  AlertTriangle,
  Search,
  List,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Filter,
  RefreshCw,
} from "lucide-react";
import { useScannerUniverses } from "@/hooks/useScannerUniverses";
import { ScreenBuilder } from "./ScreenBuilder";
import { WatchlistEditor } from "./WatchlistEditor";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { useToast } from "@/hooks/use-toast";
import { useUnifiedScan } from "@/hooks/useUnifiedScan";
import { UnifiedScannerCard } from "./UnifiedScannerCard";
import type { UnifiedScanJobResult } from "@/lib/unifiedScanTypes";

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
    function handleClick(e: Event) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
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
        <span className="font-medium leading-snug">
          {selectedLabel} <span className="text-zinc-500 font-normal">({selectedCount})</span>
        </span>
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
            style={{ maxHeight: maxH, WebkitOverflowScrolling: "touch" } satisfies React.CSSProperties}
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

function getUniverseDisplayLabel(
  universeId: string,
  presets: Record<string, { label: string; count: number }>,
  watchlists: Array<{ id: number; name: string }>,
  screens: Array<{ id: number; name: string }>,
): string {
  if (universeId.startsWith("preset:")) {
    const p = presets[universeId.slice(7)];
    return p?.label ?? universeId;
  }
  if (universeId.startsWith("watchlist:")) {
    const id = parseInt(universeId.slice(10), 10);
    const wl = watchlists.find(w => w.id === id);
    return wl?.name ?? "Watchlist";
  }
  if (universeId.startsWith("screen:")) {
    const id = parseInt(universeId.slice(7), 10);
    const sc = screens.find(s => s.id === id);
    return sc?.name ?? "Screen";
  }
  return universeId;
}

function formatScanTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function enginePill(name: string, st: UnifiedScanJobResult["engineStatus"]["discovery"]) {
  const ok = st.status === "ok";
  return (
    <span
      key={name}
      className="text-[10px] font-bold px-2 py-0.5 rounded-full border inline-flex items-center gap-1"
      style={{
        color: ok ? "#26a69a" : "#f87171",
        borderColor: ok ? "rgba(38,166,154,0.4)" : "rgba(248,113,113,0.4)",
        background: ok ? "rgba(38,166,154,0.08)" : "rgba(248,113,113,0.08)",
      }}
      title={st.error ?? (ok ? "OK" : st.status)}
    >
      {name} {ok ? "✓" : "✗"}
    </span>
  );
}

type SendToStrategistFn = (sym: string) => void;

export function MarketScanner({ subscribeEquitySymbols, onNavigateToSymbol, onSendToStrategist }: {
  subscribeEquitySymbols?: (symbols: string[]) => void;
  onNavigateToSymbol?: (sym: string) => void;
  onSendToStrategist?: SendToStrategistFn;
}) {
  const { accessToken } = useTerminalStore();
  const { pulseData } = useMarketPulseStore();
  const shockActive = pulseData?.shockState === "ACTIVE";
  const universeData = useScannerUniverses();
  const { toast } = useToast();
  const unified = useUnifiedScan();

  const [universe, setUniverse] = useState("preset:liquidCore130");
  const [resolvedSymbols, setResolvedSymbols] = useState<string[]>([]);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  const [showScreenBuilder, setShowScreenBuilder] = useState(false);
  const [editingScreen, setEditingScreen] = useState<number | null>(null);
  const [refreshingScreenId, setRefreshingScreenId] = useState<number | null>(null);
  const [showWatchlistEditor, setShowWatchlistEditor] = useState(false);
  const [editingWatchlistId, setEditingWatchlistId] = useState<number | null>(null);

  const REMOVED_PRESETS = new Set(["preset:sp500", "preset:sp100", "preset:ndx100"]);

  useEffect(() => {
    let cancelled = false;
    universeData.getSymbols(universe).then(syms => {
      if (!cancelled) setResolvedSymbols(syms);
    });
    return () => { cancelled = true; };
  }, [universe, universeData.getSymbols, universeData.watchlists]);

  const currentSymCount = resolvedSymbols.length;

  const universeLabel = useMemo(
    () => getUniverseDisplayLabel(universe, universeData.presets, universeData.watchlists, universeData.screens),
    [universe, universeData.presets, universeData.watchlists, universeData.screens],
  );

  const handleRefreshScreen = async (id: number) => {
    setRefreshingScreenId(id);
    await universeData.runScreen(id);
    if (universe === `screen:${id}`) {
      const syms = await universeData.getSymbols(`screen:${id}`);
      setResolvedSymbols(syms);
    }
    setRefreshingScreenId(null);
  };

  const handleScanClick = async () => {
    if (REMOVED_PRESETS.has(universe)) {
      setUniverse("preset:liquidCore130");
      return;
    }
    setExpandedTicker(null);
    await unified.startScan(universe);
  };

  const result = unified.result;
  const completeResult = unified.phase === "complete" && result?.status === "complete" ? result : null;

  useEffect(() => {
    const list = completeResult?.candidates?.map(c => c.ticker) ?? [];
    if (list.length && subscribeEquitySymbols) subscribeEquitySymbols(list);
  }, [completeResult, subscribeEquitySymbols]);

  const editScreenObj = editingScreen != null ? universeData.screens.find(s => s.id === editingScreen) ?? null : null;

  const failedEngines = useMemo(() => {
    if (!completeResult) return [] as string[];
    const out: string[] = [];
    if (completeResult.engineStatus.discovery.status !== "ok") out.push("Discovery");
    if (completeResult.engineStatus.momentum.status !== "ok") out.push("Momentum");
    if (completeResult.engineStatus.unusual_flow.status !== "ok") out.push("Unusual Flow");
    return out;
  }, [completeResult]);

  const allEnginesFailed =
    completeResult &&
    completeResult.engineStatus.discovery.status !== "ok" &&
    completeResult.engineStatus.momentum.status !== "ok" &&
    completeResult.engineStatus.unusual_flow.status !== "ok";

  const partialEngineWarning =
    completeResult &&
    completeResult.candidates.length > 0 &&
    failedEngines.length > 0 &&
    failedEngines.length < 3;

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
        <div className="p-4 bg-[#0c0c0c] space-y-4">
          <div className="flex items-end gap-2">
            <div className="space-y-1.5 flex-1 min-w-0">
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
                  if (universe === `screen:${id}`) setUniverse("preset:liquidCore130");
                }}
                onRefreshScreen={handleRefreshScreen}
                refreshingScreenId={refreshingScreenId}
                onCreateWatchlist={() => { setEditingWatchlistId(null); setShowWatchlistEditor(true); }}
                onEditWatchlist={(id) => { setEditingWatchlistId(id); setShowWatchlistEditor(true); }}
                onDeleteWatchlist={async (id) => {
                  await universeData.deleteWatchlist(id);
                  if (universe === `watchlist:${id}`) setUniverse("preset:liquidCore130");
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {universeData.loading ? (
              <span className="text-zinc-500">Loading universes...</span>
            ) : (
              <span>
                Scanning <span className="text-primary font-bold">{currentSymCount} tickers</span>
                <span className="text-zinc-600 mx-1.5">·</span>
                <span className="text-zinc-400">{universeLabel}</span>
              </span>
            )}
          </div>
        </div>

        <div className="px-4 pb-4 pt-3 bg-[#0c0c0c] border-t border-card-border">
          <button
            type="button"
            onClick={handleScanClick}
            disabled={!accessToken || unified.phase === "scanning" || currentSymCount === 0 || shockActive}
            className="font-bold font-mono tracking-wider mx-auto block rounded-lg disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 active:brightness-110 transition-all"
            style={{
              fontSize: 13, padding: "10px",
              background: "#18181b", color: "#FFB800", border: "none",
              cursor: "pointer",
            }}
          >
            {unified.phase === "scanning" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-[#FFB800] border-t-transparent rounded-full animate-spin" />
                STARTING SCAN...
              </span>
            ) : (
              <span className="flex items-center justify-center">{`SCAN ${currentSymCount} STOCKS`}</span>
            )}
          </button>
          {!accessToken && (
            <div className="mt-2 flex justify-center">
              <ConnectBrokerPrompt label="Connect Brokerage For Market Scanner" compact />
            </div>
          )}
        </div>
      </div>

      {unified.phase === "idle" && !unified.errorMessage && (
        <div className="py-16 text-center text-sm text-muted-foreground/70 bg-card border border-card-border rounded-xl">
          Tap Scan to find trade candidates
        </div>
      )}

      {unified.phase === "scanning" && (
        <div className="flex flex-col gap-3 bg-card rounded-xl border border-card-border p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Loader2 className="w-8 h-8 text-[#FFB800] animate-spin shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-zinc-200">
                  Scanning {currentSymCount} tickers...
                </p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Engines: Discovery, Momentum, Unusual Flow
                </p>
                {unified.slowNotice && (
                  <p className="text-[11px] text-amber-400/90 mt-2">This is taking longer than expected — still polling…</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => unified.cancelLocal()}
              className="text-[10px] font-bold uppercase px-3 py-1.5 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 shrink-0"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 font-mono">
            ~{unified.etaRemaining}s remaining (est. {unified.estimatedSeconds}s)
          </p>
        </div>
      )}

      {unified.phase === "error" && unified.errorMessage && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-3">
          <p className="text-xs text-destructive font-bold uppercase">Scanner</p>
          <p className="text-[11px] text-destructive/90">{unified.errorMessage}</p>
          {unified.errorMessage.includes("Network") && unified.scanId && (
            <button
              type="button"
              onClick={() => unified.retryPoll()}
              className="text-[11px] font-bold px-3 py-1.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-600"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {completeResult && (
        <div className="space-y-3">
          {partialEngineWarning && (
            <div className="px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200">
              Note: {failedEngines.join(", ")} failed for this scan. Results may be incomplete.
            </div>
          )}

          {allEnginesFailed && completeResult.candidates.length === 0 && (
            <div className="px-4 py-4 rounded-xl border border-red-500/30 bg-red-500/5 text-center space-y-2">
              <p className="text-sm font-bold text-red-300">All scanner engines failed.</p>
              <div className="flex justify-center gap-2">
                <button type="button" onClick={handleScanClick} className="text-[11px] font-bold px-3 py-1.5 rounded bg-[#FFB800] text-black">
                  Retry
                </button>
                <button
                  type="button"
                  className="text-[11px] font-bold px-3 py-1.5 rounded border border-zinc-600 text-zinc-300"
                  onClick={async () => {
                    const text = `Unified scanner: all engines failed. Universe: ${universe}. Time: ${new Date().toISOString()}`;
                    try {
                      await navigator.clipboard.writeText(text);
                      toast({ description: "Details copied — paste into your support channel." });
                    } catch {
                      toast({ description: text });
                    }
                  }}
                >
                  Report issue
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">
              {completeResult.candidates.length} CANDIDATES · {universeLabel} · {formatScanTime(completeResult.completedAt ?? completeResult.startedAt)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 px-1">
            {enginePill("Discovery", completeResult.engineStatus.discovery)}
            {enginePill("Momentum", completeResult.engineStatus.momentum)}
            {enginePill("Unusual Flow", completeResult.engineStatus.unusual_flow)}
          </div>

          {completeResult.candidates.length === 0 && !allEnginesFailed ? (
            <div className="py-10 text-center text-[12px] text-zinc-500 bg-card border border-card-border rounded-xl px-4">
              No candidates found. Try a different universe or wait for the next market session.
            </div>
          ) : (
            <div className="space-y-2">
              {completeResult.candidates.map((c, i) => (
                <UnifiedScannerCard
                  key={c.ticker}
                  candidate={c}
                  rank={i + 1}
                  universeId={universe}
                  universeLabel={universeLabel}
                  expanded={expandedTicker === c.ticker}
                  onToggle={() => setExpandedTicker(expandedTicker === c.ticker ? null : c.ticker)}
                  onSendToStrategist={
                    onSendToStrategist
                      ? (sym) => {
                          onNavigateToSymbol?.(sym);
                          onSendToStrategist(sym);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
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
          editScreen={editScreenObj}
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
