import { useState, useMemo, memo } from "react";
import { Send, Activity, Layers, BarChart2 } from "lucide-react";
import { useFlowTimeSales, type FlowTrade } from "@/hooks/useFlowTimeSales";

// ── Drill-down card for a single Unusual Flow hit ────────────────────
//
// Three tabs:
//   • Overview      — score breakdown, P/C, total call/put vol, live exec
//                     counters, live aggressor counters from the SSE tape.
//   • Strikes       — top strikes by VOI; tap a row to view its live tape.
//                     Two-line layout per strike: header line (SIDE pill +
//                     strike + expiry) and metrics line (Volume / OI /
//                     V/OI / Notional / IV / Delta).
//   • Time & Sales  — live SSE stream of trades for the selected strike,
//                     tagged with Lee-Ready aggressor side, Polygon
//                     condition codes (Block/Sweep), bid in red and ask
//                     in green inside the NBBO cell, and the actual
//                     execution venue (ISE, CBOE, NASDAQ, PHLX, …).
//
// Visual contract: matches the Momentum and Discovery scanner cards so
// all three feel like one family — same label/value sizes, same gold
// "Send to Strategist" button, same padding scale, no abbreviations on
// any column header or pill.

const UP = "#26a69a";
const DOWN = "#f23645";
const GOLD = "#FFB800";
const NEUT = "#9ca3af";
const CYAN = "#66e0ff";

export interface UnusualFlowStrikeLite {
  strike: number;
  expiration: string;
  dte: number;
  optionType: "call" | "put";
  volume: number;
  openInterest: number;
  volOiRatio: number;
  notional: number;
  iv: number | null;
  delta: number | null;
  hasLiveExec?: boolean;
  symbol?: string;
}

export interface UnusualFlowExecLite {
  sweepCount: number;
  blockCount: number;
  regularCount: number;
  sweepNotional: number;
  blockNotional: number;
  regularNotional: number;
}

export interface FlowDrillDownCandidate {
  symbol: string;
  asOfDate: string;
  score: number;
  scoreReason: string;
  unusualStrikeCount: number;
  unusualCallStrikes: number;
  unusualPutStrikes: number;
  unusualCallVolume: number;
  unusualPutVolume: number;
  unusualTotalVolume: number;
  unusualTotalNotional: number;
  totalCallVolume: number;
  totalPutVolume: number;
  putCallVolumeRatio: number;
  skew: "bullish" | "bearish" | "balanced";
  topByVoiRatio: UnusualFlowStrikeLite[];
  topByNotional: UnusualFlowStrikeLite[];
  largestPrintDescription: string;
  topVoiRatio: number;
  avgDte: number;
  exec?: UnusualFlowExecLite;
  source?: "live" | "baseline" | "mixed";
}

// ── Formatting helpers ───────────────────────────────────────────────
function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}
function fmtTime(ts: number): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
function fmtPrice(p: number): string {
  return p < 10 ? p.toFixed(3) : p.toFixed(2);
}
function fmtDate(yyyymmdd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(yyyymmdd);
  if (!m) return yyyymmdd;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/**
 * OPRA / Polygon options exchange IDs. We map the most common venues to
 * recognizable short names that fit a tape column without abbreviation
 * (these ARE the standard market names — CBOE, ISE, PHLX etc are the
 * actual exchange identities, not abbreviations of longer words).
 */
const EXCHANGE_NAMES: Record<number, string> = {
  300: "OPRA",
  301: "NYSE Amex",
  302: "BOX",
  303: "CBOE",
  304: "MIAX",
  309: "ISE",
  312: "NYSE Arca",
  313: "NASDAQ",
  316: "BZX",
  322: "EDGX",
  323: "CBOE C2",
  325: "NASDAQ BX",
  327: "MIAX Pearl",
  328: "PHLX",
  330: "MIAX Emerald",
  331: "ISE Mercury",
  332: "ISE Gemini",
};
function fmtExchange(id: number): string {
  return EXCHANGE_NAMES[id] ?? (id ? `Exch ${id}` : "—");
}

/**
 * Build the OCC OPRA symbol for a strike if the server didn't provide it.
 * Format: "O:<UNDERLYING><YYMMDD><C|P><STRIKE×1000 padded to 8 digits>"
 */
function buildOccSymbol(underlying: string, expiration: string, optionType: "call" | "put", strike: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiration);
  if (!m) return "";
  const yymmdd = `${m[1].slice(2)}${m[2]}${m[3]}`;
  const cp = optionType === "call" ? "C" : "P";
  const strikeMills = Math.round(strike * 1000).toString().padStart(8, "0");
  return `O:${underlying.toUpperCase()}${yymmdd}${cp}${strikeMills}`;
}
function strikeContract(c: FlowDrillDownCandidate, s: UnusualFlowStrikeLite): string {
  return s.symbol && s.symbol.startsWith("O:") ? s.symbol : buildOccSymbol(c.symbol, s.expiration, s.optionType, s.strike);
}

type Tab = "overview" | "strikes" | "timesales";
type SizeFilter = "all" | "100" | "500" | "1000";
const SIZE_THRESHOLDS: Record<SizeFilter, number> = { all: 0, "100": 100, "500": 500, "1000": 1000 };

// ── Main component ───────────────────────────────────────────────────
export const FlowDrillDownCard = memo(function FlowDrillDownCard({
  candidate, onSendToStrategist,
}: {
  candidate: FlowDrillDownCandidate;
  onSendToStrategist?: (sym: string, flowContext: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedStrikeIdx, setSelectedStrikeIdx] = useState(0);
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>("all");

  const strikes = candidate.topByVoiRatio.slice(0, 6);
  const selectedStrike = strikes[selectedStrikeIdx] ?? strikes[0];
  const selectedContract = useMemo(
    () => (selectedStrike ? strikeContract(candidate, selectedStrike) : ""),
    [candidate, selectedStrike],
  );

  // We subscribe whenever the user is on Overview or Time & Sales — the
  // Overview live aggressor counter feeds off the same SSE stream.
  const ts = useFlowTimeSales(tab === "timesales" || tab === "overview" ? selectedContract : null);

  const filteredTrades = useMemo(() => {
    const min = SIZE_THRESHOLDS[sizeFilter];
    return min === 0 ? ts.trades : ts.trades.filter(t => t.size >= min);
  }, [ts.trades, sizeFilter]);

  const handleSendToStrategist = () => {
    if (!onSendToStrategist) return;
    const ctx = buildFlowContext(candidate, ts.counters, ts.trades.slice(0, 10));
    onSendToStrategist(candidate.symbol, ctx);
  };

  return (
    <>
      {/* Tab strip */}
      <div className="px-3 pt-2 border-t border-card-border/50 flex items-end gap-1" style={{ background: "#0a0a0a" }}>
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<BarChart2 className="w-3.5 h-3.5" />} label="Overview" />
        <TabButton active={tab === "strikes"} onClick={() => setTab("strikes")} icon={<Layers className="w-3.5 h-3.5" />} label="Strikes" />
        <TabButton active={tab === "timesales"} onClick={() => setTab("timesales")} icon={<Activity className="w-3.5 h-3.5" />} label="Time and Sales" />
        <div className="ml-auto flex items-center pr-1 pb-1.5">
          <StreamPill status={ts.status} />
        </div>
      </div>

      {/* Tab body */}
      {tab === "overview" && (
        <OverviewTab candidate={candidate} counters={ts.counters} streamStatus={ts.status} />
      )}
      {tab === "strikes" && (
        <StrikesTab
          candidate={candidate}
          strikes={strikes}
          selectedIdx={selectedStrikeIdx}
          onSelect={(i) => { setSelectedStrikeIdx(i); setTab("timesales"); }}
        />
      )}
      {tab === "timesales" && (
        <TimeSalesTab
          strikes={strikes}
          selectedIdx={selectedStrikeIdx}
          onSelectStrike={setSelectedStrikeIdx}
          sizeFilter={sizeFilter}
          onChangeFilter={setSizeFilter}
          trades={filteredTrades}
          totalCount={ts.trades.length}
          status={ts.status}
          error={ts.error}
          contract={selectedContract}
        />
      )}

      {/* Footer — score + Send to Strategist (matches Momentum/Discovery family) */}
      <div className="px-4 py-2.5 border-t border-card-border/50 flex items-center justify-between gap-3" style={{ background: "#0a0a0a" }}>
        <span className="text-[11px] text-zinc-500 font-mono truncate">
          Score {candidate.score.toFixed(1)} · {candidate.scoreReason}
        </span>
        {onSendToStrategist && (
          <button onClick={handleSendToStrategist}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded transition-all hover:bg-[#FFB800]/15 active:scale-95 shrink-0"
            style={{ color: GOLD, border: "1px solid rgba(255,184,0,0.3)" }}>
            <Send className="w-3 h-3" /> SEND TO STRATEGIST
          </button>
        )}
      </div>
    </>
  );
});

// ── Tab strip pieces ─────────────────────────────────────────────────
function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors"
      style={{
        color: active ? GOLD : "#a1a1aa",
        borderBottom: active ? `2px solid ${GOLD}` : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {icon}{label}
    </button>
  );
}

function StreamPill({ status }: { status: "connecting" | "live" | "error" | "disabled" }) {
  const cfg = {
    connecting: { color: GOLD, bg: "rgba(255,184,0,0.1)", label: "CONNECTING" },
    live:       { color: UP,   bg: "rgba(38,166,154,0.12)", label: "LIVE" },
    error:      { color: DOWN, bg: "rgba(242,54,69,0.12)",  label: "ERROR" },
    disabled:   { color: NEUT, bg: "rgba(156,163,175,0.08)", label: "REST ONLY" },
  }[status];
  return (
    <span
      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1.5"
      style={{ color: cfg.color, background: cfg.bg }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: cfg.color, animation: status === "live" ? "pulse 1.5s ease-in-out infinite" : undefined }}
      />
      {cfg.label}
    </span>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────
function OverviewTab({
  candidate, counters, streamStatus,
}: {
  candidate: FlowDrillDownCandidate;
  counters: { total: number; buy: number; sell: number; neutral: number; block: number; sweep: number; buyNotional: number; sellNotional: number };
  streamStatus: "connecting" | "live" | "error" | "disabled";
}) {
  const buyPct = counters.total > 0 ? (counters.buy / counters.total) * 100 : 0;
  const sellPct = counters.total > 0 ? (counters.sell / counters.total) * 100 : 0;

  return (
    <div className="px-4 py-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-card-border/50">
      <Stat label="Unusual Strikes" value={
        <>
          <span style={{ color: UP }}>{candidate.unusualCallStrikes} Call</span>
          <span className="text-zinc-600 mx-1.5">/</span>
          <span style={{ color: DOWN }}>{candidate.unusualPutStrikes} Put</span>
        </>
      } />
      <Stat label="Top Volume / Open Interest" value={
        <span style={{ color: CYAN }}>{candidate.topVoiRatio.toFixed(1)}×</span>
      } />

      <Stat label="Unusual Volume" value={
        <span className="text-white">{(candidate.unusualCallVolume + candidate.unusualPutVolume).toLocaleString()}</span>
      } />
      <Stat label="Call / Put Volume" value={
        <span className="text-white">
          {candidate.totalCallVolume.toLocaleString()}
          <span className="text-zinc-600 mx-1.5">/</span>
          {candidate.totalPutVolume.toLocaleString()}
        </span>
      } />

      <Stat label="Put / Call Ratio" value={
        <span className="text-white">{candidate.putCallVolumeRatio.toFixed(2)}</span>
      } />
      <Stat label="As Of" value={
        <span className="text-white">{candidate.asOfDate}</span>
      } />

      {candidate.exec && (
        <Stat label="Live Execution" value={
          <span>
            <span style={{ color: GOLD }}>{candidate.exec.sweepCount} Sweeps</span>
            <span className="text-zinc-600 mx-1.5">/</span>
            <span style={{ color: CYAN }}>{candidate.exec.blockCount} Blocks</span>
            <span className="text-zinc-600 mx-1.5">/</span>
            <span className="text-zinc-300">{candidate.exec.regularCount} Regular</span>
          </span>
        } />
      )}

      <Stat label="Aggressor Side" value={
        counters.total === 0 ? (
          <span className="text-zinc-500">
            {streamStatus === "live" ? "No prints on selected contract yet" : streamStatus === "error" ? "Stream error" : streamStatus === "disabled" ? "Live tape disabled" : "Connecting…"}
          </span>
        ) : (
          <span>
            <span style={{ color: UP }}>{counters.buy} Buy</span>
            <span className="text-zinc-600 mx-1.5">/</span>
            <span style={{ color: DOWN }}>{counters.sell} Sell</span>
            <span className="text-zinc-600 mx-1.5">/</span>
            <span className="text-zinc-300">{counters.neutral} Neutral</span>
          </span>
        )
      } />

      {counters.total > 0 && (
        <div className="col-span-2 pt-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
              Live Tape Split · {counters.total} {counters.total === 1 ? "print" : "prints"}
            </span>
            <span className="text-xs font-mono">
              <span style={{ color: UP }}>{fmtMoney(counters.buyNotional)}</span>
              <span className="text-zinc-600 mx-1.5">vs</span>
              <span style={{ color: DOWN }}>{fmtMoney(counters.sellNotional)}</span>
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden flex" style={{ background: "#1a1a1c" }}>
            <div style={{ width: `${buyPct}%`, background: UP }} />
            <div style={{ width: `${100 - buyPct - sellPct}%`, background: NEUT }} />
            <div style={{ width: `${sellPct}%`, background: DOWN }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ── Strikes tab ──────────────────────────────────────────────────────
function StrikesTab({
  candidate, strikes, selectedIdx, onSelect,
}: {
  candidate: FlowDrillDownCandidate;
  strikes: UnusualFlowStrikeLite[];
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="px-3 py-3 border-t border-card-border/50">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-2 px-1">
        Live execution-backed strikes · tap a row to view live tape
      </div>
      <div className="space-y-1.5">
        {strikes.length === 0 && (
          <div className="text-sm text-zinc-500 py-3 text-center">No strike detail available</div>
        )}
        {strikes.map((s, i) => {
          const isSelected = i === selectedIdx;
          const isCall = s.optionType === "call";
          const sideColor = isCall ? UP : DOWN;
          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className="w-full text-left px-3 py-2.5 rounded transition-colors"
              style={{
                background: isSelected ? "rgba(255,184,0,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${isSelected ? "rgba(255,184,0,0.3)" : "rgba(255,255,255,0.04)"}`,
              }}
            >
              {/* Header line: SIDE pill + strike + expiry */}
              <div className="flex items-center gap-3 mb-1.5">
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
                  style={{ color: sideColor, background: `${sideColor}1a`, border: `1px solid ${sideColor}40` }}
                >
                  {isCall ? "Call" : "Put"}
                </span>
                <span className="text-base font-bold text-white tabular-nums">${s.strike}</span>
                <span className="text-sm text-zinc-300">{fmtDate(s.expiration)}</span>
                <span className="text-sm text-zinc-500">· {s.dte} {s.dte === 1 ? "day" : "days"}</span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ml-auto"
                  style={{
                    color: s.hasLiveExec ? UP : NEUT,
                    background: s.hasLiveExec ? "rgba(38,166,154,0.12)" : "rgba(156,163,175,0.08)",
                    border: `1px solid ${s.hasLiveExec ? "rgba(38,166,154,0.28)" : "rgba(156,163,175,0.18)"}`,
                  }}
                >
                  {s.hasLiveExec ? "Live Print" : "Baseline"}
                </span>
              </div>
              {/* Metrics line: full-word labels, white values */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
                <Metric label="Volume" value={<span className="text-white">{s.volume.toLocaleString()}</span>} />
                <Metric label="Open Interest" value={<span className="text-white">{s.openInterest.toLocaleString()}</span>} />
                <Metric label="Vol/OI" value={<span style={{ color: CYAN }} className="font-bold">{s.volOiRatio.toFixed(1)}×</span>} />
                <Metric label="Notional" value={<span style={{ color: GOLD }} className="font-bold">{fmtMoney(s.notional)}</span>} />
                {s.iv != null && (
                  <Metric label="IV" value={<span className="text-white">{(s.iv * 100).toFixed(1)}%</span>} />
                )}
                {s.delta != null && (
                  <Metric label="Delta" value={<span className="text-white">{s.delta.toFixed(2)}</span>} />
                )}
              </div>
            </button>
          );
        })}
      </div>
      {strikes[selectedIdx] && (
        <div className="mt-2.5 px-2 text-[10px] font-mono text-zinc-600 truncate">
          contract: {strikeContract(candidate, strikes[selectedIdx])}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
      {value}
    </span>
  );
}

// ── Time & Sales tab ─────────────────────────────────────────────────
function TimeSalesTab({
  strikes, selectedIdx, onSelectStrike, sizeFilter, onChangeFilter,
  trades, totalCount, status, error, contract,
}: {
  strikes: UnusualFlowStrikeLite[];
  selectedIdx: number;
  onSelectStrike: (i: number) => void;
  sizeFilter: SizeFilter;
  onChangeFilter: (s: SizeFilter) => void;
  trades: FlowTrade[];
  totalCount: number;
  status: "connecting" | "live" | "error" | "disabled";
  error: string | null;
  contract: string;
}) {
  const selected = strikes[selectedIdx];

  return (
    <div className="border-t border-card-border/50">
      {/* Strike + filter row */}
      <div className="px-3 py-2.5 flex flex-wrap items-center gap-2 border-b border-card-border/50" style={{ background: "#0a0a0a" }}>
        {strikes.length > 1 ? (
          <select
            value={selectedIdx}
            onChange={(e) => onSelectStrike(parseInt(e.target.value, 10))}
            className="text-sm font-medium bg-[#1a1a1c] text-white px-2.5 py-1.5 rounded border border-zinc-800"
          >
            {strikes.map((s, i) => (
              <option key={i} value={i}>
                {s.optionType === "call" ? "Call" : "Put"} ${s.strike} · {fmtDate(s.expiration)}
              </option>
            ))}
          </select>
        ) : selected ? (
          <span className="text-sm font-semibold">
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider mr-2"
              style={{
                color: selected.optionType === "call" ? UP : DOWN,
                background: `${selected.optionType === "call" ? UP : DOWN}1a`,
                border: `1px solid ${selected.optionType === "call" ? UP : DOWN}40`,
              }}
            >
              {selected.optionType === "call" ? "Call" : "Put"}
            </span>
            <span className="text-white">${selected.strike}</span>
            <span className="text-zinc-400 ml-2">{fmtDate(selected.expiration)}</span>
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {(["all", "100", "500", "1000"] as SizeFilter[]).map(f => (
            <button
              key={f}
              onClick={() => onChangeFilter(f)}
              className="text-[11px] font-bold px-2.5 py-1 rounded transition-colors uppercase tracking-wider"
              style={{
                background: sizeFilter === f ? "rgba(255,184,0,0.15)" : "#1a1a1c",
                color: sizeFilter === f ? GOLD : "#a1a1aa",
                border: `1px solid ${sizeFilter === f ? "rgba(255,184,0,0.4)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              {f === "all" ? "All" : `≥${f}`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs font-medium" style={{ color: DOWN, background: "rgba(242,54,69,0.06)" }}>
          {error}
        </div>
      )}

      {/* Tape table — horizontal scroll on narrow screens, never crushed */}
      <div className="max-h-[340px] overflow-auto">
        {trades.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-zinc-500">
            {status === "live"
              ? "No new prints on this selected live contract yet."
              : status === "connecting"
              ? "Connecting to live tape…"
              : status === "error"
              ? "Stream disconnected"
              : status === "disabled"
              ? "Live tape disabled in this environment (showing recent prints from REST backfill if any)."
              : "No data"}
          </div>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead className="sticky top-0 z-10" style={{ background: "#0a0a0a" }}>
              <tr className="text-zinc-500 uppercase tracking-wider text-[11px] font-medium">
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-center px-2 py-2 font-medium">Side</th>
                <th className="text-right px-2 py-2 font-medium">Price</th>
                <th className="text-right px-2 py-2 font-medium">Size</th>
                <th className="text-right px-2 py-2 font-medium">NBBO</th>
                <th className="text-left px-3 py-2 font-medium">Exchange</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <TradeRow key={`${t.ts}-${i}`} trade={t} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="px-3 py-1.5 flex items-center justify-between text-[10px] font-mono text-zinc-600 border-t border-card-border/50">
        <span className="truncate">contract: {contract || "—"}</span>
        <span className="shrink-0 ml-2">
          showing {trades.length} of {totalCount} {sizeFilter !== "all" ? `(filter ≥${sizeFilter})` : ""}
        </span>
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: FlowTrade }) {
  const isBuy = trade.aggressor === "buy";
  const isSell = trade.aggressor === "sell";
  const sideColor = isBuy ? UP : isSell ? DOWN : NEUT;
  const sideLabel = isBuy ? "Buy" : isSell ? "Sell" : "—";
  return (
    <tr className="border-t border-card-border/40 hover:bg-white/[0.03]">
      <td className="px-3 py-1.5 text-zinc-400">{fmtTime(trade.ts)}</td>
      <td className="px-2 py-1.5 text-center">
        <span
          className="text-[11px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
          style={{ color: sideColor, background: `${sideColor}1a`, border: `1px solid ${sideColor}40` }}
        >
          {sideLabel}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right text-white font-medium">${fmtPrice(trade.price)}</td>
      <td className="px-2 py-1.5 text-right">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-white font-medium">{trade.size.toLocaleString()}</span>
          {trade.isSweep && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={{ background: "rgba(255,184,0,0.18)", color: GOLD }}>
              Sweep
            </span>
          )}
          {trade.isBlock && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={{ background: "rgba(102,224,255,0.18)", color: CYAN }}>
              Block
            </span>
          )}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right">
        {trade.nbbo ? (
          <span>
            <span style={{ color: DOWN }}>${fmtPrice(trade.nbbo.bid)}</span>
            <span className="text-zinc-600 mx-1">×</span>
            <span style={{ color: UP }}>${fmtPrice(trade.nbbo.ask)}</span>
          </span>
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </td>
      <td className="px-3 py-1.5 text-left text-zinc-300">{fmtExchange(trade.exchange)}</td>
    </tr>
  );
}

// ── Flow context builder for Send to Strategist ──────────────────────
function buildFlowContext(
  c: FlowDrillDownCandidate,
  counters: { total: number; buy: number; sell: number; neutral: number; block: number; sweep: number; buyNotional: number; sellNotional: number },
  recent: FlowTrade[],
): string {
  const lines: string[] = [];
  lines.push(`Ticker: ${c.symbol} · Skew: ${c.skew.toUpperCase()} · Score: ${c.score.toFixed(1)}`);
  lines.push(`Score reason: ${c.scoreReason}`);
  lines.push(`Unusual strikes: ${c.unusualStrikeCount} (${c.unusualCallStrikes} call / ${c.unusualPutStrikes} put)`);
  lines.push(`Unusual volume: ${(c.unusualCallVolume + c.unusualPutVolume).toLocaleString()} contracts · notional ${fmtMoney(c.unusualTotalNotional)}`);
  lines.push(`Total call/put volume: ${c.totalCallVolume.toLocaleString()} / ${c.totalPutVolume.toLocaleString()} (P/C ${c.putCallVolumeRatio.toFixed(2)})`);
  lines.push(`Top VOI ratio: ${c.topVoiRatio.toFixed(1)}× · Avg DTE: ${c.avgDte}d · As of ${c.asOfDate}`);

  if (c.exec) {
    lines.push(`Detected execution mix: ${c.exec.sweepCount} sweeps (${fmtMoney(c.exec.sweepNotional)}), ${c.exec.blockCount} blocks (${fmtMoney(c.exec.blockNotional)}), ${c.exec.regularCount} regular`);
  }

  if (c.topByVoiRatio.length > 0) {
    lines.push(``);
    lines.push(`Top strikes by Volume/OI:`);
    for (const s of c.topByVoiRatio.slice(0, 6)) {
      lines.push(`  - ${s.optionType.toUpperCase()} $${s.strike} ${s.expiration} (${s.dte}d) · vol ${s.volume.toLocaleString()} · OI ${s.openInterest.toLocaleString()} · V/OI ${s.volOiRatio.toFixed(1)}× · notional ${fmtMoney(s.notional)}${s.iv != null ? ` · IV ${(s.iv * 100).toFixed(1)}%` : ""}${s.delta != null ? ` · Δ ${s.delta.toFixed(2)}` : ""}`);
    }
  }

  if (counters.total > 0) {
    const buyPct = (counters.buy / counters.total * 100).toFixed(0);
    const sellPct = (counters.sell / counters.total * 100).toFixed(0);
    lines.push(``);
    lines.push(`Live tape (last ${counters.total} prints, Lee-Ready aggressor inference vs NBBO):`);
    lines.push(`  - Buy-initiated:  ${counters.buy} (${buyPct}%) · ${fmtMoney(counters.buyNotional)} notional`);
    lines.push(`  - Sell-initiated: ${counters.sell} (${sellPct}%) · ${fmtMoney(counters.sellNotional)} notional`);
    lines.push(`  - Neutral/at-mid: ${counters.neutral}`);
    lines.push(`  - Sweeps: ${counters.sweep} · Blocks: ${counters.block}`);
  } else {
    lines.push(``);
    lines.push(`Live tape: no prints observed yet (illiquid contract or after-hours).`);
  }

  if (recent.length > 0) {
    lines.push(``);
    lines.push(`Most recent prints:`);
    for (const t of recent) {
      const side = t.aggressor === "buy" ? "BUY" : t.aggressor === "sell" ? "SELL" : "—";
      const tag = [t.isSweep ? "SWEEP" : null, t.isBlock ? "BLOCK" : null].filter(Boolean).join(",");
      lines.push(`  - ${fmtTime(t.ts)} · ${t.size}@${fmtPrice(t.price)} · ${side}${tag ? ` [${tag}]` : ""}${t.nbbo ? ` (NBBO ${fmtPrice(t.nbbo.bid)}×${fmtPrice(t.nbbo.ask)})` : ""}${t.exchange ? ` @ ${fmtExchange(t.exchange)}` : ""}`);
    }
  }

  return lines.join("\n");
}
