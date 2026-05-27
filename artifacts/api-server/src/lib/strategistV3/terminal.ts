import { db, eq, and, strategistHistoryTable, strategistJobsTable, type StrategistJob } from "@workspace/db";
import type { StrategistV2Result } from "../strategistV2.js";
import type { ValidationTicket, ValidationVerdictPayload } from "../strategistValidate.js";
import { logger } from "../logger.js";
import type { TranscriptTurn } from "./types.js";
import { fireStrategistJobPush } from "./push.js";
import { verifyStrategistHistoryReadable } from "./historyVerify.js";
import {
  attachTelemetryIdToResult,
  writeAnalyzeTelemetryPostCommit,
} from "./telemetryPostCommit.js";

export class TerminalRaceError extends Error {
  constructor(jobId: string) {
    super(`Terminal race for job ${jobId}`);
    this.name = "TerminalRaceError";
  }
}

type AnalyzeCardJson = StrategistV2Result & { debateTranscript?: TranscriptTurn[] };

type ValidationCardJson = {
  kind: "validation";
  validation: ValidationVerdictPayload;
  ticket: ValidationTicket;
  thesis: string | null;
  rollingShort: boolean;
  debateTranscript: TranscriptTurn[];
};

function assembleCardJson(job: StrategistJob): unknown {
  const checkpoint = job.checkpoint as Record<string, unknown>;
  const progress = job.progress as {
    transcript?: TranscriptTurn[];
    validationMeta?: { ticket?: ValidationTicket; thesis?: string; rollingShort?: boolean };
  };

  if (job.kind === "validate_trade") {
    const validation = checkpoint["validating"] as { validationResult?: ValidationVerdictPayload } | undefined;
    const meta = progress.validationMeta;
    const ticket = meta?.ticket ?? (job.params as { ticket?: ValidationTicket }).ticket;
    if (!validation?.validationResult || !ticket) {
      throw new Error("Missing validation result for persist");
    }
    const card: ValidationCardJson = {
      kind: "validation",
      validation: validation.validationResult,
      ticket,
      thesis: meta?.thesis ?? null,
      rollingShort: meta?.rollingShort === true,
      debateTranscript: progress.transcript ?? [],
    };
    return card;
  }

  const validating = checkpoint["validating"] as { analyzeResult?: StrategistV2Result } | undefined;
  const analyzing = checkpoint["analyzing"] as { analyzeResult?: StrategistV2Result } | undefined;
  const analyzeResult = validating?.analyzeResult ?? analyzing?.analyzeResult;
  if (!analyzeResult) {
    throw new Error("Missing analyze result for persist");
  }
  const transcript = progress.transcript ?? [];
  const card: AnalyzeCardJson =
    transcript.length > 0 ? { ...analyzeResult, debateTranscript: transcript } : analyzeResult;
  return card;
}

/**
 * Sole code path that sets status = 'completed'. Guarded transaction inserts history then flips job.
 */
export async function persistAndComplete(job: StrategistJob): Promise<void> {
  const cardJson = assembleCardJson(job);

  await db.transaction(async (tx) => {
    const [historyRow] = await tx
      .insert(strategistHistoryTable)
      .values({
        jobId: job.id,
        ticker: job.ticker,
        cardJson,
        cleared: false,
      })
      .returning({ id: strategistHistoryTable.id });

    if (!historyRow?.id) {
      throw new Error("strategist_history insert failed");
    }

    const updated = await tx
      .update(strategistJobsTable)
      .set({
        status: "completed",
        completedAt: new Date(),
        resultHistoryId: historyRow.id,
        phase: null,
        lastCompletedPhase: "persisting",
      })
      .where(and(eq(strategistJobsTable.id, job.id), eq(strategistJobsTable.status, "running")))
      .returning({ id: strategistJobsTable.id });

    if (updated.length === 0) {
      throw new TerminalRaceError(job.id);
    }
  });

  const completedJob = (await db
    .select()
    .from(strategistJobsTable)
    .where(eq(strategistJobsTable.id, job.id))
    .limit(1))[0];

  if (completedJob) {
    const telemetryId = await writeAnalyzeTelemetryPostCommit(completedJob);
    if (telemetryId != null && job.kind === "analyze") {
      const enriched = attachTelemetryIdToResult(cardJson as StrategistV2Result, telemetryId);
      await db
        .update(strategistHistoryTable)
        .set({ cardJson: enriched })
        .where(eq(strategistHistoryTable.jobId, job.id))
        .catch((err) =>
          logger.warn({ err, jobId: job.id }, "StrategistV3: failed to attach telemetryId to history"),
        );
    }
  }

  const readable = await verifyStrategistHistoryReadable(job.id);
  if (!readable) {
    logger.warn({ jobId: job.id, ticker: job.ticker }, "StrategistV3: history row not readable before push");
  }

  const pushKind = job.kind === "validate_trade" ? "validation" : "analyze";
  await fireStrategistJobPush({
    userId: job.userId,
    jobId: job.id,
    ticker: job.ticker,
    kind: pushKind,
  }).catch((err) => logger.warn({ err, jobId: job.id }, "StrategistV3: push after complete failed"));
}

export async function markJobFailed(job: StrategistJob, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err instanceof Error && "code" in err && typeof (err as { code?: string }).code === "string"
      ? (err as { code: string }).code
      : "job_failed";

  const updated = await db
    .update(strategistJobsTable)
    .set({
      status: "failed",
      completedAt: new Date(),
      error: { code, message },
      phase: null,
    })
    .where(and(eq(strategistJobsTable.id, job.id), eq(strategistJobsTable.status, "running")))
    .returning();

  if (updated.length === 0) return;

  await fireStrategistJobPush({
    userId: job.userId,
    jobId: job.id,
    ticker: job.ticker,
    kind: "failure",
  }).catch((pushErr) => logger.warn({ pushErr, jobId: job.id }, "StrategistV3: push after failure failed"));
}
