/**
 * Unified scan job and candidate shapes returned by GET /api/ai/scan/:scanId.
 */

export type UnifiedEngineKey = "discovery" | "momentum" | "unusual_flow";

export interface UnifiedEngineRunStatus {
  status: "ok" | "failed" | "timeout";
  durationMs: number;
  resultCount: number;
  error?: string;
}

export interface UnifiedScanCandidate {
  ticker: string;
  spot: number;
  changePct: number;
  sector: string;
  marketCapTier: string;
  surfacedBy: UnifiedEngineKey[];
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
    tapeQuality: "complete" | "partial" | "degraded" | "not_run";
    notional24h: number | null;
  };
  catalystWindow: {
    nextEarnings: { date: string; daysAway: number; confirmed: boolean } | null;
    macroEventsInPositionWindow: Array<{ date: string; title: string }>;
  };
  riskFlags: string[];
  positionContext: { hasPosition: boolean };
  surfacingReasons: Array<{ engine: UnifiedEngineKey; reasons: string[] }>;
}

export interface UnifiedScanJobResult {
  scanId: string;
  status: "queued" | "running" | "complete" | "failed";
  startedAt: string;
  completedAt: string | null;
  universeId: string;
  symbolsScanned: number;
  engineStatus: {
    discovery: UnifiedEngineRunStatus;
    momentum: UnifiedEngineRunStatus;
    unusual_flow: UnifiedEngineRunStatus;
  };
  candidates: UnifiedScanCandidate[];
  error?: string;
}
