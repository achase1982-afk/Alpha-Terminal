import type { ScannerEdgeType } from "./scannerEdgeType.js";

export type ScannerSourceForStrategist =
  | "discovery"
  | "momentum"
  | "unusual_flow"
  | "unified";

export type ScannerModeForStrategist = "DEFAULT" | "IDIOSYNCRATIC";

export type DirectionalLeanForStrategist = "bullish" | "bearish" | "neutral";

/** Surfaced-by engine ids (unified scanner); "flow" == unusual flow engine. */
export type ScannerSurfacedByEngine = "discovery" | "momentum" | "flow";

export interface ScannerFlowTopStrike {
  strike: number;
  expiry: string;
  notional: number;
  askPct: number;
  bidPct: number;
}

export interface ScannerFlowSignature {
  score: number | null;
  topStrike?: ScannerFlowTopStrike | null;
  putCallRatio?: number | null;
  tapeStatus?: string | null;
}

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
  /** Unified handoff only: engines that surfaced the name (sorted alphabetically). */
  surfacedBy?: ScannerSurfacedByEngine[];
  /** Unified handoff only: flow summary (honest labeling; not merged into liquidity). */
  flowSignature?: ScannerFlowSignature | null;
  /** Optional: universe key for telemetry (e.g. preset:liquidCore130). */
  scannerUniverse?: string | null;
}

const SURFACED_BY_ENGINES = new Set<string>(["discovery", "momentum", "flow"]);

function leanToApi(lean: "BULLISH" | "BEARISH" | "MIXED" | null | undefined): DirectionalLeanForStrategist | null {
  if (!lean) return null;
  if (lean === "MIXED") return "neutral";
  return lean === "BULLISH" ? "bullish" : "bearish";
}

function parseComponentBreakdown(bd: Record<string, unknown>): {
  trend: number;
  rs: number;
  volume: number;
  ivr: number;
  liquidity: number;
} | null {
  const num = (k: string) => (typeof bd[k] === "number" && Number.isFinite(bd[k] as number) ? (bd[k] as number) : NaN);
  const trend = num("trend");
  const rs = num("rs");
  const volume = num("volume");
  const ivr = num("ivr");
  const liquidity = num("liquidity");
  if ([trend, rs, volume, ivr, liquidity].some((x) => !Number.isFinite(x))) return null;
  return { trend, rs, volume, ivr, liquidity };
}

function parseSurfacedBy(raw: unknown): ScannerSurfacedByEngine[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ScannerSurfacedByEngine[] = [];
  for (const x of raw) {
    if (typeof x !== "string" || !SURFACED_BY_ENGINES.has(x)) return null;
    out.push(x as ScannerSurfacedByEngine);
  }
  return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

function parseFlowSignature(raw: unknown): ScannerFlowSignature | null | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  if (Object.keys(f).length === 0) return {};
  const score =
    f["score"] == null
      ? null
      : typeof f["score"] === "number" && Number.isFinite(f["score"])
        ? Math.round(f["score"] as number)
        : null;
  let topStrike: ScannerFlowTopStrike | null | undefined;
  const ts = f["topStrike"];
  if (ts != null) {
    if (typeof ts !== "object") return null;
    const t = ts as Record<string, unknown>;
    const strike = typeof t["strike"] === "number" && Number.isFinite(t["strike"]) ? (t["strike"] as number) : NaN;
    const expiry = typeof t["expiry"] === "string" ? t["expiry"] : "";
    const notional =
      typeof t["notional"] === "number" && Number.isFinite(t["notional"]) ? (t["notional"] as number) : NaN;
    const askPct = typeof t["askPct"] === "number" && Number.isFinite(t["askPct"]) ? (t["askPct"] as number) : NaN;
    const bidPct = typeof t["bidPct"] === "number" && Number.isFinite(t["bidPct"]) ? (t["bidPct"] as number) : NaN;
    if (!Number.isFinite(strike) || !expiry || !Number.isFinite(notional) || !Number.isFinite(askPct) || !Number.isFinite(bidPct)) {
      return null;
    }
    topStrike = { strike, expiry, notional, askPct, bidPct };
  }
  const putCallRatio =
    f["putCallRatio"] == null
      ? undefined
      : typeof f["putCallRatio"] === "number" && Number.isFinite(f["putCallRatio"])
        ? (f["putCallRatio"] as number)
        : null;
  const tapeStatus =
    f["tapeStatus"] == null
      ? undefined
      : typeof f["tapeStatus"] === "string"
        ? (f["tapeStatus"] as string)
        : null;
  return { score, topStrike: topStrike ?? undefined, putCallRatio, tapeStatus };
}

/** Validate body.scannerContext from POST /strategist/analyze. Legacy three-source + unified. */
export function parseScannerContext(raw: unknown): ScannerStrategistContext | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const src = o["sourceScanner"];
  if (src !== "discovery" && src !== "momentum" && src !== "unusual_flow" && src !== "unified") return null;
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
  const breakdown = parseComponentBreakdown(bd as Record<string, unknown>);
  if (!breakdown) return null;
  const unusualFlow = o["unusualFlow"] === true;
  const catalystBonusApplied = o["catalystBonusApplied"] === true;

  const scannerUniverse =
    o["scannerUniverse"] == null
      ? null
      : typeof o["scannerUniverse"] === "string"
        ? o["scannerUniverse"]
        : null;

  if (src === "unified") {
    const surfacedBy = parseSurfacedBy(o["surfacedBy"]);
    if (!surfacedBy || surfacedBy.length === 0) return null;
    if (o["flowSignature"] !== undefined) {
      const parsed = parseFlowSignature(o["flowSignature"]);
      if (parsed === null) return null;
    }
    const flowSig = parseFlowSignature(o["flowSignature"]);
    return {
      sourceScanner: "unified",
      scannerScore: Math.round(score),
      scannerMode,
      edgeType: edge as ScannerEdgeType,
      directionalLean,
      componentBreakdown: breakdown,
      unusualFlow,
      catalystBonusApplied,
      surfacedBy,
      flowSignature: flowSig ?? undefined,
      scannerUniverse,
    };
  }

  return {
    sourceScanner: src,
    scannerScore: Math.round(score),
    scannerMode,
    edgeType: edge as ScannerEdgeType,
    directionalLean,
    componentBreakdown: breakdown,
    unusualFlow,
    catalystBonusApplied,
    scannerUniverse,
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

function formatMoneyUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** Plain-text block prepended before the JSON data package in analyst prompts. */
export function buildScannerContextPromptBlock(ctx: ScannerStrategistContext | null | undefined): string {
  if (!ctx) return "";
  const modeStr = ctx.scannerMode ?? "not specified";
  const leanStr = ctx.directionalLean ?? "not specified";
  const { trend, rs, volume, ivr, liquidity } = ctx.componentBreakdown;
  const componentLine =
    `Component scores — Trend ${trend}, RS ${rs}, Volume ${volume}, IVR ${ivr}, Options liquidity ${liquidity}.`;

  if (ctx.sourceScanner === "unified") {
    const engines = (ctx.surfacedBy ?? []).join(" + ");
    const fs = ctx.flowSignature;
    const topFlow =
      fs?.topStrike != null
        ? `Top flow: ${fs.topStrike.strike} ${fs.topStrike.expiry}, ${formatMoneyUsd(fs.topStrike.notional)} notional, ${fs.topStrike.askPct.toFixed(0)}% ask / ${fs.topStrike.bidPct.toFixed(0)}% bid.`
        : null;
    const tape =
      fs?.tapeStatus != null && fs.tapeStatus.length > 0
        ? `Tape: ${fs.tapeStatus}.`
        : null;
    const flowScoreLine =
      fs?.score != null && Number.isFinite(fs.score)
        ? `Flow score (unusual-activity engine): ${Math.round(fs.score)}.`
        : null;
    const pc =
      fs?.putCallRatio != null && Number.isFinite(fs.putCallRatio)
        ? `Options P/C (flow snapshot): ${fs.putCallRatio.toFixed(2)}.`
        : null;

    const lines = [
      "",
      "SCANNER CONTEXT (for your information only):",
      `The unified scanner flagged this name with composite score ${ctx.scannerScore} and classified the edge type as ${ctx.edgeType}. Scanner regime weights mode: ${modeStr}. Directional lean: ${leanStr}.`,
      `Surfaced by: ${engines}`,
      componentLine,
      flowScoreLine,
      topFlow,
      pc,
      tape,
      "",
      "Treat this as input, not authority. The scanner can be wrong. Reach your own conclusion based on the full data package below. If you disagree with the scanner's edge type classification, say so and explain why.",
    ];
    return lines.filter((l) => l != null && l !== "").join("\n");
  }

  return `

SCANNER CONTEXT (for your information only):
The ${ctx.sourceScanner} scanner flagged this name with score ${ctx.scannerScore} and classified the edge type as ${ctx.edgeType}. Scanner regime weights mode: ${modeStr}. Directional lean: ${leanStr}.

Treat this as input, not authority. The scanner can be wrong. Reach your own conclusion based on the full data package below. If you disagree with the scanner's edge type classification, say so and explain why.
`;
}
