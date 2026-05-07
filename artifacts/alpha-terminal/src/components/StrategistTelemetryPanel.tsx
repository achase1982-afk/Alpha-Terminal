import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ChevronDown, ChevronUp, Activity, Search as SearchIcon, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import {
  buildSectionedCopyPayload,
  COPY_SECTIONS,
  COPY_SECTIONS_STORAGE_KEY,
  parseDataPackageRecord,
  type CopySectionId,
} from "@/lib/strategistTelemetryCopyPayload";
import { TELEMETRY_COPY_LAYER_Z } from "@/lib/telemetryCopyLayer";

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
  if (r === "recommendation" || r === "desk_recommendation") return "#2ecc71";
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

/** Single `document.body` portal — no Popover/Vaul nesting inside Telemetry scroll areas. */
function TelemetryCopyModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-3 sm:p-4"
      style={{ zIndex: TELEMETRY_COPY_LAYER_Z }}
    >
      <button type="button" className="absolute inset-0 bg-black/80" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-copy-modal-title"
        className="relative z-[1] flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-zinc-600 bg-[#0c0c0c] p-4 text-zinc-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="telemetry-copy-modal-title" className="mb-3 font-mono text-sm font-bold uppercase tracking-wider text-zinc-300">
          {title}
        </h2>
        <div className="min-h-0 flex flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function StrategistTelemetryPanel() {
  const [activeTab, setActiveTab] = useState<"strategist" | "scanner">("strategist");
  const [stratRows, setStratRows] = useState<TelemetryRow[]>([]);
  const [scanRows, setScanRows] = useState<ScannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [tickerFilter, setTickerFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<string>("");
  const [ibkrTickLine, setIbkrTickLine] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, scRes, ibRes] = await Promise.all([
        fetchWithAuth(`/api/strategist/telemetry/strategist?limit=50${tickerFilter ? `&ticker=${tickerFilter}` : ""}`),
        fetchWithAuth("/api/strategist/telemetry/scanner?limit=20"),
        fetchWithAuth("/api/diagnostics/ibkr-tick-pilot/latest-summary"),
      ]);
      if (sRes.ok) setStratRows(await sRes.json());
      if (scRes.ok) setScanRows(await scRes.json());
      if (ibRes.ok) {
        const j = await ibRes.json();
        const latest = j.latest as { runStartedAt?: string; summary?: { nasdaq: string; nyse: string } } | null;
        if (latest?.summary && latest.runStartedAt) {
          const d = new Date(latest.runStartedAt);
          const ts = d.toLocaleString("en-US", {
            timeZone: "America/New_York",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          const n = latest.summary.nasdaq === "PASS" ? "✓" : latest.summary.nasdaq === "FAIL" ? "✗" : "⚠";
          const y = latest.summary.nyse === "PASS" ? "✓" : latest.summary.nyse === "FAIL" ? "✗" : "⚠";
          setIbkrTickLine(`IBKR tick entitlement: NASDAQ ${n} NYSE ${y} — last tested ${ts} ET`);
        } else {
          setIbkrTickLine("IBKR tick entitlement: Not tested — run from Settings.");
        }
      } else {
        setIbkrTickLine("IBKR tick entitlement: Not tested — run from Settings.");
      }
    } catch {
      setIbkrTickLine("IBKR tick entitlement: Not tested — run from Settings.");
    }
    setLoading(false);
  }, [tickerFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const fmtDt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  };

  return (
    <div className="space-y-4">
      {ibkrTickLine && (
        <p className="font-mono text-[10px] text-zinc-500 border border-[#2A2A2C] rounded-md px-2 py-1.5 bg-[#0c0c0c]" role="status">
          {ibkrTickLine}
        </p>
      )}
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
            <option value="desk_recommendation">Desk recommendation</option>
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
            <div key={row.id} className="rounded-lg border border-[#2A2A2C] bg-[#111113]">
              <div className="flex items-stretch gap-1 px-2 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
                  onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                >
                  <span className="w-12 flex-shrink-0 font-mono text-[12px] font-bold text-white">{row.ticker}</span>
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
                    <span className="hidden font-mono text-[12px] text-zinc-400 sm:inline">
                      {row.strategyDecision.strategyType.replace(/_/g, " ")}
                    </span>
                  )}
                </button>
                <div className="flex shrink-0 items-center gap-2 py-1">
                  <TelemetryEntryCopyButton row={row} />
                  <span className="font-mono text-[12px] text-zinc-400">{fmtDt(row.timestamp)}</span>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center p-1 text-zinc-400 hover:text-white"
                    aria-expanded={expandedId === row.id}
                    aria-label={expandedId === row.id ? "Collapse row" : "Expand row"}
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  >
                    {expandedId === row.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
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
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openModal = useCallback(() => {
    setOpen(true);
    const stored = readStoredCopySelection();
    setChecked(stored ?? emptyChecked());
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => selectAllRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

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
        /* ignore */
      }
      toast.message(`Copied ${ids.length} section${ids.length === 1 ? "" : "s"}`);
      close();
      flashCopied();
    }
  }, [row, checked, close, flashCopied]);

  const onExportFull = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      const payload = { id: row.id, timestamp: row.timestamp, ticker: row.ticker, result: row.result, fullRow: row };
      const text = JSON.stringify(payload);
      const ok = await writeClipboard(text);
      if (ok) {
        toast.message("Copied full row");
        close();
        flashCopied();
      }
    },
    [row, close, flashCopied],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openModal();
        }}
        aria-label="Copy telemetry sections"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
        style={{ minWidth: 44, minHeight: 44 }}
      >
        {justCopiedIcon ? <Check className="h-4 w-4 text-emerald-400" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      </button>
      <TelemetryCopyModal open={open} onClose={close} title="Copy sections">
        <div className="flex min-h-0 flex-1 flex-col" onClick={(e) => e.stopPropagation()}>
          <label className="mb-2 flex cursor-pointer items-center gap-2 border-b border-zinc-800 py-2">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="rounded border-zinc-600"
              checked={allSelected}
              onChange={toggleSelectAll}
            />
            <span className="font-mono text-xs">Select all</span>
          </label>
          <div className="max-h-60 min-h-0 overflow-y-auto overscroll-contain py-1 sm:max-h-72">
            <ul className="space-y-1">
              {COPY_SECTIONS.map((s) => (
                <li key={s.id}>
                  <label className="-mx-1 flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-zinc-900/80">
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0 rounded border-zinc-600"
                      checked={checked[s.id]}
                      onChange={() => toggleOne(s.id)}
                    />
                    <span className="font-mono text-[12px] leading-snug text-zinc-200">{s.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 shrink-0 border-t border-zinc-800 pt-3">
            <button
              type="button"
              onClick={onCopySelected}
              className="mb-2 w-full rounded-md bg-zinc-100 py-2 font-mono text-xs font-bold text-zinc-900 hover:bg-white"
            >
              Copy selected
            </button>
            <button
              type="button"
              onClick={onExportFull}
              className="w-full py-1 text-center font-mono text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
            >
              Export full row
            </button>
          </div>
        </div>
      </TelemetryCopyModal>
    </>
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
