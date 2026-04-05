import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
} from "lucide-react";

type IndicatorKey = "change" | "changePct" | "volume" | "price" | "dayHigh" | "dayLow" | "open" | "bid" | "ask" | "marketCap";
type SortKey = "symbol" | "last" | "changePct" | "change" | "volume" | "dayHigh" | "dayLow" | "open" | "bid" | "ask" | "marketCap";
type SortDir = "asc" | "desc";

interface IndicatorDef {
  key: IndicatorKey;
  label: string;
  sortKey: SortKey;
  width: number;
  format: (q: LiveQuote | undefined) => string;
  color: (q: LiveQuote | undefined) => string;
}

const ALL_INDICATORS: IndicatorDef[] = [
  { key: "change", label: "Chg", sortKey: "change", width: 64, format: (q) => fmtChange(q?.change ?? null), color: (q) => changeColor(q?.change ?? null) },
  { key: "changePct", label: "Chg%", sortKey: "changePct", width: 64, format: (q) => fmtPct(q?.changePct ?? null), color: (q) => changeColor(q?.changePct ?? null) },
  { key: "volume", label: "Vol", sortKey: "volume", width: 64, format: (q) => fmtVol(q?.volume ?? null), color: () => "#a1a1aa" },
  { key: "price", label: "Price", sortKey: "last", width: 72, format: (q) => fmtPrice(q?.last ?? null), color: (q) => q?.last != null ? "#fff" : "#52525b" },
  { key: "dayHigh", label: "High", sortKey: "dayHigh", width: 72, format: (q) => fmtPrice(q?.high ?? null), color: () => "#a1a1aa" },
  { key: "dayLow", label: "Low", sortKey: "dayLow", width: 72, format: (q) => fmtPrice(q?.low ?? null), color: () => "#a1a1aa" },
  { key: "open", label: "Close", sortKey: "open", width: 72, format: (q) => fmtPrice(q?.close ?? null), color: () => "#a1a1aa" },
  { key: "bid", label: "Bid", sortKey: "bid", width: 72, format: (q) => fmtPrice(q?.bid ?? null), color: () => "#a1a1aa" },
  { key: "ask", label: "Ask", sortKey: "ask", width: 72, format: (q) => fmtPrice(q?.ask ?? null), color: () => "#a1a1aa" },
];

const DEFAULT_INDICATORS: IndicatorKey[] = ["change", "volume", "price"];

interface SparkData {
  closes: number[];
  fetched: boolean;
}

const FMT_COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

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
}: {
  sym: string;
  quote: LiveQuote | undefined;
  spark: SparkData | undefined;
  onTap: () => void;
  onRemove: () => void;
  editMode: boolean;
  indicators: IndicatorDef[];
}) {
  const change = quote?.change ?? null;
  const cColor = changeColor(change);
  const { data: restQuote } = useQuote(sym);
  const description = restQuote?.description ?? null;

  const [tapped, setTapped] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleTap = useCallback(() => {
    if (editMode) return;
    setTapped(true);
    setTimeout(() => {
      onTap();
      setTapped(false);
    }, 150);
  }, [editMode, onTap]);

  return (
    <div style={{ borderBottom: "1px solid #2A2A2C" }}>
      <div
        className="relative"
        style={{
          background: tapped ? "#1a1a1a" : "#000000",
          transition: "background 0.15s ease",
        }}
      >
        <div className="flex items-center" style={{ minHeight: 52 }}>
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
            onClick={handleTap}
            className="shrink-0 flex items-center px-3 py-2 cursor-pointer"
            style={{ width: editMode ? 90 : 100 }}
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

          <div className="shrink-0" style={{ width: 1, height: 32, background: "rgba(255,255,255,0.08)" }} />

          <div
            ref={scrollRef}
            onClick={handleTap}
            className="flex-1 overflow-x-auto cursor-pointer"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
          >
            <style>{`.wl-scroll::-webkit-scrollbar { display: none; }`}</style>
            <div className="wl-scroll flex items-center gap-1 px-2 py-2" style={{ minWidth: "max-content" }}>
              {spark && spark.closes.length > 1 ? (
                <MiniSparkline data={spark.closes} color={cColor} width={48} height={22} />
              ) : (
                <div className="shrink-0" style={{ width: 48, height: 22 }} />
              )}

              {indicators.map((ind) => (
                <span
                  key={ind.key}
                  className="font-mono text-[13px] tabular-nums text-right shrink-0"
                  style={{ color: ind.color(quote), width: ind.width, fontWeight: ind.key === "price" ? 700 : 400 }}
                >
                  {ind.format(quote)}
                </span>
              ))}
            </div>
          </div>

          {!editMode && (
            <ChevronRight className="w-3.5 h-3.5 text-[#3a3a3c] shrink-0 mr-2" />
          )}
        </div>
      </div>
    </div>
  );
}

function IndicatorSettingsPanel({
  open,
  onClose,
  activeIndicators,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  activeIndicators: IndicatorKey[];
  onToggle: (key: IndicatorKey) => void;
}) {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-[200]"
        onClick={onClose}
      />
      <div className="fixed left-4 right-4 z-[210] flex flex-col" style={{ top: "50%", transform: "translateY(-50%)", maxHeight: "70vh", background: "#111", border: "1px solid #2A2A2C", borderRadius: 12 }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #2A2A2C" }}>
          <span className="font-mono text-[14px] font-bold tracking-wider text-white">INDICATORS</span>
          <button onClick={onClose} className="p-1 text-[#71717a] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto py-1">
          {ALL_INDICATORS.map((ind) => {
            const isActive = activeIndicators.includes(ind.key);
            return (
              <button
                key={ind.key}
                onClick={() => onToggle(ind.key)}
                className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.04]"
                style={{ borderBottom: "1px solid #1c1c1c" }}
              >
                <span className="font-mono text-[13px] tracking-wider" style={{ color: isActive ? "#fff" : "#52525b" }}>{ind.label}</span>
                <div
                  className="w-5 h-5 rounded flex items-center justify-center"
                  style={{ background: isActive ? "#FFB800" : "transparent", border: isActive ? "none" : "1px solid #3a3a3c" }}
                >
                  {isActive && <Check className="w-3.5 h-3.5 text-black" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function WatchlistSwitcherPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { watchlists, activeWatchlistId, setActiveWatchlist, createWatchlist, deleteWatchlist, renameWatchlist } = useTerminalStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [headerH, setHeaderH] = useState(0);

  useEffect(() => {
    const el = document.getElementById("terminal-header");
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

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

  return (
    <>
      <div
        className={`fixed left-0 right-0 bottom-0 bg-black/60 z-40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{ top: headerH }}
        onClick={onClose}
      />

      <div
        className={`fixed left-0 right-0 bottom-0 z-50 transform transition-transform duration-300 flex flex-col ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "#000000", top: headerH }}
      >
        <div className="flex items-center justify-center px-4 py-4 border-b border-[#2A2A2C]">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5" style={{ color: "#FFB800" }} />
            <span className="font-mono text-[16px] font-bold tracking-wider text-white">SWITCH WATCHLIST</span>
          </div>
          <button
            onClick={onClose}
            className="absolute right-4 p-2 rounded-lg text-[#71717a] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {ids.map((id) => {
            const wl = watchlists[id];
            const isActive = id === activeWatchlistId;
            const isEditing = editingId === id;

            return (
              <div
                key={id}
                className={`flex items-center justify-between px-5 py-2 transition-colors ${isActive ? "border-l-2 border-l-[#FFB800]" : "border-l-2 border-l-transparent hover:bg-white/[0.03]"}`}
                style={{ borderBottom: "1px solid #2A2A2C" }}
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRename(id); if (e.key === "Escape") setEditingId(null); }}
                      className="flex-1 font-mono text-[14px] bg-transparent text-white outline-none border-b border-[#FFB800]"
                      autoFocus
                    />
                    <button onClick={() => handleRename(id)} className="p-1.5 text-[#22c55e] rounded">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 text-[#71717a] rounded">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { setActiveWatchlist(id); onClose(); }}
                      className="flex-1 text-left flex items-center gap-3"
                    >
                      <Star className="w-4 h-4" style={{ color: isActive ? "#FFB800" : "#3a3a3c" }} />
                      <div className="flex flex-col">
                        <span className={`font-mono text-[14px] font-bold ${isActive ? "text-[#FFB800]" : "text-white"}`}>
                          {wl.name}
                        </span>
                        <span className="font-mono text-[11px] text-[#52525b]">
                          {wl.symbols.length} {wl.symbols.length === 1 ? "symbol" : "symbols"}
                        </span>
                      </div>
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(id); setEditName(wl.name); }}
                        className="p-2 text-[#52525b] hover:text-white rounded-lg transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {id !== "default" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteWatchlist(id); }}
                          className="p-2 text-[#52525b] hover:text-red-400 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {showNew ? (
            <div className="flex items-center gap-2 px-5 py-4" style={{ borderBottom: "1px solid #2A2A2C" }}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowNew(false); setNewName(""); } }}
                placeholder="Watchlist name..."
                className="flex-1 font-mono text-[14px] bg-transparent text-white outline-none border-b border-[#FFB800] placeholder:text-[#52525b]"
                autoFocus
              />
              <button onClick={handleCreate} className="p-1.5 text-[#22c55e] rounded">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => { setShowNew(false); setNewName(""); }} className="p-1.5 text-[#71717a] rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNew(true)}
              className="w-full flex items-center gap-3 px-5 py-4 text-[#FFB800] hover:bg-white/[0.04] transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="font-mono text-[13px] font-bold tracking-wider">NEW WATCHLIST</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function WatchlistSwitcherButton({ onOpen }: { onOpen: () => void }) {
  const { watchlists, activeWatchlistId } = useTerminalStore();
  const activeList = watchlists[activeWatchlistId];

  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-white/[0.04] active:bg-white/[0.08]"
    >
      <span className="font-mono text-[14px] font-bold tracking-wider text-white">
        {activeList?.name ?? "Watchlist"}
      </span>
      <ChevronDown className="w-4 h-4 text-[#71717a]" />
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
      className="font-mono text-[11px] tracking-wider text-right shrink-0 flex items-center justify-end gap-0.5 transition-colors"
      style={{ color: active ? "#FFB800" : "#52525b", width: indicator.width }}
    >
      <span>{indicator.label}</span>
      <span className="text-[8px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
    </button>
  );
}

export function WatchlistView({ onNavigateToSymbol }: { onNavigateToSymbol?: (sym: string) => void }) {
  const { removeFromWatchlist, setSymbol, accessToken } = useTerminalStore();
  const streamPrices = useTerminalStore((s) => s.streamPrices);
  const watchlist = useActiveWatchlist();
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sparkData, setSparkData] = useState<Record<string, SparkData>>({});
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorKey[]>(() => {
    try {
      const saved = localStorage.getItem("wl_indicators");
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_INDICATORS;
  });
  const fetchedRef = useRef<Set<string>>(new Set());
  const prevTokenRef = useRef<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleIndicators = useMemo(() =>
    activeIndicators.map((k) => ALL_INDICATORS.find((i) => i.key === k)!).filter(Boolean),
    [activeIndicators]
  );

  const toggleIndicator = useCallback((key: IndicatorKey) => {
    setActiveIndicators((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      if (next.length === 0) return prev;
      localStorage.setItem("wl_indicators", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  }, [sortKey]);

  useEffect(() => {
    if (!accessToken || watchlist.length === 0) return;

    if (prevTokenRef.current && prevTokenRef.current !== accessToken) {
      fetchedRef.current.clear();
    }
    prevTokenRef.current = accessToken;

    const toFetch = watchlist.filter((s) => !fetchedRef.current.has(s));
    if (toFetch.length === 0) return;
    const controller = new AbortController();
    let retryCount = 0;

    async function fetchSpark(sym: string) {
      try {
        const res = await fetchWithAuth(
          `/api/market/history?symbol=${encodeURIComponent(sym)}&accessToken=${encodeURIComponent(accessToken!)}&periodType=day&period=5&frequencyType=minute&frequency=30`,
          { signal: controller.signal, cache: "no-store" as RequestCache }
        );
        if (!res.ok) return false;
        const data = await res.json();
        const candles = data?.candles;
        if (Array.isArray(candles) && candles.length > 0) {
          const closes = candles.map((c: { close: number }) => c.close);
          fetchedRef.current.add(sym);
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

  return (
    <div className="flex-1 flex flex-col" style={{ background: "#000000" }}>
      <WatchlistSwitcherPanel open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <IndicatorSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} activeIndicators={activeIndicators} onToggle={toggleIndicator} />

      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-center mb-3 relative">
          <WatchlistSwitcherButton onOpen={() => setSwitcherOpen(true)} />
          <div className="absolute right-0 flex items-center gap-1">
            <button
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

      {watchlist.length > 0 && (
        <div className="flex items-center px-3 pb-2" style={{ borderBottom: "1px solid #2A2A2C" }}>
          <div style={{ width: editMode ? 126 : 100 }} className="shrink-0">
            <button
              onClick={() => handleSort("symbol")}
              className="font-mono text-[11px] tracking-wider flex items-center gap-0.5 transition-colors"
              style={{ color: sortKey === "symbol" ? "#FFB800" : "#52525b" }}
            >
              Symbol
              <span className="text-[8px]">{sortKey === "symbol" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
            </button>
          </div>

          <div className="shrink-0" style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)", marginRight: 4 }} />

          <div className="flex-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            <div className="flex items-center gap-1 px-2" style={{ minWidth: "max-content" }}>
              <div style={{ width: 48 }} className="shrink-0" />
              {visibleIndicators.map((ind) => (
                <ColumnHeader key={ind.key} indicator={ind} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              ))}
            </div>
          </div>

          {!editMode && <div style={{ width: 18 }} className="shrink-0" />}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {watchlist.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-20">
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
          sorted.map((sym) => (
            <WatchlistRow
              key={sym}
              sym={sym}
              quote={streamPrices[sym]}
              spark={sparkData[sym]}
              onTap={() => { setSymbol(sym); onNavigateToSymbol?.(sym); }}
              onRemove={() => removeFromWatchlist(sym)}
              editMode={editMode}
              indicators={visibleIndicators}
            />
          ))
        )}
      </div>
    </div>
  );
}
