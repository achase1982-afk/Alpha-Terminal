/**
 * Scanner candidate shape from GET /api/v2/scan (snapshot table + card mapping).
 */

export type TermStructureShape = "contango" | "flat" | "backwardation";

/** Full scanner card model for Layer 1–6 (frontend / future API mapping). */
export type ScannerCardData = {
  // Layer 1+2 minimum
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePct: number | null;
  changeAbs: number | null;
  volume: number | null;
  avgVolume20d: number | null;
  dayRange: { low: number; high: number } | null;

  // Layer 3
  iv30: number | null;
  ivr: number | null;
  ivPercentile: number | null;
  hv30: number | null;
  /** IV30 / HV30 when both known (wire / API may omit; UI can derive). */
  ivVsHv: number | null;
  termStructure: {
    frontIv: number;
    backIv: number;
    ratio: number;
    shape: TermStructureShape;
  } | null;

  // Layer 4
  nextEarnings: {
    date: string;
    daysTo: number;
    timing: "AMC" | "BMO" | null;
  } | null;
  nextExDiv: { date: string; daysTo: number; amount: number | null } | null;
  earningsHistory: { quarter: string; absMovePct: number }[] | null;

  // Layer 5 (rolling 4h window; null panel when no prints in window)
  flow: {
    blocks4h: number | null;
    sweeps4h: number | null;
    netDeltaDollar: number | null;
    topStrikeLabel: string | null;
    topStrike: {
      strike: number;
      optionType: "call" | "put";
      expiration: string;
      volumeAtStrike: number;
      openInterest: number | null;
    } | null;
    volume4h: number | null;
    volumeOverOi: number | null;
  } | null;

  // Technical (derived from existing equity_daily, no new integration)
  technical: {
    week52High: number;
    week52Low: number;
    pctOffHigh: number;
    aboveMa20: boolean;
    aboveMa50: boolean;
    aboveMa200: boolean;
    return5d: number;
    return30d: number;
  } | null;

  // Layer 6
  score: number | null;
  scoreComponents: {
    liquidity: number;
    volContext: number;
    catalyst: number;
    flow: number;
    technical: number;
  } | null;
  preset: string | null;

  // Meta
  lastUpdate: string;
  dataQualityFlags: string[];
};

export type UnifiedEngineKey = "discovery" | "momentum" | "unusual_flow";

export interface UnifiedScanCandidate {
  ticker: string;
  spot: number;
  changePct: number;
  sector: string;
  marketCapTier: string;
  /** Scanner engines and/or v1 sub-score keys that cleared the high threshold. */
  surfacedBy: string[];
  compositeScore: number;
  edgeType: import("./scannerStrategistHandoff").ScannerEdgeType;
  directionalLean: "bullish" | "bearish" | "neutral";
  ivr: number | null;
  ivrSource: "canonical" | "intraday" | "missing";
  ivrAsOfDate: string | null;
  hv20: number | null;
  hv30: number | null;
  high52w: number | null;
  low52w: number | null;
  avgVolume20d: number | null;
  components: {
    trend: number;
    relativeStrength: number;
    volRegime: number;
    flowScore: number;
    liquidity: number;
  };
  flowSnapshot: {
    topStrike: { strike: number; expiry: string; type: "call" | "put" } | null;
    volumeMix: { askPct: number; bidPct: number; midPct: number };
    /** Graduated tape backfill coverage (scanner v1). Legacy name kept for wire compatibility. */
    tapeQuality: "complete" | "high" | "degraded" | "partial" | "not_run";
    tapeOccCoveragePct?: number | null;
    tapeInsertCoveragePct?: number | null;
    tapeAnyTruncated?: boolean | null;
    notional24h: number | null;
  };
  catalystWindow: {
    nextEarnings: { date: string; daysAway: number; confirmed: boolean } | null;
    macroEventsInPositionWindow: Array<{ date: string; title: string }>;
  };
  riskFlags: string[];
  positionContext: { hasPosition: boolean };
  surfacingReasons: Array<{ engine: UnifiedEngineKey; reasons: string[] }>;
  /** Extra fields from v2 snapshot (optional for card / debugging). */
  atmIvByExpiry?: unknown;
  skew25dByExpiry?: unknown;
  impliedMoveFrontPct?: number | null;
  impliedMoveFrontAbs?: number | null;
  snapshotAt?: string | null;
  chainUpdatedAt?: string | null;
  flowUpdatedAt?: string | null;
}

export interface V2ScanWireResponse {
  candidates: UnifiedScanCandidate[];
  /** ISO timestamp of latest scanner_health cycle_completed_at (pipeline snapshot boundary). */
  snapshot_completed_at: string | null;
  snapshot_age_seconds: number | null;
  /** True when snapshot_age_seconds > 5 minutes (same threshold as server staleness). */
  stale: boolean | null;
  scan_at: string;
}
