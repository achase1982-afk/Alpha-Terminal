/**
 * Client-side mirror of POST /strategist/analyze `scannerContext`.
 * Keep field names in sync with `scannerStrategistContext.ts` on the backend.
 */

export type ScannerSourceForStrategist =
  | "discovery"
  | "momentum"
  | "unusual_flow"
  | "unified";

export type ScannerModeForStrategist = "DEFAULT" | "IDIOSYNCRATIC";
export type DirectionalLeanForStrategist = "bullish" | "bearish" | "neutral";
export type ScannerEdgeType =
  | "premium_sale"
  | "premium_buy"
  | "directional_bullish"
  | "directional_bearish"
  | "calendar"
  | "no_clear_edge";

export type ScannerSurfacedByEngine = "discovery" | "momentum" | "flow";

export interface ScannerFlowTopStrikePayload {
  strike: number;
  expiry: string;
  notional: number;
  askPct: number;
  bidPct: number;
}

export interface ScannerFlowSignaturePayload {
  score: number | null;
  topStrike?: ScannerFlowTopStrikePayload | null;
  putCallRatio?: number | null;
  tapeStatus?: string | null;
}

export interface ScannerStrategistContextPayload {
  sourceScanner: ScannerSourceForStrategist;
  scannerScore: number;
  scannerMode: ScannerModeForStrategist | null;
  edgeType: ScannerEdgeType;
  directionalLean: DirectionalLeanForStrategist | null;
  componentBreakdown: {
    trend: number;
    rs: number;
    volume: number;
    ivr: number;
    liquidity: number;
  };
  unusualFlow: boolean;
  catalystBonusApplied: boolean;
  surfacedBy?: ScannerSurfacedByEngine[];
  flowSignature?: ScannerFlowSignaturePayload | null;
  scannerUniverse?: string | null;
}

function leanToApi(lean: "BULLISH" | "BEARISH" | "MIXED" | null | undefined): DirectionalLeanForStrategist | null {
  if (!lean) return null;
  if (lean === "MIXED") return "neutral";
  return lean === "BULLISH" ? "bullish" : "bearish";
}

export function buildScannerContextFromDetCandidate(
  candidate: {
    totalScore: number;
    edgeType: ScannerEdgeType;
    directionalLean?: "BULLISH" | "BEARISH" | "MIXED" | null;
    components: { trendAlignment: number; relativeStrength: number; volumeConfirmation: number; ivrScore: number; optionsLiquidity: number };
    unusualFlow?: { unusualStrikeCount: number } | null;
    scanMode?: "DISCOVERY" | "MOMENTUM";
  },
  opts: { scannerMode: ScannerModeForStrategist | null; catalystBonusApplied: boolean },
): ScannerStrategistContextPayload {
  const source: ScannerSourceForStrategist =
    candidate.scanMode === "MOMENTUM" ? "momentum" : "discovery";
  return {
    sourceScanner: source,
    scannerScore: Math.round(candidate.totalScore),
    scannerMode: opts.scannerMode,
    edgeType: candidate.edgeType,
    directionalLean: leanToApi(candidate.directionalLean),
    componentBreakdown: {
      trend: candidate.components.trendAlignment,
      rs: candidate.components.relativeStrength,
      volume: candidate.components.volumeConfirmation,
      ivr: candidate.components.ivrScore,
      liquidity: candidate.components.optionsLiquidity,
    },
    unusualFlow: !!(candidate.unusualFlow && candidate.unusualFlow.unusualStrikeCount > 0),
    catalystBonusApplied: opts.catalystBonusApplied,
  };
}

export function buildScannerContextFromUnusualCandidate(candidate: {
  score: number;
  edgeType: ScannerEdgeType;
  skew: "bullish" | "bearish" | "balanced";
}): ScannerStrategistContextPayload {
  const directionalLean: DirectionalLeanForStrategist | null =
    candidate.skew === "bullish" ? "bullish" : candidate.skew === "bearish" ? "bearish" : "neutral";
  return {
    sourceScanner: "unusual_flow",
    scannerScore: Math.round(candidate.score),
    scannerMode: null,
    edgeType: candidate.edgeType,
    directionalLean,
    componentBreakdown: {
      trend: 0,
      rs: 0,
      volume: 0,
      ivr: 0,
      liquidity: candidate.score,
    },
    unusualFlow: true,
    catalystBonusApplied: false,
  };
}

export function buildScannerContextFromUnified(args: {
  scannerScore: number;
  edgeType: ScannerEdgeType;
  directionalLean: DirectionalLeanForStrategist | null;
  componentBreakdown: ScannerStrategistContextPayload["componentBreakdown"];
  surfacedBy: ScannerSurfacedByEngine[];
  unusualFlow: boolean;
  catalystBonusApplied: boolean;
  flowSignature: ScannerFlowSignaturePayload | null | undefined;
  scannerUniverse?: string | null;
}): ScannerStrategistContextPayload {
  const surfacedBy = [...new Set(args.surfacedBy)].sort((a, b) => a.localeCompare(b));
  return {
    sourceScanner: "unified",
    scannerScore: Math.round(args.scannerScore),
    scannerMode: null,
    edgeType: args.edgeType,
    directionalLean: args.directionalLean,
    componentBreakdown: args.componentBreakdown,
    unusualFlow: args.unusualFlow,
    catalystBonusApplied: args.catalystBonusApplied,
    surfacedBy,
    flowSignature: args.flowSignature ?? undefined,
    scannerUniverse: args.scannerUniverse ?? null,
  };
}
