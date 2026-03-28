import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { useGetQuote, useGetOptionChain } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table2, ChevronDown, ChevronUp, X } from "lucide-react";

const EPS = 0.0001;

interface Contract {
  strike: number;
  expiration: string;
  bid?: number;
  ask?: number;
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
  if (count <= 0 || rows.length === 0 || rows.length <= count) return rows;
  const total = count % 2 !== 0 ? count + 1 : count;
  const below = Math.floor(total / 2);
  const above = total - below - 1;

  let start = atmIdx - below;
  let end = atmIdx + above + 1;

  if (start < 0) {
    end = Math.min(rows.length, end + Math.abs(start));
    start = 0;
  }
  if (end > rows.length) {
    start = Math.max(0, start - (end - rows.length));
    end = rows.length;
  }

  return rows.slice(start, end);
}

function buildExpirationGroups(
  calls: Contract[],
  puts: Contract[],
  lastPrice: number | null,
  strikeCount: number
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
      strike,
      call: callMap.get(strike) ?? null,
      put: putMap.get(strike) ?? null,
    }));

    if (strikeCount > 0 && atmIdx >= 0 && normalizedRows.length > strikeCount) {
      normalizedRows = sliceAroundATM(normalizedRows, atmIdx, strikeCount);
    }

    groups.push({ expiration: exp, dte, label: formatExpLabel(exp, dte), rows: normalizedRows });
  }

  groups.sort((a, b) => a.dte - b.dte);
  return groups;
}

function CellVal({ val, decimals = 2 }: { val?: number | null; decimals?: number }) {
  if (val == null || isNaN(val)) return <span className="text-zinc-600">—</span>;
  return <>{val.toFixed(decimals)}</>;
}

export function OptionsTab() {
  const { symbol, accessToken } = useTerminalStore();
  const { contractType, strikeCount, maxDte, customStrikeInput, setCustomStrikeInput } = useOptionsSettingsStore();
  const setStrikeCount = useOptionsSettingsStore(s => s.setStrikeCount);

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

  useEffect(() => {
    setExpandedExps(new Set());
  }, [symbol]);

  const toggleExp = (exp: string) => {
    setExpandedExps(prev => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp);
      else next.add(exp);
      return next;
    });
  };

  const handleStrikeModeChange = useCallback((val: string) => {
    if (val === "custom") {
      setLocalCustomValue(String(strikeCount));
      setIsCustomMode(true);
      return;
    }
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
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setIsCustomMode(false);
    if (![6, 10, 20].includes(strikeCount)) {
      setStrikeCount(10);
    }
  }, [strikeCount, setStrikeCount]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const gridCols = contractType === 'CALL'
    ? "1fr 56px"
    : contractType === 'PUT'
      ? "56px 1fr"
      : "1fr 56px 1fr";

  const showCalls = contractType !== 'PUT';
  const showPuts = contractType !== 'CALL';

  return (
    <div className="space-y-2 h-full flex flex-col">

      <div className="flex items-center justify-between gap-2 bg-[#111111] px-3 py-1.5 rounded-lg border border-[#262626] shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase">Strikes</span>
          {isCustomMode ? (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={2}
                max={100}
                autoFocus
                value={localCustomValue}
                onChange={e => handleCustomStrikeChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') handleExitCustomMode(); }}
                className="w-[70px] font-mono text-[11px] bg-[#0c0c0c] border-[#262626] h-7 px-2"
                placeholder="10"
              />
              <button
                onClick={handleExitCustomMode}
                className="p-0.5 rounded text-zinc-500 hover:text-white hover:bg-[#262626] transition-colors"
                aria-label="Exit custom mode"
              >
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

        <div className="flex items-center gap-1">
          {isFetching && data && (
            <div className="flex items-center gap-1.5 mr-3">
              <span className="w-2 h-2 border border-primary border-t-transparent rounded-full animate-spin" />
              <span className="font-mono text-[10px] text-zinc-500">UPDATING</span>
            </div>
          )}
          {data && (
            <div className="flex items-center gap-2 font-mono text-[11px]" style={{ fontVariantNumeric: "tabular-nums" }}>
              <span className="text-zinc-500">IV:</span>
              <span className="text-white font-medium">26.24%</span>
              <span className="text-zinc-600">|</span>
              <span className="text-white font-medium">±$14.50</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto terminal-panel p-0 min-h-0 relative">
        {isLoading && !data && (
          <div className="p-4 space-y-1.5">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full bg-[#1a1a1a]" />
            ))}
          </div>
        )}

        {isFetching && data && (
          <div className="absolute inset-0 bg-black/20 z-20 pointer-events-none" />
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
          <div className="divide-y divide-[#262626]">
            {groups.map(group => {
              const isOpen = expandedExps.has(group.expiration);
              return (
                <div key={group.expiration}>
                  <button
                    onClick={() => toggleExp(group.expiration)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-[#111111] border-b border-[#262626] hover:bg-[#1a1a1a] transition-colors"
                  >
                    <span className="font-mono text-[11px] font-bold text-white tracking-wider">{group.label}</span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 font-mono text-[10px]" style={{ fontVariantNumeric: "tabular-nums" }}>
                        <span className="text-zinc-500">IV:</span>
                        <span className="text-white">32%</span>
                        <span className="text-zinc-600">|</span>
                        <span className="text-zinc-500">±</span>
                        <span className="text-white">$8.50</span>
                      </div>
                      {isOpen
                        ? <ChevronUp className="w-3 h-3 text-zinc-500" />
                        : <ChevronDown className="w-3 h-3 text-zinc-500" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="overflow-x-auto">
                      <div
                        className="grid text-[10px] font-mono text-zinc-500 uppercase tracking-wider border-b border-[#262626] bg-[#0a0a0a] sticky top-0 z-10 py-1"
                        style={{ gridTemplateColumns: gridCols }}
                      >
                        {showCalls && (
                          <div className="px-2 text-left">CALLS</div>
                        )}
                        <div className="flex items-center justify-center text-zinc-400">
                          STRIKE
                        </div>
                        {showPuts && (
                          <div className="px-2 text-right">PUTS</div>
                        )}
                      </div>

                      <div
                        className="grid text-[10px] font-mono text-zinc-500 uppercase tracking-wider border-b border-[#262626] bg-[#0a0a0a] sticky top-[22px] z-10"
                        style={{ gridTemplateColumns: gridCols }}
                      >
                        {showCalls && (
                          <div className="grid grid-cols-4 px-2 py-1 text-right gap-0.5">
                            <span>Bid</span>
                            <span>Ask</span>
                            <span>Vol</span>
                            <span>Delta</span>
                          </div>
                        )}
                        <div className="flex items-center justify-center bg-[#18181B] text-zinc-400 font-bold">
                        </div>
                        {showPuts && (
                          <div className="grid grid-cols-4 px-2 py-1 text-left gap-0.5">
                            <span>Bid</span>
                            <span>Ask</span>
                            <span>Vol</span>
                            <span>Delta</span>
                          </div>
                        )}
                      </div>

                      <StraddleBody
                        rows={group.rows}
                        underlyingPrice={underlyingPrice}
                        gridCols={gridCols}
                        showCalls={showCalls}
                        showPuts={showPuts}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {data && groups.length === 0 && (
          <div className="p-16 flex flex-col items-center justify-center text-muted-foreground font-mono h-full">
            <Table2 className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-xs">NO OPTIONS DATA AVAILABLE FOR THIS RANGE.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StraddleBody({
  rows,
  underlyingPrice,
  gridCols,
  showCalls,
  showPuts,
}: {
  rows: NormalizedRow[];
  underlyingPrice: number | null;
  gridCols: string;
  showCalls: boolean;
  showPuts: boolean;
}) {
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.strike - b.strike),
    [rows]
  );

  const transitionIdx = useMemo(() => {
    if (underlyingPrice == null) return -1;
    return sortedRows.findIndex(r => r.strike > underlyingPrice + EPS);
  }, [sortedRows, underlyingPrice]);

  const priceAboveAll = useMemo(() => {
    if (underlyingPrice == null || sortedRows.length === 0) return false;
    const maxStrike = sortedRows[sortedRows.length - 1].strike;
    return underlyingPrice > maxStrike + EPS;
  }, [underlyingPrice, sortedRows]);

  return (
    <div>
      {sortedRows.map((row, idx) => {
        const isATMBorder = idx === transitionIdx;
        const isLastRowATM = transitionIdx === -1 && priceAboveAll && idx === sortedRows.length - 1;

        const callITM = underlyingPrice != null && row.strike < underlyingPrice - EPS;
        const putITM = underlyingPrice != null && row.strike > underlyingPrice + EPS;

        const isATMStrike = underlyingPrice != null &&
          Math.abs(row.strike - underlyingPrice) <= EPS;

        return (
          <div
            key={row.strike}
            className={`grid font-mono text-[11px] transition-colors hover:bg-white/[0.03] ${
              isATMBorder
                ? "border-t border-dashed border-[#FFB800]"
                : isLastRowATM
                  ? "border-b border-dashed border-[#FFB800]"
                  : "border-b border-[#1a1a1a]"
            }`}
            style={{
              gridTemplateColumns: gridCols,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {showCalls && (
              <div
                className={`grid grid-cols-4 px-2 py-1 text-right gap-0.5 items-center ${callITM ? "bg-[#1e293b]" : ""}`}
              >
                <span className="text-white"><CellVal val={row.call?.bid} /></span>
                <span className="text-white"><CellVal val={row.call?.ask} /></span>
                <span className="text-zinc-400">{row.call?.volume ?? <span className="text-zinc-600">—</span>}</span>
                <span className="text-zinc-500"><CellVal val={row.call?.delta} decimals={3} /></span>
              </div>
            )}

            <div className={`flex items-center justify-center bg-[#18181B] text-[11px] font-bold ${isATMStrike ? "text-[#FFB800]" : "text-zinc-300"}`}>
              {row.strike.toFixed(row.strike % 1 === 0 ? 0 : 2)}
            </div>

            {showPuts && (
              <div
                className={`grid grid-cols-4 px-2 py-1 text-left gap-0.5 items-center ${putITM ? "bg-[#1e293b]" : ""}`}
              >
                <span className="text-white"><CellVal val={row.put?.bid} /></span>
                <span className="text-white"><CellVal val={row.put?.ask} /></span>
                <span className="text-zinc-400">{row.put?.volume ?? <span className="text-zinc-600">—</span>}</span>
                <span className="text-zinc-500"><CellVal val={row.put?.delta} decimals={3} /></span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
