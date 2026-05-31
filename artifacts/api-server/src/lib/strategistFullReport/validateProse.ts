import { z } from "zod";
import type { ReportProse } from "./types.js";
import { sanitizeReportDisplayText } from "./sanitizeReport.js";

const noDigits = (s: string) => !/\d/.test(s);

const proseField = z
  .string()
  .min(8)
  .refine(noDigits, { message: "prose must not contain digits" });

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

/** Strip digits from legacy AI text when synthesizing fallback prose. */
export function stripDigitsFromProse(s: string): string {
  return sanitizeReportDisplayText(
    s
      .replace(/\d+(\.\d+)?/g, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}
