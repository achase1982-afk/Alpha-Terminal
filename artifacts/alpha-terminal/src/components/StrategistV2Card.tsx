import { useState, useCallback, useMemo } from "react";
import {
  TrendingUp, TrendingDown, Minus, Shield,
  ChevronDown, ChevronUp, Send, Copy, Check, Activity, AlertCircle, RefreshCw,
} from "lucide-react";
import { strategistCardToPlainText } from "@/lib/strategistPlaintext";
import { isDeskStrategistTranscript } from "@/lib/strategistTranscriptDesk";

// Legacy (debate/IOScore semantic palette — used by sub-cards below the main body).
const GOLD = "#f5a623";
const UP = "#2ecc71";
const DOWN = "#ff4b5c";
const AMBER = "#f59e0b";

// Redesign palette — institutional-desk-note look. The mockup spec calls for
// these exact hex values; keep them in sync if the spec moves.
const PAL = {
  bgCard: "#141414",
  bgInner: "#0a0a0a",
  border: "#2a2a2a",
  borderInner: "#1f1f1f",
  label: "#a3a3a3",
  body: "#e5e5e5",
  white: "#ffffff",
  green: "#4ade80",
  red: "#f87171",
  gold: "#fbbf24",
  goldHeader: "#f59e0b",
  riskBorder: "#dc2626",
  cautionBorder: "#f59e0b",
  regimeBorder: "#7c5e0f",
  scopeTicker: "#93c5fd",
  scopeMacro: "#fbbf24",
};

const SYS_FONT = "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif";

// Defensive frontend sanitizer for any narrative text persisted before the
// backend cleanup landed. Strips Anthropic web-search citation wrappers
// (<cite index="0-1">x</cite>, self-closing variants) and repairs malformed
// multi-dot decimals like "4.05/4.2.335" that occasionally slip through.
export function sanitizeNarrative(s: string | undefined | null): string {
  if (!s) return "";
  let out = String(s);
  out = out.replace(/<cite\s[^>]*\/>/gi, "");
  out = out.replace(/<cite\s[^>]*>([\s\S]*?)<\/cite>/gi, "$1");
  out = out.replace(/<\/?cite[^>]*>/gi, "");
  out = out.replace(/(\d+\.\d+)\.(\d+)\b/g, "$1 $2");
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

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
  | "EARNINGS_INSIDE_EXPIRY"
  | "UNKNOWN"
  | "ECONOMICS_MISMATCH"
  | "UNKNOWN_STRUCTURE"
  | "NO_TRADE"
  | "ANALYSIS_INCOMPLETE";

export type StrategistOutcome =
  | "ECONOMICS_MISMATCH"
  | "UNKNOWN_STRUCTURE"
  | "NO_TRADE"
  | "ANALYSIS_INCOMPLETE";

export interface BlockReason {
  category: RejectionCategory;
  detail: string;
  suggestedAction?: string;
  outcomeMeta?: {
    aiMaxRisk?: number;
    computedMaxLoss?: number;
    attemptedStructure?: string;
    recognizedStructureTypes?: string;
    incompleteRole?: string;
  };
}

export function normalizeBlockReason(raw: BlockReason | string | undefined | null): BlockReason | null {
  if (!raw) return null;
  if (typeof raw === "string") return { category: "UNKNOWN", detail: raw };
  if (typeof raw === "object" && raw !== null && typeof Reflect.get(raw, "category") === "string" && typeof Reflect.get(raw, "detail") === "string") {
    return raw as BlockReason;
  }
  return { category: "UNKNOWN", detail: String(raw) };
}

const CATEGORY_LABELS: Record<RejectionCategory, string> = {
  TOXIC_BLOCK: "Toxic Block",
  LOW_CONFIDENCE: "Low Confidence",
  NO_EDGE: "No Edge",
  CATALYST_CONFLICT: "Catalyst Conflict",
  VALIDATION_FAIL: "Validation Issue",
  MISSING_DATA: "Missing Data",
  STOCK_HALTED: "Stock Halted",
  PRICING_MARKET_CLOSED: "Market Closed",
  EARNINGS_INSIDE_EXPIRY: "Earnings Window",
  UNKNOWN: "Blocked",
  ECONOMICS_MISMATCH: "Pricing Mismatch",
  UNKNOWN_STRUCTURE: "Unrecognized Structure",
  NO_TRADE: "No Trade",
  ANALYSIS_INCOMPLETE: "Analysis Incomplete",
};

const CATEGORY_COLORS: Record<RejectionCategory, string> = {
  TOXIC_BLOCK: "#ff4b5c",
  LOW_CONFIDENCE: "#71717a",
  NO_EDGE: "#71717a",
  CATALYST_CONFLICT: "#f59e0b",
  VALIDATION_FAIL: "#a1a1aa",
  MISSING_DATA: "#71717a",
  STOCK_HALTED: "#ff4b5c",
  PRICING_MARKET_CLOSED: "#71717a",
  EARNINGS_INSIDE_EXPIRY: "#f59e0b",
  UNKNOWN: "#71717a",
  ECONOMICS_MISMATCH: "#f59e0b",
  UNKNOWN_STRUCTURE: "#f59e0b",
  NO_TRADE: "#a3a3a3",
  ANALYSIS_INCOMPLETE: "#f59e0b",
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
  status: "recommendation" | "no_viable_setup" | "toxic_block" | "ivr_populating" | "failed_insufficient_history" | "desk_recommendation";
  ticker: string;
  deskResult?: unknown;
  ivrBackfill?: {
    jobId: string | null;
    status: "queued" | "running" | "completed" | "failed" | "failed_insufficient_history";
    daysLoaded: number;
    daysRequested: number;
    message: string;
    /** Present when status is failed (e.g. poll payload from ivr_backfill_jobs). */
    errorMsg?: string | null;
  };
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
  strategistDiagnosticRequestId?: string;
  /** Compact desk projection from the server (shareable); optional on older cards. */
  diagnosticView?: Record<string, unknown>;
  earningsAlert?: {
    earningsDate: string;
    daysUntilEarnings: number | null;
    daysUntilExpiry: number;
    insideExpiry: boolean;
    behavior: "BLOCK" | "WARN" | "IGNORE";
    source: "vendor_primary" | "yahoo" | null;
    confirmed: boolean;
  };
  /**
   * Optional structured debate transcript stashed alongside the result when
   * Debate mode produced this card. Populated by /thinking poll merge and
   * persisted via cardJson on history rows. Empty/undefined for Solo mode.
   */
  debateTranscript?: Array<{
    id?: string;
    round: 1 | 2 | 3 | "synthesis" | "desk";
    role: "A" | "B" | "synthesis" | "system" | "vol" | "flow" | "catalyst" | "pm";
    phase: string;
    model: string;
    label: string;
    text: string;
  }>;
  strategistOutcome?: StrategistOutcome;
  /** Present on some no_viable_setup rows when server returned structured telemetry extras */
  fetchFailureMode?: "token_null" | "http_fail" | "symbol_missing" | "network_exception" | string;
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

export function buildOccSymbol(ticker: string, expiration: string, type: string, strike: number): string {
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
    /** Omitted when opening from desk mode without live quotes. */
    bid?: number;
    ask?: number;
    delta?: number;
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

// ====================================================================
// Strategist V2 — institutional desk-note redesign
// ====================================================================
//
// Layout principles (per redesign spec):
//   • No tinted backgrounds anywhere. Section distinction comes from
//     dividers + colored LEFT borders only.
//   • White (#ffffff) values on near-black; muted gray (#a3a3a3) labels.
//   • Min body 14px, values 15-17px, headers 11-13px uppercase tracked.
//   • Semantic colors: green = bullish/profit, red = bearish/loss,
//     yellow/gold = caution / macro / section headers.
//   • System sans (SF Pro / Inter) — institutional, not terminal-mono.
//
// Section order (locked):
//   1. Header (ticker + dir tag + confidence + strategy + copy + ts)
//   2. Stats row (Debit / Max Profit / Max Loss / R:R)
//   3. Company  4. Thesis
//   5. Legs (EXPANDED by default — no toggle)
//   6. Economics  7. Exit Plan  8. Invalidation
//   9. Risk of Ruin (red left border)  10. Caution (gold left border)
//   11. SEND TO ORDER (full-width orange)
//   12. IOScore (gray border, "Per-Ticker")
//   13. Macro Regime (gold border NO tint, "Session-Wide")
//   14. Context (catalyst chip + sources)
//   15. Debate Transcript (only if debate mode produced this card)

// ---- Tiny presentational primitives -------------------------------

function Section({
  title,
  children,
  noBorder = false,
}: {
  title?: string;
  children: React.ReactNode;
  noBorder?: boolean;
}) {
  return (
    <div
      className="px-5 py-[18px]"
      style={noBorder ? undefined : { borderBottom: `1px solid ${PAL.border}` }}
    >
      {title && (
        <div
          className="mb-3"
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "1.5px",
            color: PAL.goldHeader,
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function StatBlock({ value, label, tone }: { value: string; label: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? PAL.green : tone === "red" ? PAL.red : PAL.white;
  return (
    <div className="text-center flex-1">
      <div style={{ fontSize: 18, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div
        style={{
          fontSize: 10,
          color: PAL.label,
          fontWeight: 600,
          letterSpacing: "0.8px",
          textTransform: "uppercase",
          marginTop: 3,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function EconRow({
  label,
  value,
  tone,
  isLast,
}: {
  label: string;
  value: string;
  tone?: "green" | "red";
  isLast?: boolean;
}) {
  const color = tone === "green" ? PAL.green : tone === "red" ? PAL.red : PAL.white;
  return (
    <div
      className="flex justify-between items-baseline py-2"
      style={{ borderBottom: isLast ? "none" : `1px solid ${PAL.borderInner}` }}
    >
      <span
        style={{
          fontSize: 13,
          color: PAL.label,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 17, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function LeftBorderBlock({
  borderColor,
  labelText,
  labelColor,
  children,
}: {
  borderColor: string;
  labelText: string;
  labelColor: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderLeft: `4px solid ${borderColor}`, paddingLeft: 16, paddingTop: 2, paddingBottom: 2 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "1px",
          color: labelColor,
          marginBottom: 8,
          textTransform: "uppercase",
        }}
      >
        {labelText}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: PAL.white }}>{children}</div>
    </div>
  );
}

function IoRow({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" | "yellow" }) {
  const color =
    tone === "green" ? PAL.green : tone === "red" ? PAL.red : tone === "yellow" ? PAL.gold : PAL.white;
  return (
    <div className="flex flex-col gap-1 py-2" style={{ borderBottom: `1px solid ${PAL.borderInner}` }}>
      <span
        style={{
          fontSize: 11,
          color: PAL.label,
          fontWeight: 600,
          letterSpacing: "0.8px",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

// Format an YYYY-MM-DD or ISO expiration to "Mon DD, YYYY"; falls back to raw.
function formatExpiry(raw: string): string {
  if (!raw) return raw;
  const clean = raw.split(":")[0].trim();
  const d = new Date(clean.length === 10 ? `${clean}T12:00:00` : clean);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function StrategistV2RecommendationCard({
  result,
  onSendToOrder,
  generatedAt,
}: {
  result: StrategistV2Result;
  onSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
  generatedAt?: string | number | null;
}) {
  const { recommendation: rec, regime, ioScore, systemicRiskElevated } = result;
  if (!rec) return null;

  const earningsAlert = result.earningsAlert;
  const showEarningsBanner = earningsAlert && earningsAlert.behavior === "WARN" && earningsAlert.insideExpiry;

  const stratLabel =
    STRAT_LABELS[rec.strategyType] ??
    rec.strategyType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const isCredit = rec.credit != null && rec.credit > 0;
  const confidence = rec.confidence ?? 0;
  const dirColor =
    rec.direction === "BULLISH" ? PAL.green : rec.direction === "BEARISH" ? PAL.red : PAL.gold;
  const dirArrow =
    rec.direction === "BULLISH" ? "↗" : rec.direction === "BEARISH" ? "↘" : "→";
  const cardBorder = systemicRiskElevated ? PAL.cautionBorder : PAL.border;

  const debit = ((isCredit ? rec.credit : rec.debit) ?? 0).toFixed(2);
  const fillRange =
    rec.entryRangeMin != null && rec.entryRangeMax != null
      ? `$${Math.abs(rec.entryRangeMin).toFixed(2)} – $${Math.abs(rec.entryRangeMax).toFixed(2)}`
      : "—";

  const ctx = result.recommendation?.contextSources ?? result.contextSources;
  const transcript = result.debateTranscript;
  const isDeskTranscript =
    !!transcript &&
    transcript.length > 0 &&
    isDeskStrategistTranscript(transcript as import("@/lib/store").StrategistTranscriptTurn[]);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: PAL.bgCard,
        border: `1px solid ${cardBorder}`,
        fontFamily: SYS_FONT,
        color: PAL.white,
      }}
    >
      {/* ---- HEADER ---- */}
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${PAL.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px", color: PAL.white }}>
              {result.ticker}
            </span>
            <span
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.5px",
                color: dirColor,
                border: `1px solid ${dirColor}`,
                lineHeight: 1,
              }}
            >
              {dirArrow} {rec.direction}
            </span>
          </div>
          {confidence > 0 && (
            <div className="text-right">
              <div style={{ fontSize: 24, fontWeight: 800, color: PAL.white, lineHeight: 1 }}>{confidence}</div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: PAL.label,
                  letterSpacing: "1px",
                  marginTop: 4,
                  textTransform: "uppercase",
                }}
              >
                Confidence
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-between items-center" style={{ marginTop: 4 }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: PAL.body }}>{stratLabel}</span>
          <CopyCardButton result={result} generatedAt={generatedAt} />
        </div>
        {generatedAt && (
          <div style={{ fontSize: 13, color: PAL.label, marginTop: 8 }}>
            Generated {new Date(generatedAt).toLocaleString()}
          </div>
        )}
      </div>

      {/* Earnings safety banner (kept — operationally critical) */}
      {showEarningsBanner && earningsAlert && (
        <div
          className="px-5 py-3 flex items-start gap-3"
          style={{ borderBottom: `1px solid ${PAL.border}`, borderLeft: `4px solid ${PAL.cautionBorder}` }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, color: PAL.gold }}>⚠</span>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 13, fontWeight: 700, color: PAL.gold, textTransform: "uppercase", letterSpacing: "1px" }}>
              Earnings inside expiry
            </div>
            <div style={{ fontSize: 14, color: PAL.white, marginTop: 4, lineHeight: 1.5 }}>
              {earningsAlert.confirmed ? "Confirmed" : "Estimated"} earnings on{" "}
              <strong>{earningsAlert.earningsDate}</strong>
              {earningsAlert.daysUntilEarnings != null && <> (in {earningsAlert.daysUntilEarnings}d)</>} — falls
              inside the {earningsAlert.daysUntilExpiry}-DTE expiry. Position will hold through earnings.
            </div>
          </div>
        </div>
      )}

      {/* ---- 2. STATS ROW ---- */}
      <div
        className="flex items-center px-4 py-[14px]"
        style={{ background: PAL.bgCard, borderBottom: `1px solid ${PAL.border}` }}
      >
        <StatBlock value={`$${debit}`} label={isCredit ? "Credit" : "Debit"} />
        <div style={{ width: 1, height: 32, background: PAL.border }} />
        <StatBlock value={`$${rec.maxProfit.toFixed(0)}`} label="Max Profit" tone="green" />
        <div style={{ width: 1, height: 32, background: PAL.border }} />
        <StatBlock value={`$${rec.maxLoss.toFixed(0)}`} label="Max Loss" tone="red" />
        <div style={{ width: 1, height: 32, background: PAL.border }} />
        <StatBlock value={`${rec.riskReward.toFixed(2)}:1`} label="R:R" />
      </div>

      {/* ---- 3. COMPANY ---- */}
      {rec.companyContext && (
        <Section title="Company">
          <div style={{ fontSize: 15, lineHeight: 1.55, color: PAL.body }}>
            {sanitizeNarrative(rec.companyContext)}
          </div>
        </Section>
      )}

      {/* ---- 4. THESIS ---- */}
      <Section title="Thesis">
        <div style={{ fontSize: 15, lineHeight: 1.6, color: PAL.body }}>
          {sanitizeNarrative(rec.thesis || rec.rationale)}
        </div>
        {rec.edgeAttribution && (
          <div style={{ fontSize: 13, lineHeight: 1.5, color: PAL.label, marginTop: 10, fontStyle: "italic" }}>
            {sanitizeNarrative(rec.edgeAttribution)}
          </div>
        )}
      </Section>

      {/* ---- 5. LEGS (always expanded) ---- */}
      <Section title="Legs">
        <div>
          {rec.legs.map((leg, i) => {
            const isLast = i === rec.legs.length - 1;
            const sideColor = leg.side === "buy" ? PAL.green : PAL.red;
            return (
              <div
                key={i}
                className="py-[14px]"
                style={{ borderBottom: isLast ? "none" : `1px solid ${PAL.borderInner}` }}
              >
                <div className="flex items-center gap-3">
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "1px",
                      color: sideColor,
                      width: 40,
                    }}
                  >
                    {leg.side.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: PAL.white }}>
                    ${leg.strike} {leg.type.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 13, color: PAL.label, fontWeight: 500 }}>
                    {formatExpiry(leg.expiration)}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 17,
                      fontWeight: 700,
                      color: PAL.white,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    ${leg.mid.toFixed(2)}
                  </span>
                </div>
                <div style={{ paddingLeft: 52, marginTop: 4, fontSize: 13, color: PAL.label }}>
                  Delta <strong style={{ color: PAL.body, fontWeight: 600 }}>{leg.delta.toFixed(2)}</strong>{" "}
                  · Open Interest{" "}
                  <strong style={{ color: PAL.body, fontWeight: 600 }}>
                    {leg.openInterest.toLocaleString()}
                  </strong>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- 6. ECONOMICS ---- */}
      <Section title="Economics">
        <EconRow label={isCredit ? "Credit" : "Debit"} value={`$${debit}`} />
        <EconRow label="Fill Range" value={fillRange} />
        <EconRow label="Max Profit" value={`$${rec.maxProfit.toFixed(0)}`} tone="green" />
        <EconRow label="Max Loss" value={`$${rec.maxLoss.toFixed(0)}`} tone="red" />
        <EconRow label="Breakeven" value={`$${rec.breakeven.toFixed(2)}`} />
        <EconRow label="Days to Expiration" value={`${rec.dte} days`} isLast />
      </Section>

      {/* ---- 7. EXIT PLAN ---- */}
      {rec.exitTargets &&
        (rec.exitTargets.profitTarget > 0 ||
          rec.exitTargets.stopLoss > 0 ||
          rec.exitTargets.timeStop) && (
          <Section title="Exit Plan">
            {rec.exitTargets.profitTarget > 0 && (
              <div
                className="flex justify-between items-baseline py-[10px]"
                style={{ borderBottom: `1px solid ${PAL.borderInner}` }}
              >
                <div>
                  <div style={{ fontSize: 14, color: PAL.body, fontWeight: 600 }}>Profit Target</div>
                  {rec.exitTargets.profitTargetUnderlying > 0 && (
                    <div style={{ fontSize: 12, color: PAL.label, fontWeight: 500, marginTop: 2 }}>
                      At underlying ${rec.exitTargets.profitTargetUnderlying.toFixed(2)}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: PAL.green, fontVariantNumeric: "tabular-nums" }}>
                    ${rec.exitTargets.profitTarget.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 12, color: PAL.label, fontWeight: 500, marginTop: 2 }}>
                    ${Math.round(rec.exitTargets.profitTarget * 100)} / lot
                  </div>
                </div>
              </div>
            )}
            {rec.exitTargets.stopLoss > 0 && (
              <div
                className="flex justify-between items-baseline py-[10px]"
                style={{ borderBottom: `1px solid ${PAL.borderInner}` }}
              >
                <div>
                  <div style={{ fontSize: 14, color: PAL.body, fontWeight: 600 }}>Stop Loss</div>
                  {rec.exitTargets.stopLossUnderlying > 0 && (
                    <div style={{ fontSize: 12, color: PAL.label, fontWeight: 500, marginTop: 2 }}>
                      At underlying ${rec.exitTargets.stopLossUnderlying.toFixed(2)}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: PAL.red, fontVariantNumeric: "tabular-nums" }}>
                    ${rec.exitTargets.stopLoss.toFixed(2)}
                  </div>
                  <div style={{ fontSize: 12, color: PAL.label, fontWeight: 500, marginTop: 2 }}>
                    ${Math.round(rec.exitTargets.stopLoss * 100)} / lot
                  </div>
                </div>
              </div>
            )}
            {rec.exitTargets.timeStop && (
              <div className="flex justify-between items-baseline py-[10px]">
                <div style={{ fontSize: 14, color: PAL.body, fontWeight: 600 }}>Time Stop</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: PAL.gold }}>{rec.exitTargets.timeStop}</div>
              </div>
            )}
          </Section>
        )}

      {/* ---- 8. INVALIDATION ---- */}
      {(rec.bullInvalidation || rec.bearInvalidation) && (
        <Section title="Invalidation">
          <div className="space-y-[14px]">
            {rec.bullInvalidation && (
              <LeftBorderBlock borderColor={PAL.green} labelText="BULL" labelColor={PAL.green}>
                {sanitizeNarrative(rec.bullInvalidation)}
              </LeftBorderBlock>
            )}
            {rec.bearInvalidation && (
              <LeftBorderBlock borderColor={PAL.red} labelText="BEAR" labelColor={PAL.red}>
                {sanitizeNarrative(rec.bearInvalidation)}
              </LeftBorderBlock>
            )}
          </div>
        </Section>
      )}

      {/* ---- 9. RISK OF RUIN ---- */}
      {rec.riskOfRuin && (
        <Section>
          <LeftBorderBlock borderColor={PAL.riskBorder} labelText="⚠ Risk of Ruin" labelColor={PAL.red}>
            {sanitizeNarrative(rec.riskOfRuin)}
          </LeftBorderBlock>
        </Section>
      )}

      {/* ---- 10. CAUTION ---- */}
      {rec.warnings && (
        <Section>
          <LeftBorderBlock borderColor={PAL.cautionBorder} labelText="⚡ Caution" labelColor={PAL.gold}>
            {sanitizeNarrative(rec.warnings)}
          </LeftBorderBlock>
        </Section>
      )}

      {/* ---- 11. SEND TO ORDER ---- */}
      {onSendToOrder && (
        <div className="px-5 py-5" style={{ background: PAL.bgInner }}>
          <button
            onClick={() => {
              const credit = rec.credit != null && rec.credit > 0;
              const netPrice = credit ? rec.credit! : rec.debit ?? 0;
              const orderLegs = rec.legs.map((leg) => ({
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
              onSendToOrder({ ticker: result.ticker, legs: orderLegs, netPrice, isCredit: credit });
            }}
            className="w-full transition-all active:scale-[0.99] flex items-center justify-center gap-2"
            style={{
              padding: 18,
              background: PAL.cautionBorder,
              color: PAL.bgInner,
              border: "none",
              borderRadius: 12,
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: "0.5px",
              cursor: "pointer",
            }}
          >
            <Send className="w-4 h-4" /> SEND TO ORDER
          </button>
        </div>
      )}

      {/* ---- 12. IOSCORE ---- */}
      {ioScore && (
        <Section>
          <IoScoreCard ioScore={ioScore} />
        </Section>
      )}

      {/* ---- 13. MACRO REGIME ---- */}
      <Section>
        <RegimeCard regime={regime} />
      </Section>

      {/* ---- 14. CONTEXT ---- */}
      {ctx && <ContextSourcesBlock ctx={ctx} />}

      {/* ---- 15. TRANSCRIPT (Debate or Desk) ---- */}
      {transcript && transcript.length > 0 && (
        <Section title={isDeskTranscript ? "Desk Transcript" : "Debate Transcript"} noBorder>
          <DebateTranscriptInline transcript={transcript} />
        </Section>
      )}
    </div>
  );
}

// ---- IOScore + Regime sub-cards (clean borders, no tints) ---------

function IoScoreCard({ ioScore }: { ioScore: NonNullable<StrategistV2Result["ioScore"]> }) {
  const compositePct = (ioScore.final ?? 0.5) * 100;
  const ambiguousBand = Math.abs(compositePct - 50) <= 3;
  const ioUnavailable = ioScore.available === false || ambiguousBand;
  const reasonText =
    ioScore.available === false
      ? `IOScore unavailable — insufficient SPY/${ioScore.dataAvailability?.equityDays ?? 0}d equity history to fit beta/R². Score below shown as N/A; underlying engine returned fallback values.`
      : `IOScore inconclusive — Composite ${compositePct.toFixed(1)} is within 3 points of the 50.0 neutral midpoint. Treat as no idiosyncratic edge.`;
  const idioPct = Math.round(ioScore.final * 100);
  const macroPct = 100 - idioPct;
  const classTone: "green" | "yellow" | undefined =
    ioScore.classification === "HIGH_IDIOSYNCRATIC" ? "green" : ioScore.classification === "MIXED" ? "yellow" : undefined;

  return (
    <div
      style={{
        background: PAL.bgCard,
        border: `1px solid ${PAL.border}`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "1px",
            color: PAL.body,
            textTransform: "uppercase",
          }}
        >
          IOScore Breakdown
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: PAL.scopeTicker,
          }}
        >
          Per-Ticker
        </span>
      </div>
      <div style={{ fontSize: 12, color: PAL.label, marginBottom: 14, fontStyle: "italic" }}>
        This analysis only
      </div>
      {ioUnavailable && (
        <div
          style={{
            fontSize: 13,
            color: PAL.gold,
            border: `1px solid ${PAL.cautionBorder}`,
            borderRadius: 6,
            padding: "8px 10px",
            marginBottom: 12,
            lineHeight: 1.45,
          }}
        >
          {reasonText}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-5">
        <IoRow label="Overall" value={ioUnavailable ? "N/A" : `${idioPct}%`} />
        <IoRow
          label="Classification"
          value={ioUnavailable ? "N/A" : ioScore.classification.replace(/_/g, " ")}
          tone={ioUnavailable ? undefined : classTone}
        />
        <IoRow label="Idiosyncratic %" value={ioUnavailable ? "N/A" : `${idioPct}%`} tone={ioUnavailable ? undefined : "yellow"} />
        <IoRow label="Macro %" value={ioUnavailable ? "N/A" : `${macroPct}%`} />
        <IoRow label="R²" value={ioUnavailable ? "N/A" : ioScore.components?.marketIndependence?.rSquared?.toFixed(3) ?? "—"} />
        <IoRow label="Beta" value={ioUnavailable ? "N/A" : ioScore.beta?.toFixed(2) ?? "—"} />
        <IoRow label="Residual Z" value={ioUnavailable ? "N/A" : ioScore.residualReturnZScore?.toFixed(2) ?? "—"} />
        <IoRow
          label="Catalyst"
          value={(ioScore.components?.catalyst?.flagValue ?? 0) > 0 ? "Yes" : "No"}
          tone={(ioScore.components?.catalyst?.flagValue ?? 0) > 0 ? "green" : undefined}
        />
        <IoRow label="Flow Score" value={ioScore.components?.flowDivergence?.final?.toFixed(3) ?? "—"} />
        <IoRow label="Vol/OI Ratio" value={ioScore.components?.flowDivergence?.volOiRatio?.toFixed(3) ?? "—"} />
      </div>
    </div>
  );
}

function RegimeCard({ regime }: { regime: StrategistV2Result["regime"] }) {
  const riskTone: "green" | "red" | "yellow" | undefined =
    regime.systemicRiskLevel === "EXTREME"
      ? "red"
      : regime.systemicRiskLevel === "ELEVATED"
      ? "yellow"
      : regime.systemicRiskLevel === "LOW"
      ? "green"
      : undefined;
  const convTone: "green" | "red" | "yellow" | undefined = regime.directionalConviction
    ?.toUpperCase()
    .includes("BULL")
    ? "green"
    : regime.directionalConviction?.toUpperCase().includes("BEAR")
    ? "red"
    : undefined;
  return (
    <div
      style={{
        background: PAL.bgCard,
        border: `1px solid ${PAL.regimeBorder}`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "1px",
            color: PAL.gold,
            textTransform: "uppercase",
          }}
        >
          Macro Regime
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: PAL.scopeMacro,
          }}
        >
          Session-Wide
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#a38550", marginBottom: 14, fontStyle: "italic" }}>
        Same across all tickers this session
      </div>
      <div className="grid grid-cols-2 gap-x-5">
        <IoRow label="Conviction" value={regime.directionalConviction.replace(/_/g, " ")} tone={convTone} />
        <IoRow label="Risk Level" value={regime.systemicRiskLevel} tone={riskTone} />
        <IoRow label="Correlation" value={regime.correlationRegime} />
        {regime.compositeScore != null && (
          <IoRow label="Composite" value={regime.compositeScore.toFixed(1)} />
        )}
        {regime.idioOpportunityFlag != null && (
          <IoRow
            label="Idio Opportunity"
            value={regime.idioOpportunityFlag ? "Yes" : "No"}
            tone={regime.idioOpportunityFlag ? "yellow" : undefined}
          />
        )}
      </div>
    </div>
  );
}

// ---- Debate transcript (human-readable prose) ---------------------

type TranscriptTurnInline = NonNullable<StrategistV2Result["debateTranscript"]>[number];

function tryParseTurnJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const stripped = raw.replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(stripped.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asString(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : "")).filter(Boolean);
  return [];
}

function DebateRoundHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 800,
        color: PAL.gold,
        letterSpacing: "1px",
        textTransform: "uppercase",
        margin: "18px 0 12px",
        paddingBottom: 8,
        borderBottom: `1px solid ${PAL.border}`,
      }}
    >
      {children}
    </div>
  );
}

function EvidenceLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: PAL.label,
        letterSpacing: "1px",
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function DebateBlock({
  side,
  label,
  children,
}: {
  side: "bull" | "bear" | "synthesis";
  label: string;
  children: React.ReactNode;
}) {
  const color = side === "bull" ? PAL.green : side === "bear" ? PAL.red : PAL.gold;
  return (
    <div style={{ marginBottom: 18, paddingLeft: 16, borderLeft: `3px solid ${color}` }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.5px",
          marginBottom: 10,
          textTransform: "uppercase",
          color,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const DESK_ROLE_META: Record<string, { label: string; border: string }> = {
  vol: { label: "Volatility", border: "#fbbf24" },
  flow: { label: "Flow", border: "#38bdf8" },
  catalyst: { label: "Catalyst", border: "#a78bfa" },
  pm: { label: "Decision", border: "#4ade80" },
};

function DeskTranscriptInline({ transcript }: { transcript: TranscriptTurnInline[] }) {
  const turns = useMemo(() => {
    const desk = transcript.filter((t) => t.round === "desk");
    const o = (r: string) =>
      r === "vol" ? 0 : r === "flow" ? 1 : r === "catalyst" ? 2 : r === "pm" ? 3 : 99;
    return [...desk].sort((a, b) => o(String(a.role)) - o(String(b.role)));
  }, [transcript]);

  return (
    <div>
      <DebateRoundHeader>Desk — Volatility, Flow, Catalyst, Decision</DebateRoundHeader>
      {turns.map((t) => {
        const meta = DESK_ROLE_META[String(t.role)] ?? { label: String(t.role), border: PAL.label };
        return (
          <div key={t.id ?? t.label} style={{ marginBottom: 18, paddingLeft: 16, borderLeft: `3px solid ${meta.border}` }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: "0.5px",
                marginBottom: 10,
                textTransform: "uppercase",
                color: meta.border,
              }}
            >
              {meta.label}
            </div>
            <pre
              style={{
                fontSize: 12,
                lineHeight: 1.55,
                color: PAL.body,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {(() => {
                const parsed = tryParseTurnJson(t.text);
                return parsed ? JSON.stringify(parsed, null, 2) : t.text || "—";
              })()}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function DebateTranscriptInline({ transcript }: { transcript: TranscriptTurnInline[] }) {
  if (isDeskStrategistTranscript(transcript as import("@/lib/store").StrategistTranscriptTurn[])) {
    return <DeskTranscriptInline transcript={transcript} />;
  }
  // Group by round so we can interleave round headers + verdict box correctly.
  const grouped = useMemo(() => {
    const byRound = new Map<1 | 2 | 3 | "synthesis" | "solo" | "desk", TranscriptTurnInline[]>();
    for (const t of transcript) {
      const arr = byRound.get(t.round) ?? [];
      arr.push(t);
      byRound.set(t.round, arr);
    }
    return byRound;
  }, [transcript]);

  const round1 = grouped.get(1) ?? [];
  const round2 = grouped.get(2) ?? [];
  const round3 = grouped.get(3) ?? [];
  const synth = grouped.get("synthesis") ?? [];

  const r1Bull = round1.find((t) => t.role === "A");
  const r1Bear = round1.find((t) => t.role === "B");
  const r2Bull = round2.find((t) => t.role === "A");
  const r2Bear = round2.find((t) => t.role === "B");
  const verdictTurn = round2.find((t) => t.role === "system" && t.phase === "info");
  const r3Bull = round3.find((t) => t.role === "A");
  const r3Bear = round3.find((t) => t.role === "B");
  const synthTurn = synth.find((t) => t.role === "synthesis");

  return (
    <div>
      {(r1Bull || r1Bear) && <DebateRoundHeader>Round 1 · Opening Theses</DebateRoundHeader>}
      {r1Bull && <Round1Side turn={r1Bull} side="bull" />}
      {r1Bear && <Round1Side turn={r1Bear} side="bear" />}

      {(r2Bull || r2Bear) && <DebateRoundHeader>Round 2 · Rebuttals</DebateRoundHeader>}
      {r2Bull && <Round2Side turn={r2Bull} side="bull" />}
      {r2Bear && <Round2Side turn={r2Bear} side="bear" />}

      {verdictTurn && <VerdictBox turn={verdictTurn} />}

      {(r3Bull || r3Bear) && <DebateRoundHeader>Round 3 · Structure Proposals</DebateRoundHeader>}
      {r3Bull && <Round3Side turn={r3Bull} side="bull" />}
      {r3Bear && <Round3Side turn={r3Bear} side="bear" />}

      {synthTurn && <SynthesisBox turn={synthTurn} />}
    </div>
  );
}

function Round1Side({ turn, side }: { turn: TranscriptTurnInline; side: "bull" | "bear" }) {
  const json = tryParseTurnJson(turn.text);
  const conf = asInt(json?.confidence);
  const thesis = asString(json?.thesis) || asString(json?.directional_thesis);
  const evidence = asStringList(json?.keyEvidence ?? json?.key_evidence);
  const risk = asString(json?.biggestRisk ?? json?.biggest_risk);
  const labelBase = side === "bull" ? "Bull Case" : "Bear Case";
  const label = conf != null ? `${labelBase} · ${conf}% Confidence` : labelBase;
  return (
    <DebateBlock side={side} label={label}>
      {thesis ? (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: PAL.white, marginBottom: 12 }}>{thesis}</div>
      ) : (
        <div style={{ fontSize: 14, color: PAL.label, marginBottom: 12 }}>(no thesis)</div>
      )}
      {evidence.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${PAL.border}` }}>
          <EvidenceLabel>Key Evidence</EvidenceLabel>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {evidence.map((e, i) => (
              <li
                key={i}
                style={{
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: PAL.white,
                  paddingLeft: 16,
                  position: "relative",
                  marginBottom: 6,
                }}
              >
                <span style={{ position: "absolute", left: 0, color: PAL.label }}>—</span>
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
      {risk && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${PAL.border}` }}>
          <EvidenceLabel>Biggest Risk</EvidenceLabel>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: PAL.white }}>{risk}</div>
        </div>
      )}
    </DebateBlock>
  );
}

function Round2Side({ turn, side }: { turn: TranscriptTurnInline; side: "bull" | "bear" }) {
  const json = tryParseTurnJson(turn.text);
  const revised = asInt(json?.revisedConfidence ?? json?.revised_confidence);
  const rebuttal = asString(json?.rebuttal);
  const concession = asString(json?.concession);
  const labelBase = side === "bull" ? "Bull Rebuttal" : "Bear Rebuttal";
  const label = revised != null ? `${labelBase} · Revised to ${revised}%` : labelBase;
  return (
    <DebateBlock side={side} label={label}>
      {rebuttal ? (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: PAL.white, marginBottom: 12 }}>{rebuttal}</div>
      ) : (
        <div style={{ fontSize: 14, color: PAL.label, marginBottom: 12 }}>(no rebuttal)</div>
      )}
      {concession && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${PAL.border}` }}>
          <EvidenceLabel>Concession</EvidenceLabel>
          <div style={{ fontSize: 14, lineHeight: 1.5, color: PAL.white }}>{concession}</div>
        </div>
      )}
    </DebateBlock>
  );
}

function VerdictBox({ turn }: { turn: TranscriptTurnInline }) {
  const json = tryParseTurnJson(turn.text);
  const verdict = asString(json?.verdict).toUpperCase();
  const bull = asInt(json?.bullConfidence ?? json?.bull_confidence);
  const bear = asInt(json?.bearConfidence ?? json?.bear_confidence);
  const delta = asInt(json?.delta);
  const tieBand = asInt(json?.tieBand ?? json?.tie_band);
  const verdictColor =
    verdict === "BULLISH" ? PAL.green : verdict === "BEARISH" ? PAL.red : PAL.gold;
  return (
    <div
      style={{
        margin: "18px 0",
        padding: 16,
        border: `1px solid ${PAL.regimeBorder}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: PAL.gold,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Verdict
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: verdictColor,
          letterSpacing: "-0.5px",
          marginBottom: 14,
        }}
      >
        {verdict || "—"}
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-[10px]" style={{ marginBottom: 14 }}>
        <VerdictRow k="Bull Confidence" v={bull != null ? String(bull) : "—"} tone="green" />
        <VerdictRow k="Bear Confidence" v={bear != null ? String(bear) : "—"} tone="red" />
        <VerdictRow k="Delta" v={delta != null ? `${delta} points` : "—"} />
        <VerdictRow k="Tie Band" v={tieBand != null ? `${tieBand} points` : "—"} />
      </div>
      <div
        style={{
          fontSize: 13,
          color: PAL.body,
          fontStyle: "italic",
          paddingTop: 10,
          borderTop: `1px solid #332a15`,
        }}
      >
        {verdict === "SIDEWAYS"
          ? "Next step: Build vol-neutral defined-risk structure on synthesis."
          : verdict
          ? `Next step: Build ${verdict.toLowerCase()} defined-risk structure.`
          : "Next step pending."}
      </div>
    </div>
  );
}

function VerdictRow({ k, v, tone }: { k: string; v: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? PAL.green : tone === "red" ? PAL.red : PAL.white;
  return (
    <div className="flex justify-between items-baseline py-1">
      <span
        style={{
          fontSize: 12,
          color: PAL.label,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {k}
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
}

function Round3Side({ turn, side }: { turn: TranscriptTurnInline; side: "bull" | "bear" }) {
  const json = tryParseTurnJson(turn.text);
  const strategy = asString(json?.strategy);
  const conf = asInt(json?.confidence);
  const rationale = asString(json?.rationale);
  const labelBase = side === "bull" ? "Bull Proposal" : "Bear Proposal";
  const stratLabel = strategy
    ? STRAT_LABELS[strategy] ?? strategy.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "";
  const label = [labelBase, stratLabel, conf != null ? `${conf}% Confidence` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <DebateBlock side={side} label={label}>
      {rationale ? (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: PAL.white }}>{rationale}</div>
      ) : (
        <div style={{ fontSize: 14, color: PAL.label }}>(no rationale)</div>
      )}
    </DebateBlock>
  );
}

function SynthesisBox({ turn }: { turn: TranscriptTurnInline }) {
  const json = tryParseTurnJson(turn.text);
  // The synthesis turn carries the FINAL trade JSON. The thesis field
  // captures the arbitration narrative (which proposal was taken and why).
  const thesis = asString(json?.thesis) || asString(json?.rationale);
  return (
    <div
      style={{
        marginTop: 18,
        padding: 16,
        border: `1px solid ${PAL.border}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: PAL.gold,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        Arbitrator's Decision
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: PAL.white }}>
        {thesis || "(arbitration shipped the final trade above; no separate synthesis text)"}
      </div>
    </div>
  );
}

function outcomePresentation(result: StrategistV2Result): {
  headline: string;
  chip: string;
  color: string;
  showRetry: boolean;
} {
  const o = result.strategistOutcome;
  const br = normalizeBlockReason(result.blockReason);
  const cat = br?.category;

  if (o === "ECONOMICS_MISMATCH" || cat === "ECONOMICS_MISMATCH") {
    return { headline: "Trade Rejected: Pricing Mismatch", chip: "Pricing mismatch", color: "#f59e0b", showRetry: true };
  }
  if (o === "UNKNOWN_STRUCTURE" || cat === "UNKNOWN_STRUCTURE") {
    return { headline: "Trade Rejected: Unrecognized Structure", chip: "Unrecognized structure", color: "#f59e0b", showRetry: true };
  }
  if (o === "NO_TRADE" || cat === "NO_TRADE" || cat === "LOW_CONFIDENCE") {
    return { headline: "No Trade Recommended", chip: "No trade", color: "#a3a3a3", showRetry: true };
  }
  if (o === "ANALYSIS_INCOMPLETE" || cat === "ANALYSIS_INCOMPLETE") {
    return { headline: "Analysis Incomplete", chip: "Incomplete", color: "#f59e0b", showRetry: true };
  }
  if (cat === "VALIDATION_FAIL") {
    return { headline: "Could Not Validate Recommendation", chip: CATEGORY_LABELS.VALIDATION_FAIL, color: CATEGORY_COLORS.VALIDATION_FAIL, showRetry: true };
  }
  const chip = br ? CATEGORY_LABELS[br.category] : result.status === "toxic_block" ? "Toxic Block" : "No Viable Setup";
  const color = br ? CATEGORY_COLORS[br.category] : "#71717a";
  const showRetry = cat !== "TOXIC_BLOCK";
  return { headline: chip, chip, color, showRetry };
}

export function StrategistV2BlockCard({
  result,
  generatedAt,
  onRetry,
}: {
  result: StrategistV2Result;
  generatedAt?: string | number | null;
  onRetry?: (ticker: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pres = outcomePresentation(result);
  const reason = normalizeBlockReason(result.blockReason);
  const categoryColor = pres.color;
  const meta = reason?.outcomeMeta;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Shield className="w-4 h-4 shrink-0" style={{ color: categoryColor }} />
              <span className="font-mono text-[13px] font-bold text-white">{result.ticker}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded" style={{
                background: `${categoryColor}1f`,
                color: categoryColor,
                border: `1px solid ${categoryColor}40`,
              }}>
                {pres.chip}
              </span>
            </div>
            <div className="font-mono text-[12px] font-bold text-white leading-snug">{pres.headline}</div>
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

        {reason?.category === "MISSING_DATA" && (
          <div className="mt-2 px-2 py-2 rounded font-mono text-[10px] text-zinc-400 leading-relaxed space-y-1" style={{ background: "rgba(113,113,122,0.08)", border: "1px solid rgba(113,113,122,0.25)" }}>
            <div><span className="text-zinc-500">Category:</span> MISSING_DATA</div>
            {result.fetchFailureMode && (
              <div><span className="text-zinc-500">Fetch mode:</span> {String(result.fetchFailureMode)}</div>
            )}
            <div className="text-zinc-500">Retry after fixing tokens or symbol; use Analyze again.</div>
          </div>
        )}
        {meta?.aiMaxRisk != null && meta?.computedMaxLoss != null && (
          <div className="mt-2 px-2 py-2 rounded font-mono text-[10px] text-zinc-400 leading-relaxed space-y-1" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <div><span className="text-zinc-500">AI max risk (claimed):</span> ${meta.aiMaxRisk.toFixed(2)}</div>
            <div><span className="text-zinc-500">Validator max loss (computed):</span> ${meta.computedMaxLoss.toFixed(2)}</div>
          </div>
        )}
        {meta?.attemptedStructure && (
          <div className="mt-2 px-2 py-2 rounded font-mono text-[10px] text-zinc-400 leading-relaxed" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <div><span className="text-zinc-500">Attempted strategy label:</span> {meta.attemptedStructure}</div>
            {meta.recognizedStructureTypes && (
              <div className="mt-1"><span className="text-zinc-500">Recognized by engine:</span> {meta.recognizedStructureTypes}</div>
            )}
          </div>
        )}
        {meta?.incompleteRole && (
          <div className="mt-2 font-mono text-[10px] text-zinc-500">
            Output that did not validate: <span className="text-zinc-300 uppercase">{meta.incompleteRole}</span>
          </div>
        )}

        {pres.showRetry && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(result.ticker)}
            className="mt-3 px-3 py-2 rounded-lg font-mono text-[11px] font-bold uppercase tracking-wider w-full sm:w-auto"
            style={{ color: "#0a0a0a", background: "#fbbf24" }}
          >
            Retry
          </button>
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

function ivrBackfillErrorMsgPresent(msg: string | null | undefined): boolean {
  return msg != null && String(msg).trim() !== "";
}

export function IvrPopulatingCard({
  result,
  progress,
  onRetry,
}: {
  result: StrategistV2Result;
  progress?: {
    status: "queued" | "running" | "completed" | "failed" | "failed_insufficient_history";
    daysLoaded: number;
    daysRequested: number;
    errorMsg?: string | null;
  } | null;
  onRetry?: (ticker: string) => void;
}) {
  const info = result.ivrBackfill;
  const loaded = progress?.daysLoaded ?? info?.daysLoaded ?? 0;
  const requested = progress?.daysRequested ?? info?.daysRequested ?? 252;
  const pct = requested > 0 ? Math.min(100, Math.round((loaded / requested) * 100)) : 0;
  const failedInsufficient =
    result.status === "failed_insufficient_history" ||
    progress?.status === "failed_insufficient_history" ||
    info?.status === "failed_insufficient_history";
  const failedBackfill =
    !failedInsufficient &&
    ((progress?.status === "failed" && ivrBackfillErrorMsgPresent(progress.errorMsg)) ||
      (info?.status === "failed" && ivrBackfillErrorMsgPresent(info.errorMsg)));
  const failed = failedInsufficient || failedBackfill;
  const badgeLabel = failedInsufficient ? "Insufficient History" : failedBackfill ? "Backfill Failed" : "IVR Populating";
  const bodyText = failedInsufficient
    ? progress?.errorMsg ??
      "This ticker is too new to compute IVR. At least 60 trading days of price history required."
    : failedBackfill
      ? (ivrBackfillErrorMsgPresent(progress?.errorMsg)
          ? String(progress?.errorMsg)
          : ivrBackfillErrorMsgPresent(info?.errorMsg)
            ? String(info?.errorMsg)
            : "IVR backfill failed")
      : info?.message ?? "IVR populating, check back in ~2-3 minutes.";

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <div className="px-4 py-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            {failedBackfill || failedInsufficient ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" aria-hidden />
            ) : (
              <Activity className="w-4 h-4 shrink-0" style={{ color: PAL.gold }} aria-hidden />
            )}
            <span className="font-mono text-[13px] font-bold text-white">{result.ticker}</span>
            <span
              className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border"
              style={{
                background: failed ? "rgba(248,113,113,0.12)" : "rgba(251,191,36,0.12)",
                color: failed ? DOWN : PAL.gold,
                borderColor: failed ? "rgba(248,113,113,0.55)" : "rgba(251,191,36,0.35)",
              }}
            >
              {badgeLabel}
            </span>
          </div>
        </div>
        <div className="font-mono text-[11px] text-zinc-300 leading-relaxed">{bodyText}</div>
        {!failed && (
          <>
            <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-zinc-500">
              <span>Loaded {loaded} of {requested} days</span>
              <span>{pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "#1f1f22" }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: PAL.gold }} />
            </div>
            <div className="mt-2 font-mono text-[10px] text-zinc-500">
              Strategist will auto-run when IVR is ready.
            </div>
          </>
        )}
        {failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(result.ticker)}
            aria-label={`Retry IVR backfill for ${result.ticker}`}
            className="mt-3 inline-flex items-center justify-center gap-2 w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-lg font-mono text-[11px] font-bold uppercase tracking-wider border-2 border-red-400/80 text-red-100 bg-red-950/40 hover:bg-red-950/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#111113]"
          >
            <RefreshCw className="w-4 h-4 shrink-0" aria-hidden />
            Retry
          </button>
        )}
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
