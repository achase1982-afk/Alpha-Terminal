import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Trophy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Outcome scoreboard: what actually happened to the cards the strategist issued.
 * Every recommendation is enrolled at signal time, marked at its time stop or
 * expiration, and scored WIN / LOSS / FLAT against the entry structure value.
 */

interface BucketStat {
  key: string;
  n: number;
  wins: number;
  hitRate: number | null;
  avgPnlPctOfRisk: number | null;
  avgPnlPerShare: number | null;
}

interface ScoreboardSummary {
  scored: number;
  pending: number;
  unscorable: number;
  wins: number;
  losses: number;
  flats: number;
  hitRate: number | null;
  avgPnlPctOfRisk: number | null;
  payoffRatio: number | null;
  expectancyPctOfRisk: number | null;
}

interface RecentRow {
  id: number;
  ticker: string;
  signalAt: string;
  strategyType: string | null;
  direction: string | null;
  confidence: number | null;
  entryValue: number;
  markValue: number | null;
  markSource: string | null;
  markDate: string | null;
  pnlPerShare: number | null;
  pnlPctOfRisk: number | null;
  outcome: string | null;
  status: string;
  modelName: string | null;
  mode: string | null;
  markDue: string;
}

interface Scoreboard {
  windowDays: number;
  summary: ScoreboardSummary;
  byConfidence: BucketStat[];
  byFamily: BucketStat[];
  byDirection: BucketStat[];
  byModel: BucketStat[];
  byMode: BucketStat[];
  recent: RecentRow[];
}

const WINDOWS = [30, 90, 180, 365] as const;

function pct(v: number | null, signed = false): string {
  if (v == null) return "—";
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v}%`;
}

function toneFor(v: number | null): string {
  if (v == null) return "text-zinc-400";
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-zinc-300";
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-md border border-[#2A2A2C] bg-[#0c0c0c] px-2.5 py-2" title={hint}>
      <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono text-[15px] font-bold ${tone ?? "text-white"}`}>{value}</div>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: BucketStat[] }) {
  const visible = rows.filter((r) => r.n > 0);
  if (visible.length === 0) return null;
  return (
    <div className="rounded-md border border-[#2A2A2C] bg-[#0c0c0c] overflow-hidden">
      <div className="px-2.5 py-1.5 border-b border-[#2A2A2C] font-mono text-[10px] uppercase tracking-wider text-zinc-400">
        {title}
      </div>
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="text-zinc-600">
            <th className="text-left font-normal px-2.5 py-1">Bucket</th>
            <th className="text-right font-normal px-2 py-1">N</th>
            <th className="text-right font-normal px-2 py-1">Hit</th>
            <th className="text-right font-normal px-2.5 py-1">Avg % risk</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.key} className="border-t border-[#1c1c1e]">
              <td className="px-2.5 py-1 text-zinc-300 truncate max-w-[160px]" title={r.key}>{r.key}</td>
              <td className="px-2 py-1 text-right text-zinc-400">{r.n}</td>
              <td className="px-2 py-1 text-right text-zinc-300">{r.hitRate == null ? "—" : `${r.hitRate}%`}</td>
              <td className={`px-2.5 py-1 text-right ${toneFor(r.avgPnlPctOfRisk)}`}>{pct(r.avgPnlPctOfRisk, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StrategistScoreboardPanel() {
  const [board, setBoard] = useState<Scoreboard | null>(null);
  const [days, setDays] = useState<number>(90);
  const [loading, setLoading] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  const load = useCallback(async (windowDays: number) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/strategist/scoreboard?days=${windowDays}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBoard((await res.json()) as Scoreboard);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const scoreNow = useCallback(async () => {
    setScoring(true);
    try {
      const res = await fetchWithAuth(`/api/strategist/scoreboard/score-now?days=${days}`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { cycle: { enrolled: number; scored: number; unscorable: number }; board: Scoreboard };
      setBoard(data.board);
      setErr(null);
      toast.success(`Scoreboard: ${data.cycle.enrolled} enrolled, ${data.cycle.scored} marked`);
    } catch (e) {
      toast.error(`Scoreboard run failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScoring(false);
    }
  }, [days]);

  const s = board?.summary;
  const recent = useMemo(() => board?.recent ?? [], [board]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm font-bold text-white tracking-wider uppercase flex items-center gap-2">
          <Trophy className="w-4 h-4 text-[#f5a623]" /> Scoreboard
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full p-0.5" style={{ background: "#27272a" }}>
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className="px-2 py-0.5 rounded-full font-mono text-[11px] font-bold tracking-wider"
                style={{ background: days === w ? "#3f3f46" : "transparent", color: days === w ? "#fff" : "#71717a" }}
              >
                {w}D
              </button>
            ))}
          </div>
          <button
            onClick={() => void scoreNow()}
            disabled={scoring}
            title="Enroll new cards and mark everything that is due"
            className="p-1 rounded-md border border-[#2A2A2C] text-zinc-400 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scoring ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {err && (
        <p className="font-mono text-[11px] text-red-400 border border-red-900/60 rounded-md px-2 py-1.5 bg-red-950/40" role="alert">
          Could not load scoreboard: {err}
        </p>
      )}

      {!board && loading && <p className="font-mono text-[11px] text-zinc-500">Loading scoreboard…</p>}

      {s && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <Kpi label="Scored" value={String(s.scored)} hint="Cards with a realized mark" />
            <Kpi label="Hit rate" value={s.hitRate == null ? "—" : `${s.hitRate}%`} tone={s.hitRate == null ? undefined : s.hitRate >= 50 ? "text-emerald-400" : "text-red-400"} hint="Share of scored cards that finished profitable" />
            <Kpi label="Expectancy" value={pct(s.expectancyPctOfRisk, true)} tone={toneFor(s.expectancyPctOfRisk)} hint="Average P&L per card as a % of max risk" />
            <Kpi label="Avg P&L" value={pct(s.avgPnlPctOfRisk, true)} tone={toneFor(s.avgPnlPctOfRisk)} hint="Mean realized P&L as a % of max risk" />
            <Kpi label="Payoff" value={s.payoffRatio == null ? "—" : `${s.payoffRatio}x`} hint="Average win ÷ average loss" />
            <Kpi label="Open" value={`${s.pending}${s.unscorable ? ` / ${s.unscorable}✕` : ""}`} hint="Pending marks / cards that could not be marked" />
          </div>
          <p className="font-mono text-[10px] text-zinc-500">
            {s.wins}W · {s.losses}L · {s.flats} flat over {board.windowDays} days. Cards are marked at the time stop or
            expiration, whichever comes first, using the option chain, expiry intrinsic value, or a live quote.
          </p>

          <div className="grid grid-cols-1 gap-1.5">
            <BucketTable title="By stated confidence" rows={board.byConfidence} />
            <BucketTable title="By strategy family" rows={board.byFamily} />
            <BucketTable title="By direction" rows={board.byDirection} />
            <BucketTable title="By model" rows={board.byModel} />
            <BucketTable title="By mode" rows={board.byMode} />
          </div>

          {recent.length > 0 && (
            <div className="rounded-md border border-[#2A2A2C] bg-[#0c0c0c] overflow-hidden">
              <button
                onClick={() => setShowRecent((v) => !v)}
                className="w-full px-2.5 py-1.5 border-b border-[#2A2A2C] font-mono text-[10px] uppercase tracking-wider text-zinc-400 text-left hover:text-white"
              >
                {showRecent ? "▾" : "▸"} Recent cards ({recent.length})
              </button>
              {showRecent && (
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full font-mono text-[11px]">
                    <thead className="sticky top-0 bg-[#0c0c0c]">
                      <tr className="text-zinc-600">
                        <th className="text-left font-normal px-2.5 py-1">Ticker</th>
                        <th className="text-left font-normal px-2 py-1">Signal</th>
                        <th className="text-right font-normal px-2 py-1">Conf</th>
                        <th className="text-left font-normal px-2 py-1">Status</th>
                        <th className="text-right font-normal px-2.5 py-1">% risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((r) => (
                        <tr key={r.id} className="border-t border-[#1c1c1e]">
                          <td className="px-2.5 py-1 text-white" title={`${r.strategyType ?? ""} ${r.direction ?? ""} · ${r.modelName ?? "?"} · mark due ${r.markDue}`}>
                            {r.ticker}
                          </td>
                          <td className="px-2 py-1 text-zinc-500">{r.signalAt.slice(5, 10)}</td>
                          <td className="px-2 py-1 text-right text-zinc-400">{r.confidence ?? "—"}</td>
                          <td className="px-2 py-1">
                            <span
                              className={
                                r.outcome === "WIN"
                                  ? "text-emerald-400"
                                  : r.outcome === "LOSS"
                                    ? "text-red-400"
                                    : r.status === "pending"
                                      ? "text-zinc-500"
                                      : "text-zinc-400"
                              }
                            >
                              {r.outcome ?? (r.status === "pending" ? `open → ${r.markDue.slice(5)}` : r.status)}
                            </span>
                          </td>
                          <td className={`px-2.5 py-1 text-right ${toneFor(r.pnlPctOfRisk)}`}>{pct(r.pnlPctOfRisk, true)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {s.scored === 0 && (
            <p className="font-mono text-[10px] text-zinc-500 border border-[#2A2A2C] rounded-md px-2 py-1.5">
              No cards scored yet. Recommendations are enrolled as they are issued and marked once their time stop or
              expiration passes. The desk sees this record in its prompt after 10 cards are scored.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default StrategistScoreboardPanel;
