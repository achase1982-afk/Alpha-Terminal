import type { StrategistJob } from "@workspace/db";
import type { ValidationTicket, ValidationVerdictPayload } from "../strategistValidate.js";
import type { StrategistV2Result } from "../strategistV2.js";
import { stripConvictionDeskDiagnosticsForClient } from "../strategistClientSanitize.js";
import type { JobProgressState, StrategistPollPayload, TranscriptTurn, ValidationMeta } from "./types.js";

export function strategistV2ResultForWire(result: StrategistV2Result | null): StrategistV2Result | null {
  if (result == null) return null;
  return stripConvictionDeskDiagnosticsForClient(result);
}

function readProgress(job: StrategistJob): JobProgressState {
  const p = job.progress as JobProgressState | null;
  return p && typeof p === "object" ? p : {};
}

export function persistedFinalPayloadFromHistoryRow(
  jobId: string,
  row: { ticker: string; cardJson: unknown; createdAt?: Date | null },
): StrategistPollPayload {
  const card = row.cardJson as Record<string, unknown>;
  const isValidation = card["kind"] === "validation";
  const ticker = row.ticker;
  const transcriptRaw = card["debateTranscript"];
  const safeTranscript = Array.isArray(transcriptRaw) ? (transcriptRaw as TranscriptTurn[]) : [];
  return {
    jobId,
    kind: isValidation ? "validation" : "analyze",
    ticker,
    status: isValidation
      ? `Verdict: ${String((card["validation"] as { verdict?: string })?.verdict ?? "done")}`
      : "Done",
    tokens: [],
    nextSince: 0,
    transcript: safeTranscript,
    done: true,
    result: isValidation
      ? (card["validation"] as ValidationVerdictPayload)
      : strategistV2ResultForWire(card as unknown as StrategistV2Result),
    validationMeta: isValidation
      ? {
          ticker,
          mode: (card["ticket"] as ValidationTicket).mode,
          ticket: card["ticket"] as ValidationTicket,
          thesis: typeof card["thesis"] === "string" ? card["thesis"] : undefined,
          rollingShort: card["rollingShort"] === true,
        }
      : null,
    error: null,
    startedAt: row.createdAt?.getTime?.() ?? Date.now(),
    finishedAt: row.createdAt?.getTime?.() ?? Date.now(),
    serverProgressAt: row.createdAt?.getTime?.() ?? Date.now(),
    source: "persisted",
  };
}

export function runningPayloadFromJob(job: StrategistJob, since: number): StrategistPollPayload {
  const progress = readProgress(job);
  const tokensAll = progress.tokens ?? [];
  const s = Math.max(0, since);
  const tokens = s < tokensAll.length ? tokensAll.slice(s) : [];
  const kind = job.kind === "validate_trade" ? "validation" : "analyze";
  const startedAtMs = job.startedAt?.getTime?.() ?? job.createdAt.getTime();
  const heartbeatMs = job.lastHeartbeatAt?.getTime?.() ?? startedAtMs;
  return {
    jobId: job.id,
    kind,
    ticker: job.ticker,
    status: progress.liveStatus ?? (job.status === "queued" ? "Starting…" : "Running…"),
    tokens,
    nextSince: tokensAll.length,
    transcript: progress.transcript ?? [],
    done: false,
    result: null,
    validationMeta: kind === "validation" ? (progress.validationMeta ?? null) : null,
    error: null,
    cancelled: false,
    startedAt: startedAtMs,
    finishedAt: null,
    serverProgressAt: heartbeatMs,
  };
}

export function terminalNonSuccessPayload(job: StrategistJob, since: number): StrategistPollPayload {
  const base = runningPayloadFromJob(job, since);
  const startedAtMs = job.startedAt?.getTime?.() ?? job.createdAt.getTime();
  const completedMs = job.completedAt?.getTime?.() ?? Date.now();
  if (job.status === "cancelled") {
    return {
      ...base,
      status: "Cancelled",
      tokens: [],
      nextSince: 0,
      done: true,
      cancelled: true,
      error: null,
      finishedAt: completedMs,
      serverProgressAt: completedMs,
    };
  }
  return {
    ...base,
    status: "Analysis failed",
    tokens: [],
    nextSince: 0,
    done: true,
    cancelled: false,
    error: "Analysis failed. Please retry.",
    finishedAt: completedMs,
    serverProgressAt: completedMs,
  };
}
