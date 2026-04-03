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
} from "lucide-react";

type SortKey = "symbol" | "last" | "changePct";
type SortDir = "asc" | "desc";

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
}: {
  sym: string;
  quote: LiveQuote | undefined;
  spark: SparkData | undefined;
  onTap: () => void;
  onRemove: () => void;
}) {
  const last = quote?.last ?? null;
  const change = quote?.change ?? null;
  const changePct = quote?.changePct ?? null;
  const volume = quote?.volume ?? null;
  const cColor = changeColor(change);
  const hasData = last != null;
  const { data: restQuote } = useQuote(sym);
  const description = restQuote?.description ?? null;

  const [offsetX, setOffsetX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [tapped, setTapped] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const lockedRef = useRef<"h" | "v" | null>(null);
  const DELETE_W = 80;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    lockedRef.current = null;
    setSwiping(true);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;

    if (!lockedRef.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        lockedRef.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
      return;
    }
    if (lockedRef.current === "v") return;

    const clamped = Math.max(-DELETE_W, Math.min(0, dx));
    setOffsetX(clamped);
  }, [swiping]);

  const onTouchEnd = useCallback(() => {
    setSwiping(false);
    lockedRef.current = null;
    setOffsetX((prev) => (prev < -DELETE_W / 2 ? -DELETE_W : 0));
  }, []);

  const handleDelete = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    onRemove();
  }, [onRemove]);

  const handleTap = useCallback(() => {
    if (offsetX < -10) {
      setOffsetX(0);
      return;
    }
    setTapped(true);
    setTimeout(() => {
      onTap();
      setTapped(false);
    }, 150);
  }, [offsetX, onTap]);

  return (
    <div className="relative overflow-hidden" style={{ borderBottom: "1px solid #2A2A2C" }}>
      <div
        className="absolute right-0 top-0 bottom-0 flex items-center justify-center cursor-pointer active:opacity-80"
        style={{ width: DELETE_W, background: "#ef4444" }}
        onClick={handleDelete}
      >
        <span className="font-mono text-[12px] font-bold text-white tracking-wider">REMOVE</span>
      </div>

      <div
        onClick={handleTap}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="button"
        tabIndex={0}
        className="relative cursor-pointer"
        style={{
          background: tapped ? "#1a1a1a" : "#000000",
          transform: `translateX(${offsetX}px)`,
          transition: swiping ? "none" : "transform 0.25s ease-out, background 0.15s ease",
        }}
      >
        <div className="flex items-center px-3 py-2 gap-2">
          <div className="w-[80px] shrink-0 min-w-0">
            <span className="block font-mono text-[15px] font-bold tracking-wide truncate" style={{ color: cColor === "#71717a" ? "#fff" : cColor }}>{sym}</span>
            {description && (
              <span className="block font-mono text-[11px] uppercase tracking-wide truncate" style={{ color: "#FFB800" }}>
                {description}
              </span>
            )}
          </div>

          {spark && spark.closes.length > 1 ? (
            <MiniSparkline data={spark.closes} color={cColor} width={52} height={24} />
          ) : (
            <div style={{ width: 52, height: 24 }} />
          )}

          <div className="flex-1 flex items-center justify-end gap-3">
            <span className="font-mono text-[13px] tabular-nums" style={{ color: cColor }}>{fmtChange(change)}</span>
            <span className="font-mono text-[13px] tabular-nums text-right w-[72px]" style={{ color: "#a1a1aa" }}>{fmtVol(volume)}</span>
            <span
              className="font-mono text-[13px] font-bold tabular-nums text-right w-[64px]"
              style={{ color: hasData ? "#fff" : "#52525b" }}
            >
              {hasData ? fmtPrice(last) : "—"}
            </span>
          </div>

          <ChevronRight className="w-3.5 h-3.5 text-[#3a3a3c] shrink-0" />
        </div>
      </div>
    </div>
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
                className={`flex items-center justify-between px-5 py-4 transition-colors ${isActive ? "border-l-2 border-l-[#FFB800]" : "border-l-2 border-l-transparent hover:bg-white/[0.03]"}`}
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

function SortButton({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = currentSort === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-widest transition-colors"
      style={{ color: active ? "#FFB800" : "#52525b" }}
    >
      {label}
      {active && <span className="text-[9px]">{currentDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

export function WatchlistView({ onNavigateToSymbol }: { onNavigateToSymbol?: (sym: string) => void }) {
  const { removeFromWatchlist, setSymbol, streamPrices, accessToken } = useTerminalStore();
  const watchlist = useActiveWatchlist();
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sparkData, setSparkData] = useState<Record<string, SparkData>>({});
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const fetchedRef = useRef<Set<string>>(new Set());

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
    const toFetch = watchlist.filter((s) => !fetchedRef.current.has(s));
    if (toFetch.length === 0) return;
    const controller = new AbortController();

    async function fetchSpark(sym: string) {
      try {
        const res = await fetchWithAuth(
          `/api/market/history?symbol=${encodeURIComponent(sym)}&accessToken=${encodeURIComponent(accessToken!)}&periodType=day&period=5&frequencyType=minute&frequency=30`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const data = await res.json();
        const candles = data?.candles;
        if (Array.isArray(candles) && candles.length > 0) {
          const closes = candles.map((c: { close: number }) => c.close);
          fetchedRef.current.add(sym);
          setSparkData((prev) => ({ ...prev, [sym]: { closes, fetched: true } }));
        }
      } catch {}
    }

    const batchSize = 3;
    let i = 0;
    function nextBatch() {
      const batch = toFetch.slice(i, i + batchSize);
      if (batch.length === 0) return;
      i += batchSize;
      Promise.all(batch.map(fetchSpark)).then(() => {
        if (!controller.signal.aborted) setTimeout(nextBatch, 200);
      });
    }
    nextBatch();
    return () => controller.abort();
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

      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-center mb-3">
          <WatchlistSwitcherButton onOpen={() => setSwitcherOpen(true)} />
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
        <div className="flex items-center justify-between px-4 pb-2 border-b border-[#2A2A2C]">
          <SortButton label="Symbol" sortKey="symbol" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
          <div className="flex items-center gap-6">
            <SortButton label="Change" sortKey="changePct" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
            <SortButton label="Price" sortKey="last" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
          </div>
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
            />
          ))
        )}
      </div>
    </div>
  );
}
