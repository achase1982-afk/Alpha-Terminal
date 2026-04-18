import { useState, useCallback } from "react";
import {
  TrendingUp, TrendingDown, Minus, Shield,
  ChevronDown, ChevronUp, Target, Activity, Zap, Send, Copy, Check,
} from "lucide-react";
import { strategistCardToPlainText } from "@/lib/strategistPlaintext";

const GOLD = "#f5a623";
const UP = "#2ecc71";
const DOWN = "#ff4b5c";
const AMBER = "#f59e0b";

// Mirror of server-side BlockReason taxonomy. Older history rows persist
// blockReason as a free-form string; normalizeBlockReason() promotes those to
// { category: "UNKNOWN", detail: <string> } at render time.
export type RejectionCategory =
  | "TOXIC_BLOCK"
  | "LOW_CONFIDENCE"
  | "NO_EDGE"
  | "CATALYST_CONFLICT"
  | "VALIDATION_FAIL"
  | "MISSING_DATA"
  | "STOCK_HALTED"
  | "PRICING_MARKET_CLOSED"
  | "UNKNOWN";

export interface BlockReason {
  category: RejectionCategory;
  detail: string;
  suggestedAction?: string;
}

export function normalizeBlockReason(raw: BlockReason | string | undefined | null): BlockReason | null {
  if (!raw) return null;
  if (typeof raw === "string") return { category: "UNKNOWN", detail: raw };
  if (typeof raw === "object" && typeof (raw as any).category === "string" && typeof (raw as any).detail === "string") {
    return raw as BlockReason;
  }
  return { category: "UNKNOWN", detail: String(raw) };
}

const CATEGORY_LABELS: Record<RejectionCategory, string> = {
  TOXIC_BLOCK: "Toxic Block",
  LOW_CONFIDENCE: "Low Confidence",
  NO_EDGE: "No Edge",
  CATALYST_CONFLICT: "Catalyst Conflict",
  VALIDATION_FAIL: "Validation Failed",
  MISSING_DATA: "Missing Data",
  STOCK_HALTED: "Stock Halted",
  PRICING_MARKET_CLOSED: "Market Closed",
  UNKNOWN: "Blocked",
};

const CATEGORY_COLORS: Record<RejectionCategory, string> = {
  TOXIC_BLOCK: "#ff4b5c",
  LOW_CONFIDENCE: "#71717a",
  NO_EDGE: "#71717a",
  CATALYST_CONFLICT: "#f59e0b",
  VALIDATION_FAIL: "#f59e0b",
  MISSING_DATA: "#71717a",
  STOCK_HALTED: "#ff4b5c",
  PRICING_MARKET_CLOSED: "#71717a",
  UNKNOWN: "#71717a",
};

export type CatalystType =
  | "EARNINGS" | "FED_MEETING" | "ECONOMIC_RELEASE"
  | "PRODUCT_LAUNCH" | "MA_EVENT" | "ANALYST_ACTION" | "NONE";
export type CatalystAlignmentNew = "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "UNKNOWN";
export type CatalystScope = "NAME_SPECIFIC" | "MACRO_ONLY" | "BOTH" | "NONE";

export interface CatalystEvaluation {
  catalystInWindow: boolean;
  catalystType: CatalystType;
  catalystDate: string | null;
  catalystAlignment: CatalystAlignmentNew;
  catalystScope?: CatalystScope; // optional for back-compat with old persisted records
  residualCatalyst?: { type: Exclude<CatalystType, "NONE">; date: string; daysSince: number };
  catalystSummary?: string;
  scheduledEvents: Array<{
    type: Exclude<CatalystType, "NONE">;
    date: string;
    title: string;
    source: "earnings_service" | "calendar" | "ai_web_search";
  }>;
}

export interface ContextSourcesPayload {
  webSearchUsed: boolean;
  queryCount: number;
  queries: string[];
  sources: Array<{ title: string; url: string; date?: string }>;
  /** @deprecated legacy day-trader field; always false on new analyses */
  sameDayCatalyst: boolean;
  /** @deprecated mirror of catalyst.catalystSummary on new analyses */
  catalystSummary?: string;
  /** @deprecated mirror of catalyst.catalystAlignment on new analyses */
  catalystAlignment?: "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "NONE";
  /** New swing-trader catalyst evaluation; present on all new analyses */
  catalyst?: CatalystEvaluation;
}

export interface StrategistV2Result {
  status: "recommendation" | "no_viable_setup" | "toxic_block";
  ticker: string;
  recommendation?: {
    strategyLine: string;
    companyContext?: string;
    thesis: string;
    rationale?: string;
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
    entryRangeMin?: number;
    entryRangeMax?: number;
    maxProfit: number;
    maxLoss: number;
    breakeven: number;
    riskReward: number;
    dte: number;
    expiration: string;
    exitTargets?: {
      profitTarget: number;
      profitTargetUnderlying: number;
      stopLoss: number;
      stopLossUnderlying: number;
      timeStop: string;
    };
    bullInvalidation?: string;
    bearInvalidation?: string;
    riskOfRuin?: string;
    confidence?: number;
    warnings?: string | null;
    contextSources?: ContextSourcesPayload;
  };
  blockReason?: BlockReason | string;
  contextSources?: ContextSourcesPayload;
  regime: {
    directionalConviction: string;
    systemicRiskLevel: string;
    correlationRegime: string;
    compositeScore?: number;
    idioOpportunityFlag?: boolean;
  };
  ioScore?: {
    final: number;
    /**
     * False when the underlying beta/R² regression hit fallback defaults
     * (insufficient SPY/equity history). When false, the UI must show "N/A"
     * rather than the numeric score — fallback values like 0.50 look like
     * real scores and made the displayed IOScore appear to flip between e.g.
     * 67 and 50 between identical inputs.
     */
    available?: boolean;
    dataAvailability?: {
      source: "real" | "fallback_no_data" | "fallback_error";
      equityDays: number;
      spyDays: number;
      pairs: number;
    };
    classification: string;
    beta: number;
    residualReturnZScore: number;
    components?: {
      marketIndependence: { rSquared: number; weight: number; contribution: number };
      abnormalMove: { zScoreRaw: number; zScoreNormalized: number; weight: number; contribution: number };
      catalyst: { flagValue: number; reason: string; weight: number; contribution: number };
      flowDivergence: { volOiRatio: number; skewDivergence: number; final: number; weight: number; contribution: number };
    };
  };
  systemicRiskElevated: boolean;
  telemetryId?: number;
  earningsAlert?: {
    earningsDate: string;
    daysUntilEarnings: number | null;
    daysUntilExpiry: number;
    insideExpiry: boolean;
    behavior: "BLOCK" | "WARN" | "IGNORE";
    source: "benzinga" | "yahoo" | null;
    confirmed: boolean;
  };
}

const STRAT_LABELS: Record<string, string> = {
  bull_put_spread: "Bull Put Spread",
  bear_call_spread: "Bear Call Spread",
  call_debit_spread: "Call Debit Spread",
  put_debit_spread: "Put Debit Spread",
  bull_call_spread: "Bull Call Spread",
  bear_put_spread: "Bear Put Spread",
  iron_condor: "Iron Condor",
  butterfly: "Butterfly",
  calendar: "Calendar Spread",
  calendar_spread: "Calendar Spread",
  diagonal: "Diagonal Spread",
  diagonal_spread: "Diagonal Spread",
  ratio_spread: "Ratio Spread",
  straddle: "Straddle",
  strangle: "Strangle",
  naked_put: "Naked Put",
  naked_call: "Naked Call",
};

function DirectionIcon({ dir }: { dir: string }) {
  if (dir === "BULLISH") return <TrendingUp className="w-4 h-4" style={{ color: UP }} />;
  if (dir === "BEARISH") return <TrendingDown className="w-4 h-4" style={{ color: DOWN }} />;
  return <Minus className="w-4 h-4" style={{ color: GOLD }} />;
}

function buildOccSymbol(ticker: string, expiration: string, type: string, strike: number): string {
  const clean = expiration.split(":")[0].trim();
  const parts = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let yy: string, mm: string, dd: string;
  if (parts) {
    yy = parts[1].slice(2);
    mm = parts[2];
    dd = parts[3];
  } else {
    const d = new Date(clean + "T12:00:00");
    if (isNaN(d.getTime())) return "";
    yy = String(d.getFullYear()).slice(2);
    mm = String(d.getMonth() + 1).padStart(2, "0");
    dd = String(d.getDate()).padStart(2, "0");
  }
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  const sym = ticker.toUpperCase().padEnd(6, " ");
  return `${sym}${yy}${mm}${dd}${type.toUpperCase() === "CALL" ? "C" : "P"}${strikePadded}`;
}

export interface StrategistSendToOrderPayload {
  ticker: string;
  legs: Array<{
    schwabSymbol: string;
    instruction: string;
    quantity: number;
    optionType: string;
    strike: number;
    expiration: string;
    bid: number;
    ask: number;
    delta: number;
  }>;
  netPrice: number;
  isCredit: boolean;
}

function CopyCardButton({ result, generatedAt }: { result: StrategistV2Result; generatedAt?: string | number | null }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      const text = strategistCardToPlainText(result, generatedAt ?? undefined);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: a transient textarea trick (rare; iOS Safari requires user gesture, which we have)
      try {
        const ta = document.createElement("textarea");
        ta.value = strategistCardToPlainText(result, generatedAt ?? undefined);
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // give up silently
      }
    }
  }, [result, generatedAt]);
  return (
    <button
      onClick={onCopy}
      aria-label="Copy card to clipboard"
      className="flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider transition-all active:scale-95"
      style={{
        background: copied ? "rgba(46, 204, 113, 0.15)" : "rgba(255,255,255,0.06)",
        color: copied ? "#2ecc71" : "#a1a1aa",
        border: copied ? "1px solid rgba(46, 204, 113, 0.35)" : "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function StrategistV2RecommendationCard({ result, onSendToOrder, generatedAt }: { result: StrategistV2Result; onSendToOrder?: (payload: StrategistSendToOrderPayload) => void; generatedAt?: string | number | null }) {
  const [expanded, setExpanded] = useState(false);
  const { recommendation: rec, regime, ioScore, systemicRiskElevated } = result;

  if (!rec) return null;

  const earningsAlert = result.earningsAlert;
  const showEarningsBanner = earningsAlert && earningsAlert.behavior === "WARN" && earningsAlert.insideExpiry;

  const borderColor = systemicRiskElevated ? AMBER : "#2A2A2C";
  const stratLabel = STRAT_LABELS[rec.strategyType] ?? rec.strategyType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const isCredit = rec.credit != null && rec.credit > 0;
  const confidence = rec.confidence ?? 0;
  const confidenceColor = confidence >= 70 ? UP : confidence >= 40 ? GOLD : DOWN;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: `2px solid ${borderColor}` }}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DirectionIcon dir={rec.direction} />
            <span className="font-mono text-[15px] font-bold text-white">{result.ticker}</span>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: `${rec.direction === "BULLISH" ? UP : rec.direction === "BEARISH" ? DOWN : GOLD}18`, color: rec.direction === "BULLISH" ? UP : rec.direction === "BEARISH" ? DOWN : GOLD }}>
              {rec.direction}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {confidence > 0 && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{ background: `${confidenceColor}18`, color: confidenceColor }}>
                {confidence}% conf
              </span>
            )}
            <span className="font-mono text-[12px] font-bold" style={{ color: GOLD }}>{stratLabel}</span>
            <CopyCardButton result={result} generatedAt={generatedAt} />
          </div>
        </div>
        {generatedAt && (
          <div className="font-mono text-[9px] text-zinc-500 mb-2 -mt-2">Generated {new Date(generatedAt).toLocaleString()}</div>
        )}

        {showEarningsBanner && earningsAlert && (
          <div
            className="rounded mb-3 px-3 py-2 flex items-start gap-2"
            style={{ background: `${AMBER}14`, border: `1px solid ${AMBER}55` }}
          >
            <span className="font-mono text-[14px] leading-none mt-0.5" style={{ color: AMBER }}>⚠</span>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] font-bold" style={{ color: AMBER }}>
                Earnings inside expiry
              </div>
              <div className="font-mono text-[10px] text-zinc-300 mt-0.5">
                {earningsAlert.confirmed ? "Confirmed" : "Estimated"} earnings on{" "}
                <span className="text-white">{earningsAlert.earningsDate}</span>
                {earningsAlert.daysUntilEarnings != null && (
                  <> (in {earningsAlert.daysUntilEarnings}d)</>
                )}{" "}
                — falls inside the {earningsAlert.daysUntilExpiry}-DTE expiry. Position will hold through earnings.
              </div>
              {earningsAlert.source && (
                <div className="font-mono text-[9px] text-zinc-500 mt-0.5">
                  Source: {earningsAlert.source}
                </div>
              )}
            </div>
          </div>
        )}

        {rec.companyContext && (
          <div className="font-mono text-[11px] text-zinc-400 leading-relaxed mb-2">{rec.companyContext}</div>
        )}

        <div className="font-mono text-[12px] text-white leading-relaxed mb-3">{rec.thesis || rec.rationale}</div>

        {rec.warnings && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
            <Shield className="w-3 h-3 flex-shrink-0" style={{ color: AMBER }} />
            <span className="font-mono text-[10px]" style={{ color: AMBER }}>{rec.warnings}</span>
          </div>
        )}

        {rec.riskOfRuin && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255, 75, 92, 0.06)", border: "1px solid rgba(255, 75, 92, 0.15)" }}>
            <Shield className="w-3 h-3 flex-shrink-0" style={{ color: DOWN }} />
            <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 mr-1">Risk of Ruin:</span>
            <span className="font-mono text-[10px]" style={{ color: DOWN }}>{rec.riskOfRuin}</span>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ background: "rgba(245, 166, 35, 0.06)", border: "1px solid rgba(245, 166, 35, 0.15)" }}>
          <Zap className="w-3 h-3 flex-shrink-0" style={{ color: GOLD }} />
          <span className="font-mono text-[10px] text-white">{rec.edgeAttribution}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatRow label="Idiosyncratic" value={`${rec.idioStrengthPct}%`} />
          <StatRow label="Macro-aligned" value={`${rec.macroPct}%`} />
          <StatRow label={isCredit ? "Credit" : "Debit"} value={`$${((isCredit ? rec.credit : rec.debit) ?? 0).toFixed(2)}`} />
          <StatRow label="Fill Range" value={rec.entryRangeMin != null && rec.entryRangeMax != null ? `$${Math.abs(rec.entryRangeMin).toFixed(2)} – $${Math.abs(rec.entryRangeMax).toFixed(2)}` : "—"} />
          <StatRow label="Risk/Reward" value={`${rec.riskReward.toFixed(2)}:1`} />
          <StatRow label="Max Profit" value={`$${rec.maxProfit.toFixed(0)}`} color={UP} />
          <StatRow label="Max Loss" value={`$${rec.maxLoss.toFixed(0)}`} color={DOWN} />
          <StatRow label="Breakeven" value={`$${rec.breakeven.toFixed(2)}`} />
          <StatRow label="DTE" value={`${rec.dte}d`} />
        </div>

        {rec.exitTargets && (rec.exitTargets.profitTarget > 0 || rec.exitTargets.stopLoss > 0) && (
          <div className="mb-3 px-3 py-2 rounded-lg space-y-1" style={{ background: "#0a0a0c" }}>
            <h4 className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Exit Targets</h4>
            {rec.exitTargets.profitTarget > 0 && (
              <div className="flex justify-between">
                <span className="font-mono text-[10px] text-zinc-400">Profit Target</span>
                <span className="font-mono text-[10px]" style={{ color: UP }}>
                  ${rec.exitTargets.profitTarget.toFixed(2)} per contract
                  {" ("}${Math.round(rec.exitTargets.profitTarget * 100)} on 1 lot
                  {rec.exitTargets.profitTargetUnderlying > 0 ? `, underlying $${rec.exitTargets.profitTargetUnderlying.toFixed(2)}` : ""}
                  {")"}
                </span>
              </div>
            )}
            {rec.exitTargets.stopLoss > 0 && (
              <div className="flex justify-between">
                <span className="font-mono text-[10px] text-zinc-400">Stop Loss</span>
                <span className="font-mono text-[10px]" style={{ color: DOWN }}>
                  ${rec.exitTargets.stopLoss.toFixed(2)} per contract
                  {" ("}${Math.round(rec.exitTargets.stopLoss * 100)} on 1 lot
                  {rec.exitTargets.stopLossUnderlying > 0 ? `, underlying $${rec.exitTargets.stopLossUnderlying.toFixed(2)}` : ""}
                  {")"}
                </span>
              </div>
            )}
            {rec.exitTargets.timeStop && (
              <div className="flex justify-between">
                <span className="font-mono text-[10px] text-zinc-400">Time Stop</span>
                <span className="font-mono text-[10px] text-white">{rec.exitTargets.timeStop}</span>
              </div>
            )}
          </div>
        )}

        {(rec.bullInvalidation || rec.bearInvalidation) && (
          <div className="mb-3 px-3 py-2 rounded-lg space-y-1" style={{ background: "#0a0a0c" }}>
            <h4 className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Invalidation</h4>
            {rec.bullInvalidation && (
              <div className="flex gap-2">
                <span className="font-mono text-[9px] font-bold shrink-0" style={{ color: UP }}>BULL</span>
                <span className="font-mono text-[10px] text-zinc-300">{rec.bullInvalidation}</span>
              </div>
            )}
            {rec.bearInvalidation && (
              <div className="flex gap-2">
                <span className="font-mono text-[9px] font-bold shrink-0" style={{ color: DOWN }}>BEAR</span>
                <span className="font-mono text-[10px] text-zinc-300">{rec.bearInvalidation}</span>
              </div>
            )}
          </div>
        )}

        {onSendToOrder && (
          <button
            onClick={() => {
              const isCredit = rec.credit != null && rec.credit > 0;
              const netPrice = isCredit ? rec.credit! : (rec.debit ?? 0);
              const orderLegs = rec.legs.map(leg => ({
                schwabSymbol: buildOccSymbol(result.ticker, leg.expiration, leg.type, leg.strike),
                instruction: leg.side === "buy" ? "BUY_TO_OPEN" : "SELL_TO_OPEN",
                quantity: 1,
                optionType: leg.type.toUpperCase(),
                strike: leg.strike,
                expiration: leg.expiration,
                bid: leg.bid,
                ask: leg.ask,
                delta: leg.delta,
              }));
              onSendToOrder({ ticker: result.ticker, legs: orderLegs, netPrice, isCredit });
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-mono text-[12px] font-bold transition-all active:scale-[0.98] mb-3"
            style={{
              background: "linear-gradient(135deg, #f5a623, #ffce73)",
              color: "#000",
            }}
          >
            <Send className="w-3.5 h-3.5" />
            Send to Order
          </button>
        )}

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

            {ioScore && (
              <div className="space-y-2">
                <h4 className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">IOScore Breakdown</h4>
                {ioScore.available === false && (
                  <div className="font-mono text-[10px] text-amber-300 bg-amber-900/20 border border-amber-500/30 rounded px-2 py-1">
                    IOScore unavailable — insufficient SPY/{ioScore.dataAvailability?.equityDays ?? 0}d equity history to fit beta/R². Score below shown as N/A; underlying engine returned fallback values (rSquared=0.50, residualZ=0).
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <StatRow
                    label="Overall"
                    value={ioScore.available === false ? "N/A" : `${(ioScore.final * 100).toFixed(0)}%`}
                    color={ioScore.available === false ? "#71717a" : ioScore.classification === "HIGH_IDIOSYNCRATIC" ? UP : ioScore.classification === "MIXED" ? GOLD : "#71717a"}
                  />
                  <StatRow label="Classification" value={ioScore.available === false ? "N/A" : ioScore.classification.replace(/_/g, " ")} />
                  <StatRow label="R²" value={ioScore.available === false ? "N/A" : (ioScore.components?.marketIndependence?.rSquared?.toFixed(3) ?? "—")} />
                  <StatRow label="Beta" value={ioScore.available === false ? "N/A" : (ioScore.beta?.toFixed(2) ?? "—")} />
                  <StatRow label="Residual Z" value={ioScore.available === false ? "N/A" : (ioScore.residualReturnZScore?.toFixed(2) ?? "—")} />
                  <StatRow label="Catalyst" value={ioScore.components?.catalyst?.flagValue > 0 ? "YES" : "No"} color={ioScore.components?.catalyst?.flagValue > 0 ? UP : "#71717a"} />
                  <StatRow label="Flow Score" value={ioScore.components?.flowDivergence?.final?.toFixed(3) ?? "—"} />
                  <StatRow label="Vol/OI Ratio" value={ioScore.components?.flowDivergence?.volOiRatio?.toFixed(3) ?? "—"} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">Regime</h4>
              <div className="grid grid-cols-2 gap-2">
                <StatRow label="Conviction" value={regime.directionalConviction} />
                <StatRow label="Risk Level" value={regime.systemicRiskLevel} color={regime.systemicRiskLevel === "EXTREME" ? DOWN : regime.systemicRiskLevel === "ELEVATED" ? AMBER : UP} />
                <StatRow label="Correlation" value={regime.correlationRegime} />
                {regime.compositeScore != null && <StatRow label="Composite" value={regime.compositeScore.toFixed(1)} />}
                {regime.idioOpportunityFlag != null && <StatRow label="Idio Opportunity" value={regime.idioOpportunityFlag ? "YES" : "No"} color={regime.idioOpportunityFlag ? GOLD : "#71717a"} />}
              </div>
            </div>
          </div>
        )}
        {(result.recommendation?.contextSources ?? result.contextSources) && (
          <ContextSourcesBlock ctx={(result.recommendation?.contextSources ?? result.contextSources)!} />
        )}
      </div>
    </div>
  );
}

export function StrategistV2BlockCard({ result, generatedAt }: { result: StrategistV2Result; generatedAt?: string | number | null }) {
  const [expanded, setExpanded] = useState(false);
  const reason = normalizeBlockReason(result.blockReason);
  const categoryColor = reason ? CATEGORY_COLORS[reason.category] : "#71717a";
  const categoryLabel = reason ? CATEGORY_LABELS[reason.category] : (result.status === "toxic_block" ? "Toxic Block" : "No Viable Setup");

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" style={{ color: categoryColor }} />
            <span className="font-mono text-[13px] font-bold text-white">{result.ticker}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded" style={{
              background: `${categoryColor}1f`,
              color: categoryColor,
              border: `1px solid ${categoryColor}40`,
            }}>
              {categoryLabel}
            </span>
          </div>
          <CopyCardButton result={result} generatedAt={generatedAt} />
        </div>
        {generatedAt && (
          <div className="font-mono text-[9px] text-zinc-500 mb-2">Generated {new Date(generatedAt).toLocaleString()}</div>
        )}
        <div className="font-mono text-[11px] text-zinc-300 leading-relaxed">
          {reason?.detail ?? "No actionable setup found with current market conditions."}
        </div>
        {reason?.suggestedAction && (
          <div className="mt-2 px-2 py-1.5 rounded font-mono text-[10px] text-zinc-400 leading-relaxed" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="text-zinc-500 uppercase tracking-wider mr-1">Suggested:</span>
            {reason.suggestedAction}
          </div>
        )}

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
            {result.regime.compositeScore != null && <StatRow label="Composite" value={result.regime.compositeScore.toFixed(1)} />}
          </div>
        )}
        {result.contextSources && <ContextSourcesBlock ctx={result.contextSources} />}
      </div>
    </div>
  );
}

function isSafeHttpUrl(raw: string | undefined | null): boolean {
  if (!raw || typeof raw !== "string") return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function ContextSourcesBlock({ ctx }: { ctx: ContextSourcesPayload }) {
  const [expanded, setExpanded] = useState(false);
  // New schema (preferred). Falls back to legacy fields for historical records.
  const cat = ctx.catalyst;
  const newAlignment: CatalystAlignmentNew | null = cat ? cat.catalystAlignment : null;
  const alignmentColor =
    (newAlignment ?? ctx.catalystAlignment) === "ALIGNED" ? UP :
    (newAlignment ?? ctx.catalystAlignment) === "CONTRADICTS" ? DOWN :
    "#71717a";
  let headerLabel: string;
  let headerColor = alignmentColor;
  if (cat) {
    // Priority: NAME_SPECIFIC/BOTH in-window > residual > MACRO_ONLY > none.
    const scope = cat.catalystScope ?? (cat.catalystInWindow ? "NAME_SPECIFIC" : "NONE");
    const isNameSpecific = scope === "NAME_SPECIFIC" || scope === "BOTH";
    if (isNameSpecific) {
      headerLabel = `CATALYST IN WINDOW · ${cat.catalystType} · ${cat.catalystAlignment}`;
    } else if (cat.residualCatalyst) {
      headerLabel = `RESIDUAL · ${cat.residualCatalyst.type} · ${cat.residualCatalyst.daysSince}d AGO`;
      // Residuals carry directional information; keep alignment color.
    } else if (scope === "MACRO_ONLY" && cat.catalystInWindow) {
      headerLabel = `MACRO CATALYST · ${cat.catalystType} · ${cat.catalystDate ?? "n/a"}`;
      // Macro-only is ambient exposure, not idio edge — neutral chrome.
      headerColor = "#a16207"; // amber to flag macro-only exposure
    } else {
      headerLabel = "NO CATALYST IN WINDOW";
    }
  } else {
    // Legacy fallback for historical records persisted before the schema change.
    headerLabel = ctx.sameDayCatalyst
      ? `CATALYST · ${ctx.catalystAlignment ?? "NEUTRAL"}`
      : ctx.webSearchUsed ? "NO MATERIAL CATALYST" : "WEB SEARCH UNAVAILABLE";
  }
  const summary =
    cat?.catalystSummary ||
    ctx.catalystSummary ||
    (ctx.webSearchUsed ? `${ctx.queryCount} search${ctx.queryCount === 1 ? "" : "es"} · ${ctx.sources.length} source${ctx.sources.length === 1 ? "" : "s"}` : "Web search did not run");
  return (
    <div className="rounded-lg overflow-hidden mt-3" style={{ background: "#0d0d0f", border: "1px solid #1f1f22" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 gap-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ background: `${headerColor}20`, color: headerColor }}
          >
            {headerLabel}
          </span>
          <span className="font-mono text-[10px] text-zinc-400 truncate">
            {summary}
          </span>
        </div>
        {expanded ? <ChevronUp className="w-3 h-3 text-zinc-500 shrink-0" /> : <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {cat && (cat.scheduledEvents.length > 0 || cat.residualCatalyst) && (
            <div>
              <div className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-1">
                Catalyst Detail
              </div>
              <ul className="space-y-0.5">
                {cat.scheduledEvents.map((e, i) => (
                  <li key={`s${i}`} className="font-mono text-[10px] text-zinc-300">
                    · {e.date} — {e.type} — {e.title} <span className="text-zinc-600">[{e.source}]</span>
                  </li>
                ))}
                {cat.residualCatalyst && (
                  <li className="font-mono text-[10px] text-zinc-300">
                    · residual: {cat.residualCatalyst.type} fired {cat.residualCatalyst.daysSince}d ago ({cat.residualCatalyst.date})
                  </li>
                )}
              </ul>
            </div>
          )}
          {ctx.queries.length > 0 && (
            <div>
              <div className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-1">
                Search Queries ({ctx.queries.length})
              </div>
              <ul className="space-y-0.5">
                {ctx.queries.map((q, i) => (
                  <li key={i} className="font-mono text-[10px] text-zinc-400 truncate">
                    · {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ctx.sources.length > 0 && (
            <div>
              <div className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest mb-1">
                Sources Cited ({ctx.sources.length})
              </div>
              <ul className="space-y-1">
                {ctx.sources.slice(0, 8).map((s, i) => {
                  const safeUrl = isSafeHttpUrl(s.url) ? s.url : null;
                  const label = s.title || s.url || "(source)";
                  return (
                    <li key={i} className="font-mono text-[10px] text-zinc-300 leading-snug">
                      {safeUrl ? (
                        <a
                          href={safeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-white underline decoration-zinc-700 hover:decoration-white"
                        >
                          {label}
                        </a>
                      ) : (
                        <span>{label}</span>
                      )}
                      {s.date && <span className="text-zinc-600 ml-1">· {s.date}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!ctx.webSearchUsed && (
            <div className="font-mono text-[10px] text-zinc-500">
              The model did not invoke web search on this run. Thesis is based on the data payload only.
            </div>
          )}
        </div>
      )}
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
