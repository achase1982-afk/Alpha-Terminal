import { useTerminalStore, type StrategistTranscriptTurn, type StrategistValidationMeta } from "./store";
import { fetchWithAuth } from "./fetchWithAuth";
import { toast } from "sonner";

const API_BASE = "/api";

// Per-jobId poller registry. Each entry exposes an abort flag plus a
// heartbeat (`lastTickAt`) so a fresh caller can detect a stalled poller
// (mobile browsers throttle setTimeout chains in backgrounded tabs) and
// take over instead of being silently no-op'd.
type PollerHandle = {
  aborted: boolean;
  lastTickAt: number;
};
const activePollers = new Map<string, PollerHandle>();

// If an existing poller hasn't ticked in this long, a new caller takes over.
const STALE_POLLER_MS = 8_000;

interface ThinkingResponse {
  status: string;
  tokens: string[];
  nextSince: number;
  transcript?: StrategistTranscriptTurn[];
  done: boolean;
  result: unknown | null;
  error: string | null;
  kind?: 'analyze' | 'validation';
  validationMeta?: StrategistValidationMeta | null;
  /** Present when the payload was rebuilt from persisted history (buffer miss). */
  source?: 'persisted';
  /** User cancelled; do not treat as error or completion with result. */
  cancelled?: boolean;
}

type PollOutcome = 'running' | 'completed' | 'failed';

/**
 * Apply one `/thinking` or `/job/:id/final` payload to the store. When `done` is
 * true, completion is handled first so a persisted snapshot with `nextSince: 0`
 * cannot rewind the client's token cursor.
 */
function applyThinkingPollResponse(jobId: string, t: ThinkingResponse): PollOutcome {
  const job = useTerminalStore.getState().strategistJobs[jobId];
  if (!job || job.status !== 'running') return 'completed';

  if (t.done) {
    if (t.cancelled) {
      if (job) useTerminalStore.getState().cancelStrategistJob(jobId);
      return 'completed';
    }
    if (t.status) {
      useTerminalStore.getState().setStrategistLiveStatus(jobId, t.status);
    }
    if (t.kind === 'validation' || t.validationMeta) {
      useTerminalStore.getState().setStrategistJobMeta(jobId, {
        kind: t.kind,
        validationMeta: t.validationMeta ?? undefined,
      });
    }
    if (Array.isArray(t.transcript)) {
      useTerminalStore.getState().setStrategistTranscript(jobId, t.transcript);
    }
    if (t.error) {
      useTerminalStore.getState().errorStrategistJob(jobId, t.error);
      return 'failed';
    }
    if (t.result) {
      useTerminalStore.getState().completeStrategistJob(jobId, t.result);
      return 'completed';
    }
    useTerminalStore
      .getState()
      .errorStrategistJob(jobId, 'Analysis completed without a result');
    return 'failed';
  }

  if (Array.isArray(t.tokens) && t.tokens.length > 0) {
    useTerminalStore
      .getState()
      .appendStrategistTokens(jobId, t.tokens, t.nextSince ?? job.nextSince);
  } else if (typeof t.nextSince === 'number' && t.nextSince !== job.nextSince) {
    useTerminalStore.getState().appendStrategistTokens(jobId, [], t.nextSince);
  }

  if (t.status) {
    useTerminalStore.getState().setStrategistLiveStatus(jobId, t.status);
  }

  if (t.kind === 'validation' || t.validationMeta) {
    useTerminalStore.getState().setStrategistJobMeta(jobId, {
      kind: t.kind,
      validationMeta: t.validationMeta ?? undefined,
    });
  }

  if (Array.isArray(t.transcript)) {
    useTerminalStore.getState().setStrategistTranscript(jobId, t.transcript);
  }

  return 'running';
}

const completionToastSent = new Set<string>();

function maybeToastForegroundRecovery(jobId: string) {
  if (completionToastSent.has(jobId)) return;
  const j = useTerminalStore.getState().strategistJobs[jobId];
  if (!j) return;
  completionToastSent.add(jobId);
  const ticker = j.ticker;
  if (j.status === "done") {
    if (j.kind === "validation") {
      const verdict = (j.result as { verdict?: string } | null)?.verdict;
      toast.success(`Validation ready — ${ticker}`, {
        description: verdict ? verdict.replace(/_/g, " ") : undefined,
      });
    } else {
      const status = (j.result as { status?: string } | null)?.status;
      toast.success(`Strategist — ${ticker}`, {
        description:
          status === "recommendation"
            ? "Analysis finished — open the Strategist tab for the card."
            : status === "ivr_populating"
              ? "IVR still loading — open the Strategist tab."
              : "Analysis finished.",
      });
    }
  } else if (j.status === "error") {
    toast.error(`Strategist — ${ticker}`, {
      description: j.error ?? "Something went wrong.",
    });
  }
}

async function refreshHistoryAfterCompletion() {
  try {
    const res = await fetchWithAuth(`${API_BASE}/strategist/history`);
    if (!res.ok) return;
    const rows = await res.json();
    if (Array.isArray(rows)) {
      useTerminalStore.getState().setStrategistHistory(rows);
    }
  } catch {
    // best-effort
  }
}

export function startStrategistPolling(jobId: string, opts?: { force?: boolean }): void {
  const existing = activePollers.get(jobId);
  if (existing && !existing.aborted) {
    const stale = Date.now() - existing.lastTickAt > STALE_POLLER_MS;
    if (!opts?.force && !stale) return;
    // Take over: signal the old poller to exit on its next iteration.
    existing.aborted = true;
  }

  const store = useTerminalStore.getState();
  const job = store.strategistJobs[jobId];
  if (!job) return;
  if (job.status !== "running") return;

  const handle: PollerHandle = { aborted: false, lastTickAt: Date.now() };
  activePollers.set(jobId, handle);

  // Grace window during which 404s from /thinking/:jobId are treated as
  // "server hasn't registered the job yet" rather than a real failure. This
  // covers the race where the reattach effect starts polling before the
  // POST /analyze response has been processed by the server.
  const NOT_READY_GRACE_MS = 90_000;
  const jobStartedAt = job.startedAt;

  void (async () => {
    // Debate mode with Opus 4.7 + adaptive thinking + web search across 6 turns
    // can run 15-25 min. Solo finishes in <2 min. Use a generous 30-min window
    // so polling doesn't time out mid-debate.
    const stopAt = Date.now() + 30 * 60 * 1000;
    let resolved = false;
    let consecutiveFailures = 0;

    // Try to recover a finished job whose in-memory thinking buffer was pruned
    // (server keeps it for 10 min after completion). If the persisted history
    // already has this jobId, treat it as completion instead of surfacing a
    // 404 to the user.
    const tryRecoverFromHistory = async (): Promise<boolean> => {
      try {
        const res = await fetchWithAuth(`${API_BASE}/strategist/history`);
        if (!res.ok) return false;
        const rows = await res.json();
        if (!Array.isArray(rows)) return false;
        useTerminalStore.getState().setStrategistHistory(rows);
        const row = rows.find(
          (r) => r && typeof r === "object" && (r as { jobId?: string }).jobId === jobId,
        );
        if (row && (row as { cardJson?: unknown }).cardJson) {
          useTerminalStore
            .getState()
            .completeStrategistJob(jobId, (row as { cardJson: unknown }).cardJson);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };
    try {
      while (Date.now() < stopAt) {
        if (handle.aborted) {
          // Another poller has taken over; exit silently without touching
          // the registry (the new poller now owns the entry).
          return;
        }
        handle.lastTickAt = Date.now();

        const current = useTerminalStore.getState().strategistJobs[jobId];
        if (!current || current.status !== "running") {
          resolved = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1200));
        if (handle.aborted) return;

        let tres: Response;
        try {
          tres = await fetchWithAuth(
            `${API_BASE}/strategist/thinking/${jobId}?since=${current.nextSince}`,
          );
        } catch {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 10) {
            useTerminalStore
              .getState()
              .errorStrategistJob(jobId, "Lost connection while polling analysis");
            resolved = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        if (handle.aborted) return;

        if (!tres.ok) {
          // 404 right after a job is registered just means the server hasn't
          // accepted the POST /analyze yet. Don't count it against the
          // failure budget while we're still inside the grace window.
          const inGrace = Date.now() - jobStartedAt < NOT_READY_GRACE_MS;
          if (tres.status === 404 && inGrace) {
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          // 404: in-memory buffer may be pruned after tab sleep. Reconcile from
          // persisted history (full run state is keyed by jobId in the DB).
          if (tres.status === 404) {
            try {
              const finalRes = await fetchWithAuth(
                `${API_BASE}/strategist/job/${encodeURIComponent(jobId)}/final?since=${current.nextSince}`,
              );
              if (finalRes.ok) {
                const t = (await finalRes.json()) as ThinkingResponse;
                const outcome = applyThinkingPollResponse(jobId, t);
                if (outcome !== "running") {
                  resolved = true;
                  await refreshHistoryAfterCompletion();
                  break;
                }
                consecutiveFailures = 0;
                await new Promise((r) => setTimeout(r, 1200));
                continue;
              }
            } catch {
              // fall through to history recovery
            }
            const recovered = await tryRecoverFromHistory();
            if (recovered) {
              resolved = true;
              break;
            }
          }
          consecutiveFailures += 1;
          if (consecutiveFailures >= 10) {
            const finalMsg =
              tres.status === 404
                ? "Live thinking buffer expired — refresh history to view the saved card"
                : `Polling failed (HTTP ${tres.status})`;
            useTerminalStore.getState().errorStrategistJob(jobId, finalMsg);
            resolved = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        consecutiveFailures = 0;
        const t = (await tres.json()) as ThinkingResponse;
        const outcome = applyThinkingPollResponse(jobId, t);
        if (outcome !== "running") {
          resolved = true;
          await refreshHistoryAfterCompletion();
          break;
        }
      }
      if (!resolved && !handle.aborted) {
        useTerminalStore
          .getState()
          .errorStrategistJob(
            jobId,
            "Analysis timed out after 30 minutes (no server response)",
          );
      }
    } finally {
      // Only clear the registry slot if we still own it. If a takeover poller
      // already replaced us in activePollers, leave their entry alone.
      const owner = activePollers.get(jobId);
      if (owner === handle) activePollers.delete(jobId);
    }
  })();
}

/** Reconciles running jobs after tab resume via `GET /strategist/job/:id/final` (not SSE). */
export async function syncRunningStrategistJobsFromServer(opts?: {
  toastOnComplete?: boolean;
}): Promise<void> {
  const jobs = useTerminalStore.getState().strategistJobs;
  for (const [jobId, job] of Object.entries(jobs)) {
    if (job.status !== "running") continue;
    try {
      const res = await fetchWithAuth(
        `${API_BASE}/strategist/job/${encodeURIComponent(jobId)}/final?since=${job.nextSince}`,
      );
      if (!res.ok) continue;
      const t = (await res.json()) as ThinkingResponse;
      const outcome = applyThinkingPollResponse(jobId, t);
      if (outcome !== "running") {
        await refreshHistoryAfterCompletion();
        if (opts?.toastOnComplete) {
          maybeToastForegroundRecovery(jobId);
        }
      }
    } catch {
      // best-effort
    }
  }
}

export function isPollerActive(jobId: string): boolean {
  const h = activePollers.get(jobId);
  return !!h && !h.aborted;
}

/** Stop polling for a job (e.g. user cancelled). */
export function abortStrategistPolling(jobId: string): void {
  const h = activePollers.get(jobId);
  if (h) h.aborted = true;
  activePollers.delete(jobId);
}

/**
 * Force-resume polling for every job currently in the "running" state.
 * Call this on `visibilitychange → visible` and on component remount so a
 * mobile-throttled poller is replaced with a fresh one instead of waiting
 * for the throttled setTimeout chain to catch up.
 *
 * First reconciles each running job against persisted server state so a
 * backgrounded tab that missed the final `/thinking` poll still completes.
 */
export function resumeAllRunningPollers(): void {
  void (async () => {
    await syncRunningStrategistJobsFromServer({ toastOnComplete: true });
    const jobs = useTerminalStore.getState().strategistJobs;
    for (const [jobId, job] of Object.entries(jobs)) {
      if (job.status === "running") {
        startStrategistPolling(jobId, { force: true });
      }
    }
  })();
}
