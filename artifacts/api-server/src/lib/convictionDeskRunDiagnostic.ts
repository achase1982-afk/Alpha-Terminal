import type { ZodError, ZodIssue } from "zod";
import type { WebSearchEnvelope } from "./aiLabAnalystClient.js";

/** Persisted on Conviction Desk runs for DB-only diagnosis (not logged to stdout). */
export type ConvictionDeskRunOutcome =
  | "success"
  | "validation_failed_after_retry"
  | "stream_error"
  | "extraction_error";

export type ConvictionZodIssueDiagnostic = {
  path: string[];
  code: string;
  message: string;
  received?: unknown;
  expected?: unknown;
};

export type ConvictionAttemptValidationResult = {
  ok: boolean;
  zodIssues: ConvictionZodIssueDiagnostic[];
  businessRuleErrors: string[];
};

export interface ConvictionDeskRunDiagnostic {
  ticker: string;
  modelId: string;
  provider: string;
  startedAt: string;
  finishedAt: string;
  outcome: ConvictionDeskRunOutcome;
  attempts: Array<{
    attemptNumber: 1 | 2;
    rawResponseText: string;
    envelope: WebSearchEnvelope;
    extractedJsonString: string | null;
    parsedJson: unknown | null;
    validationResult: ConvictionAttemptValidationResult;
  }>;
  finalErrors: string[];
}

function issueToDiagnostic(i: ZodIssue): ConvictionZodIssueDiagnostic {
  const row: ConvictionZodIssueDiagnostic = {
    path: i.path.map((p) => String(p)),
    code: i.code,
    message: i.message,
  };
  if ("received" in i && i.received !== undefined) {
    row.received = i.received;
  }
  if (i.code === "invalid_enum_value" && "options" in i && i.options !== undefined) {
    row.expected = i.options;
  } else if ("expected" in i && (i as { expected?: unknown }).expected !== undefined) {
    row.expected = (i as { expected?: unknown }).expected;
  }
  return row;
}

export function zodIssuesFromError(err: ZodError): ConvictionZodIssueDiagnostic[] {
  return err.issues.map(issueToDiagnostic);
}
