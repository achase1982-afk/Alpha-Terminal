import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ChevronDown, ChevronUp, Activity, Search as SearchIcon } from "lucide-react";

interface TelemetryRow {
  id: number;
  timestamp: string;
  ticker: string;
  result: string;
  regime: any;
  tickerData: any;
  idioScore: any;
  toxicGate: any;
  viability: any;
  earningsGate: any;
  strategyDecision: any;
  candidatesGenerated: number | null;
  candidatesFiltered: number | null;
  filterReasons: string[] | null;
  winningCandidate: any;
  edgeAttribution: any;
  recommendationThesis: string | null;
}

interface ScannerRow {
  id: number;
  timestamp: string;
  mode: string;
  regime: any;
  weightsUsed: any;
  universeSize: number;
  passedFilters: number;
  aboveThreshold: number;
  thresholdUsed: number;
  catalystBonusAppliedTo: string[];
  results: any[];
}

export function StrategistTelemetryPanel() {
  const [activeTab, setActiveTab] = useState<"strategist" | "scanner">("strategist");
  const [stratRows, setStratRows] = useState<TelemetryRow[]>([]);
  const [scanRows, setScanRows] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [tickerFilter, setTickerFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<string>("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, scRes] = await Promise.all([
        fetchWithAuth(`/api/strategist/telemetry/strategist?limit=50${tickerFilter ? `&ticker=${tickerFilter}` : ""}`),
        fetchWithAuth("/api/strategist/telemetry/scanner?limit=20"),
      ]);
      if (sRes.ok) setStratRows(await sRes.json());
      if (scRes.ok) setScanRows(await scRes.json());
    } catch {}
    setLoading(false);
  }, [tickerFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const fmtDt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  };

  const resultColor = (r: string) => {
    if (r === "recommendation") return "#2ecc71";
    if (r === "toxic_block") return "#ff4b5c";
    return "#f5a623";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm font-bold text-white tracking-wider uppercase flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#f5a623]" /> Telemetry
        </h2>
        <div className="flex rounded-full p-0.5" style={{ background: "#27272a" }}>
          {(["strategist", "scanner"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setActiveTab(t); setExpandedId(null); }}
              className="px-3 py-1 rounded-full font-mono text-[12px] font-bold tracking-wider"
              style={{
                background: activeTab === t ? "#3f3f46" : "transparent",
                color: activeTab === t ? "#fff" : "#71717a",
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "strategist" && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#1a1a1a] border border-zinc-800 flex-1">
            <SearchIcon className="w-3.5 h-3.5 text-zinc-500" />
            <input
              value={tickerFilter}
              onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
              placeholder="Filter by ticker..."
              className="bg-transparent font-mono text-xs text-white flex-1 outline-none placeholder:text-zinc-600"
            />
          </div>
          <select
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-[#1a1a1a] border border-zinc-800 font-mono text-xs text-white outline-none appearance-none cursor-pointer"
            style={{ minWidth: 100 }}
          >
            <option value="">All</option>
            <option value="recommendation">Recommendation</option>
            <option value="no_viable_setup">No Viable</option>
            <option value="toxic_block">Toxic Block</option>
            <option value="no_data">No Data</option>
          </select>
        </div>
      )}

      {loading && <div className="text-center text-zinc-500 font-mono text-xs py-6">Loading telemetry...</div>}

      {!loading && activeTab === "strategist" && (() => {
        const filtered = resultFilter ? stratRows.filter(r => r.result === resultFilter) : stratRows;
        return (
        <div className="space-y-2">
          {filtered.length === 0 && <div className="text-center text-zinc-600 font-mono text-xs py-6">{stratRows.length === 0 ? "No analyses recorded yet" : "No matches"}</div>}
          {filtered.map((row) => (
            <div key={row.id} className="rounded-lg overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
              <button
                onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                className="w-full px-3 py-2.5 flex items-center justify-between cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-[12px] text-white font-bold w-12 flex-shrink-0">{row.ticker}</span>
                  <span
                    className="font-mono text-[12px] font-bold px-1.5 py-0.5 rounded"
                    style={{ color: resultColor(row.result), background: `${resultColor(row.result)}15` }}
                  >
                    {row.result.toUpperCase().replace(/_/g, " ")}
                  </span>
                  {row.idioScore && (
                    <span className="font-mono text-[12px] text-zinc-300">
                      IO:{Math.round(row.idioScore.final * 100)}%
                    </span>
                  )}
                  {row.strategyDecision?.strategyType && (
                    <span className="font-mono text-[12px] text-zinc-400 hidden sm:inline">
                      {row.strategyDecision.strategyType.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-mono text-[12px] text-zinc-400">{fmtDt(row.timestamp)}</span>
                  {expandedId === row.id ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
                </div>
              </button>
              {expandedId === row.id && (
                <div className="px-4 pb-4 border-t border-zinc-800/50 space-y-3 pt-3">
                  {row.recommendationThesis && (
                    <div className="font-mono text-[13px] text-white leading-relaxed">{row.recommendationThesis}</div>
                  )}
                  {row.regime && (
                    <DetailBlock title="Regime" data={row.regime} />
                  )}
                  {row.idioScore && (
                    <DetailBlock title="IOScore" data={row.idioScore} />
                  )}
                  {row.toxicGate && (
                    <DetailBlock title="Toxic Gate" data={row.toxicGate} />
                  )}
                  {row.viability && (
                    <DetailBlock title="Viability" data={row.viability} />
                  )}
                  {row.earningsGate && (
                    <DetailBlock title="Earnings Gate" data={row.earningsGate} />
                  )}
                  {row.strategyDecision && (
                    <DetailBlock title="Strategy Decision" data={row.strategyDecision} />
                  )}
                  {(row.candidatesGenerated != null || row.candidatesFiltered != null) && (
                    <DetailBlock title="Candidates" data={{ generated: row.candidatesGenerated, filteredOut: row.candidatesFiltered, filterReasons: row.filterReasons }} />
                  )}
                  {row.edgeAttribution && (
                    <DetailBlock title="Edge Attribution" data={row.edgeAttribution} />
                  )}
                  {row.winningCandidate && (
                    <DetailBlock title="Winning Candidate" data={row.winningCandidate} />
                  )}
                  {row.tickerData && (
                    <DetailBlock title="Ticker Data" data={row.tickerData} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        );
      })()}

      {!loading && activeTab === "scanner" && (
        <div className="space-y-2">
          {scanRows.length === 0 && <div className="text-center text-zinc-600 font-mono text-xs py-6">No scanner runs recorded yet</div>}
          {scanRows.map((row) => (
            <div key={row.id} className="rounded-lg overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
              <button
                onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                className="w-full px-3 py-2.5 flex items-center justify-between cursor-pointer text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[12px] text-[#f5a623] font-bold">{row.mode}</span>
                  <span className="font-mono text-[12px] text-white">
                    {row.aboveThreshold ?? 0} above threshold
                  </span>
                  <span className="font-mono text-[12px] text-zinc-400">
                    / {row.universeSize ?? 0} scanned
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-mono text-[12px] text-zinc-400">{fmtDt(row.timestamp)}</span>
                  {expandedId === row.id ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
                </div>
              </button>
              {expandedId === row.id && (
                <div className="px-4 pb-4 border-t border-zinc-800/50 space-y-3 pt-3">
                  {row.regime && <DetailBlock title="Regime" data={row.regime} />}
                  {row.weightsUsed && <DetailBlock title="Weights" data={row.weightsUsed} />}
                  {row.catalystBonusAppliedTo?.length > 0 && (
                    <div className="font-mono text-[13px] text-white">
                      Catalyst bonus: {row.catalystBonusAppliedTo.join(", ")}
                    </div>
                  )}
                  {row.results && (
                    <DetailBlock title={`Results (${Array.isArray(row.results) ? row.results.length : 0})`} data={row.results} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailBlock({ title, data }: { title: string; data: any }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 font-mono text-[12px] text-zinc-400 uppercase tracking-wider hover:text-white">
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {title}
      </button>
      {open && (
        <pre className="mt-1.5 p-3 rounded bg-black/40 font-mono text-[13px] text-white overflow-x-auto max-h-80 whitespace-pre-wrap leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
