import { useState, useMemo, memo } from "react";
import { Send, Activity, Layers, BarChart2 } from "lucide-react";
import { useFlowTimeSales, type FlowTrade } from "@/hooks/useFlowTimeSales";

// ── Drill-down card for a single Unusual Flow hit ────────────────────
//
// Three tabs:
//   • Overview  — score breakdown, P/C, total call/put vol, live exec counters,
//                 aggressor counters from the live T&S stream.
//   • Strikes   — top strikes by VOI (existing data) + per-strike live tape size.
//   • Time & Sales — live SSE stream of trades for the selected strike, tagged
//                 with Lee-Ready aggressor side and condition-code block/sweep.
//                 Size filter chips: All / ≥100 / ≥500 / ≥1000.
//
// "Send to Strategist" snapshots the current flow context (ticker, score,
// strike list, top counters, aggressor split) and forwards it to the
// strategist analyze handler.

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
  // Server returns OPRA symbol as `symbol` per polygonUnusualFlowScan; the
  // scanner result type doesn't expose it on the strike object today, so
  // it's optional here. When absent we synthesize the OPRA OCC.
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
}

function fmtCompactInt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}
function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
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

/**
 * Build the OCC OPRA symbol for a strike if the server didn't provide it.
 * Format: "O:<UNDERLYING><YYMMDD><C|P><STRIKE×1000 padded to 8 digits>"
 * Example: AAPL 2025-12-19 450 C → O:AAPL251219C00450000
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
      <div className="px-3 pt-2 border-t border-card-border/50 flex gap-1" style={{ background: "#0a0a0a" }}>
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<BarChart2 className="w-3 h-3" />} label="Overview" />
        <TabButton active={tab === "strikes"} onClick={() => setTab("strikes")} icon={<Layers className="w-3 h-3" />} label="Strikes" />
        <TabButton active={tab === "timesales"} onClick={() => setTab("timesales")} icon={<Activity className="w-3 h-3" />} label="Time & Sales" />
        <div className="ml-auto flex items-center pr-1">
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
          candidate={candidate}
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

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-card-border/50 flex items-center justify-between" style={{ background: "#0a0a0a" }}>
        <span className="text-[10px] text-zinc-600 font-mono">
          Score {candidate.score.toFixed(1)} · {candidate.scoreReason}
        </span>
        {onSendToStrategist && (
          <button onClick={handleSendToStrategist}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded transition-all hover:bg-[#FFB800]/15 active:scale-95"
            style={{ color: GOLD, border: "1px solid rgba(255,184,0,0.3)" }}>
            <Send className="w-3 h-3" /> SEND TO STRATEGIST
          </button>
        )}
      </div>
    </>
  );
});

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
      style={{
        color: active ? GOLD : "#71717a",
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
    connecting: { color: "#FFB800", bg: "rgba(255,184,0,0.1)", label: "CONNECTING" },
    live: { color: UP, bg: "rgba(38,166,154,0.12)", label: "LIVE" },
    error: { color: DOWN, bg: "rgba(242,54,69,0.12)", label: "ERROR" },
    disabled: { color: NEUT, bg: "rgba(156,163,175,0.08)", label: "IDLE" },
  }[status];
  return (
    <span
      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex items-center gap-1"
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
    <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-card-border/50">
      <div className="space-y-1.5">
        <Row label="Unusual Strikes" value={
          <>
            <span style={{ color: UP }}>{candidate.unusualCallStrikes}C</span>
            <span className="text-zinc-600 mx-1">/</span>
            <span style={{ color: DOWN }}>{candidate.unusualPutStrikes}P</span>
          </>
        } />
        <Row label="Unusual Volume" value={(candidate.unusualCallVolume + candidate.unusualPutVolume).toLocaleString()} />
        <Row label="P/C Volume Ratio" value={candidate.putCallVolumeRatio.toFixed(2)} />
        <Row label="Total Call/Put Vol" value={
          <>
            {candidate.totalCallVolume.toLocaleString()}
            <span className="text-zinc-600 mx-1">/</span>
            {candidate.totalPutVolume.toLocaleString()}
          </>
        } />
      </div>
      <div className="space-y-1.5">
        <Row label="Top VOI" value={<span style={{ color: CYAN }}>{candidate.topVoiRatio.toFixed(1)}×</span>} />
        <Row label="As Of" value={<span className="text-zinc-400">{candidate.asOfDate}</span>} />
        {candidate.exec && (
          <Row label="Live Exec" value={
            <>
              <span style={{ color: GOLD }}>{candidate.exec.sweepCount}sw</span>
              <span className="text-zinc-700 mx-1">/</span>
              <span style={{ color: CYAN }}>{candidate.exec.blockCount}bk</span>
              <span className="text-zinc-700 mx-1">/</span>
              <span className="text-zinc-500">{candidate.exec.regularCount}rg</span>
            </>
          } />
        )}
        <Row label="Aggressor (live)" value={
          counters.total === 0 ? (
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ color: NEUT, background: "rgba(156,163,175,0.08)", border: "1px solid rgba(156,163,175,0.2)" }}
            >
              {streamStatus === "live" ? "Awaiting trades…" : streamStatus === "error" ? "Stream error" : "—"}
            </span>
          ) : (
            <>
              <span style={{ color: UP }}>{counters.buy}B</span>
              <span className="text-zinc-700 mx-1">/</span>
              <span style={{ color: DOWN }}>{counters.sell}S</span>
              <span className="text-zinc-700 mx-1">/</span>
              <span className="text-zinc-500">{counters.neutral}N</span>
            </>
          )
        } />
      </div>

      {counters.total > 0 && (
        <div className="col-span-2 pt-1">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-zinc-600 mb-1">
            <span>Aggressor Split (live tape · {counters.total} prints)</span>
            <span>
              <span style={{ color: UP }}>{fmtMoney(counters.buyNotional)}</span>
              <span className="text-zinc-700 mx-1">vs</span>
              <span style={{ color: DOWN }}>{fmtMoney(counters.sellNotional)}</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden flex" style={{ background: "#1a1a1c" }}>
            <div style={{ width: `${buyPct}%`, background: UP }} />
            <div style={{ width: `${100 - buyPct - sellPct}%`, background: NEUT }} />
            <div style={{ width: `${sellPct}%`, background: DOWN }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="text-sm font-mono tabular-nums text-zinc-300">{value}</span>
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
    <div className="px-3 py-2.5 border-t border-card-border/50">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
        Top Strikes by VOI · tap a row to view live tape
      </div>
      <div className="space-y-1">
        {strikes.length === 0 && (
          <div className="text-[11px] text-zinc-600 font-mono py-2 text-center">No strike detail available</div>
        )}
        {strikes.map((s, i) => {
          const occ = strikeContract(candidate, s);
          const isSelected = i === selectedIdx;
          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded text-[11px] font-mono tabular-nums transition-colors"
              style={{
                background: isSelected ? "rgba(255,184,0,0.08)" : "transparent",
                border: `1px solid ${isSelected ? "rgba(255,184,0,0.3)" : "transparent"}`,
              }}
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold w-5 text-center" style={{ color: s.optionType === "call" ? UP : DOWN }}>
                  {s.optionType === "call" ? "C" : "P"}
                </span>
                <span className="text-zinc-300">${s.strike}</span>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-500">{s.expiration}</span>
                <span className="text-zinc-700">({s.dte}d)</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-zinc-400">{s.volume.toLocaleString()} vol</span>
                <span className="text-zinc-600">/</span>
                <span className="text-zinc-500">{s.openInterest.toLocaleString()} OI</span>
                <span className="font-bold w-12 text-right" style={{ color: CYAN }}>
                  {s.volOiRatio.toFixed(1)}×
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {strikes[selectedIdx] && (
        <div className="mt-2 px-2 py-1 text-[9px] font-mono text-zinc-600 truncate">
          contract: {strikeContract(candidate, strikes[selectedIdx])}
        </div>
      )}
    </div>
  );
}

// ── Time & Sales tab ─────────────────────────────────────────────────
function TimeSalesTab({
  candidate, strikes, selectedIdx, onSelectStrike, sizeFilter, onChangeFilter,
  trades, totalCount, status, error, contract,
}: {
  candidate: FlowDrillDownCandidate;
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
      <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-card-border/50" style={{ background: "#0a0a0a" }}>
        {strikes.length > 1 && (
          <select
            value={selectedIdx}
            onChange={(e) => onSelectStrike(parseInt(e.target.value, 10))}
            className="text-[11px] font-mono bg-[#1a1a1c] text-zinc-200 px-2 py-1 rounded border border-zinc-800"
          >
            {strikes.map((s, i) => (
              <option key={i} value={i}>
                {s.optionType === "call" ? "C" : "P"} ${s.strike} · {s.expiration}
              </option>
            ))}
          </select>
        )}
        {strikes.length === 1 && selected && (
          <span className="text-[11px] font-mono text-zinc-300">
            <span style={{ color: selected.optionType === "call" ? UP : DOWN }}>
              {selected.optionType === "call" ? "C" : "P"}
            </span>{" "}
            ${selected.strike} · {selected.expiration}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {(["all", "100", "500", "1000"] as SizeFilter[]).map(f => (
            <button
              key={f}
              onClick={() => onChangeFilter(f)}
              className="text-[10px] font-mono font-bold px-2 py-0.5 rounded transition-colors"
              style={{
                background: sizeFilter === f ? "rgba(255,184,0,0.15)" : "#1a1a1c",
                color: sizeFilter === f ? GOLD : "#71717a",
                border: `1px solid ${sizeFilter === f ? "rgba(255,184,0,0.3)" : "transparent"}`,
              }}
            >
              {f === "all" ? "ALL" : `≥${f}`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 text-[10px] font-mono" style={{ color: DOWN, background: "rgba(242,54,69,0.06)" }}>
          {error}
        </div>
      )}

      {/* Trade rows */}
      <div className="max-h-[280px] overflow-y-auto">
        {trades.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] font-mono text-zinc-600">
            {status === "live"
              ? "Awaiting prints… (illiquid contract or after-hours)"
              : status === "connecting"
              ? "Connecting to live tape…"
              : status === "error"
              ? "Stream disconnected"
              : "No data"}
          </div>
        )}
        {trades.length > 0 && (
          <table className="w-full text-[10px] font-mono tabular-nums">
            <thead className="sticky top-0" style={{ background: "#0a0a0a" }}>
              <tr className="text-zinc-600 uppercase tracking-wider text-[9px]">
                <th className="text-left px-2 py-1 font-normal">Time</th>
                <th className="text-right px-2 py-1 font-normal">Size</th>
                <th className="text-right px-2 py-1 font-normal">Price</th>
                <th className="text-center px-2 py-1 font-normal">Side</th>
                <th className="text-right px-2 py-1 font-normal">NBBO</th>
                <th className="text-center px-2 py-1 font-normal">Tag</th>
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

      <div className="px-3 py-1.5 flex items-center justify-between text-[9px] font-mono text-zinc-600 border-t border-card-border/50">
        <span>contract: {contract || "—"}</span>
        <span>
          showing {trades.length} of {totalCount} {sizeFilter !== "all" ? `(filter ≥${sizeFilter})` : ""}
        </span>
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: FlowTrade }) {
  const sideColor = trade.aggressor === "buy" ? UP : trade.aggressor === "sell" ? DOWN : NEUT;
  const sideLabel = trade.aggressor === "buy" ? "BUY" : trade.aggressor === "sell" ? "SELL" : "—";
  return (
    <tr className="border-t border-card-border/30 hover:bg-white/[0.02]">
      <td className="px-2 py-0.5 text-zinc-500">{fmtTime(trade.ts)}</td>
      <td className="px-2 py-0.5 text-right text-zinc-300">{trade.size}</td>
      <td className="px-2 py-0.5 text-right text-zinc-200">{fmtPrice(trade.price)}</td>
      <td className="px-2 py-0.5 text-center font-bold" style={{ color: sideColor }}>{sideLabel}</td>
      <td className="px-2 py-0.5 text-right text-zinc-600">
        {trade.nbbo ? `${fmtPrice(trade.nbbo.bid)}×${fmtPrice(trade.nbbo.ask)}` : "—"}
      </td>
      <td className="px-2 py-0.5 text-center">
        {trade.isSweep && <span className="text-[8px] font-bold px-1 rounded mr-0.5" style={{ background: "rgba(255,184,0,0.15)", color: GOLD }}>SW</span>}
        {trade.isBlock && <span className="text-[8px] font-bold px-1 rounded" style={{ background: "rgba(102,224,255,0.15)", color: CYAN }}>BK</span>}
      </td>
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
  lines.push(`Unusual strikes: ${c.unusualStrikeCount} (${c.unusualCallStrikes}C / ${c.unusualPutStrikes}P)`);
  lines.push(`Unusual volume: ${(c.unusualCallVolume + c.unusualPutVolume).toLocaleString()} contracts · notional ${fmtMoney(c.unusualTotalNotional)}`);
  lines.push(`Total call/put volume: ${c.totalCallVolume.toLocaleString()} / ${c.totalPutVolume.toLocaleString()} (P/C ${c.putCallVolumeRatio.toFixed(2)})`);
  lines.push(`Top VOI ratio: ${c.topVoiRatio.toFixed(1)}× · Avg DTE: ${c.avgDte}d · As of ${c.asOfDate}`);

  if (c.exec) {
    lines.push(`Detected execution mix: ${c.exec.sweepCount} sweeps (${fmtMoney(c.exec.sweepNotional)}), ${c.exec.blockCount} blocks (${fmtMoney(c.exec.blockNotional)}), ${c.exec.regularCount} regular`);
  }

  if (c.topByVoiRatio.length > 0) {
    lines.push(``);
    lines.push(`Top strikes by VOI:`);
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
      lines.push(`  - ${fmtTime(t.ts)} · ${t.size}@${fmtPrice(t.price)} · ${side}${tag ? ` [${tag}]` : ""}${t.nbbo ? ` (NBBO ${fmtPrice(t.nbbo.bid)}×${fmtPrice(t.nbbo.ask)})` : ""}`);
    }
  }

  return lines.join("\n");
}
