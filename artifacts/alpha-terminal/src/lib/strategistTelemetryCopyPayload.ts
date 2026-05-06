/** Pure copy-payload builder for Strategist telemetry rows (used by UI + tests). */

export type CopySectionId =
  | "summary"
  | "strategistOutput"
  | "decisionContext"
  | "volSurface"
  | "optionsChain"
  | "flow"
  | "catalyst"
  | "dataQuality"
  | "diagnostic"
  | "rawAiResponse";

export const COPY_SECTIONS_STORAGE_KEY = "strategistTelemetryCopySections";

export const COPY_SECTIONS: { id: CopySectionId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "strategistOutput", label: "Strategist Output" },
  { id: "decisionContext", label: "Decision Context" },
  { id: "volSurface", label: "Vol Surface" },
  { id: "optionsChain", label: "Options Chain" },
  { id: "flow", label: "Flow" },
  { id: "catalyst", label: "Catalyst" },
  { id: "dataQuality", label: "Data Quality" },
  { id: "diagnostic", label: "Diagnostic" },
  { id: "rawAiResponse", label: "Raw AI Response" },
];

const DP_KEYS_STRATEGIST = ["strategistPayload"] as const;
const DP_KEYS_VOL = ["optionsChainSummary", "realizedVol", "ivrContext"] as const;
const DP_KEYS_OPTIONS = ["curatedExpirations", "availableExpirations"] as const;
const DP_KEYS_FLOW = ["polygonFlowHighlights", "tapeBackfill"] as const;
const DP_KEYS_CATALYST = ["catalyst", "macroEventsInPositionWindow", "nextEarnings", "polygonAnalyst"] as const;
const DP_KEYS_DATA_QUALITY = ["dataQualitySummary"] as const;

const DP_KEYS_OTHER_SECTIONS: ReadonlySet<string> = new Set([
  ...DP_KEYS_STRATEGIST,
  ...DP_KEYS_VOL,
  ...DP_KEYS_OPTIONS,
  ...DP_KEYS_FLOW,
  ...DP_KEYS_CATALYST,
  ...DP_KEYS_DATA_QUALITY,
  "catalystEvaluation",
]);

/** Fields referenced by `buildSectionedCopyPayload`. */
export interface StrategistTelemetryCopyRow {
  ticker: string;
  timestamp: string;
  result: string;
  regime: unknown;
  tickerData: unknown;
  idioScore: unknown;
  toxicGate: unknown;
  edgeAttribution: unknown;
  fullDiagnostic?: unknown;
  dataPackage?: unknown;
  rawAiResponse?: string | null;
  confidenceBase?: number | null;
  confidenceCatalystDelta?: number | null;
  confidenceFinal?: number | null;
  scannerSource?: string | null;
  scannerScore?: number | null;
  scannerEdgeType?: string | null;
  scannerDirectionalLean?: string | null;
  scannerMode?: string | null;
  scannerSurfacedBy?: string | null;
  scannerFlowScore?: number | null;
  scannerUniverse?: string | null;
}

export function parseDataPackageRecord(dataPackage: unknown): Record<string, unknown> | null {
  if (dataPackage == null) return null;
  if (typeof dataPackage === "string") {
    try {
      const v = JSON.parse(dataPackage) as unknown;
      return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof dataPackage === "object" && !Array.isArray(dataPackage)) {
    return dataPackage as Record<string, unknown>;
  }
  return null;
}

function pickDp(dp: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in dp) out[k] = dp[k];
  }
  return out;
}

function pickSummaryDataPackageSlice(dp: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(dp)) {
    if (!DP_KEYS_OTHER_SECTIONS.has(k)) out[k] = dp[k];
  }
  return out;
}

export function buildSectionedCopyPayload(
  row: StrategistTelemetryCopyRow,
  selected: ReadonlySet<CopySectionId>,
): Record<string, unknown> {
  const dp = parseDataPackageRecord(row.dataPackage);
  const out: Record<string, unknown> = {};

  if (selected.has("summary")) {
    const summary: Record<string, unknown> = {
      ticker: row.ticker,
      timestamp: row.timestamp,
      result: row.result,
      scannerSource: row.scannerSource ?? null,
      scannerScore: row.scannerScore ?? null,
      scannerEdgeType: row.scannerEdgeType ?? null,
      scannerDirectionalLean: row.scannerDirectionalLean ?? null,
      scannerMode: row.scannerMode ?? null,
      scannerSurfacedBy: row.scannerSurfacedBy ?? null,
      scannerFlowScore: row.scannerFlowScore ?? null,
      scannerUniverse: row.scannerUniverse ?? null,
    };
    if (dp) Object.assign(summary, pickSummaryDataPackageSlice(dp));
    out.summary = summary;
  }

  if (selected.has("strategistOutput")) {
    out.strategistOutput = dp ? pickDp(dp, DP_KEYS_STRATEGIST as unknown as string[]) : {};
  }

  if (selected.has("decisionContext")) {
    out.decisionContext = {
      regime: row.regime ?? null,
      tickerData: row.tickerData ?? null,
      idioScore: row.idioScore ?? null,
      toxicGate: row.toxicGate ?? null,
      catalystEvaluation: dp?.catalystEvaluation ?? null,
      edgeAttribution: row.edgeAttribution ?? null,
    };
  }

  if (selected.has("volSurface")) {
    out.volSurface = dp ? pickDp(dp, DP_KEYS_VOL as unknown as string[]) : {};
  }

  if (selected.has("optionsChain")) {
    out.optionsChain = dp ? pickDp(dp, DP_KEYS_OPTIONS as unknown as string[]) : {};
  }

  if (selected.has("flow")) {
    out.flow = dp ? pickDp(dp, DP_KEYS_FLOW as unknown as string[]) : {};
  }

  if (selected.has("catalyst")) {
    out.catalyst = dp ? pickDp(dp, DP_KEYS_CATALYST as unknown as string[]) : {};
  }

  if (selected.has("dataQuality")) {
    out.dataQuality = dp ? pickDp(dp, DP_KEYS_DATA_QUALITY as unknown as string[]) : {};
  }

  if (selected.has("diagnostic")) {
    out.diagnostic = row.fullDiagnostic ?? null;
  }

  if (selected.has("rawAiResponse")) {
    out.rawAiResponse = {
      rawAiResponse: row.rawAiResponse ?? null,
      confidenceBase: row.confidenceBase ?? null,
      confidenceCatalystDelta: row.confidenceCatalystDelta ?? null,
      confidenceFinal: row.confidenceFinal ?? null,
    };
  }

  return out;
}
