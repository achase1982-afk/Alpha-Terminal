import type { StrategistJob } from "@workspace/db";
import type { StrategistV2Result } from "../strategistV2.js";
import {
  emitFullDiagnosticTelemetryFromCapture,
  type StrategistTelemetryCapture,
} from "../strategistV2.js";
import { logger } from "../logger.js";

function readTelemetryCapture(job: StrategistJob): StrategistTelemetryCapture | null {
  const checkpoint = job.checkpoint as Record<string, unknown> | null;
  if (!checkpoint) return null;
  for (const key of ["validating", "analyzing", "debating"] as const) {
    const slice = checkpoint[key] as { telemetryCapture?: StrategistTelemetryCapture } | undefined;
    if (slice?.telemetryCapture) return slice.telemetryCapture;
  }
  return null;
}

/** Post-commit telemetry for analyze jobs (failure does not roll back completion). */
export async function writeAnalyzeTelemetryPostCommit(job: StrategistJob): Promise<number | null> {
  if (job.kind !== "analyze") return null;
  const capture = readTelemetryCapture(job);
  if (!capture) {
    logger.warn({ jobId: job.id, ticker: job.ticker }, "StrategistV3: no telemetry capture on completed job");
    return null;
  }
  try {
    const id = await emitFullDiagnosticTelemetryFromCapture({
      ...capture,
      jobId: job.id,
    });
    if (id != null) {
      logger.info({ jobId: job.id, ticker: job.ticker, telemetryId: id }, "StrategistV3: telemetry persisted post-commit");
    }
    return id;
  } catch (err) {
    logger.error({ err, jobId: job.id }, "StrategistV3: post-commit telemetry insert failed");
    return null;
  }
}

export function attachTelemetryIdToResult(result: StrategistV2Result, telemetryId: number | null): StrategistV2Result {
  if (telemetryId == null) return result;
  return { ...result, telemetryId };
}
