import type { StrategistFullReport } from "./types.js";

const MONTHS =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

/** Collapse broken numeric/date ranges after dash stripping (e.g. "$380 $390" → "$380–$390"). */
export function repairDisplayRanges(text: string): string {
  let s = text;
  s = s.replace(/(\$\d[\d,]*(?:\.\d+)?)\s+(\$\d[\d,]*(?:\.\d+)?)/g, "$1–$2");
  s = s.replace(
    new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})\\s+(\\d{1,2})\\b`, "g"),
    "$1 $2–$3",
  );
  s = s.replace(/(\d+\.\d+)\s+(\d+\.\d+)(?!\s*%)/g, "$1–$2");
  return s;
}

/** Remove external links and normalize punctuation for drawer display. */
export function sanitizeReportDisplayText(text: string): string {
  if (!text) return text;
  let s = text
    .replace(/https?:\/\/[^\s)\]}>,]+/gi, " ")
    .replace(/\bwww\.[^\s)\]}>,]+/gi, " ")
    .replace(/\b[a-z0-9][-a-z0-9]*\.(?:com|org|net|io|co|uk|edu|gov)(?:\/[^\s)\]}>,]*)?/gi, " ")
    .replace(/\s*—\s*/g, ". ")
    .replace(/\s+-\s+/g, "–")
    .replace(/_/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  s = repairDisplayRanges(s);
  s = s.replace(/\.\s*\./g, ".");
  return s;
}

function sanitizeChipValue(value: string): string {
  return sanitizeReportDisplayText(value);
}

/** Apply display sanitization to every user-visible string in the full report. */
export function sanitizeFullReportForDisplay(report: StrategistFullReport): StrategistFullReport {
  const body = (s: string | undefined) => (s ? sanitizeReportDisplayText(s) : s);

  return {
    ...report,
    provenance: {
      ...report.provenance,
      confidenceRead: body(report.provenance.confidenceRead) ?? report.provenance.confidenceRead,
    },
    tradeRecap: report.tradeRecap
      ? {
          chips: report.tradeRecap.chips.map((c) => ({
            ...c,
            value: sanitizeChipValue(c.value),
          })),
        }
      : report.tradeRecap,
    whyInPlay: report.whyInPlay
      ? {
          chips: report.whyInPlay.chips.map((c) => ({ ...c, value: sanitizeChipValue(c.value) })),
          body: body(report.whyInPlay.body) ?? report.whyInPlay.body,
        }
      : report.whyInPlay,
    thesisWithNumbers: report.thesisWithNumbers
      ? {
          chips: report.thesisWithNumbers.chips.map((c) => ({ ...c, value: sanitizeChipValue(c.value) })),
          body: body(report.thesisWithNumbers.body) ?? report.thesisWithNumbers.body,
        }
      : report.thesisWithNumbers,
    streetVsTape: report.streetVsTape
      ? {
          ...report.streetVsTape,
          body: body(report.streetVsTape.body) ?? report.streetVsTape.body,
          sellSide: {
            ...report.streetVsTape.sellSide,
            chips: report.streetVsTape.sellSide.chips.map((c) => ({
              ...c,
              value: sanitizeChipValue(c.value),
            })),
            recent: report.streetVsTape.sellSide.recent.map((r) => ({
              firm: body(r.firm) ?? r.firm,
              action: body(r.action) ?? r.action,
              from: body(r.from) ?? r.from,
              to: body(r.to) ?? r.to,
              date: r.date,
            })),
          },
          buySide: {
            chips: report.streetVsTape.buySide.chips.map((c) => ({
              ...c,
              value: sanitizeChipValue(c.value),
            })),
          },
        }
      : report.streetVsTape,
    idioMacro: report.idioMacro
      ? {
          chips: report.idioMacro.chips.map((c) => ({ ...c, value: sanitizeChipValue(c.value) })),
          body: body(report.idioMacro.body) ?? report.idioMacro.body,
        }
      : report.idioMacro,
    sectorExposure: report.sectorExposure
      ? {
          ...report.sectorExposure,
          peers: report.sectorExposure.peers.map((p) => sanitizeReportDisplayText(p)),
          drivers: report.sectorExposure.drivers.map((d) => sanitizeReportDisplayText(d)),
          body: body(report.sectorExposure.body) ?? report.sectorExposure.body,
        }
      : report.sectorExposure,
    whyStructure: report.whyStructure
      ? { body: body(report.whyStructure.body) ?? report.whyStructure.body }
      : report.whyStructure,
    bearCase: report.bearCase
      ? { body: body(report.bearCase.body) ?? report.bearCase.body }
      : report.bearCase,
    riskManagement: report.riskManagement
      ? {
          chips: report.riskManagement.chips.map((c) => ({ ...c, value: sanitizeChipValue(c.value) })),
          body: body(report.riskManagement.body) ?? report.riskManagement.body,
        }
      : report.riskManagement,
    dataAssumptions: report.dataAssumptions
      ? {
          sources: report.dataAssumptions.sources.map((s) => sanitizeReportDisplayText(s)),
          modeledFields: report.dataAssumptions.modeledFields.map((s) => sanitizeReportDisplayText(s)),
        }
      : report.dataAssumptions,
  };
}
