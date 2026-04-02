import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTerminalStore, useActiveWatchlist, type LiveQuote } from "@/lib/store";
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
  Wifi,
  WifiOff,
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

  return (
    <div
      onClick={onTap}
      role="button"
      tabIndex={0}
      className="group relative cursor-pointer active:bg-white/[0.04] transition-colors"
      style={{ background: "#1C1C1E", borderBottom: "1px solid #2A2A2C" }}
    >
      <div className="flex items-center px-4 py-3 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {change != null && change > 0 && <TrendingUp className="w-4 h-4 shrink-0" style={{ color: "#22c55e" }} />}
            {change != null && change < 0 && <TrendingDown className="w-4 h-4 shrink-0" style={{ color: "#ef4444" }} />}
            {(change == null || change === 0) && <Minus className="w-4 h-4 shrink-0" style={{ color: "#71717a" }} />}
            <span className="font-mono text-[15px] font-bold text-white tracking-wider">{sym}</span>
          </div>

          <div className="flex items-center gap-3 pl-6">
            {spark && spark.closes.length > 1 && (
              <MiniSparkline data={spark.closes} color={cColor} />
            )}
            <div className="flex items-center gap-2 font-mono text-[12px]">
              <span style={{ color: cColor }}>{fmtChange(change)}</span>
              <span className="px-1.5 py-0.5 rounded" style={{ background: `${cColor}15`, color: cColor }}>
                {fmtPct(changePct)}
              </span>
            </div>
            <span className="font-mono text-[11px] text-[#71717a]">
              {fmtVol(volume)}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className="font-mono text-[16px] font-bold tabular-nums px-2.5 py-1 rounded-lg"
            style={{
              color: hasData ? "#fff" : "#52525b",
              background: hasData ? `${cColor}18` : "transparent",
              border: hasData ? `1px solid ${cColor}30` : "none",
            }}
          >
            {hasData ? `$${fmtPrice(last)}` : "—"}
          </span>
        </div>

        <ChevronRight className="w-4 h-4 text-[#3a3a3c] group-hover:text-[#71717a] transition-colors shrink-0" />
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-3 right-3 p-2 rounded-lg text-[#52525b] hover:text-red-400 hover:bg-red-400/10 active:bg-red-400/20 transition-all"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function WatchlistSwitcher() {
  const { watchlists, activeWatchlistId, setActiveWatchlist, createWatchlist, deleteWatchlist, renameWatchlist } = useTerminalStore();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent | TouchEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [open]);

  const ids = Object.keys(watchlists);
  const activeList = watchlists[activeWatchlistId];

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createWatchlist(name);
    setNewName("");
    setShowNew(false);
    setOpen(false);
  };

  const handleRename = (id: string) => {
    const name = editName.trim();
    if (!name) return;
    renameWatchlist(id, name);
    setEditingId(null);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-white/[0.04] active:bg-white/[0.08]"
      >
        <Star className="w-5 h-5" style={{ color: "#FFB800" }} />
        <span className="font-mono text-[14px] font-bold tracking-wider text-white">
          {activeList?.name ?? "Watchlist"}
        </span>
        <span
          className="font-mono text-[11px] px-1.5 py-0.5 rounded-md"
          style={{ background: "#FFB80015", color: "#FFB800", border: "1px solid #FFB80030" }}
        >
          {activeList?.symbols.length ?? 0}
        </span>
        <ChevronDown className={`w-4 h-4 text-[#71717a] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 w-72 rounded-xl border overflow-hidden shadow-2xl"
          style={{ background: "#111113", borderColor: "#2A2A2C" }}
        >
          {ids.map((id) => {
            const wl = watchlists[id];
            const isActive = id === activeWatchlistId;
            const isEditing = editingId === id;

            return (
              <div
                key={id}
                className={`flex items-center justify-between px-4 py-3 transition-colors ${isActive ? "bg-[#FFB800]/10" : "hover:bg-white/[0.04]"}`}
                style={{ borderBottom: "1px solid #2A2A2C" }}
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRename(id); if (e.key === "Escape") setEditingId(null); }}
                      className="flex-1 font-mono text-[13px] bg-transparent text-white outline-none border-b border-[#FFB800]"
                      autoFocus
                    />
                    <button onClick={() => handleRename(id)} className="p-1 text-[#22c55e] hover:bg-[#22c55e]/10 rounded">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1 text-[#71717a] hover:bg-white/10 rounded">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { setActiveWatchlist(id); setOpen(false); }}
                      className="flex-1 text-left flex items-center gap-2"
                    >
                      <span className={`font-mono text-[13px] font-medium ${isActive ? "text-[#FFB800]" : "text-white"}`}>
                        {wl.name}
                      </span>
                      <span className="font-mono text-[11px] text-[#71717a]">
                        ({wl.symbols.length})
                      </span>
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(id); setEditName(wl.name); }}
                        className="p-1.5 text-[#52525b] hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {id !== "default" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteWatchlist(id); }}
                          className="p-1.5 text-[#52525b] hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
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

          {showNew ? (
            <div className="flex items-center gap-2 px-4 py-3">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") { setShowNew(false); setNewName(""); } }}
                placeholder="Watchlist name..."
                className="flex-1 font-mono text-[13px] bg-transparent text-white outline-none border-b border-[#FFB800] placeholder:text-[#52525b]"
                autoFocus
              />
              <button onClick={handleCreate} className="p-1 text-[#22c55e] hover:bg-[#22c55e]/10 rounded">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setShowNew(false); setNewName(""); }} className="p-1 text-[#71717a] hover:bg-white/10 rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNew(true)}
              className="w-full flex items-center gap-2 px-4 py-3 text-[#FFB800] hover:bg-[#FFB800]/5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="font-mono text-[12px] font-bold tracking-wider">NEW WATCHLIST</span>
            </button>
          )}
        </div>
      )}
    </div>
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

export function WatchlistView() {
  const { removeFromWatchlist, setSymbol, streamPrices, accessToken, streamStatus } = useTerminalStore();
  const watchlist = useActiveWatchlist();
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sparkData, setSparkData] = useState<Record<string, SparkData>>({});
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
    <div className="flex-1 flex flex-col" style={{ background: "#1C1C1E" }}>
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <WatchlistSwitcher />
          <div className="flex items-center gap-1.5">
            {streamStatus === "live" ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-[#22c55e]" />
                <span className="font-mono text-[10px] text-[#22c55e] uppercase font-bold">Live</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-[#71717a]" />
                <span className="font-mono text-[10px] text-[#71717a] uppercase">{streamStatus}</span>
              </>
            )}
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
                style={{ background: "#FFB80010", border: "1px solid #FFB80020" }}
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
              onTap={() => setSymbol(sym)}
              onRemove={() => removeFromWatchlist(sym)}
            />
          ))
        )}
      </div>
    </div>
  );
}
