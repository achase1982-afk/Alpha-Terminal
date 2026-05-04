import type { ScannerEdgeType } from "./scannerEdgeType.js";

export type ScannerSourceForStrategist = "discovery" | "momentum" | "unusual_flow";

export type ScannerModeForStrategist = "DEFAULT" | "IDIOSYNCRATIC";

export type DirectionalLeanForStrategist = "bullish" | "bearish" | "neutral";

export interface ScannerStrategistContext {
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
}

function leanToApi(lean: "BULLISH" | "BEARISH" | "MIXED" | null | undefined): DirectionalLeanForStrategist | null {
  if (!lean) return null;
  if (lean === "MIXED") return "neutral";
  return lean === "BULLISH" ? "bullish" : "bearish";
}

/** Validate body.scannerContext from POST /strategist/analyze. */
export function parseScannerContext(raw: unknown): ScannerStrategistContext | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const src = o["sourceScanner"];
  if (src !== "discovery" && src !== "momentum" && src !== "unusual_flow") return null;
  const score = o["scannerScore"];
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const edge = o["edgeType"];
  const allowed: ScannerEdgeType[] = [
    "premium_sale",
    "premium_buy",
    "directional_bullish",
    "directional_bearish",
    "calendar",
    "no_clear_edge",
  ];
  if (typeof edge !== "string" || !allowed.includes(edge as ScannerEdgeType)) return null;
  const modeRaw = o["scannerMode"];
  const scannerMode: ScannerModeForStrategist | null =
    modeRaw === "DEFAULT" || modeRaw === "IDIOSYNCRATIC" ? modeRaw : null;
  const leanRaw = o["directionalLean"];
  const directionalLean: DirectionalLeanForStrategist | null =
    leanRaw === "bullish" || leanRaw === "bearish" || leanRaw === "neutral" ? leanRaw : null;
  const bd = o["componentBreakdown"];
  if (!bd || typeof bd !== "object") return null;
  const b = bd as Record<string, unknown>;
  const num = (k: string) => (typeof b[k] === "number" && Number.isFinite(b[k] as number) ? (b[k] as number) : NaN);
  const trend = num("trend");
  const rs = num("rs");
  const volume = num("volume");
  const ivr = num("ivr");
  const liquidity = num("liquidity");
  if ([trend, rs, volume, ivr, liquidity].some((x) => !Number.isFinite(x))) return null;
  const unusualFlow = o["unusualFlow"] === true;
  const catalystBonusApplied = o["catalystBonusApplied"] === true;
  return {
    sourceScanner: src,
    scannerScore: Math.round(score),
    scannerMode,
    edgeType: edge as ScannerEdgeType,
    directionalLean,
    componentBreakdown: { trend, rs, volume, ivr, liquidity },
    unusualFlow,
    catalystBonusApplied,
  };
}

export function buildScannerContextFromDiscoveryCandidate(args: {
  totalScore: number;
  scannerMode: ScannerModeForStrategist | null;
  edgeType: ScannerEdgeType;
  directionalLean?: "BULLISH" | "BEARISH" | "MIXED" | null;
  components: { trendAlignment: number; relativeStrength: number; volumeConfirmation: number; ivrScore: number; optionsLiquidity: number };
  unusualFlow: boolean;
  catalystBonusApplied: boolean;
}): ScannerStrategistContext {
  return {
    sourceScanner: "discovery",
    scannerScore: Math.round(args.totalScore),
    scannerMode: args.scannerMode,
    edgeType: args.edgeType,
    directionalLean: leanToApi(args.directionalLean),
    componentBreakdown: {
      trend: args.components.trendAlignment,
      rs: args.components.relativeStrength,
      volume: args.components.volumeConfirmation,
      ivr: args.components.ivrScore,
      liquidity: args.components.optionsLiquidity,
    },
    unusualFlow: args.unusualFlow,
    catalystBonusApplied: args.catalystBonusApplied,
  };
}

export function buildScannerContextFromMomentumCandidate(args: {
  totalScore: number;
  edgeType: ScannerEdgeType;
  directionalLean?: "BULLISH" | "BEARISH" | "MIXED" | null;
  components: { trendAlignment: number; relativeStrength: number; volumeConfirmation: number; ivrScore: number; optionsLiquidity: number };
}): ScannerStrategistContext {
  return {
    sourceScanner: "momentum",
    scannerScore: Math.round(args.totalScore),
    scannerMode: null,
    edgeType: args.edgeType,
    directionalLean: leanToApi(args.directionalLean),
    componentBreakdown: {
      trend: args.components.trendAlignment,
      rs: args.components.relativeStrength,
      volume: args.components.volumeConfirmation,
      ivr: args.components.ivrScore,
      liquidity: args.components.optionsLiquidity,
    },
    unusualFlow: false,
    catalystBonusApplied: false,
  };
}

export function buildScannerContextFromUnusualFlowCandidate(args: {
  score: number;
  edgeType: ScannerEdgeType;
  skew: "bullish" | "bearish" | "balanced";
}): ScannerStrategistContext {
  const directionalLean: DirectionalLeanForStrategist | null =
    args.skew === "bullish" ? "bullish" : args.skew === "bearish" ? "bearish" : "neutral";
  return {
    sourceScanner: "unusual_flow",
    scannerScore: Math.round(args.score),
    scannerMode: null,
    edgeType: args.edgeType,
    directionalLean,
    componentBreakdown: {
      trend: 0,
      rs: 0,
      volume: 0,
      ivr: 0,
      liquidity: args.score,
    },
    unusualFlow: true,
    catalystBonusApplied: false,
  };
}

/** Plain-text block prepended before the JSON data package in analyst prompts. */
export function buildScannerContextPromptBlock(ctx: ScannerStrategistContext | null | undefined): string {
  if (!ctx) return "";
  const modeStr = ctx.scannerMode ?? "not specified";
  const leanStr = ctx.directionalLean ?? "not specified";
  return `

SCANNER CONTEXT (for your information only):
The ${ctx.sourceScanner} scanner flagged this name with score ${ctx.scannerScore} and classified the edge type as ${ctx.edgeType}. Scanner regime weights mode: ${modeStr}. Directional lean: ${leanStr}.

Treat this as input, not authority. The scanner can be wrong. Reach your own conclusion based on the full data package below. If you disagree with the scanner's edge type classification, say so and explain why.
`;
}
