import { useState } from "react";
import {
  TrendingUp, TrendingDown, Minus, Shield, AlertTriangle,
  ChevronDown, ChevronUp, Target, Activity, Zap,
} from "lucide-react";

const GOLD = "#f5a623";
const UP = "#2ecc71";
const DOWN = "#ff4b5c";
const AMBER = "#f59e0b";

export interface StrategistV2Result {
  status: "recommendation" | "no_viable_setup" | "toxic_block";
  ticker: string;
  recommendation?: {
    strategyLine: string;
    thesis: string;
    edgeAttribution: string;
    idioStrengthPct: number;
    macroPct: number;
    strategyType: string;
    direction: string;
    legs: Array<{
      type: string;
      side: string;
      strike: number;
      expiration: string;
      bid: number;
      ask: number;
      mid: number;
      delta: number;
      openInterest: number;
    }>;
    credit?: number;
    debit?: number;
    maxProfit: number;
    maxLoss: number;
    breakeven: number;
    riskReward: number;
    dte: number;
    expiration: string;
  };
  blockReason?: string;
  regime: {
    directionalConviction: string;
    systemicRiskLevel: string;
    correlationRegime: string;
    compositeScore: number;
    idioOpportunityFlag: boolean;
  };
  ioScore?: {
    final: number;
    classification: string;
    beta: number;
    residualReturnZScore: number;
    components: {
      marketIndependence: { rSquared: number; weight: number; contribution: number };
      abnormalMove: { zScoreRaw: number; zScoreNormalized: number; weight: number; contribution: number };
      catalyst: { flagValue: number; reason: string; weight: number; contribution: number };
      flowDivergence: { volOiRatio: number; skewDivergence: number; final: number; weight: number; contribution: number };
    };
  };
  systemicRiskElevated: boolean;
  telemetryId?: number;
}

const STRAT_LABELS: Record<string, string> = {
  bull_put_spread: "Bull Put Spread",
  bear_call_spread: "Bear Call Spread",
  call_debit_spread: "Call Debit Spread",
  put_debit_spread: "Put Debit Spread",
  iron_condor: "Iron Condor",
  butterfly: "Butterfly",
  calendar: "Calendar Spread",
};

function DirectionIcon({ dir }: { dir: string }) {
  if (dir === "BULLISH") return <TrendingUp className="w-4 h-4" style={{ color: UP }} />;
  if (dir === "BEARISH") return <TrendingDown className="w-4 h-4" style={{ color: DOWN }} />;
  return <Minus className="w-4 h-4" style={{ color: GOLD }} />;
}

export function StrategistV2RecommendationCard({ result }: { result: StrategistV2Result }) {
  const [expanded, setExpanded] = useState(false);
  const { recommendation: rec, regime, ioScore, systemicRiskElevated } = result;

  if (!rec) return null;

  const borderColor = systemicRiskElevated ? AMBER : "#2A2A2C";
  const stratLabel = STRAT_LABELS[rec.strategyType] ?? rec.strategyType.replace(/_/g, " ");
  const isCredit = rec.credit != null && rec.credit > 0;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: `2px solid ${borderColor}` }}>
      {systemicRiskElevated && (
        <div className="flex items-center gap-2 px-4 py-2" style={{ background: "rgba(245, 158, 11, 0.08)", borderBottom: `1px solid ${AMBER}30` }}>
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: AMBER }} />
          <span className="font-mono text-[10px] font-bold tracking-wider" style={{ color: AMBER }}>ELEVATED SYSTEMIC RISK — REDUCED SIZING RECOMMENDED</span>
        </div>
      )}

      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DirectionIcon dir={rec.direction} />
            <span className="font-mono text-[15px] font-bold text-white">{result.ticker}</span>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: `${rec.direction === "BULLISH" ? UP : rec.direction === "BEARISH" ? DOWN : GOLD}18`, color: rec.direction === "BULLISH" ? UP : rec.direction === "BEARISH" ? DOWN : GOLD }}>
              {rec.direction}
            </span>
          </div>
          <span className="font-mono text-[12px] font-bold" style={{ color: GOLD }}>{stratLabel}</span>
        </div>

        <div className="font-mono text-[12px] text-white leading-relaxed mb-3">{rec.thesis}</div>

        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245, 166, 35, 0.06)", border: "1px solid rgba(245, 166, 35, 0.15)" }}>
          <Zap className="w-3 h-3 flex-shrink-0" style={{ color: GOLD }} />
          <span className="font-mono text-[10px] text-white">{rec.edgeAttribution}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatRow label="Idiosyncratic" value={`${rec.idioStrengthPct}%`} />
          <StatRow label="Macro-aligned" value={`${rec.macroPct}%`} />
          <StatRow label={isCredit ? "Credit" : "Debit"} value={`$${((isCredit ? rec.credit : rec.debit) ?? 0).toFixed(2)}`} />
          <StatRow label="Risk/Reward" value={`${rec.riskReward.toFixed(2)}:1`} />
          <StatRow label="Max Profit" value={`$${rec.maxProfit.toFixed(0)}`} color={UP} />
          <StatRow label="Max Loss" value={`$${rec.maxLoss.toFixed(0)}`} color={DOWN} />
          <StatRow label="Breakeven" value={`$${rec.breakeven.toFixed(2)}`} />
          <StatRow label="DTE" value={`${rec.dte}d`} />
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 font-mono text-[10px] text-zinc-500 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Hide" : "Show"} Legs & Details
        </button>

        {expanded && (
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              {rec.legs.map((leg, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: "#0a0a0c" }}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold" style={{ color: leg.side === "buy" ? UP : DOWN }}>
                      {leg.side.toUpperCase()}
                    </span>
                    <span className="font-mono text-[11px] text-white">{leg.type.toUpperCase()} ${leg.strike}</span>
                    <span className="font-mono text-[9px] text-zinc-500">{leg.expiration}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[9px] text-zinc-500">Δ {leg.delta.toFixed(2)}</span>
                    <span className="font-mono text-[9px] text-zinc-500">OI {leg.openInterest.toLocaleString()}</span>
                    <span className="font-mono text-[10px] text-white">${leg.mid.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            {ioScore && ioScore.components && (
              <div className="space-y-2">
                <h4 className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">IOScore Breakdown</h4>
                <div className="grid grid-cols-2 gap-2">
                  <StatRow label="Overall" value={`${(ioScore.final * 100).toFixed(0)}%`} color={ioScore.classification === "HIGH_IDIOSYNCRATIC" ? UP : ioScore.classification === "MIXED" ? GOLD : "#71717a"} />
                  <StatRow label="Classification" value={ioScore.classification.replace(/_/g, " ")} />
                  <StatRow label="R²" value={ioScore.components.marketIndependence?.rSquared?.toFixed(3) ?? "—"} />
                  <StatRow label="Beta" value={ioScore.beta?.toFixed(2) ?? "—"} />
                  <StatRow label="Residual Z" value={ioScore.residualReturnZScore?.toFixed(2) ?? "—"} />
                  <StatRow label="Catalyst" value={ioScore.components.catalyst?.flagValue > 0 ? "YES" : "No"} color={ioScore.components.catalyst?.flagValue > 0 ? UP : "#71717a"} />
                  <StatRow label="Flow Score" value={ioScore.components.flowDivergence?.final?.toFixed(3) ?? "—"} />
                  <StatRow label="Vol/OI Ratio" value={ioScore.components.flowDivergence?.volOiRatio?.toFixed(3) ?? "—"} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">Regime</h4>
              <div className="grid grid-cols-2 gap-2">
                <StatRow label="Conviction" value={regime.directionalConviction} />
                <StatRow label="Risk Level" value={regime.systemicRiskLevel} color={regime.systemicRiskLevel === "EXTREME" ? DOWN : regime.systemicRiskLevel === "ELEVATED" ? AMBER : UP} />
                <StatRow label="Correlation" value={regime.correlationRegime} />
                <StatRow label="Composite" value={regime.compositeScore.toFixed(1)} />
                <StatRow label="Idio Opportunity" value={regime.idioOpportunityFlag ? "YES" : "No"} color={regime.idioOpportunityFlag ? GOLD : "#71717a"} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function StrategistV2BlockCard({ result }: { result: StrategistV2Result }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4" style={{ color: result.status === "toxic_block" ? DOWN : "#71717a" }} />
          <span className="font-mono text-[13px] font-bold text-white">{result.ticker}</span>
          <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{
            background: result.status === "toxic_block" ? `${DOWN}18` : "rgba(113, 113, 122, 0.15)",
            color: result.status === "toxic_block" ? DOWN : "#71717a",
          }}>
            {result.status === "toxic_block" ? "TOXIC BLOCK" : "NO VIABLE SETUP"}
          </span>
        </div>
        <div className="font-mono text-[11px] text-zinc-400 leading-relaxed">
          {result.blockReason ?? "No actionable setup found with current market conditions."}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-2 font-mono text-[10px] text-zinc-500 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Regime Details
        </button>

        {expanded && result.regime && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <StatRow label="Conviction" value={result.regime.directionalConviction} />
            <StatRow label="Risk Level" value={result.regime.systemicRiskLevel} color={result.regime.systemicRiskLevel === "EXTREME" ? DOWN : result.regime.systemicRiskLevel === "ELEVATED" ? AMBER : UP} />
            <StatRow label="Correlation" value={result.regime.correlationRegime} />
            <StatRow label="Composite" value={result.regime.compositeScore.toFixed(1)} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color: color ?? "#fff" }}>{value}</span>
    </div>
  );
}
