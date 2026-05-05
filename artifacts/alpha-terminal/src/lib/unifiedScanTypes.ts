/**
 * Scanner candidate shape from GET /api/v2/scan (snapshot table + card mapping).
 */

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
