import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithAuth, humanizeFailedApiBody } from "@/lib/fetchWithAuth";
import { writeTextToClipboard } from "@/lib/clipboardWrite";
import { Copy, Pause, Play, Terminal } from "lucide-react";

/** Live-tail accent aligned with terminal teal chrome */
const TEAL_LIVE = "#00FFC2";

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
  { label: "Last 2 min", minutes: 2 },
  { label: "Last 5 min", minutes: 5 },
  { label: "Last 10 min", minutes: 10 },
  { label: "Last 30 min", minutes: 30 },
  { label: "Last 1 h", minutes: 60 },
  { label: "Last 6 h", minutes: 360 },
  { label: "Last 24 h", minutes: 1440 },
  { label: "Last 7 d", minutes: 10080 },
  { label: "Last 30 d", minutes: 43200 },
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

function MinuteHistogram({ entries, barHeight = 22 }: { entries: RuntimeLogEntry[]; barHeight?: number }) {
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
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 1,
        height: barHeight,
        marginTop: 4,
        opacity: 0.85,
      }}
    >
      {tail.map(([minuteKey, count], i) => (
        <div
          key={`${minuteKey}-${i}`}
          title={`${count} events`}
          style={{
            flex: 1,
            minWidth: 2,
            height: `${Math.max(6, (count / max) * 100)}%`,
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
  const [manualCopy, setManualCopy] = useState<{ kind: "json" | "text"; text: string } | null>(null);
  const [exportChoice, setExportChoice] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const manualCopyRef = useRef<HTMLTextAreaElement | null>(null);

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
    if (!manualCopy) return;
    const id = window.setTimeout(() => {
      const el = manualCopyRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
    return () => clearTimeout(id);
  }, [manualCopy]);

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
    try {
      const p = buildParams();
      p.set("format", format);
      const res = await fetchWithAuth(`/api/telemetry/runtime-logs/export?${p.toString()}`);
      const text = await res.text();
      if (!res.ok) {
        setFetchError(humanizeFailedApiBody(res.status, text));
        return;
      }
      const mime =
        format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/plain";
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "text" ? "txt" : format;
      a.download = `telemetry-runtime-logs.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setFetchError(`${msg} — download failed.`);
    }
  };

  const copyAs = useCallback(
    async (format: "json" | "text") => {
      const text = format === "json" ? JSON.stringify(entries, null, 2) : entriesToPlainText(entries);
      const result = await writeTextToClipboard(text);
      if (result.ok) {
        setManualCopy(null);
        setCopyFlash(format);
        setTimeout(() => setCopyFlash(null), 2000);
        return;
      }
      setManualCopy({ kind: format, text });
      setCopyFlash(null);
    },
    [entries],
  );

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

  const selectStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    background: C.card,
    color: C.text,
    fontFamily: f,
    fontSize: 10,
    cursor: "pointer",
    maxHeight: 30,
  };

  const searchInputStyle: React.CSSProperties = {
    flex: "1 1 140px",
    minWidth: 120,
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.text,
    fontFamily: f,
    fontSize: 11,
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
        gap: 6,
      }}
      title="Server rows: HTTP timing and emitTelemetry. Web app: browser errors. 30-day retention. Clerk session required."
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <input
          type="search"
          placeholder="Filter and search logs"
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
          style={searchInputStyle}
          aria-label="Filter logs"
        />
        <select
          value={String(rangeMinutes)}
          onChange={(e) => setRangeMinutes(Number(e.target.value))}
          style={{ ...selectStyle, minWidth: 118 }}
          aria-label="Time range"
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p.minutes} value={p.minutes}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value as ServiceFilter)}
          style={{ ...selectStyle, minWidth: 112 }}
          aria-label="Log source"
        >
          <option value="all">All sources</option>
          <option value="server">Server</option>
          <option value="browser">Web app</option>
        </select>
        <button
          type="button"
          onClick={() => setLive((v) => !v)}
          title={live ? "Pause live refresh" : "Resume live refresh"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 30,
            padding: 0,
            borderRadius: 6,
            border: `1px solid ${live ? TEAL_LIVE : C.border}`,
            background: live ? "rgba(0,255,194,0.06)" : "transparent",
            color: live ? TEAL_LIVE : C.dim,
            cursor: "pointer",
          }}
        >
          {live ? <Pause size={14} strokeWidth={2.5} /> : <Play size={14} strokeWidth={2.5} />}
        </button>
        <button
          type="button"
          title="Copy rows as JSON"
          aria-label="Copy rows as JSON"
          onClick={() => void copyAs("json")}
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            width: 36,
            height: 34,
            padding: "2px 0 0",
            borderRadius: 6,
            border: `1px solid ${C.amberDim}`,
            background: "rgba(255,255,255,0.04)",
            color: C.amberDim,
            cursor: "pointer",
          }}
        >
          <Copy size={12} strokeWidth={2.25} />
          <span style={{ fontSize: 7, fontFamily: f, fontWeight: 800, letterSpacing: 0.5 }}>JSON</span>
        </button>
        <button
          type="button"
          title="Copy rows as tab-separated text"
          aria-label="Copy rows as plain text"
          onClick={() => void copyAs("text")}
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            width: 36,
            height: 34,
            padding: "2px 0 0",
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            background: "rgba(255,255,255,0.04)",
            color: C.amberDim,
            cursor: "pointer",
          }}
        >
          <Copy size={12} strokeWidth={2.25} />
          <span style={{ fontSize: 7, fontFamily: f, fontWeight: 800, letterSpacing: 0.5 }}>TXT</span>
        </button>
        <select
          value={exportChoice}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const reset = () => requestAnimationFrame(() => setExportChoice(""));
            if (v === "copy-json") {
              void copyAs("json");
              reset();
              return;
            }
            if (v === "copy-text") {
              void copyAs("text");
              reset();
              return;
            }
            reset();
            if (v === "dl-json") void downloadBlob("json");
            else if (v === "dl-csv") void downloadBlob("csv");
            else if (v === "dl-txt") void downloadBlob("text");
          }}
          style={{ ...selectStyle, minWidth: 104 }}
          aria-label="Export logs"
        >
          <option value="">Export…</option>
          <option value="copy-json">Copy JSON</option>
          <option value="copy-text">Copy text</option>
          <option value="dl-json">Download JSON</option>
          <option value="dl-csv">Download CSV</option>
          <option value="dl-txt">Download .txt</option>
        </select>
        {copyFlash ? (
          <span style={{ fontSize: 9, fontFamily: f, color: C.amberDim }}>Copied</span>
        ) : null}
      </div>

      {manualCopy ? (
        <div
          style={{
            border: `1px solid ${C.amber}`,
            borderRadius: 8,
            padding: "10px 12px",
            background: "rgba(245,158,11,0.06)",
          }}
        >
          <div style={{ fontSize: 10, fontFamily: f, color: C.text, marginBottom: 8, lineHeight: 1.45 }}>
            Automatic copy was blocked (common on mobile browsers). Select all text in the box below, then use your device&apos;s{" "}
            <strong>Copy</strong> command (long-press → Copy on iPhone).
          </div>
          <textarea
            ref={manualCopyRef}
            readOnly
            value={manualCopy.text}
            onFocus={(e) => e.target.select()}
            rows={Math.min(14, Math.max(5, manualCopy.text.split("\n").length + 1))}
            style={{
              width: "100%",
              maxHeight: 220,
              boxSizing: "border-box",
              padding: 8,
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              background: C.bg,
              color: C.text,
              fontFamily: f,
              fontSize: 10,
              lineHeight: 1.35,
              resize: "vertical",
            }}
            aria-label={manualCopy.kind === "json" ? "Logs JSON to copy manually" : "Logs plain text to copy manually"}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setManualCopy(null)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: `1px solid ${C.border}`,
                background: C.card,
                color: C.muted,
                fontFamily: f,
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <details style={{ fontSize: 10, fontFamily: f, color: C.muted }}>
        <summary style={{ cursor: "pointer", userSelect: "none" }}>Advanced filters</summary>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Systems (comma): HTTP, STRATEGIST…"
            value={filterSystems}
            onChange={(e) => setFilterSystems(e.target.value)}
            style={{ ...searchInputStyle, flex: "1 1 160px", minWidth: 140 }}
          />
          <label style={{ fontSize: 10, fontFamily: f, color: C.dim, display: "flex", alignItems: "center", gap: 6 }}>
            Row limit
            <input
              type="number"
              min={50}
              max={5000}
              step={50}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 500)}
              style={{
                width: 68,
                padding: "4px 6px",
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
              padding: "5px 10px",
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
            Apply filters
          </button>
        </div>
      </details>

      {!loading && entries.length > 0 ? <MinuteHistogram entries={entries} barHeight={22} /> : null}

      <div style={{ fontSize: 9, fontFamily: f, color: truncated ? C.orange : C.dim }}>
        {fetchError ? "—" : `${entries.length} row${entries.length === 1 ? "" : "s"}`}
        {truncated ? " · truncated (narrow range or raise limit)" : ""}
      </div>

      {fetchError ? (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            border: `1px solid ${C.red}`,
            background: "rgba(242,54,69,0.08)",
            color: "#ffaaaa",
            fontFamily: f,
            fontSize: 10,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
          }}
        >
          {fetchError}
        </div>
      ) : null}

      <div
        style={{
          flex: 1,
          minHeight: 160,
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
            <div style={{ textAlign: "center", color: C.dim, padding: 28, fontFamily: f, fontSize: 11 }}>Loading…</div>
          ) : fetchError ? (
            <div style={{ textAlign: "center", color: C.dim, padding: 20, fontFamily: f, fontSize: 11 }}>
              Resolve the error above to load logs.
            </div>
          ) : entries.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "32px 16px",
                color: C.muted,
                fontFamily: f,
                textAlign: "center",
                gap: 8,
              }}
            >
              <Terminal size={36} strokeWidth={1.25} style={{ opacity: 0.35 }} aria-hidden />
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>No logs in this time range</div>
              <div style={{ fontSize: 10, lineHeight: 1.5, maxWidth: 280 }}>
                Logs appear here as they are recorded. Try a wider range or pick All sources.
              </div>
              {serviceFilter === "browser" ? (
                <div style={{ fontSize: 10, lineHeight: 1.5, maxWidth: 300, marginTop: 4 }}>
                  Web app only shows uncaught browser errors. Use All or Server for API telemetry.
                </div>
              ) : null}
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
