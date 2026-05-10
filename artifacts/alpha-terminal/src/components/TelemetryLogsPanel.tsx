import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithAuth, humanizeFailedApiBody } from "@/lib/fetchWithAuth";
import { Copy, Download, Pause, Play } from "lucide-react";

const f = "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace";

/** Matches `TelemetryPage` / native Telemetry styling */
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
const ROW_ALT = "rgba(255,255,255,0.02)";

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
            background: C.amber,
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
  const [fetchError, setFetchError] = useState<string | null>(null);
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
        const text = await res.text();
        if (!res.ok) {
          setFetchError(humanizeFailedApiBody(res.status, text));
          setEntries([]);
          setTruncated(false);
          return;
        }
        let data: { entries?: RuntimeLogEntry[]; truncated?: boolean };
        try {
          data = JSON.parse(text) as { entries?: RuntimeLogEntry[]; truncated?: boolean };
        } catch {
          setFetchError("Could not parse logs response.");
          setEntries([]);
          setTruncated(false);
          return;
        }
        setFetchError(null);
        setEntries(data.entries ?? []);
        setTruncated(Boolean(data.truncated));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Network error";
        setFetchError(`${msg} — check connection and retry.`);
        setEntries([]);
        setTruncated(false);
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
    if (level === "ERROR") return C.red;
    if (level === "WARN") return C.orange;
    return C.muted;
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
          color: isBrowser ? C.amber : C.muted,
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
    border: `1px solid ${C.border}`,
    background: "rgba(255,255,255,0.03)",
    color: C.text,
    fontFamily: f,
    fontSize: 10,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        color: C.text,
        fontSize: 13,
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 10, fontFamily: f, color: C.muted, lineHeight: 1.5 }}>
        Unified log stream: <strong style={{ color: C.text }}>Server</strong> rows include HTTP timing and{" "}
        <code style={{ color: C.amber }}>emitTelemetry</code>; <strong style={{ color: C.text }}>Web app</strong> rows come from browser errors
        forwarded to the API. Retention 30 days. Clerk session required.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 10, fontFamily: f, color: C.dim, marginRight: 4 }}>RANGE</span>
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
              border: `1px solid ${rangeMinutes === p.minutes ? C.amber : C.border}`,
              background: rangeMinutes === p.minutes ? "rgba(245,158,11,0.08)" : "transparent",
              color: rangeMinutes === p.minutes ? C.amber : C.dim,
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, fontFamily: f, color: C.dim }}>SOURCE</span>
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
              border: `1px solid ${serviceFilter === key ? C.amber : C.border}`,
              background: serviceFilter === key ? "rgba(245,158,11,0.08)" : "transparent",
              color: serviceFilter === key ? C.amber : C.dim,
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
            border: `1px solid ${C.border}`,
            background: C.card,
            color: C.text,
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
            border: `1px solid ${C.border}`,
            background: C.card,
            color: C.text,
            fontFamily: f,
            fontSize: 11,
          }}
        />
        <label style={{ fontSize: 10, fontFamily: f, color: C.dim, display: "flex", alignItems: "center", gap: 6 }}>
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
              border: `1px solid ${C.border}`,
              background: C.card,
              color: C.text,
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
            border: `1px solid ${C.amber}`,
            background: "rgba(245,158,11,0.06)",
            color: C.amber,
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
            border: `1px solid ${live ? "#26a69a" : C.border}`,
            background: live ? "rgba(38,166,154,0.06)" : "transparent",
            color: live ? "#26a69a" : C.dim,
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
        <span style={{ fontSize: 10, fontFamily: f, color: C.dim }}>Export</span>
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

      <div style={{ fontSize: 10, fontFamily: f, color: truncated ? C.orange : C.dim }}>
        {fetchError ? "—" : entries.length} rows
        {truncated ? " (hit row limit — narrow range or raise limit)" : ""}
      </div>

      {fetchError && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${C.red}`,
            background: "rgba(242,54,69,0.08)",
            color: "#ff8888",
            fontFamily: f,
            fontSize: 11,
            lineHeight: 1.45,
          }}
        >
          {fetchError}
          <div style={{ marginTop: 6, color: C.muted, fontSize: 10 }}>
            After a deploy, confirm the database migration for <code style={{ color: C.amber }}>telemetry_events.service</code> ran. Auth errors: reload or sign in again.
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 200,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          background: C.card,
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
            background: C.bg,
            borderBottom: `1px solid ${C.border}`,
            fontSize: 9,
            fontFamily: f,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: C.dim,
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
            <div style={{ textAlign: "center", color: C.dim, padding: 40, fontFamily: f, fontSize: 12 }}>Loading logs…</div>
          ) : fetchError ? (
            <div style={{ textAlign: "center", color: C.dim, padding: 24, fontFamily: f, fontSize: 11 }}>
              Fix the error above to load rows.
            </div>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: "center", color: C.dim, padding: 40, fontFamily: f, fontSize: 12 }}>
              <div>No rows in this window</div>
              {serviceFilter === "browser" && (
                <div
                  style={{
                    marginTop: 14,
                    marginLeft: "auto",
                    marginRight: "auto",
                    maxWidth: 340,
                    fontSize: 10,
                    color: C.muted,
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: C.text }}>SOURCE → Browser</strong> only lists events posted from this web app (uncaught errors and unhandled promise rejections). If nothing broke in the UI, this list stays empty. Choose{" "}
                  <strong style={{ color: C.text }}>All</strong> or <strong style={{ color: C.text }}>Server</strong> to see API traffic and server telemetry.
                </div>
              )}
            </div>
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
                  borderBottom: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${C.amber}`,
                  background: idx % 2 === 1 ? ROW_ALT : "transparent",
                }}
              >
                <div style={{ fontSize: 10, fontFamily: f, color: C.muted, lineHeight: 1.35 }}>{formatTime(e.emittedAt)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {svcPill(e.service)}
                  <span style={{ fontSize: 9, fontFamily: f, color: levelColor(e.level), fontWeight: 700 }}>{e.level}</span>
                  <span style={{ fontSize: 9, fontFamily: f, color: C.dim }}>{e.system}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontFamily: f, color: C.text, wordBreak: "break-word", marginBottom: 4 }}>{e.message}</div>
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 10,
                      fontFamily: f,
                      color: C.muted,
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
