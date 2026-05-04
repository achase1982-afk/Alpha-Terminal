import { memo, useMemo } from "react";
import { ChevronDown, Send } from "lucide-react";
import { useQuote } from "@/hooks/useQuote";
import {
  buildScannerContextFromUnified,
  type ScannerSurfacedByEngine,
  type ScannerFlowSignaturePayload,
} from "@/lib/scannerStrategistHandoff";
import { setPendingScannerStrategistContext } from "@/lib/pendingScannerStrategistContext";
import type { UnifiedScanCandidate, UnifiedEngineKey } from "@/lib/unifiedScanTypes";

const SECTOR_TICKER_COLOR: Record<string, string> = {
  Technology: "#42a5f5",
  Financials: "#FFB800",
  Healthcare: "#ab47bc",
  Energy: "#26a69a",
  "Consumer Discretionary": "#f23645",
  "Consumer Staples": "#66e0ff",
  "Communication Services": "#9ca3af",
  Industrials: "#e5e7eb",
  Materials: "#d4a574",
  Utilities: "#5eead4",
  "Real Estate": "#fb7185",
  Other: "#9ca3af",
};

function engineLabel(e: UnifiedEngineKey): string {
  if (e === "unusual_flow") return "Unusual Flow";
  return e.charAt(0).toUpperCase() + e.slice(1);
}

function mapSurfacedForHandoff(by: UnifiedEngineKey[]): ScannerSurfacedByEngine[] {
  return by.map((x) => (x === "unusual_flow" ? "flow" : x)) as ScannerSurfacedByEngine[];
}

function formatNotional(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatExpiry(iso: string): string {
  try {
    const d = new Date(iso + (iso.includes("T") ? "" : "T12:00:00"));
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  } catch {
    return iso;
  }
}

function tapePillClass(q: UnifiedScanCandidate["flowSnapshot"]["tapeQuality"]): { label: string; cls: string } {
  switch (q) {
    case "complete":
      return { label: "complete", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" };
    case "partial":
      return { label: "partial", cls: "bg-amber-500/15 text-amber-400 border-amber-500/40" };
    case "degraded":
      return { label: "degraded", cls: "bg-red-500/15 text-red-400 border-red-500/40" };
    default:
      return { label: "not_run", cls: "bg-zinc-600/20 text-zinc-500 border-zinc-600/40" };
  }
}

function riskLabel(flag: string): string {
  return flag.replace(/_/g, " ");
}

const BAR_KEYS = [
  { key: "trend" as const, label: "Trend", max: 100 },
  { key: "relativeStrength" as const, label: "Relative Strength", max: 100 },
  { key: "volRegime" as const, label: "Vol Regime", max: 100 },
  { key: "flowScore" as const, label: "Flow Score", max: 100 },
  { key: "liquidity" as const, label: "Liquidity", max: 100 },
];

export const UnifiedScannerCard = memo(function UnifiedScannerCard({
  candidate: raw,
  rank,
  universeId,
  universeLabel,
  expanded,
  onToggle,
  onSendToStrategist,
}: {
  candidate: UnifiedScanCandidate;
  rank: number;
  universeId: string;
  universeLabel: string;
  expanded: boolean;
  onToggle: () => void;
  onSendToStrategist?: (sym: string) => void;
}) {
  const candidate = useMemo((): UnifiedScanCandidate => {
    const flow = raw.flowSnapshot ?? {
      topStrike: null,
      volumeMix: { askPct: 0, bidPct: 0, midPct: 0 },
      tapeQuality: "not_run" as const,
      notional24h: null,
    };
    const cat = raw.catalystWindow ?? { nextEarnings: null, macroEventsInPositionWindow: [] };
    const comp = raw.components ?? { trend: 0, relativeStrength: 0, volRegime: 0, flowScore: 0, liquidity: 0 };
    const pos = raw.positionContext ?? { hasPosition: false };
    return {
      ...raw,
      sector: raw.sector ?? "Other",
      surfacedBy: Array.isArray(raw.surfacedBy) ? raw.surfacedBy : [],
      surfacingReasons: Array.isArray(raw.surfacingReasons) ? raw.surfacingReasons : [],
      riskFlags: Array.isArray(raw.riskFlags) ? raw.riskFlags : [],
      flowSnapshot: {
        ...flow,
        volumeMix: flow.volumeMix ?? { askPct: 0, bidPct: 0, midPct: 0 },
      },
      catalystWindow: {
        nextEarnings: cat.nextEarnings ?? null,
        macroEventsInPositionWindow: Array.isArray(cat.macroEventsInPositionWindow) ? cat.macroEventsInPositionWindow : [],
      },
      components: comp,
      positionContext: pos,
    };
  }, [raw]);
  const { data } = useQuote(candidate.ticker);
  const liveSpot = data?.last ?? candidate.spot;
  const liveChg = data?.changePct ?? candidate.changePct;
  const isUp = liveChg >= 0;
  const sectorColor = SECTOR_TICKER_COLOR[candidate.sector] ?? SECTOR_TICKER_COLOR.Other!;

  const ivrLine = useMemo(() => {
    if (candidate.ivr == null || candidate.ivrSource === "missing") return "IVR —";
    const src = candidate.ivrSource === "canonical" ? "canonical" : "intraday";
    return `IVR ${candidate.ivr.toFixed(0)} • ${src}`;
  }, [candidate.ivr, candidate.ivrSource]);

  const flowSig: ScannerFlowSignaturePayload | null = useMemo(() => {
    const ts = candidate.flowSnapshot.topStrike;
    const topStrike =
      ts
        ? {
            strike: ts.strike,
            expiry: ts.expiry,
            notional: candidate.flowSnapshot.notional24h != null ? Math.round(candidate.flowSnapshot.notional24h) : 0,
            askPct: candidate.flowSnapshot.volumeMix.askPct,
            bidPct: candidate.flowSnapshot.volumeMix.bidPct,
          }
        : undefined;
    return {
      score: candidate.surfacedBy.includes("unusual_flow") ? Math.round(candidate.components.flowScore) : null,
      topStrike: topStrike ?? null,
      putCallRatio: null,
      tapeStatus: candidate.flowSnapshot.tapeQuality,
    };
  }, [candidate]);

  const handleStrategist = () => {
    const surfacedBy = mapSurfacedForHandoff(candidate.surfacedBy);
    const unusualFlow = candidate.surfacedBy.includes("unusual_flow") || candidate.components.flowScore > 0;
    setPendingScannerStrategistContext(
      buildScannerContextFromUnified({
        scannerScore: candidate.compositeScore,
        edgeType: candidate.edgeType,
        directionalLean: candidate.directionalLean,
        componentBreakdown: {
          trend: candidate.components.trend,
          rs: candidate.components.relativeStrength,
          volume: candidate.components.volRegime,
          ivr: Math.min(100, Math.max(0, candidate.ivr ?? 0)),
          liquidity: candidate.components.liquidity,
        },
        surfacedBy,
        unusualFlow,
        catalystBonusApplied: false,
        flowSignature: flowSig,
        scannerUniverse: universeId,
      }),
    );
    onSendToStrategist?.(candidate.ticker);
  };

  const chip = (engine: UnifiedEngineKey) => {
    const on = candidate.surfacedBy.includes(engine);
    const letter = engine === "discovery" ? "D" : engine === "momentum" ? "M" : "F";
    const title = engine === "unusual_flow" ? "Unusual Flow" : engine.charAt(0).toUpperCase() + engine.slice(1);
    return (
      <span
        key={engine}
        title={title}
        className="w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center shrink-0 border"
        style={{
          opacity: on ? 1 : 0.25,
          background: on ? (engine === "discovery" ? "#FFB80022" : engine === "momentum" ? "#42a5f522" : "#66e0ff22") : "transparent",
          borderColor: on ? (engine === "discovery" ? "#FFB80066" : engine === "momentum" ? "#42a5f566" : "#66e0ff66") : "#3f3f46",
          color: on ? (engine === "discovery" ? "#FFB800" : engine === "momentum" ? "#42a5f5" : "#66e0ff") : "#52525b",
        }}
      >
        {letter}
      </span>
    );
  };

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden hover:border-zinc-600 transition-colors">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer active:bg-white/[0.02] transition-colors"
        style={{ background: "#0c0c0c" }}
      >
        <span className="text-[11px] font-bold tabular-nums w-5 text-zinc-600 shrink-0">#{rank}</span>
        <span className="font-bold text-[13px] tracking-wider shrink-0" style={{ color: sectorColor }}>
          {candidate.ticker}
        </span>
        <span className="text-[9px] text-zinc-500 truncate max-w-[72px] shrink-0">{candidate.sector}</span>
        <div className="flex items-center gap-0.5 shrink-0">
          {(["discovery", "momentum", "unusual_flow"] as const).map(chip)}
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <span className="text-[11px] font-mono tabular-nums text-zinc-400">${liveSpot.toFixed(2)}</span>
          <span className="text-[11px] font-mono tabular-nums" style={{ color: isUp ? "#26a69a" : "#f23645" }}>
            {isUp ? "+" : ""}
            {liveChg.toFixed(2)}%
          </span>
          <span className="text-[10px] font-mono text-zinc-500 hidden sm:inline max-w-[120px] truncate">{ivrLine}</span>
          <span className="text-lg font-bold font-mono tabular-nums text-[#FFB800]">{candidate.compositeScore}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 transition-transform shrink-0" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-card-border/50 px-3 py-3 space-y-4 bg-[#0a0a0a]">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Why it cleared</div>
            <ul className="text-[11px] text-zinc-300 space-y-1 list-disc pl-4">
              {candidate.surfacingReasons.map((block, i) => (
                <li key={i}>
                  <span className="font-semibold text-zinc-200">{engineLabel(block.engine)}:</span>{" "}
                  {block.reasons.join(", ")}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Headline numbers</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              <div className="rounded border border-zinc-800 p-2">
                <div className="text-zinc-500 text-[9px] uppercase">Spot / Chg</div>
                <div className="font-mono text-zinc-200">
                  ${liveSpot.toFixed(2)}{" "}
                  <span style={{ color: isUp ? "#26a69a" : "#f23645" }}>
                    ({isUp ? "+" : ""}
                    {liveChg.toFixed(2)}%)
                  </span>
                </div>
              </div>
              <div className="rounded border border-zinc-800 p-2">
                <div className="text-zinc-500 text-[9px] uppercase">IVR</div>
                <div className="font-mono text-zinc-200">{ivrLine}</div>
              </div>
              <div className="rounded border border-zinc-800 p-2">
                <div className="text-zinc-500 text-[9px] uppercase">HV20 / HV30</div>
                <div className="font-mono text-zinc-200">
                  {candidate.hv20 != null ? candidate.hv20.toFixed(1) : "—"} / {candidate.hv30 != null ? candidate.hv30.toFixed(1) : "—"}
                </div>
              </div>
              <div className="rounded border border-zinc-800 p-2 col-span-2 sm:col-span-1">
                <div className="text-zinc-500 text-[9px] uppercase">52w range</div>
                <div className="font-mono text-zinc-200 text-[10px]">
                  {candidate.low52w != null && candidate.high52w != null
                    ? `$${candidate.low52w.toFixed(0)} – $${candidate.high52w.toFixed(0)}`
                    : "—"}
                </div>
              </div>
              <div className="rounded border border-zinc-800 p-2">
                <div className="text-zinc-500 text-[9px] uppercase">Avg vol 20d</div>
                <div className="font-mono text-zinc-200">
                  {candidate.avgVolume20d != null ? candidate.avgVolume20d.toLocaleString() : "—"}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Components</div>
            <div className="space-y-2">
              {BAR_KEYS.map((bar) => {
                const val = candidate.components[bar.key];
                const pct = Math.min(100, Math.round((val / bar.max) * 100));
                return (
                  <div key={bar.key} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-zinc-500 w-[100px] text-right shrink-0">{bar.label}</span>
                    <div className="flex-1 h-[6px] rounded-full overflow-hidden bg-zinc-900">
                      <div className="h-full rounded-full bg-[#FFB800]/80 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-zinc-400 w-14 text-right shrink-0">
                      {Math.round(val)}/{bar.max}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Flow snapshot</div>
            {candidate.flowSnapshot.tapeQuality === "not_run" && !candidate.flowSnapshot.topStrike ? (
              <p className="text-[11px] text-zinc-500">No notable flow snapshot for this session.</p>
            ) : (
              <div className="space-y-2 text-[11px] text-zinc-300">
                {candidate.flowSnapshot.topStrike ? (
                  <div>
                    Top strike:{" "}
                    <span className="font-mono text-zinc-100">
                      {candidate.flowSnapshot.topStrike.type.toUpperCase()} {candidate.flowSnapshot.topStrike.strike} exp{" "}
                      {formatExpiry(candidate.flowSnapshot.topStrike.expiry)}
                    </span>
                  </div>
                ) : (
                  <div className="text-zinc-500">Top strike: —</div>
                )}
                <div>
                  <div className="text-[9px] text-zinc-500 uppercase mb-1">Volume mix (ask / bid / mid)</div>
                  <div className="h-2 rounded-full overflow-hidden flex bg-zinc-800">
                    <div className="h-full bg-emerald-500/80" style={{ width: `${candidate.flowSnapshot.volumeMix.askPct}%` }} />
                    <div className="h-full bg-red-500/70" style={{ width: `${candidate.flowSnapshot.volumeMix.bidPct}%` }} />
                    <div className="h-full bg-zinc-500/80" style={{ width: `${candidate.flowSnapshot.volumeMix.midPct}%` }} />
                  </div>
                  <div className="text-[9px] text-zinc-500 mt-0.5 font-mono">
                    {candidate.flowSnapshot.volumeMix.askPct.toFixed(0)}% ask · {candidate.flowSnapshot.volumeMix.bidPct.toFixed(0)}% bid ·{" "}
                    {candidate.flowSnapshot.volumeMix.midPct.toFixed(0)}% mid
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${tapePillClass(candidate.flowSnapshot.tapeQuality).cls}`}>
                    Tape: {tapePillClass(candidate.flowSnapshot.tapeQuality).label}
                  </span>
                  <span className="text-zinc-400">Notional 24h: {formatNotional(candidate.flowSnapshot.notional24h)}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Catalyst window</div>
            <div className="text-[11px] text-zinc-300 space-y-2">
              {candidate.catalystWindow.nextEarnings ? (
                <div>
                  Next earnings:{" "}
                  <span className="font-mono text-zinc-100">
                    {candidate.catalystWindow.nextEarnings.date} ({candidate.catalystWindow.nextEarnings.daysAway} days)
                  </span>{" "}
                  <span className="text-[10px] text-zinc-500">
                    {candidate.catalystWindow.nextEarnings.confirmed ? "· confirmed" : "· unconfirmed"}
                  </span>
                </div>
              ) : (
                <div className="text-zinc-500">No earnings in window.</div>
              )}
              {candidate.catalystWindow.macroEventsInPositionWindow.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {candidate.catalystWindow.macroEventsInPositionWindow.map((ev, i) => (
                    <span key={i} className="text-[9px] px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-200">
                      {ev.title} {ev.date}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {candidate.riskFlags.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Risk flags</div>
              <div className="flex flex-wrap gap-1">
                {candidate.riskFlags.map((f) => (
                  <span key={f} className="text-[9px] px-2 py-0.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-300">
                    {riskLabel(f)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Position</div>
            <p className={`text-[11px] font-semibold ${candidate.positionContext.hasPosition ? "text-emerald-400" : "text-zinc-500"}`}>
              {candidate.positionContext.hasPosition ? "You hold this name" : "No position"}
            </p>
          </div>

          <div className="text-[9px] text-zinc-600 border-t border-zinc-800 pt-2">
            Universe: {universeLabel} <span className="text-zinc-500 font-mono">({universeId})</span>
          </div>

          {onSendToStrategist && (
            <button
              type="button"
              onClick={handleStrategist}
              className="w-full flex items-center justify-center gap-2 text-[12px] font-bold py-2.5 rounded-lg transition-all active:scale-[0.99] bg-[#FFB800] text-black hover:brightness-110"
            >
              <Send className="w-4 h-4" />
              Send to Strategist
            </button>
          )}
        </div>
      )}
    </div>
  );
});
