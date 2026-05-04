import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ChevronDown, ChevronUp, Activity, Search as SearchIcon, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  fullDiagnostic?: unknown;
  dataPackage?: unknown;
  rawAiResponse?: string | null;
  confidenceBase?: number | null;
  confidenceCatalystDelta?: number | null;
  confidenceFinal?: number | null;
  scannerSource?: string | null;
  scannerScore?: number | null;
  scannerEdgeType?: string | null;
  scannerDirectionalLean?: string | null;
  scannerMode?: string | null;
  scannerSurfacedBy?: string | null;
  scannerFlowScore?: number | null;
  scannerUniverse?: string | null;
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

function parseDataPackageRecord(dataPackage: unknown): Record<string, unknown> | null {
  if (dataPackage == null) return null;
  if (typeof dataPackage === "string") {
    try {
      const v = JSON.parse(dataPackage) as unknown;
      return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof dataPackage === "object" && !Array.isArray(dataPackage)) {
    return dataPackage as Record<string, unknown>;
  }
  return null;
}

/** Portfolio manager decision from persisted strategist payload (desk v2 / AI shape). */
function readStrategistPmDecision(dataPackage: unknown): string | null {
  const dp = parseDataPackageRecord(dataPackage);
  if (!dp) return null;
  const sp = dp.strategistPayload;
  if (sp == null || typeof sp !== "object" || Array.isArray(sp)) return null;
  const pm = (sp as Record<string, unknown>).pm;
  if (pm == null || typeof pm !== "object" || Array.isArray(pm)) return null;
  const d = (pm as Record<string, unknown>).decision;
  if (typeof d !== "string") return null;
  return d.trim().toLowerCase();
}

function resultColorLegacy(r: string) {
  if (r === "recommendation") return "#2ecc71";
  if (r === "toxic_block") return "#ff4b5c";
  return "#f5a623";
}

function formatLegacyResultLabel(result: string) {
  return result.toUpperCase().replace(/_/g, " ");
}

type DecisionBadge = { label: string; color: string };

function getDecisionBadge(row: TelemetryRow): DecisionBadge {
  const pmDecision = readStrategistPmDecision(row.dataPackage);
  if (pmDecision === "trade") {
    return { label: "TRADE", color: "#2ecc71" };
  }
  if (pmDecision === "pass") {
    return { label: "PASS", color: "#f5a623" };
  }
  if (pmDecision === "no_viable_setup") {
    return { label: "NO SETUP", color: "#a1a1aa" };
  }
  const r = row.result;
  return { label: formatLegacyResultLabel(r), color: resultColorLegacy(r) };
}

const DP_KEYS_STRATEGIST = ["strategistPayload"] as const;
const DP_KEYS_VOL = ["optionsChainSummary", "realizedVol", "ivrContext"] as const;
const DP_KEYS_OPTIONS = ["curatedExpirations", "availableExpirations"] as const;
const DP_KEYS_FLOW = ["polygonFlowHighlights", "tapeBackfill"] as const;
const DP_KEYS_CATALYST = ["catalyst", "macroEventsInPositionWindow", "nextEarnings", "polygonAnalyst"] as const;
const DP_KEYS_DATA_QUALITY = ["dataQualitySummary"] as const;

const DP_KEYS_OTHER_SECTIONS: ReadonlySet<string> = new Set([
  ...DP_KEYS_STRATEGIST,
  ...DP_KEYS_VOL,
  ...DP_KEYS_OPTIONS,
  ...DP_KEYS_FLOW,
  ...DP_KEYS_CATALYST,
  ...DP_KEYS_DATA_QUALITY,
  "catalystEvaluation",
]);

type CopySectionId =
  | "summary"
  | "strategistOutput"
  | "decisionContext"
  | "volSurface"
  | "optionsChain"
  | "flow"
  | "catalyst"
  | "dataQuality"
  | "diagnostic"
  | "rawAiResponse";

const COPY_SECTIONS_STORAGE_KEY = "strategistTelemetryCopySections";

const COPY_SECTIONS: { id: CopySectionId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "strategistOutput", label: "Strategist Output" },
  { id: "decisionContext", label: "Decision Context" },
  { id: "volSurface", label: "Vol Surface" },
  { id: "optionsChain", label: "Options Chain" },
  { id: "flow", label: "Flow" },
  { id: "catalyst", label: "Catalyst" },
  { id: "dataQuality", label: "Data Quality" },
  { id: "diagnostic", label: "Diagnostic" },
  { id: "rawAiResponse", label: "Raw AI Response" },
];

function pickDp(dp: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in dp) out[k] = dp[k];
  }
  return out;
}

function pickSummaryDataPackageSlice(dp: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(dp)) {
    if (!DP_KEYS_OTHER_SECTIONS.has(k)) out[k] = dp[k];
  }
  return out;
}

function buildSectionedCopyPayload(row: TelemetryRow, selected: ReadonlySet<CopySectionId>): Record<string, unknown> {
  const dp = parseDataPackageRecord(row.dataPackage);
  const out: Record<string, unknown> = {};

  if (selected.has("summary")) {
    const summary: Record<string, unknown> = {
      ticker: row.ticker,
      timestamp: row.timestamp,
      result: row.result,
      scannerSource: row.scannerSource ?? null,
      scannerScore: row.scannerScore ?? null,
      scannerEdgeType: row.scannerEdgeType ?? null,
      scannerDirectionalLean: row.scannerDirectionalLean ?? null,
      scannerMode: row.scannerMode ?? null,
      scannerSurfacedBy: row.scannerSurfacedBy ?? null,
      scannerFlowScore: row.scannerFlowScore ?? null,
      scannerUniverse: row.scannerUniverse ?? null,
    };
    if (dp) Object.assign(summary, pickSummaryDataPackageSlice(dp));
    out.summary = summary;
  }

  if (selected.has("strategistOutput")) {
    out.strategistOutput = dp ? pickDp(dp, DP_KEYS_STRATEGIST as unknown as string[]) : {};
  }

  if (selected.has("decisionContext")) {
    out.decisionContext = {
      regime: row.regime ?? null,
      tickerData: row.tickerData ?? null,
      idioScore: row.idioScore ?? null,
      toxicGate: row.toxicGate ?? null,
      catalystEvaluation: dp?.catalystEvaluation ?? null,
      edgeAttribution: row.edgeAttribution ?? null,
    };
  }

  if (selected.has("volSurface")) {
    out.volSurface = dp ? pickDp(dp, DP_KEYS_VOL as unknown as string[]) : {};
  }

  if (selected.has("optionsChain")) {
    out.optionsChain = dp ? pickDp(dp, DP_KEYS_OPTIONS as unknown as string[]) : {};
  }

  if (selected.has("flow")) {
    out.flow = dp ? pickDp(dp, DP_KEYS_FLOW as unknown as string[]) : {};
  }

  if (selected.has("catalyst")) {
    out.catalyst = dp ? pickDp(dp, DP_KEYS_CATALYST as unknown as string[]) : {};
  }

  if (selected.has("dataQuality")) {
    out.dataQuality = dp ? pickDp(dp, DP_KEYS_DATA_QUALITY as unknown as string[]) : {};
  }

  if (selected.has("diagnostic")) {
    out.diagnostic = row.fullDiagnostic ?? null;
  }

  if (selected.has("rawAiResponse")) {
    out.rawAiResponse = {
      rawAiResponse: row.rawAiResponse ?? null,
      confidenceBase: row.confidenceBase ?? null,
      confidenceCatalystDelta: row.confidenceCatalystDelta ?? null,
      confidenceFinal: row.confidenceFinal ?? null,
    };
  }

  return out;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
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
          {filtered.map((row) => {
            const badge = getDecisionBadge(row);
            return (
            <div key={row.id} className="rounded-lg overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
              <button
                onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                className="w-full px-3 py-2.5 flex items-center justify-between cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-[12px] text-white font-bold w-12 flex-shrink-0">{row.ticker}</span>
                  <span
                    className="font-mono text-[12px] font-bold px-1.5 py-0.5 rounded"
                    style={{ color: badge.color, background: `${badge.color}15` }}
                  >
                    {badge.label}
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
                  <TelemetryEntryCopyButton row={row} />
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
            );
          })}
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

function emptyChecked(): Record<CopySectionId, boolean> {
  return Object.fromEntries(COPY_SECTIONS.map((s) => [s.id, false])) as Record<CopySectionId, boolean>;
}

function readStoredCopySelection(): Record<CopySectionId, boolean> | null {
  try {
    const raw = sessionStorage.getItem(COPY_SECTIONS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const next = emptyChecked();
    for (const id of parsed) {
      if (typeof id === "string" && id in next) next[id as CopySectionId] = true;
    }
    return next;
  } catch {
    return null;
  }
}

function TelemetryEntryCopyButton({ row }: { row: TelemetryRow }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<CopySectionId, boolean>>(emptyChecked);
  const [justCopiedIcon, setJustCopiedIcon] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      const stored = readStoredCopySelection();
      setChecked(stored ?? emptyChecked());
    }
  }, []);

  const allSelected = COPY_SECTIONS.every((s) => checked[s.id]);
  const noneSelected = COPY_SECTIONS.every((s) => !checked[s.id]);

  const toggleSelectAll = useCallback(() => {
    const nextVal = !allSelected;
    setChecked(Object.fromEntries(COPY_SECTIONS.map((s) => [s.id, nextVal])) as Record<CopySectionId, boolean>);
  }, [allSelected]);

  const toggleOne = useCallback((id: CopySectionId) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) el.indeterminate = !allSelected && !noneSelected;
  }, [allSelected, noneSelected]);

  const flashCopied = useCallback(() => {
    setJustCopiedIcon(true);
    window.setTimeout(() => setJustCopiedIcon(false), 2000);
  }, []);

  const onCopySelected = useCallback(async () => {
    const ids = COPY_SECTIONS.filter((s) => checked[s.id]).map((s) => s.id);
    if (ids.length === 0) {
      toast.message("Select at least one section");
      return;
    }
    const payload = buildSectionedCopyPayload(row, new Set(ids));
    const text = JSON.stringify(payload, null, 2);
    const ok = await writeClipboard(text);
    if (ok) {
      try {
        sessionStorage.setItem(COPY_SECTIONS_STORAGE_KEY, JSON.stringify(ids));
      } catch {
        /* ignore quota / private mode */
      }
      toast.message(`Copied ${ids.length} section${ids.length === 1 ? "" : "s"}`);
      setOpen(false);
      flashCopied();
    }
  }, [row, checked, flashCopied]);

  const onExportFull = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      const payload = { id: row.id, timestamp: row.timestamp, ticker: row.ticker, result: row.result, fullRow: row };
      const text = JSON.stringify(payload);
      const ok = await writeClipboard(text);
      if (ok) {
        toast.message("Copied full row");
        setOpen(false);
        flashCopied();
      }
    },
    [row, flashCopied],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Copy telemetry sections"
          aria-expanded={open}
          className="inline-flex items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800 shrink-0"
          style={{ minWidth: 44, minHeight: 44 }}
        >
          {justCopiedIcon ? <Check className="w-4 h-4 text-emerald-400" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(100vw-2rem,22rem)] max-h-[min(70vh,28rem)] overflow-y-auto border-zinc-700 bg-zinc-950 p-3 text-zinc-100 shadow-xl"
        align="end"
        side="bottom"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Copy sections</div>
        <label className="flex items-center gap-2 cursor-pointer py-1.5 border-b border-zinc-800 mb-1">
          <input
            ref={selectAllRef}
            type="checkbox"
            className="rounded border-zinc-600"
            checked={allSelected}
            onChange={toggleSelectAll}
          />
          <span className="font-mono text-xs">Select all</span>
        </label>
        <ul className="space-y-1 mb-3">
          {COPY_SECTIONS.map((s) => (
            <li key={s.id}>
              <label className="flex items-start gap-2 cursor-pointer py-1 rounded hover:bg-zinc-900/80 px-1 -mx-1">
                <input
                  type="checkbox"
                  className="rounded border-zinc-600 mt-0.5 shrink-0"
                  checked={checked[s.id]}
                  onChange={() => toggleOne(s.id)}
                />
                <span className="font-mono text-[12px] text-zinc-200 leading-snug">{s.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onCopySelected}
          className="w-full font-mono text-xs font-bold py-2 rounded-md bg-zinc-100 text-zinc-900 hover:bg-white mb-2"
        >
          Copy selected
        </button>
        <button
          type="button"
          onClick={onExportFull}
          className="w-full text-center font-mono text-[11px] text-zinc-500 hover:text-zinc-300 underline-offset-2 hover:underline py-1"
        >
          Export full row
        </button>
      </PopoverContent>
    </Popover>
  );
}

function DetailBlock({ title, data }: { title: string; data: any }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 font-mono text-[12px] text-zinc-400 uppercase tracking-wider hover:text-white">
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
