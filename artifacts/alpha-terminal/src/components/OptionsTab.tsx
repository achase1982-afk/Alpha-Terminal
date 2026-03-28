import { useState, useMemo, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetQuote, useGetPriceHistory, useGetOptionChain } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DownloadCloud, Table2, BarChart2, ChevronDown, ChevronUp } from "lucide-react";
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

interface StraddleRow {
  strike: number;
  call?: Contract;
  put?: Contract;
}

interface ExpirationGroup {
  expiration: string;
  dte: number;
  label: string;
  rows: StraddleRow[];
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

function buildExpirationGroups(calls: Contract[], puts: Contract[]): ExpirationGroup[] {
  const expMap = new Map<string, { calls: Map<number, Contract>; puts: Map<number, Contract>; dte: number }>();

  for (const c of calls) {
    const key = c.expiration;
    if (!expMap.has(key)) expMap.set(key, { calls: new Map(), puts: new Map(), dte: c.dte ?? 0 });
    expMap.get(key)!.calls.set(c.strike, c);
  }
  for (const p of puts) {
    const key = p.expiration;
    if (!expMap.has(key)) expMap.set(key, { calls: new Map(), puts: new Map(), dte: p.dte ?? 0 });
    expMap.get(key)!.puts.set(p.strike, p);
  }

  const groups: ExpirationGroup[] = [];
  for (const [exp, { calls: callMap, puts: putMap, dte }] of expMap) {
    const allStrikes = new Set([...callMap.keys(), ...putMap.keys()]);
    const sorted = [...allStrikes].sort((a, b) => a - b);
    const rows: StraddleRow[] = sorted.map(strike => ({
      strike,
      call: callMap.get(strike),
      put: putMap.get(strike),
    }));
    groups.push({ expiration: exp, dte, label: formatExpLabel(exp, dte), rows });
  }

  groups.sort((a, b) => a.dte - b.dte);
  return groups;
}

function sliceAroundATM(rows: StraddleRow[], underlyingPrice: number | null, strikesCount: number | null): StraddleRow[] {
  if (strikesCount == null || underlyingPrice == null || rows.length === 0) return rows;
  const half = Math.floor(strikesCount / 2);
  let atmIdx = 0;
  let minDiff = Math.abs(rows[0].strike - underlyingPrice);
  for (let i = 1; i < rows.length; i++) {
    const diff = Math.abs(rows[i].strike - underlyingPrice);
    if (diff < minDiff) { atmIdx = i; minDiff = diff; }
  }
  const start = Math.max(0, atmIdx - half);
  const end = Math.min(rows.length, start + strikesCount);
  const adjustedStart = Math.max(0, end - strikesCount);
  return rows.slice(adjustedStart, end);
}

function CellVal({ val, decimals = 2 }: { val?: number; decimals?: number }) {
  if (val == null || isNaN(val)) return <span className="text-zinc-600">—</span>;
  return <>{val.toFixed(decimals)}</>;
}

export function OptionsTab() {
  const { symbol, accessToken, aiModel, aiTemp, strategistResult, setStrategistResult } = useTerminalStore();
  const [contractType, setContractType] = useState("ALL");
  const [dte, setDte] = useState("30");
  const [strikesLimit, setStrikesLimit] = useState("10");
  const [enabled, setEnabled] = useState(false);
  const [isStrategizing, setIsStrategizing] = useState(false);
  const [strategistExpanded, setStrategistExpanded] = useState(false);
  const [expandedExps, setExpandedExps] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useGetOptionChain(
    { symbol, accessToken: accessToken || "", contractType, daysToExpiration: parseInt(dte) || 30 },
    { query: { enabled: !!accessToken && enabled && !!symbol } }
  );

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );

  const { data: history } = useGetPriceHistory(
    { symbol, accessToken: accessToken || "", periodType: "month", period: 3, frequencyType: "daily", frequency: 1 },
    { query: { enabled: !!accessToken } }
  );

  const handleLoad = () => setEnabled(true);

  const underlyingPrice = (data as unknown as { underlyingPrice?: number })?.underlyingPrice ?? quote?.lastPrice ?? null;
  const parsedStrikesLimit = strikesLimit === "ALL" ? null : parseInt(strikesLimit);

  const groups = useMemo(() => {
    if (!data) return [];
    return buildExpirationGroups(data.calls as Contract[], data.puts as Contract[]);
  }, [data]);

  useEffect(() => {
    if (groups.length > 0 && expandedExps.size === 0) {
      setExpandedExps(new Set([groups[0].expiration]));
    }
  }, [groups]);

  const toggleExp = (exp: string) => {
    setExpandedExps(prev => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp);
      else next.add(exp);
      return next;
    });
  };

  const handleRunStrategist = async () => {
    if (!quote || !data) return;
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
      });
      const result = await res.json() as { response?: string };
      setStrategistResult(result.response ?? "No response received.");
    } catch (err) {
      setStrategistResult(`**Error:** ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsStrategizing(false);
    }
  };

  return (
    <div className="space-y-2 h-full flex flex-col">

      <div className="flex items-center gap-2 bg-[#111111] px-3 py-2 rounded-lg border border-[#262626] shrink-0 flex-wrap">
        <Select value={contractType} onValueChange={setContractType}>
          <SelectTrigger className="w-20 font-mono text-[11px] bg-[#0c0c0c] border-[#262626] h-7 px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ALL</SelectItem>
            <SelectItem value="CALL">CALL</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase">DTE</span>
          <Input
            type="number"
            value={dte}
            onChange={e => setDte(e.target.value)}
            className="w-14 font-mono text-[11px] bg-[#0c0c0c] border-[#262626] h-7 px-2"
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase">Strikes</span>
          <Select value={strikesLimit} onValueChange={setStrikesLimit}>
            <SelectTrigger className="w-16 font-mono text-[11px] bg-[#0c0c0c] border-[#262626] h-7 px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">6</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="ALL">ALL</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleLoad}
          disabled={!accessToken}
          className="font-mono text-[11px] h-7 px-3 bg-[#18181B] text-[#FFB800] hover:bg-[#27272A] border border-[#27272A]"
        >
          <DownloadCloud className="w-3 h-3 mr-1.5" />
          LOAD
        </Button>

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

      <div className="flex-1 overflow-auto terminal-panel p-0 min-h-0">
        {isLoading && (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-8 w-full bg-card-border" />)}
          </div>
        )}
        {error && (
          <div className="p-10 text-center text-destructive font-mono flex flex-col items-center">
            <span className="text-3xl mb-3">⚠</span>
            <span className="text-xs">FAILED TO LOAD OPTIONS DATA.</span>
          </div>
        )}
        {!isLoading && !error && !data && (
          <div className="p-16 flex flex-col items-center justify-center text-muted-foreground font-mono h-full">
            <Table2 className="w-8 h-8 mb-2 opacity-20" />
            <span className="text-xs">CLICK "LOAD" TO FETCH OPTIONS DATA.</span>
          </div>
        )}

        {data && groups.length > 0 && (
          <div className="divide-y divide-[#262626]">
            {groups.map(group => {
              const isOpen = expandedExps.has(group.expiration);
              const visibleRows = sliceAroundATM(group.rows, underlyingPrice, parsedStrikesLimit);
              return (
                <div key={group.expiration}>
                  <button
                    onClick={() => toggleExp(group.expiration)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-[#111111] border-b border-[#262626] hover:bg-[#1a1a1a] transition-colors"
                  >
                    <span className="font-mono text-[11px] font-bold text-white tracking-wider">{group.label}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[10px] text-zinc-500">
                        {parsedStrikesLimit != null && group.rows.length > parsedStrikesLimit
                          ? `${visibleRows.length}/${group.rows.length}`
                          : group.rows.length} strikes
                      </span>
                      {isOpen
                        ? <ChevronUp className="w-3 h-3 text-zinc-500" />
                        : <ChevronDown className="w-3 h-3 text-zinc-500" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div>
                      <div
                        className="grid text-[10px] font-mono text-zinc-500 uppercase tracking-wider border-b border-[#262626] bg-[#0a0a0a]"
                        style={{ gridTemplateColumns: "1fr 56px 1fr" }}
                      >
                        <div className="grid grid-cols-4 px-2 py-1 text-right gap-0.5">
                          <span>Bid</span>
                          <span>Ask</span>
                          <span>Vol</span>
                          <span>Delta</span>
                        </div>
                        <div className="flex items-center justify-center bg-[#18181B] text-zinc-400 font-bold">
                          STRIKE
                        </div>
                        <div className="grid grid-cols-4 px-2 py-1 text-left gap-0.5">
                          <span>Bid</span>
                          <span>Ask</span>
                          <span>Vol</span>
                          <span>Delta</span>
                        </div>
                      </div>

                      <StraddleBody rows={visibleRows} underlyingPrice={underlyingPrice} />
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

function StraddleBody({ rows, underlyingPrice }: { rows: StraddleRow[]; underlyingPrice: number | null }) {
  const atmIdx = useMemo(() => {
    if (underlyingPrice == null || rows.length === 0) return -1;
    let closest = 0;
    let minDiff = Math.abs(rows[0].strike - underlyingPrice);
    for (let i = 1; i < rows.length; i++) {
      const diff = Math.abs(rows[i].strike - underlyingPrice);
      if (diff < minDiff) { closest = i; minDiff = diff; }
    }
    return closest;
  }, [rows, underlyingPrice]);

  return (
    <div>
      {rows.map((row, i) => {
        const isATM = i === atmIdx;
        const callITM = underlyingPrice != null && row.strike < underlyingPrice;
        const putITM = underlyingPrice != null && row.strike > underlyingPrice;

        return (
          <div
            key={row.strike}
            className={`grid font-mono text-[11px] transition-colors hover:bg-white/[0.03] ${isATM ? "border-b border-dashed border-[#FFB800]" : "border-b border-[#1a1a1a]"}`}
            style={{
              gridTemplateColumns: "1fr 56px 1fr",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div
              className={`grid grid-cols-4 px-2 py-1 text-right gap-0.5 items-center ${callITM ? "bg-[#1e293b]" : ""}`}
            >
              <span className="text-white"><CellVal val={row.call?.bid} /></span>
              <span className="text-white"><CellVal val={row.call?.ask} /></span>
              <span className="text-zinc-400">{row.call?.volume ?? <span className="text-zinc-600">—</span>}</span>
              <span className="text-zinc-500"><CellVal val={row.call?.delta} decimals={3} /></span>
            </div>

            <div className={`flex items-center justify-center bg-[#18181B] text-[11px] font-bold ${isATM ? "text-[#FFB800]" : "text-zinc-300"}`}>
              {row.strike.toFixed(row.strike % 1 === 0 ? 0 : 2)}
            </div>

            <div
              className={`grid grid-cols-4 px-2 py-1 text-left gap-0.5 items-center ${putITM ? "bg-[#1e293b]" : ""}`}
            >
              <span className="text-white"><CellVal val={row.put?.bid} /></span>
              <span className="text-white"><CellVal val={row.put?.ask} /></span>
              <span className="text-zinc-400">{row.put?.volume ?? <span className="text-zinc-600">—</span>}</span>
              <span className="text-zinc-500"><CellVal val={row.put?.delta} decimals={3} /></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
