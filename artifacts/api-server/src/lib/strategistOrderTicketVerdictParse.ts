/**
 * Shared parsing for order-ticket validation JSON (solo-style desk PM output).
 * Keeps strategistDesk and strategistValidate decoupled (no circular imports).
 */
import type { WebSearchTrace } from "./aiLabAnalystClient.js";

export type ParsedOrderTicketValidationVerdict = "PROCEED" | "PROCEED_WITH_CAUTION" | "DO_NOT_PROCEED";

export interface ParsedOrderTicketValidationPayload {
  verdict: ParsedOrderTicketValidationVerdict;
  confidence: number;
  reasoningBullets: string[];
  risks: string[];
  improvements: string[];
  bullConfidence: number;
  bearConfidence: number;
  trace: WebSearchTrace;
}

function asInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  }
  return fallback;
}

function asStringArray(v: unknown, max = 5): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).slice(0, max);
}

function asVerdict(v: unknown): ParsedOrderTicketValidationVerdict | null {
  if (typeof v !== "string") return null;
  const u = v.toUpperCase().replace(/\s+/g, "_");
  if (u === "PROCEED" || u === "PROCEED_WITH_CAUTION" || u === "DO_NOT_PROCEED") return u;
  return null;
}

export function mergeValidationTraces(...traces: WebSearchTrace[]): WebSearchTrace {
  if (traces.length === 0) return { webSearchUsed: false, queries: [], sources: [] };
  const seen = new Set<string>();
  const sources = traces.flatMap((t) => t.sources).filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
  return {
    webSearchUsed: traces.some((t) => t.webSearchUsed),
    queries: [...new Set(traces.flatMap((t) => t.queries))],
    sources,
  };
}

/** Parses the solo-shaped validation JSON produced by SOLO_PROMPT / desk PM order-ticket prompts. */
export function soloStyleDeskPmJsonToValidationPayload(
  json: Record<string, unknown> | null,
  trace: WebSearchTrace,
): ParsedOrderTicketValidationPayload {
  const verdict = (json && asVerdict(json["finalVerdict"])) ?? "PROCEED_WITH_CAUTION";
  const finalConf = asInt(json?.["finalConfidence"], 50);
  const bullConf = asInt(json?.["bullConfidence"], verdict === "PROCEED" ? finalConf : 50);
  const bearConf = asInt(json?.["bearConfidence"], verdict === "DO_NOT_PROCEED" ? finalConf : 50);
  const bullets = asStringArray(json?.["reasoningBullets"], 4);
  const risks = asStringArray(json?.["topRisks"], 3);
  const improvements = verdict === "PROCEED" ? [] : asStringArray(json?.["improvements"], 3);
  return {
    verdict,
    confidence: finalConf,
    reasoningBullets: bullets,
    risks,
    improvements,
    bullConfidence: bullConf,
    bearConfidence: bearConf,
    trace,
  };
}
