import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTerminalStore, type LiveQuote } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Star,
  ListOrdered,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  Trash2,
  Plus,
  BarChart3,
  Activity,
  Wifi,
  WifiOff,
} from "lucide-react";

type SortKey = "symbol" | "last" | "change" | "changePct" | "volume";
type SortDir = "asc" | "desc";

interface SparkData {
  closes: number[];
  fetched: boolean;
}

const FMT_COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(2) : v.toFixed(2);
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

function MiniSparkline({ data, color, width = 60, height = 20 }: { data: number[]; color: string; width?: number; height?: number }) {
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
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DayRangeBar({ low, high, last }: { low: number | null; high: number | null; last: number | null }) {
  if (low == null || high == null || last == null) return null;
  const range = high - low;
  if (range <= 0) return null;
  const pct = Math.max(0, Math.min(100, ((last - low) / range) * 100));

  return (
    <div className="w-full">
      <div className="flex justify-between mb-0.5">
        <span className="font-mono text-[8px] text-[#71717a]">{low.toFixed(2)}</span>
        <span className="font-mono text-[8px] text-[#71717a]">{high.toFixed(2)}</span>
      </div>
      <div className="relative h-[3px] rounded-full overflow-hidden" style={{ background: "#2A2A2C" }}>
        <div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${pct}%`, background: "linear-gradient(90deg, #ef4444, #FFB800, #22c55e)" }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-white"
          style={{ left: `calc(${pct}% - 3px)`, background: "#fff" }}
        />
      </div>
    </div>
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
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const high = quote?.high ?? null;
  const low = quote?.low ?? null;
  const cColor = changeColor(change);
  const hasData = last != null;

  return (
    <div
      onClick={onTap}
      role="button"
      tabIndex={0}
      className="group relative cursor-pointer border-b border-[#2A2A2C]/60 last:border-b-0"
      style={{ background: "#1C1C1E" }}
    >
      <div className="flex items-center px-3 py-2.5 gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              {change != null && change > 0 && <TrendingUp className="w-3 h-3 shrink-0" style={{ color: "#22c55e" }} />}
              {change != null && change < 0 && <TrendingDown className="w-3 h-3 shrink-0" style={{ color: "#ef4444" }} />}
              {(change == null || change === 0) && <Minus className="w-3 h-3 shrink-0" style={{ color: "#71717a" }} />}
              <span className="font-mono text-xs font-bold text-white tracking-wider">{sym}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-1">
            {spark && spark.closes.length > 1 && (
              <MiniSparkline data={spark.closes} color={cColor} width={48} height={16} />
            )}
            <div className="flex items-center gap-2 font-mono text-[9px]">
              <span style={{ color: cColor }}>{fmtChange(change)}</span>
              <span className="px-1 py-0.5 rounded" style={{ background: `${cColor}15`, color: cColor }}>
                {fmtPct(changePct)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className="font-mono text-sm font-bold tabular-nums px-2 py-0.5 rounded"
            style={{
              color: hasData ? "#fff" : "#52525b",
              background: hasData ? `${cColor}18` : "transparent",
              border: hasData ? `1px solid ${cColor}30` : "none",
            }}
          >
            {hasData ? `$${fmtPrice(last)}` : "—"}
          </span>
          <span className="font-mono text-[9px] text-[#52525b] tabular-nums">
            VOL {fmtVol(volume)}
          </span>
        </div>

        <ChevronRight className="w-3.5 h-3.5 text-[#3a3a3c] group-hover:text-[#71717a] transition-colors shrink-0" />
      </div>

      <div className="flex items-center gap-3 px-3 pb-2">
        <div className="flex-1">
          <DayRangeBar low={low} high={high} last={last} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="font-mono text-[8px] text-[#52525b]">
            <span className="text-[#22c55e]/70">{bid != null ? bid.toFixed(2) : "—"}</span>
            <span className="mx-0.5">×</span>
            <span className="text-[#ef4444]/70">{ask != null ? ask.toFixed(2) : "—"}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="p-1 rounded text-[#3a3a3c] hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ColumnHeader({
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
      className="flex items-center gap-0.5 font-mono text-[8px] uppercase tracking-widest transition-colors"
      style={{ color: active ? "#FFB800" : "#52525b" }}
    >
      {label}
      {active && (
        <span className="text-[7px]">{currentDir === "asc" ? "▲" : "▼"}</span>
      )}
    </button>
  );
}

export function WatchlistView() {
  const { watchlist, removeFromWatchlist, setSymbol, streamPrices, accessToken, streamStatus } = useTerminalStore();
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
      } catch {
      }
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
        case "symbol":
          cmp = a.localeCompare(b);
          break;
        case "last":
          cmp = (qa?.last ?? 0) - (qb?.last ?? 0);
          break;
        case "change":
          cmp = (qa?.change ?? 0) - (qb?.change ?? 0);
          break;
        case "changePct":
          cmp = (qa?.changePct ?? 0) - (qb?.changePct ?? 0);
          break;
        case "volume":
          cmp = (qa?.volume ?? 0) - (qb?.volume ?? 0);
          break;
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
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4" style={{ color: "#FFB800" }} />
            <h2 className="font-mono text-sm font-bold tracking-wider" style={{ color: "#e4e4e7" }}>WATCHLIST</h2>
            <span
              className="font-mono text-[9px] px-1.5 py-0.5 rounded"
              style={{ background: "#FFB800" + "15", color: "#FFB800", border: `1px solid #FFB80030` }}
            >
              {watchlist.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {streamStatus === "live" ? (
              <div className="flex items-center gap-1">
                <Wifi className="w-3 h-3 text-[#22c55e]" />
                <span className="font-mono text-[8px] text-[#22c55e] uppercase">Live</span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <WifiOff className="w-3 h-3 text-[#71717a]" />
                <span className="font-mono text-[8px] text-[#71717a] uppercase">{streamStatus}</span>
              </div>
            )}
          </div>
        </div>

        {watchlist.length > 0 && (
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#22c55e" }} />
              <span className="font-mono text-[9px] text-[#71717a]">{gainers} up</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#ef4444" }} />
              <span className="font-mono text-[9px] text-[#71717a]">{losers} down</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#71717a" }} />
              <span className="font-mono text-[9px] text-[#71717a]">{unchanged} flat</span>
            </div>
          </div>
        )}
      </div>

      {watchlist.length > 0 && (
        <div className="flex items-center justify-between px-4 pb-2 border-b border-[#2A2A2C]">
          <ColumnHeader label="Symbol" sortKey="symbol" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
          <div className="flex items-center gap-4">
            <ColumnHeader label="Chg" sortKey="change" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
            <ColumnHeader label="Chg%" sortKey="changePct" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
            <ColumnHeader label="Vol" sortKey="volume" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
            <ColumnHeader label="Price" sortKey="last" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {watchlist.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "#FFB800" + "10", border: `1px solid #FFB80020` }}>
                <ListOrdered className="w-7 h-7" style={{ color: "#FFB800" + "40" }} />
              </div>
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#2A2A2C", border: "1px solid #3a3a3c" }}>
                <Plus className="w-3 h-3 text-[#71717a]" />
              </div>
            </div>
            <div className="text-center">
              <p className="font-mono text-xs text-[#a1a1aa] mb-1">No symbols watched</p>
              <p className="font-mono text-[10px] text-[#52525b] leading-relaxed">
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

      {watchlist.length > 0 && (
        <div className="px-4 py-2 border-t border-[#2A2A2C] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-[#52525b]" />
            <span className="font-mono text-[8px] text-[#52525b] uppercase tracking-wider">
              {watchlist.length} instrument{watchlist.length !== 1 ? "s" : ""} tracked
            </span>
          </div>
          <div className="flex items-center gap-1">
            <BarChart3 className="w-3 h-3 text-[#52525b]" />
            <span className="font-mono text-[8px] text-[#52525b]">WebSocket</span>
          </div>
        </div>
      )}
    </div>
  );
}
