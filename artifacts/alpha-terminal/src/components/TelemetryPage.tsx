import React, { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Check, Trash2, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";

export function useTelemetryCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetchWithAuth("/api/telemetry/counts");
        if (res.ok && active) {
          const data = await res.json();
          setCount(data.unresolvedCount ?? 0);
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { active = false; clearInterval(id); };
  }, []);
  return count;
}

interface TelemetryEntry {
  id: number;
  timestamp: string;
  system: string;
  severity: "INFO" | "WARN" | "ERROR";
  message: string;
  details: Record<string, unknown> | null;
  resolved: boolean;
  feature: string | null;
  batchId: string | null;
}

const f = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";
const C = {
  bg: "#080808",
  card: "#111111",
  cardBorder: "#1a1a1c",
  amber: "#F59E0B",
  amberDim: "#F59E0B99",
  red: "#f23645",
  orange: "#FF8C00",
  dim: "#555",
  text: "#ccc",
  muted: "#777",
  border: "#1f1f22",
};

const SEV = {
  ERROR: { dot: C.red, border: C.red, text: "#ff8888", bg: "rgba(242,54,69,0.06)" },
  WARN: { dot: C.orange, border: C.orange, text: "#ffcc88", bg: "rgba(255,140,0,0.05)" },
  INFO: { dot: "#444", border: "#333", text: "#999", bg: "transparent" },
};

const SYSTEMS = [
  "SCHWAB_API", "SCHWAB_STREAM", "IBKR", "YAHOO", "SEC_EDGAR",
  "SCANNER", "STRATEGIST", "CHAT", "RISK_GATE", "EXIT_STAGING",
  "PUSH_NOTIFICATION", "MARKET_PULSE", "POLYGON_API", "DATABASE", "API",
];

function fmtSystem(sys: string): string {
  if (sys === "CHAT") return "Chat";
  return sys.replace(/_/g, " ");
}

function extractSubComponent(system: string, message: string): string {
  const m = message.toUpperCase();
  if (system === "IBKR") {
    if (m.includes("WEBSOCKET") || m.includes("RECONNECT")) return "WEBSOCKET";
    if (m.includes("QUOTE") || m.includes("CACHE")) return "QUOTES";
    if (m.includes("HISTORICAL") || m.includes("NEWS")) return "HISTORICAL";
    if (m.includes("BREADTH") || m.includes("TICK") || m.includes("TRIN") || m.includes("ADD")) return "BREADTH";
    if (m.includes("INFO EVENT") || m.includes("CODE")) return "STATUS";
    return "CORE";
  }
  if (system === "SCANNER") {
    if (m.includes("STOCK")) return "STOCK SCAN";
    if (m.includes("FLOW")) return "FLOW SCAN";
    if (m.includes("OPTIONS") || m.includes("OPTION")) return "OPTIONS";
    if (m.includes("SCAN")) return "SCAN";
    return "CORE";
  }
  if (system === "MARKET_PULSE") {
    if (m.includes("CLAUDE") || m.includes("NARRATIVE") || m.includes("AI")) return "CLAUDE AI";
    if (m.includes("IBKR") || m.includes("BREADTH")) return "IBKR";
    if (m.includes("SCHWAB") || m.includes("STREAM")) return "SCHWAB";
    if (m.includes("SCORE") || m.includes("PULSE")) return "SCORING";
    return "CORE";
  }
  if (system === "SCHWAB_API") {
    if (m.includes("AUTH") || m.includes("TOKEN") || m.includes("REFRESH")) return "AUTH";
    if (m.includes("ORDER")) return "ORDERS";
    if (m.includes("ACCOUNT") || m.includes("PORTFOLIO")) return "ACCOUNT";
    return "API";
  }
  if (system === "SCHWAB_STREAM") {
    if (m.includes("CONNECT") || m.includes("SOCKET")) return "WEBSOCKET";
    if (m.includes("PRICE") || m.includes("QUOTE")) return "PRICES";
    return "STREAM";
  }
  if (system === "STRATEGIST") {
    if (m.includes("STRIKE") || m.includes("DELTA")) return "STRIKE SEL";
    if (m.includes("IDEA") || m.includes("GENERATE")) return "IDEA GEN";
    if (m.includes("CRITIC") || m.includes("REVIEW")) return "CRITIC";
    return "CORE";
  }
  if (system === "RISK_GATE") {
    if (m.includes("POSITION")) return "POSITION";
    if (m.includes("EXPOSURE")) return "EXPOSURE";
    if (m.includes("MARGIN")) return "MARGIN";
    return "RISK";
  }
  if (system === "EXIT_STAGING") return "EXIT";
  if (system === "PUSH_NOTIFICATION") return "PUSH";
  if (system === "POLYGON_API") return "POLYGON";
  if (system === "SEC_EDGAR") return "FILINGS";
  if (system === "YAHOO") return "YAHOO";
  if (system === "DATABASE") return "DB";
  return "";
}

function truncateMessage(msg: string, maxLen = 45): string {
  const oneLine = msg.replace(/\n/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen) + "…";
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function relativeTimeDivider(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "JUST NOW";
  if (mins < 60) return `${mins} MIN AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} HR AGO`;
  return `${Math.floor(hrs / 24)} DAY AGO`;
}

function formatDetailValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

const META_KEYS_ORDER = [
  "status", "latency", "duration", "attempt", "attemptCount",
  "count", "total", "scanned", "queued", "passed", "skipped",
  "model", "tokens", "tokenCount", "symbol", "symbols",
];

function sortedMetaKeys(details: Record<string, unknown>): string[] {
  const keys = Object.keys(details).filter(k => details[k] !== null && details[k] !== undefined);
  const ordered: string[] = [];
  for (const mk of META_KEYS_ORDER) {
    if (keys.includes(mk)) ordered.push(mk);
  }
  for (const k of keys) {
    if (!ordered.includes(k)) ordered.push(k);
  }
  return ordered;
}

function TickerGrid({ tickers, highlightSet, label }: { tickers: string[]; highlightSet?: Set<string>; label?: string }) {
  if (tickers.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {label && (
        <div style={{ fontSize: 9, fontFamily: f, color: C.muted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
          {label} — {tickers.length} TICKERS
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {tickers.map((t: string) => {
          const up = t.toUpperCase();
          const isHighlighted = highlightSet?.has(up);
          return (
            <span key={t} style={{
              fontSize: 9, fontFamily: f, fontWeight: 600, padding: "2px 5px", borderRadius: 3,
              background: isHighlighted ? "rgba(46,204,113,0.12)" : "rgba(255,255,255,0.03)",
              color: isHighlighted ? "#2ecc71" : "#888",
              border: `1px solid ${isHighlighted ? "rgba(46,204,113,0.3)" : "#222"}`,
            }}>
              {up}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ScannerAudit({ details }: { details: Record<string, unknown> }) {
  const isUniverseBuild = details.type === "UNIVERSE_BUILD";
  const allSymbols = (details.symbols ?? []) as string[];

  if (isUniverseBuild && allSymbols.length > 0) {
    const totalCount = Number(details.totalCount ?? allSymbols.length);
    const match = totalCount === allSymbols.length;
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontFamily: f, color: C.muted }}>
            CLAIMED <span style={{ color: C.text }}>{totalCount}</span>
          </span>
          <span style={{ fontSize: 10, fontFamily: f, color: C.muted }}>
            ACTUAL <span style={{ color: match ? "#2ecc71" : C.orange }}>{allSymbols.length}</span>
          </span>
          {match
            ? <span style={{ fontSize: 10, fontFamily: f, color: "#2ecc71", fontWeight: 700 }}>✓ VERIFIED</span>
            : <span style={{ fontSize: 10, fontFamily: f, color: C.orange, fontWeight: 700 }}>⚠ MISMATCH</span>
          }
        </div>
        <TickerGrid tickers={allSymbols} label="UNIVERSE SYMBOLS" />
      </div>
    );
  }

  const queued = Number(details.queued ?? details.totalQueued ?? details.totalScanned ?? 0);
  const scanned = Number(details.scanned ?? details.totalScanned ?? 0);
  const passed = Number(details.passed ?? details.totalPassed ?? details.candidates ?? details.passedFilters ?? 0);
  const missed = queued > 0 && scanned > 0 ? queued - scanned : 0;

  const passedTickers = (details.passedTickers ?? details.passed_tickers ?? details.results ?? []) as string[];
  const scannedTickers = (details.scannedTickers ?? details.scanned_tickers ?? details.universe ?? allSymbols) as string[];
  const passedSet = new Set(passedTickers.map((t: string) => t.toUpperCase()));

  if (scannedTickers.length === 0 && passedTickers.length === 0 && queued === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        {queued > 0 && <span style={{ fontSize: 10, fontFamily: f, color: C.muted }}>QUEUED <span style={{ color: C.text }}>{queued}</span></span>}
        {scanned > 0 && <span style={{ fontSize: 10, fontFamily: f, color: C.muted }}>SCANNED <span style={{ color: queued > 0 && queued !== scanned ? C.orange : C.text }}>{scanned}</span></span>}
        {passed > 0 && <span style={{ fontSize: 10, fontFamily: f, color: C.muted }}>PASSED <span style={{ color: "#2ecc71" }}>{passed}</span></span>}
      </div>
      {scannedTickers.length > 0 && (
        <TickerGrid tickers={scannedTickers} highlightSet={passedSet} label={passedTickers.length > 0 ? "SCANNED (GREEN = PASSED)" : "SCANNED"} />
      )}
      {missed > 0 && (
        <div style={{ fontSize: 10, fontStyle: "italic", color: C.orange, marginTop: 4, fontFamily: f }}>
          {missed} ticker{missed !== 1 ? "s" : ""} queued but not scanned (timeout/rate limit)
        </div>
      )}
    </div>
  );
}

const HIDE_FROM_META = new Set(["symbols", "passedTickers", "scannedTickers", "passed_tickers", "scanned_tickers", "universe", "results"]);

function MetadataGrid({ details, severity }: { details: Record<string, unknown>; severity: string }) {
  const keys = sortedMetaKeys(details).filter(k => !HIDE_FROM_META.has(k));
  const simpleKeys = keys.filter(k => typeof details[k] !== "object" || details[k] === null);
  const complexKeys = keys.filter(k => typeof details[k] === "object" && details[k] !== null);

  return (
    <div>
      {simpleKeys.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 4, marginBottom: complexKeys.length > 0 ? 6 : 0 }}>
          {simpleKeys.map(k => (
            <div key={k} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1a1a1c", borderRadius: 4, padding: "4px 8px" }}>
              <div style={{ fontSize: 8, fontFamily: f, color: C.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 1 }}>{k}</div>
              <div style={{ fontSize: 11, fontFamily: f, color: C.text, wordBreak: "break-all" }}>{formatDetailValue(details[k])}</div>
            </div>
          ))}
        </div>
      )}
      {complexKeys.map(k => (
        <div key={k} style={{ marginTop: 4 }}>
          <div style={{ fontSize: 8, fontFamily: f, color: C.dim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{k}</div>
          <pre style={{
            fontSize: 11, fontFamily: f, color: C.text,
            background: "#0a0a0a", padding: 6, borderRadius: 4,
            margin: 0, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.4,
          }}>
            {JSON.stringify(details[k], null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function LogCard({ entry, onResolve }: { entry: TelemetryEntry; onResolve: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEV[entry.severity] ?? SEV.INFO;
  const sub = extractSubComponent(entry.system, entry.message);
  const isScanner = entry.system === "SCANNER";

  return (
    <div style={{
      background: C.card,
      borderRadius: 6,
      border: `1px solid ${C.cardBorder}`,
      borderLeft: `3px solid ${sev.border}`,
      opacity: entry.resolved ? 0.4 : 1,
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "grid",
          gridTemplateColumns: "7px 1fr auto 14px",
          alignItems: "center",
          gap: 8,
          padding: "10px 10px 10px 12px",
          cursor: "pointer",
        }}
      >
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: sev.dot }} />

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.amber, fontFamily: f, letterSpacing: 0.5 }}>
              {fmtSystem(entry.system)}
            </span>
            {sub && (
              <span style={{ fontSize: 11, color: C.muted, fontFamily: f }}>
                · {sub}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#aaa", fontFamily: f, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
            {truncateMessage(entry.message, 80)}
          </div>
        </div>

        <span style={{ fontSize: 11, color: C.dim, fontFamily: f, whiteSpace: "nowrap" }}>
          {formatTime(entry.timestamp)}
        </span>

        <div>
          {expanded
            ? <ChevronDown style={{ width: 12, height: 12, color: C.dim }} />
            : <ChevronRight style={{ width: 12, height: 12, color: C.dim }} />
          }
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 12px 10px 22px", borderTop: `1px solid ${C.border}` }}>
          <div style={{
            fontSize: 12, fontFamily: f, color: sev.text,
            whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5,
            padding: "8px 0",
          }}>
            {entry.message}
          </div>

          {entry.details && Object.keys(entry.details).length > 0 && (
            <MetadataGrid details={entry.details} severity={entry.severity} />
          )}

          {isScanner && entry.details && <ScannerAudit details={entry.details} />}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <span style={{ fontSize: 10, fontFamily: f, color: C.dim }}>
              ID {entry.id} · {entry.batchId ? `Batch ${entry.batchId.slice(0, 8)}` : "No batch"}
              {entry.feature ? ` · ${entry.feature}` : ""}
            </span>
            {!entry.resolved && entry.severity !== "INFO" && (
              <button
                onClick={e => { e.stopPropagation(); onResolve(entry.id); }}
                style={{
                  padding: "2px 8px", borderRadius: 3, fontSize: 10, fontFamily: f,
                  background: "rgba(0,209,102,0.08)", border: "1px solid #00d16630",
                  color: "#00d166", cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
                }}
              >
                <Check style={{ width: 10, height: 10 }} /> RESOLVE
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SystemDropdown({
  value, onChange, perSystemCounts, entries,
}: {
  value: string | null;
  onChange: (sys: string | null) => void;
  perSystemCounts: Record<string, number>;
  entries: TelemetryEntry[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const systemsWithData = new Set(entries.map(e => e.system));
  const extraSystems = [...systemsWithData].filter(s => !SYSTEMS.includes(s));
  const activeSystemsList = [...SYSTEMS, ...extraSystems];

  const getSystemBadges = (sys: string) => {
    const errs = entries.filter(e => e.system === sys && e.severity === "ERROR" && !e.resolved).length;
    const warns = entries.filter(e => e.system === sys && e.severity === "WARN" && !e.resolved).length;
    return { errs, warns };
  };

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", background: "#0e0e0e", border: `1px solid ${C.cardBorder}`,
          borderRadius: 6, cursor: "pointer", fontFamily: f,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: value ? C.amber : C.text, letterSpacing: 0.5 }}>
          {value ? fmtSystem(value) : "ALL SYSTEMS"}
        </span>
        <ChevronDown style={{ width: 14, height: 14, color: C.dim, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "#0e0e0e", border: `1px solid ${C.cardBorder}`, borderRadius: 6,
          marginTop: 2, maxHeight: 300, overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "9px 14px", background: !value ? "rgba(245,158,11,0.06)" : "transparent",
              border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", fontFamily: f, textAlign: "left",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: !value ? C.amber : C.muted }}>ALL SYSTEMS</span>
          </button>
          {activeSystemsList.map(sys => {
            const b = getSystemBadges(sys);
            const isActive = value === sys;
            return (
              <button
                key={sys}
                onClick={() => { onChange(sys); setOpen(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 14px", background: isActive ? "rgba(245,158,11,0.06)" : "transparent",
                  border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", fontFamily: f, textAlign: "left",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? C.amber : "#999" }}>{fmtSystem(sys)}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  {b.errs > 0 && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: C.red, padding: "1px 5px", borderRadius: 4, background: "rgba(242,54,69,0.12)", fontFamily: f }}>
                      {b.errs} ERR
                    </span>
                  )}
                  {b.warns > 0 && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: C.orange, padding: "1px 5px", borderRadius: 4, background: "rgba(255,140,0,0.10)", fontFamily: f }}>
                      {b.warns} WARN
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type SevFilter = "ALL" | "ERROR" | "WARN" | "INFO";

export function TelemetryPage() {
  const [entries, setEntries] = useState<TelemetryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSystem, setFilterSystem] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<SevFilter>("ALL");
  const [perSystemCounts, setPerSystemCounts] = useState<Record<string, number>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [totalErrors, setTotalErrors] = useState(0);
  const [totalWarns, setTotalWarns] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollTop = useRef(0);

  const fetchEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("limit", "500");
      params.set("showResolved", "true");
      const res = await fetchWithAuth(`/api/telemetry?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/telemetry/counts");
      if (res.ok) {
        const data = await res.json();
        setPerSystemCounts(data.perSystem ?? {});
        setTotalErrors(data.errors ?? 0);
        setTotalWarns(data.warns ?? 0);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchEntries(); fetchCounts(); }, [fetchEntries, fetchCounts]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        if (scrollRef.current) prevScrollTop.current = scrollRef.current.scrollTop;
        fetchEntries().then(() => {
          if (scrollRef.current && prevScrollTop.current > 50) {
            scrollRef.current.scrollTop = prevScrollTop.current;
          }
        });
        fetchCounts();
      }, 3000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchEntries, fetchCounts]);

  useEffect(() => {
    if (filterSystem) {
      fetchWithAuth(`/api/telemetry/reset-count/${filterSystem}`, { method: "POST" }).catch(() => {});
    }
  }, [filterSystem]);

  const handleResolve = async (id: number) => {
    const res = await fetchWithAuth(`/api/telemetry/${id}/resolve`, { method: "PATCH" });
    if (res.ok) {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, resolved: true } : e));
    }
  };

  const handleClear = async () => {
    const res = await fetchWithAuth(`/api/telemetry/clear`, { method: "DELETE" });
    if (res.ok) { setEntries([]); setPerSystemCounts({}); setTotalErrors(0); setTotalWarns(0); }
  };

  const filtered = entries.filter(e => {
    if (filterSystem && e.system !== filterSystem) return false;
    if (filterSeverity !== "ALL" && e.severity !== filterSeverity) return false;
    return true;
  });

  const sevFilters: SevFilter[] = ["ALL", "ERROR", "WARN", "INFO"];
  const sevColors: Record<SevFilter, { active: string; border: string }> = {
    ALL: { active: C.amber, border: C.amber + "60" },
    ERROR: { active: C.red, border: C.red + "60" },
    WARN: { active: C.orange, border: C.orange + "60" },
    INFO: { active: "#888", border: "#555" },
  };

  let lastDivider = "";

  const totalEvents = entries.length;
  const batchIds = new Set(entries.filter(e => e.batchId).map(e => e.batchId));
  const ungroupedCount = entries.filter(e => !e.batchId).length;

  return (
    <div style={{ color: C.text, fontSize: 14, fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "0 0 8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontFamily: f, fontWeight: 700, letterSpacing: 1.5, color: C.dim, textTransform: "uppercase" }}>
            TELEMETRY
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {totalErrors > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: C.red, fontFamily: f }}>● {totalErrors} ERR</span>}
            {totalWarns > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: C.orange, fontFamily: f }}>● {totalWarns} WARN</span>}
            <button onClick={handleClear} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontFamily: f, background: "rgba(242,54,69,0.06)", border: "1px solid #f2364530", color: C.red, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
              <Trash2 style={{ width: 10, height: 10 }} />
            </button>
          </div>
        </div>

        <SystemDropdown value={filterSystem} onChange={setFilterSystem} perSystemCounts={perSystemCounts} entries={entries} />

        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8 }}>
          <div style={{ fontSize: 11, fontFamily: f, color: C.dim, marginRight: 4 }}>
            {totalEvents} events · {batchIds.size} batches{ungroupedCount > 0 ? ` · ${ungroupedCount} ungrouped` : ""}
          </div>
          {autoRefresh && <span style={{ fontSize: 10, color: "#26a69a", fontFamily: f, fontWeight: 700 }}>● LIVE</span>}
        </div>

        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          {sevFilters.map(sev => {
            const active = filterSeverity === sev;
            const sc = sevColors[sev];
            return (
              <button
                key={sev}
                onClick={() => setFilterSeverity(active && sev === "ALL" ? "ALL" : sev)}
                style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, fontFamily: f,
                  letterSpacing: 0.5,
                  background: active ? `${sc.active}15` : "transparent",
                  border: `1px solid ${active ? sc.border : "#2a2a2c"}`,
                  color: active ? sc.active : C.dim,
                  cursor: "pointer",
                }}
              >
                {sev}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, paddingBottom: 16 }}>
        {loading ? (
          <div style={{ textAlign: "center", color: C.dim, padding: 40, fontFamily: f, fontSize: 12 }}>
            Loading telemetry…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: "#333", padding: 40, fontFamily: f, fontSize: 12 }}>
            No events{filterSystem || filterSeverity !== "ALL" ? " matching filters" : ""}
          </div>
        ) : (
          filtered.map(entry => {
            const divider = relativeTimeDivider(entry.timestamp);
            let showDivider = false;
            if (divider !== lastDivider) {
              lastDivider = divider;
              showDivider = true;
            }
            return (
              <React.Fragment key={entry.id}>
                {showDivider && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 0", margin: "2px 0",
                  }}>
                    <div style={{ flex: 1, height: 1, background: C.border }} />
                    <span style={{ fontSize: 9, fontFamily: f, fontWeight: 700, color: C.dim, letterSpacing: 1.5 }}>
                      {divider}
                    </span>
                    <div style={{ flex: 1, height: 1, background: C.border }} />
                  </div>
                )}
                <LogCard entry={entry} onResolve={handleResolve} />
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
