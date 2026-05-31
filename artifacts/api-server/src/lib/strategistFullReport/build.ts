import {
  fetchNormalizedPriceTargets,
  type NormalizedPriceTargetSnapshot,
} from "../strategistPriceTargetService.js";
import { computeTapeSignals, streetTapeAlignment } from "../strategistTapeSignals.js";
import type { CandidateLeg } from "../strategistV2.js";
import type { IOScoreResult } from "../ioScoreEngine.js";
import type { ReportProse, ReportTone, StatChip, StrategistFullReport } from "./types.js";
import { sanitizeFullReportForDisplay } from "./sanitizeReport.js";
import { cleanReportProse } from "./validateProse.js";
import {
  NA,
  buildBearCaseProse,
  fmtMaxLossLabel,
  fmtMaxProfitLabel,
  fmtPct,
  fmtUsd,
  formatReportDate,
} from "./reportFormat.js";

function chip(label: string, value: string, tone: ReportTone = "white"): StatChip {
  return { label, value: value || NA, tone };
}

function tierFromScore(score: number): ReportTone {
  if (score >= 70) return "green";
  if (score >= 65) return "yellow";
  return "red";
}

function defaultConfidenceRead(score: number, tier: ReportTone): string {
  if (tier === "red") {
    return "Composite confidence sits below our actionable band. Size accordingly and treat the setup as speculative until tape and catalyst line up.";
  }
  if (tier === "yellow") {
    return "Confidence is mid-tier: the structure is tradable but not high conviction. Keep risk defined and respect the exit plan.";
  }
  return "Confidence is in the upper band for this desk. The edge still depends on disciplined entry inside the fill window and honoring the stop.";
}

function ioRegressionAvailable(ioScore: IOScoreResult): boolean {
  return ioScore.available && ioScore.dataAvailability.source === "real";
}

function fmtIoBeta(ioScore: IOScoreResult): string {
  if (!ioRegressionAvailable(ioScore)) return NA;
  return ioScore.beta.toFixed(2);
}

function fmtIoRSquared(ioScore: IOScoreResult): string {
  if (!ioRegressionAvailable(ioScore)) return NA;
  const r2 = ioScore.components?.marketIndependence?.rSquared;
  return r2 != null && Number.isFinite(r2) ? r2.toFixed(2) : NA;
}

function fmtIoResidualZ(ioScore: IOScoreResult): string {
  if (!ioRegressionAvailable(ioScore)) return NA;
  return ioScore.residualReturnZScore.toFixed(2);
}

function formatEarningsChip(
  nextEarnings: string | null,
  lastEarnings: string | null,
  earningsDaysAway: number | null,
): string {
  if (nextEarnings?.trim()) {
    const d = formatReportDate(nextEarnings);
    if (earningsDaysAway != null && Number.isFinite(earningsDaysAway)) {
      return `Next ${d} (${earningsDaysAway}d)`;
    }
    return `Next ${d}`;
  }
  if (lastEarnings?.trim()) {
    return `Last ${formatReportDate(lastEarnings)}`;
  }
  return NA;
}

function shortLegDeltaChip(legs: CandidateLeg[]): StatChip {
  const shortLeg = legs.find((l) => l.side === "sell");
  if (!shortLeg) return chip("Short Δ", NA);
  const d = shortLeg.delta;
  if (d != null && Number.isFinite(d) && Math.abs(d) > 0.0005) {
    return chip("Short Δ", d.toFixed(2), "amber");
  }
  return chip("Short strike", `$${shortLeg.strike}`, "amber");
}

export function buildStructureDescriptorFromLegs(
  strategyType: string,
  legs: CandidateLeg[],
  dte: number,
): string {
  const strikes = legs.map((l) => l.strike).sort((a, b) => a - b);
  const width = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : null;
  const exps = [...new Set(legs.map((l) => l.expiration.split(":")[0].trim()))];
  if (legs.length === 1) return `single · ${dte} DTE`;
  if (exps.length > 1) {
    const dtes = exps.map((e) => {
      const d = new Date(e + "T12:00:00");
      return Math.max(0, Math.round((d.getTime() - Date.now()) / 86400000));
    });
    if (strategyType.includes("calendar") && width === 0) return `same strike · ${dtes.join("/")} DTE`;
    return `${dtes.join("/")} DTE`;
  }
  if (strategyType.includes("iron")) return `$${width ?? 5} wide · ${dte} DTE`;
  if (width != null && width > 0) return `$${width} wide · ${dte} DTE`;
  return `${dte} DTE`;
}

export type BuildFullReportArgs = {
  ticker: string;
  generatedAt: Date;
  signalPrice: number;
  dailyChangePct?: number;
  confidence: number;
  isCredit: boolean;
  netEntry: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  riskRewardDisplay: string;
  strategyName: string;
  structureDescriptor: string;
  direction: string;
  legs: CandidateLeg[];
  dte: number;
  ivr: number | null;
  iv30?: number | null;
  hv30?: number | null;
  /** Schwab chain volume P/C */
  putCallVolumeRatio: number | null;
  /** Polygon unusual-flow session P/C when available */
  polygonPutCallRatio?: number | null;
  ioScore: IOScoreResult;
  idioPct: number;
  macroPct: number;
  sector: string;
  catalystInWindow: boolean;
  nextEarningsDate: string | null;
  lastEarningsDate?: string | null;
  earningsDaysAway?: number | null;
  enrichedExit: {
    profitTarget?: number;
    profitTargetPct?: number;
    stopLoss?: number;
    stopLossPct?: number;
    timeStop?: string;
  };
  prose?: Partial<ReportProse>;
  companyContext?: string;
  thesis?: string;
  bullInvalidation?: string;
  bearInvalidation?: string;
  riskOfRuin?: string;
};

export async function buildStrategistFullReport(args: BuildFullReportArgs): Promise<StrategistFullReport> {
  const {
    ticker,
    generatedAt,
    signalPrice,
    confidence,
    isCredit,
    netEntry,
    maxProfit,
    maxLoss,
    breakeven,
    riskRewardDisplay,
    strategyName,
    structureDescriptor,
    direction,
    legs,
    dte,
    ivr,
    putCallVolumeRatio,
    polygonPutCallRatio,
    ioScore,
    idioPct,
    macroPct,
    sector,
    catalystInWindow,
    nextEarningsDate,
    lastEarningsDate,
    earningsDaysAway,
    enrichedExit,
    prose: proseIn,
    thesis,
    bullInvalidation,
    bearInvalidation,
    riskOfRuin,
  } = args;

  const flowPc =
    polygonPutCallRatio != null && Number.isFinite(polygonPutCallRatio)
      ? polygonPutCallRatio
      : putCallVolumeRatio;
  const flowPcSource =
    polygonPutCallRatio != null && Number.isFinite(polygonPutCallRatio)
      ? "Polygon unusual flow"
      : "Chain volume";

  const tier = tierFromScore(confidence);
  const pt = await fetchNormalizedPriceTargets(ticker, signalPrice);
  const tape = computeTapeSignals({
    signalPrice,
    dailyChangePct: args.dailyChangePct ?? 0,
    putCallVolumeRatio: flowPc,
    residualZ: ioRegressionAvailable(ioScore) ? ioScore.residualReturnZScore : null,
    shortStrike: legs.find((l) => l.side === "sell")?.strike ?? null,
  });
  const alignment = pt.available
    ? streetTapeAlignment(pt.revisionTrend, tape.tapeVerdict)
    : "aligned";

  const thesisClean = thesis?.trim() ? cleanReportProse(thesis) : "";
  const whyStructureDefault = thesisClean || `${strategyName} expresses the edge with defined risk.`;

  const streetDefault = pt.available
    ? alignment === "divergent"
      ? `Sell-side revision tone (${pt.revisionTrend}) and ${flowPcSource} tape (${tape.tapeVerdict}, P/C ${flowPc ?? "n/a"}) disagree — size as a structure/vol bet, not consensus plus flow confirmation.`
      : `Street revision trend (${pt.revisionTrend}) and ${flowPcSource} tape (${tape.tapeVerdict}, P/C ${flowPc ?? "n/a"}) align with the trade direction.`
    : gradesOrCoverageNote(pt, thesisClean);

  const prose: ReportProse = {
    confidenceRead: cleanReportProse(
      proseIn?.confidenceRead?.trim() || defaultConfidenceRead(confidence, tier),
    ),
    whyInPlay: cleanReportProse(
      proseIn?.whyInPlay?.trim() ||
        `IV rank ${ivr != null ? Math.round(ivr) : "n/a"}, ${flowPcSource} P/C ${flowPc ?? "n/a"}, and catalyst window ${catalystInWindow ? "active" : "clear"} frame why ${ticker} is in play for this structure.`,
    ),
    thesisWithNumbers: cleanReportProse(proseIn?.thesisWithNumbers?.trim() || thesisClean || NA),
    streetVsTapeProse: cleanReportProse(proseIn?.streetVsTapeProse?.trim() || streetDefault),
    idioMacroNote: cleanReportProse(
      proseIn?.idioMacroNote?.trim() ||
        `Idio ${idioPct}% vs macro ${macroPct}% attribution — favor the larger sleeve when sizing narrative risk.${ioRegressionAvailable(ioScore) ? ` Beta ${ioScore.beta.toFixed(2)}, residual Z ${ioScore.residualReturnZScore.toFixed(2)}.` : ""}`,
    ),
    sectorExposureNote: cleanReportProse(
      proseIn?.sectorExposureNote?.trim() ||
        (sector
          ? `${ticker} trades with ${sector} beta — peer and macro moves can dominate a single-name options structure.`
          : `Sector peer map is thin; macro and index correlation still matter for ${ticker}.`),
    ),
    whyStructure: cleanReportProse(proseIn?.whyStructure?.trim() || whyStructureDefault),
    bearCase: cleanReportProse(
      buildBearCaseProse({
        direction,
        riskOfRuin,
        bullInvalidation,
        bearInvalidation,
        reportBearCase: proseIn?.bearCase,
      }),
    ),
    riskManagementProse: cleanReportProse(
      proseIn?.riskManagementProse?.trim() ||
        `Target ${enrichedExit.profitTargetPct ?? 62}% of max profit at $${enrichedExit.profitTarget?.toFixed(2) ?? "n/a"} buyback; stop ${enrichedExit.stopLossPct ?? 30}% of max loss at $${enrichedExit.stopLoss?.toFixed(2) ?? "n/a"}; time stop ${formatReportDate(enrichedExit.timeStop)}.`,
    ),
  };

  const profitTgtChip =
    enrichedExit.profitTargetPct != null && enrichedExit.profitTarget != null
      ? `${enrichedExit.profitTargetPct}% @ $${enrichedExit.profitTarget.toFixed(2)}`
      : fmtPct(enrichedExit.profitTargetPct);

  const genIso = generatedAt.toISOString();

  const report: StrategistFullReport = {
    provenance: {
      generatedAt: genIso,
      signalPrice,
      freshness: [
        { source: "Options chain", asOf: genIso.slice(0, 10) },
        { source: "IOScore", asOf: genIso.slice(0, 10) },
        { source: "Analyst PT", asOf: pt.asOfDate },
      ],
      confidence,
      confidenceTier: tier,
      confidenceRead: prose.confidenceRead,
    },
    tradeRecap: {
      chips: [
        chip("Strategy", strategyName),
        chip("Structure", structureDescriptor),
        chip("Direction", direction, direction === "BULLISH" ? "green" : direction === "BEARISH" ? "red" : "amber"),
        chip(isCredit ? "Net credit" : "Net debit", fmtUsd(netEntry), isCredit ? "green" : "red"),
        chip("Max loss", fmtMaxLossLabel(maxLoss), "red"),
        chip("Max profit", fmtMaxProfitLabel(maxProfit), "green"),
        chip("R:R", riskRewardDisplay.toUpperCase()),
        chip("DTE", String(dte)),
      ],
    },
    whyInPlay: {
      chips: [
        chip("IV Rank", ivr != null ? String(Math.round(ivr)) : NA),
        chip(flowPcSource, flowPc != null ? String(flowPc) : NA),
        chip("Catalyst in window", catalystInWindow ? "yes" : "no", catalystInWindow ? "amber" : "white"),
      ],
      body: prose.whyInPlay,
    },
    thesisWithNumbers: {
      chips: [
        chip("IV Rank", ivr != null ? String(Math.round(ivr)) : NA),
        shortLegDeltaChip(legs),
        chip("Earnings", formatEarningsChip(nextEarningsDate, lastEarningsDate ?? null, earningsDaysAway ?? null), "amber"),
      ],
      body: prose.thesisWithNumbers,
    },
    streetVsTape: {
      sellSide: {
        available: pt.available,
        chips: pt.available
          ? [
              chip("Consensus PT", fmtUsd(pt.consensusPT)),
              chip("vs signal", fmtPct(pt.ptVsSignalPct), (pt.ptVsSignalPct ?? 0) >= 0 ? "green" : "red"),
              chip("Analysts", pt.analystCount != null ? String(pt.analystCount) : NA),
              chip("Revisions", `${pt.revisions.raises}↑ ${pt.revisions.cuts}↓`),
              chip("Trend", pt.revisionTrend),
            ]
          : [chip("Coverage", "no sell-side row in feed", "amber")],
        recent: pt.recent,
      },
      buySide: {
        chips: [
          chip("Tape", tape.tapeVerdict, tape.tapeVerdict === "accumulation" ? "green" : tape.tapeVerdict === "distribution" ? "red" : "white"),
          chip("Flow bias", tape.flowBias),
          chip("P/C", tape.pcRatio != null ? String(tape.pcRatio) : NA),
          chip("Residual Z", ioRegressionAvailable(ioScore) && tape.residualZ != null ? tape.residualZ.toFixed(2) : NA),
        ],
      },
      tapeVerdict: tape.tapeVerdict,
      streetTapeAlignment: alignment,
      body: prose.streetVsTapeProse,
    },
    idioMacro: {
      chips: [
        chip("Idio", fmtPct(idioPct), "green"),
        chip("Macro", fmtPct(macroPct), "amber"),
        chip("Beta", fmtIoBeta(ioScore)),
        chip("R²", fmtIoRSquared(ioScore)),
        chip("Resid Z", fmtIoResidualZ(ioScore)),
      ],
      body: prose.idioMacroNote,
    },
    sectorExposure: {
      peers: sector ? [sector] : [],
      drivers: ["Rates", "Sector beta", "Peer earnings"],
      body: prose.sectorExposureNote,
    },
    whyStructure: { body: prose.whyStructure },
    bearCase: { body: prose.bearCase },
    riskManagement: {
      chips: [
        chip("Max loss", fmtMaxLossLabel(maxLoss), "red"),
        chip("Breakeven", fmtUsd(breakeven)),
        chip("Profit tgt", profitTgtChip),
        chip("Stop", fmtPct(enrichedExit.stopLossPct), "red"),
        chip("Time", formatReportDate(enrichedExit.timeStop), "amber"),
      ],
      body: prose.riskManagementProse,
    },
    dataAssumptions: {
      sources: [
        "Schwab options chain",
        flowPcSource,
        "FMP analyst PT & grades (DB + live fallback)",
        "IOScore engine",
        "IVR store",
      ],
      modeledFields: ["Entry stock band", "Exit buyback prices", "Calendar max profit est."],
    },
  };

  return sanitizeFullReportForDisplay(report);
}

function gradesOrCoverageNote(pt: NormalizedPriceTargetSnapshot, thesis: string): string {
  if (pt.recent.length > 0) {
    return `No consensus PT row in our feed, but recent grade actions are listed below. Reconcile any sell-side names in the thesis against this feed.`;
  }
  if (/\b(upgrade|downgrade|price target|PT \$|analyst)\b/i.test(thesis)) {
    return "Thesis cites sell-side action but our FMP analyst feed has no PT row for this ticker — treat street numbers in the thesis as search-sourced until the feed is populated.";
  }
  return "No sell-side coverage in our feed. Tape still renders from chain and Polygon flow when present.";
}
