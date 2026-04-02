import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useOptionsColumnsStore, COLUMN_REGISTRY, type ColumnDef } from "@/lib/options-columns-store";
import { useOptionsStreamStore, useOptionTick } from "@/lib/options-stream-store";
import { useGetQuote, useGetOptionChain } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table2, ChevronDown, ChevronUp, X, Settings, GripVertical } from "lucide-react";
import { Reorder } from "framer-motion";

const EPS = 0.0001;
const COL_W = 72;
const STRIKE_W = 56;
const ROW_H = 40;
const HEADER_H = 36;
const SUB_HEADER_H = 22;
const STICKY_TOP = HEADER_H + SUB_HEADER_H;
const BG = "#1C1C1E";
const BORDER = "#2A2A2C";

interface Contract {
  strike: number;
  expiration: string;
  schwabSymbol?: string;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  dte?: number;
  streamKey?: string;
}

interface NormalizedRow {
  strike: number;
  call: Contract | null;
  put: Contract | null;
}

interface ExpirationGroup {
  expiration: string;
  dte: number;
  dateLabel: string;
  rows: NormalizedRow[];
  totalStrikes: number;
  isWeekly: boolean;
  atmIV: number | null;
  expectedMove: number | null;
}

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function parseExpDate(expStr: string): Date | null {
  if (!expStr) return null;
  const clean = expStr.split(":")[0].trim();
  const iso = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]), 12, 0, 0);
  }
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

function formatExpDate(expStr: string): string {
  const d = parseExpDate(expStr);
  if (!d) return expStr || "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

function isWeeklyExp(expStr: string): boolean {
  const d = parseExpDate(expStr);
  if (!d) return false;
  if (d.getDay() !== 5) return true;
  const date = d.getDate();
  return !(date >= 15 && date <= 21);
}

function findATMIndex(strikes: number[], lastPrice: number): number {
  if (strikes.length === 0) return -1;
  let best = 0;
  let bestDiff = Math.abs(strikes[0] - lastPrice);
  for (let i = 1; i < strikes.length; i++) {
    const diff = Math.abs(strikes[i] - lastPrice);
    if (diff < bestDiff || (diff === bestDiff && strikes[i] < strikes[best])) {
      best = i;
      bestDiff = diff;
    }
  }
  return best;
}


function buildExpirationGroups(
  calls: Contract[], puts: Contract[], lastPrice: number | null
): ExpirationGroup[] {
  const expMap = new Map<string, { calls: Map<number, Contract>; puts: Map<number, Contract>; dte: number }>();
  for (const c of calls) {
    if (!expMap.has(c.expiration)) expMap.set(c.expiration, { calls: new Map(), puts: new Map(), dte: c.dte ?? 0 });
    expMap.get(c.expiration)!.calls.set(c.strike, c);
  }
  for (const p of puts) {
    if (!expMap.has(p.expiration)) expMap.set(p.expiration, { calls: new Map(), puts: new Map(), dte: p.dte ?? 0 });
    expMap.get(p.expiration)!.puts.set(p.strike, p);
  }
  const groups: ExpirationGroup[] = [];
  for (const [exp, { calls: callMap, puts: putMap, dte }] of expMap) {
    const allStrikes = [...new Set([...callMap.keys(), ...putMap.keys()])].sort((a, b) => a - b);
    const totalStrikes = allStrikes.length;
    const atmIdx = lastPrice != null ? findATMIndex(allStrikes, lastPrice) : -1;
    const normalizedRows: NormalizedRow[] = allStrikes.map((strike) => ({
      strike, call: callMap.get(strike) ?? null, put: putMap.get(strike) ?? null,
    }));

    let atmIV: number | null = null;
    let expectedMove: number | null = null;
    if (atmIdx >= 0 && lastPrice != null) {
      const atmRow = normalizedRows[atmIdx];
      const callIV = atmRow?.call?.iv;
      const putIV = atmRow?.put?.iv;
      const ivValues = [callIV, putIV].filter((v): v is number => v != null && !isNaN(v));
      if (ivValues.length > 0) {
        atmIV = ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
        expectedMove = lastPrice * (atmIV / 100) * Math.sqrt(Math.max(dte, 1) / 365);
      }
    }

    groups.push({
      expiration: exp,
      dte,
      dateLabel: formatExpDate(exp),
      rows: normalizedRows,
      totalStrikes,
      isWeekly: isWeeklyExp(exp),
      atmIV,
      expectedMove,
    });
  }
  groups.sort((a, b) => a.dte - b.dte);
  return groups;
}

function getContractVal(contract: Contract | null, key: string): number | undefined {
  if (!contract) return undefined;
  return (contract as unknown as Record<string, unknown>)[key] as number | undefined;
}

function fmtNum(val: number | undefined, decimals: number): string {
  if (val == null || isNaN(val) || val <= -999) return "—";
  return decimals === 0 ? String(Math.round(val)) : val.toFixed(decimals);
}

const noScrollbar: React.CSSProperties = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
  WebkitOverflowScrolling: "touch",
  scrollSnapType: "none",
};

const STREAM_KEY_MAP: Record<string, string> = {
  bid: "bid", ask: "ask", last: "last",
  bidSize: "bidSize", askSize: "askSize",
  volume: "volume", openInterest: "openInterest",
  iv: "iv", delta: "delta", gamma: "gamma",
  theta: "theta", vega: "vega",
};

function getStreamVal(tick: ReturnType<typeof useOptionTick>, key: string): number | undefined {
  if (!tick) return undefined;
  const mapped = STREAM_KEY_MAP[key];
  if (!mapped) return undefined;
  const v = (tick as unknown as Record<string, unknown>)[mapped];
  return typeof v === "number" && !isNaN(v) ? v : undefined;
}

const DataCell = memo(function DataCell({ col, contract }: { col: ColumnDef; contract: Contract | null }) {
  const tick = useOptionTick(contract?.streamKey);

  const topVal = getStreamVal(tick, col.topKey) ?? getContractVal(contract, col.topKey);
  const bottomVal = col.bottomKey
    ? (getStreamVal(tick, col.bottomKey) ?? getContractVal(contract, col.bottomKey))
    : undefined;
  const topStr = fmtNum(topVal, col.topDecimals);
  const botStr = col.bottomKey ? fmtNum(bottomVal, col.bottomDecimals ?? 0) : null;

  const inner = (
    <div className="flex flex-col justify-center px-1.5" style={{ height: ROW_H }}>
      <span className={`text-[13px] font-bold leading-none ${topStr === "—" ? "text-zinc-600" : "text-white"}`}>
        {topStr}
      </span>
      {botStr != null && (
        <span className={`text-[9px] leading-none mt-0.5 ${botStr === "—" ? "text-zinc-700" : "text-zinc-500"}`}>
          {col.bottomLabel ? `${col.bottomLabel}: ${botStr}` : botStr}
        </span>
      )}
    </div>
  );

  if (col.isPrice) {
    return (
      <button
        className="w-full text-left hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors cursor-pointer"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {inner}
      </button>
    );
  }

  return <div style={{ fontVariantNumeric: "tabular-nums" }}>{inner}</div>;
});

function ColumnsEditorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeColumnIds, toggleColumn, reorderColumns } = useOptionsColumnsStore();
  const [localOrder, setLocalOrder] = useState(activeColumnIds);

  useEffect(() => {
    if (open) setLocalOrder(activeColumnIds);
  }, [open, activeColumnIds]);

  const handleReorder = (newOrder: string[]) => {
    setLocalOrder(newOrder);
    reorderColumns(newOrder);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative border rounded-t-xl sm:rounded-xl w-full sm:max-w-sm mx-auto p-4 z-10"
        style={{ backgroundColor: BG, borderColor: BORDER }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-mono text-sm font-bold text-white tracking-wider">COLUMNS</span>
          <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-white hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <Reorder.Group axis="y" values={localOrder} onReorder={handleReorder} className="space-y-1.5">
          {localOrder.map(id => {
            const col = COLUMN_REGISTRY.find(c => c.id === id);
            if (!col) return null;
            return (
              <Reorder.Item
                key={id}
                value={id}
                style={{ touchAction: "none" }}
                whileDrag={{ scale: 1.03, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
                className="cursor-grab active:cursor-grabbing"
              >
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-[#FFB800]/30 text-white select-none" style={{ backgroundColor: '#252528' }}>
                  <span className="font-mono text-sm font-medium">{col.label}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleColumn(id); setLocalOrder(prev => prev.filter(x => x !== id)); }}
                      className={`w-9 h-5 rounded-full flex items-center transition-colors bg-[#FFB800] justify-end ${activeColumnIds.length <= 1 ? "opacity-40" : ""}`}
                      disabled={activeColumnIds.length <= 1}
                    >
                      <div className="w-4 h-4 rounded-full bg-white mx-0.5 shadow-sm" />
                    </button>
                    <GripVertical className="w-4 h-4 text-zinc-400" />
                  </div>
                </div>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>

        <div className="mt-3 space-y-1.5">
          {COLUMN_REGISTRY.filter(c => !localOrder.includes(c.id)).map(col => (
            <button
              key={col.id}
              onClick={() => { toggleColumn(col.id); setLocalOrder(prev => [...prev, col.id]); }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-zinc-500 hover:text-zinc-300 transition-colors"
              style={{ backgroundColor: '#111113', borderColor: BORDER }}
            >
              <span className="font-mono text-sm font-medium">{col.label}</span>
              <div className="w-9 h-5 rounded-full flex items-center transition-colors justify-start" style={{ backgroundColor: BORDER }}>
                <div className="w-4 h-4 rounded-full bg-white mx-0.5 shadow-sm" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricsStrip({ groups, lastPrice, rawCalls, rawPuts, earningsDate, strikeControls, isFetching, hasData }: {
  groups: ExpirationGroup[];
  lastPrice: number | null;
  rawCalls: Contract[];
  rawPuts: Contract[];
  earningsDate?: string | null;
  strikeControls: React.ReactNode;
  isFetching: boolean;
  hasData: boolean;
}) {
  const frontMonth = groups.length > 0 ? groups[0] : null;
  const atmIV = frontMonth?.atmIV ?? null;
  const expectedMove = frontMonth?.expectedMove ?? null;

  const ivDisplay = atmIV != null ? atmIV.toFixed(1) + "%" : "—";
  const moveDisplay = expectedMove != null && lastPrice != null
    ? "±$" + expectedMove.toFixed(2)
    : "—";

  const totalCallVol = rawCalls.reduce((sum, c) => sum + (c.volume ?? 0), 0);
  const totalPutVol = rawPuts.reduce((sum, p) => sum + (p.volume ?? 0), 0);
  const pcr = totalCallVol > 0 ? (totalPutVol / totalCallVol).toFixed(2) : "—";

  let earnDisplay = "TBD";
  if (earningsDate) {
    const d = new Date(earningsDate);
    if (!isNaN(d.getTime())) {
      earnDisplay = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  return (
    <div
      className="flex items-center justify-between w-full px-3 py-1.5 shrink-0 font-mono"
      style={{ fontVariantNumeric: "tabular-nums", backgroundColor: "black", borderBottom: `1px solid ${BORDER}` }}
    >
      <div className="flex items-center gap-3">
        {strikeControls}
        {isFetching && hasData && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 border border-[#FFB800] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <div className="flex gap-4 text-xs font-medium text-zinc-400 items-center shrink-0">
        <span><span className="text-zinc-500">IV</span> <span className={atmIV != null ? "text-white" : "text-zinc-600"}>{ivDisplay}</span></span>
        <span><span className="text-zinc-500">MOVE</span> <span className={expectedMove != null ? "text-white" : "text-zinc-600"}>{moveDisplay}</span></span>
        <span><span className="text-zinc-500">P/C</span> <span className={pcr !== "—" ? (Number(pcr) > 1 ? "text-[#f23645]" : "text-[#00d166]") : "text-zinc-600"}>{pcr}</span></span>
        <span><span className="text-zinc-500">Earn</span> <span className="text-white">{earnDisplay}</span></span>
      </div>
    </div>
  );
}

function useScrollSync() {
  const scrollXRef = useRef(0);
  const isSyncing = useRef(false);
  const wingsRef = useRef<Set<HTMLDivElement>>(new Set());

  const broadcast = useCallback((sourceScrollLeft: number, source: HTMLDivElement) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    scrollXRef.current = sourceScrollLeft;
    requestAnimationFrame(() => {
      for (const t of wingsRef.current) {
        if (t !== source) t.scrollLeft = sourceScrollLeft;
      }
      isSyncing.current = false;
    });
  }, []);

  const registerWing = useCallback((el: HTMLDivElement) => {
    wingsRef.current.add(el);
    el.scrollLeft = scrollXRef.current;
    const handler = () => broadcast(el.scrollLeft, el);
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      wingsRef.current.delete(el);
      el.removeEventListener("scroll", handler);
    };
  }, [broadcast]);

  return { registerWing };
}

function OptionsGrid({
  rows,
  underlyingPrice,
  columns,
  showCalls,
  showPuts,
  registerWing,
}: {
  rows: NormalizedRow[];
  underlyingPrice: number | null;
  columns: ColumnDef[];
  showCalls: boolean;
  showPuts: boolean;
  registerWing: (el: HTMLDivElement) => () => void;
}) {
  const leftBodyRef = useRef<HTMLDivElement>(null);
  const rightBodyRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => a.strike - b.strike), [rows]);

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_H,
    overscan: 5,
  });

  const transitionIdx = useMemo(() => {
    if (underlyingPrice == null) return -1;
    return sortedRows.findIndex(r => r.strike > underlyingPrice + EPS);
  }, [sortedRows, underlyingPrice]);

  const priceAboveAll = useMemo(() => {
    if (underlyingPrice == null || sortedRows.length === 0) return false;
    return underlyingPrice > sortedRows[sortedRows.length - 1].strike + EPS;
  }, [underlyingPrice, sortedRows]);

  const wingWidth = columns.length * COL_W;

  const atmLineTop = useMemo(() => {
    if (transitionIdx >= 0) return transitionIdx * ROW_H;
    if (priceAboveAll && sortedRows.length > 0) return sortedRows.length * ROW_H;
    return -1;
  }, [transitionIdx, priceAboveAll, sortedRows.length]);

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    if (leftBodyRef.current) cleanups.push(registerWing(leftBodyRef.current));
    if (rightBodyRef.current) cleanups.push(registerWing(rightBodyRef.current));
    return () => cleanups.forEach(fn => fn());
  }, [registerWing, showCalls, showPuts]);

  const totalHeight = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={scrollContainerRef} className="relative" style={{ height: sortedRows.length * ROW_H, overflow: "hidden" }}>
      <div className="flex font-mono" style={{ fontVariantNumeric: "tabular-nums", height: totalHeight, position: "relative" }}>
        {atmLineTop >= 0 && (
          <div
            className="absolute left-0 right-0 z-[5] pointer-events-none"
            style={{ top: atmLineTop, borderTop: "1.5px dashed #FF6B2B" }}
          />
        )}

        {showCalls && (
          <div
            ref={leftBodyRef}
            className="flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
            style={noScrollbar}
          >
            <div style={{ minWidth: wingWidth, height: totalHeight, position: "relative" }}>
              {virtualItems.map((virtualRow) => {
                const row = sortedRows[virtualRow.index];
                const callITM = underlyingPrice != null && row.strike < underlyingPrice - EPS;
                return (
                  <div
                    key={row.strike}
                    className={`flex border-b hover:bg-white/[0.03] transition-colors ${callITM ? "bg-[#1e293b]/60" : ""}`}
                    style={{ height: ROW_H, borderColor: BORDER, position: "absolute", top: virtualRow.start, width: "100%" }}
                  >
                    {columns.map(col => (
                      <div key={col.id} style={{ width: COL_W }} className="shrink-0">
                        <DataCell col={col} contract={row.call} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex-none z-10" style={{ width: STRIKE_W, backgroundColor: '#151517', borderLeft: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}`, position: "relative" }}>
          {virtualItems.map((virtualRow) => {
            const row = sortedRows[virtualRow.index];
            const isATMStrike = underlyingPrice != null && Math.abs(row.strike - underlyingPrice) <= EPS;
            return (
              <div
                key={row.strike}
                className={`flex items-center justify-center text-[12px] font-bold border-b ${isATMStrike ? "text-[#FFB800]" : "text-zinc-300"}`}
                style={{ height: ROW_H, fontVariantNumeric: "tabular-nums", borderColor: BORDER, position: "absolute", top: virtualRow.start, width: "100%" }}
              >
                {row.strike % 1 === 0 ? row.strike : row.strike.toFixed(1)}
              </div>
            );
          })}
        </div>

        {showPuts && (
          <div
            ref={rightBodyRef}
            className="flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
            style={noScrollbar}
          >
            <div style={{ minWidth: wingWidth, height: totalHeight, position: "relative" }}>
              {virtualItems.map((virtualRow) => {
                const row = sortedRows[virtualRow.index];
                const putITM = underlyingPrice != null && row.strike > underlyingPrice + EPS;
                return (
                  <div
                    key={row.strike}
                    className={`flex border-b hover:bg-white/[0.03] transition-colors ${putITM ? "bg-[#1e293b]/60" : ""}`}
                    style={{ height: ROW_H, borderColor: BORDER, position: "absolute", top: virtualRow.start, width: "100%" }}
                  >
                    {columns.map(col => (
                      <div key={col.id} style={{ width: COL_W }} className="shrink-0">
                        <DataCell col={col} contract={row.put} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function buildSchwabOptionKey(underlying: string, expiration: string, strike: number, type: "C" | "P"): string {
  const d = parseExpDate(expiration);
  if (!d) return "";
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  const sym = underlying.toUpperCase().padEnd(6, " ");
  return `${sym}${yy}${mm}${dd}${type}${strikePadded}`;
}

interface OptionsTabProps {
  subscribeOptionSymbols?: (symbols: string[]) => Promise<void>;
}

export function OptionsTab({ subscribeOptionSymbols }: OptionsTabProps) {
  const { symbol, accessToken } = useTerminalStore();
  const { contractType, strikeCount, maxDte, customStrikeInput, setCustomStrikeInput } = useOptionsSettingsStore();
  const setStrikeCount = useOptionsSettingsStore(s => s.setStrikeCount);
  const { activeColumnIds } = useOptionsColumnsStore();
  const [columnsEditorOpen, setColumnsEditorOpen] = useState(false);

  const activeColumns = useMemo(
    () => activeColumnIds.map(id => COLUMN_REGISTRY.find(c => c.id === id)).filter(Boolean) as ColumnDef[],
    [activeColumnIds]
  );

  const wingWidth = activeColumns.length * COL_W;

  const [expandedExps, setExpandedExps] = useState<Set<string>>(new Set());
  const [isCustomMode, setIsCustomMode] = useState(() => ![6, 10, 20].includes(strikeCount));
  const [localCustomValue, setLocalCustomValue] = useState(String(strikeCount));
  const strikeMode = useMemo(() => {
    if ([6, 10, 20].includes(strikeCount)) return String(strikeCount);
    return "custom";
  }, [strikeCount]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: rawData, isLoading, error, isFetching } = useGetOptionChain(
    { symbol, accessToken: accessToken || "", contractType: "ALL", strikeCount },
    { query: { enabled: !!accessToken && !!symbol, staleTime: 25_000, gcTime: 60_000 } }
  );

  const data = useMemo(() => {
    if (!rawData) return rawData;
    const allCalls = (rawData.calls ?? []) as Contract[];
    const allPuts = (rawData.puts ?? []) as Contract[];
    let calls = allCalls;
    let puts = allPuts;

    if (maxDte > 0) {
      calls = calls.filter(c => (c.dte ?? 0) <= maxDte);
      puts = puts.filter(p => (p.dte ?? 0) <= maxDte);
    }

    if (contractType === "CALL") puts = [];
    else if (contractType === "PUT") calls = [];

    return { ...rawData, calls, puts };
  }, [rawData, maxDte, contractType]);

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );

  const { data: earningsData } = useQuery({
    queryKey: ["earnings-date", symbol],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/market/earnings-date?symbol=${encodeURIComponent(symbol)}`);
      return res.json() as Promise<{ earningsDate?: string | null }>;
    },
    enabled: !!symbol,
    staleTime: 30 * 60 * 1000,
  });

  const underlyingPrice = quote?.last ?? (data as unknown as { underlyingPrice?: number })?.underlyingPrice ?? null;

  const groups = useMemo(() => {
    if (!data) return [];
    const calls = (data.calls ?? []) as Contract[];
    const puts = (data.puts ?? []) as Contract[];
    calls.forEach(c => { c.streamKey = c.schwabSymbol || buildSchwabOptionKey(symbol, c.expiration, c.strike, "C"); });
    puts.forEach(c => { c.streamKey = c.schwabSymbol || buildSchwabOptionKey(symbol, c.expiration, c.strike, "P"); });
    return buildExpirationGroups(calls, puts, underlyingPrice);
  }, [data, underlyingPrice, symbol]);

  useEffect(() => {
    if (groups.length > 0 && expandedExps.size === 0) {
      setExpandedExps(new Set([groups[0].expiration]));
    }
  }, [groups]);

  useEffect(() => {
    if (!subscribeOptionSymbols || groups.length === 0) return;
    const keys: string[] = [];
    for (const g of groups) {
      for (const row of g.rows) {
        if (row.call?.streamKey) keys.push(row.call.streamKey);
        if (row.put?.streamKey) keys.push(row.put.streamKey);
      }
    }
    if (keys.length > 0) {
      void subscribeOptionSymbols(keys);
    }
  }, [groups, subscribeOptionSymbols]);

  useEffect(() => { setExpandedExps(new Set()); }, [symbol]);

  const toggleExp = (exp: string) => {
    setExpandedExps(prev => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp); else next.add(exp);
      return next;
    });
  };

  const handleStrikeModeChange = useCallback((val: string) => {
    if (val === "custom") { setLocalCustomValue(String(strikeCount)); setIsCustomMode(true); return; }
    setIsCustomMode(false);
    const n = parseInt(val);
    if (!isNaN(n) && n > 0) setStrikeCount(n);
  }, [setStrikeCount, strikeCount]);

  const handleCustomStrikeChange = useCallback((raw: string) => {
    setLocalCustomValue(raw);
    setCustomStrikeInput(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (raw === "") return;
    debounceRef.current = setTimeout(() => {
      const n = parseInt(raw);
      if (!isNaN(n) && n >= 2 && n <= 100) setStrikeCount(n);
    }, 400);
  }, [setCustomStrikeInput, setStrikeCount]);

  const handleExitCustomMode = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setIsCustomMode(false);
    if (![6, 10, 20].includes(strikeCount)) setStrikeCount(10);
  }, [strikeCount, setStrikeCount]);

  useEffect(() => { return () => { if (debounceRef.current) clearTimeout(debounceRef.current); }; }, []);

  const showCalls = contractType !== "PUT";
  const showPuts = contractType !== "CALL";

  const { registerWing } = useScrollSync();

  const subHeaderLeftRef = useRef<HTMLDivElement>(null);
  const subHeaderRightRef = useRef<HTMLDivElement>(null);

  const hasData = data && groups.length > 0;

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    if (subHeaderLeftRef.current) cleanups.push(registerWing(subHeaderLeftRef.current));
    if (subHeaderRightRef.current) cleanups.push(registerWing(subHeaderRightRef.current));
    return () => cleanups.forEach(fn => fn());
  }, [registerWing, showCalls, showPuts, hasData]);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: BG }}>
      <MetricsStrip
        groups={groups}
        lastPrice={underlyingPrice}
        rawCalls={(data?.calls ?? []) as Contract[]}
        rawPuts={(data?.puts ?? []) as Contract[]}
        earningsDate={earningsData?.earningsDate ?? quote?.nextEarningsDate}
        isFetching={isFetching}
        hasData={!!data}
        strikeControls={
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">Strikes</span>
            {isCustomMode ? (
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={2} max={100} autoFocus
                  value={localCustomValue}
                  onChange={e => handleCustomStrikeChange(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") handleExitCustomMode(); }}
                  className="w-[70px] font-mono text-[11px] h-7 px-2 bg-zinc-900 border border-zinc-700 rounded-md text-white"
                  placeholder="10"
                />
                <button onClick={handleExitCustomMode} className="p-0.5 rounded text-zinc-500 hover:text-white hover:bg-white/10 transition-colors" aria-label="Exit custom mode">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <Select value={strikeMode} onValueChange={handleStrikeModeChange}>
                <SelectTrigger className="w-[70px] font-mono text-[11px] h-7 px-2 bg-zinc-900 border border-zinc-700 rounded-md text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto min-h-0 relative overscroll-y-contain" style={{ WebkitOverflowScrolling: "touch", backgroundColor: BG } as React.CSSProperties}>
        {isLoading && !data && (
          <div className="p-4 space-y-1.5">
            {Array.from({ length: strikeCount }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" style={{ backgroundColor: '#252528' }} />
            ))}
          </div>
        )}

        {isFetching && data && (
          <div className="absolute inset-0 z-40 pointer-events-none" style={{ backgroundColor: 'rgba(28,28,30,0.3)' }} />
        )}

        {error && !data && (
          <div className="p-10 text-center text-red-400 font-mono flex flex-col items-center">
            <span className="text-3xl mb-3">⚠</span>
            <span className="text-xs">FAILED TO LOAD OPTIONS DATA.</span>
          </div>
        )}

        {!isLoading && !error && !data && !accessToken && (
          <div className="p-16 flex flex-col items-center justify-center text-zinc-500 font-mono h-full">
            <Table2 className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-xs">CONNECT SCHWAB TO VIEW OPTIONS CHAIN.</span>
          </div>
        )}

        {!isLoading && !error && !data && accessToken && (
          <div className="p-16 flex flex-col items-center justify-center text-zinc-500 font-mono h-full">
            <Table2 className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-xs">LOADING OPTIONS CHAIN...</span>
          </div>
        )}

        {hasData && (
          <>
            <div
              className="w-full flex items-center sticky top-0 z-30 font-mono"
              style={{ height: HEADER_H, backgroundColor: BG, borderBottom: `1px solid ${BORDER}` }}
            >
              {showCalls && (
                <div className="flex-1 text-center">
                  <span className="text-[12px] font-extrabold uppercase text-white tracking-widest">CALLS</span>
                </div>
              )}
              <div
                className="flex items-center justify-center"
                style={{ width: STRIKE_W, borderLeft: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}` }}
              >
                <button
                  onClick={() => setColumnsEditorOpen(true)}
                  className="flex items-center justify-center text-white hover:text-[#FFB800] transition-colors"
                  style={{ width: STRIKE_W, height: HEADER_H }}
                  aria-label="Edit columns"
                >
                  <Settings className="w-5 h-5" />
                </button>
              </div>
              {showPuts && (
                <div className="flex-1 text-center">
                  <span className="text-[12px] font-extrabold uppercase text-white tracking-widest">PUTS</span>
                </div>
              )}
            </div>

            <div
              className="w-full flex items-center sticky z-20 font-mono"
              style={{ top: HEADER_H, height: SUB_HEADER_H, backgroundColor: BG, borderBottom: `1px solid ${BORDER}` }}
            >
              {showCalls && (
                <div
                  ref={subHeaderLeftRef}
                  className="flex-1 overflow-x-auto overflow-y-hidden"
                  style={noScrollbar}
                >
                  <div className="flex items-center" style={{ minWidth: wingWidth, height: SUB_HEADER_H }}>
                    {activeColumns.map(col => (
                      <div key={col.id} style={{ width: COL_W }} className="shrink-0 flex items-center px-1.5">
                        <span className="text-[10px] text-zinc-400 font-medium">{col.topLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div
                className="flex-none flex items-center justify-center"
                style={{ width: STRIKE_W, borderLeft: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}` }}
              >
                <span className="text-[10px] text-zinc-400 font-medium">Strike</span>
              </div>
              {showPuts && (
                <div
                  ref={subHeaderRightRef}
                  className="flex-1 overflow-x-auto overflow-y-hidden"
                  style={noScrollbar}
                >
                  <div className="flex items-center" style={{ minWidth: wingWidth, height: SUB_HEADER_H }}>
                    {activeColumns.map(col => (
                      <div key={col.id} style={{ width: COL_W }} className="shrink-0 flex items-center px-1.5">
                        <span className="text-[10px] text-zinc-400 font-medium">{col.topLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              {groups.map(group => {
                const isOpen = expandedExps.has(group.expiration);
                return (
                  <div key={group.expiration}>
                    <button
                      onClick={() => toggleExp(group.expiration)}
                      className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.03] transition-colors sticky z-20"
                      style={{ top: STICKY_TOP, backgroundColor: BG, borderBottom: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-1.5 font-mono">
                        {isOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                          : <ChevronUp className="w-3.5 h-3.5 text-zinc-400 -rotate-90" />
                        }
                        <span className="text-[11px] font-bold text-white tracking-wide">
                          {group.dateLabel}
                        </span>
                        <span className="text-[11px] text-white font-medium">
                          ({Math.round(group.dte)} DTE)
                        </span>
                        <span className="text-[11px] text-zinc-300">
                          100
                        </span>
                        {group.isWeekly && (
                          <span className="text-[11px] text-[#FF6B2B] font-medium">Weeklys</span>
                        )}
                      </div>
                      <div className="font-mono text-[11px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {group.atmIV != null ? (
                          <span className="text-zinc-300">
                            {group.atmIV.toFixed(2)}%
                            {group.expectedMove != null && (
                              <span className="text-zinc-500 ml-1">
                                (±{group.expectedMove.toFixed(3)})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <OptionsGrid
                        rows={group.rows}
                        underlyingPrice={underlyingPrice}
                        columns={activeColumns}
                        showCalls={showCalls}
                        showPuts={showPuts}
                        registerWing={registerWing}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {data && groups.length === 0 && (
          <div className="p-16 flex flex-col items-center justify-center text-zinc-500 font-mono h-full">
            <Table2 className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-xs">NO OPTIONS DATA AVAILABLE FOR THIS RANGE.</span>
          </div>
        )}
      </div>

      <ColumnsEditorModal open={columnsEditorOpen} onClose={() => setColumnsEditorOpen(false)} />
    </div>
  );
}
