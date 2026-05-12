import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { parseTuningUniverseSelection, WATCHLIST_LABELS, WATCHLIST_SIZES } from "@/lib/tuningWatchlistUi";
import ReactDOM from "react-dom";
import { useTerminalStore } from "@/lib/store";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
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
import { useUnifiedScan } from "@/hooks/useUnifiedScan";
import { UnifiedScannerCard } from "./UnifiedScannerCard";
import { ScannerErrorBoundary } from "./ScannerErrorBoundary";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import {
  ScannerCard,
  emptyScannerCardData,
  muteSymbolForNextSession,
  persistMutedSymbols,
  pruneAndFilterMutedSymbols,
  readMutedSymbols,
  enrichScannerCardFromV2Candidate,
  scannerWireCardToScannerCardData,
  ScannerChromeBar,
  ScannerIdleEmptyState,
  ScannerZeroCandidatesInline,
  ScannerLayer1ColumnHeader,
} from "@/components/scanner";
import type { ScannerV3WireCard } from "@/hooks/useUnifiedScan";
import type { ScannerCardAction } from "@/components/scanner/scannerCard.types";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";
import { cn } from "@/lib/utils";

function UniverseDropdown({ value, onChange, presets, tuningEntries, watchlists, screens, onCreateScreen, onEditScreen, onDeleteScreen, onRefreshScreen, refreshingScreenId, onCreateWatchlist, onEditWatchlist, onDeleteWatchlist, chromeTrigger }: {
  value: string;
  onChange: (v: string) => void;
  presets: Record<string, { label: string; description: string; count: number }>;
  tuningEntries: Array<{ universeKey: string; label: string; count: number }>;
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
  /** Scanner chrome: hug-content trigger, ~36px tall, `text-sm` + `rounded-lg`. */
  chromeTrigger?: boolean;
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
  } else if (value.startsWith("tuning:")) {
    const tw = tuningEntries.find((e) => e.universeKey === value);
    selectedLabel = tw?.label ?? value;
    selectedCount = tw?.count ?? 0;
  }

  const maxH = typeof window !== "undefined" ? Math.min(560, window.innerHeight - pos.top - 16) : 400;

  const showCountBadge =
    typeof selectedCount === "number" && Number.isFinite(selectedCount)
      ? !new RegExp(`\\b${selectedCount}\\b`).test(selectedLabel)
      : true;

  const showCount = showCountBadge && !chromeTrigger;

  return (
    <div className={cn("relative", chromeTrigger ? "block w-full min-w-0 max-w-full" : "")}>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "border text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40",
          chromeTrigger
            ? "relative flex h-9 max-h-9 w-full min-w-0 items-center rounded-lg border-zinc-700/60 bg-zinc-900/80 py-1.5 pl-3 pr-8 text-left text-sm hover:border-zinc-500"
            : "flex w-full min-h-[40px] items-center justify-between gap-2 rounded-md border-card-border bg-card px-3 py-2 text-sm hover:border-zinc-600",
        )}
      >
        <span className={cn("min-w-0 font-medium leading-snug", chromeTrigger ? "block truncate" : "")}>
          {selectedLabel}
          {showCount ? (
            <span className="whitespace-nowrap font-normal text-muted-foreground">
              {" "}
              ({selectedCount})
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "text-muted-foreground/70 transition-transform",
            open && "rotate-180",
            chromeTrigger
              ? "pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 shrink-0"
              : "h-4 w-4 shrink-0",
          )}
          aria-hidden
        />
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
                    value === pKey ? "bg-[#FFD100]/10 text-[#FFD100]" : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                  }`}
                >
                  <span className="font-medium leading-snug">{p.label}</span>
                  <span className={`text-xs tabular-nums shrink-0 ${value === pKey ? "text-[#FFD100]/60" : "text-zinc-600"}`}>{p.count}</span>
                </button>
              );
            })}

            {tuningEntries.length > 0 && (
              <>
                <div className="mx-3 my-1.5 border-t border-zinc-700/50" />
                <div className="px-3 pt-2 pb-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Tuning bench</span>
                </div>
                {tuningEntries.map((t) => {
                  const isActive = value === t.universeKey;
                  return (
                    <button
                      key={t.universeKey}
                      type="button"
                      onClick={() => {
                        onChange(t.universeKey);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 text-sm transition-colors ${
                        isActive ? "bg-[#FFD100]/10 text-[#FFD100]" : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                      }`}
                    >
                      <span className="font-medium leading-snug">{t.label}</span>
                      <span className={`text-xs tabular-nums shrink-0 ${isActive ? "text-[#FFD100]/60" : "text-zinc-600"}`}>
                        {t.count}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

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
                        isActive ? "bg-[#FFD100]/10 text-[#FFD100]" : "text-zinc-300 hover:bg-zinc-800/60"
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
                      <span className={`text-xs tabular-nums shrink-0 ${isActive ? "text-[#FFD100]/60" : "text-zinc-600"}`}>
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
                    isActive ? "bg-[#FFD100]/10 text-[#FFD100]" : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <button onClick={() => { onChange(wlKey); setOpen(false); }} className="flex-1 text-left">
                    <span className="font-medium leading-snug">{wl.name}</span>
                  </button>
                  <span className={`text-xs tabular-nums shrink-0 ${isActive ? "text-[#FFD100]/60" : "text-zinc-600"}`}>{wl.symbols.length}</span>
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
              className="w-full text-left px-3 py-2.5 flex items-center gap-2 text-sm text-zinc-400 hover:text-[#FFD100] hover:bg-zinc-800/60 transition-colors"
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
  const tuning = parseTuningUniverseSelection(universeId);
  if (tuning) return WATCHLIST_LABELS[tuning];
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

function formatAgeShort(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

function SnapshotFreshnessBanner(props: {
  snapshotCompletedAt: string | null;
  snapshotAgeSeconds: number | null;
  stale: boolean | null;
}) {
  const { snapshotCompletedAt, snapshotAgeSeconds, stale } = props;
  const inMarketHours = isUsEquitiesMarketHoursEt();

  if (!snapshotCompletedAt && snapshotAgeSeconds == null) return null;

  const tsLabel = formatScanTime(snapshotCompletedAt);
  const ageLabel = formatAgeShort(snapshotAgeSeconds);

  if (stale === true && inMarketHours) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/95">
        Live refresh stalled. Last update {tsLabel}
      </div>
    );
  }

  if (stale === true && !inMarketHours) {
    return (
      <p className="text-[11px] text-muted-foreground/80 px-1">
        Last session close {tsLabel}. Live refresh resumes at next market open.
      </p>
    );
  }

  if (stale === false && ageLabel) {
    return (
      <p className="text-[11px] text-muted-foreground/70 px-1">
        Updated {ageLabel} ago
      </p>
    );
  }

  return (
    <p className="text-[11px] text-muted-foreground/70 px-1">
      Snapshot {tsLabel}
    </p>
  );
}

type SendToStrategistFn = (sym: string) => void;

const SCANNER_UNIVERSE_STORAGE_KEY = "scanner_universe_selection_v2";
const LEGACY_TUNING_WATCHLIST_LS = "scanner_tuning_watchlist_v1";

const TUNING_DROPDOWN_ENTRIES = (["mega_cap_core", "active_trade", "cyclicals_macro"] as const).map((k) => ({
  universeKey: `tuning:${k}`,
  label: WATCHLIST_LABELS[k],
  count: WATCHLIST_SIZES[k],
}));

function readInitialUniverse(): string {
  if (typeof window === "undefined") return "preset:liquidCore130";
  try {
    const stored = localStorage.getItem(SCANNER_UNIVERSE_STORAGE_KEY);
    if (stored && stored.length > 0) return stored;
    const legacy = localStorage.getItem(LEGACY_TUNING_WATCHLIST_LS);
    if (legacy === "mega_cap_core" || legacy === "active_trade" || legacy === "cyclicals_macro") {
      localStorage.removeItem(LEGACY_TUNING_WATCHLIST_LS);
      const migrated = `tuning:${legacy}`;
      localStorage.setItem(SCANNER_UNIVERSE_STORAGE_KEY, migrated);
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return "preset:liquidCore130";
}

function MarketScannerInner({ subscribeEquitySymbols, onNavigateToSymbol, onSendToStrategist }: {
  subscribeEquitySymbols?: (symbols: string[]) => void;
  onNavigateToSymbol?: (sym: string) => void;
  onSendToStrategist?: SendToStrategistFn;
}) {
  const { accessToken } = useTerminalStore();
  const { pulseData } = useMarketPulseStore();
  const shockActive = pulseData?.shockState === "ACTIVE";
  const universeData = useScannerUniverses();
  const unified = useUnifiedScan();

  const [universe, setUniverse] = useState(readInitialUniverse);
  const [resolvedSymbols, setResolvedSymbols] = useState<string[]>([]);
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(() => new Set());
  const [quietTodayExpanded, setQuietTodayExpanded] = useState(false);
  const [muteTick, setMuteTick] = useState(0);

  const [showScreenBuilder, setShowScreenBuilder] = useState(false);
  const [editingScreen, setEditingScreen] = useState<number | null>(null);
  const [refreshingScreenId, setRefreshingScreenId] = useState<number | null>(null);
  const [showWatchlistEditor, setShowWatchlistEditor] = useState(false);
  const [editingWatchlistId, setEditingWatchlistId] = useState<number | null>(null);

  const REMOVED_PRESETS = new Set(["preset:sp500", "preset:sp100", "preset:ndx100"]);

  useEffect(() => {
    try {
      localStorage.setItem(SCANNER_UNIVERSE_STORAGE_KEY, universe);
    } catch {
      /* ignore */
    }
  }, [universe]);

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
    setExpandedSymbols(new Set());
    await unified.startScan(universe);
  };

  const scanComplete = unified.phase === "complete";
  const candidates = unified.candidates;

  const layer1CardDataBySymbol = useMemo(() => {
    const cards = unified.layer1Universe?.cards;
    const scanAt = unified.layer1Universe?.scan_at;
    if (!Array.isArray(cards) || !scanAt) return new Map<string, ScannerCardData>();
    const candBySym = new Map(unified.candidates.map((c) => [c.ticker.trim().toUpperCase(), c] as const));
    const m = new Map<string, ScannerCardData>();
    for (const c of cards) {
      if (!c || typeof c !== "object" || typeof c.symbol !== "string") continue;
      const sym = c.symbol.trim().toUpperCase();
      if (!sym) continue;
      const fromWire = scannerWireCardToScannerCardData(c as ScannerV3WireCard, scanAt);
      m.set(sym, enrichScannerCardFromV2Candidate(fromWire, candBySym.get(sym)));
    }
    return m;
  }, [unified.layer1Universe?.cards, unified.layer1Universe?.scan_at, unified.candidates]);

  const layer1FilteredSymbols = useMemo(() => {
    if (!unified.layer1Universe?.tickers?.length) return [];
    const raw = readMutedSymbols();
    const now = Date.now();
    const { pruned, activeMuted } = pruneAndFilterMutedSymbols(raw, now);
    return unified.layer1Universe.tickers
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0 && !activeMuted.has(s))
      .sort((a, b) => a.localeCompare(b));
  }, [unified.layer1Universe, muteTick]);

  const layer1ActiveAndQuiet = useMemo(() => {
    const active: string[] = [];
    const quiet: string[] = [];
    for (const sym of layer1FilteredSymbols) {
      const d = layer1CardDataBySymbol.get(sym) ?? emptyScannerCardData(sym);
      const et = d.flow?.eventsToday ?? 0;
      if (d.flow == null || et === 0) quiet.push(sym);
      else active.push(sym);
    }
    const compareActive = (a: string, b: string) => {
      const da = layer1CardDataBySymbol.get(a) ?? emptyScannerCardData(a);
      const db = layer1CardDataBySymbol.get(b) ?? emptyScannerCardData(b);
      const fa = da.flow;
      const fb = db.flow;
      const ea = fa?.eventsToday ?? 0;
      const eb = fb?.eventsToday ?? 0;
      if (eb !== ea) return eb - ea;
      const sa = fa?.sweepCount ?? fa?.sweeps4h ?? 0;
      const sb = fb?.sweepCount ?? fb?.sweeps4h ?? 0;
      if (sb !== sa) return sb - sa;
      const la = fa?.largestEventNotional ?? 0;
      const lb = fb?.largestEventNotional ?? 0;
      if (lb !== la) return lb - la;
      return a.localeCompare(b);
    };
    active.sort(compareActive);
    quiet.sort((a, b) => a.localeCompare(b));
    return { active, quiet };
  }, [layer1FilteredSymbols, layer1CardDataBySymbol]);

  useEffect(() => {
    const raw = readMutedSymbols();
    const now = Date.now();
    const { pruned } = pruneAndFilterMutedSymbols(raw, now);
    if (pruned.length !== raw.length) persistMutedSymbols(pruned);
  }, [unified.layer1Universe, muteTick]);

  const subscribeEquityRef = useRef(subscribeEquitySymbols);
  subscribeEquityRef.current = subscribeEquitySymbols;

  useEffect(() => {
    if (!scanComplete) return;
    const sub = subscribeEquityRef.current;
    if (!sub) return;
    const fromLayer1 = layer1FilteredSymbols;
    const fromCandidates = candidates.map((c) => c.ticker);
    const merged = [...new Set([...fromLayer1, ...fromCandidates])];
    if (merged.length) void sub(merged);
  }, [scanComplete, layer1FilteredSymbols, candidates]);

  const bumpMuteRender = useCallback(() => {
    setMuteTick((n) => n + 1);
  }, []);

  const handleScannerCardAction = useCallback(
    (sym: string, action: ScannerCardAction) => {
      if (action === "analyze") {
        if (onSendToStrategist) {
          onNavigateToSymbol?.(sym);
          onSendToStrategist(sym);
        }
        return;
      }
      if (action === "watchlist") {
        const wl = universeData.watchlists[0];
        if (wl) {
          void universeData.addSymbolToWatchlist(wl.id, sym);
        } else {
          // TODO: wire "+ Watchlist" from scanner v3 cards when no watchlists exist (create flow or picker).
        }
        return;
      }
      if (action === "mute") {
        muteSymbolForNextSession(sym);
        setExpandedSymbols((prev) => {
          const next = new Set(prev);
          next.delete(sym);
          return next;
        });
        bumpMuteRender();
      }
    },
    [onSendToStrategist, onNavigateToSymbol, universeData.watchlists, universeData.addSymbolToWatchlist, bumpMuteRender],
  );

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

      <ScannerChromeBar
        universeSlot={
          <UniverseDropdown
            value={universe}
            onChange={setUniverse}
            presets={universeData.presets}
            tuningEntries={TUNING_DROPDOWN_ENTRIES}
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
            chromeTrigger
          />
        }
        scanSlot={
          <button
            type="button"
            onClick={handleScanClick}
            disabled={!accessToken || unified.phase === "scanning" || currentSymCount === 0 || shockActive}
            className="inline-flex h-9 max-h-9 shrink-0 flex-none items-center justify-center whitespace-nowrap rounded-lg border border-primary/75 bg-transparent px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-30 active:scale-[0.99]"
          >
            {unified.phase === "scanning" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="truncate">Loading</span>
              </span>
            ) : (
              "Scan"
            )}
          </button>
        }
        footerSlot={
          !accessToken ? (
            <div className="mt-2 flex justify-center">
              <ConnectBrokerPrompt label="Connect Brokerage For Market Scanner" compact />
            </div>
          ) : undefined
        }
      />

      {unified.phase === "idle" && !unified.errorMessage && <ScannerIdleEmptyState />}

      {unified.phase === "scanning" && (
        <div className="flex flex-col gap-3 bg-card rounded-xl border border-card-border p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin shrink-0 text-[#FFD100]" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-zinc-200">Loading candidates...</p>
              <p className="text-[11px] text-zinc-500 mt-1">Reading precomputed snapshot for this universe.</p>
            </div>
          </div>
        </div>
      )}

      {unified.phase === "error" && unified.errorMessage && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-3">
          <p className="text-xs text-destructive font-bold uppercase">Scanner</p>
          <p className="text-[11px] text-destructive/90">{unified.errorMessage}</p>
          <button
            type="button"
            onClick={handleScanClick}
            className="text-[11px] font-bold px-3 py-1.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-600"
          >
            Retry
          </button>
        </div>
      )}

      {scanComplete && (
        <div className="space-y-3">
          {unified.layer1Universe && (
            <>
              <div aria-live="polite" aria-atomic="true" className="sr-only">
                {`Scanner universe loaded: ${unified.layer1Universe.count} tickers, ${layer1ActiveAndQuiet.active.length} with flow today, ${layer1ActiveAndQuiet.quiet.length} quiet after mutes.`}
              </div>
              <div className="divide-y divide-zinc-900 border-y border-zinc-900 overflow-hidden rounded-none bg-black">
                <div
                  className="flex items-center justify-between bg-black px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
                  style={{
                    fontFamily:
                      "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
                  }}
                >
                  <span>SORTED BY MAX URGENCY</span>
                  <span>
                    {layer1ActiveAndQuiet.active.length} ACTIVE · {layer1ActiveAndQuiet.quiet.length} QUIET
                  </span>
                </div>
                <ScannerLayer1ColumnHeader id="scanner-v3-layer1-col-header" />
                <div
                  role="list"
                  aria-label={`Scanner universe, ${layer1ActiveAndQuiet.active.length} active tickers`}
                  className="divide-y divide-zinc-900"
                >
                  {layer1ActiveAndQuiet.active.map((sym) => (
                    <ScannerCard
                      key={sym}
                      data={layer1CardDataBySymbol.get(sym) ?? emptyScannerCardData(sym)}
                      expanded={expandedSymbols.has(sym)}
                      onToggle={() => {
                        setExpandedSymbols((prev) => {
                          const next = new Set(prev);
                          if (next.has(sym)) {
                            next.delete(sym);
                          } else {
                            next.add(sym);
                          }
                          return next;
                        });
                      }}
                      onAction={(action) => handleScannerCardAction(sym, action)}
                    />
                  ))}
                </div>
                {layer1ActiveAndQuiet.quiet.length > 0 ? (
                  <div className="border-t border-zinc-900 bg-black">
                    <button
                      type="button"
                      onClick={() => setQuietTodayExpanded((v) => !v)}
                      className="flex w-full items-center gap-2 bg-black px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-zinc-500 hover:bg-zinc-950 hover:text-zinc-300"
                    >
                      {quietTodayExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      )}
                      QUIET TODAY ({layer1ActiveAndQuiet.quiet.length})
                    </button>
                    {quietTodayExpanded ? (
                      <div className="border-t border-zinc-900 px-0 pb-1 pt-1">
                        <div className="flex flex-wrap gap-1.5 px-3 pb-2 pt-0.5">
                          {layer1ActiveAndQuiet.quiet.map((sym) => (
                            <button
                              key={sym}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setQuietTodayExpanded(true);
                                setExpandedSymbols(new Set([sym]));
                              }}
                              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-200 hover:border-[#FFA500]/60 hover:text-[#FFA500]"
                            >
                              {sym}
                            </button>
                          ))}
                        </div>
                        {layer1ActiveAndQuiet.quiet
                          .filter((s) => expandedSymbols.has(s))
                          .map((sym) => (
                            <ScannerCard
                              key={`quiet-expanded-${sym}`}
                              data={layer1CardDataBySymbol.get(sym) ?? emptyScannerCardData(sym)}
                              expanded
                              onToggle={() => {
                                setExpandedSymbols((prev) => {
                                  const next = new Set(prev);
                                  next.delete(sym);
                                  return next;
                                });
                              }}
                              onAction={(action) => handleScannerCardAction(sym, action)}
                            />
                          ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
          <div className="flex flex-wrap items-end justify-between gap-2 px-1">
            <SnapshotFreshnessBanner
              snapshotCompletedAt={unified.snapshotCompletedAt}
              snapshotAgeSeconds={unified.snapshotAgeSeconds}
              stale={unified.stale}
            />
            <button
              type="button"
              onClick={handleScanClick}
              disabled={!accessToken || unified.phase === "scanning" || currentSymCount === 0 || shockActive}
              className="text-[11px] font-bold px-2 py-1 rounded border border-zinc-600 bg-zinc-800 text-zinc-200 shrink-0 disabled:opacity-40"
            >
              Retry
            </button>
          </div>
          {candidates.length === 0 && layer1FilteredSymbols.length === 0 ? (
            <ScannerZeroCandidatesInline />
          ) : candidates.length > 0 ? (
            <div className="space-y-2">
              {candidates.map((c, i) => (
                <UnifiedScannerCard
                  key={c.ticker}
                  candidate={c}
                  rank={i + 1}
                  universeId={universe}
                  universeLabel={universeLabel}
                  expanded={expandedSymbols.has(c.ticker)}
                  onToggle={() => {
                    setExpandedSymbols((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.ticker)) {
                        // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
                        next.delete(c.ticker);
                      } else {
                        // TODO: emit scanner_v3_card_* telemetry once frontend telemetry plumbing is established.
                        next.add(c.ticker);
                      }
                      return next;
                    });
                  }}
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
          ) : null}
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
          editScreen={
            editingScreen != null
              ? universeData.screens.find((s) => s.id === editingScreen) ?? null
              : null
          }
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

export function MarketScanner(props: {
  subscribeEquitySymbols?: (symbols: string[]) => void;
  onNavigateToSymbol?: (sym: string) => void;
  onSendToStrategist?: SendToStrategistFn;
}) {
  return (
    <ScannerErrorBoundary>
      <MarketScannerInner {...props} />
    </ScannerErrorBoundary>
  );
}
