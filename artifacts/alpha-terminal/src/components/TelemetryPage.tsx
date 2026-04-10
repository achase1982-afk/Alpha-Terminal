import React, { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { RotateCcw, Check, Trash2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

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

interface TelemetryGroup {
  batchId: string;
  feature: string;
  timestamp: string;
  entries: TelemetryEntry[];
  systemSummary: string[];
}

const SYSTEMS = [
  "SCHWAB_API", "SCHWAB_STREAM", "IBKR", "YAHOO", "SEC_EDGAR",
  "SCANNER", "STRATEGIST", "RISK_GATE", "EXIT_STAGING",
  "PUSH_NOTIFICATION", "MARKET_PULSE", "POLYGON_API", "DATABASE",
];

const SEVERITIES = ["ERROR", "WARN", "INFO"] as const;

const SEV_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ERROR: { bg: "rgba(242,54,69,0.10)", text: "#f23645", border: "#f2364580" },
  WARN: { bg: "rgba(255,184,0,0.08)", text: "#FFB800", border: "#FFB80060" },
  INFO: { bg: "rgba(255,255,255,0.03)", text: "#888", border: "#333" },
};

const FEATURE_LABELS: Record<string, { label: string; color: string }> = {
  MARKET_PULSE: { label: "MARKET PULSE", color: "#26a69a" },
  SCANNER: { label: "SCANNER", color: "#FFB800" },
  STRATEGIST: { label: "STRATEGIST", color: "#7c3aed" },
  STREAMER: { label: "STREAMER", color: "#3b82f6" },
  SNAPSHOT: { label: "SNAPSHOT", color: "#06b6d4" },
  ORDER: { label: "ORDER", color: "#f43f5e" },
  SYSTEM: { label: "SYSTEM", color: "#555" },
};

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function formatFullTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function formatDetails(details: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(details)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "object") {
      lines.push(`${key}: ${JSON.stringify(val, null, 2)}`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  return lines.join("\n");
}

function GroupedBatchRow({ group, filterSystem, onResolve }: {
  group: TelemetryGroup;
  filterSystem: string | null;
  onResolve: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<number>>(new Set());

  const feat = FEATURE_LABELS[group.feature] ?? FEATURE_LABELS.SYSTEM;
  const errorCount = group.entries.filter(e => e.severity === "ERROR" && !e.resolved).length;
  const warnCount = group.entries.filter(e => e.severity === "WARN" && !e.resolved).length;
  const entryCount = group.entries.length;

  const summaryParts: string[] = [];
  for (const e of group.entries) {
    const msg = e.message;
    if (msg.includes("scan initiated") || msg.includes("Scan initiated")) {
      const m = msg.match(/(\d+)\s+tickers/);
      if (m) summaryParts.push(`${m[1]} symbols`);
    }
    if (msg.includes("candidates") && msg.includes("complete")) {
      const m = msg.match(/(\d+)\s+candidates/);
      if (m) summaryParts.push(`${m[1]} results`);
    }
    if (msg.includes("Pulse scored")) {
      const m = msg.match(/(BULLISH|BEARISH|NEUTRAL|MIXED)/);
      if (m) summaryParts.push(m[1]);
    }
  }
  const summaryText = summaryParts.length > 0 ? ` — ${summaryParts.join(", ")}` : "";

  const toggleEntry = (id: number) => {
    setExpandedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const borderColor = errorCount > 0 ? "#f2364560" : warnCount > 0 ? "#FFB80040" : "#1f1f22";

  return (
    <div style={{
      border: `1px solid ${borderColor}`,
      borderRadius: 8, overflow: "hidden",
      background: "rgba(255,255,255,0.01)",
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 12px", cursor: "pointer",
          background: expanded ? "rgba(255,255,255,0.03)" : "transparent",
          flexWrap: "wrap",
        }}
      >
        {expanded
          ? <ChevronDown style={{ width: 14, height: 14, color: "#666", flexShrink: 0 }} />
          : <ChevronRight style={{ width: 14, height: 14, color: "#666", flexShrink: 0 }} />
        }
        <span style={{
          fontSize: 13, fontWeight: 800, letterSpacing: "0.5px",
          color: feat.color, fontFamily: "monospace",
        }}>
          {feat.label}
        </span>
        <span style={{ fontSize: 13, color: "#999", fontFamily: "monospace", fontWeight: 600 }}>
          {formatTime(group.timestamp)}
        </span>
        <span style={{ fontSize: 12, color: "#666" }}>
          {entryCount} log{entryCount !== 1 ? "s" : ""}{summaryText}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {errorCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#f23645", padding: "1px 6px", borderRadius: 4, background: "rgba(242,54,69,0.12)" }}>
              {errorCount} ERR
            </span>
          )}
          {warnCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#FFB800", padding: "1px 6px", borderRadius: 4, background: "rgba(255,184,0,0.10)" }}>
              {warnCount} WARN
            </span>
          )}
          <div style={{ display: "flex", gap: 2 }}>
            {group.systemSummary.map(sys => (
              <span key={sys} style={{
                fontSize: 9, fontWeight: 600, color: "#666",
                padding: "1px 4px", borderRadius: 3,
                background: "rgba(255,255,255,0.04)", border: "1px solid #222",
                fontFamily: "monospace",
              }}>
                {sys.replace(/_/g, " ").slice(0, 8)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid #1a1a1a" }}>
          {group.entries.map(entry => {
            const c = SEV_COLORS[entry.severity] ?? SEV_COLORS.INFO;
            const isEntryExpanded = expandedEntryIds.has(entry.id);
            return (
              <div key={entry.id} style={{
                borderBottom: "1px solid #111",
                opacity: entry.resolved ? 0.4 : 1,
              }}>
                <div
                  onClick={() => toggleEntry(entry.id)}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 6,
                    padding: "6px 12px 6px 28px", cursor: "pointer",
                    background: c.bg,
                    borderLeft: `3px solid ${c.border}`,
                    flexWrap: "wrap",
                  }}
                >
                  {entry.details ? (
                    isEntryExpanded
                      ? <ChevronDown style={{ width: 11, height: 11, color: "#555", flexShrink: 0, marginTop: 3 }} />
                      : <ChevronRight style={{ width: 11, height: 11, color: "#555", flexShrink: 0, marginTop: 3 }} />
                  ) : <span style={{ width: 11, flexShrink: 0 }} />}
                  <span style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: "0.5px",
                    color: c.text, width: 40, flexShrink: 0,
                  }}>
                    {entry.severity}
                  </span>
                  <span style={{ fontSize: 12, color: "#777", fontFamily: "monospace", flexShrink: 0 }}>
                    {formatTime(entry.timestamp)}
                  </span>
                  {filterSystem === null && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: "#f5a623",
                      background: "rgba(245,166,35,0.06)", padding: "0 4px", borderRadius: 3,
                      flexShrink: 0,
                    }}>
                      {entry.system}
                    </span>
                  )}
                  <span style={{
                    fontSize: 13, color: "#ccc", wordBreak: "break-word",
                    whiteSpace: "pre-wrap", flex: 1, minWidth: 0,
                  }}>
                    {entry.message}
                  </span>
                  {!entry.resolved && entry.severity !== "INFO" && (
                    <button
                      onClick={e => { e.stopPropagation(); onResolve(entry.id); }}
                      title="Mark resolved"
                      style={{
                        padding: "1px 6px", borderRadius: 3, fontSize: 10,
                        background: "rgba(0,209,102,0.08)", border: "1px solid #00d16630",
                        color: "#00d166", cursor: "pointer", display: "flex", alignItems: "center", gap: 2,
                        flexShrink: 0,
                      }}
                    >
                      <Check style={{ width: 10, height: 10 }} /> Resolve
                    </button>
                  )}
                </div>

                {isEntryExpanded && entry.details && (
                  <div style={{ padding: "4px 12px 8px 42px" }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 2 }}>
                      {formatFullTime(entry.timestamp)}
                    </div>
                    <pre style={{
                      fontSize: 13, color: "#bbb", fontFamily: "monospace",
                      background: "#0a0a0a", padding: 8, borderRadius: 4,
                      overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
                      margin: 0, lineHeight: 1.5,
                    }}>
                      {formatDetails(entry.details)}
                    </pre>
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

function UngroupedEventRow({ entry, onResolve, showSystem }: {
  entry: TelemetryEntry;
  onResolve: () => void;
  showSystem: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const c = SEV_COLORS[entry.severity] ?? SEV_COLORS.INFO;
  return (
    <div style={{
      background: c.bg,
      borderLeft: `3px solid ${c.border}`,
      borderRadius: 4,
      opacity: entry.resolved ? 0.4 : 1,
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "flex-start", gap: 6,
          padding: "6px 10px", cursor: "pointer",
          flexWrap: "wrap",
        }}
      >
        {entry.details ? (
          expanded
            ? <ChevronDown style={{ width: 12, height: 12, color: "#555", flexShrink: 0, marginTop: 2 }} />
            : <ChevronRight style={{ width: 12, height: 12, color: "#555", flexShrink: 0, marginTop: 2 }} />
        ) : <span style={{ width: 12, flexShrink: 0 }} />}
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: "0.5px",
          color: c.text, width: 40, flexShrink: 0,
        }}>
          {entry.severity}
        </span>
        <span style={{ fontSize: 12, color: "#777", fontFamily: "monospace", flexShrink: 0 }}>
          {formatTime(entry.timestamp)}
        </span>
        {showSystem && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: "#f5a623",
            background: "rgba(245,166,35,0.06)", padding: "0 4px", borderRadius: 3,
            flexShrink: 0,
          }}>
            {entry.system}
          </span>
        )}
        <span style={{
          fontSize: 13, color: "#ccc", wordBreak: "break-word",
          whiteSpace: "pre-wrap", flex: 1, minWidth: 0,
        }}>
          {entry.message}
        </span>
        {!entry.resolved && entry.severity !== "INFO" && (
          <button
            onClick={e => { e.stopPropagation(); onResolve(); }}
            title="Mark resolved"
            style={{
              padding: "1px 6px", borderRadius: 3, fontSize: 10,
              background: "rgba(0,209,102,0.08)", border: "1px solid #00d16630",
              color: "#00d166", cursor: "pointer", display: "flex", alignItems: "center", gap: 2,
              flexShrink: 0,
            }}
          >
            <Check style={{ width: 10, height: 10 }} /> Resolve
          </button>
        )}
      </div>

      {expanded && entry.details && (
        <div style={{ padding: "4px 10px 8px 24px" }}>
          <div style={{ fontSize: 11, color: "#555", marginBottom: 2 }}>
            {formatFullTime(entry.timestamp)}
          </div>
          <pre style={{
            fontSize: 13, color: "#bbb", fontFamily: "monospace",
            background: "#0a0a0a", padding: 8, borderRadius: 4,
            overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
            margin: 0, lineHeight: 1.5,
          }}>
            {formatDetails(entry.details)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function TelemetryPage() {
  const [groups, setGroups] = useState<TelemetryGroup[]>([]);
  const [ungrouped, setUngrouped] = useState<TelemetryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSystem, setFilterSystem] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [perSystemCounts, setPerSystemCounts] = useState<Record<string, number>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("grouped", "true");
      if (filterSystem) params.set("system", filterSystem);
      if (filterSeverity) params.set("severity", filterSeverity);
      if (showResolved) params.set("showResolved", "true");
      params.set("limit", "500");
      const res = await fetchWithAuth(`/api/telemetry?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups ?? []);
        setUngrouped(data.ungrouped ?? []);
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
      setGroups(prev => prev.map(g => ({
        ...g,
        entries: g.entries.map(e => e.id === id ? { ...e, resolved: true } : e),
      })));
      setUngrouped(prev => prev.map(e => e.id === id ? { ...e, resolved: true } : e));
    }
  };

  const handleClear = async () => {
    const res = await fetchWithAuth(`/api/telemetry/clear`, { method: "DELETE" });
    if (res.ok) {
      setGroups([]);
      setUngrouped([]);
      setPerSystemCounts({});
    }
  };

  const totalEntries = groups.reduce((sum, g) => sum + g.entries.length, 0) + ungrouped.length;

  return (
    <div style={{ color: "#ccc", fontSize: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        <button
          onClick={() => setFilterSystem(null)}
          style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700,
            background: !filterSystem ? "#FFB80018" : "transparent",
            border: `1px solid ${!filterSystem ? "#FFB800" : "#2a2a2c"}`,
            color: !filterSystem ? "#FFB800" : "#555",
            cursor: "pointer",
          }}
        >
          ALL SYSTEMS
        </button>
        {SYSTEMS.map(sys => {
          const count = perSystemCounts[sys] ?? 0;
          const active = filterSystem === sys;
          return (
            <button
              key={sys}
              onClick={() => setFilterSystem(active ? null : sys)}
              style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: active ? "#FFB80018" : "transparent",
                border: `1px solid ${active ? "#FFB800" : "#2a2a2c"}`,
                color: active ? "#FFB800" : "#555",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {sys.replace(/_/g, " ")}
              {count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 800, color: "#fff",
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
                  padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700,
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

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#666", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={e => setShowResolved(e.target.checked)}
            style={{ accentColor: "#FFB800", width: 12, height: 12 }}
          />
          Show resolved
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#666", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            style={{ accentColor: "#26a69a", width: 12, height: 12 }}
          />
          Auto-refresh
        </label>

        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {lastRefreshed && (
            <span style={{ fontSize: 11, color: "#26a69a", fontWeight: 600, transition: "opacity 0.3s", opacity: Date.now() - lastRefreshed < 2000 ? 1 : 0 }}>
              Updated
            </span>
          )}
          <button
            onClick={async () => {
              setIsRefreshing(true);
              await Promise.all([fetchEntries(), fetchCounts()]);
              setIsRefreshing(false);
              setLastRefreshed(Date.now());
            }}
            disabled={isRefreshing}
            style={{
              padding: "3px 10px", borderRadius: 4, fontSize: 12,
              background: isRefreshing ? "rgba(38,166,154,0.12)" : "transparent",
              border: `1px solid ${isRefreshing ? "#26a69a" : "#333"}`,
              color: isRefreshing ? "#26a69a" : "#888",
              cursor: isRefreshing ? "wait" : "pointer",
              display: "flex", alignItems: "center", gap: 4,
              transition: "all 0.15s ease",
            }}
          >
            <RotateCcw
              className={isRefreshing ? "animate-spin" : ""}
              style={{ width: 12, height: 12 }}
            />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>

          <button
            onClick={handleClear}
            style={{
              padding: "3px 8px", borderRadius: 4, fontSize: 12,
              background: "rgba(242,54,69,0.06)", border: "1px solid #f2364530", color: "#f23645",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <Trash2 style={{ width: 12, height: 12 }} /> Clear logs
          </button>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
        {groups.length} batch{groups.length !== 1 ? "es" : ""} · {totalEntries} total event{totalEntries !== 1 ? "s" : ""}
        {ungrouped.length > 0 && ` · ${ungrouped.length} ungrouped`}
        {filterSystem ? ` · ${filterSystem.replace(/_/g, " ")}` : ""}
        {filterSeverity ? ` · ${filterSeverity} only` : ""}
        {autoRefresh && <span style={{ color: "#26a69a", marginLeft: 8 }}>● live</span>}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 14 }}>
          Loading...
        </div>
      ) : groups.length === 0 && ungrouped.length === 0 ? (
        <div style={{ textAlign: "center", color: "#444", padding: 40, fontSize: 14 }}>
          No events logged {filterSystem || filterSeverity ? "matching filters" : ""}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {groups.map(group => (
            <GroupedBatchRow
              key={group.batchId}
              group={group}
              filterSystem={filterSystem}
              onResolve={handleResolve}
            />
          ))}

          {ungrouped.length > 0 && groups.length > 0 && (
            <div style={{ fontSize: 11, color: "#444", padding: "8px 0 4px", fontWeight: 600, fontFamily: "monospace" }}>
              UNGROUPED EVENTS
            </div>
          )}
          {ungrouped.map(entry => (
            <UngroupedEventRow
              key={entry.id}
              entry={entry}
              onResolve={() => handleResolve(entry.id)}
              showSystem={!filterSystem}
            />
          ))}
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
