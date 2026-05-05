import { logger } from "./logger.js";
import { getCachedRegime, buildFallbackRegime, type StructuredRegime } from "./regimePostProcessor.js";
import { computeIOScore, type IOScoreResult } from "./ioScoreEngine.js";
import { getSettings, getStrategistModel, type StrategistConfig, type StrategistModelOption } from "./strategistSettings.js";
import { runDebate, type DebateCallbacks, type DebateRound, type DebateRole, type DebatePhase } from "./strategistDebate.js";
import { runDeskAnalysis, runSoloDesk, type DeskCallbacks } from "./strategistDesk.js";
import type { DeskResult } from "./strategistDeskSchemas.js";
import { throwIfStrategistAnalyzeCancelled } from "./strategistAnalyzeCancellation.js";
import type { ScrubCanonical } from "./narrativeScrubbers.js";
import { db, strategistTelemetryTable } from "@workspace/db";

type StrategistTelemetryInsert = InferInsertModel<typeof strategistTelemetryTable>;
import { desc, eq, sql, and } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { fetchPolygonTickerMarketCapUsd, logMarketCapPolygonFallback } from "./polygonTickerMarketCap.js";
import { getBestAccessToken } from "./tokenStore.js";
import { fetchPolygonChain } from "./polygonChain.js";
import { getPolygonFlowHighlights, type PolygonFlowHighlights } from "./polygonFlowHighlights.js";
import { type TapeBackfillStatus } from "./strategistTapeBackfill.js";
import { requestFlowCapture } from "./flowCaptureService.js";
import {
  buildStrategistFullDiagnosticJson,
  buildModelAttributionPlaceholder,
  deriveRunOutcomeFromStrategistResult,
  newStrategistRequestId,
  strategistModeLabel,
  telemetryDbResultToOutcome,
  type StrategistRunMetadata,
  type StrategistRunOutcomeTelemetry,
} from "./strategistDiagnostics.js";
import { runWithPolygonApiTraceAsync, takePolygonApiTrace } from "./polygonApiTrace.js";
import { runInStrategistRunContext, getStrategistRunContext, mergeStrategistDiag } from "./strategistRunContext.js";
import { buildScannerContextPromptBlock } from "./scannerStrategistContext.js";
import {
  buildStrategistDiagnosticView,
  type StrategistDiagnosticView,
} from "./strategistDiagnosticView.js";
import { fetchRecentNyseImbalanceForTicker, CLOSING_IMBALANCE_BALANCED_THRESHOLD_USD } from "./ibImbalancePersistence.js";
import { fetchRecentNasdaqTotalviewForTicker } from "./ibTotalviewPersistence.js";
import { fetchRecentEsDepthSummary } from "./ibEsDepthPersistence.js";
import { acquireDynamicIbPool } from "./ibDynamicSubscriptionManager.js";
import { isNasdaqPrimaryListing, resolveEquityListingForTotalview } from "./ibSymbolListingCache.js";
import {
  getCboeOneFeedDiagnostics,
  getIbDynamicPoolDiagnosticsSnapshot,
  getRecentTotalviewSummaryForTicker,
} from "./ibStreamer.js";
import { getQuoteBySymbol } from "./schwabStreamer.js";
import { lastCompletedTradingDayNy, nyCalendarYmd, rthBoundsMs } from "./polygonMarketCalendar.js";
import { checkEventConflicts, getUpcomingEvents } from "./calendarEventChecker.js";
import { getNextEarningsDate, type NextEarnings } from "./earningsService.js";
import { evaluateCatalyst, deriveTradeDirection, type CatalystEvaluation } from "./catalystEvaluator.js";
import { type OptionContract } from "./optionsStrategist.js";
import { getStoredIVR, getRealizedVolFromEquityDaily, countRealIvHistoryDays, countProxyIvHistoryDays } from "./ivNormalize.js";
import { buildMarketContextSnapshot, type MarketContextSnapshot } from "./flowMarketContext.js";
import { recomputeImpliedVolFromMid } from "./strategistIvRecompute.js";
import type { IvClampedReasonKey } from "./strategistIvClampCompat.js";
import {
  normalizeStrategistIv,
  impliedVolFromAtmStraddle,
  isReliableIv,
  STRATEGIST_IV_CEILING_PCT,
} from "./strategistIvNormalize.js";
import { impliedVolatilityBSM } from "./bsmIV.js";
import { attachDeskPmPayoffScenarios } from "./strategistPmPayoffScenarios.js";
import type { EquityMarketSession, EquitySessionResolutionSource } from "./schwabMarketHours.js";
import { getEquityMarketSessionWithAsOf } from "./schwabMarketHours.js";
import {
  emptyConsensus,
  fetchPolygonAnalystRatingsAndConsensus,
  mergeFmpPriceTargetIntoConsensus,
} from "./polygonAnalystData.js";
import { fetchEarningsHistoryAndForward, type FetchEarningsBundle } from "./polygonEarningsHistory.js";
import { getAnalystPriceTargets, getRecentAnalystGrades, getEarningsSurpriseHistory } from "./fmpDataService.js";
import { fetchCompanyFinancialsForSymbol, type CompanyFinancials } from "../routes/sec.js";
import { clampProfitTargetToMaxPayout } from "./exitTargetMath.js";
import { scrubAll } from "./narrativeScrubbers.js";
import { getAiLabStrategistConfig } from "./aiLabConfig.js";
import {
  callAnthropicWithSystemAndWebSearch,
  callGeminiWithSystemAndWebSearch,
  callOpenAIWithSystemAndWebSearch,
  callXaiWithSystemAndWebSearch,
  streamCallAnthropicWithSystemAndWebSearch,
  streamCallGeminiWithSystemAndWebSearch,
  streamCallOpenAIWithSystemAndWebSearch,
  streamCallXaiWithSystemAndWebSearch,
  extractJson,
  type WebSearchTrace,
} from "./aiLabAnalystClient.js";

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";

// Structured rejection reason. Replaces free-form blockReason strings so the
// UI can render the category prominently (with colored pill / icon) and the
// detail underneath. suggestedAction is optional next-step guidance.
// Backward compatibility: legacy string blockReasons are normalized on the
// client to { category: "UNKNOWN", detail: <string> }.
export type RejectionCategory =
  | "TOXIC_BLOCK"
  | "LOW_CONFIDENCE"
  | "NO_EDGE"
  | "CATALYST_CONFLICT"
  /** @deprecated Prefer ECONOMICS_MISMATCH | UNKNOWN_STRUCTURE | ANALYSIS_INCOMPLETE */
  | "VALIDATION_FAIL"
  | "MISSING_DATA"
  | "STOCK_HALTED"
  | "PRICING_MARKET_CLOSED"
  | "EARNINGS_INSIDE_EXPIRY"
  | "UNKNOWN"
  /** AI-reported risk/loss does not match leg-derived economics */
  | "ECONOMICS_MISMATCH"
  /** Multi-leg shape not recognized by the pricing engine */
  | "UNKNOWN_STRUCTURE"
  /** Explicit no-trade from model (e.g. low confidence / no_trade strategy / PM pass) */
  | "NO_TRADE"
  /** Schema or parse failure after retry (or PM output incomplete in Desk) */
  | "ANALYSIS_INCOMPLETE";

/** User-facing outcome for blocked / non-recommendation cards (mirrors RejectionCategory subset). */
export type StrategistOutcome =
  | "ECONOMICS_MISMATCH"
  | "UNKNOWN_STRUCTURE"
  | "NO_TRADE"
  | "ANALYSIS_INCOMPLETE";

export interface BlockReason {
  category: RejectionCategory;
  detail: string;
  suggestedAction?: string;
  /** Structured hints for outcome-specific UI (pricing row, structure label, etc.) */
  outcomeMeta?: {
    aiMaxRisk?: number;
    computedMaxLoss?: number;
    attemptedStructure?: string;
    recognizedStructureTypes?: string;
    incompleteRole?: string;
  };
}

export interface StrategistV2Result {
  /** Item 23: bump when client-visible result shape changes (idempotent re-runs compare this). */
  schemaVersion?: number;
  status: "recommendation" | "no_viable_setup" | "toxic_block" | "ivr_populating" | "failed_insufficient_history" | "desk_recommendation";
  ticker: string;
  /** When no_viable_setup / MISSING_DATA stems from ticker fetch failure */
  fetchFailureMode?: "token_null" | "http_fail" | "symbol_missing" | "network_exception" | string;
  deskResult?: import("./strategistDeskSchemas.js").DeskResult;
  ivrBackfill?: {
    jobId: string | null;
    status: "queued" | "running" | "completed" | "failed" | "failed_insufficient_history";
    daysLoaded: number;
    daysRequested: number;
    message: string;
  };
  recommendation?: {
    strategyLine: string;
    companyContext: string;
    thesis: string;
    rationale: string;
    edgeAttribution: string;
    idioStrengthPct: number;
    macroPct: number;
    strategyType: string;
    direction: string;
    legs: CandidateLeg[];
    credit?: number;
    debit?: number;
    entryRangeMin: number;
    entryRangeMax: number;
    maxProfit: number;
    maxLoss: number;
    breakeven: number;
    riskReward: number;
    dte: number;
    expiration: string;
    exitTargets: {
      profitTarget: number;
      profitTargetUnderlying: number;
      stopLoss: number;
      stopLossUnderlying: number;
      timeStop: string;
    };
    bullInvalidation: string;
    bearInvalidation: string;
    riskOfRuin: string;
    confidence: number;
    warnings: string | null;
    contextSources?: ContextSourcesPayload;
  };
  blockReason?: BlockReason | string;
  contextSources?: ContextSourcesPayload;
  regime: StructuredRegime;
  ioScore?: IOScoreResult;
  systemicRiskElevated: boolean;
  telemetryId?: number;
  /** Server-only correlation id for full diagnostic JSON (telemetry and export). */
  strategistDiagnosticRequestId?: string;
  /** Compact desk-only projection for sharing; does not replace the full data package. */
  diagnosticView?: StrategistDiagnosticView;
  earningsAlert?: {
    earningsDate: string;
    daysUntilEarnings: number | null;
    daysUntilExpiry: number;
    insideExpiry: boolean;
    behavior: "BLOCK" | "WARN" | "IGNORE";
    source: "vendor_primary" | "fmp_db" | "finnhub" | null;
    confirmed: boolean;
  };
  /** Set for `no_viable_setup` when the block maps to a v2 strategist outcome card */
  strategistOutcome?: StrategistOutcome;
}

/** Item 23: client / history idempotency — bump when StrategistV2Result shape changes. */
export const STRATEGIST_RESULT_SCHEMA_VERSION = 3;

function withResultSchemaVersion<T extends StrategistV2Result>(r: T): T {
  r.schemaVersion = STRATEGIST_RESULT_SCHEMA_VERSION;
  return r;
}

export interface CandidateLeg {
  type: "call" | "put";
  side: "buy" | "sell";
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  openInterest: number;
}

interface TickerData {
  price: number;
  dailyChangePct: number;
  ivr: number | null;
  /** From getStoredIVR / equity_daily — surfaced in volatilityContext for the Volatility section. */
  ivrAsOfDate: string | null;
  ivrSource: string | null;
  avgVolume20d: number;
  currentVolume: number;
  relativeVolume: number;
  sector: string;
  /** Schwab fundamental.marketCap when present. */
  marketCapUsd: number | null;
  /** Schwab reference.assetType / assetMainType when present. */
  schwabAssetType: string | null;
  /** Schwab reference.exchange when present — used for venue routing hints (e.g. TotalView). */
  schwabExchangeHint: string | null;
  /** Tier, ETF flag, tiered large-print threshold, boundary proximity (Items 2, 4, 19, 26). */
  marketContext: MarketContextSnapshot;
  earningsWithin48h: boolean;
  earningsDaysAway: number | null;
  earningsDate: string | null;
  earningsConfirmed: boolean;
  earningsSource: "vendor_primary" | "fmp_db" | "finnhub" | null;
  /** Most recent reported earnings (YYYY-MM-DD), when calendar sources provide it. */
  lastEarningsDate: string | null;
  /** Calendar days since lastEarningsDate. */
  daysSinceEarnings: number | null;
  /** Set when prior earnings date could not be resolved. */
  tickerDataNote?: string | null;
  /** Full vendor calendar row (EPS/revenue estimates, prior quarter, period). Same source as earnings dates. */
  nextEarnings: NextEarnings | null;
  analystActions48h: string[];
  halted: boolean;
}

export type ReconstructedIVSource =
  | "bsm_bisection"
  | "skipped_penny_spread"
  | "skipped_no_bid"
  | "skipped_no_ask"
  | "skipped_short_dte"
  | "skipped_no_convergence";

export interface ChainContract {
  strike: number;
  expiration: string;
  type: string;
  optionType?: string;
  bid: number;
  ask: number;
  mid: number;
  delta: number;
  openInterest: number;
  volume: number;
  /**
   * Vendor chain IV (decimal σ annualized, e.g. 0.35 = 35%). Null when removed by
   * IV contamination filter; see **rawIv** for the pre-filter value.
   */
  impliedVolatility: number | null;
  dte: number;
  /** Pre–IV-filter chain IV (decimal); set when strategist payload filtering runs. */
  rawIv?: number | null;
  /** BSM IV from mid (decimal σ); logging-only, not used for gating. */
  recomputedIv?: number | null;
  recomputedIvAvailable?: boolean;
  recomputedIvDisagreementPct?: number | null;
  /** BSM bisection IV in percent when chain IV is unreliable; additive only. */
  reconstructedIV?: number | null;
  reconstructedIVSource?: ReconstructedIVSource | null;
}

export interface ContextSourcesPayload {
  webSearchUsed: boolean;
  queryCount: number;
  queries: string[];
  sources: Array<{ title: string; url: string; date?: string }>;
  /** @deprecated Day-trader frame; retained for legacy UI/history compat. Always false going forward. */
  sameDayCatalyst: boolean;
  /** @deprecated Use catalyst.catalystSummary. Mirrored for legacy UI/history compat. */
  catalystSummary?: string;
  /** @deprecated Use catalyst.catalystAlignment. Mirrored for legacy UI/history compat. */
  catalystAlignment?: "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "NONE";
  /** New swing-trader-correct catalyst evaluation — the relevant question for 28-60 DTE spreads. */
  catalyst?: import("./catalystEvaluator.js").CatalystEvaluation;
}

interface AiTradeResponse {
  strategy: string;
  legs: Array<{
    type: "call" | "put";
    strike: number;
    action: "buy" | "sell";
    expiration: string;
    /** Optional contract count from the model; omitted means 1. */
    quantity?: number;
  }>;
  entryPrice: number;
  entryRangeMin: number;
  entryRangeMax: number;
  maxRisk: number;
  maxProfit: number | string;
  breakeven: number[];
  companyContext: string;
  thesis: string;
  exitTargets: {
    profitTarget: number;
    profitTargetUnderlying: number;
    stopLoss: number;
    stopLossUnderlying: number;
    timeStop: string;
  };
  bullInvalidation: string;
  bearInvalidation: string;
  riskOfRuin: string;
  confidence: number;
  warnings: string | null;
  // Self-reported by the model after running its own web searches.
  // The server merges this with the actual tool-trace before returning.
  /** @deprecated Day-trader frame; replaced by `catalyst` object below. Still parsed for back-compat. */
  sameDayCatalyst?: boolean;
  /** @deprecated Mirror of catalyst.summary. Still parsed for back-compat. */
  catalystSummary?: string;
  /** @deprecated Mirror of catalyst.alignment. Still parsed for back-compat. */
  catalystAlignment?: "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "NONE";
  /** New swing-trader catalyst signal. Server merges with deterministic earnings/FOMC/economic data. */
  catalyst?: {
    type?: string | null;          // EARNINGS | FED_MEETING | ECONOMIC_RELEASE | PRODUCT_LAUNCH | MA_EVENT | ANALYST_ACTION | NONE
    date?: string | null;          // YYYY-MM-DD if known
    alignment?: string | null;     // ALIGNED | CONTRADICTS | NEUTRAL | UNKNOWN
    summary?: string | null;
    residual?: { type?: string | null; date?: string | null } | null;
  } | null;
  citedHeadlines?: Array<{ title: string; url?: string; date?: string }>;
}

/** Snapshot persisted on strategist telemetry rows (matches `checkToxicGate` return shape). */
type ToxicGateSnapshot = {
  triggered: boolean;
  reasons: string[];
  pathACheck: { extremeRisk: boolean; highCorrelation: boolean };
  pathBCheck: { elevatedRisk: boolean; eventWithin24h: boolean; eventName: string | null };
};

/** Subset of AI trade response stored with recommendation telemetry. */
type TelemetryStrategyDecision = {
  strategy: string;
  strategyType: string;
  confidence: number;
  aiRationale: string;
  warnings: string | null;
  legs: AiTradeResponse["legs"];
  entryPrice: number;
  maxRisk: number;
  maxProfit: number | string;
  breakeven: number[];
  catalystAlignment: AiTradeResponse["catalystAlignment"] | null;
  sameDayCatalyst: boolean;
};

type TelemetryEdgeAttribution = {
  idiosyncratic_pct: number;
  macro_pct: number;
};

type TelemetryToxicGatePayload = {
  triggered: ToxicGateSnapshot["triggered"];
  reasons: ToxicGateSnapshot["reasons"];
  path_a_check: ToxicGateSnapshot["pathACheck"];
  path_b_check: ToxicGateSnapshot["pathBCheck"];
};

function parseDataPackageForDiag(raw: string | undefined | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function deskSectionsPayload(deskResult: DeskResult): Record<string, unknown> {
  const { vol, flow, catalyst, pm } = deskResult;
  return { vol, flow, catalyst, pm };
}

function strategistPayloadFromResult(args: {
  settings: StrategistConfig;
  deskResult?: DeskResult | null;
  aiResponse?: AiTradeResponse | null;
}): unknown {
  const { settings, deskResult, aiResponse } = args;
  if (deskResult) return deskSectionsPayload(deskResult);
  if (settings.strategistMode === 2 || aiResponse) {
    return aiResponse ?? null;
  }
  return null;
}

/** Per-leg curated chain row; **iv** is post–IV-clamp-filter; **raw_iv** is pre-filter % when present. */
interface CuratedOptionLeg {
  bid: number;
  ask: number;
  iv: number | null;
  /** Pre-filter IV in percent (same convention as **iv**); omitted when unknown. */
  raw_iv?: number | null;
  delta: number;
  volume: number;
  oi: number;
  /** True when chain IV hit the strategist ceiling or was marked unreliable by normalization. */
  iv_unreliable?: boolean;
}

interface CuratedStrike {
  strike: number;
  call?: CuratedOptionLeg;
  put?: CuratedOptionLeg;
  unusualCall?: true;
  unusualPut?: true;
}

interface CuratedExpiration {
  expiration: string;
  dte: number;
  bucket: "near_0_7d" | "mid_7_30d" | "far_30_60d" | "earnings_capture";
  strikes: CuratedStrike[];
}

/** Schwab GET /marketdata/v1/quotes envelope: symbol → { quote, fundamental, reference }. */
interface SchwabQuotesResponse {
  [symbol: string]:
    | { quote?: SchwabQuoteRow; fundamental?: SchwabFundamentalRow; reference?: SchwabReferenceRow }
    | undefined;
}

interface SchwabQuoteRow {
  lastPrice?: number;
  mark?: number;
  netPercentChangeInDouble?: number;
  totalVolume?: number;
  securityStatus?: string;
}

interface SchwabReferenceRow {
  assetType?: string;
  assetMainType?: string;
  exchange?: string;
}

interface SchwabFundamentalRow {
  avg10DaysVolume?: number;
  avgVol10Days?: number;
  sector?: string;
  /** Present on many equities; null/absent when Schwab omits it. */
  marketCap?: number;
}

/** Schwab GET /marketdata/v1/chains JSON body (partial). */
interface SchwabChainApiResponse {
  callExpDateMap?: Record<string, unknown>;
  putExpDateMap?: Record<string, unknown>;
  underlyingPrice?: number;
}

export interface ChainSummary {
  atmStrike: number;
  atmCallBid: number;
  atmCallAsk: number;
  atmCallIV: number | null;
  atmCallOI: number;
  atmPutBid: number;
  atmPutAsk: number;
  atmPutIV: number | null;
  atmPutOI: number;
  topVolumeCalls: Array<{ strike: number; expiration: string; volume: number; oi: number; bid: number; ask: number; iv: number | null; delta: number }>;
  topVolumePuts: Array<{ strike: number; expiration: string; volume: number; oi: number; bid: number; ask: number; iv: number | null; delta: number }>;
  unusualActivity: Array<{ strike: number; type: string; expiration: string; volume: number; oi: number; volOiRatio: number }>;
  putCallVolumeRatio: number;
  frontMonthIV: number | null;
  backMonthIV: number | null;
  availableExpirations: string[];
  curatedExpirations: CuratedExpiration[];
  ivArtifactsClampedCount: number;
  ivCeilingPct: number;
  /** ATM IV (call+put avg, pct) at ≥5 expiries from near-term through 60+ DTE when chain supports it. */
  termStructure5pt: Array<{ expiry: string; daysToExpiry: number; atmIV: number | null }>;
  /** IV contamination filter applied after BSM reconstruction; surfaced in dataQualitySummary. */
  ivChainFilter: IvChainFilterStats;
  /** 25Δ put IV minus 25Δ call IV (vol points); null if unavailable. */
  skew25Delta: { putIV: number; callIV: number; skewPoints: number; asOfExpiry: string } | null;
  /** Machine-readable skew resolution (always set; see computeSkew25DeltaForChain). */
  skew25DeltaReason: string;
  /** ATM straddle mid (call+put) for front-month expiry. */
  impliedMove: {
    dollar: number;
    percentOfSpot: number;
    expiry: string;
    daysToExpiry: number;
    /** BSM-implied annualized IV (%) from matching straddle mid to model price; null when unsolvable. */
    impliedVolStraddlePct?: number | null;
    impliedVolStraddleSource?: "bsm_match_mid" | null;
  } | null;
  /** Gap surfacing for impliedMove (mirrors dataQualitySummary.impliedMove). */
  impliedMoveQuality: StrategistImpliedMoveQuality;
  /** Schwab equity session at chain summarization time (cached ~60s), or NY calendar fallback. */
  marketSession: EquityMarketSession;
  /** How **marketSession** was resolved: Schwab market hours API vs deterministic NY calendar. */
  marketSessionSource: EquitySessionResolutionSource;
  /** ISO time when **marketSession** was resolved (cache stamp). */
  marketSessionAsOf: string;
}

/** Reasons when implied move cannot be surfaced or BSM IV inversion fails. */
export type StrategistImpliedMoveGapReason =
  | "ok"
  | "no_expirations"
  | "no_valid_dte"
  | "no_atm_pair"
  | "non_finite_mids"
  | "no_spot_price"
  | "bsm_inversion_failed";

/** Surfaced on every strategist run for LLM and clients (see buildDataQualitySummary). */
export type StrategistImpliedMoveQuality = {
  available: boolean;
  reason: StrategistImpliedMoveGapReason;
  /** First expiry with DTE greater than zero when the sorted front expiry was skipped (0DTE or expired). */
  fallbackExpiryUsed: string | null;
};

/** Result of ATM straddle implied-move computation (discriminated for diagnostics). */
export type ImpliedMoveResult =
  | {
      value: NonNullable<ChainSummary["impliedMove"]>;
      reason: "ok" | "bsm_inversion_failed";
      fallbackExpiryUsed: string | null;
    }
  | {
      value: null;
      reason: "no_expirations" | "no_valid_dte" | "no_atm_pair" | "non_finite_mids" | "no_spot_price";
    };

// Persona suffixes appended to STRATEGIST_SYSTEM_PROMPT in Debate mode only.
// Solo mode keeps the neutral system prompt unchanged.
const BULL_PERSONA = `## DEBATE ROLE: BULL STRATEGIST

You are the **BULL** in a structured bull/bear debate. Your job is to find and defend the strongest **bullish** options expression for this name. You are not a permabull — you do not invent edge that is not there. But your hunt is asymmetrically biased toward upside structures: long calls, call verticals (debit), call ratios, put credit spreads, call calendars, risk reversals, bullish butterflies. If the data genuinely supports a bullish setup, build the cleanest expression of it. If the data is mixed, find the bullish edge anyway and quantify how strong (or weak) it is — let your confidence reflect that honestly. If the data is decisively bearish and there is truly no bullish edge, say so plainly in your thesis and set confidence very low (sub-30) rather than fabricating a bull case. Never propose bearish structures (long puts, put verticals debit, call credit spreads, bearish ratios) — that is the bear's job. Vol-neutral structures (iron condors, straddles, strangles) are allowed only if you can articulate a specifically bullish vol thesis (e.g. selling overpriced downside skew). Stay in role across all 3 rounds. The thesis most likely to play out first inside the trade's expiration window wins.`;

const BEAR_PERSONA = `## DEBATE ROLE: BEAR STRATEGIST

You are the **BEAR** in a structured bull/bear debate. Your job is to find and defend the strongest **bearish** options expression for this name. You are not a permabear — you do not invent edge that is not there. But your hunt is asymmetrically biased toward downside structures: long puts, put verticals (debit), put ratios, call credit spreads, put calendars, bearish butterflies, collars on long stock. If the data genuinely supports a bearish setup, build the cleanest expression of it. If the data is mixed, find the bearish edge anyway and quantify how strong (or weak) it is — let your confidence reflect that honestly. If the data is decisively bullish and there is truly no bearish edge, say so plainly in your thesis and set confidence very low (sub-30) rather than fabricating a bear case. Never propose bullish structures (long calls, call verticals debit, put credit spreads, bullish ratios) — that is the bull's job. Vol-neutral structures (iron condors, straddles, strangles) are allowed only if you can articulate a specifically bearish vol thesis (e.g. selling overpriced upside skew, or buying vol ahead of a feared catalyst). Stay in role across all 3 rounds. The thesis most likely to play out first inside the trade's expiration window wins.`;

const STRATEGIST_SYSTEM_PROMPT = `## IDENTITY

You are a senior options trader on a discretionary prop desk at a firm like Jane Street or SIG. You came up as a volatility trader at a tier-one quant shop (think Citadel or Goldman Sachs Securities Division), where you learned to think in Greeks, vol surface dynamics, skew, term structure, and probability rather than in simple directional bias. You now run your own book.

Your mandate is absolute return. Every trade you recommend must stand on its own P&L merit. You are not hedging a larger equity portfolio. You are not providing liquidity as a market maker obligation. You are hunting for asymmetric edge in options, and every position you put on is meant to generate alpha by itself.

You think like a professional, not a retail trader. You read flow. You care about implied volatility versus realized, vol surface dislocations, dealer positioning, unusual options activity, and catalyst math. You are comfortable recommending any defined-risk structure: verticals, iron condors, butterflies, calendars, diagonals, ratios, credit spreads, debit spreads, straddles, strangles. You never recommend naked short puts or naked short calls. Every position must have defined risk. If the setup calls for premium selling, express it as a credit spread, iron condor, or iron butterfly. You do not default to iron condors because they feel safe. You do not default to 30-45 DTE because someone told you that is optimal. You look at the vol surface and pick the structure and expiration where the edge actually lives.

You are ruthlessly honest. If there is no compelling edge, you say so and return confidence below 20. You do not invent trades to have something to show. A "no trade" answer is a valid and professional output.

## CAPABILITIES

You are not limited to the data package you receive. Use your full knowledge base. Use web search to cross-reference current news, SEC filings, analyst actions, regulatory events, earnings history, sector dynamics, and anything else that sharpens your edge on the specific ticker. The data package is a starting point, not a cage.

## WEB SEARCH MANDATE (NON-NEGOTIABLE)

Web search is enabled and you MUST use it on every analysis BEFORE producing your thesis. You will run, at minimum, the following searches:

1. \`<TICKER> news today\` and \`<TICKER> news <TODAY_DATE>\` — find any same-day catalysts.
2. \`<TICKER> analyst upgrade downgrade price target\` (last 7 days) — find recent analyst actions.
3. \`<TICKER> earnings\` if earnings are within 14 days, OR sector/industry catalyst search if no ticker-specific news.
4. Additional searches as needed for sector/competitor moves that are obviously driving the tape.

After searching:
- If a same-day catalyst is found that EXPLAINS the price action: cite it explicitly in your thesis with the source headline and date. Your direction MUST agree with the catalyst, or you must justify the contradiction in plain English. Bump confidence upward (+10-15%) when the catalyst clearly aligns with the thesis.
- If a same-day catalyst is found that CONTRADICTS your candidate direction: flip the direction or return no_trade. A bullish call spread on a ticker that just printed bearish news is malpractice.
- If NO material news is found after searching: state "No material news in last 7 days per web search" in the thesis and reason from the data payload alone. Confidence should be modest in this regime.

## SAME-DAY MOVE AWARENESS

The data payload includes the day's price change. If the ticker is moving > 3% in either direction on the day, your thesis MUST explicitly explain what is driving that move (citing the catalyst found via web search). Cards that ignore a 5%+ same-day move are unacceptable.

## REGIME OVERRIDE VIA IDIOSYNCRATIC CATALYST

The macro regime block in the payload may report low conviction (NEUTRAL / NO_EDGE). In that case:
- If web search finds a confirmed ticker-specific catalyst: you may proceed with a directional trade. The catalyst is the idiosyncratic edge.
- If web search finds NO catalyst and macro regime has no direction: you have no edge. Return confidence < 20 (which the server will treat as no viable setup).

## GROUNDING DISCIPLINE

You must be honest about where every claim comes from.

- Any specific number you cite from the data package (strike, volume, open interest, IV, delta, bid, ask) must match the payload exactly. Do not round, do not estimate, do not invent strikes that are not in the chain.
- **IVR SOURCE AWARENESS**: The data payload includes \`ivrSource\`. If it is \`hv_proxy\`, the IVR figure was derived from realized vol (HV30 × volatility-risk-premium) because we do not yet have enough chain-based history. This is a reasonable but conservative estimate — true IV often runs 5–15% above realized, and during volatility spikes the proxy will under-state IV. When choosing between credit and debit structures on a hv_proxy IVR, lean slightly toward credits in low-IVR (proxy may be under-estimating), and demand a stronger directional thesis before paying premium. Once \`ivrSource\` becomes \`chain\` or \`canonical\`, treat IVR with full confidence.

- **HARD RULE on IVR and P/C ratio**: Do NOT restate, reinterpret, paraphrase, scale, or invert the \`ivr\` or \`putCallVolumeRatio\` values from the data payload. If you want to reference IVR in the narrative, use the literal token \`{{IVR}}\` and the server will substitute the canonical value. If you want to reference the P/C ratio, use the literal token \`{{PC_RATIO}}\`. Do not compute "0.92" from "92" or vice versa. Do not append "%" to IVR — the placeholder is unitless. If you write a number next to "IVR" or "P/C" the server will overwrite it with the canonical value and log a quality warning against this generation.
- Any expiration date you recommend must come from the availableExpirations array provided. Do not calculate a date yourself.
- When you reference information outside the payload (news, regulatory context, sector dynamics, historical patterns), briefly cite the source. Examples: "per recent SEC filing," "per current news on the PDT rule change," "per general knowledge of semiconductor capex cycles."
- If a piece of information you want is not in the payload and you cannot verify it through search, say so. Do not fill gaps with plausible-sounding detail.

This is how institutional traders work. They cite their sources because their PnL depends on the information being real.

## EXPIRATION SELECTION

The data package includes a curatedExpirations array containing strike-level data (bid, ask, IV, delta, volume, OI) sampled across multiple DTE buckets from near-term through 60 days, plus optional earnings_capture rows when the next earnings date is known and a listed expiry on or after that date is added for vol surface context past 60 DTE. When selecting an expiration for your trade, evaluate the strikes available at each expiration in this array. Do not default to the nearest weekly just because the flow signal is loudest there. Consider whether the thesis is better expressed at a longer DTE with better theta economics, more time for the move to develop, or lower gamma risk. Choose the expiration that best fits the thesis, not the expiration with the most volume.

## WHAT YOU ARE NOT

You are not a retail options educator. You are not explaining basics.
You are not a PM hedging a $1B equity book. You are not sizing 500 contracts.
You are not a market maker. You are not quoting two-sided.
You are a prop trader hunting alpha in a concentrated, defined-risk book. Every trade makes money on its own or it does not get recommended.

## OUTPUT FORMAT

The user's configurable preferences are included in the data package for context. Respect them when possible but if you see a compelling trade outside their preferences, recommend it and explain why.

Your response must be valid JSON with these fields:
- strategy: string (e.g. "bull_call_spread", "bear_put_spread", "iron_condor", "iron_butterfly", "calendar_spread", "diagonal", "butterfly", "ratio_spread", "straddle", "strangle") — naked_put and naked_call are never valid
- legs: array of {type: "call" or "put", strike: number, action: "buy" or "sell", expiration: "YYYY-MM-DD"}
- entryPrice: number (net debit or credit, positive = debit, negative = credit)
- entryRangeMin: number (minimum fill price based on current bid/ask)
- entryRangeMax: number (maximum fill price based on current bid/ask)
- maxRisk: number (maximum dollar loss per contract)
- maxProfit: number (maximum dollar profit per contract, or 99999 for theoretically unlimited)
- breakeven: array of numbers (breakeven price points)
- companyContext: string (2 sentences: what the company does, what sector, what it is levered to)
- thesis: string (2-4 sentences on why this specific structure is the best expression of the edge right now, speaking in vol, flow, Greeks, catalyst, and probability terms; if selling close to the money explicitly justify why vol is rich enough to take that risk; if going wide on a spread explicitly justify the risk/reward)
- exitTargets: {profitTarget: number (PER-SHARE option contract price — what the option itself trades for, e.g. 3.30, NOT total dollar P&L on a lot), profitTargetUnderlying: number (underlying share price at that target), stopLoss: number (PER-SHARE option contract price at the stop, e.g. 0.85), stopLossUnderlying: number (underlying share price at that stop), timeStop: string (YYYY-MM-DD format, must be a FUTURE date — if DTE < 7, set timeStop to "" instead of computing expiration minus days)}
- bullInvalidation: string (specific event or price action that kills the long side of the thesis)
- bearInvalidation: string (specific event or price action that kills the short side of the thesis)
- riskOfRuin: string (the single biggest threat to this trade — the one thing that if it happened would cause maximum pain: macro event, vol crush, gap risk, earnings adjacency, liquidity trap, regulatory surprise; one sentence)
- confidence: number 0-100 (if no setup qualifies, return below 20 and do not force a trade)
- warnings: string or null (anything the user should know: earnings risk, low liquidity, gap risk, etc.)
- catalyst: object (the swing-trader-correct catalyst evaluation) with these fields:
    - type: one of "EARNINGS" | "FED_MEETING" | "ECONOMIC_RELEASE" | "PRODUCT_LAUNCH" | "MA_EVENT" | "ANALYST_ACTION" | "NONE"
      The single most important catalyst that will fire BETWEEN TODAY AND YOUR PROPOSED EXPIRATION. The server independently confirms EARNINGS / FED_MEETING / ECONOMIC_RELEASE from authoritative calendars and will override yours if they disagree. PRODUCT_LAUNCH / MA_EVENT / ANALYST_ACTION you must source from web search.
    - date: "YYYY-MM-DD" if known, else null
    - alignment: "ALIGNED" | "CONTRADICTS" | "NEUTRAL" (relationship of the catalyst to your recommended direction). RULES: If your trade direction is bullish and the catalyst is bullish for the name → ALIGNED. If bullish trade meets bearish catalyst → CONTRADICTS. For neutral/vol structures (iron condor, butterfly, calendar, straddle) → NEUTRAL. For an upcoming binary EARNINGS event (the print hasn't happened yet) → NEUTRAL — the event has no known sign in advance. For ambient macro events (FOMC, CPI, PCE) on a single-name trade → NEUTRAL unless you can name the specific bullish/bearish read. If there is no scheduled catalyst at all → NEUTRAL. Reserve "UNKNOWN" only for the rare case where a catalyst exists, has fired, and you genuinely cannot tell whether the market read it as bullish or bearish — almost every analysis should resolve to ALIGNED, CONTRADICTS, or NEUTRAL, not UNKNOWN.
    - summary: one sentence describing the catalyst, or "No scheduled catalyst between now and expiry — thesis is technical/structural" if none
    - residual: optional object {type: same enum, date: "YYYY-MM-DD"} for a catalyst that fired in the LAST 14 DAYS that the price is still digesting (e.g. earnings 3-7 days ago driving post-earnings drift). Omit if not applicable.
  Most valid swing setups (post-earnings drift, mean reversion, vol regime, trend continuation) have NO scheduled catalyst between now and expiry — that is fine and expected. Do not invent a catalyst.
- citedHeadlines: array of {title: string, url?: string, date?: string} (key headlines you actually used in the thesis; empty array allowed if none)

NARRATIVE DISCIPLINE: Your job is structure and thesis. The code computes economics from real Schwab leg prices after you respond. When your thesis prose mentions a specific debit, credit, risk/reward ratio, max profit, max loss, or breakeven, cite only numbers that match the legs and prices you are picking — do not invent or approximate. If you are uncertain of a number, describe the shape of the trade qualitatively instead of quoting a dollar figure. Dollar amounts and ratios you cite must match the strikes and real leg prices you selected; mismatches get auto-corrected by the server and logged as a quality issue.

The thesis most likely to play out first inside the trade's expiration window wins.

IMPORTANT: Respond with ONLY the JSON object. No markdown, no explanation text, no code fences. Just the raw JSON.`;

export interface DebateTurnStartPayload {
  id: string;
  round: DebateRound | "desk";
  role: DebateRole | "vol" | "flow" | "catalyst" | "pm";
  phase: DebatePhase | "analyst" | "pm";
  model: string;
  label: string;
  startedAt: number;
}

export interface AnalyzeProgressCallbacks {
  onStatus?: (status: string) => void;
  onToken?: (text: string) => void;
  // Debate-mode structured transcript callbacks. Solo mode never emits these.
  onTurnStart?: (turn: DebateTurnStartPayload) => void;
  onTurnDelta?: (turnId: string, delta: string) => void;
  onTurnDone?: (turnId: string, finalText: string) => void;
  /** Desk / validation: drop a failed attempt from the transcript before retry. */
  onTurnDiscarded?: (turnId: string) => void;
  // Optional caller-supplied context to prepend to the analyst prompt.
  // Used by the Unusual Flow drill-down "Send to Strategist" button to
  // pass a snapshot of the live flow card so the analyst reasons about
  // exactly what the user just observed.
  flowContext?: string;
  /** POST /analyze background job id for cooperative server-side cancel. */
  jobId?: string;
  /** Aborts in-flight LLM HTTP when aborted (client disconnect or explicit cancel). */
  cancelSignal?: AbortSignal;
}

function throwAnalyzeCancelled(): never {
  const e = new Error("Analysis cancelled");
  e.name = "AbortError";
  throw e;
}

function assertAnalyzeNotCancelled(progress?: AnalyzeProgressCallbacks): void {
  if (progress?.cancelSignal?.aborted) throwAnalyzeCancelled();
  throwIfStrategistAnalyzeCancelled(progress?.jobId);
}

export async function analyzeTickerV2(
  ticker: string,
  progress?: AnalyzeProgressCallbacks,
): Promise<StrategistV2Result> {
  return runWithPolygonApiTraceAsync(() => analyzeTickerV2Inner(ticker, progress));
}

async function analyzeTickerV2Inner(
  ticker: string,
  progress?: AnalyzeProgressCallbacks,
): Promise<StrategistV2Result> {
  const status = (s: string) => progress?.onStatus?.(s);
  status("Loading regime + settings…");
  assertAnalyzeNotCancelled(progress);
  const settings = await getSettings();
  mergeStrategistDiag({ soloModelLabel: getStrategistModel(settings.strategistSoloModelIdx).label });
  assertAnalyzeNotCancelled(progress);
  const regime = getCachedRegime() ?? buildFallbackRegime();

  const toxicCheck = checkToxicGate(regime, settings);
  if (toxicCheck.triggered) {
    const strategistDiagnosticRequestId = getStrategistRunContext()?.requestId;
    const result: StrategistV2Result = {
      status: "toxic_block",
      ticker,
      blockReason: {
        category: "TOXIC_BLOCK",
        detail: `Cash is a position. Toxic market conditions: ${toxicCheck.reasons.join("; ")}`,
        suggestedAction: "Wait for market regime to normalize before opening new positions.",
      },
      regime,
      systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
      ...(strategistDiagnosticRequestId ? { strategistDiagnosticRequestId } : {}),
    };
    await emitFullDiagnosticTelemetry({
      ticker,
      settings,
      regime,
      ioScore: null,
      tickerData: null,
      toxicCheck,
      telemetryDbResult: "toxic_block",
      aiDecision: null,
      thesis: (result.blockReason as BlockReason).detail,
      extras: {},
    });
    return withResultSchemaVersion(result);
  }

  const tickerFetch = await fetchTickerData(ticker);
  assertAnalyzeNotCancelled(progress);
  const tickerData = tickerFetch.data;
  if (!tickerData) {
    const detail = `Unable to fetch ticker data (${tickerFetch.failureMode ?? "unknown"}).`;
    const strategistDiagnosticRequestId = getStrategistRunContext()?.requestId;
    const result: StrategistV2Result = {
      status: "no_viable_setup",
      ticker,
      fetchFailureMode: tickerFetch.failureMode ?? undefined,
      blockReason: {
        category: "MISSING_DATA",
        detail,
        suggestedAction: "Verify the ticker symbol and check market data feed/token status, then retry.",
      },
      regime,
      systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
      ...(strategistDiagnosticRequestId ? { strategistDiagnosticRequestId } : {}),
    };
    await emitFullDiagnosticTelemetry({
      ticker,
      settings,
      regime,
      ioScore: null,
      tickerData: null,
      toxicCheck,
      telemetryDbResult: "no_data",
      aiDecision: null,
      thesis: detail,
      extras: {
        fetchFailureMode: tickerFetch.failureMode ?? "network_exception",
      },
    });
    return withResultSchemaVersion(result);
  }

  if (tickerData.halted) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData,
      { category: "STOCK_HALTED", detail: "Stock is halted.", suggestedAction: "Wait for the halt to lift and retry." },
      null);
  }

  const analystRatingsPack = await fetchPolygonAnalystRatingsAndConsensus(ticker, 300);
  const symU = ticker.toUpperCase().replace(/^\$/, "");
  const [fmpPt, fmpGrades, fmpSurprises] = await Promise.all([
    getAnalystPriceTargets(symU),
    getRecentAnalystGrades(symU, 30),
    getEarningsSurpriseHistory(symU, 8),
  ]);
  const baseConsensus =
    analystRatingsPack?.analystConsensus
    ?? emptyConsensus(symU, analystRatingsPack ? null : "polygon_ratings_unavailable");
  const analystConsensusMerged = fmpPt
    ? mergeFmpPriceTargetIntoConsensus(baseConsensus, fmpPt)
    : baseConsensus;

  tickerData.analystActions48h = analystActionsFromPolygonRatings(
    analystRatingsPack?.ratings?.slice(0, 50) ?? [],
  );

  const chainResult = await fetchOptionsChain(ticker, settings);
  assertAnalyzeNotCancelled(progress);
  const chain = chainResult.chain;
  const dataSource = chainResult.source;
  if (!chain || chain.length === 0) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData,
      { category: "MISSING_DATA", detail: "No options chain available for this ticker.", suggestedAction: "Verify the ticker has listed options." },
      null, { dataSource });
  }
  const pricedCount = chain.filter(c => c.bid > 0 || c.ask > 0).length;
  logger.info({ ticker, chainLength: chain.length, pricedCount, dataSource }, "StrategistV2: options chain loaded");
  if (pricedCount === 0) {
    return noViable(ticker, regime, settings, toxicCheck, tickerData,
      { category: "PRICING_MARKET_CLOSED", detail: "Options chain loaded but all contracts have zero pricing.", suggestedAction: "Retry after market open (9:30 AM ET)." },
      null, { dataSource });
  }

  // IVR comes from equity_daily.ivr (EOD, BSM, 252-day rank). No live-chain
  // fallback — if no row exists, narrative + header both omit IVR rather than
  // showing a fabricated number.
  const storedIvr = await getStoredIVR(ticker);
  assertAnalyzeNotCancelled(progress);
  tickerData.ivr = storedIvr?.ivr ?? null;
  tickerData.ivrAsOfDate = storedIvr?.asOfDate ?? null;
  tickerData.ivrSource = storedIvr?.source ?? null;
  logger.info(
    { ticker, ivr: tickerData.ivr, ivrAsOfDate: storedIvr?.asOfDate ?? null, ivrSource: storedIvr?.source ?? null },
    storedIvr
      ? "StrategistV2: IVR loaded from equity_daily.ivr (EOD)"
      : "StrategistV2: no stored IVR for ticker — IVR will be omitted from narrative and header",
  );

  const chainSummary = await summarizeOptionsChain(chain, tickerData.price, {
    ticker,
    settings,
    earningsDate: tickerData.earningsDate,
  });

  let deskCatalystEval: CatalystEvaluation | null = null;
  let deskCatalystExpirationISO = "";
  deskCatalystExpirationISO = computeDeskCatalystExpirationISO(chainSummary, settings);
  assertAnalyzeNotCancelled(progress);
  try {
    deskCatalystEval = await evaluateCatalyst({
      ticker,
      expirationISO: deskCatalystExpirationISO,
      ai: null,
    });
  } catch (err) {
    logger.warn(
      { err, ticker, expirationISO: deskCatalystExpirationISO },
      "StrategistV2: evaluateCatalyst failed for catalyst block — continuing without desk catalyst block",
    );
    deskCatalystEval = null;
  }

  const catalystInfo = deriveCatalyst(tickerData);
  const ioScore = await computeIOScore(
    ticker,
    catalystInfo,
    settings,
    deskCatalystEval,
    tickerData.earningsDaysAway,
  );

  const [realizedVol, realIvDepth] = await Promise.all([
    getRealizedVolFromEquityDaily(ticker, tickerData.lastEarningsDate),
    countRealIvHistoryDays(ticker),
  ]);
  assertAnalyzeNotCancelled(progress);
  let proxyIvDepth: number | null = null;
  if (tickerData.ivrSource === "hv_proxy" && tickerData.ivrAsOfDate) {
    proxyIvDepth = await countProxyIvHistoryDays(ticker, tickerData.ivrAsOfDate);
  }

  reconcileFlowScoreFromChain(ioScore, chainSummary, ticker);

  logger.info({
    ticker,
    availableExpirations: chainSummary.availableExpirations,
    expirationCount: chainSummary.availableExpirations.length,
    curatedExpirationCount: chainSummary.curatedExpirations.length,
    curatedExpirations: chainSummary.curatedExpirations.map(e => ({
      expiration: e.expiration,
      dte: e.dte,
      bucket: e.bucket,
      strikeCount: e.strikes.length,
    })),
  }, "StrategistV2: expirations being sent to AI model");

  let tapeBackfillStatus: TapeBackfillStatus | undefined;
  status("Loading session options tape…");
  try {
    const fc = await requestFlowCapture(ticker, {
      chain,
      chainSummary: {
        atmStrike: chainSummary.atmStrike,
        availableExpirations: chainSummary.availableExpirations,
        curatedExpirations: chainSummary.curatedExpirations.map((e) => ({
          expiration: e.expiration,
          dte: e.dte,
        })),
      },
      marketCapTier: tickerData.marketContext.tier,
      timeout: 120_000,
    });
    let boundsOpen = 0;
    let boundsClose = 0;
    try {
      const b = await rthBoundsMs(fc.sessionDate);
      boundsOpen = b.openMs;
      boundsClose = b.closeMs;
    } catch {
      /* ignore */
    }
    tapeBackfillStatus = fc.tapeBackfill
      ? {
          ...fc.tapeBackfill,
          captureSource: fc.source,
          captureDurationMs: fc.durationMs,
        }
      : ({
          status: fc.rowsInserted > 0 ? "complete" : "skipped",
          reason: fc.errors.length ? fc.errors.join("; ") : null,
          tapeBackfillReason: fc.rowsInserted > 0 ? "live_complete" : "skipped_other",
          sessionDate: fc.sessionDate,
          coverageEndMs: Date.now(),
          occRequested: fc.occsSubscribed,
          occCompleted: fc.occsSubscribed,
          tradesInserted: fc.rowsInserted,
          totalTradesFromPolygon: fc.rowsInserted,
          persistRejectedCount: 0,
          anyTruncated: false,
          anySawPolygonHttpError: false,
          todayYmd: nyCalendarYmd(new Date()),
          isSessionForToday: fc.sessionDate === nyCalendarYmd(new Date()),
          sessionInProgress: false,
          queryOpenMs: boundsOpen,
          queryCloseMs: boundsClose,
      captureSource: fc.source,
      captureDurationMs: fc.durationMs,
      tapeBackfillDedupeDrops: { totalDropped: 0, byOcc: {} },
    } satisfies TapeBackfillStatus);
    logger.info(
      {
        ticker,
        tapeBackfill: tapeBackfillStatus.status,
        tradesInserted: tapeBackfillStatus.tradesInserted,
        occCompleted: tapeBackfillStatus.occCompleted,
        captureSource: fc.source,
      },
      "StrategistV2: session flow capture finished",
    );
  } catch (err) {
    logger.warn({ err, ticker }, "StrategistV2: session tape backfill threw");
    const nowExc = new Date();
    const todayYmdExc = nyCalendarYmd(nowExc);
    let sessionDateExc = todayYmdExc;
    let queryOpenMsExc = Date.now();
    let queryCloseMsExc = Date.now();
    try {
      sessionDateExc = await lastCompletedTradingDayNy(nowExc);
      const b = await rthBoundsMs(sessionDateExc);
      queryOpenMsExc = b.openMs;
      queryCloseMsExc = b.closeMs;
    } catch {
      /* leave sessionDateExc and bounds as best-effort */
    }
    tapeBackfillStatus = {
      status: "failed",
      reason: "exception",
      tapeBackfillReason: "skipped_other",
      sessionDate: sessionDateExc,
      coverageEndMs: Date.now(),
      occRequested: 0,
      occListLength: 0,
      occCompleted: 0,
      tradesInserted: 0,
      totalTradesFromPolygon: 0,
      persistRejectedCount: 0,
      anyTruncated: false,
      anySawPolygonHttpError: false,
      todayYmd: todayYmdExc,
      isSessionForToday: sessionDateExc === todayYmdExc,
      sessionInProgress: false,
      queryOpenMs: queryOpenMsExc,
      queryCloseMs: queryCloseMsExc,
      tapeBackfillDedupeDrops: { totalDropped: 0, byOcc: {} },
    };
  }

  mergeStrategistDiag({ tapeBackfillStatus });
  assertAnalyzeNotCancelled(progress);
  const polygonHighlights = await getPolygonFlowHighlights(ticker, tapeBackfillStatus);
  if (polygonHighlights) {
    logger.info({
      ticker,
      asOfDate: polygonHighlights.asOfDate,
      unusualStrikes: polygonHighlights.unusualStrikeCount,
      unusualSkew: polygonHighlights.unusualSkew,
    }, "StrategistV2: Polygon flow highlights loaded");
  } else {
    logger.info({ ticker }, "StrategistV2: no Polygon flow highlights for ticker");
  }

  const [companyFinancials] = await Promise.all([
    fetchCompanyFinancialsForSymbol(ticker),
  ]);
  const analystConsensus = analystConsensusMerged;
  assertAnalyzeNotCancelled(progress);
  const fundamentalsSummary = companyFinancials ? fundamentalsQuickSummary(companyFinancials) : null;

  let earningsEnrichment: FetchEarningsBundle | null = null;
  try {
    earningsEnrichment = await fetchEarningsHistoryAndForward(ticker);
  } catch (err) {
    logger.warn({ err, ticker }, "StrategistV2: fetchEarningsHistoryAndForward failed");
    earningsEnrichment = null;
  }
  assertAnalyzeNotCancelled(progress);

  let dataPackage = await buildDataPackage(
    ticker,
    tickerData,
    chainSummary,
    ioScore,
    regime,
    settings,
    polygonHighlights,
    deskCatalystEval,
    deskCatalystExpirationISO,
    {
      realizedVol,
      ivrContext: buildIvrContext(tickerData, realIvDepth, proxyIvDepth),
    },
    tapeBackfillStatus,
    {
      chainSource: dataSource,
      analystConsensus,
      analystRatings: analystRatingsPack?.ratings ?? null,
      fundamentalsSummary,
      earnings: earningsEnrichment,
      fmpAnalystGrades: fmpGrades,
      fmpEarningsSurprises: fmpSurprises,
    },
  );
  const scanCtxHandoff = getStrategistRunContext()?.scannerContext;
  if (scanCtxHandoff) {
    try {
      const pkgObj = JSON.parse(dataPackage) as Record<string, unknown>;
      pkgObj.scannerContext = scanCtxHandoff;
      dataPackage = JSON.stringify(pkgObj);
    } catch {
      /* keep original string */
    }
  }
  assertAnalyzeNotCancelled(progress);
  mergeStrategistDiag({ dataPackageStr: dataPackage });

  // ── Desk mode (mode 3): three parallel analysts + PM ──────────────────
  if (settings.strategistMode === 3) {
    status("Starting Desk analysis (four topic sections)…");
    try {
      const deskResultRaw = await runDeskAnalysis({
        dataPackage,
        settings,
        ticker,
        deskExpirationISO: deskCatalystExpirationISO,
        catalystEvaluation: deskCatalystEval,
        callbacks: {
          jobId: progress?.jobId,
          cancelSignal: progress?.cancelSignal,
          onStatus: (s) => status(s),
          onTurnStart: progress?.onTurnStart ? (turn) => progress.onTurnStart!(turn as any) : undefined,
          onTurnDelta: progress?.onTurnDelta,
          onTurnDone: progress?.onTurnDone,
          onTurnDiscarded: progress?.onTurnDiscarded,
        },
      });
      const deskResult = attachDeskPmPayoffScenarios(deskResultRaw, dataPackage);
      const result: StrategistV2Result = {
        status: "desk_recommendation",
        ticker,
        deskResult,
        strategistOutcome: deskResult.pmOutputIncomplete
          ? "ANALYSIS_INCOMPLETE"
          : deskResult.pm.decision === "pass"
            ? "NO_TRADE"
            : undefined,
        ...(deskResult.pmOutputIncomplete
          ? {
              blockReason: {
                category: "ANALYSIS_INCOMPLETE" as const,
                detail:
                  deskResult.errors?.find((e) => e.startsWith("PM output failed")) ??
                  "PM output did not match the required JSON schema after retry.",
                suggestedAction: "Retry the analysis.",
                outcomeMeta: { incompleteRole: "pm" },
              },
            }
          : {}),
        regime,
        systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
        ioScore,
      };
      const tradeRec = deskResult.pm.decision === "trade";
      const outcomeOv = deriveRunOutcomeFromStrategistResult("desk_recommendation", tradeRec);
      const telemetryId = await emitFullDiagnosticTelemetry({
        ticker,
        settings,
        regime,
        ioScore,
        tickerData,
        toxicCheck,
        telemetryDbResult: "recommendation",
        aiDecision: null,
        thesis: null,
        extras: { dataPackage, deskResult, runOutcomeOverride: outcomeOv },
      });
      result.telemetryId = telemetryId ?? undefined;
      result.strategistDiagnosticRequestId = getStrategistRunContext()?.requestId;
      result.diagnosticView = buildStrategistDiagnosticView({
        dataPackageStr: dataPackage,
        deskResult,
        catalystEvaluation: deskCatalystEval,
        diag: getStrategistRunContext()?.diag,
      });
      return withResultSchemaVersion(result);
    } catch (err) {
      logger.error({ err, ticker }, "StrategistV2: Desk analysis failed");
      return noViable(ticker, regime, settings, toxicCheck, tickerData,
        { category: "ANALYSIS_INCOMPLETE", detail: `Desk analysis failed: ${err instanceof Error ? err.message : String(err)}`, suggestedAction: "Retry the analysis." },
        ioScore, { dataSource, dataPackage });
    }
  }

  // ── Solo Desk (mode 4): one consolidated LLM pass, same DeskResult shape ──
  if (settings.strategistMode === 4) {
    status("Starting Solo Desk analysis (single pass, Vol + Flow + Catalyst + PM)…");
    try {
      const deskResultRaw = await runSoloDesk({
        dataPackage,
        settings,
        ticker,
        deskExpirationISO: deskCatalystExpirationISO,
        catalystEvaluation: deskCatalystEval,
        callbacks: {
          jobId: progress?.jobId,
          cancelSignal: progress?.cancelSignal,
          onStatus: (s) => status(s),
          onTurnStart: progress?.onTurnStart ? (turn) => progress.onTurnStart!(turn as any) : undefined,
          onTurnDelta: progress?.onTurnDelta,
          onTurnDone: progress?.onTurnDone,
          onTurnDiscarded: progress?.onTurnDiscarded,
        },
      });
      const deskResult = attachDeskPmPayoffScenarios(deskResultRaw, dataPackage);
      const incomplete =
        deskResult.pmOutputIncomplete ||
        deskResult.soloDeskJsonDegraded === "schema_validation_failed_after_retry" ||
        (deskResult.errors?.some((e) => e.startsWith("Solo Desk output failed validation")) ?? false);
      const result: StrategistV2Result = {
        status: "desk_recommendation",
        ticker,
        deskResult,
        strategistOutcome: incomplete
          ? "ANALYSIS_INCOMPLETE"
          : deskResult.pm.decision === "pass"
            ? "NO_TRADE"
            : undefined,
        ...(incomplete
          ? {
              blockReason: {
                category: "ANALYSIS_INCOMPLETE" as const,
                detail:
                  deskResult.errors?.find((e) => e.startsWith("Solo Desk output failed")) ??
                  "Solo Desk output did not match the required JSON schema after retry.",
                suggestedAction: "Retry the analysis.",
                outcomeMeta: { incompleteRole: "pm" },
              },
            }
          : {}),
        regime,
        systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
        ioScore,
      };
      const tradeRec = deskResult.pm.decision === "trade";
      const outcomeOv = deriveRunOutcomeFromStrategistResult("desk_recommendation", tradeRec);
      const telemetryId = await emitFullDiagnosticTelemetry({
        ticker,
        settings,
        regime,
        ioScore,
        tickerData,
        toxicCheck,
        telemetryDbResult: "recommendation",
        aiDecision: null,
        thesis: null,
        extras: { dataPackage, deskResult, runOutcomeOverride: outcomeOv },
      });
      result.telemetryId = telemetryId ?? undefined;
      result.strategistDiagnosticRequestId = getStrategistRunContext()?.requestId;
      result.diagnosticView = buildStrategistDiagnosticView({
        dataPackageStr: dataPackage,
        deskResult,
        catalystEvaluation: deskCatalystEval,
        diag: getStrategistRunContext()?.diag,
      });
      return withResultSchemaVersion(result);
    } catch (err) {
      logger.error({ err, ticker }, "StrategistV2: Solo Desk analysis failed");
      return noViable(ticker, regime, settings, toxicCheck, tickerData,
        { category: "ANALYSIS_INCOMPLETE", detail: `Solo Desk analysis failed: ${err instanceof Error ? err.message : String(err)}`, suggestedAction: "Retry the analysis." },
        ioScore, { dataSource, dataPackage });
    }
  }

  const isDebateMode = settings.strategistMode === 2;
  status(isDebateMode ? "Starting strategist debate…" : "Calling AI for trade recommendation…");
  let aiResponse: AiTradeResponse;
  let webTrace: WebSearchTrace;
  let rawAiResponseText: string;
  // Solo-mode override: pick the user-selected solo model, not aiLab default.
  const soloModel = !isDebateMode ? getStrategistModel(settings.strategistSoloModelIdx) : undefined;
  try {
    if (isDebateMode) {
      // Build the same canonical the post-synthesis scrub uses (see ~line 805)
      // so the per-turn debate scrubber substitutes identical values.
      // Without this, transcript turns shown to the user keep raw `{{IVR}}` /
      // `{{PC_RATIO}}` placeholders even though the final card is clean.
      const debateScrubCanonical: ScrubCanonical = {
        ivr: tickerData.ivr,
        pcRatio: Number.isFinite(chainSummary?.putCallVolumeRatio) ? chainSummary.putCallVolumeRatio : null,
      };
      const r = await callAiForTradeViaDebate(dataPackage, settings, progress, debateScrubCanonical);
      aiResponse = r.response;
      webTrace = r.trace;
      rawAiResponseText = r.rawText;
    } else {
      const r = await callAiForTrade(dataPackage, undefined, progress, soloModel);
      aiResponse = r.response;
      webTrace = r.trace;
      rawAiResponseText = r.rawText;
    }
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: AI trade call failed");
    return noViable(ticker, regime, settings, toxicCheck, tickerData,
      { category: "ANALYSIS_INCOMPLETE", detail: `AI analysis failed: ${err instanceof Error ? err.message : String(err)}`, suggestedAction: "Retry the analysis. If it persists, check AI provider credentials and rate limits." },
      ioScore, { dataSource, dataPackage });
  }

  // Guard against AI responses with missing/non-numeric confidence — previously
  // `aiResponse.confidence < 20` was silently false for `undefined`, allowing
  // confidence-less recommendations to ship. Coerce here once.
  if (!Number.isFinite(aiResponse.confidence)) {
    logger.warn({ ticker, raw: aiResponse.confidence }, "StrategistV2: AI returned non-numeric confidence — defaulting to 0");
    aiResponse.confidence = 0;
  }

  if (aiResponse.confidence < 20) {
    const blocked = await noViable(ticker, regime, settings, toxicCheck, tickerData,
      { category: "NO_TRADE", detail: `No compelling setup (confidence ${aiResponse.confidence}): ${aiResponse.thesis}`, suggestedAction: "Wait for a clearer setup or try a different ticker." },
      ioScore, {
      dataSource, dataPackage, rawAiResponse: rawAiResponseText,
      confidenceBase: aiResponse.confidence, confidenceFinal: aiResponse.confidence,
      catalystAlignment: aiResponse.catalystAlignment ?? null,
    });
    blocked.contextSources = buildContextSources(aiResponse, webTrace);
    return blocked;
  }

  const validationResult = validateAiResponse(aiResponse, chain, settings);
  if (!validationResult.valid) {
    try {
      status("Retrying with corrections…");
      const retryPrompt = buildRetryPrompt(aiResponse, validationResult.issues);
      // For Solo: retry on the user-selected solo model.
      // For Debate: retry as a Solo call on Strategist A's model — debating a
      // failed schema is not worth 6 more LLM calls.
      const retryModel = isDebateMode
        ? getStrategistModel(settings.strategistDebateAModelIdx)
        : soloModel;
      const r2 = await callAiForTrade(dataPackage, retryPrompt, progress, retryModel);
      aiResponse = r2.response;
      rawAiResponseText = r2.rawText;
      if (!Number.isFinite(aiResponse.confidence)) {
        logger.warn({ ticker, raw: aiResponse.confidence }, "StrategistV2: AI retry returned non-numeric confidence — defaulting to 0");
        aiResponse.confidence = 0;
      }
      // Keep original trace; retry typically does not re-search.
      if (r2.trace.queries.length > 0) webTrace = r2.trace;

      const retryValidation = validateAiResponse(aiResponse, chain, settings);
      if (!retryValidation.valid) {
        return noViable(ticker, regime, settings, toxicCheck, tickerData,
          { category: "ANALYSIS_INCOMPLETE", detail: `Recommendation failed validation after retry: ${retryValidation.issues.join("; ")}`, suggestedAction: "Retry — the AI may pick a different structure on a fresh run." },
          ioScore,
          { dataSource, dataPackage, rawAiResponse: rawAiResponseText, confidenceBase: aiResponse.confidence, confidenceFinal: aiResponse.confidence, catalystAlignment: aiResponse.catalystAlignment ?? null });
      }
    } catch (err) {
      logger.error({ err, ticker }, "StrategistV2: AI retry failed");
      return noViable(ticker, regime, settings, toxicCheck, tickerData,
        { category: "ANALYSIS_INCOMPLETE", detail: `AI retry failed: ${err instanceof Error ? err.message : String(err)}`, suggestedAction: "Retry the analysis. If it persists, check AI provider credentials and rate limits." },
        ioScore,
        { dataSource, dataPackage, rawAiResponse: rawAiResponseText });
    }
  }

  // ── Catalyst evaluation (swing-trader frame) ──
  // Compute a unified evaluation: server-confirmed scheduled events (earnings,
  // FOMC, HIGH-impact econ releases) BETWEEN now and the proposed expiration,
  // merged with AI-supplied non-scheduled signals (product launches, M&A,
  // analyst actions, residual catalysts). The legacy "same-day catalyst" frame
  // is retired here — it incorrectly blocked valid swing setups.
  const farLegExpiration = aiResponse.legs.reduce(
    (max, l) => (l.expiration && l.expiration > max ? l.expiration : max),
    aiResponse.legs[0]?.expiration ?? "",
  );
  const catalystEval = await evaluateCatalyst({
    ticker,
    expirationISO: farLegExpiration,
    ai: aiResponse.catalyst ?? null,
    tradeDirection: deriveTradeDirection(aiResponse.strategy, aiResponse.legs),
  });

  // Stop computing legacy `sameDayCatalyst`. It's still in the schema for
  // historical record compatibility but new analyses always emit false.
  aiResponse.sameDayCatalyst = false;

  // No-edge gate (replaces the legacy day-trader version). Only fires when
  // ALL of: macro regime has no direction, no scheduled catalyst between now
  // and expiry, AND no recently-fired residual catalyst. Default behaviour is
  // WARN — most valid 28-60 DTE swing setups (post-earnings drift, mean
  // reversion, vol regime, trend continuation) deliberately have no scheduled
  // catalyst by definition.
  const regimeIsNoEdge =
    regime.directionalConviction === "NEUTRAL" ||
    regime.directionalConviction === "TRANSITION";
  // Only NAME_SPECIFIC (or BOTH) catalysts and residuals supply a real edge
  // when the regime is neutral. MACRO_ONLY (FOMC/CPI/PCE) is ambient — those
  // events fire constantly and don't justify a single-name trade by
  // themselves, so they do NOT suppress the gate.
  const hasIdioCatalyst =
    catalystEval.catalystScope === "NAME_SPECIFIC" ||
    catalystEval.catalystScope === "BOTH";
  const noEdgeCondition =
    regimeIsNoEdge && !hasIdioCatalyst && !catalystEval.residualCatalyst;
  let noEdgeWarn: string | null = null;
  if (noEdgeCondition) {
    const behaviorIdx = (settings as { noEdgeGateBehavior?: number }).noEdgeGateBehavior ?? 2;
    const behavior: "BLOCK" | "WARN" | "IGNORE" =
      behaviorIdx === 1 ? "BLOCK" : behaviorIdx === 3 ? "IGNORE" : "WARN";
    logger.info(
      {
        ticker,
        regime: regime.directionalConviction,
        catalystInWindow: catalystEval.catalystInWindow,
        catalystScope: catalystEval.catalystScope,
        residualCatalyst: catalystEval.residualCatalyst ?? null,
        behavior,
      },
      "StrategistV2: no-edge condition (regime neutral, no name-specific catalyst, no residual)",
    );
    if (behavior === "BLOCK") {
      const ctx = buildContextSources(aiResponse, webTrace, catalystEval);
      const blocked = await noViable(
        ticker, regime, settings, toxicCheck, tickerData,
        {
          category: "NO_EDGE",
          detail: `Macro regime is ${regime.directionalConviction}, no scheduled catalyst between now and ${farLegExpiration || "expiry"}, no recently-fired residual catalyst. Behavior=BLOCK.`,
          suggestedAction: "Wait for a directional regime, a scheduled catalyst, or change No-Catalyst-In-Window Behavior to WARN.",
        },
        ioScore,
        {
          dataSource, dataPackage, rawAiResponse: rawAiResponseText,
          confidenceBase: aiResponse.confidence, confidenceFinal: aiResponse.confidence,
          catalystAlignment: catalystEval.catalystAlignment === "UNKNOWN" ? null : catalystEval.catalystAlignment,
        },
      );
      blocked.contextSources = ctx;
      return blocked;
    }
    if (behavior === "WARN") {
      const macroNote =
        catalystEval.catalystScope === "MACRO_ONLY"
          ? " (in-window events are macro-only — no name-specific catalyst)"
          : "";
      noEdgeWarn = `⚠ No name-specific catalyst between now and ${farLegExpiration || "expiry"}${macroNote} and macro regime is ${regime.directionalConviction}. Thesis must stand on technical/structural grounds alone.`;
      aiResponse.warnings = aiResponse.warnings ? `${aiResponse.warnings}\n${noEdgeWarn}` : noEdgeWarn;
    }
  }

  // Capture confidence for telemetry. The server does not mutate AI confidence
  // — base, delta, and final are all the same number; the schema retains the
  // delta column so historical records remain comparable.
  const confidenceBaseValue = aiResponse.confidence;
  const confidenceCatalystDeltaValue = 0;
  logger.info(
    {
      ticker,
      confidence: aiResponse.confidence,
      catalystInWindow: catalystEval.catalystInWindow,
      catalystType: catalystEval.catalystType,
      catalystDate: catalystEval.catalystDate,
      catalystAlignment: catalystEval.catalystAlignment,
      residualCatalyst: catalystEval.residualCatalyst ?? null,
    },
    "StrategistV2: catalyst evaluation complete (no confidence mutation applied)",
  );
  const confidenceFinalValue = aiResponse.confidence;

  const legs = mapAiLegsToCandidate(aiResponse, chain);
  const economics = computeSpreadEconomics(legs, aiResponse, ticker);

  // Structural sanity check: compare AI's self-reported maxRisk against
  // the leg-derived maxLoss. For single-expiration structures the leg-derived
  // value is canonical (computeSpreadEconomics overwrites the AI value), so a
  // large discrepancy signals either AI mispricing or a structure the engine
  // mis-models (e.g. a ratio that slipped past validation). Multi-expiration
  // structures legitimately diverge because calendar/diagonal economics depend
  // on volatility, so we skip the check for them.
  const expirationsForLegs = new Set(legs.map(l => l.expiration));
  const isMultiExpirationCheck = expirationsForLegs.size > 1;
  const aiSelfReportedMaxRisk = aiResponse.maxRisk;
  const computedMaxLossCheck = economics.maxLoss;
  if (
    !isMultiExpirationCheck &&
    aiSelfReportedMaxRisk > 0 &&
    computedMaxLossCheck > 0
  ) {
    const denom = Math.max(aiSelfReportedMaxRisk, computedMaxLossCheck);
    const discrepancy = Math.abs(aiSelfReportedMaxRisk - computedMaxLossCheck) / denom;
    if (discrepancy > 0.5) {
      const struct = economics.structure;
      const ratio = computedMaxLossCheck / Math.max(aiSelfReportedMaxRisk, 1);
      // If we recognized the structure as two verticals AND the discrepancy is
      // in the "validator priced full strike range vs. AI priced one wing"
      // ballpark (>2x), the validator is the suspect — retrying the AI will
      // not help. Surface diagnostics instead of advising a retry.
      const validatorSuspect = struct !== null && (ratio > 2 || ratio < 0.5);

      const structureLabel = struct
        ? (struct.kind === "iron_condor_or_butterfly"
            ? "iron condor / iron butterfly"
            : "same-side condor / butterfly")
        : "unrecognized multi-leg";
      const wingBreakdown = struct
        ? ` put_wing=$${struct.wing1Width.toFixed(2)}, call_wing=$${struct.wing2Width.toFixed(2)}, max_wing=$${struct.maxWingWidth.toFixed(2)}`
        : "";
      const entryLabel = economics.isCredit ? "credit" : "debit";

      logger.warn({
        ticker,
        strategy: aiResponse.strategy,
        structureClassification: structureLabel,
        partition: struct,
        netEntry: economics.entryAbs,
        isCredit: economics.isCredit,
        aiMaxRisk: aiSelfReportedMaxRisk,
        computedMaxLoss: computedMaxLossCheck,
        discrepancy: Math.round(discrepancy * 100),
        validatorSuspect,
      }, "StrategistV2: economics validation failed — AI maxRisk vs computed maxLoss differ by >50%");

      const detail =
        `economics validation failed: structure=${structureLabel}, ` +
        `net ${entryLabel}=$${economics.entryAbs.toFixed(2)},${wingBreakdown} ` +
        `validator maxRisk=$${computedMaxLossCheck.toFixed(2)}, ` +
        `AI maxRisk=$${aiSelfReportedMaxRisk.toFixed(2)} ` +
        `(discrepancy ${Math.round(discrepancy * 100)}%)`;
      const suggestedAction = validatorSuspect
        ? "Validator-side mismatch on a recognized two-vertical structure — inspect partition and per-wing widths above; retrying the AI will not help."
        : "Retry — the AI may pick a structure that prices cleanly on a fresh run.";

      const ctx = buildContextSources(aiResponse, webTrace, catalystEval);
      const mismatchCategory: RejectionCategory = struct ? "ECONOMICS_MISMATCH" : "UNKNOWN_STRUCTURE";
      const blocked = await noViable(
        ticker, regime, settings, toxicCheck, tickerData,
        {
          category: mismatchCategory,
          detail,
          suggestedAction,
          outcomeMeta: struct
            ? { aiMaxRisk: aiSelfReportedMaxRisk, computedMaxLoss: computedMaxLossCheck }
            : {
                attemptedStructure: aiResponse.strategy,
                recognizedStructureTypes:
                  "vertical spreads, iron condor / iron butterfly (4 legs same expiry), calendars/diagonals (multi-expiry), straddles/strangles, ratios with covered shorts",
              },
        },
        ioScore,
        {
          dataSource,
          dataPackage,
          rawAiResponse: rawAiResponseText,
          confidenceBase: aiResponse.confidence,
          confidenceFinal: aiResponse.confidence,
          catalystAlignment: aiResponse.catalystAlignment ?? null,
        },
      );
      blocked.contextSources = ctx;
      return blocked;
    }
  }

  const isCredit = economics.isCredit;
  const entryAbs = economics.entryAbs;
  const entryRangeMin = economics.entryRangeMin;
  const entryRangeMax = economics.entryRangeMax;
  const maxProfit = economics.maxProfit;
  const maxLoss = economics.maxLoss;
  const breakeven = aiResponse.breakeven.length > 0 ? aiResponse.breakeven[0] : tickerData.price;

  // Bug 2: scrub narrative so cited numbers match computed economics
  const reconciledThesis = reconcileNarrativeEconomics(
    aiResponse.thesis ?? "",
    { entryAbs, isCredit, maxProfit, maxLoss, breakeven },
    ticker,
  );
  aiResponse.thesis = reconciledThesis;

  // Bug 3: normalize exit targets so profitTarget/stopLoss are always per-share option price,
  // then clamp profitTarget so it cannot exceed the structure's max physical payout.
  const normalizedExitTargets = normalizeExitTargets(
    aiResponse.exitTargets,
    entryAbs,
    maxProfit,
    maxLoss,
    ticker,
    isCredit,
  );

  // Bug 2: scrub narrative for hallucinated IVR / P/C ratio mentions and
  // substitute the canonical values from the data payload. The model has
  // demonstrated it will invent IVR values despite the grounding-discipline
  // rule, so we post-process every narrative field before display.
  const canonical = {
    ivr: tickerData.ivr,
    pcRatio: Number.isFinite(chainSummary?.putCallVolumeRatio) ? chainSummary.putCallVolumeRatio : null,
  };
  const scrubAndLog = (text: string, fieldName: string): string => {
    if (!text) return text;
    const r = scrubAll(text, canonical);
    if (r.replacements.length > 0) {
      logger.warn(
        { ticker, narrativeField: fieldName, replacements: r.replacements, canonical },
        "StrategistV2: narrative scrubber replaced AI-cited values with canonical payload values",
      );
    }
    return r.text;
  };
  aiResponse.thesis = scrubAndLog(aiResponse.thesis ?? "", "thesis");
  aiResponse.riskOfRuin = scrubAndLog(aiResponse.riskOfRuin ?? "", "riskOfRuin");
  aiResponse.warnings = aiResponse.warnings != null
    ? scrubAndLog(aiResponse.warnings, "warnings")
    : aiResponse.warnings;
  aiResponse.bullInvalidation = scrubAndLog(aiResponse.bullInvalidation ?? "", "bullInvalidation");
  aiResponse.bearInvalidation = scrubAndLog(aiResponse.bearInvalidation ?? "", "bearInvalidation");
  aiResponse.companyContext = scrubAndLog(aiResponse.companyContext ?? "", "companyContext");

  const firstLeg = aiResponse.legs[0];
  const expiration = firstLeg?.expiration ?? "";
  const expDate = new Date(expiration);
  const dte = Math.max(0, Math.round((expDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

  // Earnings-inside-expiry gate (uses unified earningsService data on tickerData).
  // For multi-expiration structures (calendar/diagonal/etc) compare against the LATEST
  // leg expiration so we don't miss earnings that fall inside the long-side leg.
  let earningsAlert: StrategistV2Result["earningsAlert"] | undefined;
  let earningsBlockReason: string | null = null;
  const horizonExpiration = aiResponse.legs.reduce(
    (max, l) => (l.expiration && l.expiration > max ? l.expiration : max),
    expiration,
  );
  const horizonDate = new Date(horizonExpiration);
  const horizonDte = Math.max(
    0,
    Math.round((horizonDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
  );
  if (tickerData.earningsDate && horizonExpiration) {
    const evDate = new Date(tickerData.earningsDate + "T16:00:00-04:00");
    if (!Number.isNaN(evDate.getTime()) && !Number.isNaN(horizonDate.getTime())) {
      const insideExpiry =
        evDate.getTime() >= Date.now() && evDate.getTime() <= horizonDate.getTime();
      if (insideExpiry) {
        const behaviorIdx = settings.earningsInsideExpiryBehavior ?? 2;
        const behavior: "BLOCK" | "WARN" | "IGNORE" =
          behaviorIdx === 1 ? "BLOCK" : behaviorIdx === 3 ? "IGNORE" : "WARN";
        earningsAlert = {
          earningsDate: tickerData.earningsDate,
          daysUntilEarnings: tickerData.earningsDaysAway,
          daysUntilExpiry: horizonDte,
          insideExpiry: true,
          behavior,
          source: tickerData.earningsSource,
          confirmed: tickerData.earningsConfirmed,
        };
        earningsBlockReason = behavior === "BLOCK" ? "EARNINGS_INSIDE_EXPIRY_BLOCK" : "EARNINGS_INSIDE_EXPIRY_WARN";
        logger.warn({
          ticker,
          earningsDate: tickerData.earningsDate,
          daysUntilEarnings: tickerData.earningsDaysAway,
          firstLegDte: dte,
          horizonDte,
          horizonExpiration,
          behavior,
          source: tickerData.earningsSource,
        }, "StrategistV2: earnings falls inside option expiry");

        if (behavior === "BLOCK") {
          const ctx = buildContextSources(aiResponse, webTrace, catalystEval);
          const blocked = await noViable(
            ticker, regime, settings, toxicCheck, tickerData,
            {
              category: "EARNINGS_INSIDE_EXPIRY",
              detail: `Earnings ${tickerData.earningsDate} (${tickerData.earningsConfirmed ? "confirmed" : "estimated"}, ${tickerData.earningsSource ?? "n/a"}) falls inside ${horizonDte}-DTE expiration ${horizonExpiration}. Behavior=BLOCK.`,
              suggestedAction: "Choose a closer expiration that ends before the earnings release, or change Earnings Inside Expiry Behavior to WARN.",
            },
            ioScore,
            {
              dataSource,
              dataPackage,
              rawAiResponse: rawAiResponseText,
              confidenceBase: aiResponse.confidence,
              confidenceFinal: aiResponse.confidence,
              catalystAlignment: aiResponse.catalystAlignment ?? null,
            },
          );
          blocked.contextSources = ctx;
          blocked.earningsAlert = earningsAlert;
          return blocked;
        }

        if (behavior === "WARN") {
          const warnLine = `⚠ Earnings ${tickerData.earningsDate} falls inside expiry ${horizonExpiration} (DTE ${horizonDte}). Position will hold through earnings.`;
          aiResponse.warnings = aiResponse.warnings
            ? `${aiResponse.warnings}\n${warnLine}`
            : warnLine;
        }
      }
    }
  }

  const direction = inferDirection(aiResponse.strategy, aiResponse.legs);
  const idioStrengthPct = Math.round(ioScore.final * 100);
  const macroPct = 100 - idioStrengthPct;

  const strategyLine = buildStrategyLine(ticker, aiResponse);

  const result: StrategistV2Result = {
    status: "recommendation",
    ticker,
    recommendation: {
      strategyLine,
      companyContext: aiResponse.companyContext || "",
      thesis: aiResponse.thesis,
      rationale: aiResponse.thesis,
      edgeAttribution: `Edge source: Idiosyncratic ${idioStrengthPct}% / Macro ${macroPct}%`,
      idioStrengthPct,
      macroPct,
      strategyType: aiResponse.strategy,
      direction,
      legs,
      credit: isCredit ? entryAbs : undefined,
      debit: !isCredit ? entryAbs : undefined,
      entryRangeMin,
      entryRangeMax,
      maxProfit,
      maxLoss,
      breakeven,
      riskReward: maxLoss > 0 ? maxProfit / maxLoss : 0,
      dte,
      expiration,
      exitTargets: normalizedExitTargets,
      bullInvalidation: aiResponse.bullInvalidation || "",
      bearInvalidation: aiResponse.bearInvalidation || "",
      riskOfRuin: aiResponse.riskOfRuin || "",
      confidence: aiResponse.confidence,
      warnings: aiResponse.warnings,
      contextSources: buildContextSources(aiResponse, webTrace, catalystEval),
    },
    contextSources: buildContextSources(aiResponse, webTrace, catalystEval),
    regime,
    ioScore,
    systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    earningsAlert,
  };
  if (earningsBlockReason) {
    logger.info({ ticker, earningsBlockReason, earningsAlert }, "StrategistV2: earnings telemetry");
  }

  const telemetryId = await emitFullDiagnosticTelemetry({
    ticker,
    settings,
    regime,
    ioScore,
    tickerData,
    toxicCheck,
    telemetryDbResult: "recommendation",
    aiDecision: {
      strategy: aiResponse.strategy,
      strategyType: aiResponse.strategy,
      confidence: Number.isFinite(aiResponse.confidence) ? aiResponse.confidence : 0,
      aiRationale: aiResponse.thesis,
      warnings: aiResponse.warnings,
      legs: aiResponse.legs,
      entryPrice: aiResponse.entryPrice,
      maxRisk: aiResponse.maxRisk,
      maxProfit: aiResponse.maxProfit,
      breakeven: aiResponse.breakeven,
      catalystAlignment: aiResponse.catalystAlignment ?? null,
      sameDayCatalyst: aiResponse.sameDayCatalyst ?? false,
    },
    thesis: result.recommendation?.strategyLine ?? null,
    extras: {
      dataPackage,
      rawAiResponse: rawAiResponseText,
      confidenceBase: confidenceBaseValue,
      confidenceCatalystDelta: confidenceCatalystDeltaValue,
      confidenceFinal: confidenceFinalValue,
      catalystAlignment: aiResponse.catalystAlignment ?? null,
      dataSource,
      aiTradePayload: aiResponse,
      runOutcomeOverride: "trade",
    },
  });
  result.telemetryId = telemetryId ?? undefined;
  result.strategistDiagnosticRequestId = getStrategistRunContext()?.requestId;

  return withResultSchemaVersion(result);
}

function computeDte(expiration: string): number {
  const expMs = new Date(expiration + "T16:00:00-05:00").getTime();
  return Math.max(0, Math.round((expMs - Date.now()) / (24 * 60 * 60 * 1000)));
}

/** Aligns with bsmIV.ts default (4.5%). */
const CHAIN_BSM_RISK_FREE = 0.045;

export type { IvClampedReasonKey } from "./strategistIvClampCompat.js";
export { normalizeIvClampedReasonsForPayload } from "./strategistIvClampCompat.js";

export interface BsmRecomputeStats {
  contractsRecomputed: number;
  avgDisagreementPct: number | null;
  maxDisagreementPct: number | null;
  contractsAbove10pctDisagreement: number;
}

export interface IvChainFilterStats {
  ivClampedCount: number;
  ivClampedReasons: Record<IvClampedReasonKey, number>;
  /** IV survival ratio within ±10% of spot (curated strip); primary desk hygiene metric. */
  ivCleanedRatio: number;
  /** Legacy ratio: positive vendor IV surviving cleaning / all positive vendor IV on full chain. */
  ivCleanedRatioFullChain: number;
  /** Curated strip: expiries with a non-null ATM IV vs expiries in the curated term sample. */
  termStructureExpiries: { withCleanAtmIv: number; total: number };
  /** Total option legs in the summarized chain (denominator for contamination share). */
  totalChainContracts: number;
  /**
   * Contracts counted toward **iv_contamination_elevated** (may exclude closed-session
   * noLiquidity / spreadExceedsMid removals while **ivClampedCount** still includes them).
   */
  ivContaminationCountedClamps: number;
  bsmRecomputeStats: BsmRecomputeStats;
}

export type IvChainFilterCore = Pick<
  IvChainFilterStats,
  | "ivClampedCount"
  | "ivClampedReasons"
  | "ivCleanedRatio"
  | "ivCleanedRatioFullChain"
  | "totalChainContracts"
  | "ivContaminationCountedClamps"
  | "bsmRecomputeStats"
>;

const IV_HARD_CEILING_DECIMAL = 4.0;
const BSM_RECOMPUTE_RF = 0.05;

/**
 * Wide spreads and zero day volume are normal on wings. Strict thresholds correctly
 * reject ATM noise but incorrectly reject usable wing IV. Tiered thresholds keep
 * wing data when it is structurally valid even if microstructure looks worse than ATM.
 */
const IV_WING_NEAR_ATM_PCT = 0.05;
const IV_WING_MID_PCT = 0.15;
/** Denominator band for **ivCleanedRatio** (±10% of spot, positive vendor IV). */
const IV_CURATED_RATIO_BAND_PCT = 0.1;

function atmDistancePct(strike: number, spot: number): number {
  if (!Number.isFinite(spot) || spot <= 0) return 0;
  return Math.abs(strike - spot) / spot;
}

function medianNumeric(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function primaryIvRemovalReasonSteps1to6(c: ChainContract, spot: number): IvClampedReasonKey | null {
  const iv = c.impliedVolatility;
  if (typeof iv === "number" && Number.isFinite(iv) && iv === 5.0) return "sentinel";
  if (typeof iv === "number" && Number.isFinite(iv) && iv >= IV_HARD_CEILING_DECIMAL) return "ceilingClamp";

  const bid = c.bid;
  const ask = c.ask;
  if (bid == null || !Number.isFinite(bid) || bid <= 0) return "oneSidedMarket";
  if (ask == null || !Number.isFinite(ask) || ask <= 0) return "oneSidedMarket";
  if (ask < bid) return "oneSidedMarket";

  if (ask <= 0.05) return "pennyOption";

  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  if (!Number.isFinite(mid) || mid <= 0) return "invalidMid";

  const wing = atmDistancePct(c.strike, spot);
  const spreadMul = wing <= IV_WING_NEAR_ATM_PCT ? 1 : wing <= IV_WING_MID_PCT ? 1.5 : 2;
  if (spread > spreadMul * mid) return "spreadExceedsMid";

  const vol = Number.isFinite(c.volume) ? c.volume : 0;
  const oi = Number.isFinite(c.openInterest) ? c.openInterest : 0;
  if (wing <= IV_WING_NEAR_ATM_PCT) {
    if (vol === 0 && oi < 10) return "noLiquidity";
  } else if (wing <= IV_WING_MID_PCT) {
    if (vol === 0 && oi < 5) return "noLiquidity";
  } else if (oi < 1) {
    return "noLiquidity";
  }

  return null;
}

function applySurfaceOutlierPass(
  chain: ChainContract[],
  ivClampedReasons: Record<IvClampedReasonKey, number>,
): number {
  const byBucket = new Map<string, ChainContract[]>();
  for (const c of chain) {
    if (c.impliedVolatility == null || !Number.isFinite(c.impliedVolatility) || c.impliedVolatility <= 0) continue;
    const side = c.type === "call" || c.optionType === "CALL" ? "call" : "put";
    const key = `${c.expiration}|${side}`;
    const arr = byBucket.get(key) ?? [];
    arr.push(c);
    byBucket.set(key, arr);
  }

  let removed = 0;
  for (const [, legs] of byBucket) {
    const ivs = legs.map((x) => x.impliedVolatility!).filter((v) => v > 0);
    const med = medianNumeric(ivs);
    if (med == null || med <= 0) continue;
    for (const c of legs) {
      const v = c.impliedVolatility!;
      if (v > 3.0 && v > 2 * med) {
        c.impliedVolatility = null;
        c.reconstructedIV = null;
        c.reconstructedIVSource = null;
        ivClampedReasons.surfaceOutlier += 1;
        removed += 1;
      }
    }
  }
  return removed;
}

function attachBsmRecomputeStats(chain: ChainContract[], spot: number): BsmRecomputeStats {
  let contractsRecomputed = 0;
  let sumDisagreement = 0;
  let maxDisagreement = 0;
  let above10 = 0;
  let disagreementCount = 0;

  for (const c of chain) {
    c.recomputedIv = undefined;
    c.recomputedIvAvailable = false;
    c.recomputedIvDisagreementPct = undefined;

    if (c.impliedVolatility == null || !Number.isFinite(c.impliedVolatility)) continue;

    const bid = c.bid;
    const ask = c.ask;
    if (bid == null || !Number.isFinite(bid) || ask == null || !Number.isFinite(ask)) continue;
    const mid = (bid + ask) / 2;
    if (!Number.isFinite(mid) || mid <= 0) continue;

    const dteRaw = c.dte > 0 ? c.dte : computeDte(c.expiration);
    const dte = Number.isFinite(dteRaw) ? dteRaw : NaN;
    if (!Number.isFinite(dte) || dte < 1) continue;

    const ot = c.type === "call" || c.optionType === "CALL" ? "call" : "put";
    const solved = recomputeImpliedVolFromMid({
      optionType: ot,
      spot,
      strike: c.strike,
      daysToExpiry: dte,
      mid,
      riskFreeRate: BSM_RECOMPUTE_RF,
      dividendYield: 0,
    });

    if (solved == null) {
      c.recomputedIvAvailable = false;
      continue;
    }

    c.recomputedIv = solved;
    c.recomputedIvAvailable = true;
    contractsRecomputed += 1;

    const vendorIv = c.impliedVolatility;
    if (vendorIv > 0) {
      const dpct = Math.abs(vendorIv - solved) / vendorIv;
      c.recomputedIvDisagreementPct = Math.round(dpct * 10000) / 10000;
      sumDisagreement += dpct;
      disagreementCount += 1;
      if (dpct > maxDisagreement) maxDisagreement = dpct;
      if (dpct > 0.1) above10 += 1;
    }
  }

  return {
    contractsRecomputed,
    avgDisagreementPct:
      disagreementCount > 0 ? Math.round((sumDisagreement / disagreementCount) * 10000) / 10000 : null,
    maxDisagreementPct: disagreementCount > 0 ? Math.round(maxDisagreement * 10000) / 10000 : null,
    contractsAbove10pctDisagreement: above10,
  };
}

/**
 * Nulls contaminated chain IVs (contract stays in chain; volume/OI unchanged).
 * Sets **rawIv** to the pre-filter decimal IV. Clears BSM reconstruction on stripped rows.
 */
export function filterContaminatedIvs(
  chain: ChainContract[],
  spot: number,
  equityMarketSession: EquityMarketSession = "open",
): { stats: IvChainFilterCore } {
  const ivClampedReasons: Record<IvClampedReasonKey, number> = {
    sentinel: 0,
    ceilingClamp: 0,
    oneSidedMarket: 0,
    pennyOption: 0,
    invalidMid: 0,
    spreadExceedsMid: 0,
    noLiquidity: 0,
    surfaceOutlier: 0,
  };
  let ivClampedCount = 0;
  let ivContaminationCountedClamps = 0;
  let totalPositiveChainIv = 0;
  const totalChainContracts = chain.length;
  const excludeSpreadLiquidityFromContaminationFlag =
    equityMarketSession === "closed";

  for (const c of chain) {
    const raw = c.impliedVolatility;
    c.rawIv = raw == null || !Number.isFinite(raw) ? null : raw;
    const reason = primaryIvRemovalReasonSteps1to6(c, spot);
    if (raw != null && Number.isFinite(raw) && raw > 0) {
      totalPositiveChainIv += 1;
    }
    if (reason != null) {
      ivClampedCount += 1;
      ivClampedReasons[reason] += 1;
      const countsTowardContaminationFlag =
        !excludeSpreadLiquidityFromContaminationFlag
        || (reason !== "noLiquidity" && reason !== "spreadExceedsMid");
      if (countsTowardContaminationFlag) ivContaminationCountedClamps += 1;
      c.impliedVolatility = null;
      c.reconstructedIV = null;
      c.reconstructedIVSource = null;
    }
  }

  const surfaceRemoved = applySurfaceOutlierPass(chain, ivClampedReasons);
  ivClampedCount += surfaceRemoved;
  ivContaminationCountedClamps += surfaceRemoved;

  let survivingPositiveChainIv = 0;
  for (const c of chain) {
    if (c.rawIv != null && Number.isFinite(c.rawIv) && c.rawIv > 0 && c.impliedVolatility != null) {
      survivingPositiveChainIv += 1;
    }
  }

  const ivCleanedRatioFullChain =
    totalPositiveChainIv > 0
      ? Math.round((survivingPositiveChainIv / totalPositiveChainIv) * 10000) / 10000
      : 1;

  let curatedDenom = 0;
  let curatedSurvive = 0;
  for (const c of chain) {
    const raw = c.rawIv;
    if (raw == null || !Number.isFinite(raw) || raw <= 0) continue;
    if (atmDistancePct(c.strike, spot) > IV_CURATED_RATIO_BAND_PCT) continue;
    curatedDenom += 1;
    if (c.impliedVolatility != null && Number.isFinite(c.impliedVolatility) && c.impliedVolatility > 0) {
      curatedSurvive += 1;
    }
  }
  const ivCleanedRatio =
    curatedDenom > 0 ? Math.round((curatedSurvive / curatedDenom) * 10000) / 10000 : 1;

  const bsmRecomputeStats = attachBsmRecomputeStats(chain, spot);

  return {
    stats: {
      ivClampedCount,
      ivClampedReasons,
      ivCleanedRatio,
      ivCleanedRatioFullChain,
      totalChainContracts,
      ivContaminationCountedClamps,
      bsmRecomputeStats,
    },
  };
}

function tryReconstructContractIv(
  c: ChainContract,
  spot: number,
): { pct: number | null; source: ReconstructedIVSource } {
  const bid = c.bid;
  const ask = c.ask;
  if (bid == null || !Number.isFinite(bid) || bid <= 0) return { pct: null, source: "skipped_no_bid" };
  if (ask == null || !Number.isFinite(ask) || ask <= 0) return { pct: null, source: "skipped_no_ask" };
  const mid = (bid + ask) / 2;
  if (!Number.isFinite(mid) || mid <= 0) return { pct: null, source: "skipped_no_bid" };
  const spread = ask - bid;
  if (spread > 0.5 * mid) return { pct: null, source: "skipped_penny_spread" };
  const dte = c.dte > 0 ? c.dte : computeDte(c.expiration);
  if (dte < 1) return { pct: null, source: "skipped_short_dte" };
  const isCall = c.type === "call" || c.optionType === "CALL";
  const sigma = impliedVolatilityBSM({
    spot,
    strike: c.strike,
    dte,
    isCall,
    optionPrice: mid,
    riskFreeRate: CHAIN_BSM_RISK_FREE,
  });
  if (sigma == null) return { pct: null, source: "skipped_no_convergence" };
  const pct = Math.round(sigma * 10000) / 100;
  return { pct, source: "bsm_bisection" };
}

function enrichChainContractsWithReconstructedIv(chain: ChainContract[], spot: number): void {
  for (const c of chain) {
    c.reconstructedIV = null;
    c.reconstructedIVSource = null;
    const n = normalizeStrategistIv(c.impliedVolatility, "chain");
    if (isReliableIv(n)) continue;
    const r = tryReconstructContractIv(c, spot);
    c.reconstructedIV = r.pct;
    c.reconstructedIVSource = r.source;
  }
}

function effectiveLegIv(c: ChainContract): number | null {
  const n = normalizeStrategistIv(c.impliedVolatility, "chain");
  if (isReliableIv(n)) return n.pct;
  if (typeof c.reconstructedIV === "number" && c.reconstructedIV > 0 && c.reconstructedIV <= STRATEGIST_IV_CEILING_PCT) {
    return c.reconstructedIV;
  }
  return null;
}

function atmIvPctForExpiry(
  chain: ChainContract[],
  expiration: string,
  price: number,
  legIvPct: (c: ChainContract) => number | null,
): number | null {
  const calls = chain.filter(c => c.expiration === expiration && (c.type === "call" || c.optionType === "CALL"));
  const puts = chain.filter(c => c.expiration === expiration && (c.type === "put" || c.optionType === "PUT"));
  if (calls.length === 0 || puts.length === 0) return null;
  const callStrike = [...calls].sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0]?.strike;
  const putStrike = [...puts].sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0]?.strike;
  const strike = callStrike != null && putStrike != null
    ? (Math.abs(callStrike - price) <= Math.abs(putStrike - price) ? callStrike : putStrike)
    : (callStrike ?? putStrike ?? null);
  if (strike == null) return null;
  const c = calls.find(x => x.strike === strike) ?? calls.sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0];
  const p = puts.find(x => x.strike === strike) ?? puts.sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0];
  if (!c || !p) return null;
  const callIv = legIvPct(c);
  const putIv = legIvPct(p);
  if (callIv == null || putIv == null) return null;
  return Math.round(((callIv + putIv) / 2) * 100) / 100;
}

function buildTermStructure5pt(
  chain: ChainContract[],
  price: number,
  curatedExpirations: CuratedExpiration[],
  availableExpirations: string[],
  legIvPct: (c: ChainContract) => number | null,
): Array<{ expiry: string; daysToExpiry: number; atmIV: number | null }> {
  const byExp = new Map<string, number | null>();
  for (const ce of curatedExpirations) {
    byExp.set(ce.expiration, atmIvPctForExpiry(chain, ce.expiration, price, legIvPct));
  }
  const allSorted = [...availableExpirations]
    .map(exp => ({ exp, dte: computeDte(exp) }))
    .filter(x => x.dte > 0)
    .sort((a, b) => a.dte - b.dte);
  for (const { exp } of allSorted) {
    if (byExp.has(exp)) continue;
    if (byExp.size >= 12) break;
    const iv = atmIvPctForExpiry(chain, exp, price, legIvPct);
    if (iv != null) byExp.set(exp, iv);
  }
  let points = [...byExp.entries()]
    .map(([expiry, atmIV]) => ({ expiry, daysToExpiry: computeDte(expiry), atmIV }))
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  if (points.length > 12) {
    const n = points.length;
    const idxs = [0, Math.floor(n * 0.2), Math.floor(n * 0.4), Math.floor(n * 0.6), Math.floor(n * 0.8), n - 1];
    const picked = new Map<string, { expiry: string; daysToExpiry: number; atmIV: number | null }>();
    for (const i of idxs) {
      const p = points[Math.min(Math.max(0, i), n - 1)]!;
      picked.set(p.expiry, p);
    }
    points = [...picked.values()].sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  }
  while (points.length < 5) {
    let added = false;
    for (const { exp } of allSorted) {
      if (points.some(p => p.expiry === exp)) continue;
      const iv = atmIvPctForExpiry(chain, exp, price, legIvPct);
      points.push({ expiry: exp, daysToExpiry: computeDte(exp), atmIV: iv });
      points.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
      added = true;
      if (points.length >= 5) break;
    }
    if (!added) break;
  }
  return points;
}

function computeSkew25DeltaForChain(
  chain: ChainContract[],
  availableExpirations: string[],
  price: number,
): { skew: ChainSummary["skew25Delta"]; reason: string } {
  if (availableExpirations.length === 0) {
    return { skew: null, reason: "no_expirations" };
  }
  const withDte = availableExpirations.map(exp => ({ exp, dte: computeDte(exp) })).filter(x => x.dte > 0);
  const anchor = withDte.find(x => x.dte > 7) ?? withDte[0];
  if (!anchor) return { skew: null, reason: "no_valid_expiry" };
  const expOrder = [
    anchor.exp,
    ...withDte
      .filter(x => x.exp !== anchor.exp)
      .sort((a, b) => a.dte - b.dte)
      .map(x => x.exp),
  ];

  const deltaTargets: Array<{ call: number; put: number; tag: "25d" | "20d" | "15d" }> = [
    { call: 0.25, put: -0.25, tag: "25d" },
    { call: 0.2, put: -0.2, tag: "20d" },
    { call: 0.15, put: -0.15, tag: "15d" },
  ];

  let lastSkipReason = "skew_indeterminate_no_liquid_iv_at_target_deltas";
  for (let ei = 0; ei < expOrder.length; ei++) {
    const exp = expOrder[ei]!;
    for (let ti = 0; ti < deltaTargets.length; ti++) {
      const t = deltaTargets[ti]!;
      const calls = chain.filter(
        x => x.expiration === exp && (x.type === "call" || x.optionType === "CALL") && Number.isFinite(x.delta),
      );
      const puts = chain.filter(
        x => x.expiration === exp && (x.type === "put" || x.optionType === "PUT") && Number.isFinite(x.delta),
      );
      if (calls.length === 0 || puts.length === 0) {
        lastSkipReason = `skew_skip_no_delta_slice_${exp}`;
        continue;
      }
      const putPick = [...puts].sort((a, b) => Math.abs(a.delta - t.put) - Math.abs(b.delta - t.put))[0];
      const callPick = [...calls].sort((a, b) => Math.abs(a.delta - t.call) - Math.abs(b.delta - t.call))[0];
      if (!putPick || !callPick) {
        lastSkipReason = `skew_skip_missing_leg_${exp}_${t.tag}`;
        continue;
      }
      const putIvEff = effectiveLegIv(putPick);
      const callIvEff = effectiveLegIv(callPick);
      if (putIvEff == null || callIvEff == null) {
        if (putIvEff == null && callIvEff == null) {
          lastSkipReason = `skew_iv_filtered_both_sides_${exp}_${t.tag}`;
        } else if (putIvEff == null) {
          lastSkipReason = `skew_iv_filtered_put_${exp}_${t.tag}`;
        } else {
          lastSkipReason = `skew_iv_filtered_call_${exp}_${t.tag}`;
        }
        continue;
      }
      const skewPoints = Math.round((putIvEff - callIvEff) * 100) / 100;
      const skew: ChainSummary["skew25Delta"] = {
        putIV: putIvEff,
        callIV: callIvEff,
        skewPoints,
        asOfExpiry: exp,
      };
      if (ei === 0 && ti === 0) return { skew, reason: "clean_25d_first_expiry" };
      if (ei === 0 && ti === 1) {
        return { skew, reason: "skew_fallback_20d_same_expiry_after_25d_ceiling" };
      }
      if (ei === 0 && ti === 2) {
        return { skew, reason: "skew_fallback_15d_same_expiry_after_25d_ceiling" };
      }
      return {
        skew,
        reason: `skew_fallback_${t.tag}_expiry_${exp}_after_prior_clamped_or_missing`,
      };
    }
  }

  return { skew: null, reason: lastSkipReason };
}

/** Maps computeImpliedMoveStraddle output to payload-quality fields for dataQualitySummary. */
function strategistImpliedMoveQualityFromResult(r: ImpliedMoveResult): StrategistImpliedMoveQuality {
  if (r.value === null) {
    return {
      available: false,
      reason: r.reason,
      fallbackExpiryUsed: null,
    };
  }
  return {
    available: true,
    reason: r.reason === "bsm_inversion_failed" ? "bsm_inversion_failed" : "ok",
    fallbackExpiryUsed: r.fallbackExpiryUsed,
  };
}

function computeImpliedMoveStraddle(
  chain: ChainContract[],
  price: number,
  availableExpirations: string[],
): ImpliedMoveResult {
  if (availableExpirations.length === 0) {
    return { value: null, reason: "no_expirations" };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { value: null, reason: "no_spot_price" };
  }

  const frontExp = availableExpirations[0]!;
  let chosenExp: string | null = null;
  let chosenDte = 0;
  for (const candidate of availableExpirations) {
    const candidateDte = computeDte(candidate);
    if (candidateDte > 0) {
      chosenExp = candidate;
      chosenDte = candidateDte;
      break;
    }
  }
  if (chosenExp == null) {
    return { value: null, reason: "no_valid_dte" };
  }

  const fallbackExpiryUsed = chosenExp !== frontExp ? chosenExp : null;
  const exp = chosenExp;
  const dte = chosenDte;

  const calls = chain.filter(c => c.expiration === exp && (c.type === "call" || c.optionType === "CALL"));
  const puts = chain.filter(c => c.expiration === exp && (c.type === "put" || c.optionType === "PUT"));
  if (calls.length === 0 || puts.length === 0) {
    return { value: null, reason: "no_atm_pair" };
  }
  const strike = [...new Set([...calls.map(c => c.strike), ...puts.map(c => c.strike)])]
    .sort((a, b) => Math.abs(a - price) - Math.abs(b - price))[0];
  if (strike == null) {
    return { value: null, reason: "no_atm_pair" };
  }
  const c = calls.find(x => x.strike === strike);
  const p = puts.find(x => x.strike === strike);
  if (!c || !p) {
    return { value: null, reason: "no_atm_pair" };
  }
  const callMid = (c.bid + c.ask) / 2;
  const putMid = (p.bid + p.ask) / 2;
  if (!Number.isFinite(callMid) || !Number.isFinite(putMid)) {
    return { value: null, reason: "non_finite_mids" };
  }
  const dollar = Math.round((callMid + putMid) * 1000) / 1000;
  const percentOfSpot = Math.round((dollar / price) * 10000) / 100;
  const sigmaDec = impliedVolFromAtmStraddle({
    spot: price,
    strike,
    dteCalendarDays: dte,
    straddleMidPerShare: dollar,
    riskFreeAnnual: 0.045,
    dividendYieldAnnual: 0,
  });
  const ivNorm = sigmaDec != null ? normalizeStrategistIv(sigmaDec, "reconstructed_from_straddle") : null;
  const value: NonNullable<ChainSummary["impliedMove"]> = {
    dollar,
    percentOfSpot,
    expiry: exp,
    daysToExpiry: dte,
    impliedVolStraddlePct: ivNorm?.pct ?? null,
    impliedVolStraddleSource: ivNorm != null ? "bsm_match_mid" : null,
  };
  if (sigmaDec == null || ivNorm == null) {
    return { value, reason: "bsm_inversion_failed", fallbackExpiryUsed };
  }
  return { value, reason: "ok", fallbackExpiryUsed };
}

/** Latest listed expiry within prefsMax DTE, or null if none. */
function deskWindowIsoFromAvailableExpiries(availableExpirations: string[], prefsMax: number): string | null {
  let best: string | null = null;
  let bestDte = -1;
  for (const exp of availableExpirations) {
    const dte = computeDte(exp);
    if (dte <= 0 || dte > prefsMax) continue;
    if (dte > bestDte) {
      bestDte = dte;
      best = exp;
    }
  }
  return best;
}

function deskWindowSyntheticIso(prefsMax: number): string {
  const t = Date.now() + prefsMax * 86_400_000;
  const u = new Date(t);
  const y = u.getUTCFullYear();
  const m = String(u.getUTCMonth() + 1).padStart(2, "0");
  const d = String(u.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Desk mode: far edge of the user's preferred DTE window for catalyst evaluation
 * (matches "position window" before any trade legs exist).
 */
function computeDeskCatalystExpirationISO(chainSummary: ChainSummary, settings: StrategistConfig): string {
  const prefsMax = Math.max(1, settings.preferredDteMax | 0);
  const fromAvail = deskWindowIsoFromAvailableExpiries(chainSummary.availableExpirations, prefsMax);
  if (fromAvail) return fromAvail;
  let best: string | null = null;
  let bestDte = -1;
  for (const ce of chainSummary.curatedExpirations) {
    const dte = ce.dte;
    if (dte <= 0 || dte > prefsMax) continue;
    if (dte > bestDte) {
      bestDte = dte;
      best = ce.expiration;
    }
  }
  if (best) return best;
  return deskWindowSyntheticIso(prefsMax);
}

function curatedLegFromContract(c: ChainContract): CuratedOptionLeg {
  const rawDec = c.rawIv;
  const rawNorm = rawDec != null && Number.isFinite(rawDec) && rawDec > 0
    ? normalizeStrategistIv(rawDec, "chain")
    : null;
  const n = normalizeStrategistIv(c.impliedVolatility, "chain");
  const ivPct =
    c.impliedVolatility == null || !Number.isFinite(c.impliedVolatility)
      ? null
      : isReliableIv(n)
        ? n.pct
        : null;
  const leg: CuratedOptionLeg = {
    bid: c.bid,
    ask: c.ask,
    iv: ivPct,
    delta: Math.round((c.delta ?? 0) * 1000) / 1000,
    volume: c.volume,
    oi: c.openInterest,
  };
  if (rawNorm != null && Number.isFinite(rawNorm.pct)) leg.raw_iv = rawNorm.pct;
  if (n.clamped || n.unreliable) leg.iv_unreliable = true;
  if (c.impliedVolatility == null && rawDec != null && rawDec > 0) leg.iv_unreliable = true;
  return leg;
}

function buildCuratedStrikes(
  chain: ChainContract[],
  expiration: string,
  atmStrike: number,
): CuratedStrike[] {
  const expContracts = chain.filter(c => c.expiration === expiration);
  const expCalls = expContracts.filter(c => c.type === "call" || c.optionType === "CALL");
  const expPuts = expContracts.filter(c => c.type === "put" || c.optionType === "PUT");

  // Collect all strikes to include: ATM±5 + top-5 volume each side + unusual activity
  const includeStrikes = new Set<number>();

  // Sort all strikes for this expiration to find ATM±5 index positions
  const allStrikes = [...new Set([...expCalls, ...expPuts].map(c => c.strike))].sort((a, b) => a - b);
  const atmIdx = allStrikes.reduce((best, s, i) =>
    Math.abs(s - atmStrike) < Math.abs(allStrikes[best] - atmStrike) ? i : best, 0);
  const lo = Math.max(0, atmIdx - 5);
  const hi = Math.min(allStrikes.length - 1, atmIdx + 5);
  for (let i = lo; i <= hi; i++) includeStrikes.add(allStrikes[i]);

  // Top-5 volume calls/puts
  [...expCalls].sort((a, b) => b.volume - a.volume).slice(0, 5).forEach(c => includeStrikes.add(c.strike));
  [...expPuts].sort((a, b) => b.volume - a.volume).slice(0, 5).forEach(c => includeStrikes.add(c.strike));

  // Unusual activity (vol/OI >= 2)
  for (const c of expContracts) {
    if (c.openInterest > 0 && c.volume / c.openInterest >= 2) includeStrikes.add(c.strike);
  }

  // Build merged strike-level objects
  const callByStrike = new Map(expCalls.map(c => [c.strike, c]));
  const putByStrike = new Map(expPuts.map(c => [c.strike, c]));

  const result: CuratedStrike[] = [];
  for (const strike of [...includeStrikes].sort((a, b) => a - b)) {
    const c = callByStrike.get(strike);
    const p = putByStrike.get(strike);
    const entry: CuratedStrike = { strike };
    if (c) {
      entry.call = curatedLegFromContract(c);
      if (c.openInterest > 0 && c.volume / c.openInterest >= 2) entry.unusualCall = true;
    }
    if (p) {
      entry.put = curatedLegFromContract(p);
      if (p.openInterest > 0 && p.volume / p.openInterest >= 2) entry.unusualPut = true;
    }
    if (entry.call || entry.put) result.push(entry);
  }
  return result;
}

function firstListedExpiryOnOrAfter(availableExpirations: string[], anchorYmd: string): string | null {
  const future = availableExpirations.filter((exp) => exp >= anchorYmd && computeDte(exp) > 0).sort();
  return future[0] ?? null;
}

function buildCuratedExpirations(
  chain: ChainContract[],
  price: number,
  mustIncludeExpiries: string[],
): CuratedExpiration[] {
  const allExpirations = [...new Set(chain.map(c => c.expiration))].sort();
  const expSet = new Set(allExpirations);
  const withDte = allExpirations.map(exp => ({ exp, dte: computeDte(exp) }));

  // Detect daily-expiry ticker: >2 expirations within the first 7 DTE
  const near7 = withDte.filter(e => e.dte <= 7);
  const isDaily = near7.length > 2;

  // Bucket selection
  const selected: Array<{ exp: string; dte: number; bucket: CuratedExpiration["bucket"] }> = [];

  // --- 0-7 DTE bucket ---
  const near = withDte.filter(e => e.dte <= 7).sort((a, b) => a.dte - b.dte);
  const nearCap = isDaily ? 2 : 1;
  near.slice(0, nearCap).forEach(e => selected.push({ ...e, bucket: "near_0_7d" }));

  // --- 7-30 DTE bucket ---
  const mid = withDte.filter(e => e.dte > 7 && e.dte <= 30).sort((a, b) => a.dte - b.dte);
  const midCap = isDaily ? 4 : mid.length;
  mid.slice(0, midCap).forEach(e => selected.push({ ...e, bucket: "mid_7_30d" }));

  // --- 30-60 DTE bucket ---
  // For daily-expiry tickers with dense weekly/daily expirations, prefer monthlies in this range
  // Detect monthlies: for each calendar month, pick the expiration with highest total OI (proxy for standard monthly)
  const far = withDte.filter(e => e.dte > 30 && e.dte <= 60).sort((a, b) => a.dte - b.dte);
  let farSelected = far;
  if (isDaily && far.length > 3) {
    // Group by year-month, pick highest-OI expiration per month
    const byMonth = new Map<string, typeof far[0][]>();
    for (const e of far) {
      const ym = e.exp.slice(0, 7);
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push(e);
    }
    farSelected = [];
    for (const [, group] of byMonth) {
      // Pick the one with highest total OI in this expiration
      const best = group.reduce((b, e) => {
        const oi = chain.filter(c => c.expiration === e.exp).reduce((s, c) => s + c.openInterest, 0);
        const bOi = chain.filter(c => c.expiration === b.exp).reduce((s, c) => s + c.openInterest, 0);
        return oi > bOi ? e : b;
      });
      farSelected.push(best);
    }
    farSelected.sort((a, b) => a.dte - b.dte);
  }
  farSelected.slice(0, 3).forEach(e => selected.push({ ...e, bucket: "far_30_60d" }));

  const selectedExps = new Set(selected.map((s) => s.exp));
  for (const exp of mustIncludeExpiries) {
    if (!expSet.has(exp) || selectedExps.has(exp)) continue;
    const dte = computeDte(exp);
    if (dte <= 0) continue;
    selected.push({ exp, dte, bucket: "earnings_capture" });
    selectedExps.add(exp);
  }

  // Determine ATM strike once
  const atmStrike = [...new Set(chain.map(c => c.strike))]
    .sort((a, b) => Math.abs(a - price) - Math.abs(b - price))[0] ?? Math.round(price);

  return selected.map(s => ({
    expiration: s.exp,
    dte: s.dte,
    bucket: s.bucket,
    strikes: buildCuratedStrikes(chain, s.exp, atmStrike),
  }));
}

export interface SummarizeOptionsChainContext {
  ticker?: string;
  settings?: StrategistConfig;
  /** Next earnings YYYY-MM-DD when known (confirmed or estimated). */
  earningsDate?: string | null;
}

export async function summarizeOptionsChain(
  chain: ChainContract[],
  price: number,
  ctx?: SummarizeOptionsChainContext,
): Promise<ChainSummary> {
  enrichChainContractsWithReconstructedIv(chain, price);
  const {
    session: equityMarketSession,
    asOf: marketSessionAsOf,
    sessionSource: marketSessionSource,
  } = await getEquityMarketSessionWithAsOf();
  const { stats: ivChainCore } = filterContaminatedIvs(chain, price, equityMarketSession);

  const calls = chain.filter(c => c.type === "call" || c.optionType === "CALL");
  const puts = chain.filter(c => c.type === "put" || c.optionType === "PUT");

  const atmCalls = calls.filter(c => Math.abs(c.strike - price) / price < 0.02).sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price));
  const atmPuts = puts.filter(c => Math.abs(c.strike - price) / price < 0.02).sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price));
  const atmCall = atmCalls[0];
  const atmPut = atmPuts[0];
  const atmStrike = atmCall?.strike ?? atmPut?.strike ?? Math.round(price);

  // FIX 3–4: IV as decimal → percent; artifact spikes clamped via
  // strategistIvNormalize (STRATEGIST_IV_CEILING_PCT) with per-field clamp count.
  let ivArtifactClampCount = 0;
  const ivToPct = (iv: number | null | undefined): number | null => {
    const n = normalizeStrategistIv(iv, "chain");
    if (n.clamped) ivArtifactClampCount += 1;
    return isReliableIv(n) ? n.pct : null;
  };

  const ivToPctOrZero = (iv: number | null | undefined): number => {
    const n = normalizeStrategistIv(iv, "chain");
    if (n.clamped) ivArtifactClampCount += 1;
    return n.pct;
  };

  const ivToPctOrNullForTop = (iv: number | null | undefined): number | null => {
    if (iv == null || !Number.isFinite(iv)) return null;
    const n = normalizeStrategistIv(iv, "chain");
    if (n.clamped) ivArtifactClampCount += 1;
    return isReliableIv(n) ? n.pct : null;
  };

  const reliableAvgIvPctForContracts = (contracts: ChainContract[]): number | null => {
    let sum = 0;
    let reliableCount = 0;
    for (const c of contracts) {
      const n = normalizeStrategistIv(c.impliedVolatility, "chain");
      if (n.clamped) ivArtifactClampCount += 1;
      const leg = effectiveLegIv(c);
      if (leg != null) {
        sum += leg;
        reliableCount += 1;
      }
    }
    if (reliableCount === 0) return null;
    return Math.round((sum / reliableCount) * 100) / 100;
  };

  const topVolumeCalls = [...calls].sort((a, b) => b.volume - a.volume).slice(0, 5).map(c => ({
    strike: c.strike, expiration: c.expiration, volume: c.volume, oi: c.openInterest,
    bid: c.bid, ask: c.ask, iv: ivToPctOrNullForTop(c.impliedVolatility), delta: c.delta,
  }));
  const topVolumePuts = [...puts].sort((a, b) => b.volume - a.volume).slice(0, 5).map(c => ({
    strike: c.strike, expiration: c.expiration, volume: c.volume, oi: c.openInterest,
    bid: c.bid, ask: c.ask, iv: ivToPctOrNullForTop(c.impliedVolatility), delta: c.delta,
  }));

  const unusualActivity: ChainSummary["unusualActivity"] = [];
  for (const c of chain) {
    if (c.openInterest > 0 && c.volume / c.openInterest >= 2) {
      unusualActivity.push({
        strike: c.strike, type: c.type || (c.optionType === "CALL" ? "call" : "put"),
        expiration: c.expiration, volume: c.volume, oi: c.openInterest, volOiRatio: Math.round(c.volume / c.openInterest * 100) / 100,
      });
    }
  }
  unusualActivity.sort((a, b) => b.volOiRatio - a.volOiRatio);
  if (unusualActivity.length > 10) unusualActivity.length = 10;

  const totalCallVol = calls.reduce((s, c) => s + c.volume, 0);
  const totalPutVol = puts.reduce((s, c) => s + c.volume, 0);
  const putCallVolumeRatio = totalCallVol > 0 ? Math.round(totalPutVol / totalCallVol * 100) / 100 : 0;

  const expirations = [...new Set(chain.map(c => c.expiration))].sort();
  let frontMonthIV: number | null = null;
  let backMonthIV: number | null = null;
  if (expirations.length >= 2) {
    const frontContracts = chain.filter(c => c.expiration === expirations[0]);
    const backContracts = chain.filter(c => c.expiration === expirations[expirations.length - 1]);
    frontMonthIV = reliableAvgIvPctForContracts(frontContracts);
    backMonthIV = reliableAvgIvPctForContracts(backContracts);
  }

  const mustIncludeExpiries: string[] = [];
  const earningsYmd = ctx?.earningsDate ?? null;
  if (earningsYmd && /^\d{4}-\d{2}-\d{2}$/.test(earningsYmd)) {
    const earnDte = computeDte(earningsYmd);
    if (earnDte > 0 && earnDte <= 180) {
      const capture = firstListedExpiryOnOrAfter(expirations, earningsYmd);
      if (capture) {
        mustIncludeExpiries.push(capture);
        const tk = ctx?.ticker ?? "";
        logger.info(
          tk
            ? { ticker: tk, expiry: capture, earningsDate: earningsYmd, bucket: "earnings_capture" }
            : { expiry: capture, earningsDate: earningsYmd, bucket: "earnings_capture" },
          tk
            ? `Curated strip: auto-included ${capture} for earnings event ${earningsYmd} on ${tk}`
            : `Curated strip: auto-included ${capture} for earnings event ${earningsYmd}`,
        );
      }
    }
  }

  if (ctx?.settings) {
    const prefsMax = Math.max(1, ctx.settings.preferredDteMax | 0);
    const fromAvail = deskWindowIsoFromAvailableExpiries(expirations, prefsMax);
    if (fromAvail) {
      const stdStrip = buildCuratedExpirations(chain, price, []);
      const inStd = stdStrip.some(
        (e) =>
          e.expiration === fromAvail
          && (e.bucket === "near_0_7d" || e.bucket === "mid_7_30d" || e.bucket === "far_30_60d"),
      );
      if (!inStd && !mustIncludeExpiries.includes(fromAvail)) {
        mustIncludeExpiries.push(fromAvail);
      }
    }
  }

  const curatedExpirations = buildCuratedExpirations(chain, price, mustIncludeExpiries);

  const termStructure5pt = buildTermStructure5pt(chain, price, curatedExpirations, expirations, effectiveLegIv);
  let withCleanAtmIv = 0;
  for (const ce of curatedExpirations) {
    if (atmIvPctForExpiry(chain, ce.expiration, price, effectiveLegIv) != null) withCleanAtmIv += 1;
  }
  const ivChainFilter: IvChainFilterStats = {
    ...ivChainCore,
    termStructureExpiries: {
      withCleanAtmIv,
      total: curatedExpirations.length,
    },
  };
  const { skew, reason: skew25DeltaReason } = computeSkew25DeltaForChain(chain, expirations, price);
  const impliedMoveResult = computeImpliedMoveStraddle(chain, price, expirations);
  const impliedMove = impliedMoveResult.value;
  const impliedMoveQuality = strategistImpliedMoveQualityFromResult(impliedMoveResult);

  return {
    atmStrike,
    atmCallBid: atmCall?.bid ?? 0,
    atmCallAsk: atmCall?.ask ?? 0,
    atmCallIV: atmCall != null ? effectiveLegIv(atmCall) : null,
    atmCallOI: atmCall?.openInterest ?? 0,
    atmPutBid: atmPut?.bid ?? 0,
    atmPutAsk: atmPut?.ask ?? 0,
    atmPutIV: atmPut != null ? effectiveLegIv(atmPut) : null,
    atmPutOI: atmPut?.openInterest ?? 0,
    topVolumeCalls,
    topVolumePuts,
    unusualActivity,
    putCallVolumeRatio,
    frontMonthIV,
    backMonthIV,
    availableExpirations: expirations,
    curatedExpirations,
    ivArtifactsClampedCount: ivArtifactClampCount,
    ivCeilingPct: STRATEGIST_IV_CEILING_PCT,
    termStructure5pt,
    skew25Delta: skew,
    skew25DeltaReason,
    impliedMove,
    impliedMoveQuality,
    ivChainFilter,
    marketSession: equityMarketSession,
    marketSessionSource,
    marketSessionAsOf,
  };
}

function buildIvrContext(
  tickerData: TickerData,
  realIvDepth: { count: number; asOfDate: string | null },
  proxyIvDepth: number | null,
): { source: "canonical" | "hv_proxy" | null; asOfDate: string | null; daysOfHistory: number | null } {
  const raw = tickerData.ivrSource;
  if (!raw || tickerData.ivr == null) {
    return { source: null, asOfDate: tickerData.ivrAsOfDate, daysOfHistory: null };
  }
  if (raw === "hv_proxy") {
    return {
      source: "hv_proxy",
      asOfDate: tickerData.ivrAsOfDate,
      daysOfHistory: proxyIvDepth != null ? proxyIvDepth : null,
    };
  }
  if (raw === "real_iv" || raw === "canonical" || raw === "chain" || raw === "flow") {
    return {
      source: "canonical",
      asOfDate: tickerData.ivrAsOfDate,
      daysOfHistory: realIvDepth.count > 0 ? realIvDepth.count : null,
    };
  }
  return { source: null, asOfDate: tickerData.ivrAsOfDate, daysOfHistory: null };
}

function fundamentalsQuickSummary(f: CompanyFinancials): Record<string, unknown> {
  const pick = (arr: { end: string; val: number | null }[]) => {
    if (!arr.length) return null;
    const withVal = arr.filter((x): x is { end: string; val: number } =>
      x.val != null && typeof x.val === "number" && Number.isFinite(x.val),
    );
    if (!withVal.length) return null;
    const p = [...withVal].sort((a, b) => a.end.localeCompare(b.end))[withVal.length - 1]!;
    return { asOf: p.end, valUsd: p.val };
  };
  return {
    revenue: pick(f.revenue),
    operatingCashFlow: pick(f.operatingCashFlow),
    capitalExpenditures: pick(f.capitalExpenditures),
    longTermDebt: pick(f.longTermDebt),
    sharesOutstanding: pick(f.sharesOutstanding),
    note: "SEC XBRL companyfacts (US-GAAP); use for cash generation and balance sheet context.",
  };
}

function buildDataQualitySummary(args: {
  ticker: string;
  tickerData: TickerData;
  chainSummary: ChainSummary;
  ioScore: IOScoreResult;
  polygonHighlights: PolygonFlowHighlights | null;
  tapeBackfill?: TapeBackfillStatus;
  enrichment?: {
    chainSource?: ChainSource;
    analystConsensus?: import("./polygonAnalystData.js").PolygonAnalystConsensus | null;
    fundamentalsSummary?: Record<string, unknown> | null;
  };
  earningsDataSourceGaps?: string[] | null;
}): Record<string, unknown> {
  const { tickerData, chainSummary, ioScore, polygonHighlights, tapeBackfill, enrichment, earningsDataSourceGaps } = args;
  const chainOk = chainSummary.availableExpirations.length > 0 && chainSummary.atmStrike > 0;
  const skewState = chainSummary.skew25Delta != null ? "available" : "missing_or_indeterminate";
  const flowTape = polygonHighlights?.sessionTape;
  const tapeKind = flowTape?.tapeKind ?? null;
  const tapeBackfillStatus = tapeBackfill?.status ?? "not_run";
  const fs = enrichment?.fundamentalsSummary;
  const fundamentalsOk = Boolean(
    fs && typeof fs === "object"
      && Object.keys(fs).some((k) => k !== "note" && (fs as Record<string, unknown>)[k] != null),
  );
  const ac = enrichment?.analystConsensus;
  const analystOk = Boolean(
    ac && (
      ac.consensus_price_target != null
      || ac.num_analysts != null
      || ac.consensus_rating != null
      || ac.consensus_rating_value != null
    ),
  );

  const flags: string[] = [];
  if (!chainOk) flags.push("chain_incomplete");
  if (skewState !== "available") flags.push("skew_uncertain");
  if (!ioScore.available) flags.push("io_score_fallback");
  if (!polygonHighlights) flags.push("polygon_flow_highlights_absent");
  if (tapeKind === "eod_fallback") {
    flags.push("classified_session_tape_missing_eod_substitute");
    flags.push("session_tape_eod_synthesis");
  }
  if (tapeKind == null && polygonHighlights) flags.push("session_tape_absent");
  const backfillRan =
    tapeBackfill
    && tapeBackfill.status !== "skipped"
    && tapeBackfill.occRequested > 0;
  const backfillFailed =
    Boolean(backfillRan && tapeBackfill!.status === "failed");
  const backfillPartial =
    Boolean(backfillRan && tapeBackfill!.status === "partial");
  if (backfillFailed || backfillPartial) {
    flags.push("occ_classified_prints_backfill_degraded");
  }
  if (tapeBackfill && tapeBackfill.status !== "complete" && tapeBackfill.status !== "skipped") {
    if (tapeBackfill.tapeBackfillReason !== "already_persisted") {
      flags.push("tape_backfill_incomplete");
    }
  }
  if (!analystOk) flags.push("analyst_consensus_sparse");
  if (!fundamentalsOk) flags.push("sec_fundamentals_sparse");
  if (!chainSummary.impliedMoveQuality.available) flags.push("implied_move_gap");
  if (chainSummary.impliedMoveQuality.reason === "bsm_inversion_failed") {
    flags.push("implied_move_bsm_inversion_failed");
  }

  const ivf = chainSummary.ivChainFilter;
  const contamNumer = ivf.ivContaminationCountedClamps;
  const ivContamShare = ivf.totalChainContracts > 0 ? contamNumer / ivf.totalChainContracts : 0;
  if (ivContamShare > 0.3) flags.push("iv_contamination_elevated");

  const earningsGapList = earningsDataSourceGaps ?? [];

  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    marketSession: chainSummary.marketSession,
    marketSessionSource: chainSummary.marketSessionSource,
    marketSessionAsOf: chainSummary.marketSessionAsOf,
    chain: { state: chainOk ? "usable" : "degraded", expirationsListed: chainSummary.availableExpirations.length },
    ivr: { state: tickerData.ivr != null ? "present" : "absent", source: tickerData.ivrSource },
    skew25Delta: { state: skewState, reason: chainSummary.skew25DeltaReason },
    impliedMove: chainSummary.impliedMoveQuality,
    ioScore: { state: ioScore.available ? "regression_fit" : "fallback_defaults", dataAvailability: ioScore.dataAvailability },
    flow: {
      highlightsAsOf: polygonHighlights?.asOfDate ?? null,
      sessionTapeKind: tapeKind,
      tapeBackfillStatus,
      tapeBackfillReason:
        polygonHighlights?.sessionTape?.tapeBackfillReason ?? tapeBackfill?.tapeBackfillReason ?? null,
      tapeBackfillReasonLegacy: tapeBackfill?.reason ?? null,
      tapeBackfillCoverage: tapeBackfill?.coverageGeometry ?? null,
      tapeBackfillOccCompleted: tapeBackfill?.occCompleted ?? null,
      tapeBackfillOccRequested: tapeBackfill?.occRequested ?? null,
      tapeBackfillWsOccSubscribed: tapeBackfill?.wsOccSubscribed ?? null,
      tapeBackfillTradesInserted: tapeBackfill?.tradesInserted ?? null,
      tapeBackfillTotalTradesFromPolygon: tapeBackfill?.totalTradesFromPolygon ?? null,
      tapeBackfillPersistRejected: tapeBackfill?.persistRejectedCount ?? null,
      tapeBackfillDedupeDropsTotal: tapeBackfill?.tapeBackfillDedupeDrops?.totalDropped ?? null,
      tapeBackfillTruncated: tapeBackfill?.anyTruncated ?? null,
      tapeBackfillHttpError: tapeBackfill?.anySawPolygonHttpError ?? null,
    },
    enrichment: {
      optionsChainSource: enrichment?.chainSource ?? null,
      analystConsensusPresent: analystOk,
      secFundamentalsPresent: fundamentalsOk,
    },
    ivArtifactsClamped: chainSummary.ivArtifactsClampedCount,
    ivClampedCount: ivf.ivClampedCount,
    ivClampedReasons: ivf.ivClampedReasons,
    ivCleanedRatio: ivf.ivCleanedRatio,
    ivCleanedRatioFullChain: ivf.ivCleanedRatioFullChain,
    bsmRecomputeStats: ivf.bsmRecomputeStats,
    termStructureExpiries: ivf.termStructureExpiries,
    flags,
    ...(earningsGapList.length > 0 ? { data_source_gaps: earningsGapList } : {}),
    readThisFirst:
      "Each field reports whether the snapshot slice is present, degraded, or absent. Use null-safe reads; when state is degraded or a flag is set, lower conviction and avoid implying full tape or full skew precision.",
  };
}

async function buildDataPackage(
  ticker: string,
  tickerData: TickerData,
  chainSummary: ChainSummary,
  ioScore: IOScoreResult,
  regime: StructuredRegime,
  settings: StrategistConfig,
  polygonHighlights: PolygonFlowHighlights | null,
  catalystEvaluation?: CatalystEvaluation | null,
  deskCatalystWindowExpirationISO?: string,
  volPackageExtras?: {
    realizedVol: Awaited<ReturnType<typeof getRealizedVolFromEquityDaily>> | null;
    ivrContext: ReturnType<typeof buildIvrContext>;
  },
  tapeBackfill?: TapeBackfillStatus,
  enrichment?: {
    chainSource?: ChainSource;
    analystConsensus?: import("./polygonAnalystData.js").PolygonAnalystConsensus | null;
    analystRatings?: import("./polygonAnalystData.js").PolygonAnalystRatingRow[] | null;
    fundamentalsSummary?: Record<string, unknown> | null;
    /** Polygon Benzinga earnings history plus forward estimates (when API returns data). */
    earnings?: FetchEarningsBundle | null;
    fmpAnalystGrades?: import("./fmpDataService.js").AnalystGradeDbRow[] | null;
    fmpEarningsSurprises?: import("./fmpDataService.js").EarningsSurpriseDbRow[] | null;
  },
): string {
  const currentDate = new Date().toISOString().slice(0, 10);
  const rawRv = volPackageExtras?.realizedVol ?? null;
  const realizedVolPayload =
    rawRv == null
      ? null
      : {
          hv20: rawRv.hv20,
          hv30: rawRv.hv30,
          asOfDate: rawRv.asOfDate,
          hv20EarningsContaminated: rawRv.hv20EarningsContaminated,
          hv30EarningsContaminated: rawRv.hv30EarningsContaminated,
          earningsDateInWindow:
            (rawRv.hv20EarningsContaminated || rawRv.hv30EarningsContaminated) && tickerData.lastEarningsDate
              ? tickerData.lastEarningsDate
              : null,
        };
  const dataQualitySummary = buildDataQualitySummary({
    ticker,
    tickerData,
    chainSummary,
    ioScore,
    polygonHighlights,
    tapeBackfill,
    enrichment,
    earningsDataSourceGaps: enrichment?.earnings?.data_source_gaps ?? null,
  });
  const pkg: Record<string, unknown> = {
    schemaVersion: 1,
    dataQualitySummary,
    ticker,
    currentDate,
    price: tickerData.price,
    dailyChangePct: tickerData.dailyChangePct,
    ivr: tickerData.ivr,
    avgVolume20d: tickerData.avgVolume20d,
    relativeVolume: tickerData.relativeVolume,
    sector: tickerData.sector,
    marketContext: {
      marketCapUsd: tickerData.marketContext.marketCapUsd,
      tier: tickerData.marketContext.tier,
      isEtf: tickerData.marketContext.isEtf,
      schwabAssetType: tickerData.schwabAssetType,
      largeNotionalThresholdUsd: tickerData.marketContext.largeNotionalThresholdUsd,
      tierBoundaryProximity: tickerData.marketContext.tierBoundaryProximity,
      note:
        "Large-print persistence and flow scoring use tier-adjusted notional thresholds (higher for mega/large caps, lower for small/micro; ETFs use index/sector/niche bands). tierBoundaryProximity means market cap is within ~10% of a tier boundary — treat flow significance with extra care.",
    },
    optionsChainSource: enrichment?.chainSource ?? null,
    polygonAnalyst: enrichment?.analystConsensus
      ? {
          consensus: enrichment.analystConsensus,
          consensusPriceTargetAsOfDate: enrichment.analystConsensus.consensusPriceTargetAsOfDate,
          consensusPriceTargetFreshness: enrichment.analystConsensus.consensusPriceTargetFreshness,
          recentRatings: enrichment.analystRatings?.slice(0, 15) ?? [],
          sourceNote:
            "Polygon REST reference analyst ratings (120-day firm dedupe + mean consensus), merged with FMP `analyst_price_targets` when Polygon consensus is sparse.",
        }
      : { available: false },
    fmpAnalystGrades: enrichment?.fmpAnalystGrades?.length
      ? {
          windowDays: 30,
          rows: enrichment.fmpAnalystGrades.slice(0, 25),
          sourceNote: "FMP `/stable/grades` backfill into `analyst_grades` (weekly refresh).",
        }
      : { available: false },
    fmpEarningsSurprises: enrichment?.fmpEarningsSurprises?.length
      ? {
          quarters: enrichment.fmpEarningsSurprises,
          sourceNote: "FMP `/stable/earnings-surprises` backfill into `earnings_surprises_history` (weekly refresh).",
        }
      : { available: false },
    secFundamentals: enrichment?.fundamentalsSummary ?? { available: false },
    earningsDaysAway: tickerData.earningsDaysAway,
    earningsWithin48h: tickerData.earningsWithin48h,
    lastEarningsDate: tickerData.lastEarningsDate,
    daysSinceEarnings: tickerData.daysSinceEarnings,
    nextEarnings: tickerData.nextEarnings,
    tickerDataNote: tickerData.tickerDataNote ?? null,
    analystActions48h: tickerData.analystActions48h,
    optionsChainSummary: {
      atmStrike: chainSummary.atmStrike,
      atmCall: { bid: chainSummary.atmCallBid, ask: chainSummary.atmCallAsk, iv: chainSummary.atmCallIV, oi: chainSummary.atmCallOI },
      atmPut: { bid: chainSummary.atmPutBid, ask: chainSummary.atmPutAsk, iv: chainSummary.atmPutIV, oi: chainSummary.atmPutOI },
      topVolumeCalls: chainSummary.topVolumeCalls,
      topVolumePuts: chainSummary.topVolumePuts,
      unusualActivity: chainSummary.unusualActivity.length > 0 ? chainSummary.unusualActivity : "none",
      putCallVolumeRatio: chainSummary.putCallVolumeRatio,
      termStructure: chainSummary.frontMonthIV != null && chainSummary.backMonthIV != null
        ? { frontMonthIV: chainSummary.frontMonthIV, backMonthIV: chainSummary.backMonthIV }
        : "insufficient data",
      termStructure5pt: chainSummary.termStructure5pt,
      skew25Delta: chainSummary.skew25Delta,
      skew25DeltaReason: chainSummary.skew25DeltaReason,
      impliedMove: chainSummary.impliedMove,
      impliedMoveQuality: chainSummary.impliedMoveQuality,
      ivChainFilter: chainSummary.ivChainFilter,
      ivArtifactNote:
        chainSummary.ivChainFilter.ivClampedCount > 0 || chainSummary.ivArtifactsClampedCount > 0
          ? [
              chainSummary.ivChainFilter.ivClampedCount > 0
                ? `${chainSummary.ivChainFilter.ivClampedCount} contract(s) had chain IV removed by deterministic microstructure, liquidity, and surface consistency filters (see dataQualitySummary.ivClampedReasons). Term-structure and skew inputs use surviving IVs only; **raw_iv** on curated legs preserves the pre-filter IV in percent when you need to audit a strike.`
                : null,
              chainSummary.ivArtifactsClampedCount > 0
                ? `${chainSummary.ivArtifactsClampedCount} raw value(s) exceeded ${chainSummary.ivCeilingPct}% normalization ceiling (legacy counter; structural IV should already reflect ivChainFilter).`
                : null,
            ]
              .filter(Boolean)
              .join(" ")
          : null,
    },
    curatedExpirations: chainSummary.curatedExpirations,
    availableExpirations: chainSummary.availableExpirations,
    realizedVol: realizedVolPayload,
    ivrContext: volPackageExtras?.ivrContext ?? { source: null, asOfDate: null, daysOfHistory: null },
    polygonFlowHighlights: polygonHighlights ? {
      asOfDate: polygonHighlights.asOfDate,
      totalCallVolume: polygonHighlights.totalCallVolume,
      totalPutVolume: polygonHighlights.totalPutVolume,
      putCallVolumeRatio: polygonHighlights.putCallVolumeRatio,
      unusualStrikeCount: polygonHighlights.unusualStrikeCount,
      unusualSkew: polygonHighlights.unusualSkew,
      unusualCallVolume: polygonHighlights.unusualCallVolume,
      unusualPutVolume: polygonHighlights.unusualPutVolume,
      topByVolume: polygonHighlights.topByVolume,
      topByVolOiRatio: polygonHighlights.topByVolOiRatio,
      largestPrint: polygonHighlights.largestPrint,
      sessionTape: polygonHighlights.sessionTape,
      sessionTapeDate: polygonHighlights.sessionTapeDate,
      sourceNote:
        "Per-strike end-of-day snapshot (volume, OI, greeks). sessionTape.tapeKind `live` adds classified prints and aggressor mix; topPrints may include syntheticLegGroupId / multiLegConfidence / extras when the flow pipeline detected time-correlated legs or repeat same-side clusters. `eod_fallback` is volume-ranked EOD synthesis when live tape rows are absent (sweep/block zero; do not infer aggressor).",
    } : { available: false, note: "No per-strike flow snapshot on file for this ticker — fall back to optionsChainSummary.unusualActivity." },
    ioScore: {
      final: ioScore.final,
      classification: ioScore.classification,
      beta: ioScore.beta,
      residualReturnZScore: ioScore.residualReturnZScore,
      components: {
        marketIndependence: ioScore.components.marketIndependence.contribution,
        abnormalMove: ioScore.components.abnormalMove.contribution,
        catalyst: { value: ioScore.components.catalyst.flagValue, reason: ioScore.components.catalyst.reason },
        flowDivergence: { volOiRatio: ioScore.components.flowDivergence.volOiRatio, skewDivergence: ioScore.components.flowDivergence.skewDivergence },
      },
    },
    regime: {
      directionalConviction: regime.directionalConviction,
      systemicRiskLevel: regime.systemicRiskLevel,
      correlationRegime: regime.correlationRegime,
    },
    userPreferences: {
      preferredDteMin: settings.preferredDteMin,
      preferredDteMax: settings.preferredDteMax,
      ...(deskCatalystWindowExpirationISO
        ? { deskCatalystPositionWindowExpirationISO: deskCatalystWindowExpirationISO }
        : {}),
      spreadWidth: settings.spreadWidth,
      // Tells the model whether spreadWidth above is a hard cap or merely a
      // suggestion. When unlimited, the user has explicitly opted out of any
      // width constraint — the agent should size the spread to the thesis,
      // and the user will adjust at execution time.
      spreadWidthMode: settings.spreadWidthUnlimited === 1
        ? "UNLIMITED — disregard the spreadWidth value above and pick whatever width best fits your thesis. The user will adjust at execution."
        : `HARD CAP — do not propose a spread wider than $${settings.spreadWidth}.`,
      minOpenInterest: settings.minOpenInterest,
      maxBidAskSpreadPct: settings.maxBidAskSpreadPct,
    },
  };

  if (enrichment?.earnings) {
    pkg.catalyst = {
      earnings_history: enrichment.earnings.earnings_history,
      forward_estimates: enrichment.earnings.forward_estimates,
      earnings_reaction_summary: enrichment.earnings.earnings_reaction_summary,
    };
  }

  if (tapeBackfill) {
    pkg.tapeBackfill = {
      status: tapeBackfill.status,
      reason: tapeBackfill.reason,
      tapeBackfillReason: tapeBackfill.tapeBackfillReason,
      sessionDate: tapeBackfill.sessionDate,
      coverageEndMs: tapeBackfill.coverageEndMs,
      occRequested: tapeBackfill.occRequested,
      occCompleted: tapeBackfill.occCompleted,
      ...(tapeBackfill.wsOccSubscribed != null ? { wsOccSubscribed: tapeBackfill.wsOccSubscribed } : {}),
      tradesInserted: tapeBackfill.tradesInserted,
      coverageGeometry: tapeBackfill.coverageGeometry ?? null,
      totalTradesFromPolygon: tapeBackfill.totalTradesFromPolygon,
      persistRejectedCount: tapeBackfill.persistRejectedCount,
      ...(tapeBackfill.tapeBackfillDedupeDrops != null
        ? { tapeBackfillDedupeDrops: tapeBackfill.tapeBackfillDedupeDrops }
        : {}),
      anyTruncated: tapeBackfill.anyTruncated,
      anySawPolygonHttpError: tapeBackfill.anySawPolygonHttpError,
      todayYmd: tapeBackfill.todayYmd,
      isSessionForToday: tapeBackfill.isSessionForToday,
      sessionInProgress: tapeBackfill.sessionInProgress,
      queryOpenMs: tapeBackfill.queryOpenMs,
      queryCloseMs: tapeBackfill.queryCloseMs,
      captureSource: tapeBackfill.captureSource ?? null,
      captureDurationMs: tapeBackfill.captureDurationMs ?? null,
    };
  }

  if (deskCatalystWindowExpirationISO) {
    if (catalystEvaluation != null) {
      pkg.catalystEvaluation = catalystEvaluation;
    }
    const exp = deskCatalystWindowExpirationISO;
    const dteCalendar = Math.max(
      0,
      Math.ceil(
        (new Date(exp + "T00:00:00Z").getTime() - new Date(currentDate + "T00:00:00Z").getTime()) / 86_400_000,
      ),
    );
    const macroWindow = Math.max(2, dteCalendar);
    const macroEventsInPositionWindow: Array<{
      date: string;
      title: string;
      type: string;
      importance: string;
      time?: string;
    }> = [];
    for (const ev of getUpcomingEvents(macroWindow)) {
      if (ev.date < currentDate || ev.date > exp) continue;
      if (ev.type === "fomc" || (ev.type === "economic" && (ev.importance === "HIGH" || ev.importance === "MEDIUM"))) {
        macroEventsInPositionWindow.push({
          date: ev.date,
          title: ev.title,
          type: ev.type,
          importance: ev.importance,
          ...(ev.time ? { time: ev.time } : {}),
        });
      }
    }
    pkg.macroEventsInPositionWindow = macroEventsInPositionWindow;
  }

  const upperTicker = ticker.toUpperCase();

  const listing = await resolveEquityListingForTotalview(upperTicker, {
    schwabExchangeHint: tickerData.schwabExchangeHint,
  });
  let totalviewWasColdStart = false;
  if (isNasdaqPrimaryListing(listing)) {
    totalviewWasColdStart = acquireDynamicIbPool("totalview", upperTicker).wasColdStart;
    const deadline = Date.now() + 2_000;
    let mem = getRecentTotalviewSummaryForTicker(upperTicker);
    while (!mem && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      mem = getRecentTotalviewSummaryForTicker(upperTicker);
    }
  }

  const cboeWasColdStart = acquireDynamicIbPool("cboeOne", upperTicker).wasColdStart;
  const cboeDeadline = Date.now() + 1_000;
  while (Date.now() < cboeDeadline) {
    const q = getQuoteBySymbol(upperTicker);
    if (q?.quoteSource === "IBKR_CBOE_ONE") break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const poolDiag = getIbDynamicPoolDiagnosticsSnapshot();

  const tv = await fetchRecentNasdaqTotalviewForTicker(ticker);
  const es = await fetchRecentEsDepthSummary();
  const cboeDiag = getCboeOneFeedDiagnostics(upperTicker);
  const imb = await fetchRecentNyseImbalanceForTicker(ticker);

  mergeStrategistDiag({
    closingImbalancePresent: imb.row != null,
    closingImbalanceLatencyMs: imb.latencyMs,
    nasdaqDepthPresent: tv.row != null,
    nasdaqDepthLatencyMs: tv.latencyMs,
    esContextPresent: es.row != null,
    esContextLatencyMs: es.latencyMs,
    cboeOnePresent: cboeDiag.present,
    cboeOneLatencyMs: cboeDiag.latencyMs,
    iseComplexBookPresent: false,
    iseComplexBookLatencyMs: null,
    totalviewPoolSize: poolDiag.totalviewPoolSize,
    totalviewPoolCapacity: poolDiag.totalviewPoolCapacity,
    totalviewWasColdStart,
    cboeOnePoolSize: poolDiag.cboeOnePoolSize,
    cboeOnePoolCapacity: poolDiag.cboeOnePoolCapacity,
    cboeOneWasColdStart: cboeWasColdStart,
  });

  if (imb.row) {
    const row = imb.row;
    const shares = Number(row.imbalanceShares);
    const notionalUsd = row.imbalanceNotionalUsd;
    const absNotional = Math.abs(notionalUsd);
    const side: "buy" | "sell" | "balanced" =
      absNotional < CLOSING_IMBALANCE_BALANCED_THRESHOLD_USD
        ? "balanced"
        : shares > 0
          ? "buy"
          : "sell";
    const last = tickerData.price;
    const ip = row.indicativePrice;
    const indicativePriceVsLast = last > 0 ? ((ip - last) / last) * 100 : 0;
    pkg.closingImbalance = {
      timestamp: row.imbalanceTimestamp.toISOString(),
      side,
      shares,
      notionalUsd,
      indicativePrice: ip,
      indicativePriceVsLast,
    };
  }

  if (tv.row) {
    const r = tv.row;
    pkg.nasdaqDepth = {
      symbol: r.underlyingSymbol,
      spotMid: r.spotMid,
      bidDepth5pct: r.bidDepth5pct,
      askDepth5pct: r.askDepth5pct,
      bidDepth1pct: r.bidDepth1pct,
      askDepth1pct: r.askDepth1pct,
      bookImbalanceRatio: r.bookImbalanceRatio,
      topBidSize: r.topBidSize,
      topAskSize: r.topAskSize,
      updatedAt: r.summaryTimestamp.toISOString(),
    };
  }

  if (es.row) {
    const e = es.row;
    pkg.esContext = {
      symbol: "ES",
      contractMonth: e.contractMonth,
      midPrice: e.midPrice,
      bidDepth5ticks: e.bidDepth5ticks,
      askDepth5ticks: e.askDepth5ticks,
      bidDepth1tick: e.bidDepth1tick,
      askDepth1tick: e.askDepth1tick,
      bookImbalanceRatio: e.bookImbalanceRatio,
      topBidSize: e.topBidSize,
      topAskSize: e.topAskSize,
      updatedAt: e.summaryTimestamp.toISOString(),
    };
  }

  return JSON.stringify(pkg);
}

async function callAiForTrade(
  dataPackage: string,
  retryInstruction?: string,
  progress?: AnalyzeProgressCallbacks,
  modelOverride?: { provider: "anthropic" | "google" | "openai" | "xai"; model: string; temperature?: number },
): Promise<{ response: AiTradeResponse; trace: WebSearchTrace; rawText: string }> {
  const aiCfg = getAiLabStrategistConfig();
  const provider = (modelOverride?.provider ?? aiCfg.analystModelProvider) as "anthropic" | "google" | "openai" | "xai";
  const model = modelOverride?.model ?? aiCfg.analystModelName;
  const temperature = modelOverride?.temperature ?? aiCfg.analystTemperature;

  logger.info({ provider, model, temperature, webSearch: true }, "StrategistV2: calling AI for trade");

  const today = new Date().toISOString().slice(0, 10);
  const scanBlock = buildScannerContextPromptBlock(getStrategistRunContext()?.scannerContext ?? null);
  const flowContextBlock = progress?.flowContext
    ? `\n\n## RECENT UNUSUAL FLOW SNAPSHOT (just observed by user — incorporate into analysis)\n${progress.flowContext}\n`
    : "";
  const prompt = retryInstruction
    ? `${retryInstruction}\n\nOriginal data package:\n${dataPackage}${scanBlock}${flowContextBlock}`
    : `Today is ${today}. Run web searches as required by the WEB SEARCH MANDATE in your system prompt, then analyze this ticker and recommend the best trade. Respond ONLY with a valid JSON object, no text before or after, no markdown fences.${scanBlock}${flowContextBlock}\n\n${dataPackage}`;

  let rawText: string;
  let trace: WebSearchTrace;
  const onDelta = (txt: string) => progress?.onToken?.(txt);
  const onStatus = (s: string) => progress?.onStatus?.(s);
  const cancelSig = progress?.cancelSignal;
  switch (provider) {
    case "anthropic": {
      const r = progress
        ? await streamCallAnthropicWithSystemAndWebSearch(
            model,
            temperature,
            STRATEGIST_SYSTEM_PROMPT,
            prompt,
            onDelta,
            onStatus,
            cancelSig,
          )
        : await callAnthropicWithSystemAndWebSearch(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt, cancelSig);
      rawText = r.text;
      trace = r.trace;
      break;
    }
    case "google": {
      const r = progress
        ? await streamCallGeminiWithSystemAndWebSearch(
            model,
            temperature,
            STRATEGIST_SYSTEM_PROMPT,
            prompt,
            onDelta,
            onStatus,
            cancelSig,
          )
        : await callGeminiWithSystemAndWebSearch(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt, cancelSig);
      rawText = r.text;
      trace = r.trace;
      break;
    }
    case "openai": {
      const r = progress
        ? await streamCallOpenAIWithSystemAndWebSearch(
            model,
            temperature,
            STRATEGIST_SYSTEM_PROMPT,
            prompt,
            onDelta,
            onStatus,
            cancelSig,
          )
        : await callOpenAIWithSystemAndWebSearch(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt, cancelSig);
      rawText = r.text;
      trace = r.trace;
      break;
    }
    case "xai": {
      const r = progress
        ? await streamCallXaiWithSystemAndWebSearch(
            model,
            temperature,
            STRATEGIST_SYSTEM_PROMPT,
            prompt,
            onDelta,
            onStatus,
            cancelSig,
          )
        : await callXaiWithSystemAndWebSearch(model, temperature, STRATEGIST_SYSTEM_PROMPT, prompt, cancelSig);
      rawText = r.text;
      trace = r.trace;
      break;
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  logger.info({
    webSearchUsed: trace.webSearchUsed,
    queryCount: trace.queries.length,
    queries: trace.queries,
    sourceCount: trace.sources.length,
    topSources: trace.sources.slice(0, 5).map(s => ({ title: s.title.slice(0, 80), url: s.url })),
  }, "StrategistV2: web search trace");

  return parseAiTradeRawText(rawText, trace);
}

// Shared parser for raw AI trade JSON. Used by both Solo (callAiForTrade) and
// Debate (callAiForTradeViaDebate) code paths. Extracts JSON from the raw
// text, normalizes the schema, and returns a fully-typed AiTradeResponse.
function parseAiTradeRawText(
  rawText: string,
  trace: WebSearchTrace,
): { response: AiTradeResponse; trace: WebSearchTrace; rawText: string } {
  logger.info({ rawSnippet: rawText.slice(0, 300) }, "StrategistV2: raw AI response snippet");

  let cleanText = extractJson(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanText);
  } catch {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
        logger.info("StrategistV2: recovered JSON from raw text via brace extraction");
      } catch {
        logger.error({ rawSnippet: rawText.slice(0, 500) }, "StrategistV2: AI response JSON parse failure");
        throw new Error("AI response is not valid JSON");
      }
    } else {
      logger.error({ rawSnippet: rawText.slice(0, 500) }, "StrategistV2: AI response JSON parse failure");
      throw new Error("AI response is not valid JSON");
    }
  }

  const resp = parsed as Record<string, unknown>;

  // Strip Anthropic web-search citation wrappers (e.g. <cite index="0-1">x</cite>
  // or self-closing <cite index="0-1"/>) and repair malformed multi-dot decimals
  // like "4.05/4.2.335" that LLMs occasionally emit when concatenating values.
  // Applied to every prose field before persistence so downstream consumers
  // (Strategist card, history, copy-JSON) all see clean text.
  const sanitizeNarrative = (s: string): string => {
    if (!s) return s;
    let out = s;
    out = out.replace(/<cite\s[^>]*\/>/gi, "");
    out = out.replace(/<cite\s[^>]*>([\s\S]*?)<\/cite>/gi, "$1");
    out = out.replace(/<\/?cite[^>]*>/gi, "");
    // "4.2.335" → "4.2 335" (split a decimal followed by another decimal segment)
    out = out.replace(/(\d+\.\d+)\.(\d+)\b/g, "$1 $2");
    return out.replace(/[ \t]{2,}/g, " ").trim();
  };
  const sanitizeOpt = (v: unknown): string => sanitizeNarrative(String(v ?? ""));

  if (!Array.isArray(resp.legs) || resp.legs.length === 0 || !resp.strategy || String(resp.strategy).toLowerCase() === "no_trade") {
    const thesis = sanitizeNarrative(String(resp.thesis ?? resp.rationale ?? resp.reasoning ?? "AI found no viable options setup"));
    const confidence = Math.max(0, Math.min(100, Number(resp.confidence) || 0));
    logger.info({ parsedKeys: Object.keys(resp), confidence, thesis: thesis.slice(0, 200) }, "StrategistV2: AI returned no-trade / empty legs");
    const noTradeResponse: AiTradeResponse = {
      strategy: "no_trade",
      legs: [],
      entryPrice: 0,
      entryRangeMin: 0,
      entryRangeMax: 0,
      maxRisk: 0,
      maxProfit: 0,
      breakeven: [],
      companyContext: sanitizeOpt(resp.companyContext),
      thesis,
      exitTargets: { profitTarget: 0, profitTargetUnderlying: 0, stopLoss: 0, stopLossUnderlying: 0, timeStop: "" },
      bullInvalidation: "",
      bearInvalidation: "",
      riskOfRuin: "",
      confidence,
      warnings: resp.warnings ? sanitizeNarrative(String(resp.warnings)) : null,
      sameDayCatalyst: typeof resp.sameDayCatalyst === "boolean" ? resp.sameDayCatalyst : false,
      catalystSummary: resp.catalystSummary ? String(resp.catalystSummary) : undefined,
      catalystAlignment: typeof resp.catalystAlignment === "string"
        ? (String(resp.catalystAlignment).toUpperCase() as AiTradeResponse["catalystAlignment"])
        : "NONE",
      citedHeadlines: Array.isArray(resp.citedHeadlines)
        ? (resp.citedHeadlines as Array<Record<string, unknown>>).map(h => ({
            title: String(h.title ?? ""),
            url: h.url ? String(h.url) : undefined,
            date: h.date ? String(h.date) : undefined,
          })).filter(h => h.title)
        : [],
    };
    return { response: noTradeResponse, trace, rawText };
  }

  const safeNum = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const validTypes = new Set(["call", "put"]);
  const validActions = new Set(["buy", "sell"]);

  const legs = (resp.legs as Array<Record<string, unknown>>).map(l => {
    const type = String(l.type).toLowerCase();
    const action = String(l.action).toLowerCase();
    if (!validTypes.has(type)) throw new Error(`Invalid leg type: ${type}. Must be "call" or "put".`);
    if (!validActions.has(action)) throw new Error(`Invalid leg action: ${action}. Must be "buy" or "sell".`);
    const strike = safeNum(l.strike, 0);
    if (strike <= 0) throw new Error(`Invalid strike price: ${l.strike}`);
    const expiration = String(l.expiration);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) throw new Error(`Invalid expiration format: ${expiration}. Must be YYYY-MM-DD.`);
    return { type: type as "call" | "put", strike, action: action as "buy" | "sell", expiration };
  });

  const confidence = Math.max(0, Math.min(100, safeNum(resp.confidence, 0)));

  const exitRaw = resp.exitTargets as Record<string, unknown> | undefined;
  let timeStopStr = String(exitRaw?.timeStop ?? "");
  if (timeStopStr && /^\d{4}-\d{2}-\d{2}/.test(timeStopStr)) {
    const tsDate = new Date(timeStopStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (tsDate.getTime() <= now.getTime()) {
      logger.warn({ timeStop: timeStopStr, today: now.toISOString().slice(0, 10) }, "StrategistV2: AI returned timeStop in the past — omitting");
      timeStopStr = "";
    }
  }
  const exitTargets = {
    profitTarget: safeNum(exitRaw?.profitTarget, 0),
    profitTargetUnderlying: safeNum(exitRaw?.profitTargetUnderlying, 0),
    stopLoss: safeNum(exitRaw?.stopLoss, 0),
    stopLossUnderlying: safeNum(exitRaw?.stopLossUnderlying, 0),
    timeStop: timeStopStr,
  };

  const fullResponse: AiTradeResponse = {
    strategy: String(resp.strategy),
    legs,
    entryPrice: safeNum(resp.entryPrice, 0),
    entryRangeMin: safeNum(resp.entryRangeMin, safeNum(resp.entryPrice, 0)),
    entryRangeMax: safeNum(resp.entryRangeMax, safeNum(resp.entryPrice, 0)),
    maxRisk: safeNum(resp.maxRisk, 0),
    maxProfit: resp.maxProfit === "unlimited" || resp.maxProfit === "Unlimited" ? 99999 : safeNum(resp.maxProfit, 0),
    breakeven: Array.isArray(resp.breakeven) ? (resp.breakeven as unknown[]).map(v => safeNum(v, 0)).filter(n => n > 0) : [],
    companyContext: sanitizeOpt(resp.companyContext),
    thesis: sanitizeNarrative(String(resp.thesis ?? resp.rationale ?? "")),
    exitTargets,
    bullInvalidation: sanitizeOpt(resp.bullInvalidation),
    bearInvalidation: sanitizeOpt(resp.bearInvalidation),
    riskOfRuin: sanitizeOpt(resp.riskOfRuin),
    confidence,
    warnings: resp.warnings ? sanitizeNarrative(String(resp.warnings)) : null,
    sameDayCatalyst: typeof resp.sameDayCatalyst === "boolean" ? resp.sameDayCatalyst : false,
    catalystSummary: resp.catalystSummary ? String(resp.catalystSummary) : undefined,
    catalystAlignment: typeof resp.catalystAlignment === "string"
      ? (String(resp.catalystAlignment).toUpperCase() as AiTradeResponse["catalystAlignment"])
      : "NONE",
    citedHeadlines: Array.isArray(resp.citedHeadlines)
      ? (resp.citedHeadlines as Array<Record<string, unknown>>).map(h => ({
          title: String(h.title ?? ""),
          url: h.url ? String(h.url) : undefined,
          date: h.date ? String(h.date) : undefined,
        })).filter(h => h.title)
      : [],
  };
  return { response: fullResponse, trace, rawText };
}

// Debate-mode counterpart to callAiForTrade. Runs the 3-round back-and-forth
// between two strategists, applies the configured convergence rule, and
// parses the chosen final raw text via the same parseAiTradeRawText helper
// that Solo mode uses.
async function callAiForTradeViaDebate(
  dataPackage: string,
  settings: StrategistConfig,
  progress?: AnalyzeProgressCallbacks,
  // Canonical scalars for the per-turn scrubber. Without this, debate
  // transcript turns leak `{{IVR}}` / `{{PC_RATIO}}` placeholders to the
  // user even though the final synthesis card is scrubbed downstream.
  scrubCanonical?: ScrubCanonical,
): Promise<{ response: AiTradeResponse; trace: WebSearchTrace; rawText: string; debateLabel: string }> {
  const modelA = getStrategistModel(settings.strategistDebateAModelIdx);
  const modelB = getStrategistModel(settings.strategistDebateBModelIdx);
  // -1 = "Debate Winner" sentinel: arbitrator is resolved inside runDebate
  // after the Phase 1 verdict (winning side's model is promoted to Senior PM).
  const arbitratorModel: StrategistModelOption | "winner" =
    settings.strategistArbitratorModelIdx === -1
      ? "winner"
      : getStrategistModel(settings.strategistArbitratorModelIdx);
  const convergence = ([1, 2, 3].includes(settings.strategistConvergence)
    ? settings.strategistConvergence
    : 3) as 1 | 2 | 3;
  const tieBand =
    typeof settings.strategistTieBand === "number" && Number.isFinite(settings.strategistTieBand)
      ? settings.strategistTieBand
      : 10;

  logger.info(
    {
      modelA: modelA.model,
      providerA: modelA.provider,
      modelB: modelB.model,
      providerB: modelB.provider,
      arbitratorModel: arbitratorModel === "winner" ? "winner" : arbitratorModel.model,
      arbitratorProvider: arbitratorModel === "winner" ? "winner" : arbitratorModel.provider,
      convergence,
      tieBand,
    },
    "StrategistV2: starting Debate-mode analysis",
  );

  const debateCallbacks: DebateCallbacks = {
    cancelSignal: progress?.cancelSignal,
    onTurnStart: (t) => progress?.onTurnStart?.(t),
    onTurnDelta: (id, delta) => progress?.onTurnDelta?.(id, delta),
    onTurnDone: (id, finalText) => progress?.onTurnDone?.(id, finalText),
    onStatus: (s) => progress?.onStatus?.(s),
  };

  // Inject the same recent-flow snapshot the Solo path uses, so a Debate
  // analysis triggered from the Unusual Flow drill-down "Send to Strategist"
  // button reasons about the exact tape the user just observed.
  const flowContextBlock = progress?.flowContext
    ? `\n\n## RECENT UNUSUAL FLOW SNAPSHOT (just observed by user — incorporate into analysis)\n${progress.flowContext}\n`
    : "";
  const scanBlock = buildScannerContextPromptBlock(getStrategistRunContext()?.scannerContext ?? null);
  const debateDataPackage = scanBlock + dataPackage + flowContextBlock;

  const outcome = await runDebate({
    systemPrompt: STRATEGIST_SYSTEM_PROMPT,
    dataPackage: debateDataPackage,
    config: { modelA, modelB, arbitratorModel, convergence, tieBand },
    personaA: BULL_PERSONA,
    personaB: BEAR_PERSONA,
    personaNameA: "Bull",
    personaNameB: "Bear",
    callbacks: debateCallbacks,
    scrubCanonical,
  });

  const parsed = parseAiTradeRawText(outcome.finalRawText, outcome.trace);
  return { ...parsed, debateLabel: outcome.chosenLabel };
}

function validateAiResponse(
  response: AiTradeResponse,
  chain: ChainContract[],
  settings: StrategistConfig,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const maxSpreadPct = settings.maxBidAskSpreadPct / 100;

  // Hard reject naked short positions — undefined risk is not permitted
  if (response.strategy === "naked_put" || response.strategy === "naked_call") {
    issues.push(`Strategy "${response.strategy}" is not permitted. All positions must have defined maximum risk. Use a credit spread, iron condor, or iron butterfly instead.`);
    return { valid: false, issues };
  }
  // Detect a single-leg sell with no offsetting buy (naked short disguised as another label)
  if (response.legs.length === 1 && response.legs[0].action === "sell") {
    issues.push(`Single-leg short position is not permitted. Add a long leg to define the maximum risk.`);
    return { valid: false, issues };
  }

  // No strategy whitelist. All structures (broken-wing butterflies, condors,
  // calendars, diagonals, ratio-balanced spreads, risk reversals, etc.) are
  // permitted. The only hard rejection is naked-short risk: a position whose
  // net short contracts of a given option type are not covered by long
  // contracts of the same type. Grouping is by option type (call vs put) only
  // — NOT by expiration — so calendars and diagonals (long back-month covers
  // short front-month) pass, while a 1×long / 2×short ratio (net -1) and any
  // unpaired naked short still fail.
  const balance = new Map<"call" | "put", number>();
  for (const leg of response.legs) {
    const sign = leg.action === "buy" ? 1 : -1;
    const qty = leg.quantity ?? 1;
    const key = leg.type as "call" | "put";
    balance.set(key, (balance.get(key) ?? 0) + sign * qty);
  }
  for (const [type, net] of balance) {
    if (net < 0) {
      issues.push(`Naked short ${type}(s) detected: net ${net} contracts uncovered by long ${type}s. Add a long ${type} leg (any expiration) to define maximum risk.`);
      return { valid: false, issues };
    }
  }

  for (const leg of response.legs) {
    const matchingContracts = chain.filter(c => {
      const typeMatch = c.type === leg.type || c.optionType === leg.type.toUpperCase();
      const strikeMatch = Math.abs(c.strike - leg.strike) < 0.5;
      const expMatch = c.expiration === leg.expiration;
      return typeMatch && strikeMatch && expMatch;
    });

    if (matchingContracts.length === 0) {
      issues.push(`The ${leg.strike} ${leg.type} ${leg.expiration} does not exist in the options chain. Choose an available strike.`);
      continue;
    }

    const contract = matchingContracts[0];

    const mid = contract.mid > 0 ? contract.mid : (contract.bid + contract.ask) / 2;
    if (mid > 0) {
      const spreadPct = (contract.ask - contract.bid) / mid;
      if (spreadPct > maxSpreadPct) {
        issues.push(`The ${leg.strike} ${leg.type} has a ${(spreadPct * 100).toFixed(0)}% bid-ask spread (max ${settings.maxBidAskSpreadPct}%). Suggest an alternative with tighter spreads.`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function buildRetryPrompt(originalResponse: AiTradeResponse, issues: string[]): string {
  return `Your previous recommendation had validation issues:\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n\nPlease revise your recommendation. Keep the same general thesis if it's still valid, but fix the specific contract selections. Return the same JSON format.`;
}

function mapAiLegsToCandidate(response: AiTradeResponse, chain: ChainContract[]): CandidateLeg[] {
  return response.legs.map(leg => {
    const contract = chain.find(c => {
      const typeMatch = c.type === leg.type || c.optionType === leg.type.toUpperCase();
      const strikeMatch = Math.abs(c.strike - leg.strike) < 0.5;
      const expMatch = c.expiration === leg.expiration;
      return typeMatch && strikeMatch && expMatch;
    });

    return {
      type: leg.type,
      side: leg.action === "buy" ? "buy" as const : "sell" as const,
      strike: leg.strike,
      expiration: leg.expiration,
      bid: contract?.bid ?? 0,
      ask: contract?.ask ?? 0,
      mid: contract?.mid ?? ((contract?.bid ?? 0) + (contract?.ask ?? 0)) / 2,
      delta: contract?.delta ?? 0,
      openInterest: contract?.openInterest ?? 0,
    };
  });
}

interface SpreadEconomics {
  isCredit: boolean;
  entryAbs: number;
  entryRangeMin: number;
  entryRangeMax: number;
  maxProfit: number;
  maxLoss: number;
  structure?: TwoVerticalPartition | null;
}

export interface TwoVerticalPartition {
  kind: "iron_condor_or_butterfly" | "same_side_condor_or_butterfly";
  wing1Width: number;
  wing2Width: number;
  maxWingWidth: number;
}

/**
 * Partition a 4-leg single-expiration structure into two verticals if possible.
 * Returns null for any structure that does NOT cleanly decompose into two
 * verticals (each = 1 buy + 1 sell, same option type, same expiry, different
 * strikes). Ratios, broken-wing structures with unequal leg counts, and
 * non-4-leg structures fall through.
 *
 * Handles two cases:
 *   A. Iron condor / iron butterfly: 2 calls + 2 puts, each side a vertical.
 *   B. Same-side condor / butterfly: 4 of one type, ordered by strike as
 *      buy/sell/sell/buy (long) or sell/buy/buy/sell (short).
 */
export function partitionIntoTwoVerticals(legs: CandidateLeg[]): TwoVerticalPartition | null {
  if (legs.length !== 4) return null;
  const expirations = new Set(legs.map(l => l.expiration));
  if (expirations.size !== 1) return null;

  const calls = legs.filter(l => l.type === "call");
  const puts = legs.filter(l => l.type === "put");

  const isVertical = (pair: CandidateLeg[]): boolean => {
    if (pair.length !== 2) return false;
    const [a, b] = pair;
    return a.type === b.type && a.expiration === b.expiration && a.side !== b.side && a.strike !== b.strike;
  };

  // Case A: iron condor / iron butterfly
  if (calls.length === 2 && puts.length === 2) {
    if (!isVertical(calls) || !isVertical(puts)) return null;
    const callWing = Math.abs(calls[0].strike - calls[1].strike);
    const putWing = Math.abs(puts[0].strike - puts[1].strike);
    return {
      kind: "iron_condor_or_butterfly",
      wing1Width: putWing,
      wing2Width: callWing,
      maxWingWidth: Math.max(callWing, putWing),
    };
  }

  // Case B: same-side condor / butterfly
  if (calls.length === 4 || puts.length === 4) {
    const same = calls.length === 4 ? calls : puts;
    const buys = same.filter(l => l.side === "buy").length;
    const sells = same.filter(l => l.side === "sell").length;
    if (buys !== 2 || sells !== 2) return null;
    const sorted = [...same].sort((a, b) => a.strike - b.strike);
    const pattern = sorted.map(l => l.side).join(",");
    const isLong = pattern === "buy,sell,sell,buy";
    const isShort = pattern === "sell,buy,buy,sell";
    if (!isLong && !isShort) return null;
    const lowerWing = sorted[1].strike - sorted[0].strike;
    const upperWing = sorted[3].strike - sorted[2].strike;
    return {
      kind: "same_side_condor_or_butterfly",
      wing1Width: lowerWing,
      wing2Width: upperWing,
      maxWingWidth: Math.max(lowerWing, upperWing),
    };
  }

  return null;
}

function computeSpreadEconomics(
  legs: CandidateLeg[],
  aiResponse: AiTradeResponse,
  ticker: string,
): SpreadEconomics {
  const aiEntry = aiResponse.entryPrice;
  const aiMaxProfit = typeof aiResponse.maxProfit === "number" ? aiResponse.maxProfit : 99999;
  const aiMaxLoss = aiResponse.maxRisk;

  // Determine if any leg has missing pricing — if so, fall back to AI numbers
  const allLegsPriced = legs.length > 0 && legs.every(l => l.bid > 0 || l.ask > 0);
  if (!allLegsPriced) {
    return {
      isCredit: aiEntry < 0,
      entryAbs: Math.abs(aiEntry),
      entryRangeMin: aiResponse.entryRangeMin ?? Math.abs(aiEntry),
      entryRangeMax: aiResponse.entryRangeMax ?? Math.abs(aiEntry),
      maxProfit: aiMaxProfit,
      maxLoss: aiMaxLoss,
    };
  }

  // Net cost from real prices: positive = debit (we pay), negative = credit (we receive)
  // For each leg: buy adds mid (cost), sell subtracts mid (premium received)
  let netMid = 0;
  let netBid = 0; // worst-case fill if buying / best-case if selling
  let netAsk = 0; // best-case fill if buying / worst-case if selling
  for (const leg of legs) {
    const sign = leg.side === "buy" ? 1 : -1;
    netMid += sign * leg.mid;
    // For range: buying side, low = bid (rare fill) and high = ask (typical fill)
    // We compute spread net at min and max plausible fills
    netBid += sign * (leg.side === "buy" ? leg.bid : leg.ask);
    netAsk += sign * (leg.side === "buy" ? leg.ask : leg.bid);
  }

  const isCredit = netMid < 0;
  const entryAbs = Math.round(Math.abs(netMid) * 100) / 100;
  const rangeLo = Math.round(Math.min(Math.abs(netBid), Math.abs(netAsk)) * 100) / 100;
  const rangeHi = Math.round(Math.max(Math.abs(netBid), Math.abs(netAsk)) * 100) / 100;

  // Detect calendar/diagonal: legs span more than one expiration
  const expirations = new Set(legs.map(l => l.expiration));
  const isMultiExpiration = expirations.size > 1;

  let maxProfit = aiMaxProfit;
  let maxLoss = aiMaxLoss;
  let structure: TwoVerticalPartition | null = null;

  if (isMultiExpiration) {
    // Calendar/diagonal: max loss = net debit paid (per share, x100 for contract)
    // Net dollar loss per contract = entryAbs * 100
    // Max profit on calendar is theoretical (depends on IV/underlying), keep AI estimate
    const computedMaxLoss = isCredit ? aiMaxLoss : entryAbs * 100;
    if (Math.abs(computedMaxLoss - aiMaxLoss) / Math.max(aiMaxLoss, 1) > 0.20) {
      logger.warn({
        ticker,
        strategy: aiResponse.strategy,
        aiEntry, computedNet: netMid, aiMaxLoss, computedMaxLoss,
        legs: legs.map(l => ({ side: l.side, type: l.type, strike: l.strike, exp: l.expiration, mid: l.mid })),
      }, "StrategistV2: AI calendar/diagonal economics differ from leg-derived; overriding with leg-derived");
    }
    maxLoss = computedMaxLoss;
  } else if (legs.length >= 2) {
    // Try to decompose 4-leg structures into two verticals (iron condor, iron
    // butterfly, call/put condor, call/put butterfly). Only one wing can be at
    // max loss at expiration, so width = max(wing widths), not full strike range.
    const partition = partitionIntoTwoVerticals(legs);
    const width = partition
      ? partition.maxWingWidth * 100
      : (() => {
          const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
          return (strikes[strikes.length - 1] - strikes[0]) * 100;
        })();
    if (isCredit) {
      // Credit spread: max profit = credit collected, max loss = width - credit
      const computedMaxProfit = entryAbs * 100;
      const computedMaxLoss = Math.max(0, width - computedMaxProfit);
      maxProfit = computedMaxProfit;
      maxLoss = computedMaxLoss;
    } else {
      // Debit spread: max loss = debit paid, max profit = width - debit
      const computedMaxLoss = entryAbs * 100;
      const computedMaxProfit = Math.max(0, width - computedMaxLoss);
      maxProfit = computedMaxProfit;
      maxLoss = computedMaxLoss;
    }
    structure = partition;
  } else if (legs.length === 1) {
    // Single leg long: max loss = debit paid
    const leg = legs[0];
    if (leg.side === "buy") {
      maxLoss = entryAbs * 100;
      // Long calls/puts unbounded profit — keep AI value
    }
    // Single leg short (naked) — keep AI numbers, margin-bound
  }

  if (Math.abs(Math.abs(aiEntry) - entryAbs) > 0.10) {
    logger.warn({
      ticker,
      strategy: aiResponse.strategy,
      aiEntry,
      computedEntry: netMid,
      diff: Math.abs(Math.abs(aiEntry) - entryAbs),
    }, "StrategistV2: AI entryPrice differs from leg-derived net by >$0.10; using leg-derived");
  }

  return {
    isCredit,
    entryAbs,
    entryRangeMin: rangeLo,
    entryRangeMax: rangeHi,
    maxProfit,
    maxLoss,
    structure,
  };
}

function inferDirection(strategy: string, legs: AiTradeResponse["legs"]): string {
  const s = strategy.toLowerCase();
  if (s.includes("bull") || s.includes("long_call") || s.includes("call_debit")) return "BULLISH";
  if (s.includes("bear") || s.includes("long_put") || s.includes("put_debit")) return "BEARISH";
  if (s === "naked_put") return "BULLISH";
  if (s === "naked_call") return "BEARISH";
  if (s.includes("condor") || s.includes("butterfly") || s.includes("straddle") || s.includes("strangle")) return "NON_DIRECTIONAL";
  if (s.includes("calendar") || s.includes("diagonal")) return "NON_DIRECTIONAL";
  if (s.includes("ratio")) {
    const sells = legs.filter(l => l.action === "sell");
    if (sells.length > 0) return sells[0].type === "call" ? "BEARISH" : "BULLISH";
  }
  const buys = legs.filter(l => l.action === "buy");
  const sells = legs.filter(l => l.action === "sell");
  if (legs.length === 1) {
    const leg = legs[0];
    if (leg.action === "buy") return leg.type === "call" ? "BULLISH" : "BEARISH";
    if (leg.action === "sell") return leg.type === "put" ? "BULLISH" : "BEARISH";
  }
  if (buys.length === 1 && sells.length === 0) {
    return buys[0].type === "call" ? "BULLISH" : "BEARISH";
  }
  if (sells.length === 1 && buys.length === 0) {
    return sells[0].type === "put" ? "BULLISH" : "BEARISH";
  }
  if (buys.length === 1) {
    return buys[0].type === "call" ? "BULLISH" : "BEARISH";
  }
  return "NON_DIRECTIONAL";
}

function buildStrategyLine(ticker: string, response: AiTradeResponse): string {
  const name = response.strategy.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const legDescs = response.legs.map(
    l => `${l.action === "sell" ? "Sell" : "Buy"} ${l.expiration} $${l.strike} ${l.type}`
  );
  const priceStr = response.entryPrice < 0
    ? `for $${Math.abs(response.entryPrice).toFixed(2)} credit`
    : `for $${response.entryPrice.toFixed(2)} debit`;
  return `${name} on ${ticker}: ${legDescs.join(", ")} ${priceStr}.`;
}

function checkToxicGate(
  regime: StructuredRegime,
  settings: StrategistConfig
): { triggered: boolean; reasons: string[]; pathACheck: { extremeRisk: boolean; highCorrelation: boolean }; pathBCheck: { elevatedRisk: boolean; eventWithin24h: boolean; eventName: string | null } } {
  const pathACheck = {
    extremeRisk: regime.systemicRiskLevel === "EXTREME",
    highCorrelation: regime.correlationRegime === "HIGH",
  };
  const pathBCheck = {
    elevatedRisk: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    eventWithin24h: false,
    eventName: null as string | null,
  };

  if (!settings.toxicGateEnabled) return { triggered: false, reasons: [], pathACheck, pathBCheck };

  const reasons: string[] = [];

  if (settings.toxicPathAEnabled && pathACheck.extremeRisk && pathACheck.highCorrelation) {
    reasons.push("EXTREME systemic risk + HIGH correlation (flash crash / liquidity drain conditions)");
  }

  if (settings.toxicPathBEnabled && pathBCheck.elevatedRisk) {
    const upcoming = getUpcomingEvents(2);
    const now = Date.now();
    const horizon24h = now + 24 * 60 * 60 * 1000;
    const majorEvent = upcoming.find((e) => {
      if (e.type !== "fomc" && !(e.type === "economic" && e.title.includes("CPI"))) return false;
      if (e.type === "fomc" && e.title.toLowerCase().includes("minutes")) return false;
      const evTs = new Date(e.date + "T" + (e.time || "14:00") + ":00-04:00").getTime();
      return evTs >= now && evTs <= horizon24h;
    });
    if (majorEvent) {
      pathBCheck.eventWithin24h = true;
      pathBCheck.eventName = majorEvent.title;
      reasons.push(`${majorEvent.title} within 24h + ${regime.systemicRiskLevel} systemic risk`);
    }
  }

  return { triggered: reasons.length > 0, reasons, pathACheck, pathBCheck };
}

function deriveCatalyst(tickerData: TickerData): { flagValue: number; reason: string } {
  if (tickerData.earningsWithin48h) return { flagValue: 1.0, reason: "earnings_within_48h" };
  if (tickerData.analystActions48h.length >= 2) return { flagValue: 0.5, reason: "analyst_cluster" };
  if (tickerData.analystActions48h.length === 1) return { flagValue: 0.3, reason: "analyst_action" };
  return { flagValue: 0, reason: "none" };
}

function parsePolygonRatingDateYmd(dateStr: string): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const m = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

function analystActionsFromPolygonRatings(
  ratings: import("./polygonAnalystData.js").PolygonAnalystRatingRow[] | null | undefined,
  nowMs: number = Date.now(),
): string[] {
  if (!ratings || ratings.length === 0) return [];
  const windowMs = 48 * 60 * 60 * 1000;
  const lines: string[] = [];
  for (const r of ratings) {
    const ymd = parsePolygonRatingDateYmd(r.date);
    if (!ymd) continue;
    const dayStart = new Date(`${ymd}T12:00:00.000Z`).getTime();
    if (!Number.isFinite(dayStart)) continue;
    if (nowMs - dayStart > windowMs) continue;
    const firm = (r.firm ?? "").trim() || "Unknown firm";
    const action = (r.action_type ?? "").trim() || "analyst_action";
    let s = `${ymd} ${firm}: ${action}`;
    if (r.rating_prior && r.rating_current) {
      s += ` (${r.rating_prior} → ${r.rating_current})`;
    }
    lines.push(s);
  }
  return lines.slice(0, 20);
}

type FetchFailureMode = "token_null" | "http_fail" | "symbol_missing" | "network_exception";

async function fetchTickerData(ticker: string): Promise<{ data: TickerData | null; failureMode: FetchFailureMode | null }> {
  try {
    const token = await getBestAccessToken();
    if (!token) {
      logger.warn({ ticker }, "StrategistV2: fetchTickerData failed — no Schwab token available");
      return { data: null, failureMode: "token_null" };
    }

    const res = await fetch(`${SCHWAB_API}/quotes?symbols=${ticker}&fields=quote,fundamental,reference`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logger.warn({ ticker, status: res.status }, "StrategistV2: fetchTickerData failed — Schwab quotes HTTP non-OK");
      return { data: null, failureMode: "http_fail" };
    }

    const data = (await res.json()) as SchwabQuotesResponse;
    const upper = ticker.toUpperCase();
    const entry = data[ticker] ?? data[upper];
    const q = entry?.quote;
    const f = entry?.fundamental ?? {};
    const ref = entry?.reference;
    if (!q) {
      logger.warn({ ticker, returnedKeys: Object.keys(data ?? {}) }, "StrategistV2: fetchTickerData failed — symbol missing from response");
      return { data: null, failureMode: "symbol_missing" };
    }

    const price = q.lastPrice ?? q.mark ?? 0;
    const avgVol = f.avg10DaysVolume ?? f.avgVol10Days ?? 1;
    const currentVol = q.totalVolume ?? 0;
    const rawCap = f.marketCap;
    let marketCapUsd =
      typeof rawCap === "number" && Number.isFinite(rawCap) && rawCap > 0 ? rawCap : null;
    if (marketCapUsd == null) {
      const fromPoly = await fetchPolygonTickerMarketCapUsd(upper);
      if (fromPoly != null) {
        logMarketCapPolygonFallback(upper);
        marketCapUsd = fromPoly;
      }
    }
    const schwabAssetType =
      typeof ref?.assetType === "string"
        ? ref.assetType
        : typeof ref?.assetMainType === "string"
          ? ref.assetMainType
          : null;
    const schwabExchangeHint =
      typeof ref?.exchange === "string" && ref.exchange.length > 0 ? ref.exchange : null;
    const marketContext = buildMarketContextSnapshot({
      ticker: upper,
      marketCapUsd,
      assetType: schwabAssetType,
    });

    void checkEventConflicts(ticker, 45, "iron_condor");
    // Single source of truth: vendor_primary calendar + FMP DB + Finnhub fallback (cached 6h).
    // Replaces the legacy MEGA_EARNINGS hardcoded list which only covered ~mega caps.
    const earningsInfo = await getNextEarningsDate(ticker).catch(() => null);
    const earningsDaysAway: number | null = earningsInfo?.daysAway ?? null;
    const earningsWithin48h = earningsDaysAway != null && earningsDaysAway <= 2;
    if (earningsInfo?.earningsDate) {
      logger.info({
        ticker,
        earningsDate: earningsInfo.earningsDate,
        daysAway: earningsDaysAway,
        source: earningsInfo.source,
        confirmed: earningsInfo.confirmed,
      }, "StrategistV2: earnings data resolved");
    }
    void getUpcomingEvents; // retained for type compat; calendar list no longer drives ticker-specific earnings


    return {
      data: {
        price,
        dailyChangePct: q.netPercentChangeInDouble ?? 0,
        ivr: null,
        ivrAsOfDate: null,
        ivrSource: null,
        avgVolume20d: avgVol,
        currentVolume: currentVol,
        relativeVolume: avgVol > 0 ? currentVol / avgVol : 1,
        sector: f.sector ?? "Unknown",
        marketCapUsd,
        schwabAssetType,
        schwabExchangeHint,
        marketContext,
        earningsWithin48h,
        earningsDaysAway,
        earningsDate: earningsInfo?.earningsDate ?? null,
        earningsConfirmed: earningsInfo?.confirmed ?? false,
        earningsSource: earningsInfo?.source ?? null,
        lastEarningsDate: earningsInfo?.lastEarningsDate ?? null,
        daysSinceEarnings: earningsInfo?.lastEarningsDaysSince ?? null,
        nextEarnings: earningsInfo,
        tickerDataNote: earningsInfo?.lastEarningsDate
          ? null
          : "Prior earnings date unavailable from merged earnings calendar sources for this symbol.",
        analystActions48h: [],
        halted: q.securityStatus === "Halted" || q.securityStatus === "HALTED",
      },
      failureMode: null,
    };
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: failed to fetch ticker data");
    return { data: null, failureMode: "network_exception" };
  }
}

const STRATEGIST_LARGE_CHAIN_SYMBOLS = new Set(["SPY", "QQQ", "AAPL", "TSLA", "AMZN", "NVDA", "META", "MSFT", "GOOG", "GOOGL"]);

async function fetchSchwabChainSide(
  ticker: string,
  contractType: "ALL" | "CALL" | "PUT",
  token: string,
): Promise<{ callMap: Record<string, any>; putMap: Record<string, any>; underlyingPrice?: number } | null> {
  const params = new URLSearchParams({
    symbol: ticker,
    contractType,
    range: "ALL",
  });
  const url = `${SCHWAB_API}/chains?${params.toString()}`;
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429 || res.status === 502 || res.status === 503) {
    await new Promise(r => setTimeout(r, 1000));
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25_000),
    });
  }
  if (!res.ok) {
    logger.warn({ ticker, contractType, status: res.status }, "StrategistV2: Schwab chain fetch failed");
    return null;
  }
  const data = (await res.json()) as SchwabChainApiResponse;
  return {
    callMap: data.callExpDateMap ?? {},
    putMap: data.putExpDateMap ?? {},
    underlyingPrice: data.underlyingPrice,
  };
}

async function fetchSchwabFullChain(ticker: string): Promise<ChainContract[] | null> {
  const token = await getBestAccessToken();
  if (!token) {
    logger.warn({ ticker }, "StrategistV2: no Schwab token available, skipping Schwab full chain");
    return null;
  }

  try {
    const useSplit = STRATEGIST_LARGE_CHAIN_SYMBOLS.has(ticker.toUpperCase());
    let callMap: Record<string, any> = {};
    let putMap: Record<string, any> = {};

    if (useSplit) {
      const [callRes, putRes] = await Promise.all([
        fetchSchwabChainSide(ticker, "CALL", token),
        fetchSchwabChainSide(ticker, "PUT", token),
      ]);
      if (!callRes && !putRes) return null;
      callMap = callRes?.callMap ?? {};
      putMap = putRes?.putMap ?? {};
    } else {
      const result = await fetchSchwabChainSide(ticker, "ALL", token);
      if (!result) return null;
      callMap = result.callMap;
      putMap = result.putMap;
    }

    const contracts = flattenSchwabMaps(callMap, putMap);
    if (contracts.length === 0) {
      logger.warn({ ticker }, "StrategistV2: Schwab full chain returned 0 contracts");
      return null;
    }
    const pricedCount = contracts.filter(c => c.bid > 0 || c.ask > 0).length;
    logger.info({ ticker, total: contracts.length, priced: pricedCount, source: "schwab-full" }, "StrategistV2: Schwab full chain loaded");
    return contracts;
  } catch (err) {
    logger.warn({ err, ticker }, "StrategistV2: Schwab full chain threw");
    return null;
  }
}

export type ChainSource = "schwab" | "polygon-fallback" | "schwab-unpriced" | "none";

export async function fetchOptionsChain(ticker: string, settings: StrategistConfig): Promise<{ chain: ChainContract[]; source: ChainSource }> {
  // Step A: Schwab full chain primary (so quoted prices match what user fills at)
  const schwabChain = await fetchSchwabFullChain(ticker);
  if (schwabChain && schwabChain.length > 0) {
    const priced = schwabChain.filter(c => c.bid > 0 || c.ask > 0);
    if (priced.length > 0) return { chain: priced, source: "schwab" };
    logger.warn({ ticker, total: schwabChain.length }, "StrategistV2: Schwab chain has contracts but all unpriced — trying Polygon fallback");
  }

  // Polygon fallback when Schwab is unavailable/empty/unpriced
  try {
    const apiKey = process.env.POLYGON_API_KEY || "";
    if (!apiKey) {
      logger.warn({ ticker }, "StrategistV2: no Polygon key for fallback");
      return { chain: schwabChain ?? [], source: schwabChain && schwabChain.length > 0 ? "schwab-unpriced" : "none" };
    }
    const chain = await fetchPolygonChain(ticker, apiKey, { maxDte: 365 });
    if (!chain || (chain.calls.length === 0 && chain.puts.length === 0)) {
      logger.warn({ ticker }, "StrategistV2: Polygon fallback also empty");
      return { chain: schwabChain ?? [], source: schwabChain && schwabChain.length > 0 ? "schwab-unpriced" : "none" };
    }
    const taggedCalls = (chain.calls || []).map((c: any) => ({ ...c, type: "call", optionType: "CALL", mid: c.mid ?? ((c.bid ?? 0) + (c.ask ?? 0)) / 2 }));
    const taggedPuts = (chain.puts || []).map((c: any) => ({ ...c, type: "put", optionType: "PUT", mid: c.mid ?? ((c.bid ?? 0) + (c.ask ?? 0)) / 2 }));
    const allContracts = [...taggedCalls, ...taggedPuts] as ChainContract[];
    const pricedContracts = allContracts.filter(c => c.bid > 0 || c.ask > 0);
    logger.info({ ticker, total: allContracts.length, priced: pricedContracts.length, source: "polygon-fallback" }, "StrategistV2: Polygon fallback chain loaded");
    return { chain: pricedContracts.length > 0 ? pricedContracts : allContracts, source: "polygon-fallback" };
  } catch (err) {
    logger.error({ err, ticker }, "StrategistV2: Polygon fallback failed");
    return { chain: schwabChain ?? [], source: schwabChain && schwabChain.length > 0 ? "schwab-unpriced" : "none" };
  }
}

function flattenSchwabMaps(callMap: Record<string, any>, putMap: Record<string, any>): ChainContract[] {
  const result: ChainContract[] = [];
  const sides: Array<["call" | "put", Record<string, any>]> = [["call", callMap], ["put", putMap]];
  for (const [side, map] of sides) {
    const optType = side === "call" ? "CALL" : "PUT";
    for (const [expKey, strikes] of Object.entries(map)) {
      const expDate = expKey.split(":")[0];
      for (const [strikeKey, arr] of Object.entries(strikes as Record<string, any[]>)) {
        for (const opt of arr) {
          const bid = opt.bid ?? 0;
          const ask = opt.ask ?? 0;
          result.push({
            strike: parseFloat(strikeKey),
            expiration: expDate,
            optionType: optType,
            type: side,
            bid,
            ask,
            mid: (bid + ask) / 2,
            delta: opt.delta ?? 0,
            openInterest: opt.openInterest ?? 0,
            volume: opt.totalVolume ?? 0,
            impliedVolatility: opt.volatility != null ? opt.volatility / 100 : 0,
            dte: opt.daysToExpiration ?? 0,
          });
        }
      }
    }
  }
  return result;
}

// computeIvrFromChain removed — IVR is now read from equity_daily.ivr via
// getStoredIVR(). The chain-derived version produced meaningless values
// (single-day min/max of strike-level IVs, not a true 252-day rank).

function _legacyFlattenSchwabChain_unused(data: any): ChainContract[] {
  const result: ChainContract[] = [];
  for (const side of ["callExpDateMap", "putExpDateMap"]) {
    const map = data[side];
    if (!map) continue;
    const optType = side.includes("call") ? "CALL" : "PUT";
    for (const [expKey, strikes] of Object.entries(map as Record<string, any>)) {
      for (const [strikeKey, arr] of Object.entries(strikes as Record<string, any[]>)) {
        for (const opt of arr) {
          const dte = opt.daysToExpiration ?? 0;
          result.push({
            strike: parseFloat(strikeKey),
            expiration: expKey.split(":")[0],
            optionType: optType,
            type: optType.toLowerCase(),
            bid: opt.bid ?? 0,
            ask: opt.ask ?? 0,
            mid: (opt.bid + opt.ask) / 2,
            delta: opt.delta ?? 0,
            openInterest: opt.openInterest ?? 0,
            volume: opt.totalVolume ?? 0,
            impliedVolatility: opt.volatility != null ? opt.volatility / 100 : 0,
            dte,
          });
        }
      }
    }
  }
  return result;
}

interface TelemetryExtras {
  dataPackage?: unknown;
  rawAiResponse?: string | null;
  confidenceBase?: number | null;
  confidenceCatalystDelta?: number | null;
  confidenceFinal?: number | null;
  catalystAlignment?: string | null;
  dataSource?: ChainSource | null;
  fetchFailureMode?: FetchFailureMode | string | null;
  deskResult?: DeskResult | null;
  aiTradePayload?: AiTradeResponse | null;
  runOutcomeOverride?: StrategistRunOutcomeTelemetry;
  error?: { message: string; stack?: string } | null;
  fullDiagnostic?: Record<string, unknown> | null;
}

async function emitFullDiagnosticTelemetry(args: {
  ticker: string;
  settings: StrategistConfig;
  regime: StructuredRegime;
  ioScore: IOScoreResult | null;
  tickerData: TickerData | null;
  toxicCheck: ToxicGateSnapshot;
  telemetryDbResult: string;
  aiDecision: TelemetryStrategyDecision | null;
  thesis: string | null;
  extras: TelemetryExtras;
}): Promise<number | null> {
  const ctx = getStrategistRunContext();
  const dataPkgStr =
    typeof args.extras.dataPackage === "string"
      ? args.extras.dataPackage
      : args.extras.dataPackage != null
        ? JSON.stringify(args.extras.dataPackage)
        : ctx?.diag.dataPackageStr;
  const parsedPkg = parseDataPackageForDiag(dataPkgStr);
  const tape = ctx?.diag.tapeBackfillStatus;
  const polygonTrace = takePolygonApiTrace();
  const soloLabel =
    ctx?.diag.soloModelLabel ?? getStrategistModel(args.settings.strategistSoloModelIdx).label;
  const modelAttr = buildModelAttributionPlaceholder({
    settings: args.settings,
    deskResult: args.extras.deskResult ?? undefined,
    soloModelLabel: soloLabel,
  });
  const strategistPayload = strategistPayloadFromResult({
    settings: args.settings,
    deskResult: args.extras.deskResult ?? undefined,
    aiResponse: args.extras.aiTradePayload ?? undefined,
  });
  const durationMs = ctx ? Date.now() - ctx.startedAt : 0;
  const deskTrade = args.extras.deskResult?.pm.decision === "trade";
  const outcome =
    args.extras.runOutcomeOverride ??
    telemetryDbResultToOutcome(args.telemetryDbResult, deskTrade);
  const meta: StrategistRunMetadata = {
    timestamp: new Date().toISOString(),
    ticker: args.ticker.toUpperCase(),
    strategistMode: strategistModeLabel(args.settings.strategistMode),
    requestId: ctx?.requestId ?? newStrategistRequestId(),
    userId: ctx?.userId ?? null,
    sessionIdentifier: ctx?.sessionIdentifier ?? null,
    totalRunDurationMs: durationMs,
  };
  const fullDiagnostic = buildStrategistFullDiagnosticJson({
    runMetadata: meta,
    strategistPayload,
    tapeBackfillStatus: tape,
    dataPackageParsed: parsedPkg,
    modelAttribution: modelAttr,
    polygonTrace,
    runOutcome: outcome,
    runDurationMs: durationMs,
    error: args.extras.error ?? null,
    closingImbalancePresent: ctx?.diag.closingImbalancePresent,
    closingImbalanceLatencyMs: ctx?.diag.closingImbalanceLatencyMs ?? null,
    nasdaqDepthPresent: ctx?.diag.nasdaqDepthPresent ?? null,
    nasdaqDepthLatencyMs: ctx?.diag.nasdaqDepthLatencyMs ?? null,
    esContextPresent: ctx?.diag.esContextPresent ?? null,
    esContextLatencyMs: ctx?.diag.esContextLatencyMs ?? null,
    cboeOnePresent: ctx?.diag.cboeOnePresent ?? null,
    cboeOneLatencyMs: ctx?.diag.cboeOneLatencyMs ?? null,
    iseComplexBookPresent: ctx?.diag.iseComplexBookPresent ?? null,
    iseComplexBookLatencyMs: ctx?.diag.iseComplexBookLatencyMs ?? null,
    totalviewPoolSize: ctx?.diag.totalviewPoolSize ?? null,
    totalviewPoolCapacity: ctx?.diag.totalviewPoolCapacity ?? null,
    totalviewWasColdStart: ctx?.diag.totalviewWasColdStart ?? null,
    cboeOnePoolSize: ctx?.diag.cboeOnePoolSize ?? null,
    cboeOnePoolCapacity: ctx?.diag.cboeOnePoolCapacity ?? null,
    cboeOneWasColdStart: ctx?.diag.cboeOneWasColdStart ?? null,
  });
  return logTelemetry(
    args.ticker,
    args.telemetryDbResult,
    args.regime,
    args.settings,
    args.ioScore,
    args.tickerData,
    args.toxicCheck,
    args.aiDecision,
    args.thesis,
    { ...args.extras, fullDiagnostic },
  );
}

async function noViable(
  ticker: string,
  regime: StructuredRegime,
  settings: StrategistConfig,
  toxicCheck: ToxicGateSnapshot,
  tickerData: TickerData | null,
  reason: BlockReason | string,
  ioScore?: IOScoreResult | null,
  extras: TelemetryExtras = {},
): Promise<StrategistV2Result> {
  // Accept legacy string call sites and wrap as UNKNOWN so the structured
  // shape is the single source of truth from here on.
  const blockReason: BlockReason =
    typeof reason === "string" ? { category: "UNKNOWN", detail: reason } : reason;
  await emitFullDiagnosticTelemetry({
    ticker,
    regime,
    settings,
    ioScore: ioScore ?? null,
    tickerData,
    toxicCheck,
    telemetryDbResult: "no_viable_setup",
    aiDecision: null,
    thesis: blockReason.detail,
    extras,
  });
  const strategistOutcome = outcomeFromBlockReason(blockReason);
  const strategistDiagnosticRequestId = getStrategistRunContext()?.requestId;
  return withResultSchemaVersion({
    status: "no_viable_setup",
    ticker,
    blockReason,
    strategistOutcome,
    regime,
    ioScore: ioScore ?? undefined,
    systemicRiskElevated: regime.systemicRiskLevel === "ELEVATED" || regime.systemicRiskLevel === "EXTREME",
    ...(strategistDiagnosticRequestId ? { strategistDiagnosticRequestId } : {}),
  });
}

function outcomeFromBlockReason(br: BlockReason): StrategistOutcome | undefined {
  const c = br.category;
  if (c === "ECONOMICS_MISMATCH") return "ECONOMICS_MISMATCH";
  if (c === "UNKNOWN_STRUCTURE") return "UNKNOWN_STRUCTURE";
  if (c === "NO_TRADE" || c === "LOW_CONFIDENCE") return "NO_TRADE";
  if (c === "ANALYSIS_INCOMPLETE") return "ANALYSIS_INCOMPLETE";
  return undefined;
}

async function logTelemetry(
  ticker: string, result: string, regime: StructuredRegime, settings: StrategistConfig,
  ioScore: IOScoreResult | null, tickerData: TickerData | null,
  toxicCheck: ToxicGateSnapshot,
  aiDecision: TelemetryStrategyDecision | null,
  thesis?: string | null,
  extras: TelemetryExtras = {},
): Promise<number | null> {
  try {
    const toxicGatePayload: TelemetryToxicGatePayload = {
      triggered: toxicCheck.triggered,
      reasons: toxicCheck.reasons,
      path_a_check: toxicCheck.pathACheck,
      path_b_check: toxicCheck.pathBCheck,
    };
    const edgeAttribution: TelemetryEdgeAttribution | null = ioScore
      ? {
          idiosyncratic_pct: Math.round(ioScore.final * 100),
          macro_pct: 100 - Math.round(ioScore.final * 100),
        }
      : null;
    const values: StrategistTelemetryInsert = {
      ticker,
      result,
      regime,
      tickerData,
      idioScore: ioScore,
      toxicGate: toxicGatePayload,
      viability: null,
      earningsGate: null,
      strategyDecision: aiDecision,
      candidatesGenerated: null,
      candidatesFiltered: null,
      filterReasons: null,
      winningCandidate: null,
      edgeAttribution,
      recommendationThesis: thesis ?? null,
      dataPackage: extras.dataPackage ?? null,
      rawAiResponse: extras.rawAiResponse ?? null,
      confidenceBase: extras.confidenceBase ?? null,
      confidenceCatalystDelta: extras.confidenceCatalystDelta ?? null,
      confidenceFinal: extras.confidenceFinal ?? null,
      catalystAlignment: extras.catalystAlignment ?? null,
      dataSource: extras.dataSource ?? null,
      fetchFailureMode: extras.fetchFailureMode ?? null,
      fullDiagnostic: extras.fullDiagnostic ?? null,
      ...(() => {
        const sc = getStrategistRunContext()?.scannerContext;
        if (!sc) {
          return {
            scannerSource: null,
            scannerScore: null,
            scannerMode: null,
            scannerEdgeType: null,
            scannerDirectionalLean: null,
            scannerSurfacedBy: null,
            scannerFlowScore: null,
            scannerUniverse: null,
          };
        }
        const isUnified = sc.sourceScanner === "unified";
        const flowScore =
          isUnified && sc.flowSignature?.score != null && Number.isFinite(sc.flowSignature.score)
            ? Math.round(sc.flowSignature.score)
            : null;
        return {
          scannerSource: sc.sourceScanner,
          scannerScore: sc.scannerScore,
          scannerMode: sc.scannerMode,
          scannerEdgeType: sc.edgeType,
          scannerDirectionalLean: sc.directionalLean,
          scannerSurfacedBy: isUnified && sc.surfacedBy?.length
            ? [...sc.surfacedBy].sort((a, b) => a.localeCompare(b)).join(",")
            : null,
          scannerFlowScore: isUnified ? flowScore : null,
          scannerUniverse: isUnified ? (sc.scannerUniverse ?? null) : null,
        };
      })(),
    };
    const [row] = await db.insert(strategistTelemetryTable).values(values).returning({ id: strategistTelemetryTable.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error({ err }, "StrategistV2: telemetry logging failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Post-AI reconciliation helpers (Bugs 1, 2, 3)
// ---------------------------------------------------------------------------

function reconcileFlowScoreFromChain(
  ioScore: IOScoreResult,
  chainSummary: ChainSummary,
  ticker: string,
): void {
  const existing = ioScore.components.flowDivergence.volOiRatio;

  // Best vol/OI signal the AI actually sees: highest volOiRatio in unusualActivity,
  // fallback to computed ratio across topVolumeCalls/Puts.
  let chainVoiRatio = 0;
  if (chainSummary.unusualActivity.length > 0) {
    chainVoiRatio = Math.max(...chainSummary.unusualActivity.map((u) => u.volOiRatio));
  } else {
    const combined = [...chainSummary.topVolumeCalls, ...chainSummary.topVolumePuts];
    const ratios = combined
      .filter((c) => c.oi > 0)
      .map((c) => c.volume / c.oi);
    if (ratios.length > 0) chainVoiRatio = Math.max(...ratios);
  }
  chainVoiRatio = Math.round(chainVoiRatio * 100) / 100;

  if (chainVoiRatio <= 0) return; // chain has nothing to offer either

  // Pipeline health check: narrative-source shows significant flow but aggregates say 0
  if (existing === 0 && chainVoiRatio >= 2) {
    logger.warn(
      { ticker, aggregatesVoiRatio: existing, chainVoiRatio, source: "chainSummary.unusualActivity" },
      "StrategistV2: flowDailyAggregates empty for ticker but chain shows flow — patching ioScore.flowDivergence from live chain",
    );
  }

  // Patch whenever chain shows a stronger signal than stale/missing aggregates.
  // NOTE: this is a display-only patch for the narrative/UI surface. We intentionally
  // do NOT recompute ioScore.final or flowDivergence.contribution: when the engine saw
  // `available: false` it already excluded flow from the total with re-weighted siblings,
  // and retroactively adding flow back would alter the headline IOScore in a way the
  // engine never chose. Use canonical formula from computeFlowDivergence() — no skew floor.
  if (chainVoiRatio > existing) {
    const skew = ioScore.components.flowDivergence.skewDivergence;
    const patchedFinal = Math.min(1.0, (chainVoiRatio / 3.0) * skew);
    ioScore.components.flowDivergence.volOiRatio = chainVoiRatio;
    ioScore.components.flowDivergence.final = Math.round(patchedFinal * 100) / 100;
  }
}

function reconcileNarrativeEconomics(
  thesis: string,
  computed: { entryAbs: number; isCredit: boolean; maxProfit: number; maxLoss: number; breakeven: number },
  ticker: string,
): string {
  if (!thesis) return thesis;
  const drifts: Array<{ label: string; cited: number; computed: number; pct: number }> = [];
  let out = thesis;

  const close = (cited: number, truth: number) => {
    if (truth <= 0) return true;
    return Math.abs(cited - truth) / truth <= 0.05;
  };

  const fmtDollar = (n: number) => {
    if (n >= 1000) return Math.round(n).toString();
    if (n >= 100) return Math.round(n).toString();
    return (Math.round(n * 100) / 100).toString();
  };

  // Pattern 1: "$NNN max profit" / "max profit of $NNN" / "max profit $NNN"
  const dollarPatterns: Array<{ re: RegExp; truth: number; label: string }> = [
    { re: /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(max\s+profit)/gi, truth: computed.maxProfit, label: "max profit" },
    { re: /(max\s+profit)[^$\d]{0,12}\$(\d+(?:,\d{3})*(?:\.\d+)?)/gi, truth: computed.maxProfit, label: "max profit" },
    { re: /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(max\s+(?:loss|risk))/gi, truth: computed.maxLoss, label: "max loss" },
    { re: /(max\s+(?:loss|risk))[^$\d]{0,12}\$(\d+(?:,\d{3})*(?:\.\d+)?)/gi, truth: computed.maxLoss, label: "max loss" },
    { re: /\$(\d+(?:\.\d+)?)\s*(debit|credit)/gi, truth: computed.entryAbs, label: "entry" },
    { re: /(debit|credit)[^$\d]{0,12}\$(\d+(?:\.\d+)?)/gi, truth: computed.entryAbs, label: "entry" },
  ];

  for (const { re, truth, label } of dollarPatterns) {
    out = out.replace(re, (match, g1: string, g2: string) => {
      const numStr = /^\d/.test(g1) ? g1 : g2;
      const cited = parseFloat(numStr.replace(/,/g, ""));
      if (!Number.isFinite(cited) || cited <= 0) return match;
      if (truth <= 0) {
        // Can't replace safely, but log mismatch for canary visibility
        drifts.push({ label, cited, computed: truth, pct: 1 });
        return match;
      }
      if (close(cited, truth)) return match;
      drifts.push({ label, cited, computed: truth, pct: Math.abs(cited - truth) / truth });
      return match.replace(numStr, fmtDollar(truth));
    });
  }

  // Pattern 2: "X.X:1" ratios — gated to risk/reward context only (avoids false positives on
  // "3:1 ratio spread", "2:1 call/put skew", etc.). Only replace when a risk/reward keyword
  // appears within ~30 chars on either side of the ratio token.
  if (computed.maxLoss > 0 && computed.maxProfit > 0) {
    const truthRR = computed.maxProfit / computed.maxLoss;
    const rrContextRe = /([\s\S]{0,30})(\d+(?:\.\d+)?)\s*:\s*1([\s\S]{0,30})/g;
    const rrKeyword = /risk[\s/-]*reward|reward[\s/-]*to[\s/-]*risk|r[\s/-]*(?:to|\/|:)?[\s/-]*r\b|r:r|risk[\s:/-]*r|payoff[\s/-]*ratio/i;
    out = out.replace(rrContextRe, (match, before: string, numStr: string, after: string) => {
      const cited = parseFloat(numStr);
      if (!Number.isFinite(cited) || cited <= 0) return match;
      if (cited < 0.1 || cited > 20) return match; // sane R/R range
      const context = `${before} ${after}`;
      if (!rrKeyword.test(context)) return match; // not a risk/reward context — leave alone
      if (Math.abs(cited - truthRR) / truthRR <= 0.05) return match;
      drifts.push({ label: "risk/reward", cited, computed: truthRR, pct: Math.abs(cited - truthRR) / truthRR });
      const fixed = (Math.round(truthRR * 100) / 100).toFixed(2);
      return match.replace(`${numStr}`, fixed).replace(/(\d+\.\d{2}):\s*1/, `${fixed}:1`);
    });
  }

  if (drifts.length > 0) {
    logger.warn(
      {
        ticker,
        drifts: drifts.map((d) => ({
          label: d.label,
          citedByAi: d.cited,
          computedFromLegs: Math.round(d.computed * 100) / 100,
          driftPct: Math.round(d.pct * 1000) / 10,
        })),
      },
      "StrategistV2: narrative economics drifted from computed — auto-corrected in thesis",
    );
  }

  return out;
}

function normalizeExitTargets(
  raw: { profitTarget: number; profitTargetUnderlying: number; stopLoss: number; stopLossUnderlying: number; timeStop: string } | undefined,
  entryAbs: number,
  maxProfit: number,
  maxLoss: number,
  ticker: string,
  isCredit: boolean = false,
): { profitTarget: number; profitTargetUnderlying: number; stopLoss: number; stopLossUnderlying: number; timeStop: string } {
  const def = { profitTarget: 0, profitTargetUnderlying: 0, stopLoss: 0, stopLossUnderlying: 0, timeStop: "" };
  if (!raw) return def;

  const normalizeOne = (v: number, label: "profitTarget" | "stopLoss"): number => {
    if (!Number.isFinite(v) || v <= 0) return 0;
    // Semantic classifier (not a raw ratio): a value is treated as dollar-P&L-on-1-lot
    // only if ALL of:
    //   1. v > 50 (no realistic per-share option target for retail tickers reaches $50;
    //      deep-ITM spreads may but they're rare and benefit from the close-match check below)
    //   2. The dollar-interpretation (v) is a close match (<25% drift) to the appropriate
    //      max P&L dollar figure (maxProfit for profitTarget, maxLoss for stopLoss).
    //   3. The per-share interpretation (v) would be implausibly far from entry (>15x).
    // This avoids mis-normalizing legitimate per-share targets on cheap options.
    const truth = label === "profitTarget" ? maxProfit : maxLoss;
    const lookLikeDollar =
      v > 50 &&
      truth > 0 &&
      Math.abs(v - truth) / truth < 0.25 &&
      entryAbs > 0 &&
      v > entryAbs * 15;
    if (lookLikeDollar) {
      const perShare = Math.round((v / 100) * 100) / 100;
      logger.warn(
        { ticker, field: label, reported: v, entryAbs, truthDollar: truth, normalized: perShare },
        "StrategistV2: exitTargets value matched dollar-P&L interpretation; normalized to per-share option price",
      );
      return perShare;
    }
    return Math.round(v * 100) / 100;
  };

  // Step 1: per-share-vs-dollar normalization.
  const normalizedProfit = normalizeOne(raw.profitTarget, "profitTarget");
  const normalizedStop = normalizeOne(raw.stopLoss, "stopLoss");

  // Step 2 (Bug 3): clamp profit target to the structure's max physical
  // payout. The AI generated $3.30/share on a 705/700 SPY bear put with $1.81
  // debit — max profit per share for that structure is $3.19, so the target
  // exceeded what the spread can pay. Cap at (maxProfit/100 - tick_buffer).
  const clamp = clampProfitTargetToMaxPayout({
    profitTarget: normalizedProfit,
    maxProfit,
    isCredit,
  });
  if (clamp.wasClamped) {
    logger.warn(
      {
        ticker,
        original: normalizedProfit,
        clamped: clamp.clamped,
        cap: clamp.cap,
        maxProfit,
        entryAbs,
      },
      "StrategistV2: profit target exceeded max payout — clamped",
    );
  }

  return {
    profitTarget: clamp.clamped,
    profitTargetUnderlying: Number.isFinite(raw.profitTargetUnderlying) ? raw.profitTargetUnderlying : 0,
    stopLoss: normalizedStop,
    stopLossUnderlying: Number.isFinite(raw.stopLossUnderlying) ? raw.stopLossUnderlying : 0,
    timeStop: raw.timeStop ?? "",
  };
}

function buildContextSources(
  resp: AiTradeResponse,
  trace: WebSearchTrace,
  catalyst?: CatalystEvaluation | null,
): ContextSourcesPayload {
  const merged = new Map<string, { title: string; url: string; date?: string }>();
  for (const s of trace.sources) {
    merged.set(s.url, { title: s.title, url: s.url, date: s.date });
  }
  for (const h of resp.citedHeadlines ?? []) {
    if (!h.url) continue;
    if (!merged.has(h.url)) {
      merged.set(h.url, { title: h.title, url: h.url, date: h.date });
    }
  }
  // Mirror new catalyst evaluation into legacy fields for back-compat with
  // older UI code paths and persisted history records.
  const legacyAlignment: "ALIGNED" | "CONTRADICTS" | "NEUTRAL" | "NONE" =
    catalyst?.catalystAlignment === "ALIGNED" ? "ALIGNED" :
    catalyst?.catalystAlignment === "CONTRADICTS" ? "CONTRADICTS" :
    catalyst?.catalystAlignment === "NEUTRAL" ? "NEUTRAL" :
    "NONE";
  return {
    webSearchUsed: trace.webSearchUsed,
    queryCount: trace.queries.length,
    queries: trace.queries,
    sources: Array.from(merged.values()).slice(0, 12),
    // Legacy day-trader field — retained for history/UI compat, never set true going forward.
    sameDayCatalyst: false,
    catalystSummary: catalyst?.catalystSummary ?? resp.catalystSummary,
    catalystAlignment: legacyAlignment,
    catalyst: catalyst ?? undefined,
  };
}
