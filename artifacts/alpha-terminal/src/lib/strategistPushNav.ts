const SESSION_KEY = "alpha_strategist_push_job";

let pendingJobId: string | null = null;

export function setPendingStrategistPushJobId(jobId: string | null): void {
  pendingJobId = jobId && jobId.length > 0 ? jobId : null;
  try {
    if (pendingJobId) sessionStorage.setItem(SESSION_KEY, pendingJobId);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // private mode / quota
  }
}

/** Pending push job id without clearing (for boot-time routing before Strategist mounts). */
export function peekPendingStrategistPushJobId(): string | null {
  if (pendingJobId && pendingJobId.length > 0) return pendingJobId;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    return stored && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function consumePendingStrategistPushJobId(): string | null {
  const id = peekPendingStrategistPushJobId();
  pendingJobId = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
  return id;
}
