import { db, eq, and, strategistHistoryTable } from "@workspace/db";
import {
  persistedFinalPayloadFromHistoryRow,
  runningPayloadFromJob,
  terminalNonSuccessPayload,
} from "./pollPayload.js";
import { findJobById } from "./jobs.js";
import type { StrategistPollPayload } from "./types.js";

export async function resolveStrategistPollPayload(
  jobId: string,
  since: number,
  authUserId: string,
): Promise<StrategistPollPayload | null> {
  const job = await findJobById(jobId);
  if (!job || job.userId !== authUserId) {
    return null;
  }

  if (job.status === "completed") {
    const rows = await db
      .select()
      .from(strategistHistoryTable)
      .where(and(eq(strategistHistoryTable.jobId, jobId), eq(strategistHistoryTable.cleared, false)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return terminalNonSuccessPayload({ ...job, status: "failed" }, since);
    }
    return persistedFinalPayloadFromHistoryRow(jobId, row);
  }

  if (job.status === "cancelled" || job.status === "failed") {
    return terminalNonSuccessPayload(job, since);
  }

  return runningPayloadFromJob(job, since);
}
