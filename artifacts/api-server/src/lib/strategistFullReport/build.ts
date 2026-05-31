import { fetchNormalizedPriceTargets } from "../strategistPriceTargetService.js";
import { computeTapeSignals, streetTapeAlignment } from "../strategistTapeSignals.js";
import type { CandidateLeg } from "../strategistV2.js";
import type { IOScoreResult } from "../ioScoreEngine.js";
import type { ReportProse, ReportTone, StatChip, StrategistFullReport } from "./types.js";
import { sanitizeFullReportForDisplay } from "./sanitizeReport.js";
import { stripDigitsFromProse } from "./validateProse.js";

const NA = "not available";

function chip(label: string, value: string, tone: ReportTone = "white"): StatChip {
  return { label, value: value || NA, tone };
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NA;
  return `${n}%`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NA;
  return `$${n.toFixed(2)}`;
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
  putCallVolumeRatio: number | null;
  ioScore: IOScoreResult;
  idioPct: number;
  macroPct: number;
  sector: string;
  catalystInWindow: boolean;
  nextEarningsDate: string | null;
  enrichedExit: {
    profitTargetPct?: number;
    stopLossPct?: number;
    timeStop?: string;
  };
  prose?: Partial<ReportProse>;
  companyContext?: string;
  thesis?: string;
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
    ioScore,
    idioPct,
    macroPct,
    sector,
    catalystInWindow,
    nextEarningsDate,
    enrichedExit,
    prose: proseIn,
    thesis,
    bearInvalidation,
    riskOfRuin,
  } = args;

  const tier = tierFromScore(confidence);
  const pt = await fetchNormalizedPriceTargets(ticker, signalPrice);
  const shortStrike = legs.find((l) => l.side === "sell")?.strike ?? null;
  const tape = computeTapeSignals({
    signalPrice,
    dailyChangePct: args.dailyChangePct ?? 0,
    putCallVolumeRatio,
    residualZ: ioScore.residualReturnZScore,
    shortStrike,
  });
  const alignment = pt.available
    ? streetTapeAlignment(pt.revisionTrend, tape.tapeVerdict)
    : "aligned";

  const prose: ReportProse = {
    confidenceRead:
      proseIn?.confidenceRead?.trim() || defaultConfidenceRead(confidence, tier),
    whyInPlay:
      proseIn?.whyInPlay?.trim() ||
      stripDigitsFromProse(
        `Vol regime and flow context support expressing a view on ${ticker}. Support and recent tape behavior matter for entry timing.`,
      ),
    thesisWithNumbers:
      proseIn?.thesisWithNumbers?.trim() ||
      stripDigitsFromProse(thesis || "Thesis follows the ranked structure and catalyst window described in the fact sheet."),
    streetVsTapeProse:
      proseIn?.streetVsTapeProse?.trim() ||
      stripDigitsFromProse(
        pt.available
          ? alignment === "divergent"
            ? "Sell-side revision tone and tape-derived flow disagree. If you take the trade, you are leaning on structure and vol, not consensus or flow confirmation."
            : "Street revision tone and tape classification point the same way. The trade is not fighting the dominant read from targets and flow."
          : "No sell-side coverage in our feed. The tape block still renders from computed signals.",
      ),
    idioMacroNote:
      proseIn?.idioMacroNote?.trim() ||
      stripDigitsFromProse(
        "Idiosyncratic versus macro split and regression diagnostics are in the chips. Favor the side with higher contribution when sizing narrative risk.",
      ),
    sectorExposureNote:
      proseIn?.sectorExposureNote?.trim() ||
      stripDigitsFromProse(
        `Sector read is ${sector || "general market"}. Peer moves can swamp a single-name options structure even when direction is right.`,
      ),
    whyStructure:
      proseIn?.whyStructure?.trim() ||
      stripDigitsFromProse(
        `${strategyName} was selected to express the edge with defined risk relative to alternatives evaluated by the engine.`,
      ),
    bearCase:
      proseIn?.bearCase?.trim() ||
      stripDigitsFromProse(
        [bearInvalidation, riskOfRuin, "Risk-reward can look acceptable on paper while expectancy is thin if confidence is low or vol re-expands."]
          .filter(Boolean)
          .join(" "),
      ),
    riskManagementProse:
      proseIn?.riskManagementProse?.trim() ||
      stripDigitsFromProse(
        "Honor the profit and stop percentages relative to max payout. Reduce size when confidence is mid or low and avoid holding through unmodeled catalysts.",
      ),
  };

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
        chip("Max loss", fmtUsd(maxLoss / 100), "red"),
        chip("Max profit", maxProfit >= 99999 ? "Unlimited" : fmtUsd(maxProfit / 100), "green"),
        chip("R:R", riskRewardDisplay.toUpperCase()),
        chip("DTE", String(dte)),
      ],
    },
    whyInPlay: {
      chips: [
        chip("IV Rank", ivr != null ? String(Math.round(ivr)) : NA),
        chip("P/C vol", putCallVolumeRatio != null ? String(putCallVolumeRatio) : NA),
        chip("Catalyst in window", catalystInWindow ? "yes" : "no", catalystInWindow ? "amber" : "white"),
      ],
      body: prose.whyInPlay,
    },
    thesisWithNumbers: {
      chips: [
        chip("IV Rank", ivr != null ? String(Math.round(ivr)) : NA),
        chip("Short delta", shortStrike != null ? `strike $${shortStrike}` : NA),
        chip("Earnings", nextEarningsDate ?? NA, "amber"),
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
              chip("Revisions", `${pt.revisions.raises}↑ ${pt.revisions.cuts}↓`),
              chip("Trend", pt.revisionTrend),
            ]
          : [chip("Coverage", "no sell-side coverage", "amber")],
        recent: pt.recent,
      },
      buySide: {
        chips: [
          chip("Tape", tape.tapeVerdict, tape.tapeVerdict === "accumulation" ? "green" : tape.tapeVerdict === "distribution" ? "red" : "white"),
          chip("Flow bias", tape.flowBias),
          chip("P/C", tape.pcRatio != null ? String(tape.pcRatio) : NA),
          chip("Residual Z", tape.residualZ != null ? tape.residualZ.toFixed(2) : NA),
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
        chip("Beta", ioScore.beta != null ? ioScore.beta.toFixed(2) : NA),
        chip("R²", ioScore.components?.marketIndependence?.rSquared != null
          ? ioScore.components.marketIndependence.rSquared.toFixed(2)
          : NA),
        chip("Resid Z", ioScore.residualReturnZScore != null ? ioScore.residualReturnZScore.toFixed(2) : NA),
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
        chip("Max loss", fmtUsd(maxLoss / 100), "red"),
        chip("Breakeven", fmtUsd(breakeven)),
        chip("Profit tgt", fmtPct(enrichedExit.profitTargetPct)),
        chip("Stop", fmtPct(enrichedExit.stopLossPct), "red"),
        chip("Time", enrichedExit.timeStop || NA, "amber"),
      ],
      body: prose.riskManagementProse,
    },
    dataAssumptions: {
      sources: ["Schwab options chain", "FMP analyst PT & grades (DB)", "IOScore engine", "IVR store"],
      modeledFields: ["Entry stock band", "Exit buyback prices", "Calendar max profit est."],
    },
  };

  return sanitizeFullReportForDisplay(report);
}
