import React, { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { RotateCcw, Check, Trash2, Filter, ChevronDown, ChevronRight } from "lucide-react";

interface TelemetryEntry {
  id: number;
  timestamp: string;
  system: string;
  severity: "INFO" | "WARN" | "ERROR";
  message: string;
  details: Record<string, unknown> | null;
  resolved: boolean;
}

const SYSTEMS = [
  "SCHWAB_API", "SCHWAB_STREAM", "IBKR", "YAHOO", "SEC_EDGAR",
  "SCANNER", "STRATEGIST", "RISK_GATE", "EXIT_STAGING",
  "PUSH_NOTIFICATION", "MARKET_PULSE",
];

const SEVERITIES = ["ERROR", "WARN", "INFO"] as const;

const SEV_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ERROR: { bg: "rgba(242,54,69,0.10)", text: "#f23645", border: "#f2364580" },
  WARN: { bg: "rgba(255,184,0,0.08)", text: "#FFB800", border: "#FFB80060" },
  INFO: { bg: "rgba(255,255,255,0.03)", text: "#888", border: "#333" },
};

export function TelemetryPage() {
  const [entries, setEntries] = useState<TelemetryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSystem, setFilterSystem] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [perSystemCounts, setPerSystemCounts] = useState<Record<string, number>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterSystem) params.set("system", filterSystem);
      if (filterSeverity) params.set("severity", filterSeverity);
      if (showResolved) params.set("showResolved", "true");
      params.set("limit", "500");
      const res = await fetchWithAuth(`/api/telemetry?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [filterSystem, filterSeverity, showResolved]);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/telemetry/counts");
      if (res.ok) {
        const data = await res.json();
        setPerSystemCounts(data.perSystem ?? {});
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchCounts();
  }, [fetchEntries, fetchCounts]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchEntries();
        fetchCounts();
      }, 3000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
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
    if (res.ok) {
      setEntries([]);
      setPerSystemCounts({});
    }
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  };

  const formatFullTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  };

  const formatDetails = (details: Record<string, unknown>): string => {
    const lines: string[] = [];
    for (const [key, val] of Object.entries(details)) {
      if (val === null || val === undefined) continue;
      if (typeof val === "object") {
        lines.push(`${key}: ${JSON.stringify(val)}`);
      } else {
        lines.push(`${key}: ${val}`);
      }
    }
    return lines.join("\n");
  };

  return (
    <div style={{ color: "#ccc", fontSize: 13 }}>
      {/* System filter tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        <button
          onClick={() => setFilterSystem(null)}
          style={{
            padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: !filterSystem ? "rgba(245,166,35,0.12)" : "transparent",
            border: `1px solid ${!filterSystem ? "#f5a623" : "#333"}`,
            color: !filterSystem ? "#f5a623" : "#666",
            cursor: "pointer",
          }}
        >
          All Systems
        </button>
        {SYSTEMS.map(sys => {
          const count = perSystemCounts[sys] ?? 0;
          const active = filterSystem === sys;
          return (
            <button
              key={sys}
              onClick={() => setFilterSystem(active ? null : sys)}
              style={{
                padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                background: active ? "rgba(245,166,35,0.12)" : "transparent",
                border: `1px solid ${active ? "#f5a623" : "#333"}`,
                color: active ? "#f5a623" : "#666",
                cursor: "pointer", position: "relative",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {sys.replace(/_/g, " ")}
              {count > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 800, color: "#fff",
                  background: "#f23645", borderRadius: 6,
                  padding: "0 4px", minWidth: 14, textAlign: "center",
                  lineHeight: "14px",
                }}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Controls row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 3 }}>
          {SEVERITIES.map(sev => {
            const active = filterSeverity === sev;
            const c = SEV_COLORS[sev];
            return (
              <button
                key={sev}
                onClick={() => setFilterSeverity(active ? null : sev)}
                style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                  background: active ? c.bg : "transparent",
                  border: `1px solid ${active ? c.border : "#333"}`,
                  color: active ? c.text : "#555",
                  cursor: "pointer", letterSpacing: "0.5px",
                }}
              >
                {sev}
              </button>
            );
          })}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#666", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={e => setShowResolved(e.target.checked)}
            style={{ accentColor: "#FFB800", width: 12, height: 12 }}
          />
          Show resolved
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#666", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            style={{ accentColor: "#26a69a", width: 12, height: 12 }}
          />
          Auto-refresh
        </label>

        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            onClick={() => { fetchEntries(); fetchCounts(); }}
            style={{
              padding: "3px 8px", borderRadius: 4, fontSize: 10,
              background: "transparent", border: "1px solid #333", color: "#888",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <RotateCcw style={{ width: 10, height: 10 }} /> Refresh
          </button>

          <button
            onClick={handleClear}
            style={{
              padding: "3px 8px", borderRadius: 4, fontSize: 10,
              background: "rgba(242,54,69,0.06)", border: "1px solid #f2364530", color: "#f23645",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <Trash2 style={{ width: 10, height: 10 }} /> Clear logs
          </button>
        </div>
      </div>

      {/* Event count summary */}
      <div style={{ fontSize: 10, color: "#555", marginBottom: 6 }}>
        {entries.length} event{entries.length !== 1 ? "s" : ""}
        {filterSystem ? ` in ${filterSystem}` : ""}
        {filterSeverity ? ` (${filterSeverity})` : ""}
        {autoRefresh && <span style={{ color: "#26a69a", marginLeft: 8 }}>● live</span>}
      </div>

      {/* Log entries */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>
          No events logged yet
        </div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", color: "#444", padding: 40, fontSize: 12 }}>
          No events logged {filterSystem || filterSeverity ? "matching filters" : ""}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {entries.map(entry => {
            const c = SEV_COLORS[entry.severity] ?? SEV_COLORS.INFO;
            const isExpanded = expandedId === entry.id;
            return (
              <div
                key={entry.id}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                style={{
                  background: c.bg,
                  borderLeft: `2px solid ${c.border}`,
                  padding: "5px 10px",
                  borderRadius: 3,
                  cursor: "pointer",
                  opacity: entry.resolved ? 0.4 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {entry.details ? (
                    isExpanded ? <ChevronDown style={{ width: 10, height: 10, color: "#555", flexShrink: 0 }} /> : <ChevronRight style={{ width: 10, height: 10, color: "#555", flexShrink: 0 }} />
                  ) : <span style={{ width: 10, flexShrink: 0 }} />}
                  <span style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: "0.5px",
                    color: c.text, width: 38,
                  }}>
                    {entry.severity}
                  </span>
                  <span style={{ fontSize: 9, color: "#555", fontFamily: "monospace", width: 60, flexShrink: 0 }}>
                    {formatTime(entry.timestamp)}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, color: "#f5a623",
                    background: "rgba(245,166,35,0.06)", padding: "0px 5px", borderRadius: 3,
                    flexShrink: 0,
                  }}>
                    {entry.system}
                  </span>
                  <span style={{ fontSize: 11, color: "#ccc", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.message}
                  </span>
                  {!entry.resolved && entry.severity !== "INFO" && (
                    <button
                      onClick={e => { e.stopPropagation(); handleResolve(entry.id); }}
                      title="Mark resolved"
                      style={{
                        padding: "1px 6px", borderRadius: 3, fontSize: 9,
                        background: "rgba(0,209,102,0.08)", border: "1px solid #00d16630",
                        color: "#00d166", cursor: "pointer", display: "flex", alignItems: "center", gap: 2,
                        flexShrink: 0,
                      }}
                    >
                      <Check style={{ width: 8, height: 8 }} /> Resolve
                    </button>
                  )}
                  {entry.resolved && (
                    <span style={{ fontSize: 9, color: "#00d166", fontWeight: 600, flexShrink: 0 }}>✓</span>
                  )}
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 4, marginLeft: 16 }}>
                    <div style={{ fontSize: 10, color: "#666", marginBottom: 2 }}>
                      {formatFullTime(entry.timestamp)}
                    </div>
                    {entry.details && (
                      <pre style={{
                        fontSize: 10, color: "#aaa", fontFamily: "monospace",
                        background: "#0a0a0a", padding: 6, borderRadius: 3, overflow: "auto",
                        maxHeight: 200, whiteSpace: "pre-wrap", wordBreak: "break-all",
                        margin: 0, lineHeight: 1.5,
                      }}>
                        {formatDetails(entry.details)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function useTelemetryCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await fetchWithAuth("/api/telemetry/counts");
        if (res.ok && mounted) {
          const data = await res.json();
          setCount(data.total ?? data.unresolvedCount ?? 0);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return count;
}
