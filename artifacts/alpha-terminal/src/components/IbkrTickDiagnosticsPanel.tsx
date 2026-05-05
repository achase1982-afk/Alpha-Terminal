/**
 * Settings → Diagnostics: IBKR tick-by-tick entitlement test (60s capture).
 * POST /api/admin/diagnostics/ibkr-tick-pilot uses the signed-in Clerk session (Bearer token).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Loader2, ChevronDown, ChevronUp, Activity } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "/api";

type PilotSummary = {
  nasdaq: string;
  nyse: string;
  nasdaqDetail: string;
  nyseDetail: string;
  blockTradeExtrapolation: Record<string, { blocksObserved60s: number; estimatedBlocksPerRthDay: number; thresholdShares: number | null }>;
  gatewayHost: string;
  gatewayPort: number;
  clientId: number;
};

type SymbolResult = {
  symbol: string;
  venue: string;
  rejected: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  tickCount: number;
  ticksPerSecond: number;
  blockCount: number;
  exchangesObserved: string[];
  ticksTruncated?: boolean;
};

type PilotRun = {
  id: string;
  runStartedAt: string;
  runCompletedAt?: string;
  durationSec?: number;
  perSymbolResults?: SymbolResult[];
  summary?: PilotSummary;
  triggeredByUserId?: string;
};

function isUsEquityRthEt(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  if (wd === "Sat" || wd === "Sun") return false;
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function fmtEt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return iso;
  }
}

function venueGlyph(s: string): string {
  if (s === "PASS") return "✓";
  if (s === "FAIL") return "✗";
  return "⚠";
}

export function IbkrTickDiagnosticsPanel() {
  const { userId } = useAuth();
  const inRth = useMemo(() => isUsEquityRthEt(), []);
  const [rthTick, setRthTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setRthTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const rthNow = useMemo(() => isUsEquityRthEt(), [rthTick]);

  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<PilotRun | null>(null);
  const [history, setHistory] = useState<PilotRun[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  const loadRecent = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetchWithAuth(`${API}/diagnostics/ibkr-tick-pilot/recent`);
      if (!res.ok) return;
      const j = await res.json();
      const runs = (j.runs ?? []) as PilotRun[];
      setHistory(runs);
      if (runs[0]) {
        const detail = await fetchWithAuth(`${API}/diagnostics/ibkr-tick-pilot/${runs[0].id}`);
        if (detail.ok) {
          const dj = await detail.json();
          if (dj.run) setLatest(dj.run as PilotRun);
        }
      } else {
        setLatest(null);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const runTest = async () => {
    if (!rthNow) {
      setError("Run only during US equity RTH (9:30–16:00 ET, Mon–Fri).");
      return;
    }
    setError(null);
    setRunning(true);
    setCountdown(60);
    const cd = setInterval(() => {
      setCountdown((c) => (c != null && c > 0 ? c - 1 : c));
    }, 1000);
    try {
      const res = await fetchWithAuth(`${API}/admin/diagnostics/ibkr-tick-pilot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ triggeredByUserId: userId ?? "unknown-user" }),
        clerkTokenTimeoutMs: 15_000,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : `Request failed (${res.status})`);
        return;
      }
      if (j.id) {
        setLatest({
          id: j.id,
          runStartedAt: j.runStartedAt,
          runCompletedAt: j.runCompletedAt,
          durationSec: j.durationSec,
          perSymbolResults: j.perSymbolResults,
          summary: j.summary,
          triggeredByUserId: userId ?? undefined,
        });
      }
      await loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      clearInterval(cd);
      setCountdown(null);
      setRunning(false);
    }
  };

  const btnDisabled = running || !rthNow;
  const btnTitle = !rthNow
    ? "Available during US equity regular hours only (9:30 AM–4:00 PM ET, weekdays)."
    : running
      ? "Test in progress."
      : "Run 60-second IBKR tick-by-tick Last entitlement capture";

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="rounded-lg border border-[#2A2A2C] bg-[#0c0c0c] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#FFB800]" aria-hidden />
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-zinc-300">IBKR tick entitlement</h3>
        </div>
        <p className="font-mono text-[10px] text-zinc-500 leading-relaxed">
          Subscribes to <span className="text-zinc-400">reqTickByTickData &quot;Last&quot;</span> on seven probe symbols (NASDAQ + NYSE) for 60 seconds using a dedicated API client ID. Results are stored in{" "}
          <code className="text-[#FFB800]/90">ibkr_diagnostics_runs</code>.
        </p>
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={btnDisabled}
          title={btnTitle}
          aria-describedby="ibkr-tick-pilot-help"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md font-mono text-[11px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB800] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0c0c]"
          style={{ background: "#FFB800", color: "#0a0a0a" }}
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : null}
          Run IBKR Tick Entitlement Test
        </button>
        <p id="ibkr-tick-pilot-help" className="sr-only">
          {btnTitle}
        </p>
        {running && countdown != null && (
          <p className="font-mono text-[11px] text-[#FFB800]" aria-live="polite">
            Running test… {countdown}s remaining
          </p>
        )}
        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}
      </div>

      {loadingList && <p className="font-mono text-[10px] text-zinc-500">Loading last run…</p>}

      {latest?.summary && (
        <div className="rounded-lg border border-[#2A2A2C] bg-[#0c0c0c] p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Latest run</span>
            <span className="font-mono text-[10px] text-zinc-400">{fmtEt(latest.runStartedAt)} ET</span>
          </div>
          <div className="font-mono text-[11px] text-zinc-200 space-y-1">
            <div>
              Entitlement:{" "}
              <span className="text-zinc-100">
                NASDAQ {venueGlyph(latest.summary.nasdaq)} {latest.summary.nasdaq}
              </span>
              {" · "}
              <span className="text-zinc-100">
                NYSE {venueGlyph(latest.summary.nyse)} {latest.summary.nyse}
              </span>
            </div>
            <p className="text-[10px] text-zinc-500">{latest.summary.nasdaqDetail}</p>
            <p className="text-[10px] text-zinc-500">{latest.summary.nyseDetail}</p>
            <p className="text-[10px] text-zinc-600">
              Gateway {latest.summary.gatewayHost}:{latest.summary.gatewayPort} · pilot clientId {latest.summary.clientId}
            </p>
          </div>

          {latest.perSymbolResults && latest.perSymbolResults.length > 0 && (
            <div className="overflow-x-auto border border-[#2A2A2C] rounded">
              <table className="w-full font-mono text-[10px] text-left">
                <thead>
                  <tr className="bg-[#141414] text-zinc-500 uppercase tracking-wider">
                    <th className="px-2 py-1.5 font-medium">Ticker</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                    <th className="px-2 py-1.5 font-medium">Err</th>
                    <th className="px-2 py-1.5 font-medium tabular-nums">Ticks</th>
                    <th className="px-2 py-1.5 font-medium tabular-nums">/s</th>
                    <th className="px-2 py-1.5 font-medium tabular-nums">Blocks</th>
                    <th className="px-2 py-1.5 font-medium">Venues</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.perSymbolResults.map((r) => (
                    <tr key={r.symbol} className="border-t border-[#2A2A2C] text-zinc-300">
                      <td className="px-2 py-1.5 font-bold text-white">{r.symbol}</td>
                      <td className="px-2 py-1.5">{r.rejected ? "rejected" : r.tickCount > 0 ? "ok" : "no ticks"}</td>
                      <td className="px-2 py-1.5 text-zinc-500">{r.errorCode ?? "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.tickCount}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.ticksPerSecond.toFixed(1)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.blockCount}</td>
                      <td className="px-2 py-1.5 text-zinc-500 max-w-[140px] truncate" title={r.exchangesObserved.join(", ")}>
                        {r.exchangesObserved.length ? r.exchangesObserved.join(", ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {latest.summary.blockTradeExtrapolation && (
            <div className="font-mono text-[10px] text-zinc-500 space-y-0.5">
              <div className="text-zinc-400 uppercase tracking-wider text-[9px]">Block extrapolation (full RTH day, linear)</div>
              {Object.entries(latest.summary.blockTradeExtrapolation).map(([sym, v]) => (
                <div key={sym}>
                  {sym}: ~{v.estimatedBlocksPerRthDay}/day (observed {v.blocksObserved60s} in 60s, threshold {v.thresholdShares ?? "—"} sh)
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setHistoryOpen((o) => !o)}
        className="flex items-center gap-1 font-mono text-[10px] text-[#FFB800] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB800] rounded"
        aria-expanded={historyOpen}
      >
        {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        View run history (last {history.length})
      </button>
      {historyOpen && (
        <ul className="space-y-1 font-mono text-[10px] text-zinc-500 border-l border-[#2A2A2C] pl-3">
          {history.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="text-left text-[#FFB800]/90 hover:underline"
                onClick={async () => {
                  const res = await fetchWithAuth(`${API}/diagnostics/ibkr-tick-pilot/${h.id}`);
                  if (res.ok) {
                    const j = await res.json();
                    if (j.run) setLatest(j.run as PilotRun);
                  }
                }}
              >
                {fmtEt(h.runStartedAt)} ET
              </button>
              {h.summary && (
                <span className="text-zinc-600">
                  {" "}
                  — NDAQ {h.summary.nasdaq} / NYSE {h.summary.nyse}
                </span>
              )}
            </li>
          ))}
          {history.length === 0 && <li className="text-zinc-600">No runs yet.</li>}
        </ul>
      )}
    </div>
  );
}
