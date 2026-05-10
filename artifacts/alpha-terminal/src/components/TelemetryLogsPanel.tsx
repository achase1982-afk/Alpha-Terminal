import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Copy, Download, Pause, Play } from "lucide-react";

const f = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";

/** Railway-inspired dark shell */
const rail = {
  shell: "#0b0c15",
  border: "#1e293b",
  headerBg: "#12141f",
  rowAlt: "rgba(255,255,255,0.02)",
  accent: "#2563eb",
  text: "#e2e8f0",
  muted: "#64748b",
  dim: "#475569",
  amber: "#F59E0B",
  red: "#f23645",
  orange: "#fb923c",
};

export interface RuntimeLogEntry {
  id: string;
  emittedAt: string;
  service: string;
  system: string;
  level: string;
  message: string;
  subsystem: string | null;
  details: unknown;
}

type ServiceFilter = "all" | "server" | "browser";

const SERVICE_DISPLAY: Record<string, string> = {
  server: ["api", "server"].join("-"),
  web: ["alpha", "terminal"].join("-"),
};

function displayServiceName(service: string): string {
  return SERVICE_DISPLAY[service] ?? service;
}

const RANGE_PRESETS: { label: string; minutes: number }[] = [
  { label: "2 min", minutes: 2 },
  { label: "5 min", minutes: 5 },
  { label: "10 min", minutes: 10 },
  { label: "30 min", minutes: 30 },
  { label: "1 h", minutes: 60 },
  { label: "6 h", minutes: 360 },
  { label: "24 h", minutes: 1440 },
  { label: "7 d", minutes: 10080 },
  { label: "30 d", minutes: 43200 },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function entriesToPlainText(entries: RuntimeLogEntry[]): string {
  const lines: string[] = [];
  for (const r of entries) {
    const detailStr =
      r.details !== null && typeof r.details === "object"
        ? JSON.stringify(r.details)
        : String(r.details ?? "");
    lines.push(`${r.emittedAt}\t${r.service}\t${r.system}\t${r.level}\t${r.message}\t${detailStr}`);
  }
  return lines.join("\n");
}

function compactDataPayload(e: RuntimeLogEntry): string {
  const base: Record<string, unknown> = {
    message: e.message,
    system: e.system,
    level: e.level,
  };
  if (e.subsystem) base.subsystem = e.subsystem;
  if (e.details !== null && typeof e.details === "object" && !Array.isArray(e.details)) {
    Object.assign(base, e.details as Record<string, unknown>);
    base.message = e.message;
    base.system = e.system;
    base.level = e.level;
    if (e.subsystem) base.subsystem = e.subsystem;
  } else if (e.details !== undefined && e.details !== null) {
    base.details = e.details;
  }
  try {
    return JSON.stringify(base);
  } catch {
    return e.message;
  }
}

function MinuteHistogram({ entries }: { entries: RuntimeLogEntry[] }) {
  const buckets = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of entries) {
      const m = Math.floor(new Date(e.emittedAt).getTime() / 60000);
      map.set(m, (map.get(m) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [entries]);
  const max = Math.max(1, ...buckets.map(([, c]) => c));
  const tail = buckets.slice(-48);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 36, marginTop: 6, opacity: 0.9 }}>
      {tail.map(([minuteKey, count], i) => (
        <div
          key={`${minuteKey}-${i}`}
          title={`${count} events`}
          style={{
            flex: 1,
            minWidth: 2,
            height: `${Math.max(8, (count / max) * 100)}%`,
            background: rail.accent,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

export function TelemetryLogsPanel() {
  const [entries, setEntries] = useState<RuntimeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rangeMinutes, setRangeMinutes] = useState(5);
  const [limit, setLimit] = useState(500);
  const [filterQ, setFilterQ] = useState("");
  const [filterSystems, setFilterSystems] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [appliedSystems, setAppliedSystems] = useState("");
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");
  const [live, setLive] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildParams = useCallback(
    (override?: { q?: string; systems?: string }) => {
      const qStr = (override?.q ?? appliedQ).trim();
      const sysSrc = override?.systems ?? appliedSystems;
      const p = new URLSearchParams();
      p.set("minutes", String(rangeMinutes));
      p.set("limit", String(limit));
      if (qStr) p.set("q", qStr);
      const sys = sysSrc
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (sys.length) p.set("systems", sys.join(","));
      if (serviceFilter === "server") p.set("services", "server");
      else if (serviceFilter === "browser") p.set("services", "web");
      return p;
    },
    [rangeMinutes, limit, appliedQ, appliedSystems, serviceFilter],
  );

  const fetchLogs = useCallback(
    async (override?: { q?: string; systems?: string }) => {
      try {
        const res = await fetchWithAuth(`/api/telemetry/runtime-logs?${buildParams(override).toString()}`);
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries ?? []);
          setTruncated(Boolean(data.truncated));
        }
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [buildParams],
  );

  useEffect(() => {
    setLoading(true);
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!live) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      void fetchLogs();
    }, 4000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [live, fetchLogs]);

  const downloadBlob = async (format: "json" | "text" | "csv") => {
    const p = buildParams();
    p.set("format", format);
    const res = await fetchWithAuth(`/api/telemetry/runtime-logs/export?${p.toString()}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = format === "text" ? "txt" : format;
    a.download = `telemetry-runtime-logs.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyAs = async (format: "json" | "text") => {
    try {
      if (format === "json") {
        await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      } else {
        await navigator.clipboard.writeText(entriesToPlainText(entries));
      }
      setCopyFlash(format);
      setTimeout(() => setCopyFlash(null), 2000);
    } catch {}
  };

  const levelColor = (level: string) => {
    if (level === "ERROR") return rail.red;
    if (level === "WARN") return rail.orange;
    return rail.muted;
  };

  const svcPill = (service: string) => {
    const isBrowser = service === "web";
    const label = displayServiceName(service);
    return (
      <span
        style={{
          fontSize: 10,
          fontFamily: f,
          fontWeight: 700,
          color: isBrowser ? "#a78bfa" : rail.muted,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </span>
    );
  };

  const exportBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 6,
    border: `1px solid ${rail.border}`,
    background: "rgba(255,255,255,0.03)",
    color: rail.text,
    fontFamily: f,
    fontSize: 10,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        color: rail.text,
        fontSize: 13,
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 10, fontFamily: f, color: rail.muted, lineHeight: 1.5 }}>
        Unified log stream (Railway-style): <strong style={{ color: rail.text }}>Server</strong> rows include HTTP timing and{" "}
        <code style={{ color: rail.amber }}>emitTelemetry</code>; <strong style={{ color: rail.text }}>Web app</strong> rows come from browser errors
        forwarded to the API. Retention 30 days. Clerk session required.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 10, fontFamily: f, color: rail.dim, marginRight: 4 }}>RANGE</span>
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.minutes}
            type="button"
            onClick={() => setRangeMinutes(p.minutes)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              fontSize: 10,
              fontFamily: f,
              fontWeight: 700,
              border: `1px solid ${rangeMinutes === p.minutes ? rail.amber : rail.border}`,
              background: rangeMinutes === p.minutes ? "rgba(245,158,11,0.08)" : "transparent",
              color: rangeMinutes === p.minutes ? rail.amber : rail.dim,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, fontFamily: f, color: rail.dim }}>SOURCE</span>
        {(
          [
            { key: "all", label: "All" },
            { key: "server", label: "Server" },
            { key: "browser", label: "Browser" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setServiceFilter(key)}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              fontSize: 10,
              fontFamily: f,
              fontWeight: 700,
              border: `1px solid ${serviceFilter === key ? rail.accent : rail.border}`,
              background: serviceFilter === key ? "rgba(37,99,235,0.12)" : "transparent",
              color: serviceFilter === key ? rail.accent : rail.dim,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          type="search"
          placeholder="Filter message / details…"
          value={filterQ}
          onChange={(e) => setFilterQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const qv = filterQ.trim();
              setAppliedQ(qv);
              setAppliedSystems(filterSystems);
              void fetchLogs({ q: qv, systems: filterSystems });
            }
          }}
          style={{
            flex: "1 1 180px",
            minWidth: 140,
            padding: "6px 10px",
            borderRadius: 6,
            border: `1px solid ${rail.border}`,
            background: rail.shell,
            color: rail.text,
            fontFamily: f,
            fontSize: 11,
          }}
        />
        <input
          type="text"
          placeholder="Systems (comma): HTTP, STRATEGIST…"
          value={filterSystems}
          onChange={(e) => setFilterSystems(e.target.value)}
          style={{
            flex: "1 1 160px",
            minWidth: 120,
            padding: "6px 10px",
            borderRadius: 6,
            border: `1px solid ${rail.border}`,
            background: rail.shell,
            color: rail.text,
            fontFamily: f,
            fontSize: 11,
          }}
        />
        <label style={{ fontSize: 10, fontFamily: f, color: rail.dim, display: "flex", alignItems: "center", gap: 6 }}>
          limit
          <input
            type="number"
            min={50}
            max={5000}
            step={50}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 500)}
            style={{
              width: 72,
              padding: 4,
              borderRadius: 4,
              border: `1px solid ${rail.border}`,
              background: rail.shell,
              color: rail.text,
              fontFamily: f,
              fontSize: 11,
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const qv = filterQ.trim();
            setAppliedQ(qv);
            setAppliedSystems(filterSystems);
            void fetchLogs({ q: qv, systems: filterSystems });
          }}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: `1px solid ${rail.amber}`,
            background: "rgba(245,158,11,0.06)",
            color: rail.amber,
            fontFamily: f,
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => setLive((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 6,
            border: `1px solid ${live ? "#26a69a" : rail.border}`,
            background: live ? "rgba(38,166,154,0.06)" : "transparent",
            color: live ? "#26a69a" : rail.dim,
            fontFamily: f,
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {live ? <Pause size={12} /> : <Play size={12} />}
          {live ? "LIVE" : "PAUSED"}
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, fontFamily: f, color: rail.dim }}>Export</span>
        <button type="button" onClick={() => void copyAs("json")} style={exportBtnStyle}>
          <Copy size={11} /> Copy JSON {copyFlash === "json" ? "✓" : ""}
        </button>
        <button type="button" onClick={() => void copyAs("text")} style={exportBtnStyle}>
          <Copy size={11} /> Copy text {copyFlash === "text" ? "✓" : ""}
        </button>
        <button type="button" onClick={() => void downloadBlob("json")} style={exportBtnStyle}>
          <Download size={11} /> JSON
        </button>
        <button type="button" onClick={() => void downloadBlob("csv")} style={exportBtnStyle}>
          <Download size={11} /> CSV
        </button>
        <button type="button" onClick={() => void downloadBlob("text")} style={exportBtnStyle}>
          <Download size={11} /> Plain text
        </button>
      </div>

      {!loading && entries.length > 0 && <MinuteHistogram entries={entries} />}

      <div style={{ fontSize: 10, fontFamily: f, color: truncated ? rail.orange : rail.dim }}>
        {entries.length} rows
        {truncated ? " (hit row limit — narrow range or raise limit)" : ""}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 200,
          border: `1px solid ${rail.border}`,
          borderRadius: 8,
          background: rail.shell,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(108px, 18%) minmax(96px, 22%) 1fr",
            gap: 0,
            padding: "8px 12px",
            background: rail.headerBg,
            borderBottom: `1px solid ${rail.border}`,
            fontSize: 9,
            fontFamily: f,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: rail.dim,
            position: "sticky",
            top: 0,
            zIndex: 1,
          }}
        >
          <div>Time</div>
          <div>Service</div>
          <div>Data</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: rail.dim, padding: 40, fontFamily: f, fontSize: 12 }}>Loading logs…</div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: "center", color: rail.dim, padding: 40, fontFamily: f, fontSize: 12 }}>No rows in this window</div>
          ) : (
            entries.map((e, idx) => (
              <div
                key={e.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(108px, 18%) minmax(96px, 22%) 1fr",
                  gap: 8,
                  padding: "10px 12px",
                  alignItems: "start",
                  borderBottom: `1px solid ${rail.border}`,
                  borderLeft: `3px solid ${rail.accent}`,
                  background: idx % 2 === 1 ? rail.rowAlt : "transparent",
                }}
              >
                <div style={{ fontSize: 10, fontFamily: f, color: rail.muted, lineHeight: 1.35 }}>{formatTime(e.emittedAt)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {svcPill(e.service)}
                  <span style={{ fontSize: 9, fontFamily: f, color: levelColor(e.level), fontWeight: 700 }}>{e.level}</span>
                  <span style={{ fontSize: 9, fontFamily: f, color: rail.dim }}>{e.system}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontFamily: f, color: rail.text, wordBreak: "break-word", marginBottom: 4 }}>{e.message}</div>
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 10,
                      fontFamily: f,
                      color: "#94a3b8",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 140,
                      overflow: "auto",
                      lineHeight: 1.35,
                    }}
                  >
                    {compactDataPayload(e)}
                  </pre>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
