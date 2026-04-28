import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useHeaderBottom } from "@/hooks/useHeaderBottom";
import { useTerminalStore, useActiveWatchlist, type LiveQuote } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Star,
  ListOrdered,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  Trash2,
  Plus,
  ChevronDown,
  Pencil,
  Check,
  X,
  Settings,
  MinusCircle,
  Crosshair,
  RefreshCw,
} from "lucide-react";

type IndicatorKey =
  | "mark" | "markChg" | "volume" | "rsi" | "pcRatio" | "beta"
  | "changePct" | "mmm" | "mktCap" | "yesterdayClose" | "weightedClose"
  | "pctChg20d" | "pctChgYtd" | "initMargin" | "divFreq"
  | "change" | "price" | "dayHigh" | "dayLow" | "open" | "bid" | "ask";
type SortKey = "symbol" | "last" | "changePct" | "change" | "volume" | "dayHigh" | "dayLow" | "open" | "bid" | "ask" | "marketCap";
type SortDir = "asc" | "desc";

interface IndicatorDef {
  key: IndicatorKey;
  label: string;
  desc: string;
  sortKey: SortKey;
  width: number;
  format: (q: LiveQuote | undefined) => string;
  color: (q: LiveQuote | undefined) => string;
}

const DASH = "\u2014";

const ALL_INDICATORS: IndicatorDef[] = [
  { key: "mark", label: "Mark", desc: "Last traded price", sortKey: "last", width: 72, format: (q) => fmtPrice(q?.last ?? null), color: (q) => q?.last != null ? "#fff" : "#52525b" },
  { key: "markChg", label: "Mark Change", desc: "Dollar change today", sortKey: "change", width: 72, format: (q) => fmtChange(q?.change ?? null), color: (q) => changeColor(q?.change ?? null) },
  { key: "volume", label: "Volume", desc: "Shares traded today", sortKey: "volume", width: 64, format: (q) => fmtVol(q?.volume ?? null), color: () => "#a1a1aa" },
  { key: "rsi", label: "RSI", desc: "Relative Strength Index", sortKey: "last", width: 56, format: () => DASH, color: () => "#52525b" },
  { key: "pcRatio", label: "P/C Ratio", desc: "Put/Call volume ratio", sortKey: "last", width: 72, format: () => DASH, color: () => "#52525b" },
  { key: "beta", label: "Beta", desc: "Market beta coefficient", sortKey: "last", width: 56, format: () => DASH, color: () => "#52525b" },
  { key: "changePct", label: "% Change", desc: "Percent change today", sortKey: "changePct", width: 72, format: (q) => fmtPct(q?.changePct ?? null), color: (q) => changeColor(q?.changePct ?? null) },
  { key: "mmm", label: "Market Maker Move", desc: "Expected move from MM", sortKey: "last", width: 80, format: () => DASH, color: () => "#52525b" },
  { key: "mktCap", label: "Mkt Cap", desc: "Market capitalization", sortKey: "marketCap", width: 72, format: () => DASH, color: () => "#52525b" },
  { key: "yesterdayClose", label: "Yesterday Close", desc: "Prior session close", sortKey: "open", width: 80, format: (q) => fmtPrice(q?.close ?? null), color: () => "#a1a1aa" },
  { key: "weightedClose", label: "WeightedClose", desc: "Weighted close price", sortKey: "last", width: 80, format: () => DASH, color: () => "#52525b" },
  { key: "pctChg20d", label: "% Chg Since: 20 Day", desc: "20-day percent change", sortKey: "last", width: 88, format: () => DASH, color: () => "#52525b" },
  { key: "pctChgYtd", label: "% Chg Since: YTD", desc: "Year-to-date change", sortKey: "last", width: 88, format: () => DASH, color: () => "#52525b" },
  { key: "initMargin", label: "Initial Margin", desc: "Initial margin req", sortKey: "last", width: 80, format: () => DASH, color: () => "#52525b" },
  { key: "divFreq", label: "Div. Frequency", desc: "Dividend frequency", sortKey: "last", width: 80, format: () => DASH, color: () => "#52525b" },
  { key: "change", label: "Chg", desc: "Dollar change", sortKey: "change", width: 64, format: (q) => fmtChange(q?.change ?? null), color: (q) => changeColor(q?.change ?? null) },
  { key: "price", label: "Price", desc: "Current price", sortKey: "last", width: 72, format: (q) => fmtPrice(q?.last ?? null), color: (q) => q?.last != null ? "#fff" : "#52525b" },
  { key: "dayHigh", label: "High", desc: "Session high", sortKey: "dayHigh", width: 72, format: (q) => fmtPrice(q?.high ?? null), color: () => "#a1a1aa" },
  { key: "dayLow", label: "Low", desc: "Session low", sortKey: "dayLow", width: 72, format: (q) => fmtPrice(q?.low ?? null), color: () => "#a1a1aa" },
  { key: "open", label: "Close", desc: "Previous close", sortKey: "open", width: 72, format: (q) => fmtPrice(q?.close ?? null), color: () => "#a1a1aa" },
  { key: "bid", label: "Bid", desc: "Current bid price", sortKey: "bid", width: 72, format: (q) => fmtPrice(q?.bid ?? null), color: () => "#a1a1aa" },
  { key: "ask", label: "Ask", desc: "Current ask price", sortKey: "ask", width: 72, format: (q) => fmtPrice(q?.ask ?? null), color: () => "#a1a1aa" },
];

const INDICATOR_MAP = new Map(ALL_INDICATORS.map(i => [i.key, i]));
const INDICATOR_STORAGE_KEY = "wl_indicators_v2";

const DEFAULT_INDICATORS: IndicatorKey[] = ["change", "changePct", "volume", "price", "dayHigh", "dayLow", "bid", "ask"];

interface SparkData {
  closes: number[];
  fetched: boolean;
}

const FMT_COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// Module-level cache — survives tab navigation (component unmount/remount)
const _sparkCache: Record<string, SparkData> = {};
const _fetchedSymbols = new Set<string>();
let _cacheToken: string | null = null;

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return v >= 1000 ? v.toFixed(0) : v.toFixed(2);
}

function fmtChange(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function fmtVol(v: number | null): string {
  if (v == null) return "—";
  return FMT_COMPACT.format(v);
}

function changeColor(v: number | null): string {
  if (v == null) return "#71717a";
  if (v > 0) return "#22c55e";
  if (v < 0) return "#ef4444";
  return "#71717a";
}

function MiniSparkline({ data, color, width = 56, height = 22 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WatchlistRow({
  sym,
  quote,
  spark,
  onTap,
  onRemove,
  editMode,
  indicators,
  gridCols,
  minW,
}: {
  sym: string;
  quote: LiveQuote | undefined;
  spark: SparkData | undefined;
  onTap: () => void;
  onRemove: () => void;
  editMode: boolean;
  indicators: IndicatorDef[];
  gridCols: string;
  minW: number;
}) {
  const change = quote?.change ?? null;
  const cColor = changeColor(change);
  const { data: restQuote } = useQuote(sym);
  const description = restQuote?.description ?? null;

  const [tapped, setTapped] = useState(false);

  const handleTickerTap = useCallback(() => {
    if (editMode) return;
    setTapped(true);
    setTimeout(() => {
      onTap();
      setTapped(false);
    }, 150);
  }, [editMode, onTap]);

  const stickyW = editMode ? 126 : 100;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: gridCols,
        minWidth: minW,
        borderBottom: "1px solid #2A2A2C",
        background: tapped ? "#1a1a1a" : "#000000",
        transition: "background 0.15s ease",
        alignItems: "center",
      }}
    >
      <div
        style={{
          position: "sticky",
          left: 0,
          zIndex: 1,
          background: tapped ? "#1a1a1a" : "#000000",
          display: "flex",
          alignItems: "center",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          minHeight: 52,
          width: stickyW,
        }}
      >
        {editMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="shrink-0 flex items-center justify-center pl-2"
            style={{ width: 36 }}
          >
            <MinusCircle className="w-5 h-5" style={{ color: "#ef4444" }} />
          </button>
        )}

        <div
          onClick={handleTickerTap}
          className="shrink-0 flex items-center px-3 py-2 cursor-pointer"
          style={{ flex: 1, minWidth: 0 }}
        >
          <div className="min-w-0">
            <span className="block font-mono text-[15px] font-bold tracking-wide truncate" style={{ color: cColor === "#71717a" ? "#fff" : cColor }}>{sym}</span>
            {description && (
              <span className="block font-mono text-[11px] tracking-wide truncate" style={{ color: "#FFB800" }}>
                {description}
              </span>
            )}
          </div>
        </div>

        {!editMode && (
          <ChevronRight className="w-3.5 h-3.5 text-[#3a3a3c] shrink-0 mr-2" />
        )}
      </div>

      <div className="shrink-0 flex items-center justify-center" style={{ padding: "0 2px" }}>
        {spark && spark.closes.length > 1 ? (
          <MiniSparkline data={spark.closes} color={cColor} width={60} height={24} />
        ) : (
          <div style={{ width: 48, height: 22 }} />
        )}
      </div>

      {indicators.map((ind) => (
        <span
          key={ind.key}
          className="font-mono text-[13px] tabular-nums text-right"
          style={{ color: ind.color(quote), padding: "0 6px", fontWeight: ind.key === "price" ? 700 : 400 }}
        >
          {ind.format(quote)}
        </span>
      ))}
    </div>
  );
}

function WatchlistSettingsPanel({
  activeIndicators,
  onToggle,
  onReorder,
  onReset,
  onClose,
}: {
  activeIndicators: IndicatorKey[];
  onToggle: (key: IndicatorKey) => void;
  onReorder: (keys: IndicatorKey[]) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const headerBottom = useHeaderBottom();
  const dragIdx = useRef<number | null>(null);
  const dragStartY = useRef(0);
  const ITEM_H = 44;

  const handlePointerDown = (e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragIdx.current = idx;
    dragStartY.current = e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragIdx.current == null) return;
    const delta = e.clientY - dragStartY.current;
    if (Math.abs(delta) >= ITEM_H * 0.6) {
      const dir = delta > 0 ? 1 : -1;
      const from = dragIdx.current;
      const to = from + dir;
      if (to >= 0 && to < activeIndicators.length) {
        const next = [...activeIndicators];
        [next[from], next[to]] = [next[to], next[from]];
        onReorder(next);
        dragIdx.current = to;
        dragStartY.current = e.clientY;
      }
    }
  };

  const handlePointerUp = () => { dragIdx.current = null; };

  const hiddenIndicators = ALL_INDICATORS.filter(i => !activeIndicators.includes(i.key));

  return (
    <>
      <div style={{ position: "fixed", top: headerBottom, left: 0, right: 0, bottom: 0, zIndex: 200, background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div
        style={{
          position: "fixed", top: headerBottom, left: 0, right: 0, bottom: 0, zIndex: 210,
          background: "#111", fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #2A2A2C", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Watchlist Settings</span>
          <button onClick={onClose} style={{ fontSize: 15, fontWeight: 600, color: "#FFB800", background: "transparent", border: "none", cursor: "pointer", padding: "4px 8px" }}>Close</button>
        </div>

        <div style={{ padding: "12px 16px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: 1 }}>Visible Columns</span>
          <button onClick={onReset} style={{ fontSize: 12, fontWeight: 600, color: "#FFB800", background: "transparent", border: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5 }}>Reset</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {activeIndicators.map((key, idx) => {
            const ind = INDICATOR_MAP.get(key);
            if (!ind) return null;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", padding: "0 16px", height: ITEM_H, borderBottom: "1px solid #2A2A2C" }}>
                <button
                  onClick={() => onToggle(key)}
                  style={{ width: 24, height: 24, borderRadius: 12, border: "none", background: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, marginRight: 12 }}
                >
                  <div style={{ width: 10, height: 2, background: "#fff", borderRadius: 1 }} />
                </button>
                <span style={{ fontSize: 15, color: "#fff", flex: 1 }}>{ind.label}</span>
                <div
                  onPointerDown={e => handlePointerDown(e, idx)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab", flexShrink: 0, touchAction: "none" }}
                >
                  <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                    <rect y="0" width="16" height="2" rx="1" fill="#71717a" />
                    <rect y="5" width="16" height="2" rx="1" fill="#71717a" />
                    <rect y="10" width="16" height="2" rx="1" fill="#71717a" />
                  </svg>
                </div>
              </div>
            );
          })}

          {hiddenIndicators.length > 0 && (
            <>
              <div style={{ padding: "16px 16px 6px" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#71717a", textTransform: "uppercase", letterSpacing: 1 }}>Available Columns</span>
              </div>
              {hiddenIndicators.map(ind => (
                <div key={ind.key} style={{ display: "flex", alignItems: "center", padding: "0 16px", height: ITEM_H, borderBottom: "1px solid #2A2A2C" }}>
                  <button
                    onClick={() => onToggle(ind.key)}
                    style={{ width: 24, height: 24, borderRadius: 12, border: "none", background: "#22c55e", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, marginRight: 12 }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <rect x="4" y="0" width="2" height="10" rx="1" fill="#fff" />
                      <rect x="0" y="4" width="10" height="2" rx="1" fill="#fff" />
                    </svg>
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 15, color: "#71717a" }}>{ind.label}</span>
                    <div style={{ fontSize: 11, color: "#71717a", opacity: 0.6, marginTop: 1 }}>{ind.desc}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

interface ScannerWatchlist {
  id: number;
  name: string;
  symbols: string[];
  isProtected: boolean;
}

let _scannerWlCache: ScannerWatchlist[] | null = null;
let _scannerWlFetchTs = 0;

function WatchlistDropdown({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { watchlists, activeWatchlistId, setActiveWatchlist, createWatchlist, deleteWatchlist, renameWatchlist } = useTerminalStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [scannerWatchlists, setScannerWatchlists] = useState<ScannerWatchlist[]>(_scannerWlCache ?? []);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [autoRefreshMsg, setAutoRefreshMsg] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setShowNew(false);
      setNewName("");
      return;
    }
    if (Date.now() - _scannerWlFetchTs > 30_000) {
      fetchWithAuth("/api/scanner/watchlists")
        .then(r => r.json())
        .then(d => {
          const wls = (d.watchlists ?? []) as ScannerWatchlist[];
          _scannerWlCache = wls;
          _scannerWlFetchTs = Date.now();
          setScannerWatchlists(wls);
        })
        .catch(() => {});
    }
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose]);

  if (!open) return null;

  const ids = Object.keys(watchlists);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createWatchlist(name);
    setNewName("");
    setShowNew(false);
  };

  const handleRename = (id: string) => {
    const name = editName.trim();
    if (!name) return;
    renameWatchlist(id, name);
    setEditingId(null);
  };

  const handleAutoRefresh = async () => {
    setAutoRefreshing(true);
    setAutoRefreshMsg(null);
    try {
      const res = await fetchWithAuth("/api/scanner/refresh-auto-watchlists", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setAutoRefreshMsg(data.error ?? "Refresh failed");
        return;
      }
      const wls = (data.watchlists ?? []) as ScannerWatchlist[];
      _scannerWlCache = wls;
      _scannerWlFetchTs = Date.now();
      setScannerWatchlists(wls);
      const updated = (data.updated ?? []) as Array<{ name: string; count: number }>;
      if (updated.length > 0) {
        setAutoRefreshMsg(`Updated: ${updated.map((u: { name: string; count: number }) => `${u.name} (${u.count})`).join(", ")}`);
      } else {
        setAutoRefreshMsg("No data available — try during market hours");
      }
    } catch {
      setAutoRefreshMsg("Refresh failed — check connection");
    } finally {
      setAutoRefreshing(false);
    }
  };

  const handleSelectScannerWl = (swl: ScannerWatchlist) => {
    const localId = `scanner_${swl.id}`;
    const store = useTerminalStore.getState();
    const existing = store.watchlists[localId];
    if (!existing) {
      useTerminalStore.setState((s) => ({
        watchlists: { ...s.watchlists, [localId]: { name: `[S] ${swl.name}`, symbols: swl.symbols } },
        activeWatchlistId: localId,
      }));
    } else {
      useTerminalStore.setState((s) => ({
        watchlists: { ...s.watchlists, [localId]: { ...existing, symbols: swl.symbols } },
        activeWatchlistId: localId,
      }));
    }
    onClose();
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
      style={{ background: "#111", border: "1px solid #2A2A2C", width: "min(320px, calc(100vw - 32px))", maxHeight: 400 }}
    >
      <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
        {showNew ? (
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid #2A2A2C" }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowNew(false); setNewName(""); } }}
              placeholder="Watchlist name..."
              className="flex-1 font-mono text-sm bg-transparent text-white outline-none border-b border-[#FFB800] placeholder:text-[#52525b] pb-0.5"
              autoFocus
            />
            <button onClick={handleCreate} className="p-1 text-[#22c55e]">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => { setShowNew(false); setNewName(""); }} className="p-1 text-[#71717a]">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNew(true)}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-[#FFB800] hover:bg-white/[0.04] transition-colors"
            style={{ borderBottom: "1px solid #2A2A2C" }}
          >
            <Plus className="w-4 h-4" />
            <span className="font-mono text-sm font-bold tracking-wider">CREATE NEW WATCHLIST</span>
          </button>
        )}

        {ids.map((id) => {
          const wl = watchlists[id];
          const isActive = id === activeWatchlistId;
          const isEditing = editingId === id;

          return (
            <div
              key={id}
              className="flex items-center px-4 py-2.5 transition-colors hover:bg-white/[0.04]"
              style={{ borderBottom: "1px solid #1c1c1c", background: isActive ? "rgba(255,184,0,0.06)" : undefined }}
            >
              {isEditing ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRename(id); if (e.key === "Escape") setEditingId(null); }}
                    className="flex-1 font-mono text-sm bg-transparent text-white outline-none border-b border-[#FFB800]"
                    autoFocus
                  />
                  <button onClick={() => handleRename(id)} className="p-1 text-[#22c55e]">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1 text-[#71717a]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => { setActiveWatchlist(id); onClose(); }}
                    className="flex-1 text-left flex items-center gap-2.5 min-w-0"
                  >
                    <Star className="w-3.5 h-3.5 shrink-0" style={{ color: isActive ? "#FFB800" : "#3a3a3c" }} />
                    <span className={`font-mono text-sm font-bold truncate ${isActive ? "text-[#FFB800]" : "text-white"}`}>
                      {wl.name}
                    </span>
                    <span className="font-mono text-xs text-[#52525b] shrink-0 ml-auto">
                      {wl.symbols.length}
                    </span>
                  </button>
                  <div className="flex items-center gap-0.5 ml-2 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(id); setEditName(wl.name); }}
                      className="p-1.5 text-[#52525b] hover:text-white rounded transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {id !== "default" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteWatchlist(id); }}
                        className="p-1.5 text-[#52525b] hover:text-red-400 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        <div style={{ borderTop: "1px solid #2A2A2C" }}>
          <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid #1c1c1c" }}>
            <ListOrdered className="w-3.5 h-3.5 text-[#52525b]" />
            <span className="font-mono text-[10px] text-[#52525b] uppercase tracking-widest font-bold">Dynamic Watchlists</span>
            <button
              onClick={handleAutoRefresh}
              disabled={autoRefreshing}
              title="Refresh dynamic lists from live market data"
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono font-bold transition-colors"
              style={{
                color: autoRefreshing ? "#52525b" : "#FFB800",
                background: autoRefreshing ? "transparent" : "rgba(255,184,0,0.08)",
                border: "1px solid " + (autoRefreshing ? "#2A2A2C" : "#FFB800"),
                cursor: autoRefreshing ? "not-allowed" : "pointer",
              }}
            >
              <RefreshCw className={`w-3 h-3 ${autoRefreshing ? "animate-spin" : ""}`} />
              {autoRefreshing ? "SCANNING..." : "REFRESH"}
            </button>
          </div>
          {autoRefreshMsg && (
            <div className="px-4 py-1.5 font-mono text-[10px]" style={{ color: autoRefreshMsg.startsWith("Updated") ? "#22c55e" : "#ef4444", borderBottom: "1px solid #1c1c1c", background: "rgba(0,0,0,0.3)" }}>
              {autoRefreshMsg}
            </div>
          )}
        </div>
        {scannerWatchlists.length > 0 && (
          <>
            {scannerWatchlists.map((swl) => {
              const localId = `scanner_${swl.id}`;
              const isActive = activeWatchlistId === localId;
              return (
                <div
                  key={localId}
                  className="flex items-center px-4 py-2.5 transition-colors hover:bg-white/[0.04]"
                  style={{ borderBottom: "1px solid #1c1c1c", background: isActive ? "rgba(255,184,0,0.06)" : undefined }}
                >
                  <button
                    onClick={() => handleSelectScannerWl(swl)}
                    className="flex-1 text-left flex items-center gap-2.5 min-w-0"
                  >
                    <Crosshair className="w-3.5 h-3.5 shrink-0" style={{ color: isActive ? "#FFB800" : "#52525b" }} />
                    <span className={`font-mono text-sm font-bold truncate ${isActive ? "text-[#FFB800]" : "text-white"}`}>
                      {swl.name}
                    </span>
                    <span className="font-mono text-xs text-[#52525b] shrink-0 ml-auto">
                      {swl.symbols.length}
                    </span>
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function WatchlistSwitcherButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { watchlists, activeWatchlistId } = useTerminalStore();
  const activeList = watchlists[activeWatchlistId];

  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-white/[0.04] active:bg-white/[0.08]"
    >
      <span className="font-mono text-[14px] font-bold tracking-wider text-white">
        {activeList?.name ?? "Watchlist"}
      </span>
      <ChevronDown className={`w-4 h-4 text-[#71717a] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function ColumnHeader({
  indicator,
  sortKey,
  sortDir,
  onSort,
}: {
  indicator: IndicatorDef;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === indicator.sortKey;
  return (
    <button
      onClick={() => onSort(indicator.sortKey)}
      className="font-mono tracking-wider text-right flex items-center justify-end gap-0.5 transition-colors"
      style={{ color: "#71717a", padding: "4px 6px", fontSize: 12 }}
    >
      <span>{indicator.label}</span>
      {active && <span style={{ fontSize: 8 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

export function WatchlistView({ onNavigateToSymbol }: { onNavigateToSymbol?: (sym: string) => void }) {
  const { removeFromWatchlist, setSymbol, accessToken } = useTerminalStore();
  const streamPrices = useTerminalStore((s) => s.streamPrices);
  const watchlist = useActiveWatchlist();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sparkData, setSparkData] = useState<Record<string, SparkData>>(() => ({ ..._sparkCache }));
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorKey[]>(() => {
    try {
      const saved = localStorage.getItem(INDICATOR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as IndicatorKey[];
        const validKeys = new Set<string>(ALL_INDICATORS.map(i => i.key));
        const sanitized = [...new Set(parsed.filter(k => validKeys.has(k)))];
        if (sanitized.length > 0) return sanitized as IndicatorKey[];
      }
    } catch {}
    return DEFAULT_INDICATORS;
  });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const RESTORE_KEY = "scanner_wl_restored";
    if (localStorage.getItem(RESTORE_KEY)) return;
    const store = useTerminalStore.getState();
    const localWls = store.watchlists;
    const localIds = Object.keys(localWls);
    const isOnlyEmptyDefault = localIds.length === 1 && localIds[0] === "default" && localWls.default.symbols.length === 0;
    if (!isOnlyEmptyDefault) { localStorage.setItem(RESTORE_KEY, "1"); return; }
    fetchWithAuth("/api/scanner/watchlists")
      .then(r => r.json())
      .then((d) => {
        const wls = (d.watchlists ?? []) as { id: number; name: string; symbols: string[]; isProtected: boolean }[];
        const nonEmpty = wls.filter(w => w.symbols.length > 0);
        if (nonEmpty.length === 0) { localStorage.setItem(RESTORE_KEY, "1"); return; }
        const restored: Record<string, { name: string; symbols: string[] }> = {};
        for (const wl of nonEmpty) {
          restored[`scanner_${wl.id}`] = { name: wl.name, symbols: wl.symbols };
        }
        useTerminalStore.setState((s) => ({
          watchlists: { ...s.watchlists, ...restored },
          activeWatchlistId: `scanner_${nonEmpty[0].id}`,
        }));
        localStorage.setItem(RESTORE_KEY, "1");
      })
      .catch(() => {});
  }, []);

  const visibleIndicators = useMemo(() =>
    activeIndicators.map((k) => ALL_INDICATORS.find((i) => i.key === k)!).filter(Boolean),
    [activeIndicators]
  );

  const toggleIndicator = useCallback((key: IndicatorKey) => {
    setActiveIndicators((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      if (next.length === 0) return prev;
      try { localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const reorderIndicators = useCallback((newOrder: IndicatorKey[]) => {
    setActiveIndicators(newOrder);
    try { localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(newOrder)); } catch {}
  }, []);

  const resetIndicators = useCallback(() => {
    setActiveIndicators(DEFAULT_INDICATORS);
    try { localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(DEFAULT_INDICATORS)); } catch {}
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortKey(null);
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey, sortDir]);

  useEffect(() => {
    if (!accessToken || watchlist.length === 0) return;

    // If token changed, clear the module-level cache
    if (_cacheToken && _cacheToken !== accessToken) {
      _fetchedSymbols.clear();
      Object.keys(_sparkCache).forEach(k => delete _sparkCache[k]);
      setSparkData({});
    }
    _cacheToken = accessToken;

    const toFetch = watchlist.filter((s) => !_fetchedSymbols.has(s));
    if (toFetch.length === 0) return;
    const controller = new AbortController();
    let retryCount = 0;

    async function fetchSpark(sym: string) {
      try {
        const res = await fetchWithAuth(
          `/api/market/history?symbol=${encodeURIComponent(sym)}&periodType=day&period=5&frequencyType=minute&frequency=30`,
          { signal: controller.signal, cache: "no-store" as RequestCache }
        );
        if (!res.ok) return false;
        const data = await res.json();
        const candles = data?.candles;
        if (Array.isArray(candles) && candles.length > 0) {
          const closes = candles.map((c: { close: number }) => c.close);
          _fetchedSymbols.add(sym);
          _sparkCache[sym] = { closes, fetched: true };
          setSparkData((prev) => ({ ...prev, [sym]: { closes, fetched: true } }));
          return true;
        }
        return false;
      } catch {
        return false;
      }
    }

    const batchSize = 3;
    let i = 0;
    function nextBatch() {
      const batch = toFetch.slice(i, i + batchSize);
      if (batch.length === 0) {
        const stillMissing = toFetch.filter((s) => !fetchedRef.current.has(s));
        if (stillMissing.length > 0 && retryCount < 2 && !controller.signal.aborted) {
          retryCount++;
          i = 0;
          toFetch.length = 0;
          toFetch.push(...stillMissing);
          retryTimerRef.current = setTimeout(nextBatch, 5000 * retryCount);
        }
        return;
      }
      i += batchSize;
      Promise.all(batch.map(fetchSpark)).then(() => {
        if (!controller.signal.aborted) setTimeout(nextBatch, 200);
      });
    }
    nextBatch();
    return () => {
      controller.abort();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [watchlist, accessToken]);

  const sorted = useMemo(() => {
    if (!sortKey) return watchlist;
    const items = [...watchlist];
    items.sort((a, b) => {
      const qa = streamPrices[a];
      const qb = streamPrices[b];
      let cmp = 0;
      switch (sortKey) {
        case "symbol": cmp = a.localeCompare(b); break;
        case "last": cmp = (qa?.last ?? 0) - (qb?.last ?? 0); break;
        case "changePct": cmp = (qa?.changePct ?? 0) - (qb?.changePct ?? 0); break;
        case "change": cmp = (qa?.change ?? 0) - (qb?.change ?? 0); break;
        case "volume": cmp = (qa?.volume ?? 0) - (qb?.volume ?? 0); break;
        case "dayHigh": cmp = (qa?.high ?? 0) - (qb?.high ?? 0); break;
        case "dayLow": cmp = (qa?.low ?? 0) - (qb?.low ?? 0); break;
        case "open": cmp = (qa?.close ?? 0) - (qb?.close ?? 0); break;
        case "bid": cmp = (qa?.bid ?? 0) - (qb?.bid ?? 0); break;
        case "ask": cmp = (qa?.ask ?? 0) - (qb?.ask ?? 0); break;
        default: cmp = 0;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [watchlist, sortKey, sortDir, streamPrices]);

  const gainers = watchlist.filter((s) => (streamPrices[s]?.changePct ?? 0) > 0).length;
  const losers = watchlist.filter((s) => (streamPrices[s]?.changePct ?? 0) < 0).length;
  const unchanged = watchlist.length - gainers - losers;

  const stickyW = editMode ? 126 : 100;
  const sparkW = 68;
  const gridCols = useMemo(() => {
    let cols = `${stickyW}px ${sparkW}px`;
    for (const ind of visibleIndicators) cols += ` ${ind.width}px`;
    return cols;
  }, [stickyW, visibleIndicators]);
  const minRowW = useMemo(() => stickyW + sparkW + visibleIndicators.reduce((s, i) => s + i.width, 0), [stickyW, visibleIndicators]);

  return (
    <div className="flex-1 flex flex-col" style={{ background: "#000000" }}>
      {settingsOpen && (
        <WatchlistSettingsPanel
          activeIndicators={activeIndicators}
          onToggle={toggleIndicator}
          onReorder={reorderIndicators}
          onReset={resetIndicators}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-center mb-3 relative">
          <WatchlistSwitcherButton open={switcherOpen} onToggle={() => setSwitcherOpen((p) => !p)} />
          <WatchlistDropdown open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
          <div className="absolute right-0 flex items-center gap-1">
            <button
              aria-label="Watchlist settings"
              onClick={() => setSettingsOpen(true)}
              className="p-2 rounded-lg transition-colors hover:bg-white/[0.06]"
            >
              <Settings className="w-4.5 h-4.5" style={{ color: "#71717a" }} />
            </button>
            <button
              onClick={() => setEditMode((p) => !p)}
              className="p-2 rounded-lg transition-colors hover:bg-white/[0.06]"
            >
              {editMode ? (
                <Check className="w-4.5 h-4.5" style={{ color: "#FFB800" }} />
              ) : (
                <Pencil className="w-4.5 h-4.5" style={{ color: "#71717a" }} />
              )}
            </button>
          </div>
        </div>

        {watchlist.length > 0 && (
          <div className="flex items-center gap-4 mb-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: "#22c55e" }} />
              <span className="font-mono text-[11px] text-[#a1a1aa]">{gainers} up</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
              <span className="font-mono text-[11px] text-[#a1a1aa]">{losers} down</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: "#71717a" }} />
              <span className="font-mono text-[11px] text-[#a1a1aa]">{unchanged} flat</span>
            </div>
          </div>
        )}
      </div>

      <div>
        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <div className="relative">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{ border: "1px solid #FFB80020" }}
              >
                <ListOrdered className="w-9 h-9" style={{ color: "#FFB80040" }} />
              </div>
              <div
                className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: "#2A2A2C", border: "1px solid #3a3a3c" }}
              >
                <Plus className="w-3.5 h-3.5 text-[#71717a]" />
              </div>
            </div>
            <div className="text-center">
              <p className="font-mono text-[14px] text-[#a1a1aa] mb-1.5">No symbols watched</p>
              <p className="font-mono text-[12px] text-[#52525b] leading-relaxed">
                Search for a ticker and tap <span style={{ color: "#FFB800" }}>+</span> to add
              </p>
            </div>
          </div>
        ) : (
          <div className="wl-hscroll" style={{ overflowX: "scroll", overscrollBehaviorX: "none", touchAction: "pan-x pan-y" }}>
            <style>{`.wl-hscroll::-webkit-scrollbar{display:none}.wl-hscroll{scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior-x:none;touch-action:pan-x pan-y}`}</style>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  minWidth: minRowW,
                  borderBottom: "1px solid #2A2A2C",
                  background: "#000000",
                  alignItems: "center",
                }}
              >
                <div style={{ position: "sticky", left: 0, zIndex: 3, background: "#000000", padding: "4px 12px", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
                  <button
                    onClick={() => handleSort("symbol")}
                    className="font-mono tracking-wider flex items-center gap-0.5 transition-colors"
                    style={{ color: "#71717a", fontSize: 12 }}
                  >
                    Symbol
                    {sortKey === "symbol" && <span style={{ fontSize: 8 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
                  </button>
                </div>
                <div />
                {visibleIndicators.map((ind) => (
                  <ColumnHeader key={ind.key} indicator={ind} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                ))}
              </div>

              {sorted.map((sym) => (
                <WatchlistRow
                  key={sym}
                  sym={sym}
                  quote={streamPrices[sym]}
                  spark={sparkData[sym]}
                  onTap={() => { setSymbol(sym); onNavigateToSymbol?.(sym); }}
                  onRemove={() => removeFromWatchlist(sym)}
                  editMode={editMode}
                  indicators={visibleIndicators}
                  gridCols={gridCols}
                  minW={minRowW}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
