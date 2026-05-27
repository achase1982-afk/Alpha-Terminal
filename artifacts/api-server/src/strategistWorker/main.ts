import type { StrategistJob } from "@workspace/db";
import {
  WORKER_CLAIM_POLL_MS,
  WORKER_CONCURRENCY,
  WORKER_HEARTBEAT_MS,
  WORKER_REAPER_INTERVAL_MS,
} from "../lib/strategistV3/config.js";
import { claimNextJob, runReaperStaleJobs, touchJobHeartbeat } from "../lib/strategistV3/jobs.js";
import { runAnalyzeJob } from "./runAnalyzeJob.js";
import { runValidateJob } from "./runValidateJob.js";
import { logger } from "../lib/logger.js";

const WORKER_ID =
  process.env.WORKER_ID ??
  `${process.env.HOSTNAME ?? "local"}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let shuttingDown = false;
let signalHandlersInstalled = false;
const inflight = new Set<Promise<void>>();
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function startJobHeartbeat(jobId: string): void {
  stopJobHeartbeat(jobId);
  heartbeatTimers.set(
    jobId,
    setInterval(() => {
      void touchJobHeartbeat(jobId);
    }, WORKER_HEARTBEAT_MS),
  );
}

function stopJobHeartbeat(jobId: string): void {
  const t = heartbeatTimers.get(jobId);
  if (t) clearInterval(t);
  heartbeatTimers.delete(jobId);
}

async function runJob(job: StrategistJob): Promise<void> {
  startJobHeartbeat(job.id);
  try {
    if (job.kind === "validate_trade") {
      await runValidateJob(job);
    } else {
      await runAnalyzeJob(job);
    }
  } finally {
    stopJobHeartbeat(job.id);
  }
}

async function claimLoop(): Promise<void> {
  while (!shuttingDown) {
    if (inflight.size >= WORKER_CONCURRENCY) {
      await Promise.race(inflight);
      continue;
    }
    const job = await claimNextJob(WORKER_ID);
    if (!job) {
      await sleep(WORKER_CLAIM_POLL_MS);
      continue;
    }
    const task = runJob(job).finally(() => inflight.delete(task));
    inflight.add(task);
  }
}

async function reaperLoop(): Promise<void> {
  while (!shuttingDown) {
    try {
      const n = await runReaperStaleJobs();
      if (n > 0) {
        logger.warn({ count: n, workerId: WORKER_ID }, "StrategistWorker: reaped stale jobs");
      }
    } catch (err) {
      logger.error({ err }, "StrategistWorker: reaper failed");
    }
    await sleep(WORKER_REAPER_INTERVAL_MS);
  }
}

function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const onStop = (signal: string) => {
    logger.info({ signal, workerId: WORKER_ID }, "StrategistWorker: shutdown requested — stop claiming new jobs");
    shuttingDown = true;
  };
  process.on("SIGTERM", () => onStop("SIGTERM"));
  process.on("SIGINT", () => onStop("SIGINT"));
}

/** In-process background task: poll Postgres and run claimed strategist jobs. */
export function startStrategistWorker(): void {
  installSignalHandlers();
  logger.info({ workerId: WORKER_ID, concurrency: WORKER_CONCURRENCY }, "StrategistWorker: claim loop starting");
  void claimLoop();
}

/** In-process background task: requeue or fail jobs with stale heartbeats. */
export function startStrategistReaper(): void {
  installSignalHandlers();
  logger.info({ workerId: WORKER_ID, intervalMs: WORKER_REAPER_INTERVAL_MS }, "StrategistWorker: reaper starting");
  void reaperLoop();
}
