import type { ConvictionDeskResult, DeskResult } from "./strategistDeskSchemas.js";
import type { CatalystEvaluation } from "./catalystEvaluator.js";
import type { StrategistDiagScratch } from "./strategistRunContext.js";
import { z } from "zod";

/**
 * Loose validation for COPY DIAGNOSTIC `modelInput` (provider SDK snapshot(s)).
 * Single consolidated call → one object; multi-turn desk → array of snapshots.
 */
export const strategistDiagnosticModelInputSchema = z.union([
  z.null(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

/**
 * Full strategist snapshot passed to the diagnostic projector: the JSON data
 * package string (model input) plus desk mode outputs. Mirrors what
 * `buildDataPackage` + desk pipeline produce; kept as a dedicated type for this module.
 */
export type StrategistFullPayload = {
  dataPackageStr: string;
  deskResult: ConvictionDeskResult | DeskResult;
  catalystEvaluation?: CatalystEvaluation | null;
  diag?: StrategistDiagScratch;
};

export type StrategistDiagnosticDecision = "pass" | "recommend" | "fail";

export type StrategistDiagnosticView = {
  ticker: string;
  generatedAt: string;
  spot: number;
  mode: "desk" | "solo_desk" | "conviction_desk";
  decision: StrategistDiagnosticDecision;
  structure: string | null;
  ivr: number | null;
  ivrHistoryDays: number | null;
  ivCleanedRatio: number;
  ivCleanedRatioFullChain: number;
  ivContaminationFlags: string[];
  atmIvByExpiry: { expiration: string; dte: number; atmIv: number | null }[];
  skew25Delta: {
    expiration: string;
    putIv: number;
    callIv: number;
    skewPoints: number;
    reason: string;
  } | null;
  impliedMove: {
    expiry: string;
    movePct: number;
    moveDollar: number;
    available: boolean;
  } | null;
  realizedVol: { hv20: number | null; hv30: number | null; asOf: string | null } | null;
  totalCallVolume: number;
  totalPutVolume: number;
  putCallVolumeRatio: number;
  aggressorMix: { ask: number; bid: number; mid: number; unknown: number };
  keyStrikes: { strike: number; expiry: string; type: string; observation: string }[];
  tapeBackfillStatus: string;
  tapeBackfillReason: string | null;
  anyTruncated: boolean;
  occRequested: number;
  occCompleted: number;
  tapeBackfillDedupeDropsTotal: number;
  wsOccSubscribed: number | null;
  primaryCatalystDate: string | null;
  primaryCatalystType: string | null;
  daysToCatalyst: number | null;
  earningsReactionSummary: Record<string, unknown>;
  catalystGaps: string[];
  marketSession: string;
  marketSessionSource: "schwab" | "calendar_fallback";
  closingImbalancePresent: boolean;
  closingImbalanceLatencyMs: number | null;
  dataQualityFlags: string[];
  thesis: string;
  edgeCheck: string;
  biggestRisk: string;
  watchFor: string;
  size: "small" | "medium" | "large" | "no-trade";
  alignment: string;
  whoseSide: string;
  /**
   * Exact pre-call payload(s) sent to the provider SDK for this strategist run
   * (`anthropic.messages.stream`, OpenAI `responses.create`, etc.). Multiple
   * entries when the desk pipeline performs more than one LLM call.
   */
  modelInput: unknown | null;
};

const MAX_INFO_STRING = 200;

function clampInfoString(s: string): string {
  if (s.length <= MAX_INFO_STRING) return s;
  return `${s.slice(0, MAX_INFO_STRING)}…`;
}

function daysBetweenIsoDates(fromYmd: string, toIsoDate: string | null): number | null {
  if (!toIsoDate) return null;
  const to = toIsoDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = new Date(`${fromYmd}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function deskDecision(
  desk: ConvictionDeskResult | DeskResult,
  pmIncomplete: boolean,
): StrategistDiagnosticDecision {
  if (desk.mode === "conviction_desk") {
    const cd = desk as ConvictionDeskResult;
    if (cd.convictionDeskJsonDegraded === "schema_validation_failed_after_retry" || cd.conviction == null) {
      return "fail";
    }
    const c = cd.conviction;
    if (c.pm.decision === "trade" && c.pm.structure != null) return "recommend";
    return "pass";
  }
  const d = desk as DeskResult;
  if (pmIncomplete || d.soloDeskJsonDegraded === "schema_validation_failed_after_retry") {
    return "fail";
  }
  if (d.pm.decision === "trade") return "recommend";
  return "pass";
}

function structureLabelFromDesk(desk: ConvictionDeskResult | DeskResult): string | null {
  if (desk.mode === "conviction_desk") {
    const pm = desk.conviction?.pm.structure;
    if (!pm) return null;
    return `${pm.type} @ ${pm.expiry}`;
  }
  const pm = (desk as DeskResult).pm.structure;
  if (!pm) return null;
  return `${pm.type} @ ${pm.expiry}`;
}

function parseDataPackage(dataPackageStr: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(dataPackageStr) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function ivContaminationFlagsFromChainFilter(ivf: Record<string, unknown> | null): string[] {
  if (!ivf) return [];
  const reasons = ivf.ivClampedReasons;
  if (!reasons || typeof reasons !== "object" || Array.isArray(reasons)) return [];
  const out: string[] = [];
  for (const [k, c] of Object.entries(reasons as Record<string, unknown>)) {
    const n = typeof c === "number" && Number.isFinite(c) ? c : 0;
    if (n > 0) out.push(k);
  }
  return out.sort();
}

/**
 * Projects a compact, shareable view from the full strategist desk payload.
 * Pure function: does not read process env or mutate inputs.
 */
export function buildStrategistDiagnosticView(fullPayload: StrategistFullPayload): StrategistDiagnosticView {
  const { dataPackageStr, deskResult, catalystEvaluation, diag } = fullPayload;
  const pkg = parseDataPackage(dataPackageStr);

  const pmIncomplete = deskResult.mode !== "conviction_desk" && deskResult.pmOutputIncomplete === true;
  const decision = deskDecision(deskResult, pmIncomplete);

  const currentDate = str(pkg?.currentDate) ?? new Date().toISOString().slice(0, 10);
  const generatedAt = new Date().toISOString();

  const price = num(pkg?.price) ?? 0;

  const ocs = pkg?.optionsChainSummary;
  const ocsObj = ocs && typeof ocs === "object" && !Array.isArray(ocs) ? (ocs as Record<string, unknown>) : null;
  const ivf = ocsObj?.ivChainFilter;
  const ivfObj = ivf && typeof ivf === "object" && !Array.isArray(ivf) ? (ivf as Record<string, unknown>) : null;

  const ivCleanedRatio = num(ivfObj?.ivCleanedRatio) ?? 0;
  const ivCleanedRatioFullChain = num(ivfObj?.ivCleanedRatioFullChain) ?? 0;
  const ivContaminationFlags = ivContaminationFlagsFromChainFilter(ivfObj);

  const termRaw = ocsObj?.termStructure5pt;
  const atmIvByExpiry: StrategistDiagnosticView["atmIvByExpiry"] = [];
  if (Array.isArray(termRaw)) {
    for (const row of termRaw) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const expiration = str(r.expiry) ?? str(r.expiration) ?? "";
      const dte = num(r.daysToExpiry) ?? num(r.dte) ?? 0;
      const atmIv = num(r.atmIV) ?? num(r.atmIv);
      if (expiration) atmIvByExpiry.push({ expiration, dte, atmIv });
    }
  }

  const skew = ocsObj?.skew25Delta;
  let skew25Delta: StrategistDiagnosticView["skew25Delta"] = null;
  if (skew && typeof skew === "object" && !Array.isArray(skew)) {
    const s = skew as Record<string, unknown>;
    const putIv = num(s.putIV) ?? num(s.putIv);
    const callIv = num(s.callIV) ?? num(s.callIv);
    const skewPoints = num(s.skewPoints);
    const expiration = str(s.asOfExpiry) ?? str(s.expiration) ?? "";
    const reason = str(ocsObj?.skew25DeltaReason) ?? "";
    if (putIv != null && callIv != null && skewPoints != null && expiration) {
      skew25Delta = { expiration, putIv, callIv, skewPoints, reason };
    }
  }

  const im = ocsObj?.impliedMove;
  let impliedMove: StrategistDiagnosticView["impliedMove"] = null;
  if (im && typeof im === "object" && !Array.isArray(im)) {
    const m = im as Record<string, unknown>;
    const expiry = str(m.expiry) ?? str(m.expiration) ?? "";
    const movePct = num(m.percentOfSpot) ?? num(m.movePct) ?? 0;
    const moveDollar = num(m.dollar) ?? num(m.moveDollar) ?? 0;
    const imq = ocsObj?.impliedMoveQuality;
    const available =
      imq && typeof imq === "object" && !Array.isArray(imq) ? bool((imq as Record<string, unknown>).available) : false;
    if (expiry) impliedMove = { expiry, movePct, moveDollar, available };
  }

  const rvRaw = pkg?.realizedVol;
  let realizedVol: StrategistDiagnosticView["realizedVol"] = null;
  if (rvRaw && typeof rvRaw === "object" && !Array.isArray(rvRaw)) {
    const rv = rvRaw as Record<string, unknown>;
    const asOf = str(rv.asOfDate) ?? str(rv.asOf) ?? null;
    realizedVol = {
      hv20: num(rv.hv20),
      hv30: num(rv.hv30),
      asOf,
    };
  }

  const flow = pkg?.polygonFlowHighlights;
  const flowObj = flow && typeof flow === "object" && !Array.isArray(flow) ? (flow as Record<string, unknown>) : null;
  const totalCallVolume = num(flowObj?.totalCallVolume) ?? 0;
  const totalPutVolume = num(flowObj?.totalPutVolume) ?? 0;
  const putCallVolumeRatio = num(flowObj?.putCallVolumeRatio) ?? 0;

  const tape = flowObj?.sessionTape;
  const tapeObj = tape && typeof tape === "object" && !Array.isArray(tape) ? (tape as Record<string, unknown>) : null;
  const agg = tapeObj?.aggressorSessionTotals;
  const aggObj = agg && typeof agg === "object" && !Array.isArray(agg) ? (agg as Record<string, unknown>) : null;
  const totalPrints = num(aggObj?.totalPrints) ?? 0;
  const askCount = num(aggObj?.askCount) ?? 0;
  const bidCount = num(aggObj?.bidCount) ?? 0;
  const midCount = num(aggObj?.midCount) ?? 0;
  const unknownCount = num(aggObj?.unknownCount) ?? 0;
  const denom = totalPrints > 0 ? totalPrints : 1;
  const aggressorMix = {
    ask: askCount / denom,
    bid: bidCount / denom,
    mid: midCount / denom,
    unknown: unknownCount / denom,
  };

  const ks =
    deskResult.mode === "conviction_desk"
      ? []
      : deskResult.flow.key_strikes?.slice(0, 6) ?? [];
  const keyStrikes = ks.map((k) => ({
    strike: k.strike,
    expiry: k.expiry,
    type: clampInfoString(k.type),
    observation: clampInfoString(k.observation),
  }));

  const dqs = pkg?.dataQualitySummary;
  const dqsObj = dqs && typeof dqs === "object" && !Array.isArray(dqs) ? (dqs as Record<string, unknown>) : null;
  const flowSummary = dqsObj?.flow;
  const flowSummaryObj =
    flowSummary && typeof flowSummary === "object" && !Array.isArray(flowSummary)
      ? (flowSummary as Record<string, unknown>)
      : null;

  const tapeBackfill = pkg?.tapeBackfill;
  const tbObj =
    tapeBackfill && typeof tapeBackfill === "object" && !Array.isArray(tapeBackfill)
      ? (tapeBackfill as Record<string, unknown>)
      : null;

  const tapeBackfillStatus = str(flowSummaryObj?.tapeBackfillStatus) ?? str(tbObj?.status) ?? "not_run";
  const tapeBackfillReason =
    str(flowSummaryObj?.tapeBackfillReason) ?? str(tbObj?.tapeBackfillReason) ?? str(tbObj?.reason) ?? null;
  const anyTruncated = bool(flowSummaryObj?.tapeBackfillTruncated) || bool(tbObj?.anyTruncated);
  const occRequested = num(flowSummaryObj?.tapeBackfillOccRequested) ?? num(tbObj?.occRequested) ?? 0;
  const occCompleted = num(flowSummaryObj?.tapeBackfillOccCompleted) ?? num(tbObj?.occCompleted) ?? 0;
  const dedupe = tbObj?.tapeBackfillDedupeDrops;
  const dedupeObj = dedupe && typeof dedupe === "object" && !Array.isArray(dedupe) ? (dedupe as Record<string, unknown>) : null;
  const tapeBackfillDedupeDropsTotal = num(dedupeObj?.totalDropped) ?? 0;
  const wsOccFromFlow = num(flowSummaryObj?.tapeBackfillWsOccSubscribed);
  const wsOccFromTb = num(tbObj?.wsOccSubscribed);
  const wsOccSubscribed = wsOccFromFlow ?? wsOccFromTb ?? null;

  const marketSession = str(dqsObj?.marketSession) ?? "UNKNOWN";
  const mss = str(dqsObj?.marketSessionSource);
  const marketSessionSource: "schwab" | "calendar_fallback" =
    mss === "schwab" || mss === "calendar_fallback" ? mss : "calendar_fallback";

  const flagsRaw = dqsObj?.flags;
  const dataQualityFlags = strArr(flagsRaw);

  const catalystGapsFromDqs = strArr(dqsObj?.data_source_gaps);

  const catPkg = pkg?.catalyst;
  const catObj = catPkg && typeof catPkg === "object" && !Array.isArray(catPkg) ? (catPkg as Record<string, unknown>) : null;
  const ers = catObj?.earnings_reaction_summary;
  const earningsReactionSummary: Record<string, unknown> =
    ers && typeof ers === "object" && !Array.isArray(ers) ? { ...(ers as Record<string, unknown>) } : {};

  let primaryCatalystDate: string | null = null;
  let primaryCatalystType: string | null = null;
  let alignment = "UNKNOWN";

  if (catalystEvaluation) {
    primaryCatalystDate = catalystEvaluation.catalystDate;
    primaryCatalystType = catalystEvaluation.catalystType;
    alignment = catalystEvaluation.catalystAlignment;
  } else {
    const ne = pkg?.nextEarnings;
    const neObj = ne && typeof ne === "object" && !Array.isArray(ne) ? (ne as Record<string, unknown>) : null;
    const ned = str(neObj?.earningsDate) ?? str(neObj?.date);
    if (ned) {
      primaryCatalystDate = ned.slice(0, 10);
      primaryCatalystType = "EARNINGS";
    }
  }

  const daysToCatalyst = daysBetweenIsoDates(currentDate, primaryCatalystDate);

  const ivr = num(pkg?.ivr);
  const ivrCtx = pkg?.ivrContext;
  const ivrCtxObj = ivrCtx && typeof ivrCtx === "object" && !Array.isArray(ivrCtx) ? (ivrCtx as Record<string, unknown>) : null;
  const ivrHistoryDays = num(ivrCtxObj?.daysOfHistory);

  const closingImbalancePresent = diag?.closingImbalancePresent === true;
  const closingImbalanceLatencyMs =
    diag?.closingImbalanceLatencyMs === undefined ? null : num(diag.closingImbalanceLatencyMs as unknown);

  const modelInputs = diag?.modelSdkInputs;
  const modelInput: StrategistDiagnosticView["modelInput"] =
    modelInputs == null || modelInputs.length === 0
      ? null
      : modelInputs.length === 1
        ? modelInputs[0]
        : modelInputs;

  let thesis = "";
  let edgeCheck = "";
  let biggestRisk = "";
  let watchFor = "";
  let sizeDiag: StrategistDiagnosticView["size"] = "small";
  let whoseSide = "neither";

  if (deskResult.mode === "conviction_desk") {
    const pm = (deskResult as ConvictionDeskResult).conviction?.pm;
    if (pm) {
      const edgeRaw = pm.edge_check ?? "";
      thesis = typeof pm.thesis === "string" ? pm.thesis : "";
      edgeCheck = typeof edgeRaw === "string" ? edgeRaw : "";
      biggestRisk = typeof pm.biggest_risk === "string" ? pm.biggest_risk : "";
      watchFor = typeof pm.watch_for === "string" ? pm.watch_for : "";
      sizeDiag = pm.size;
      whoseSide = pm.whose_side;
    } else {
      thesis = "";
      edgeCheck = "";
      biggestRisk = "";
      watchFor = "";
      sizeDiag = "small";
      whoseSide = "neither";
    }
  } else {
    const pm = deskResult.pm;
    const edgeRaw = pm.edge_check ?? "";
    thesis = typeof pm.thesis === "string" ? pm.thesis : "";
    edgeCheck = typeof edgeRaw === "string" ? edgeRaw : "";
    biggestRisk = typeof pm.biggest_risk === "string" ? pm.biggest_risk : "";
    watchFor = typeof pm.watch_for === "string" ? pm.watch_for : "";
    sizeDiag = pm.size;
    whoseSide = pm.whose_side;
  }

  return {
    ticker: deskResult.ticker,
    generatedAt,
    spot: price,
    mode: deskResult.mode,
    decision,
    structure: decision === "recommend" ? structureLabelFromDesk(deskResult) : null,
    ivr,
    ivrHistoryDays,
    ivCleanedRatio,
    ivCleanedRatioFullChain,
    ivContaminationFlags,
    atmIvByExpiry,
    skew25Delta,
    impliedMove,
    realizedVol,
    totalCallVolume,
    totalPutVolume,
    putCallVolumeRatio,
    aggressorMix,
    keyStrikes,
    tapeBackfillStatus,
    tapeBackfillReason,
    anyTruncated,
    occRequested,
    occCompleted,
    tapeBackfillDedupeDropsTotal,
    wsOccSubscribed,
    primaryCatalystDate,
    primaryCatalystType,
    daysToCatalyst,
    earningsReactionSummary,
    catalystGaps: catalystGapsFromDqs,
    marketSession,
    marketSessionSource,
    closingImbalancePresent,
    closingImbalanceLatencyMs,
    dataQualityFlags,
    thesis,
    edgeCheck,
    biggestRisk,
    watchFor,
    size: sizeDiag,
    alignment,
    whoseSide,
    modelInput,
  };
}
