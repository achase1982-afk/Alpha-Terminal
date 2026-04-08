import React, { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { RotateCcw, Check, Trash2, Filter } from "lucide-react";

interface TelemetryEntry {
  id: number;
  timestamp: string;
  system: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  message: string;
  details: Record<string, unknown> | null;
  resolved: boolean;
  resolvedAt: string | null;
}

const SYSTEMS = [
  "SCHWAB_API", "SCHWAB_STREAM", "IBKR", "YAHOO", "SEC_EDGAR",
  "SCANNER", "STRATEGIST", "RISK_GATE", "EXIT_STAGING",
  "PUSH_NOTIFICATION", "MARKET_PULSE",
];

const SEVERITIES = ["CRITICAL", "ERROR", "WARN", "INFO"] as const;

const SEV_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL: { bg: "rgba(242,54,69,0.15)", text: "#f23645", border: "#f23645" },
  ERROR: { bg: "rgba(242,54,69,0.08)", text: "#f23645", border: "#f2364580" },
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

  const fetchEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterSystem) params.set("system", filterSystem);
      if (filterSeverity) params.set("severity", filterSeverity);
      params.set("limit", "200");
      const res = await fetchWithAuth(`/api/telemetry?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [filterSystem, filterSeverity]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleResolve = async (id: number) => {
    const res = await fetchWithAuth(`/api/telemetry/${id}/resolve`, { method: "PATCH" });
    if (res.ok) {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, resolved: true, resolvedAt: new Date().toISOString() } : e));
    }
  };

  const handleClearResolved = async () => {
    const res = await fetchWithAuth(`/api/telemetry/clear-resolved`, { method: "DELETE" });
    if (res.ok) {
      setEntries(prev => prev.filter(e => !e.resolved));
    }
  };

  const displayed = showResolved ? entries : entries.filter(e => !e.resolved);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  };

  return (
    <div style={{ color: "#ccc", fontSize: 13 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <Filter style={{ width: 14, height: 14, color: "#888" }} />

        <select
          value={filterSystem ?? ""}
          onChange={e => setFilterSystem(e.target.value || null)}
          style={{
            background: "#1a1a1a", border: "1px solid #333", color: "#ccc",
            padding: "4px 8px", borderRadius: 4, fontSize: 12,
          }}
        >
          <option value="">All Systems</option>
          {SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div style={{ display: "flex", gap: 4 }}>
          {SEVERITIES.map(sev => {
            const active = filterSeverity === sev;
            const c = SEV_COLORS[sev];
            return (
              <button
                key={sev}
                onClick={() => setFilterSeverity(active ? null : sev)}
                style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: active ? c.bg : "transparent",
                  border: `1px solid ${active ? c.border : "#333"}`,
                  color: active ? c.text : "#666",
                  cursor: "pointer", letterSpacing: "0.5px",
                }}
              >
                {sev}
              </button>
            );
          })}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#888", marginLeft: "auto", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={e => setShowResolved(e.target.checked)}
            style={{ accentColor: "#FFB800" }}
          />
          Show resolved
        </label>

        <button
          onClick={fetchEntries}
          style={{
            padding: "4px 8px", borderRadius: 4, fontSize: 11,
            background: "transparent", border: "1px solid #333", color: "#888",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
          }}
        >
          <RotateCcw style={{ width: 12, height: 12 }} /> Refresh
        </button>

        {entries.some(e => e.resolved) && (
          <button
            onClick={handleClearResolved}
            style={{
              padding: "4px 8px", borderRadius: 4, fontSize: 11,
              background: "rgba(242,54,69,0.08)", border: "1px solid #f2364540", color: "#f23645",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <Trash2 style={{ width: 12, height: 12 }} /> Clear Resolved
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#666", padding: 40 }}>Loading…</div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: "center", color: "#555", padding: 40, fontSize: 12 }}>
          No telemetry entries {filterSystem || filterSeverity ? "matching filters" : "recorded"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {displayed.map(entry => {
            const c = SEV_COLORS[entry.severity] ?? SEV_COLORS.INFO;
            const isExpanded = expandedId === entry.id;
            return (
              <div
                key={entry.id}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                style={{
                  background: c.bg,
                  borderLeft: `3px solid ${c.border}`,
                  padding: "8px 12px",
                  borderRadius: 4,
                  cursor: "pointer",
                  opacity: entry.resolved ? 0.5 : 1,
                  animation: entry.severity === "CRITICAL" && !entry.resolved ? "telemetry-pulse 2s infinite" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.5px",
                    color: c.text, minWidth: 55,
                  }}>
                    {entry.severity}
                  </span>
                  <span style={{ fontSize: 10, color: "#666", fontFamily: "monospace" }}>
                    {formatTime(entry.timestamp)}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: "#FFB800",
                    background: "rgba(255,184,0,0.08)", padding: "1px 6px", borderRadius: 3,
                  }}>
                    {entry.system}
                  </span>
                  <span style={{ fontSize: 12, color: "#ddd", flex: 1 }}>
                    {entry.message}
                  </span>
                  {!entry.resolved && (
                    <button
                      onClick={e => { e.stopPropagation(); handleResolve(entry.id); }}
                      title="Mark resolved"
                      style={{
                        padding: "2px 8px", borderRadius: 3, fontSize: 10,
                        background: "rgba(0,209,102,0.1)", border: "1px solid #00d16640",
                        color: "#00d166", cursor: "pointer", display: "flex", alignItems: "center", gap: 3,
                      }}
                    >
                      <Check style={{ width: 10, height: 10 }} /> Resolve
                    </button>
                  )}
                  {entry.resolved && (
                    <span style={{ fontSize: 10, color: "#00d166", fontWeight: 600 }}>✓ RESOLVED</span>
                  )}
                </div>

                {isExpanded && entry.details && (
                  <pre style={{
                    marginTop: 8, fontSize: 11, color: "#aaa", fontFamily: "monospace",
                    background: "#0a0a0a", padding: 8, borderRadius: 4, overflow: "auto",
                    maxHeight: 200, whiteSpace: "pre-wrap", wordBreak: "break-all",
                  }}>
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes telemetry-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
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
          setCount(data.unresolvedCount ?? 0);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return count;
}
