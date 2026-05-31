import { z } from "zod";
import type { ReportProse } from "./types.js";
import { sanitizeReportDisplayText } from "./sanitizeReport.js";

const proseField = z.string().min(8);

/** Full-report prose may include digits (thesis, levels, PT, flow). */
export const reportProseSchema = z.object({
  confidenceRead: proseField,
  whyInPlay: proseField,
  thesisWithNumbers: proseField,
  streetVsTapeProse: proseField,
  idioMacroNote: proseField,
  sectorExposureNote: proseField,
  whyStructure: proseField,
  bearCase: proseField,
  riskManagementProse: proseField,
});

export function validateReportProse(raw: unknown): { ok: true; prose: ReportProse } | { ok: false; error: string } {
  const parsed = reportProseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  return { ok: true, prose: parsed.data };
}

/** Light cleanup for report display — keeps all numbers. */
export function cleanReportProse(s: string): string {
  return sanitizeReportDisplayText(s.replace(/\s+/g, " ").trim());
}
