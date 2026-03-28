import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { useOptionsColumnsStore, COLUMN_REGISTRY, type ColumnDef } from "@/lib/options-columns-store";
import { useGetQuote, useGetOptionChain } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table2, ChevronDown, ChevronUp, X, Settings, GripVertical } from "lucide-react";
import { Reorder } from "framer-motion";

const EPS = 0.0001;
const COL_W = 72;
const STRIKE_W = 64;
const ROW_H = 56;
const HEADER_H = 44;
const SUB_HEADER_H = 28;
const STICKY_TOP = HEADER_H + SUB_HEADER_H;
const BG = "#1C1C1E";
const BORDER = "#2A2A2C";

interface Contract {
  strike: number;
  expiration: string;
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

function formatExpDate(expStr: string): string {
  try {
    const d = new Date(expStr + "T12:00:00");
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    return `${d.getDate()} ${months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  } catch {
    return expStr;
  }
}

function isWeeklyExp(expStr: string): boolean {
  try {
    const d = new Date(expStr + "T12:00:00");
    if (d.getDay() !== 5) return true;
    const date = d.getDate();
    return !(date >= 15 && date <= 21);
  } catch {
    return false;
  }
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

function sliceAroundATM(rows: NormalizedRow[], atmIdx: number, count: number): NormalizedRow[] {
  if (count <= 0 || rows.length === 0) return rows;
  const half = Math.floor(count / 2);
  let start = atmIdx - half;
  let end = atmIdx + half + 1;
  if (start < 0) { end = Math.min(rows.length, end - start); start = 0; }
  if (end > rows.length) { start = Math.max(0, start - (end - rows.length)); end = rows.length; }
  return rows.slice(start, end);
}

function buildExpirationGroups(
  calls: Contract[], puts: Contract[], lastPrice: number | null, strikeCount: number
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
    let normalizedRows: NormalizedRow[] = allStrikes.map((strike) => ({
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

    if (strikeCount > 0 && atmIdx >= 0 && normalizedRows.length > strikeCount) {
      normalizedRows = sliceAroundATM(normalizedRows, atmIdx, strikeCount);
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
  if (val == null || isNaN(val)) return "—";
  return decimals === 0 ? String(Math.round(val)) : val.toFixed(decimals);
}

const noScrollbar: React.CSSProperties = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
  WebkitOverflowScrolling: "touch",
  scrollSnapType: "none",
};

function DataCell({ col, contract }: { col: ColumnDef; contract: Contract | null }) {
  const topVal = getContractVal(contract, col.topKey);
  const bottomVal = col.bottomKey ? getContractVal(contract, col.bottomKey) : undefined;
  const topStr = fmtNum(topVal, col.topDecimals);
  const botStr = col.bottomKey ? fmtNum(bottomVal, col.bottomDecimals ?? 0) : null;

  const inner = (
    <div className="flex flex-col justify-center px-2" style={{ height: ROW_H }}>
      <span className={`text-[13px] font-medium leading-tight ${topStr === "—" ? "text-zinc-600" : "text-zinc-100"}`}>
        {topStr}
      </span>
      {botStr != null && (
        <span className={`text-[10px] leading-tight mt-0.5 ${botStr === "—" ? "text-zinc-700" : "text-zinc-500"}`}>
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
}

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
              <Reorder.Item key={id} value={id} className="cursor-grab active:cursor-grabbing">
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-[#FFB800]/30 text-white" style={{ backgroundColor: '#252528' }}>
                  <span className="font-mono text-sm font-medium">{col.label}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleColumn(id); setLocalOrder(prev => prev.filter(x => x !== id)); }}
                      className={`w-9 h-5 rounded-full flex items-center transition-colors bg-[#FFB800] justify-end ${activeColumnIds.length <= 1 ? "opacity-40" : ""}`}
                      disabled={activeColumnIds.length <= 1}
                    >
                      <div className="w-4 h-4 rounded-full bg-white mx-0.5 shadow-sm" />
                    </button>
                    <GripVertical className="w-4 h-4 text-zinc-600" />
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

function MetricsStrip() {
  const mockIV = 26.2;
  const mockIVR = 68;
  const mockMove = 14.50;
  const mockERDays = 12;
  const ivrColor = mockIVR > 50 ? "text-[#FFB800]" : "text-white";
  const erColor = mockERDays < 14 ? "text-red-400" : "text-white";

  return (
    <div
      className="flex justify-between items-center py-2.5 px-4 shrink-0 font-mono"
      style={{ fontVariantNumeric: "tabular-nums", backgroundColor: BG, borderBottom: `1px solid ${BORDER}` }}
    >
      <div className="flex flex-col items-center">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">IV</span>
        <span className="text-sm font-bold text-white">{mockIV}%</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">IVR</span>
        <span className={`text-sm font-bold ${ivrColor}`}>{mockIVR}</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">MOVE</span>
        <span className="text-sm font-bold text-white">±${mockMove.toFixed(2)}</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">ER</span>
        <span className={`text-sm font-bold ${erColor}`}>{mockERDays}d</span>
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

  const sortedRows = useMemo(() => [...rows].sort((a, b) => a.strike - b.strike), [rows]);

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

  return (
    <div className="relative flex font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
      {atmLineTop >= 0 && (
        <div
          className="absolute left-0 right-0 z-30 pointer-events-none"
          style={{ top: atmLineTop, borderTop: "1.5px dashed #FFB800" }}
        />
      )}

      {showCalls && (
        <div
          ref={leftBodyRef}
          className="flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
          style={noScrollbar}
        >
          <div style={{ minWidth: wingWidth }}>
            {sortedRows.map((row) => {
              const callITM = underlyingPrice != null && row.strike < underlyingPrice - EPS;
              return (
                <div
                  key={row.strike}
                  className={`flex border-b hover:bg-white/[0.03] transition-colors ${callITM ? "bg-[#1e293b]/60" : ""}`}
                  style={{ height: ROW_H, borderColor: BORDER }}
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

      <div className="flex-none z-10" style={{ width: STRIKE_W, backgroundColor: '#151517', borderLeft: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}` }}>
        {sortedRows.map((row) => {
          const isATMStrike = underlyingPrice != null && Math.abs(row.strike - underlyingPrice) <= EPS;
          return (
            <div
              key={row.strike}
              className={`flex items-center justify-center text-[13px] font-semibold border-b ${isATMStrike ? "text-[#FFB800]" : "text-zinc-300"}`}
              style={{ height: ROW_H, fontVariantNumeric: "tabular-nums", borderColor: BORDER }}
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
          <div style={{ minWidth: wingWidth }}>
            {sortedRows.map((row) => {
              const putITM = underlyingPrice != null && row.strike > underlyingPrice + EPS;
              return (
                <div
                  key={row.strike}
                  className={`flex border-b hover:bg-white/[0.03] transition-colors ${putITM ? "bg-[#1e293b]/60" : ""}`}
                  style={{ height: ROW_H, borderColor: BORDER }}
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
  );
}

export function OptionsTab() {
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

  const brokerStrikeCount = Math.max(strikeCount, 20);

  const { data, isLoading, error, isFetching } = useGetOptionChain(
    { symbol, accessToken: accessToken || "", contractType, daysToExpiration: maxDte, strikeCount: brokerStrikeCount },
    { query: { enabled: !!accessToken && !!symbol } }
  );

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );

  const underlyingPrice = quote?.last ?? (data as unknown as { underlyingPrice?: number })?.underlyingPrice ?? null;

  const groups = useMemo(() => {
    if (!data) return [];
    return buildExpirationGroups(
      (data.calls ?? []) as Contract[],
      (data.puts ?? []) as Contract[],
      underlyingPrice,
      strikeCount
    );
  }, [data, underlyingPrice, strikeCount]);

  useEffect(() => {
    if (groups.length > 0 && expandedExps.size === 0) {
      setExpandedExps(new Set([groups[0].expiration]));
    }
  }, [groups]);

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

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    if (subHeaderLeftRef.current) cleanups.push(registerWing(subHeaderLeftRef.current));
    if (subHeaderRightRef.current) cleanups.push(registerWing(subHeaderRightRef.current));
    return () => cleanups.forEach(fn => fn());
  }, [registerWing, showCalls, showPuts]);

  const hasData = data && groups.length > 0;

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: BG }}>
      <MetricsStrip />
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 shrink-0 flex-wrap"
        style={{ backgroundColor: '#151517', borderBottom: `1px solid ${BORDER}` }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">Strikes</span>
            {isCustomMode ? (
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={2} max={100} autoFocus
                  value={localCustomValue}
                  onChange={e => handleCustomStrikeChange(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") handleExitCustomMode(); }}
                  className="w-[70px] font-mono text-[11px] h-7 px-2"
                  style={{ backgroundColor: '#111113', borderColor: BORDER }}
                  placeholder="10"
                />
                <button onClick={handleExitCustomMode} className="p-0.5 rounded text-zinc-500 hover:text-white hover:bg-white/10 transition-colors" aria-label="Exit custom mode">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <Select value={strikeMode} onValueChange={handleStrikeModeChange}>
                <SelectTrigger className="w-[70px] font-mono text-[11px] h-7 px-2" style={{ backgroundColor: '#111113', borderColor: BORDER }}>
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
        </div>

        {isFetching && data && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 border border-[#FFB800] border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-[10px] text-zinc-500">UPDATING</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 relative overscroll-y-contain" style={{ WebkitOverflowScrolling: "touch", backgroundColor: BG } as React.CSSProperties}>
        {isLoading && !data && (
          <div className="p-4 space-y-1.5">
            {Array.from({ length: 12 }).map((_, i) => (
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
                  <span className="text-[14px] font-extrabold uppercase text-white tracking-widest">CALLS</span>
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
                  <Settings className="w-7 h-7" />
                </button>
              </div>
              {showPuts && (
                <div className="flex-1 text-center">
                  <span className="text-[14px] font-extrabold uppercase text-white tracking-widest">PUTS</span>
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
                      <div key={col.id} style={{ width: COL_W }} className="shrink-0 flex items-center px-2">
                        <span className="text-[11px] text-zinc-400 font-medium">{col.topLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div
                className="flex-none flex items-center justify-center"
                style={{ width: STRIKE_W, borderLeft: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}` }}
              >
                <span className="text-[11px] text-zinc-400 font-medium">Strike</span>
              </div>
              {showPuts && (
                <div
                  ref={subHeaderRightRef}
                  className="flex-1 overflow-x-auto overflow-y-hidden"
                  style={noScrollbar}
                >
                  <div className="flex items-center" style={{ minWidth: wingWidth, height: SUB_HEADER_H }}>
                    {activeColumns.map(col => (
                      <div key={col.id} style={{ width: COL_W }} className="shrink-0 flex items-center px-2">
                        <span className="text-[11px] text-zinc-400 font-medium">{col.topLabel}</span>
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
                      className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.03] transition-colors sticky z-10"
                      style={{ top: STICKY_TOP, backgroundColor: BG, borderBottom: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-2 font-mono">
                        {isOpen
                          ? <ChevronDown className="w-4 h-4 text-zinc-400" />
                          : <ChevronUp className="w-4 h-4 text-zinc-400 -rotate-90" />
                        }
                        <span className="text-[12px] font-medium text-white tracking-wide">
                          {group.dateLabel}
                        </span>
                        <span className="text-[12px] text-zinc-400">
                          ({Math.round(group.dte)})
                        </span>
                        <span className="text-[12px] text-white">
                          {group.totalStrikes}
                        </span>
                        {group.isWeekly && (
                          <span className="text-[12px] text-[#FFB800] font-medium">Weeklys</span>
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
