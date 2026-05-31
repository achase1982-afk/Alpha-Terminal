import type { NormalizedPriceTargetSnapshot } from "../strategistPriceTargetService.js";
import type { TapeSignalSnapshot } from "../strategistTapeSignals.js";
import type { IOScoreResult } from "../ioScoreEngine.js";
import type { ReportProse } from "./types.js";
import { NA, formatReportDate, fmtPct, fmtUsd } from "./reportFormat.js";

export type ChipNarrativeInput = {
  ticker: string;
  ivr: number | null;
  atmIvPct: number | null;
  flowPc: number | null;
  flowPcSource: string;
  catalystInWindow: boolean;
  pt: NormalizedPriceTargetSnapshot;
  tape: TapeSignalSnapshot;
  alignment: "aligned" | "divergent";
  ioScore: IOScoreResult;
  ioRegressionAvailable: boolean;
  idioPct: number | null;
  macroPct: number | null;
  sector: string;
  sectorPeers: string[];
  strategyName: string;
  direction: string;
  nextEarningsDate: string | null;
  lastEarningsDate: string | null;
  earningsDaysAway: number | null;
  enrichedExit: {
    profitTarget?: number;
    profitTargetPct?: number;
    stopLoss?: number;
    stopLossPct?: number;
    timeStop?: string;
  };
  thesisFallback: string;
};

export function formatAtmIvPct(iv: number | null | undefined): string {
  if (iv == null || !Number.isFinite(iv)) return NA;
  const pct = iv > 3 ? iv : iv * 100;
  return `${pct.toFixed(1)}%`;
}

export function formatEarningsChipValue(
  nextEarnings: string | null,
  lastEarnings: string | null,
  earningsDaysAway: number | null,
  asOf: Date = new Date(),
): string {
  const today = asOf.toISOString().slice(0, 10);
  let next = nextEarnings?.trim() || null;
  let last = lastEarnings?.trim() || null;
  if (next && next < today) {
    if (!last || last < next) last = next;
    next = null;
  }
  const parts: string[] = [];
  if (last) parts.push(`Last ${formatReportDate(last)}`);
  if (next) {
    const d = formatReportDate(next);
    if (earningsDaysAway != null && Number.isFinite(earningsDaysAway)) {
      parts.push(`Next ${d}, ${earningsDaysAway}d`);
    } else {
      parts.push(`Next ${d}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : NA;
}

function revisionTrendLabel(trend: string): string {
  if (trend === "rising") return "net upgrades and raises";
  if (trend === "falling") return "net downgrades and cuts";
  return "mixed revisions";
}

function idioMacroDominance(idioPct: number, macroPct: number): string {
  const diff = Math.abs(idioPct - macroPct);
  if (diff < 15) return "Idio and macro sleeves are balanced";
  if (idioPct > macroPct) {
    return diff >= 35 ? "Idiosyncratic sleeve dominates" : "Idiosyncratic sleeve leads";
  }
  return diff >= 35 ? "Macro sleeve dominates" : "Macro sleeve leads";
}

export function buildRiskManagementProse(enrichedExit: ChipNarrativeInput["enrichedExit"]): string {
  const pct = enrichedExit.profitTargetPct;
  const px = enrichedExit.profitTarget;
  const stopPct = enrichedExit.stopLossPct;
  const stopPx = enrichedExit.stopLoss;
  const profitPart =
    pct != null && px != null
      ? `Take profit at ${pct}% of max, $${px.toFixed(2)} option buyback`
      : pct != null
        ? `Take profit at ${pct}% of max`
        : "Profit target not available";
  const stopPart =
    stopPct != null && stopPx != null
      ? `stop at ${stopPct}% of max loss, $${stopPx.toFixed(2)} buyback`
      : stopPct != null
        ? `stop at ${stopPct}% of max loss`
        : "stop not available";
  const timePart = enrichedExit.timeStop?.trim()
    ? `time stop ${formatReportDate(enrichedExit.timeStop)}`
    : "no time stop";
  return `${profitPart}; ${stopPart}; ${timePart}.`;
}

export function buildReportProseFromChips(input: ChipNarrativeInput): ReportProse {
  const {
    ticker,
    ivr,
    atmIvPct,
    flowPc,
    flowPcSource,
    catalystInWindow,
    pt,
    tape,
    alignment,
    ioRegressionAvailable,
    idioPct,
    macroPct,
    sector,
    sectorPeers,
    strategyName,
    thesisFallback,
    enrichedExit,
  } = input;

  const ivrStr = ivr != null ? String(Math.round(ivr)) : NA;
  const atmStr = formatAtmIvPct(atmIvPct);
  const pcStr = flowPc != null ? String(flowPc) : NA;

  const whyInPlay = [
    `${ticker} is in play with IVR ${ivrStr}, ATM IV ${atmStr}, and ${flowPcSource} P/C ${pcStr}.`,
    catalystInWindow
      ? "A scheduled catalyst sits inside the position window; size for event risk."
      : "No scheduled catalyst sits inside the position window; the setup is vol/flow driven.",
  ].join(" ");

  let streetVsTapeProse: string;
  if (pt.available) {
    const rev = pt.revisions;
    const trendNote = revisionTrendLabel(pt.revisionTrend);
    const analystN = pt.analystCount ?? pt.recent.length;
    const ptLine = `Consensus PT ${fmtUsd(pt.consensusPT)}, ${fmtPct(pt.ptVsSignalPct)} vs signal, from ${analystN} analyst sources; ${rev.raises} raises and ${rev.cuts} cuts, ${trendNote}.`;
    const tapeLine = `${flowPcSource} tape: ${tape.tapeVerdict}, flow bias ${tape.flowBias}, P/C ${pcStr}.`;
    const alignLine =
      alignment === "divergent"
        ? "Street revision tone and tape disagree; treat as a structure/vol expression, not consensus plus flow confirmation."
        : "Street revision tone and tape direction align for this setup.";
    streetVsTapeProse = `${ptLine} ${tapeLine} ${alignLine}`;
  } else if (pt.recent.length > 0) {
    streetVsTapeProse = `No consensus PT row in our feed; ${pt.recent.length} recent grade actions are listed below. ${flowPcSource} tape: ${tape.tapeVerdict}, flow bias ${tape.flowBias}, P/C ${pcStr}.`;
  } else {
    streetVsTapeProse = `No sell-side PT row in our feed. ${flowPcSource} tape: ${tape.tapeVerdict}, flow bias ${tape.flowBias}, P/C ${pcStr}.`;
  }

  let idioMacroNote: string;
  if (!ioRegressionAvailable || idioPct == null || macroPct == null) {
    idioMacroNote =
      "Idio/macro attribution is not available because the regression sleeve did not resolve for this symbol.";
  } else {
    const dom = idioMacroDominance(idioPct, macroPct);
    const beta = input.ioScore.beta.toFixed(2);
    const r2 = input.ioScore.components?.marketIndependence?.rSquared;
    const r2Str = r2 != null && Number.isFinite(r2) ? r2.toFixed(2) : NA;
    const z = input.ioScore.residualReturnZScore.toFixed(2);
    idioMacroNote = `${dom}: ${idioPct}% idiosyncratic vs ${macroPct}% macro; beta ${beta}, R² ${r2Str}, residual Z ${z}.`;
  }

  const peerList = sectorPeers.length > 0 ? sectorPeers.join(", ") : NA;
  const sectorExposureNote = sectorPeers.length
    ? `${ticker} in ${sector || "its sector"} trades in sympathy with ${peerList}; group earnings and macro still matter for a single-name options structure.`
    : sector
      ? `${ticker} trades in ${sector}; FMP sympathy peers did not resolve for this symbol.`
      : `${ticker} sector peer map is thin; index and macro correlation still matter.`;

  const whyStructure = thesisFallback.trim()
    ? `${thesisFallback.trim()} Structure: ${strategyName}; ATM IV ${atmStr}, IVR ${ivrStr}.`
    : `${strategyName} expresses the edge with defined risk at ATM IV ${atmStr} and IVR ${ivrStr}.`;

  return {
    confidenceRead: "",
    whyInPlay,
    thesisWithNumbers: thesisFallback.trim() || whyInPlay,
    streetVsTapeProse,
    idioMacroNote,
    sectorExposureNote,
    whyStructure,
    bearCase: "",
    riskManagementProse: buildRiskManagementProse(enrichedExit),
  };
}

export function analystCountLabel(pt: NormalizedPriceTargetSnapshot): string {
  if (pt.analystCount != null && pt.analystCount > 0) return String(pt.analystCount);
  if (pt.recent.length > 0) {
    const firms = new Set(pt.recent.map((r) => r.firm).filter((f) => f && f !== "n/a"));
    if (firms.size > 0) return String(firms.size);
  }
  return NA;
}
