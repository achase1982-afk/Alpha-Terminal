/** Kill switch: when false, POST /analyze returns 503 strategist_unavailable. Default true. */
export function isStrategistV3Enabled(): boolean {
  const raw = process.env.STRATEGIST_V3_ENABLED;
  if (raw === undefined || raw === "") return true;
  return raw === "true" || raw === "1";
}

export const WORKER_CONCURRENCY = Number(process.env.STRATEGIST_WORKER_CONCURRENCY ?? 3);
export const WORKER_CLAIM_POLL_MS = 1_500;
export const WORKER_HEARTBEAT_MS = 10_000;
export const WORKER_STALE_HEARTBEAT_MS = 60_000;
export const WORKER_REAPER_INTERVAL_MS = 30_000;
export const WORKER_MAX_ATTEMPTS = 3;
export const IVR_TIMEOUT_MS = Number(process.env.STRATEGIST_IVR_TIMEOUT_MS ?? 5 * 60 * 1000);
export const ACTIVE_JOBS_TERMINAL_WINDOW_SEC = 60;
