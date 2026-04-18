import { useTerminalStore, type StrategistTranscriptTurn } from "./store";
import { fetchWithAuth } from "./fetchWithAuth";

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
          // 404 outside grace = the in-memory thinking buffer was pruned (10-min
          // TTL after completion) or the API server restarted mid-debate. If
          // the persisted history already has a card for this jobId, complete
          // from there instead of surfacing a polling error.
          if (tres.status === 404) {
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

        if (Array.isArray(t.tokens) && t.tokens.length > 0) {
          useTerminalStore
            .getState()
            .appendStrategistTokens(jobId, t.tokens, t.nextSince ?? current.nextSince);
        } else if (typeof t.nextSince === "number" && t.nextSince !== current.nextSince) {
          useTerminalStore.getState().appendStrategistTokens(jobId, [], t.nextSince);
        }

        if (t.status) {
          useTerminalStore.getState().setStrategistLiveStatus(jobId, t.status);
        }

        if (Array.isArray(t.transcript)) {
          useTerminalStore.getState().setStrategistTranscript(jobId, t.transcript);
        }

        if (t.done) {
          resolved = true;
          if (t.error) {
            useTerminalStore.getState().errorStrategistJob(jobId, t.error);
          } else if (t.result) {
            useTerminalStore.getState().completeStrategistJob(jobId, t.result);
          } else {
            useTerminalStore
              .getState()
              .errorStrategistJob(jobId, "Analysis completed without a result");
          }
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

export function isPollerActive(jobId: string): boolean {
  const h = activePollers.get(jobId);
  return !!h && !h.aborted;
}

/**
 * Force-resume polling for every job currently in the "running" state.
 * Call this on `visibilitychange → visible` and on component remount so a
 * mobile-throttled poller is replaced with a fresh one instead of waiting
 * for the throttled setTimeout chain to catch up.
 */
export function resumeAllRunningPollers(): void {
  const jobs = useTerminalStore.getState().strategistJobs;
  for (const [jobId, job] of Object.entries(jobs)) {
    if (job.status === "running") {
      startStrategistPolling(jobId, { force: true });
    }
  }
}
