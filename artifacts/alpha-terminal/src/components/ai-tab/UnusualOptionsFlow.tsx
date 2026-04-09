import { useState, useEffect, useCallback } from "react";
import { Download, RefreshCw, TrendingUp, TrendingDown, AlertCircle, Database, ChevronDown } from "lucide-react";

const API = import.meta.env.BASE_URL + "api";
const GOLD = "#FFB800";
const BG2 = "#111113";
const BORDER = "#2A2A2C";
const UP = "#2ecc71";
const DOWN = "#ff4b5c";

interface UnusualRow {
  ticker: string;
  optionSymbol: string;
  strike: number;
  expiry: string;
  putCall: string;
  type: "CALL" | "PUT";
  todayVolume: number;
  avgVolume30d: number;
  volumeRatio: number | null;
  closePrice: number | null;
  premiumFlow: number | null;
  openInterest: number | null;
  voiRatio: number | null;
  dataPoints: number;
  latestDate: string;
}

interface SyncLog {
  tradeDate: string;
  status: string;
  rowsInserted: number | null;
  errorMsg: string | null;
}

interface Status {
  totalRows: number;
  recentLogs: SyncLog[];
  configured: boolean;
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(0) + "K";
  return v.toLocaleString();
}

function fmtFlow(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return "$" + (v / 1_000).toFixed(0) + "K";
  return "$" + v.toLocaleString();
}

export function UnusualOptionsFlow({ watchedSymbols }: { watchedSymbols?: string[] }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [activity, setActivity] = useState<UnusualRow[]>([]);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterTicker, setFilterTicker] = useState("");
  const [filterType, setFilterType] = useState<"all" | "CALL" | "PUT">("all");
  const [minRatio, setMinRatio] = useState(2.5);
  const [syncDays, setSyncDays] = useState(30);
  const [showSettings, setShowSettings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/unusual-options/status`);
      const d = await r.json();
      setStatus(d);
    } catch { }
  }, []);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        minRatio: String(minRatio),
        minVolume: "200",
        limit: "300",
      });
      if (filterTicker) params.set("tickers", filterTicker.toUpperCase());
      const r = await fetch(`${API}/unusual-options/activity?${params}`);
      const d = await r.json();
      if (d.error) { setError(d.error); return; }
      setActivity(d.unusual ?? []);
      setLatestDate(d.latestDate ?? null);
      if (d.message) setMessage(d.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [minRatio, filterTicker]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (status && status.totalRows > 0) {
      fetchActivity();
    }
  }, [status, fetchActivity]);

  const handleSync = async () => {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const tickers = filterTicker
        ? filterTicker.split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
        : (watchedSymbols ?? []);

      await fetch(`${API}/unusual-options/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, days: syncDays }),
      });
      setMessage(`Downloading ${syncDays} days of options data${tickers.length > 0 ? ` for ${tickers.join(", ")}` : " (all symbols)"}. This runs in the background — check back in a few minutes.`);
      setTimeout(() => fetchStatus(), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const filtered = activity.filter(r => {
    if (filterType !== "all" && r.type !== filterType) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div className="rounded-xl overflow-hidden" style={{ background: BG2, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4" style={{ color: GOLD }} />
            <span className="font-mono text-[11px] font-bold tracking-widest" style={{ color: GOLD }}>
              UNUSUAL OPTIONS FLOW
            </span>
            {latestDate && (
              <span className="font-mono text-[10px] text-zinc-600">· {latestDate}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(s => !s)}
              className="font-mono text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <ChevronDown className="w-4 h-4" style={{ transform: showSettings ? "rotate(180deg)" : undefined }} />
            </button>
            <button
              onClick={fetchActivity}
              disabled={loading}
              className="p-1.5 rounded-lg transition-colors hover:opacity-80"
              style={{ background: "#1a1a1c" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="px-4 pb-3 pt-1 space-y-3 border-t" style={{ borderColor: BORDER }}>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="font-mono text-[10px] text-zinc-500 uppercase mb-1">Min Vol Ratio</p>
                <input
                  type="number"
                  value={minRatio}
                  onChange={e => setMinRatio(parseFloat(e.target.value) || 2.5)}
                  step={0.5}
                  min={1}
                  max={20}
                  className="w-full font-mono text-[12px] px-2 py-1.5 rounded-lg text-white"
                  style={{ background: "#0a0a0a", border: `1px solid ${BORDER}` }}
                />
              </div>
              <div>
                <p className="font-mono text-[10px] text-zinc-500 uppercase mb-1">Sync Days (max 90)</p>
                <input
                  type="number"
                  value={syncDays}
                  onChange={e => setSyncDays(Math.min(90, parseInt(e.target.value) || 30))}
                  min={1}
                  max={90}
                  className="w-full font-mono text-[12px] px-2 py-1.5 rounded-lg text-white"
                  style={{ background: "#0a0a0a", border: `1px solid ${BORDER}` }}
                />
              </div>
            </div>
            <div>
              <p className="font-mono text-[10px] text-zinc-500 uppercase mb-1">Filter Tickers (comma-sep)</p>
              <input
                type="text"
                value={filterTicker}
                onChange={e => setFilterTicker(e.target.value)}
                placeholder="AAPL, TSLA, SPY (blank = all)"
                className="w-full font-mono text-[12px] px-2 py-1.5 rounded-lg text-white placeholder:text-zinc-700"
                style={{ background: "#0a0a0a", border: `1px solid ${BORDER}` }}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-[12px] font-bold transition-all active:scale-[0.98]"
                style={{ background: syncing ? "#1a1a1c" : GOLD, color: syncing ? "#71717a" : "#050607" }}
              >
                <Download className={`w-3.5 h-3.5 ${syncing ? "animate-bounce" : ""}`} />
                {syncing ? "Starting..." : `Download ${syncDays}d Data`}
              </button>
              <button
                onClick={fetchActivity}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-[12px] font-bold transition-all active:scale-[0.98]"
                style={{ background: "#1a1a1c", color: "#b8bcc8", border: `1px solid ${BORDER}` }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        )}

        {status && (
          <div className="flex items-center gap-3 px-4 py-2 border-t text-zinc-600 font-mono text-[10px]"
            style={{ borderColor: BORDER }}>
            <span className="flex items-center gap-1">
              <Database className="w-3 h-3" />
              {status.totalRows.toLocaleString()} rows
            </span>
            {status.recentLogs.length > 0 && (
              <span>
                Last sync: {status.recentLogs[0].tradeDate}
                {" · "}
                <span style={{ color: status.recentLogs[0].status === "synced" ? UP : status.recentLogs[0].status === "failed" ? DOWN : GOLD }}>
                  {status.recentLogs[0].status}
                </span>
              </span>
            )}
            {status.totalRows === 0 && !showSettings && (
              <button
                onClick={() => setShowSettings(true)}
                className="ml-auto font-bold"
                style={{ color: GOLD }}
              >
                → Download data to get started
              </button>
            )}
          </div>
        )}
      </div>

      {message && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl font-mono text-[11px]"
          style={{ background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.2)", color: GOLD }}>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {message}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl font-mono text-[11px]"
          style={{ background: "rgba(242,54,69,0.08)", border: "1px solid rgba(242,54,69,0.2)", color: DOWN }}>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {activity.length > 0 && (
        <>
          <div className="flex gap-2">
            {(["all", "CALL", "PUT"] as const).map(t => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className="px-3 py-1.5 rounded-full font-mono text-[11px] font-bold transition-all"
                style={{
                  background: filterType === t
                    ? t === "CALL" ? UP : t === "PUT" ? DOWN : "#3f3f46"
                    : "#1a1a1c",
                  color: filterType === t ? "#050607" : "#71717a",
                  border: "1px solid transparent",
                }}
              >
                {t === "all" ? `ALL (${activity.length})` : t === "CALL" ? `CALLS (${activity.filter(r => r.type === "CALL").length})` : `PUTS (${activity.filter(r => r.type === "PUT").length})`}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filtered.slice(0, 50).map((row, i) => (
              <div
                key={`${row.optionSymbol}-${i}`}
                className="rounded-xl overflow-hidden"
                style={{ background: BG2, border: `1px solid ${BORDER}` }}
              >
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[15px] font-bold text-white">{row.ticker}</span>
                      <span
                        className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: row.type === "CALL" ? `${UP}20` : `${DOWN}20`,
                          color: row.type === "CALL" ? UP : DOWN,
                        }}
                      >
                        {row.type === "CALL" ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
                        {row.type}
                      </span>
                      {row.volumeRatio != null && (
                        <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: row.volumeRatio >= 5 ? "rgba(255,184,0,0.15)" : "rgba(255,255,255,0.06)",
                            color: row.volumeRatio >= 5 ? GOLD : "#b8bcc8",
                          }}>
                          {row.volumeRatio.toFixed(1)}x
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[13px] font-bold"
                      style={{ color: row.type === "CALL" ? UP : DOWN }}>
                      {fmtFlow(row.premiumFlow)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-zinc-600 font-mono text-[10px] mb-3">
                    <span>${row.strike} {row.type === "CALL" ? "C" : "P"}</span>
                    <span>·</span>
                    <span>{row.expiry}</span>
                    {row.closePrice != null && (
                      <>
                        <span>·</span>
                        <span className="text-zinc-400">${row.closePrice.toFixed(2)}</span>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-[#0a0a0a] rounded-lg px-2 py-1.5 border border-[#1a1a1c]">
                      <p className="font-mono text-[9px] text-zinc-600 uppercase">Today Vol</p>
                      <p className="font-mono text-[12px] font-bold text-white mt-0.5">{fmtVol(row.todayVolume)}</p>
                    </div>
                    <div className="bg-[#0a0a0a] rounded-lg px-2 py-1.5 border border-[#1a1a1c]">
                      <p className="font-mono text-[9px] text-zinc-600 uppercase">30d Avg Vol</p>
                      <p className="font-mono text-[12px] font-bold text-zinc-400 mt-0.5">{fmtVol(row.avgVolume30d)}</p>
                    </div>
                    <div className="bg-[#0a0a0a] rounded-lg px-2 py-1.5 border border-[#1a1a1c]">
                      <p className="font-mono text-[9px] text-zinc-600 uppercase">OI / V:OI</p>
                      <p className="font-mono text-[12px] font-bold text-zinc-400 mt-0.5">
                        {row.openInterest ? fmtVol(row.openInterest) : "—"}
                        {row.voiRatio != null && <span className="text-zinc-600 text-[9px] ml-1">{row.voiRatio.toFixed(2)}x</span>}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {filtered.length > 50 && (
              <p className="font-mono text-[11px] text-zinc-600 text-center py-2">
                +{filtered.length - 50} more — apply filters to narrow down
              </p>
            )}
          </div>
        </>
      )}

      {!loading && activity.length === 0 && !message && !error && status && status.totalRows === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Database className="w-10 h-10 text-zinc-700" />
          <p className="font-mono text-[12px] text-zinc-500 text-center">
            No historical options data yet.
          </p>
          <p className="font-mono text-[11px] text-zinc-700 text-center">
            Tap the settings above and download data to detect unusual flow.
          </p>
          <button
            onClick={() => setShowSettings(true)}
            className="mt-1 px-4 py-2 rounded-lg font-mono text-[12px] font-bold"
            style={{ background: GOLD, color: "#050607" }}
          >
            <Download className="w-3.5 h-3.5 inline mr-1" />
            Get Started
          </button>
        </div>
      )}

      {!loading && activity.length === 0 && !error && status && status.totalRows > 0 && (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <p className="font-mono text-[12px] text-zinc-500">No unusual activity above {minRatio}x threshold.</p>
          <p className="font-mono text-[11px] text-zinc-700">Try lowering the min ratio in settings.</p>
        </div>
      )}
    </div>
  );
}
