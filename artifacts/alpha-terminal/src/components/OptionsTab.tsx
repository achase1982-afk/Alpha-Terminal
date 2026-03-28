import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { useGetQuote, useGetPriceHistory, useGetOptionChain } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table2, BarChart2, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = "/api";

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
  isATM: boolean;
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
  const coerced = count % 2 !== 0 ? count + 1 : count;
  const half = coerced / 2;
  let start = Math.max(0, atmIdx - half);
  let end = start + coerced;
  if (end > rows.length) {
    end = rows.length;
    start = Math.max(0, end - coerced);
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

    let normalizedRows: NormalizedRow[] = allStrikes.map((strike, i) => ({
      strike,
      call: callMap.get(strike) ?? null,
      put: putMap.get(strike) ?? null,
      isATM: i === atmIdx,
    }));

    if (strikeCount > 0 && lastPrice != null && normalizedRows.length > strikeCount) {
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
  const { symbol, accessToken, aiModel, aiTemp, strategistResult, setStrategistResult } = useTerminalStore();
  const { contractType, strikeCount, maxDte, customStrikeInput, setCustomStrikeInput } = useOptionsSettingsStore();
  const setStrikeCount = useOptionsSettingsStore(s => s.setStrikeCount);

  const [isStrategizing, setIsStrategizing] = useState(false);
  const [strategistExpanded, setStrategistExpanded] = useState(false);
  const [expandedExps, setExpandedExps] = useState<Set<string>>(new Set());
  const [forceCustom, setForceCustom] = useState(false);
  const strikeMode = useMemo(() => {
    if (forceCustom) return "custom";
    if ([6, 10, 20].includes(strikeCount)) return String(strikeCount);
    return "custom";
  }, [strikeCount, forceCustom]);
  const strategistAbortRef = useRef<AbortController | null>(null);
  const strategistIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, error, isFetching } = useGetOptionChain(
    { symbol, accessToken: accessToken || "", contractType, daysToExpiration: maxDte },
    { query: { enabled: !!accessToken && !!symbol } }
  );

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );

  const { data: history } = useGetPriceHistory(
    { symbol, accessToken: accessToken || "", periodType: "month", period: 3, frequencyType: "daily", frequency: 1 },
    { query: { enabled: !!accessToken } }
  );

  const underlyingPrice = (data as unknown as { underlyingPrice?: number })?.underlyingPrice ?? quote?.lastPrice ?? null;

  const groups = useMemo(() => {
    if (!data) return [];
    return buildExpirationGroups(
      data.calls as Contract[],
      data.puts as Contract[],
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
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    const n = parseInt(val);
    if (!isNaN(n) && n > 0) setStrikeCount(n);
  }, [setStrikeCount]);

  const handleCustomStrikeChange = useCallback((raw: string) => {
    setCustomStrikeInput(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const n = parseInt(raw);
      if (!isNaN(n) && n >= 2 && n <= 100) setStrikeCount(n);
    }, 400);
  }, [setCustomStrikeInput, setStrikeCount]);

  const handleRunStrategist = async () => {
    if (!quote || !data) return;
    if (strategistAbortRef.current) strategistAbortRef.current.abort();
    const controller = new AbortController();
    strategistAbortRef.current = controller;
    const requestId = ++strategistIdRef.current;

    setStrategistResult(null);
    setIsStrategizing(true);
    setStrategistExpanded(true);
    try {
      const res = await fetch(`${API_BASE}/ai/options-strategist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote,
          candles: history?.candles ?? [],
          chain: data,
          model: aiModel,
          temperature: aiTemp,
        }),
        signal: controller.signal,
      });
      if (strategistIdRef.current !== requestId) return;
      const result = await res.json() as { response?: string };
      setStrategistResult(result.response ?? "No response received.");
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (strategistIdRef.current !== requestId) return;
      setStrategistResult(`**Error:** ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (strategistIdRef.current === requestId) setIsStrategizing(false);
    }
  };

  useEffect(() => {
    return () => {
      if (strategistAbortRef.current) strategistAbortRef.current.abort();
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

      <div className="flex items-center gap-2 bg-[#111111] px-3 py-1.5 rounded-lg border border-[#262626] shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase">Strikes</span>
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
        </div>

        {strikeMode === "custom" && (
          <Input
            type="number"
            min={2}
            max={100}
            value={customStrikeInput || String(strikeCount)}
            onChange={e => handleCustomStrikeChange(e.target.value)}
            className="w-14 font-mono text-[11px] bg-[#0c0c0c] border-[#262626] h-7 px-2"
            placeholder="10"
          />
        )}

        {data && (
          <Button
            onClick={handleRunStrategist}
            disabled={isStrategizing || !accessToken}
            variant="outline"
            className="font-mono text-[11px] h-7 px-3 border-[#27272A] text-primary hover:bg-primary/10 ml-auto"
          >
            {isStrategizing ? (
              <><span className="w-2.5 h-2.5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-1.5" />ANALYZING</>
            ) : (
              <><BarChart2 className="w-3 h-3 mr-1.5" />STRATEGIST</>
            )}
          </Button>
        )}

        {isFetching && data && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-2 h-2 border border-primary border-t-transparent rounded-full animate-spin" />
            <span className="font-mono text-[10px] text-zinc-500">UPDATING</span>
          </div>
        )}
      </div>

      {(strategistResult || isStrategizing) && (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden shrink-0">
          <button
            onClick={() => setStrategistExpanded(s => !s)}
            className="w-full flex items-center justify-between px-3 py-2 border-b border-card-border hover:bg-secondary/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <BarChart2 className="w-3 h-3 text-primary" />
              <span className="font-mono text-[11px] font-bold text-foreground">STRATEGIST — {symbol}</span>
              {isStrategizing && (
                <span className="w-2 h-2 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              )}
            </div>
            {strategistExpanded ? <ChevronUp className="w-3 h-3 text-zinc-500" /> : <ChevronDown className="w-3 h-3 text-zinc-500" />}
          </button>
          {strategistExpanded && (
            <div className="p-4 bg-[#0c0c0c]">
              {isStrategizing ? (
                <div className="flex items-center justify-center gap-3 py-6">
                  <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="font-mono text-xs text-primary animate-pulse tracking-widest">RUNNING DERIVATIVES STRATEGIST...</span>
                </div>
              ) : strategistResult ? (
                <div className="prose prose-invert prose-primary max-w-none font-sans text-gray-300
                  prose-headings:text-white prose-headings:font-bold prose-headings:tracking-wide prose-headings:mt-3 prose-headings:mb-1
                  prose-h3:text-sm prose-h2:text-base
                  prose-strong:text-white prose-strong:font-bold
                  prose-li:my-0.5
                  prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:rounded prose-code:text-xs"
                >
                  <ReactMarkdown>{strategistResult}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

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
                      <span className="font-mono text-[10px] text-zinc-500">{group.rows.length} strikes</span>
                      {isOpen
                        ? <ChevronUp className="w-3 h-3 text-zinc-500" />
                        : <ChevronDown className="w-3 h-3 text-zinc-500" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="overflow-x-auto">
                      <div
                        className="grid text-[10px] font-mono text-zinc-500 uppercase tracking-wider border-b border-[#262626] bg-[#0a0a0a] sticky top-0 z-10"
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
                          STRIKE
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
  return (
    <div>
      {rows.map(row => {
        const callITM = underlyingPrice != null && row.strike < underlyingPrice;
        const putITM = underlyingPrice != null && row.strike > underlyingPrice;

        return (
          <div
            key={row.strike}
            className={`grid font-mono text-[11px] transition-colors hover:bg-white/[0.03] ${
              row.isATM
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

            <div className={`flex items-center justify-center bg-[#18181B] text-[11px] font-bold ${row.isATM ? "text-[#FFB800]" : "text-zinc-300"}`}>
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
