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
const COL_W = 60;
const STRIKE_W = 56;

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
  label: string;
  rows: NormalizedRow[];
}

function formatExpLabel(expStr: string, dte?: number): string {
  try {
    const d = new Date(expStr);
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const label = `${d.getDate()} ${months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
    const dteStr = dte != null ? ` (${Math.round(dte)} dte)` : "";
    return `${label}${dteStr}`;
  } catch {
    return expStr;
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
    const atmIdx = lastPrice != null ? findATMIndex(allStrikes, lastPrice) : -1;
    let normalizedRows: NormalizedRow[] = allStrikes.map((strike) => ({
      strike, call: callMap.get(strike) ?? null, put: putMap.get(strike) ?? null,
    }));
    if (strikeCount > 0 && atmIdx >= 0 && normalizedRows.length > strikeCount) {
      normalizedRows = sliceAroundATM(normalizedRows, atmIdx, strikeCount);
    }
    groups.push({ expiration: exp, dte, label: formatExpLabel(exp, dte), rows: normalizedRows });
  }
  groups.sort((a, b) => a.dte - b.dte);
  return groups;
}

function getContractVal(contract: Contract | null, key: string): number | undefined {
  if (!contract) return undefined;
  return (contract as Record<string, unknown>)[key] as number | undefined;
}

function fmtNum(val: number | undefined, decimals: number): string {
  if (val == null || isNaN(val)) return "—";
  return decimals === 0 ? String(Math.round(val)) : val.toFixed(decimals);
}

function DataCell({ col, contract, align }: { col: ColumnDef; contract: Contract | null; align: "left" | "right" }) {
  const topVal = getContractVal(contract, col.topKey);
  const bottomVal = col.bottomKey ? getContractVal(contract, col.bottomKey) : undefined;
  const topStr = fmtNum(topVal, col.topDecimals);
  const botStr = col.bottomKey ? fmtNum(bottomVal, col.bottomDecimals ?? 0) : null;
  const textAlign = align === "right" ? "text-right" : "text-left";

  const inner = (
    <div className={`flex flex-col justify-center h-12 px-1.5 ${textAlign}`}>
      <span className={`text-[13px] font-medium leading-tight ${topStr === "—" ? "text-zinc-600" : "text-zinc-100"}`}>{topStr}</span>
      {botStr != null && (
        <span className={`text-[10px] leading-tight ${botStr === "—" ? "text-zinc-700" : "text-zinc-500"}`}>{botStr}</span>
      )}
    </div>
  );

  if (col.isPrice) {
    return (
      <button className="w-full hover:bg-white/[0.06] active:bg-white/[0.1] transition-colors cursor-pointer" style={{ fontVariantNumeric: "tabular-nums" }}>
        {inner}
      </button>
    );
  }

  return <div style={{ fontVariantNumeric: "tabular-nums" }}>{inner}</div>;
}


function MetricsStrip() {
  const mockIV = 26.2;
  const mockIVR = 68;
  const mockMove = 14.50;
  const mockERDays = 12;
  const ivrColor = mockIVR > 50 ? "text-[#FFB800]" : "text-white";
  const erColor = mockERDays < 14 ? "text-red-400" : "text-white";

  return (
    <div className="flex justify-between items-center bg-[#09090b] py-2 px-3 border-y border-[#262626] shrink-0 font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
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
        className="relative bg-[#111111] border border-[#262626] rounded-t-xl sm:rounded-xl w-full sm:max-w-sm mx-auto p-4 z-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-mono text-sm font-bold text-white tracking-wider">COLUMNS</span>
          <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-white hover:bg-[#262626] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <Reorder.Group axis="y" values={localOrder} onReorder={handleReorder} className="space-y-1.5">
          {localOrder.map(id => {
            const col = COLUMN_REGISTRY.find(c => c.id === id);
            if (!col) return null;
            return (
              <Reorder.Item key={id} value={id} className="cursor-grab active:cursor-grabbing">
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-[#1a1a1a] border-[#FFB800]/30 text-white">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{col.label}</span>
                  </div>
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
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border bg-[#0c0c0c] border-[#262626] text-zinc-500 hover:text-zinc-300 hover:border-[#333] transition-colors"
            >
              <span className="font-mono text-sm font-medium">{col.label}</span>
              <div className="w-9 h-5 rounded-full flex items-center transition-colors bg-[#262626] justify-start">
                <div className="w-4 h-4 rounded-full bg-white mx-0.5 shadow-sm" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function useScrollSync() {
  const scrollXRef = useRef(0);
  const isSyncing = useRef(false);
  const containersRef = useRef<Set<HTMLDivElement>>(new Set());

  const broadcast = useCallback((scrollLeft: number, source: HTMLDivElement) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    scrollXRef.current = scrollLeft;
    requestAnimationFrame(() => {
      for (const t of containersRef.current) {
        if (t !== source) t.scrollLeft = scrollLeft;
      }
      isSyncing.current = false;
    });
  }, []);

  const register = useCallback((el: HTMLDivElement) => {
    containersRef.current.add(el);
    el.scrollLeft = scrollXRef.current;
    const handler = () => broadcast(el.scrollLeft, el);
    el.addEventListener("scroll", handler, { passive: true });
    return () => {
      containersRef.current.delete(el);
      el.removeEventListener("scroll", handler);
    };
  }, [broadcast]);

  return { register };
}

function OptionsGrid({
  rows,
  underlyingPrice,
  columns,
  showCalls,
  showPuts,
  registerScroll,
}: {
  rows: NormalizedRow[];
  underlyingPrice: number | null;
  columns: ColumnDef[];
  showCalls: boolean;
  showPuts: boolean;
  registerScroll: (el: HTMLDivElement) => () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => a.strike - b.strike), [rows]);

  const transitionIdx = useMemo(() => {
    if (underlyingPrice == null) return -1;
    return sortedRows.findIndex(r => r.strike > underlyingPrice + EPS);
  }, [sortedRows, underlyingPrice]);

  const priceAboveAll = useMemo(() => {
    if (underlyingPrice == null || sortedRows.length === 0) return false;
    return underlyingPrice > sortedRows[sortedRows.length - 1].strike + EPS;
  }, [underlyingPrice, sortedRows]);

  useEffect(() => {
    if (!scrollRef.current) return;
    return registerScroll(scrollRef.current);
  }, [registerScroll]);

  const callsWidth = showCalls ? columns.length * COL_W : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const visibleW = el.clientWidth;
      const strikeLeft = Math.round(visibleW / 2 - STRIKE_W / 2);
      el.style.setProperty("--strike-left", `${strikeLeft}px`);
      const idealScroll = callsWidth - strikeLeft;
      if (idealScroll > 0 && el.scrollLeft === 0) {
        el.scrollLeft = idealScroll;
      }
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [callsWidth]);

  const gridTemplate = [
    ...(showCalls ? [`repeat(${columns.length}, ${COL_W}px)`] : []),
    `${STRIKE_W}px`,
    ...(showPuts ? [`repeat(${columns.length}, ${COL_W}px)`] : []),
  ].join(" ");

  const strikeStickyStyle = { left: "var(--strike-left)" } as React.CSSProperties;

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto overscroll-x-contain scrollbar-hide"
      style={{ WebkitOverflowScrolling: "touch", scrollSnapType: "none" } as React.CSSProperties}
    >
      <div
        className="grid font-mono"
        style={{ gridTemplateColumns: gridTemplate, fontVariantNumeric: "tabular-nums" }}
      >
        {showCalls && columns.map(col => (
          <div key={`ch-${col.id}`} className="h-6 flex items-center px-1.5 bg-black border-b border-[#262626]">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium truncate">{col.topLabel}</span>
          </div>
        ))}
        <div
          className="h-6 flex items-center justify-center bg-black border-b border-[#262626] border-x text-[10px] text-zinc-500 uppercase tracking-wider font-medium sticky z-40"
          style={strikeStickyStyle}
        >
          Strike
        </div>
        {showPuts && columns.map(col => (
          <div key={`ph-${col.id}`} className="h-6 flex items-center px-1.5 bg-black border-b border-[#262626]">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium truncate">{col.topLabel}</span>
          </div>
        ))}

        {sortedRows.map((row, idx) => {
          const isATM = underlyingPrice != null && Math.abs(row.strike - underlyingPrice) <= EPS;
          const isATMBorder = idx === transitionIdx;
          const isLastRowATM = transitionIdx === -1 && priceAboveAll && idx === sortedRows.length - 1;
          const callITM = underlyingPrice != null && row.strike < underlyingPrice - EPS;
          const putITM = underlyingPrice != null && row.strike > underlyingPrice + EPS;

          return (
            <div
              key={row.strike}
              className="col-span-full grid border-b border-[#1a1a1a] relative hover:bg-white/[0.02] transition-colors"
              style={{ gridTemplateColumns: "subgrid" }}
            >
              {(isATMBorder || isLastRowATM) && (
                <div className={`absolute left-0 right-0 z-50 border-dashed border-[#FFB800] pointer-events-none ${isATMBorder ? "top-0 border-t" : "bottom-0 border-b"}`} />
              )}

              {showCalls && columns.map(col => (
                <div key={`c-${col.id}`} className={callITM ? "bg-[#1e293b]" : ""}>
                  <DataCell col={col} contract={row.call} align="left" />
                </div>
              ))}

              <div
                className={`h-12 flex items-center justify-center text-[13px] font-medium bg-black border-x border-[#262626] sticky z-40 ${isATM ? "text-[#FFB800]" : "text-zinc-300"}`}
                style={strikeStickyStyle}
              >
                {row.strike.toFixed(row.strike % 1 === 0 ? 0 : 2)}
              </div>

              {showPuts && columns.map(col => (
                <div key={`p-${col.id}`} className={putITM ? "bg-[#1e293b]" : ""}>
                  <DataCell col={col} contract={row.put} align="left" />
                </div>
              ))}
            </div>
          );
        })}
      </div>
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

  const showCalls = contractType !== 'PUT';
  const showPuts = contractType !== 'CALL';

  const { register: registerScroll } = useScrollSync();

  return (
    <div className="h-full flex flex-col bg-black -mx-4 w-[calc(100%+2rem)]">
      <div className="flex items-center justify-between gap-2 bg-[#111111] px-3 py-1.5 border-b border-[#262626] shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase">Strikes</span>
          {isCustomMode ? (
            <div className="flex items-center gap-1">
              <Input
                type="number" min={2} max={100} autoFocus
                value={localCustomValue}
                onChange={e => handleCustomStrikeChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') handleExitCustomMode(); }}
                className="w-[70px] font-mono text-[11px] bg-[#0c0c0c] border-[#262626] h-7 px-2"
                placeholder="10"
              />
              <button onClick={handleExitCustomMode} className="p-0.5 rounded text-zinc-500 hover:text-white hover:bg-[#262626] transition-colors" aria-label="Exit custom mode">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Select value={strikeMode} onValueChange={handleStrikeModeChange}>
              <SelectTrigger className="w-[70px] font-mono text-[11px] bg-[#0c0c0c] border-[#262626] h-7 px-2">
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

        {isFetching && data && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 border border-primary border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-[10px] text-zinc-500">UPDATING</span>
          </div>
        )}
      </div>

      {data && <MetricsStrip />}

      <div className="flex-1 overflow-y-auto min-h-0 relative overscroll-y-contain bg-black" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading && !data && (
          <div className="p-4 space-y-1.5">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full bg-[#1a1a1a]" />
            ))}
          </div>
        )}

        {isFetching && data && (
          <div className="absolute inset-0 bg-black/20 z-40 pointer-events-none" />
        )}

        {error && !data && (
          <div className="p-10 text-center text-destructive font-mono flex flex-col items-center">
            <span className="text-3xl mb-3">⚠</span>
            <span className="text-xs">FAILED TO LOAD OPTIONS DATA.</span>
          </div>
        )}

        {!isLoading && !error && !data && !accessToken && (
          <div className="p-16 flex flex-col items-center justify-center text-muted-foreground font-mono h-full">
            <Table2 className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-xs">CONNECT SCHWAB TO VIEW OPTIONS CHAIN.</span>
          </div>
        )}

        {!isLoading && !error && !data && accessToken && (
          <div className="p-16 flex flex-col items-center justify-center text-muted-foreground font-mono h-full">
            <Table2 className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-xs">LOADING OPTIONS CHAIN...</span>
          </div>
        )}

        {data && groups.length > 0 && (
          <>
            <div className="w-full flex items-center sticky top-0 z-30 bg-black border-b border-zinc-800 h-11 font-mono">
              {showCalls && (
                <div className="flex-1 text-center">
                  <span className="text-[14px] font-extrabold uppercase text-white tracking-widest">Calls</span>
                </div>
              )}
              <div className="w-14 flex items-center justify-center bg-black border-x border-[#262626]">
                <button onClick={() => setColumnsEditorOpen(true)} className="w-14 h-11 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Edit columns">
                  <Settings className="w-5 h-5" />
                </button>
              </div>
              {showPuts && (
                <div className="flex-1 text-center">
                  <span className="text-[14px] font-extrabold uppercase text-white tracking-widest">Puts</span>
                </div>
              )}
            </div>

            <div className="divide-y divide-[#262626]">
              {groups.map(group => {
                const isOpen = expandedExps.has(group.expiration);
                return (
                  <div key={group.expiration}>
                    <button
                      onClick={() => toggleExp(group.expiration)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-[#111111] border-b border-[#262626] hover:bg-[#1a1a1a] transition-colors sticky top-[44px] z-10"
                    >
                      <span className="font-mono text-[11px] font-medium text-white tracking-wider">{group.label}</span>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 font-mono text-[10px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                          <span className="text-zinc-500">IV:</span>
                          <span className="text-white">32%</span>
                          <span className="text-zinc-600">|</span>
                          <span className="text-zinc-500">±</span>
                          <span className="text-white">$8.50</span>
                        </div>
                        {isOpen ? <ChevronUp className="w-3 h-3 text-zinc-500" /> : <ChevronDown className="w-3 h-3 text-zinc-500" />}
                      </div>
                    </button>

                    {isOpen && (
                      <OptionsGrid
                        rows={group.rows}
                        underlyingPrice={underlyingPrice}
                        columns={activeColumns}
                        showCalls={showCalls}
                        showPuts={showPuts}
                        registerScroll={registerScroll}
                      />
                    )}
                  </div>
                );
            })}
            </div>
          </>
        )}

        {data && groups.length === 0 && (
          <div className="p-16 flex flex-col items-center justify-center text-muted-foreground font-mono h-full">
            <Table2 className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-xs">NO OPTIONS DATA AVAILABLE FOR THIS RANGE.</span>
          </div>
        )}
      </div>

      <ColumnsEditorModal open={columnsEditorOpen} onClose={() => setColumnsEditorOpen(false)} />
    </div>
  );
}
