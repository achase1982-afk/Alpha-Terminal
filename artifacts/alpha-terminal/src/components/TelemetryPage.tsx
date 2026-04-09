import React, { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { RotateCcw, Check, Trash2, ChevronDown, ChevronRight } from "lucide-react";

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
  "PUSH_NOTIFICATION", "MARKET_PULSE", "POLYGON_API",
];

const SEVERITIES = ["ERROR", "WARN", "INFO"] as const;

const SEV_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  ERROR: { bg: "rgba(242,54,69,0.10)", text: "#f23645", border: "#f2364580" },
  WARN: { bg: "rgba(255,184,0,0.08)", text: "#FFB800", border: "#FFB80060" },
  INFO: { bg: "rgba(255,255,255,0.03)", text: "#888", border: "#333" },
};

const SYSTEM_DESCRIPTIONS: Record<string, string> = {
  SCHWAB_API: "REST API calls to Charles Schwab for quotes, chains, and account data",
  SCHWAB_STREAM: "WebSocket streaming connection for real-time market data",
  IBKR: "Interactive Brokers gateway connection and order routing",
  YAHOO: "Yahoo Finance data fallback for supplementary quotes",
  SEC_EDGAR: "SEC EDGAR filings and institutional holdings lookups",
  SCANNER: "Deterministic stock scanner runs and candidate discovery",
  STRATEGIST: "Options strategy generation and trade recommendations",
  RISK_GATE: "Pre-trade risk checks and position sizing validation",
  EXIT_STAGING: "Exit signal monitoring and trade management",
  PUSH_NOTIFICATION: "Push notification delivery and VAPID messaging",
  MARKET_PULSE: "Market regime engine composite scoring and bias reads",
  POLYGON_API: "Polygon.io options snapshots, IV enrichment, and flow scans",
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
      lines.push(`${key}: ${JSON.stringify(val)}`);
    } else {
      lines.push(`${key}: ${val}`);
    }
  }
  return lines.join("\n");
}

function SystemHeader({ system, entries }: { system: string; entries: TelemetryEntry[] }) {
  const errors = entries.filter(e => e.severity === "ERROR" && !e.resolved).length;
  const warns = entries.filter(e => e.severity === "WARN" && !e.resolved).length;
  const infos = entries.filter(e => e.severity === "INFO" && !e.resolved).length;
  const lastEvent = entries[0];
  const desc = SYSTEM_DESCRIPTIONS[system] ?? "";

  return (
    <div style={{
      padding: "10px 14px", borderRadius: 8, marginBottom: 10,
      background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f22",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#FFB800", fontFamily: "monospace", letterSpacing: "0.5px" }}>
          {system.replace(/_/g, " ")}
        </span>
        <div style={{ display: "flex", gap: 8, fontSize: 12, fontWeight: 600 }}>
          {errors > 0 && <span style={{ color: "#f23645" }}>{errors} ERROR{errors !== 1 ? "S" : ""}</span>}
          {warns > 0 && <span style={{ color: "#FFB800" }}>{warns} WARN{warns !== 1 ? "S" : ""}</span>}
          <span style={{ color: "#555" }}>{infos} INFO</span>
        </div>
      </div>
      {desc && <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>{desc}</div>}
      {lastEvent && (
        <div style={{ fontSize: 11, color: "#444" }}>
          Last event: {formatFullTime(lastEvent.timestamp)}
        </div>
      )}
    </div>
  );
}

function AllSystemsSummary({ entries, perSystemCounts }: { entries: TelemetryEntry[]; perSystemCounts: Record<string, number> }) {
  const systemGroups: Record<string, { errors: number; warns: number; total: number; lastTs: string }> = {};
  for (const sys of SYSTEMS) {
    systemGroups[sys] = { errors: 0, warns: 0, total: 0, lastTs: "" };
  }
  for (const e of entries) {
    if (!systemGroups[e.system]) systemGroups[e.system] = { errors: 0, warns: 0, total: 0, lastTs: "" };
    const g = systemGroups[e.system];
    g.total++;
    if (!e.resolved) {
      if (e.severity === "ERROR") g.errors++;
      if (e.severity === "WARN") g.warns++;
    }
    if (!g.lastTs || e.timestamp > g.lastTs) g.lastTs = e.timestamp;
  }

  const activeSystems = SYSTEMS.filter(s => systemGroups[s].total > 0);
  const inactiveSystems = SYSTEMS.filter(s => systemGroups[s].total === 0);

  return (
    <div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 6, marginBottom: 12,
      }}>
        {activeSystems.map(sys => {
          const g = systemGroups[sys];
          const hasIssues = g.errors > 0 || g.warns > 0;
          const borderColor = g.errors > 0 ? "#f2364540" : g.warns > 0 ? "#FFB80030" : "#1f1f22";
          return (
            <div key={sys} style={{
              padding: "8px 12px", borderRadius: 6,
              background: hasIssues ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.01)",
              border: `1px solid ${borderColor}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#ccc", fontFamily: "monospace" }}>
                  {sys.replace(/_/g, " ")}
                </span>
                <span style={{ fontSize: 11, color: "#444" }}>{g.total} events</span>
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                {g.errors > 0 && <span style={{ color: "#f23645", fontWeight: 600 }}>{g.errors} errors</span>}
                {g.warns > 0 && <span style={{ color: "#FFB800", fontWeight: 600 }}>{g.warns} warns</span>}
                {g.lastTs && <span style={{ color: "#444", marginLeft: "auto" }}>{formatTime(g.lastTs)}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {inactiveSystems.length > 0 && (
        <div style={{ fontSize: 11, color: "#333", marginBottom: 8 }}>
          No events: {inactiveSystems.map(s => s.replace(/_/g, " ")).join(", ")}
        </div>
      )}
    </div>
  );
}

function EventRow({ entry, isExpanded, onToggle, onResolve, showSystem }: {
  entry: TelemetryEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
  showSystem: boolean;
}) {
  const c = SEV_COLORS[entry.severity] ?? SEV_COLORS.INFO;
  return (
    <div
      onClick={onToggle}
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
          isExpanded
            ? <ChevronDown style={{ width: 12, height: 12, color: "#555", flexShrink: 0 }} />
            : <ChevronRight style={{ width: 12, height: 12, color: "#555", flexShrink: 0 }} />
        ) : <span style={{ width: 12, flexShrink: 0 }} />}
        <span style={{
          fontSize: 12, fontWeight: 800, letterSpacing: "0.5px",
          color: c.text, width: 42,
        }}>
          {entry.severity}
        </span>
        <span style={{ fontSize: 13, color: "#fff", fontFamily: "monospace", width: 72, flexShrink: 0 }}>
          {formatTime(entry.timestamp)}
        </span>
        {showSystem && (
          <span style={{
            fontSize: 12, fontWeight: 600, color: "#f5a623",
            background: "rgba(245,166,35,0.06)", padding: "0px 5px", borderRadius: 3,
            flexShrink: 0,
          }}>
            {entry.system}
          </span>
        )}
        <span style={{ fontSize: 14, color: "#ccc", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.message}
        </span>
        {!entry.resolved && entry.severity !== "INFO" && (
          <button
            onClick={e => { e.stopPropagation(); onResolve(); }}
            title="Mark resolved"
            style={{
              padding: "1px 6px", borderRadius: 3, fontSize: 11,
              background: "rgba(0,209,102,0.08)", border: "1px solid #00d16630",
              color: "#00d166", cursor: "pointer", display: "flex", alignItems: "center", gap: 2,
              flexShrink: 0,
            }}
          >
            <Check style={{ width: 10, height: 10 }} /> Resolve
          </button>
        )}
        {entry.resolved && (
          <span style={{ fontSize: 11, color: "#00d166", fontWeight: 600, flexShrink: 0 }}>✓</span>
        )}
      </div>

      {isExpanded && (
        <div style={{ marginTop: 4, marginLeft: 18 }}>
          <div style={{ fontSize: 14, color: "#888", marginBottom: 2 }}>
            {formatFullTime(entry.timestamp)}
          </div>
          {entry.details && (
            <pre style={{
              fontSize: 14, color: "#bbb", fontFamily: "monospace",
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
}

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

  const filteredForDisplay = filterSeverity
    ? entries.filter(e => e.severity === filterSeverity)
    : entries;

  return (
    <div style={{ color: "#ccc", fontSize: 15 }}>
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

        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            onClick={() => { fetchEntries(); fetchCounts(); }}
            style={{
              padding: "3px 8px", borderRadius: 4, fontSize: 12,
              background: "transparent", border: "1px solid #333", color: "#888",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
            }}
          >
            <RotateCcw style={{ width: 12, height: 12 }} /> Refresh
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

      {!filterSystem && (
        <AllSystemsSummary entries={entries} perSystemCounts={perSystemCounts} />
      )}

      {filterSystem && filteredForDisplay.length > 0 && (
        <SystemHeader system={filterSystem} entries={filteredForDisplay} />
      )}

      <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>
        {filteredForDisplay.length} event{filteredForDisplay.length !== 1 ? "s" : ""}
        {filterSystem ? ` in ${filterSystem.replace(/_/g, " ")}` : ""}
        {filterSeverity ? ` · ${filterSeverity} only` : ""}
        {autoRefresh && <span style={{ color: "#26a69a", marginLeft: 8 }}>● live</span>}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 14 }}>
          Loading...
        </div>
      ) : filteredForDisplay.length === 0 ? (
        <div style={{ textAlign: "center", color: "#444", padding: 40, fontSize: 14 }}>
          No events logged {filterSystem || filterSeverity ? "matching filters" : ""}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {filteredForDisplay.map(entry => (
            <EventRow
              key={entry.id}
              entry={entry}
              isExpanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
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
