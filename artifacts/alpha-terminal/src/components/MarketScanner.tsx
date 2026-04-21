import { useState, useEffect, memo, useRef, useCallback, useMemo } from "react";
import ReactDOM from "react-dom";
import { useTerminalStore } from "@/lib/store";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { SlidersHorizontal, ChevronDown, AlertTriangle, Search, List, Crosshair, Send, Shield, BarChart3, Plus, Filter, RefreshCw, Pencil, Trash2, Loader2, Info, Zap, Settings2 } from "lucide-react";
import { Drawer, DrawerContent, DrawerTrigger, DrawerTitle, DrawerHeader, DrawerClose } from "./ui/drawer";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useScanCache } from "@/hooks/useScanCache";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { useScannerUniverses } from "@/hooks/useScannerUniverses";
import { ScreenBuilder } from "./ScreenBuilder";
import { WatchlistEditor } from "./WatchlistEditor";

const API_BASE = "/api";


interface ScannerQuote {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  volume: number;
  high: number;
  low: number;
}

interface DetComponentScores {
  trendAlignment: number;
  relativeStrength: number;
  volumeConfirmation: number;
  ivrScore: number;
  optionsLiquidity: number;
}

export interface DetCandidate {
  symbol: string;
  totalScore: number;
  components: DetComponentScores;
  price: number;
  changePct: number;
  sector: string;
  keyStatLabel: string;
  keyStatValue: string;
  ivr: number;
  atmIV: number;
  atmSpreadPct: number;
  hasWeeklyOptions: boolean;
  upcomingEvents: Array<{ date: string; title: string; importance: string }>;
  microOverrideEligible: boolean;
  pulseComposite: number;
  pulseConfidence: number;
  pulseBias: string;
  scanTimestamp?: number;
  directionalLean?: "BULLISH" | "BEARISH" | "MIXED";
  scanMode?: "DISCOVERY" | "MOMENTUM";
  flowDataAvailable?: boolean;
  discoveryComponents?: {
    setupQuality: number;
    accumulation: number;
    ivSetup: number;
    flowDivergence: number;
    liveFlow?: number;
    liveFlowAvailable?: boolean;
    emergingRS: number;
  };
  unusualFlow?: {
    asOfDate: string;
    unusualStrikeCount: number;
    skew: "bullish" | "bearish" | "balanced" | "none";
    bonusPoints: number;
    largestPrintVolume: number;
    largestPrintDescription: string | null;
    putCallVolumeRatio: number;
  };
}

// Part 5: legacy types for the on-demand "Unusual Flow Scan (LIVE)" button
// were removed. Live unusual-flow signal is now folded into the LIVE_FLOW
// scoring bucket on every Discovery scan (see deterministicScanner.v2.ts).

interface DetScanResult {
  candidates: DetCandidate[];
  filterSummary: {
    totalScanned: number;
    passedFilters: number;
    scoredAboveThreshold: number;
  };
  scanTimestamp: number;
  pulseBias: string;
  scanMode?: "DISCOVERY" | "MOMENTUM";
  // Part 2 — server-computed coverage state for the LIVE/AMBER/EOD badge.
  coverage?: {
    state: "LIVE" | "AMBER" | "EOD";
    reason: string;
    watcherEnabled: boolean;
    running: boolean;
    heartbeatAgeMs: number | null;
    coverageRate: number;
    totalSubscribed: number;
  };
}

const MOMENTUM_BARS: { key: keyof DetComponentScores; label: string; max: number; color: string }[] = [
  { key: "trendAlignment", label: "TREND", max: 25, color: "#26a69a" },
  { key: "relativeStrength", label: "RS", max: 20, color: "#42a5f5" },
  { key: "volumeConfirmation", label: "VOL", max: 20, color: "#ab47bc" },
  { key: "ivrScore", label: "IVR", max: 20, color: "#ffb800" },
  { key: "optionsLiquidity", label: "OPT LIQ", max: 15, color: "#ef5350" },
];

const DISCOVERY_BARS: { key: keyof NonNullable<DetCandidate["discoveryComponents"]>; label: string; max: number; color: string }[] = [
  { key: "setupQuality", label: "SETUP", max: 20, color: "#26a69a" },
  { key: "accumulation", label: "ACCUM", max: 15, color: "#ab47bc" },
  { key: "ivSetup", label: "IV SET", max: 25, color: "#ffb800" },
  { key: "flowDivergence", label: "FLOW", max: 25, color: "#42a5f5" },
  { key: "liveFlow", label: "LIVE FL", max: 20, color: "#66e0ff" },
  { key: "emergingRS", label: "RS", max: 15, color: "#ef5350" },
];

const LEAN_COLORS: Record<string, string> = {
  BULLISH: "#2ecc71",
  BEARISH: "#ff4b5c",
  MIXED: "#FFB800",
};

function checkEdgeAvailability(candidate: DetCandidate): { hasEdge: boolean; reason: string } {
  const absComp = Math.abs(candidate.pulseComposite);
  const conf = candidate.pulseConfidence;

  if (absComp >= 0.75 && conf >= 60) return { hasEdge: true, reason: "HIGH_CONVICTION" };
  if (absComp >= 0.30 && absComp < 0.75 && conf >= 30 && conf < 60) return { hasEdge: true, reason: "LOW_CONVICTION" };
  if (absComp >= 0.30 && conf >= 60) return { hasEdge: true, reason: "LOW_CONVICTION" };

  if (candidate.microOverrideEligible) {
    const pulseBullish = candidate.pulseComposite > 0.30;
    const pulseBearish = candidate.pulseComposite < -0.30;
    const scanBullish = candidate.changePct > 0;
    if ((pulseBullish && !scanBullish) || (pulseBearish && scanBullish)) {
      return { hasEdge: false, reason: "Inverse to macro bias" };
    }
    return { hasEdge: true, reason: "MICRO_OVERRIDE" };
  }

  return { hasEdge: false, reason: "Pulse too weak for directional" };
}

const DeterministicCard = memo(function DeterministicCard({
  candidate, rank, onSelect, onSendToStrategist,
}: {
  candidate: DetCandidate; rank: number;
  onSelect: (sym: string) => void;
  onSendToStrategist?: (sym: string, candidate?: DetCandidate) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lastScanTs = useRef(candidate.scanTimestamp);
  if (candidate.scanTimestamp !== lastScanTs.current) {
    lastScanTs.current = candidate.scanTimestamp;
    if (expanded) setExpanded(false);
  }
  const { data } = useQuote(candidate.symbol);
  const livePrice = data?.last ?? candidate.price;
  const liveChangePct = data?.changePct ?? candidate.changePct;
  const isUp = liveChangePct >= 0;
  const isDiscovery = candidate.scanMode === "DISCOVERY";
  const lean = candidate.directionalLean;
  const edgeCheck = useMemo(() => checkEdgeAvailability(candidate), [candidate]);

  const scoreColor = candidate.totalScore >= 80 ? "#26a69a" : candidate.totalScore >= 60 ? "#FFB800" : "#6B7280";

  const scoreBars = isDiscovery && candidate.discoveryComponents
    ? DISCOVERY_BARS.map(bar => {
        // discoveryComponents now contains a non-numeric `liveFlowAvailable`
        // boolean alongside the numeric bucket scores. DISCOVERY_BARS only
        // references numeric keys, so coerce defensively to a number.
        const raw = candidate.discoveryComponents![bar.key as keyof NonNullable<DetCandidate["discoveryComponents"]>];
        const val = typeof raw === "number" ? raw : 0;
        return { label: bar.label, max: bar.max, color: bar.color, val };
      })
    : MOMENTUM_BARS.map(bar => ({
        label: bar.label,
        max: bar.max,
        color: bar.color,
        val: candidate.components[bar.key as keyof DetComponentScores] ?? 0,
      }));

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden hover:border-zinc-600 transition-colors">
      <div
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer active:bg-white/[0.02] transition-colors"
        style={{ background: "#0c0c0c" }}
      >
        <span className="text-[11px] font-bold tabular-nums w-5 text-zinc-600 shrink-0">#{rank}</span>
        <button onClick={(e) => { e.stopPropagation(); onSelect(candidate.symbol); }}
          className="font-bold text-[13px] tracking-wider hover:text-[#FFB800] transition-colors active:scale-95 shrink-0"
          style={{ color: isUp ? "#26a69a" : "#f23645" }}>
          {candidate.symbol}
        </button>
        <span className="text-[10px] text-zinc-500 shrink-0 max-w-[50px] truncate">{candidate.sector}</span>

        {candidate.microOverrideEligible && (
          <Shield className="w-3 h-3 shrink-0" style={{ color: "#FFB800" }} />
        )}
        {!edgeCheck.hasEdge && (
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-wider"
            style={{ color: "#6B7280", background: "#6B728018", border: "1px solid #6B728030" }}>
            no edge
          </span>
        )}
        {lean && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
            style={{ color: LEAN_COLORS[lean], background: `${LEAN_COLORS[lean]}18` }}>
            {lean}
          </span>
        )}
        {/* Part 5: per-row LIVE flow chip — surfaces the LIVE_FLOW bucket
            inline so the segmented Discovery list reads "X has unusual flow"
            without expanding the row. */}
        {isDiscovery && candidate.discoveryComponents?.liveFlowAvailable && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 uppercase tracking-wider"
            style={{ color: "#66e0ff", background: "#66e0ff18", border: "1px solid #66e0ff40" }}
            title={`LIVE_FLOW bucket: ${Math.round(candidate.discoveryComponents?.liveFlow ?? 0)}/20`}
          >
            ⚡ LIVE
          </span>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono tabular-nums text-zinc-400">${livePrice.toFixed(2)}</span>
          <span className="text-[11px] font-mono tabular-nums" style={{ color: isUp ? "#26a69a" : "#f23645" }}>
            {isUp ? "+" : ""}{liveChangePct.toFixed(2)}%
          </span>
          <span className="text-[11px] font-mono tabular-nums text-zinc-500">IVR {candidate.ivr.toFixed(0)}</span>
          <span className="text-lg font-bold font-mono tabular-nums" style={{ color: scoreColor }}>
            {candidate.totalScore}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
        </div>
      </div>

      {expanded && (
        <>
          <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-card-border/50">
            <div>
              <div className="text-[11px] text-zinc-500 uppercase mb-1.5">Score Breakdown</div>
              <div className="space-y-1.5">
                {scoreBars.map(bar => {
                  const pct = Math.round((bar.val / bar.max) * 100);
                  return (
                    <div key={bar.label} className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-zinc-500 w-[52px] text-right shrink-0">{bar.label}</span>
                      <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: "#1a1a1a" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bar.color }} />
                      </div>
                      <span className="text-[10px] font-mono tabular-nums text-zinc-400 w-8 text-right">{Math.round(bar.val)}/{bar.max}</span>
                    </div>
                  );
                })}
              </div>
              {isDiscovery && candidate.flowDataAvailable === false && (
                <div className="mt-2 flex items-center gap-1 text-[10px]" style={{ color: "#6B7280" }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  Flow data unavailable — score renormalized
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">ATM Spread</span>
                <span className="text-sm font-mono tabular-nums text-zinc-300">
                  {candidate.atmSpreadPct >= 99 ? "N/A" : `${candidate.atmSpreadPct.toFixed(1)}%`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">{candidate.keyStatLabel}</span>
                <span className="text-sm font-mono tabular-nums text-zinc-300">{candidate.keyStatValue}</span>
              </div>
              {candidate.hasWeeklyOptions && (
                <span className="text-[10px] text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5 inline-block">WEEKLYS</span>
              )}
              {candidate.unusualFlow && (
                <div className="space-y-1 mt-1">
                  <span
                    className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full w-fit"
                    style={{
                      color: candidate.unusualFlow.skew === "bullish" ? "#2ecc71"
                        : candidate.unusualFlow.skew === "bearish" ? "#ff4b5c"
                        : "#FFB800",
                      background: candidate.unusualFlow.skew === "bullish" ? "rgba(46,204,113,0.12)"
                        : candidate.unusualFlow.skew === "bearish" ? "rgba(255,75,92,0.12)"
                        : "rgba(255,184,0,0.12)",
                      border: `1px solid ${candidate.unusualFlow.skew === "bullish" ? "rgba(46,204,113,0.3)"
                        : candidate.unusualFlow.skew === "bearish" ? "rgba(255,75,92,0.3)"
                        : "rgba(255,184,0,0.3)"}`,
                    }}
                    title={candidate.unusualFlow.largestPrintDescription ?? undefined}
                  >
                    UNUSUAL FLOW · +{candidate.unusualFlow.bonusPoints} · {candidate.unusualFlow.unusualStrikeCount} strikes {candidate.unusualFlow.skew.toUpperCase()}
                  </span>
                  {candidate.unusualFlow.largestPrintDescription && (
                    <div className="text-[10px] text-zinc-500 truncate" title={candidate.unusualFlow.largestPrintDescription}>
                      Largest: {candidate.unusualFlow.largestPrintDescription}
                    </div>
                  )}
                </div>
              )}
              {candidate.microOverrideEligible && (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full w-fit"
                  style={{ color: "#FFB800", background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.3)" }}>
                  <Shield className="w-3 h-3" /> MICRO-OVERRIDE
                </span>
              )}
            </div>
          </div>

          {candidate.upcomingEvents.length > 0 && (
            <div className="px-4 pb-2">
              <div className="flex flex-wrap gap-1.5">
                {candidate.upcomingEvents.map((ev, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border"
                    style={{
                      color: ev.importance?.toUpperCase() === "HIGH" ? "#f23645" : "#FFB800",
                      borderColor: ev.importance?.toUpperCase() === "HIGH" ? "rgba(242,54,69,0.3)" : "rgba(255,184,0,0.2)",
                      background: ev.importance?.toUpperCase() === "HIGH" ? "rgba(242,54,69,0.08)" : "rgba(255,184,0,0.05)",
                    }}>
                    {ev.title} {ev.date}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-2.5 border-t border-card-border/50 flex items-center justify-between" style={{ background: "#0a0a0a" }}>
            <span className="text-[10px] text-zinc-600">
              Bias: {candidate.pulseBias} · Composite: {typeof candidate.pulseComposite === 'number' ? candidate.pulseComposite.toFixed(1) : candidate.pulseComposite}
            </span>
            {onSendToStrategist && (
              <button onClick={() => onSendToStrategist(candidate.symbol, candidate)}
                className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded transition-all hover:bg-[#FFB800]/15 active:scale-95"
                style={{ color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)" }}>
                <Send className="w-3 h-3" /> SEND TO STRATEGIST
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
});


// ── Unusual Options Activity scanner result types ───────────────────
interface UnusualFlowExecSummary {
  sweepCount: number;
  blockCount: number;
  regularCount: number;
  sweepNotional: number;
  blockNotional: number;
  regularNotional: number;
}
interface UnusualFlowStrike {
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
  exec?: UnusualFlowExecSummary;
}
interface UnusualFlowCandidate {
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
  topByVoiRatio: UnusualFlowStrike[];
  topByNotional: UnusualFlowStrike[];
  largestPrintDescription: string;
  topVoiRatio: number;
  avgDte: number;
  exec?: UnusualFlowExecSummary;
  aggressorAvailable?: boolean;
}
interface UnusualFlowScanResult {
  scanTimestamp: number;
  asOfDate: string | null;
  scannedSymbols: number;
  symbolsWithFlow: number;
  excludedIndexes: number;
  candidates: UnusualFlowCandidate[];
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

const UnusualFlowCard = memo(function UnusualFlowCard({
  candidate, rank, onSelect, onSendToStrategist,
}: {
  candidate: UnusualFlowCandidate;
  rank: number;
  onSelect: (sym: string) => void;
  onSendToStrategist?: (sym: string, candidate?: DetCandidate) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuote(candidate.symbol);
  const livePrice = data?.last;

  const skewColor =
    candidate.skew === "bullish" ? "#26a69a"
    : candidate.skew === "bearish" ? "#f23645"
    : "#9ca3af";
  const skewLabel = candidate.skew.toUpperCase();

  const scoreColor = candidate.score >= 70 ? "#66e0ff" : candidate.score >= 50 ? "#FFB800" : "#9ca3af";

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden hover:border-zinc-600 transition-colors">
      <div
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer active:bg-white/[0.02] transition-colors"
        style={{ background: "#0c0c0c" }}
      >
        <span className="text-[11px] font-bold tabular-nums w-5 text-zinc-600 shrink-0">#{rank}</span>
        <button onClick={(e) => { e.stopPropagation(); onSelect(candidate.symbol); }}
          className="font-bold text-[13px] tracking-wider hover:text-[#FFB800] transition-colors active:scale-95 shrink-0"
          style={{ color: scoreColor }}>
          {candidate.symbol}
        </button>

        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ color: skewColor, background: `${skewColor}1a`, border: `1px solid ${skewColor}40` }}
        >
          {skewLabel}
        </span>

        <span className="text-[10px] text-zinc-500 font-mono tabular-nums shrink-0">
          {candidate.unusualStrikeCount} strk
        </span>
        <span className="text-[10px] text-zinc-400 font-mono tabular-nums shrink-0">
          {fmtCompactInt(candidate.unusualTotalVolume)} ct
        </span>
        <span className="text-[10px] font-mono tabular-nums shrink-0" style={{ color: "#FFB800" }}>
          {fmtMoney(candidate.unusualTotalNotional)}
        </span>
        {candidate.exec && (candidate.exec.sweepCount + candidate.exec.blockCount) > 0 && (
          <span
            className="text-[10px] font-mono tabular-nums shrink-0 px-1.5 py-0.5 rounded"
            title={`Live: ${candidate.exec.sweepCount} sweeps · ${candidate.exec.blockCount} blocks · ${candidate.exec.regularCount} regular`}
            style={{
              color: "#FFB800",
              background: "rgba(255,184,0,0.08)",
              border: "1px solid rgba(255,184,0,0.25)",
            }}
          >
            {candidate.exec.sweepCount}s/{candidate.exec.blockCount}b
          </span>
        )}
        <span className="text-[10px] text-zinc-600 font-mono tabular-nums shrink-0 hidden sm:inline">
          {candidate.avgDte}d
        </span>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {livePrice != null && (
            <span className="text-[11px] font-mono tabular-nums text-zinc-400">${livePrice.toFixed(2)}</span>
          )}
          <span className="text-[11px] font-mono tabular-nums text-zinc-500">
            {candidate.topVoiRatio.toFixed(1)}×
          </span>
          <span className="text-[12px] font-bold font-mono tabular-nums" style={{ color: scoreColor }}>
            {candidate.score.toFixed(0)}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
        </div>
      </div>

      {expanded && (
        <>
          <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-card-border/50">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">Unusual Strikes</span>
                <span className="text-sm font-mono tabular-nums text-zinc-200">
                  <span style={{ color: "#26a69a" }}>{candidate.unusualCallStrikes}C</span>
                  <span className="text-zinc-600 mx-1">/</span>
                  <span style={{ color: "#f23645" }}>{candidate.unusualPutStrikes}P</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">Unusual Volume</span>
                <span className="text-sm font-mono tabular-nums text-zinc-300">
                  {(candidate.unusualCallVolume + candidate.unusualPutVolume).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">P/C Volume Ratio</span>
                <span className="text-sm font-mono tabular-nums text-zinc-300">
                  {candidate.putCallVolumeRatio.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">Top VOI</span>
                <span className="text-sm font-mono tabular-nums" style={{ color: "#66e0ff" }}>
                  {candidate.topVoiRatio.toFixed(1)}×
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">Total Call/Put Vol</span>
                <span className="text-sm font-mono tabular-nums text-zinc-300">
                  {candidate.totalCallVolume.toLocaleString()}
                  <span className="text-zinc-600 mx-1">/</span>
                  {candidate.totalPutVolume.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">As Of</span>
                <span className="text-sm font-mono tabular-nums text-zinc-400">{candidate.asOfDate}</span>
              </div>
              {candidate.exec && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-zinc-500">Live Exec</span>
                  <span className="text-[11px] font-mono tabular-nums">
                    <span style={{ color: "#FFB800" }}>{candidate.exec.sweepCount}sw</span>
                    <span className="text-zinc-700 mx-1">/</span>
                    <span style={{ color: "#66e0ff" }}>{candidate.exec.blockCount}bk</span>
                    <span className="text-zinc-700 mx-1">/</span>
                    <span className="text-zinc-500">{candidate.exec.regularCount}rg</span>
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[11px] text-zinc-500">Aggressor</span>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  title="Requires NBBO subscription — Phase 2"
                  style={{ color: "#9ca3af", background: "rgba(156,163,175,0.08)", border: "1px solid rgba(156,163,175,0.2)" }}
                >
                  N/A · Phase 2
                </span>
              </div>
            </div>
          </div>

          {candidate.topByVoiRatio.length > 0 && (
            <div className="px-4 py-2.5 border-t border-card-border/50">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
                Top Strikes by VOI
              </div>
              <div className="space-y-1">
                {candidate.topByVoiRatio.slice(0, 4).map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="text-[10px] font-bold w-5 text-center"
                        style={{ color: s.optionType === "call" ? "#26a69a" : "#f23645" }}
                      >
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
                      <span className="font-bold w-12 text-right" style={{ color: "#66e0ff" }}>
                        {s.volOiRatio.toFixed(1)}×
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-2.5 border-t border-card-border/50 flex items-center justify-between" style={{ background: "#0a0a0a" }}>
            <span className="text-[10px] text-zinc-600 font-mono">
              Score {candidate.score.toFixed(1)} · {candidate.scoreReason}
            </span>
            {onSendToStrategist && (
              <button onClick={() => onSendToStrategist(candidate.symbol)}
                className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded transition-all hover:bg-[#FFB800]/15 active:scale-95"
                style={{ color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)" }}>
                <Send className="w-3 h-3" /> SEND TO STRATEGIST
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
});

function UniverseDropdown({ value, onChange, presets, watchlists, screens, onCreateScreen, onEditScreen, onDeleteScreen, onRefreshScreen, refreshingScreenId, onCreateWatchlist, onEditWatchlist, onDeleteWatchlist }: {
  value: string;
  onChange: (v: string) => void;
  presets: Record<string, { label: string; description: string; count: number }>;
  watchlists: Array<{ id: number; name: string; symbols: string[]; isProtected?: boolean }>;
  screens: Array<{ id: number; name: string; cachedCount: number | null; cachedAt: string | null; isDefault: boolean }>;
  onCreateScreen: () => void;
  onEditScreen?: (id: number) => void;
  onDeleteScreen?: (id: number) => void;
  onRefreshScreen?: (id: number) => void;
  refreshingScreenId?: number | null;
  onCreateWatchlist?: () => void;
  onEditWatchlist?: (id: number) => void;
  onDeleteWatchlist?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent | TouchEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick as any);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick as any);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  let selectedLabel = value;
  let selectedCount: number | string = 0;
  if (value.startsWith("preset:")) {
    const p = presets[value.slice(7)];
    selectedLabel = p?.label ?? value;
    selectedCount = p?.count ?? 0;
  } else if (value.startsWith("watchlist:")) {
    const wl = watchlists.find(w => w.id === parseInt(value.slice(10)));
    selectedLabel = wl?.name ?? "Watchlist";
    selectedCount = wl?.symbols?.length ?? 0;
  } else if (value.startsWith("screen:")) {
    const sc = screens.find(s => s.id === parseInt(value.slice(7)));
    selectedLabel = sc?.name ?? "Screen";
    selectedCount = sc?.cachedCount ?? "—";
  }

  const maxH = typeof window !== "undefined" ? Math.min(560, window.innerHeight - pos.top - 16) : 400;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full min-h-[44px] rounded-md border border-card-border bg-card text-foreground text-sm px-3 py-2 flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors hover:border-zinc-600"
      >
        <span className="font-medium leading-snug">{selectedLabel} <span className="text-zinc-500 font-normal">({selectedCount})</span></span>
        <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && ReactDOM.createPortal(
        <div
          ref={panelRef}
          className="rounded-lg border border-zinc-700/80 bg-[#141414] shadow-2xl shadow-black/60 overflow-hidden"
          style={{ position: "fixed", zIndex: 9999, top: pos.top, left: pos.left, width: pos.width, maxHeight: maxH }}
        >
          <div
            className="overflow-y-auto overscroll-contain"
            style={{ maxHeight: maxH, WebkitOverflowScrolling: "touch" as any }}
            onTouchMove={e => e.stopPropagation()}
          >
            <div className="px-3 pt-3 pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Presets</span>
            </div>
            {Object.entries(presets).map(([key, p]) => {
              const pKey = `preset:${key}`;
              return (
                <button
                  key={key}
                  onClick={() => { onChange(pKey); setOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 text-sm transition-colors ${
                    value === pKey ? "bg-[#FFB800]/10 text-[#FFB800]" : "text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
                  }`}
                >
                  <span className="font-medium leading-snug">{p.label}</span>
                  <span className={`text-xs tabular-nums shrink-0 ${value === pKey ? "text-[#FFB800]/60" : "text-zinc-600"}`}>{p.count}</span>
                </button>
              );
            })}

            {screens.length > 0 && (
              <>
                <div className="mx-3 my-1.5 border-t border-zinc-700/50" />
                <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Dynamic Screens</span>
                </div>
                {screens.map(sc => {
                  const scKey = `screen:${sc.id}`;
                  const isActive = value === scKey;
                  return (
                    <div key={sc.id}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
                        isActive ? "bg-[#FFB800]/10 text-[#FFB800]" : "text-zinc-300 hover:bg-zinc-800/60"
                      }`}
                    >
                      <button onClick={() => { onChange(scKey); setOpen(false); }} className="flex-1 text-left">
                        <span className="font-medium leading-snug">{sc.name}</span>
                        {sc.cachedAt && (
                          <span className="text-[9px] text-zinc-600 ml-1.5">
                            {new Date(sc.cachedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </button>
                      <span className={`text-xs tabular-nums shrink-0 ${isActive ? "text-[#FFB800]/60" : "text-zinc-600"}`}>
                        {sc.cachedCount ?? "—"}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {onRefreshScreen && (
                          <button onClick={(e) => { e.stopPropagation(); onRefreshScreen(sc.id); }}
                            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                            title="Refresh screen">
                            {refreshingScreenId === sc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          </button>
                        )}
                        {onEditScreen && (
                          <button onClick={(e) => { e.stopPropagation(); onEditScreen(sc.id); setOpen(false); }}
                            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                            title="Edit screen">
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                        {onDeleteScreen && !sc.isDefault && (
                          <button onClick={(e) => { e.stopPropagation(); onDeleteScreen(sc.id); }}
                            className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                            title="Delete screen">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            <div className="mx-3 my-1.5 border-t border-zinc-700/50" />
            <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
              <List className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Custom Watchlists</span>
            </div>
            {watchlists.map(wl => {
              const wlKey = `watchlist:${wl.id}`;
              const isActive = value === wlKey;
              return (
                <div key={wl.id}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
                    isActive ? "bg-[#FFB800]/10 text-[#FFB800]" : "text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <button onClick={() => { onChange(wlKey); setOpen(false); }} className="flex-1 text-left">
                    <span className="font-medium leading-snug">{wl.name}</span>
                  </button>
                  <span className={`text-xs tabular-nums shrink-0 ${isActive ? "text-[#FFB800]/60" : "text-zinc-600"}`}>{wl.symbols.length}</span>
                  <div className="flex items-center gap-0.5">
                    {onEditWatchlist && (
                      <button onClick={(e) => { e.stopPropagation(); onEditWatchlist(wl.id); setOpen(false); }}
                        className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="Edit watchlist">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {onDeleteWatchlist && !wl.isProtected && (
                      <button onClick={(e) => { e.stopPropagation(); onDeleteWatchlist(wl.id); }}
                        className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                        title="Delete watchlist">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {onCreateWatchlist && (
              <button
                onClick={() => { onCreateWatchlist(); setOpen(false); }}
                className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span className="font-medium">New Watchlist</span>
              </button>
            )}

            <div className="mx-3 my-1.5 border-t border-zinc-700/50" />
            <button
              onClick={() => { onCreateScreen(); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 flex items-center gap-2 text-sm text-zinc-400 hover:text-[#FFB800] hover:bg-zinc-800/60 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="font-medium">Create Dynamic Screen</span>
            </button>

            <div className="h-2" />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

type SendToStrategistFn = (sym: string, candidate?: DetCandidate) => void;

export function MarketScanner({ subscribeEquitySymbols, onNavigateToSymbol, onSendToStrategist }: {
  subscribeEquitySymbols?: (symbols: string[]) => void;
  onNavigateToSymbol?: (sym: string) => void;
  onSendToStrategist?: SendToStrategistFn;
}) {
  const { accessToken, setSymbol } = useTerminalStore();
  const { pulseData } = useMarketPulseStore();
  const shockActive = pulseData?.shockState === "ACTIVE";
  const { cachedData: scanCache, setCachedData: setScanCache } = useScanCache();
  const universeData = useScannerUniverses();

  const [mode, setMode] = useState<"unusual" | "deterministic">("deterministic");
  const [scanMode, setScanMode] = useState<"DISCOVERY" | "MOMENTUM">("DISCOVERY");
  // Part 5: filter chip state for discovery results.
  const [flowFilter, setFlowFilter] = useState<"all" | "unusual" | "noflow">("all");
  const [universe, setUniverse] = useState("preset:liquidCore130");
  const [isScanning, setIsScanning] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState<number | null>(null);
  const [resolvedSymbols, setResolvedSymbols] = useState<string[]>([]);

  const [detResult, setDetResult] = useState<DetScanResult | null>(null);
  const [detError, setDetError] = useState<string | null>(null);

  // Unusual Options Activity scanner state (replaces legacy Manual scanner).
  const [unusualResult, setUnusualResult] = useState<UnusualFlowScanResult | null>(null);
  const [unusualError, setUnusualError] = useState<string | null>(null);
  const [uMinStrikes, setUMinStrikes] = useState(1);
  const [uMinVoi, setUMinVoi] = useState(3);
  const [uMinVolume, setUMinVolume] = useState(500);
  const [uSkew, setUSkew] = useState<"any" | "bullish" | "bearish" | "non_balanced">("any");
  const [uExcludeIndexes, setUExcludeIndexes] = useState(true);
  const [uMinDte, setUMinDte] = useState(3);
  const [uMinNotional, setUMinNotional] = useState(250_000);
  const [uIncludeSweeps, setUIncludeSweeps] = useState(true);
  const [uIncludeBlocks, setUIncludeBlocks] = useState(true);
  const [uIncludeRegular, setUIncludeRegular] = useState(true);
  const [uMinSweepCount, setUMinSweepCount] = useState(0);
  const [uMinBlockCount, setUMinBlockCount] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Part 5: removed legacy on-demand "Unusual Flow Scan (LIVE)" state +
  // poll loop. Live unusual-flow signal is now folded into the LIVE_FLOW
  // bucket on every Discovery scan.

  const [showScreenBuilder, setShowScreenBuilder] = useState(false);
  const [editingScreen, setEditingScreen] = useState<number | null>(null);
  const [refreshingScreenId, setRefreshingScreenId] = useState<number | null>(null);
  const [showWatchlistEditor, setShowWatchlistEditor] = useState(false);
  const [editingWatchlistId, setEditingWatchlistId] = useState<number | null>(null);

  const REMOVED_PRESETS = new Set(["preset:sp500", "preset:sp100", "preset:ndx100"]);

  const scanCacheRestoredRef = useRef(false);
  useEffect(() => {
    if (scanCacheRestoredRef.current || !scanCache) return;
    scanCacheRestoredRef.current = true;
    const r = scanCache.results as any;
    if (r?.scanCount != null) setScanCount(r.scanCount);
    if (r?.detResult) setDetResult(r.detResult as DetScanResult);
    if (r?.unusualResult) setUnusualResult(r.unusualResult as UnusualFlowScanResult);
    if (r?.universe && !REMOVED_PRESETS.has(r.universe)) setUniverse(r.universe);
  }, [scanCache]);

  // Legacy Manual scanner filter state removed when Manual tab was replaced
  // by Unusual Options Activity scanner. Filters now live in u* state above.

  useEffect(() => {
    let cancelled = false;
    universeData.getSymbols(universe).then(syms => {
      if (!cancelled) setResolvedSymbols(syms);
    });
    return () => { cancelled = true; };
  }, [universe, universeData.getSymbols, universeData.watchlists]);

  const handleUnusualFlowScan = async () => {
    const syms = resolvedSymbols.length > 0 ? resolvedSymbols : await universeData.getSymbols(universe);
    if (!syms.length) { setUnusualError("No symbols to scan. Select a market universe or a watchlist with symbols."); return; }

    setIsScanning(true);
    setUnusualError(null);
    setRawError(null);
    setScanCount(syms.length);

    try {
      const res = await fetchWithAuth(`${API_BASE}/ai/unusual-flow-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: syms,
          filters: {
            minStrikes: uMinStrikes,
            minVoiRatio: uMinVoi,
            minVolume: uMinVolume,
            skew: uSkew,
            excludeIndexes: uExcludeIndexes,
            minDte: uMinDte,
            minNotional: uMinNotional,
            includeSweeps: uIncludeSweeps,
            includeBlocks: uIncludeBlocks,
            includeRegular: uIncludeRegular,
            minSweepCount: uMinSweepCount,
            minBlockCount: uMinBlockCount,
          },
        }),
      });
      const data = await res.json() as UnusualFlowScanResult & { error?: string };
      if (data.error) {
        setUnusualError(data.error);
      } else {
        setUnusualResult(data);
        if (data.candidates?.length && subscribeEquitySymbols) {
          subscribeEquitySymbols(data.candidates.map(c => c.symbol));
        }
        setScanCache({
          results: { scanCount: syms.length, unusualResult: data, universe } as any,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      setUnusualError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleDeterministicScan = async () => {
    const syms = resolvedSymbols.length > 0 ? resolvedSymbols : await universeData.getSymbols(universe);
    if (!syms.length) { setDetError("No symbols to scan. Select a market universe or a watchlist with symbols."); return; }

    setIsScanning(true);
    setDetError(null);
    setScanCount(syms.length);

    try {
      const res = await fetchWithAuth(`${API_BASE}/ai/deterministic-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: syms, accessToken: accessToken || "", scanMode }),
      });

      const data = await res.json() as DetScanResult & { error?: string; message?: string };

      if (data.error === "shock_active") {
        setDetError(data.message ?? "Scanning paused — regime shock active");
      } else if (data.error) {
        setDetError(data.error);
      } else {
        if (data.scanTimestamp && data.candidates) {
          for (const c of data.candidates) {
            c.scanTimestamp = data.scanTimestamp;
          }
        }
        setDetResult(data);
        if (data.candidates?.length && subscribeEquitySymbols) {
          subscribeEquitySymbols(data.candidates.map(c => c.symbol));
        }
        setScanCache({
          results: { scanCount: syms.length, detResult: data, universe } as any,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      setDetError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  // Part 5: handleUnusualFlowScan() removed. The on-demand "Unusual Flow
  // Scan (LIVE)" button is gone — live unusual-flow signal is now folded
  // into the LIVE_FLOW scoring bucket on every Discovery scan via
  // computeLiveFlowBucket() in optionsBaselines.ts.

  const handleRefreshScreen = async (id: number) => {
    setRefreshingScreenId(id);
    await universeData.runScreen(id);
    if (universe === `screen:${id}`) {
      const syms = await universeData.getSymbols(`screen:${id}`);
      setResolvedSymbols(syms);
    }
    setRefreshingScreenId(null);
  };

  const hasResults = mode === "unusual" ? (unusualResult?.candidates?.length ?? 0) > 0 : (detResult?.candidates?.length ?? 0) > 0;
  const currentSymCount = resolvedSymbols.length;

  const editScreenObj = editingScreen != null ? universeData.screens.find(s => s.id === editingScreen) ?? null : null;

  const renderUnusualFilters = () => (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Filters tuned for institutional positioning — strip retail 0DTE/lottos.
        </div>
        <button
          onClick={() => setUExcludeIndexes(v => !v)}
          className="text-[10px] py-1 px-2 rounded font-bold uppercase tracking-wider transition-all shrink-0"
          style={{
            background: uExcludeIndexes ? "#18181b" : "transparent",
            color: uExcludeIndexes ? "#66e0ff" : "#6B7280",
            border: `1px solid ${uExcludeIndexes ? "rgba(102,224,255,0.4)" : "#2a2a2a"}`,
          }}
        >
          {uExcludeIndexes ? "✓ " : ""}Exclude Indexes/ETFs
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
            <span>Min Unusual Strikes</span>
            <span style={{ color: "#66e0ff" }}>{uMinStrikes}+</span>
          </div>
          <Slider value={[uMinStrikes]} onValueChange={v => setUMinStrikes(v[0])} min={1} max={10} step={1} />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
            <span>Min VOI Ratio</span>
            <span style={{ color: "#66e0ff" }}>{uMinVoi}×+</span>
          </div>
          <Slider value={[uMinVoi]} onValueChange={v => setUMinVoi(v[0])} min={1} max={10} step={0.5} />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
            <span>Min Strike Volume</span>
            <span style={{ color: "#66e0ff" }}>{uMinVolume.toLocaleString()}+</span>
          </div>
          <Slider value={[uMinVolume]} onValueChange={v => setUMinVolume(v[0])} min={100} max={2000} step={100} />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
            <span>Min Notional / Strike</span>
            <span style={{ color: "#66e0ff" }}>{fmtMoney(uMinNotional)}+</span>
          </div>
          <Slider value={[uMinNotional]} onValueChange={v => setUMinNotional(v[0])} min={50_000} max={5_000_000} step={50_000} />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
            <span>Min DTE (excl. 0DTE)</span>
            <span style={{ color: "#66e0ff" }}>{uMinDte === 0 ? "All" : `${uMinDte}+ days`}</span>
          </div>
          <Slider value={[uMinDte]} onValueChange={v => setUMinDte(v[0])} min={0} max={45} step={1} />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
            <span>Skew Filter</span>
            <span style={{ color: "#66e0ff" }}>
              {uSkew === "any" ? "Any" : uSkew === "bullish" ? "Bullish only" : uSkew === "bearish" ? "Bearish only" : "Exclude balanced"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(["any", "bullish", "bearish", "non_balanced"] as const).map(s => (
              <button
                key={s}
                onClick={() => setUSkew(s)}
                className="text-[10px] py-1.5 rounded font-bold uppercase tracking-wider transition-all"
                style={{
                  background: uSkew === s ? "#18181b" : "transparent",
                  color: uSkew === s ? "#66e0ff" : "#6B7280",
                  border: `1px solid ${uSkew === s ? "rgba(102,224,255,0.4)" : "#2a2a2a"}`,
                }}
              >
                {s === "any" ? "Any" : s === "bullish" ? "Bull" : s === "bearish" ? "Bear" : "≠ Bal"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-muted-foreground uppercase">
            <span>Execution Pattern</span>
            <span style={{ color: "#9ca3af" }} title="Aggressor side requires NBBO subscription — Phase 2">
              Aggressor: N/A
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {([
              ["sweep", uIncludeSweeps, setUIncludeSweeps, "#FFB800"],
              ["block", uIncludeBlocks, setUIncludeBlocks, "#66e0ff"],
              ["regular", uIncludeRegular, setUIncludeRegular, "#6B7280"],
            ] as const).map(([label, val, setter, color]) => (
              <button
                key={label}
                onClick={() => setter(!val)}
                className="text-[10px] py-1.5 rounded font-bold uppercase tracking-wider transition-all"
                style={{
                  background: val ? "#18181b" : "transparent",
                  color: val ? color : "#3f3f46",
                  border: `1px solid ${val ? `${color}66` : "#2a2a2a"}`,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase mb-1">
                <span>Min Sweeps</span>
                <span style={{ color: "#FFB800" }}>{uMinSweepCount}+</span>
              </div>
              <Slider value={[uMinSweepCount]} onValueChange={v => setUMinSweepCount(v[0])} min={0} max={20} step={1} />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground uppercase mb-1">
                <span>Min Blocks</span>
                <span style={{ color: "#66e0ff" }}>{uMinBlockCount}+</span>
              </div>
              <Slider value={[uMinBlockCount]} onValueChange={v => setUMinBlockCount(v[0])} min={0} max={20} step={1} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto pb-6">
      {shockActive && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-red-500/10 border-red-500/30">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="font-mono text-xs font-bold text-red-400 uppercase tracking-wider">Scanning Paused — Regime Shock Active</p>
            <p className="font-mono text-[10px] text-red-400/70 mt-0.5">
              {(pulseData?.activeTriggers?.length ?? 0)} trigger{(pulseData?.activeTriggers?.length ?? 0) !== 1 ? "s" : ""} fired. New scans disabled until shock clears.
            </p>
          </div>
        </div>
      )}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {/* Part 5: Single 3-way segmented control replaces the previous
            Deterministic/Manual + Discovery/Momentum two-level toggle. */}
        <div className="flex border-b border-card-border">
          {([
            { view: "DISCOVERY" as const, label: "DISCOVERY", icon: Crosshair, accent: "#FFB800", beta: true },
            { view: "MOMENTUM" as const, label: "MOMENTUM", icon: BarChart3, accent: "#42a5f5", beta: false },
            { view: "UNUSUAL" as const, label: "UNUSUAL FLOW", icon: Zap, accent: "#66e0ff", beta: false },
          ]).map(({ view: v, label, icon: Icon, accent, beta }) => {
            const active =
              (v === "UNUSUAL" && mode === "unusual") ||
              (v === "DISCOVERY" && mode === "deterministic" && scanMode === "DISCOVERY") ||
              (v === "MOMENTUM" && mode === "deterministic" && scanMode === "MOMENTUM");
            return (
              <button
                key={v}
                onClick={() => {
                  if (v === "UNUSUAL") setMode("unusual");
                  else { setMode("deterministic"); setScanMode(v); }
                }}
                className={`flex-1 py-3 text-sm font-bold uppercase tracking-widest transition-all border-b-2 ${
                  active
                    ? "bg-[#18181B] text-white"
                    : "bg-transparent text-muted-foreground border-b-transparent hover:text-foreground hover:bg-secondary/20"
                }`}
                style={active ? { borderBottomColor: accent, color: accent } : undefined}
              >
                <span className="flex items-center justify-center gap-2">
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {beta && (
                    <span className="text-[8px] px-1 py-0.5 rounded font-bold" style={{ background: "rgba(255,184,0,0.15)", color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)" }}>BETA</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4 bg-[#0c0c0c] space-y-4">
          <div className="flex items-end gap-2">
            <div className="space-y-1.5 flex-1 min-w-0">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" /> Scan Universe
              </Label>
              <UniverseDropdown
                value={universe}
                onChange={setUniverse}
                presets={universeData.presets}
                watchlists={universeData.watchlists}
                screens={universeData.screens}
                onCreateScreen={() => { setEditingScreen(null); setShowScreenBuilder(true); }}
                onEditScreen={(id) => { setEditingScreen(id); setShowScreenBuilder(true); }}
                onDeleteScreen={async (id) => {
                  await universeData.deleteScreen(id);
                  if (universe === `screen:${id}`) setUniverse("preset:liquidCore130");
                }}
                onRefreshScreen={handleRefreshScreen}
                refreshingScreenId={refreshingScreenId}
                onCreateWatchlist={() => { setEditingWatchlistId(null); setShowWatchlistEditor(true); }}
                onEditWatchlist={(id) => { setEditingWatchlistId(id); setShowWatchlistEditor(true); }}
                onDeleteWatchlist={async (id) => {
                  await universeData.deleteWatchlist(id);
                  if (universe === `watchlist:${id}`) setUniverse("preset:liquidCore130");
                }}
              />
            </div>
            {mode === "unusual" && (
              <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
                <DrawerTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open filters"
                    className="shrink-0 inline-flex items-center justify-center rounded-md transition-all active:scale-95"
                    style={{
                      width: 38,
                      height: 38,
                      background: "#18181b",
                      border: "1px solid #2a2a2a",
                      color: "#FFB800",
                    }}
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>
                </DrawerTrigger>
                <DrawerContent className="bg-[#0c0c0c] border-card-border">
                  <DrawerHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between">
                    <DrawerTitle className="text-sm font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                      <Settings2 className="w-4 h-4" style={{ color: "#FFB800" }} />
                      Unusual Flow Filters
                    </DrawerTitle>
                    <DrawerClose asChild>
                      <button
                        type="button"
                        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded"
                        style={{ background: "#18181b", color: "#66e0ff", border: "1px solid rgba(102,224,255,0.4)" }}
                      >
                        Done
                      </button>
                    </DrawerClose>
                  </DrawerHeader>
                  <div className="px-1 pb-6 max-h-[75vh] overflow-y-auto">
                    {renderUnusualFilters()}
                  </div>
                </DrawerContent>
              </Drawer>
            )}
          </div>

          {/* Part 5: Coverage badge + scan summary + scoring info tooltip.
              The verbose "Setup Quality + Accumulation + ..." description
              now lives behind an info icon to reduce visual noise. */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {universeData.loading ? (
              <span className="text-zinc-500">Loading universes...</span>
            ) : (
              <>
                <span>
                  Scanning <span className="text-primary font-bold">{currentSymCount} tickers</span>
                </span>
                {/* Coverage badge — LC130 has nightly flat-files backfill so
                    flow data is "always-on"; everything else is on-demand. */}
                {universe === "preset:liquidCore130" ? (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ color: "#26a69a", background: "rgba(38,166,154,0.1)", border: "1px solid rgba(38,166,154,0.3)" }}
                    title="Liquid Core 130 has nightly options flat-files backfill — flow & live-flow coverage is always on.">
                    LC130 · ALWAYS-ON
                  </span>
                ) : (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ color: "#9ca3af", background: "rgba(156,163,175,0.08)", border: "1px solid rgba(156,163,175,0.2)" }}
                    title="Off-list universe — flow data fetched on-demand at scan time.">
                    ON-DEMAND
                  </span>
                )}
                {/* Part 2 — server-driven LIVE/AMBER/EOD badge for the
                    persistent options watcher. Hidden when the watcher is
                    disabled (server omits the field) so we don't add noise
                    to environments that don't run the WS. */}
                {detResult?.coverage && (() => {
                  const cov = detResult.coverage;
                  const styles: Record<string, { color: string; bg: string; border: string }> = {
                    LIVE:  { color: "#2ecc71", bg: "rgba(46,204,113,0.12)",  border: "rgba(46,204,113,0.4)" },
                    AMBER: { color: "#FFB800", bg: "rgba(255,184,0,0.12)",   border: "rgba(255,184,0,0.4)" },
                    EOD:   { color: "#9ca3af", bg: "rgba(156,163,175,0.08)", border: "rgba(156,163,175,0.25)" },
                  };
                  const s = styles[cov.state] ?? styles.EOD!;
                  const ageSec = cov.heartbeatAgeMs != null ? Math.round(cov.heartbeatAgeMs / 1000) : null;
                  const tip =
                    cov.state === "LIVE"
                      ? `Watcher live · ${cov.totalSubscribed} contracts subscribed · coverage ${(cov.coverageRate * 100).toFixed(0)}%${ageSec != null ? ` · last tick ${ageSec}s ago` : ""}`
                      : cov.state === "AMBER"
                      ? `Watcher running, partial coverage (${(cov.coverageRate * 100).toFixed(0)}%)${ageSec != null ? `, last tick ${ageSec}s ago` : ""} — ${cov.reason}`
                      : `Live watcher unavailable (${cov.reason}) — bars sourced from trailing flat-files only.`;
                  return (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
                      title={tip}>
                      WS · {cov.state}
                    </span>
                  );
                })()}
                {mode === "deterministic" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="inline-flex items-center text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Scoring details">
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-[11px] leading-relaxed">
                      {scanMode === "DISCOVERY"
                        ? "Discovery scoring: Setup Quality + Accumulation + IV Setup + Flow + Live Flow + Emerging RS. Min total 55."
                        : "Momentum scoring: Trend + RS + Volume + IVR + Options Liquidity. Top 5, min 60."}
                    </TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
          </div>

          {/* Part 5: Filter chips for discovery results — All / Unusual flow only / No flow detected. */}
          {mode === "deterministic" && scanMode === "DISCOVERY" && (
            <div className="flex items-center gap-1.5 mt-1">
              {([
                { id: "all" as const, label: "All" },
                { id: "unusual" as const, label: "Unusual flow only" },
                { id: "noflow" as const, label: "No flow detected" },
              ]).map(c => {
                const active = flowFilter === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setFlowFilter(c.id)}
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full transition-all ${
                      active ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                    style={active
                      ? { background: "rgba(102,224,255,0.15)", border: "1px solid rgba(102,224,255,0.5)", color: "#66e0ff" }
                      : { background: "transparent", border: "1px solid #2a2a2a" }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>


        <div className="px-4 pb-4 pt-3 bg-[#0c0c0c] border-t border-card-border">
          <button
            onClick={mode === "deterministic" ? handleDeterministicScan : handleUnusualFlowScan}
            disabled={!accessToken || isScanning || currentSymCount === 0 || shockActive}
            className="font-bold font-mono tracking-wider mx-auto block rounded-lg disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 active:brightness-110 transition-all"
            style={{
              fontSize: 13, padding: "10px",
              background: "#18181b", color: "#FFB800", border: "none",
              cursor: "pointer",
            }}
          >
            {isScanning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-[#FFB800] border-t-transparent rounded-full animate-spin" />
                {mode === "deterministic" ? "SCORING CANDIDATES..." : "SCANNING FLOW..."}
              </span>
            ) : (
              <span className="flex items-center justify-center">
                {`SCAN ${currentSymCount} STOCKS`}
              </span>
            )}
          </button>
          {!accessToken && (
            <div className="mt-2 flex justify-center">
              <ConnectBrokerPrompt label="Connect Brokerage For Market Scanner" compact />
            </div>
          )}

          {/* Part 5: "Unusual Flow Scan (LIVE)" button removed.
              Live unusual-flow signals are now folded into the LIVE_FLOW
              scoring bucket on every Discovery scan, surfaced as bars on
              each result row and as the per-row LIVE chip below. */}
        </div>
      </div>

      {/* Part 5: Removed legacy "LIVE UNUSUAL FLOW" results panel —
          live unusual flow is now baked into the LIVE_FLOW scoring bucket
          and surfaced inline on each Discovery result row. */}

      {isScanning && !(mode === "deterministic" && detResult) && (
        <div className="flex flex-col items-center justify-center py-16 gap-4 bg-card rounded-xl border border-card-border">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
            <div className="absolute inset-0 border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm text-primary animate-pulse font-bold">
              SCANNING {scanCount ?? currentSymCount} TICKERS...
            </p>
            <p className="text-[11px] text-muted-foreground">
              {mode === "deterministic"
                ? scanMode === "DISCOVERY"
                  ? "Filtering → OBV + HV + IV + Polygon flow → Discovery scoring → Ranking"
                  : "Filtering universe → Scoring → Ranking → Enriching"
                : "Querying per-strike flow → Applying thresholds → Scoring → Ranking"}
            </p>
          </div>
        </div>
      )}

      {isScanning && mode === "deterministic" && detResult && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-primary/20 bg-primary/5">
          <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-[11px] font-mono text-primary/80 animate-pulse">
            RESCANNING {scanCount ?? currentSymCount} TICKERS — results will update when complete
          </span>
        </div>
      )}

      {rawError && !isScanning && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-xs text-destructive font-bold mb-2">SCAN ERROR</p>
          <p className="text-[11px] text-destructive/80">{rawError}</p>
        </div>
      )}

      {mode === "unusual" && unusualError && !isScanning && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-xs text-destructive font-bold mb-2">SCAN ERROR</p>
          <p className="text-[11px] text-destructive/80">{unusualError}</p>
        </div>
      )}

      {mode === "unusual" && !isScanning && unusualResult && unusualResult.candidates.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4" style={{ color: "#66e0ff" }} />
              <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">
                {unusualResult.scannedSymbols} scanned
                <span className="text-zinc-600 mx-1">|</span>
                {unusualResult.symbolsWithFlow} with flow data
                <span className="text-zinc-600 mx-1">|</span>
                <span style={{ color: "#66e0ff" }}>{unusualResult.candidates.length} matched filters</span>
              </span>
            </div>
            {unusualResult.asOfDate && (
              <span className="text-[10px] text-zinc-600 tabular-nums">as of {unusualResult.asOfDate}</span>
            )}
          </div>
          <div className="space-y-2">
            {unusualResult.candidates.map((c, i) => (
              <UnusualFlowCard
                key={c.symbol}
                candidate={c}
                rank={i + 1}
                onSelect={onNavigateToSymbol ?? setSymbol}
                onSendToStrategist={onSendToStrategist}
              />
            ))}
          </div>
        </div>
      )}

      {mode === "unusual" && !isScanning && unusualResult && unusualResult.candidates.length === 0 && !unusualError && (
        <div className="py-16 text-center text-xs text-muted-foreground/40 bg-card border border-card-border rounded-xl">
          No symbols matched your unusual flow thresholds. Try lowering Min Strikes or Min VOI Ratio.
        </div>
      )}

      {mode === "unusual" && !isScanning && !unusualResult && !unusualError && (
        <div className="py-6 text-center text-[11px] text-muted-foreground/60">
          Tune the thresholds and run a scan to find names with unusual options activity.
        </div>
      )}

      {mode === "deterministic" && detError && !isScanning && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-xs text-destructive font-bold mb-2">SCAN ERROR</p>
          <p className="text-[11px] text-destructive/80">{detError}</p>
        </div>
      )}

      {mode === "deterministic" && !isScanning && detResult && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-4 h-4 text-zinc-500" />
              <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">
                {detResult.filterSummary.totalScanned} scanned
                <span className="text-zinc-600 mx-1">|</span>
                {detResult.filterSummary.passedFilters} passed filters
                <span className="text-zinc-600 mx-1">|</span>
                <span style={{ color: "#FFB800" }}>{detResult.filterSummary.scoredAboveThreshold} above threshold</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              {detResult.scanMode === "DISCOVERY" || !detResult.scanMode ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: "#FFB800", background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.3)" }}>
                  DISCOVERY BETA
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: "#6B7280", background: "#18181b", border: "1px solid #2a2a2a" }}>
                  MOMENTUM
                </span>
              )}
              <span className="text-[10px] text-zinc-600 tabular-nums">
                {new Date(detResult.scanTimestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>

          {(() => {
            // Part 5: apply flow-filter chips. Discovery mode only; Momentum
            // shows everything since the live-flow signal is Discovery-only.
            // Gate by the actual result payload mode — NOT current UI
            // scanMode — so a stale Momentum result doesn't get filtered if
            // the user toggles the segmented control before rescanning.
            const resultIsDiscovery = detResult.candidates[0]?.scanMode === "DISCOVERY";
            const filtered = resultIsDiscovery
              ? detResult.candidates.filter(c => {
                  const live = c.discoveryComponents?.liveFlowAvailable === true;
                  if (flowFilter === "unusual") return live;
                  if (flowFilter === "noflow") return !live;
                  return true;
                })
              : detResult.candidates;
            return filtered.length > 0 ? (
              <div className="space-y-2">
                {filtered.map((c, i) => (
                  <DeterministicCard
                    key={c.symbol}
                    candidate={c}
                    rank={i + 1}
                    onSelect={onNavigateToSymbol ?? setSymbol}
                    onSendToStrategist={onSendToStrategist}
                  />
                ))}
              </div>
            ) : (
              // Part 5: subtle text-line empty state (replaces the
              // "Cash Is a Position" panel). Disambiguates "no scan results"
              // vs "filter hid everything".
              <div className="py-6 text-center text-[11px] text-muted-foreground/60">
                {detResult.candidates.length === 0
                  ? "No candidates scored above threshold."
                  : `No candidates match the "${flowFilter === "unusual" ? "Unusual flow only" : "No flow detected"}" filter.`}
              </div>
            );
          })()}
        </div>
      )}

      {mode === "deterministic" && !isScanning && !detResult && !detError && (
        <div className="py-6 text-center text-[11px] text-muted-foreground/60">
          Select a universe and run a scan to find trade candidates.
        </div>
      )}

      {showScreenBuilder && (
        <ScreenBuilder
          onClose={() => { setShowScreenBuilder(false); setEditingScreen(null); }}
          onSave={async (name, filters) => {
            const screen = await universeData.createScreen(name, filters);
            if (screen) setUniverse(`screen:${screen.id}`);
          }}
          onPreview={universeData.previewScreen}
          editScreen={editScreenObj as any}
          onUpdate={universeData.updateScreen}
        />
      )}

      {showWatchlistEditor && (
        <WatchlistEditor
          watchlist={editingWatchlistId != null ? universeData.watchlists.find(w => w.id === editingWatchlistId) ?? null : null}
          onClose={() => { setShowWatchlistEditor(false); setEditingWatchlistId(null); }}
          onCreate={async (name, symbols) => {
            const wl = await universeData.createWatchlist(name, symbols);
            if (wl) setUniverse(`watchlist:${wl.id}`);
          }}
          onUpdate={async (id, data) => {
            await universeData.updateWatchlist(id, data);
          }}
          onAddSymbol={universeData.addSymbolToWatchlist}
          onRemoveSymbol={universeData.removeSymbolFromWatchlist}
        />
      )}
    </div>
  );
}
