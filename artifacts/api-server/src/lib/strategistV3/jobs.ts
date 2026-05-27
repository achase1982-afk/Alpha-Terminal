import {
  db,
  eq,
  and,
  or,
  sql,
  inArray,
  desc,
  gte,
  strategistJobsTable,
  type StrategistJob,
  type StrategistJobKind,
} from "@workspace/db";
import { ACTIVE_JOBS_TERMINAL_WINDOW_SEC } from "./config.js";

export async function findJobById(jobId: string): Promise<StrategistJob | undefined> {
  const rows = await db.select().from(strategistJobsTable).where(eq(strategistJobsTable.id, jobId)).limit(1);
  return rows[0];
}

export async function findActiveDuplicate(
  userId: string,
  ticker: string,
  kind: StrategistJobKind,
): Promise<StrategistJob | undefined> {
  const upper = ticker.toUpperCase();
  const rows = await db
    .select()
    .from(strategistJobsTable)
    .where(
      and(
        eq(strategistJobsTable.userId, userId),
        eq(strategistJobsTable.ticker, upper),
        eq(strategistJobsTable.kind, kind),
        inArray(strategistJobsTable.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function insertQueuedJob(input: {
  id: string;
  userId: string;
  kind: StrategistJobKind;
  ticker: string;
  params: Record<string, unknown>;
}): Promise<void> {
  await db.insert(strategistJobsTable).values({
    id: input.id,
    userId: input.userId,
    kind: input.kind,
    ticker: input.ticker.toUpperCase(),
    params: input.params,
    status: "queued",
  });
}

export async function cancelJob(jobId: string): Promise<StrategistJob | undefined> {
  const rows = await db
    .update(strategistJobsTable)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(and(eq(strategistJobsTable.id, jobId), inArray(strategistJobsTable.status, ["queued", "running"])))
    .returning();
  return rows[0];
}

export async function isJobCancelled(jobId: string): Promise<boolean> {
  const row = await findJobById(jobId);
  return row?.status === "cancelled";
}

export async function touchJobHeartbeat(jobId: string): Promise<void> {
  await db
    .update(strategistJobsTable)
    .set({ lastHeartbeatAt: new Date() })
    .where(and(eq(strategistJobsTable.id, jobId), eq(strategistJobsTable.status, "running")));
}

export async function updateJobPhase(jobId: string, phase: string): Promise<void> {
  await db
    .update(strategistJobsTable)
    .set({ phase, lastHeartbeatAt: new Date() })
    .where(eq(strategistJobsTable.id, jobId));
}

export async function mergeJobProgress(
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const job = await findJobById(jobId);
  if (!job) return;
  const current =
    job.progress && typeof job.progress === "object" && !Array.isArray(job.progress)
      ? (job.progress as Record<string, unknown>)
      : {};
  await db
    .update(strategistJobsTable)
    .set({
      progress: { ...current, ...patch },
      lastHeartbeatAt: new Date(),
    })
    .where(eq(strategistJobsTable.id, jobId));
}

export async function writeJobCheckpoint(
  jobId: string,
  phaseKey: string,
  checkpointSlice: Record<string, unknown>,
  lastCompletedPhase: string,
): Promise<void> {
  const job = await findJobById(jobId);
  if (!job) return;
  const current =
    job.checkpoint && typeof job.checkpoint === "object" && !Array.isArray(job.checkpoint)
      ? (job.checkpoint as Record<string, unknown>)
      : {};
  await db
    .update(strategistJobsTable)
    .set({
      checkpoint: { ...current, [phaseKey]: checkpointSlice },
      lastCompletedPhase,
      lastHeartbeatAt: new Date(),
    })
    .where(eq(strategistJobsTable.id, jobId));
}

export async function releaseJobForRetry(jobId: string): Promise<void> {
  await db
    .update(strategistJobsTable)
    .set({
      status: "queued",
      workerId: null,
      phase: null,
    })
    .where(and(eq(strategistJobsTable.id, jobId), eq(strategistJobsTable.status, "running")));
}

export type ActiveJobRow = {
  jobId: string;
  ticker: string;
  kind: "analyze" | "validate_trade";
  status: StrategistJob["status"];
  phase: string | null;
  progress: Record<string, unknown>;
  queuePosition?: number;
  startedAt: string | null;
  completedAt: string | null;
  error: StrategistJob["error"];
};

export async function listActiveJobsForUser(userId: string): Promise<ActiveJobRow[]> {
  const terminalSince = new Date(Date.now() - ACTIVE_JOBS_TERMINAL_WINDOW_SEC * 1000);
  const rows = await db
    .select()
    .from(strategistJobsTable)
    .where(
      and(
        eq(strategistJobsTable.userId, userId),
        or(
          inArray(strategistJobsTable.status, ["queued", "running"]),
          and(
            inArray(strategistJobsTable.status, ["completed", "failed", "cancelled"]),
            gte(strategistJobsTable.completedAt, terminalSince),
          ),
        ),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${strategistJobsTable.status} IN ('queued','running') THEN 0 ELSE 1 END`,
      desc(strategistJobsTable.createdAt),
    )
    .limit(50);

  const queued = rows.filter((r) => r.status === "queued");
  const queueOrder = new Map(queued.map((r, i) => [r.id, i + 1]));

  return rows.map((r) => ({
    jobId: r.id,
    ticker: r.ticker,
    kind: r.kind,
    status: r.status,
    phase: r.phase,
    progress: (r.progress as Record<string, unknown>) ?? {},
    queuePosition: r.status === "queued" ? queueOrder.get(r.id) : undefined,
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    error: r.error,
  }));
}

/** Claim next queued job (short transaction). Returns undefined when queue empty. */
export async function claimNextJob(workerId: string): Promise<StrategistJob | undefined> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(strategistJobsTable)
      .where(eq(strategistJobsTable.status, "queued"))
      .orderBy(desc(strategistJobsTable.priority), strategistJobsTable.createdAt)
      .limit(32)
      .for("update", { skipLocked: true });

    for (const candidate of candidates) {
      const blocking = await tx
        .select({ id: strategistJobsTable.id })
        .from(strategistJobsTable)
        .where(
          and(
            eq(strategistJobsTable.status, "running"),
            eq(strategistJobsTable.userId, candidate.userId),
            eq(strategistJobsTable.ticker, candidate.ticker),
            eq(strategistJobsTable.kind, candidate.kind),
          ),
        )
        .limit(1);
      if (blocking.length > 0) continue;

      const [updated] = await tx
        .update(strategistJobsTable)
        .set({
          status: "running",
          workerId,
          startedAt: candidate.startedAt ?? new Date(),
          lastHeartbeatAt: new Date(),
          attempt: candidate.attempt + 1,
        })
        .where(eq(strategistJobsTable.id, candidate.id))
        .returning();
      return updated;
    }
    return undefined;
  });
}

export async function runReaperStaleJobs(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE strategist_jobs
    SET status = CASE
        WHEN attempt < 3 AND last_completed_phase IS NOT NULL THEN 'queued'::strategist_job_status
        ELSE 'failed'::strategist_job_status
      END,
      error = CASE
        WHEN attempt < 3 AND last_completed_phase IS NOT NULL THEN NULL
        ELSE jsonb_build_object('code', 'worker_crashed', 'message', 'Worker did not heartbeat in time')
      END,
      worker_id = NULL,
      completed_at = CASE
        WHEN attempt >= 3 OR last_completed_phase IS NULL THEN now()
        ELSE NULL
      END
    WHERE status = 'running'
      AND last_heartbeat_at < now() - interval '60 seconds'
  `);
  return result.rowCount ?? 0;
}
