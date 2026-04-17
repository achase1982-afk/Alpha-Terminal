import { useTerminalStore } from "./store";
import { fetchWithAuth } from "./fetchWithAuth";

const API_BASE = "/api";

const activePollers = new Set<string>();

interface ThinkingResponse {
  status: string;
  tokens: string[];
  nextSince: number;
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

export function startStrategistPolling(jobId: string): void {
  if (activePollers.has(jobId)) return;
  activePollers.add(jobId);

  const store = useTerminalStore.getState();
  const job = store.strategistJobs[jobId];
  if (!job) {
    activePollers.delete(jobId);
    return;
  }
  if (job.status !== "running") {
    activePollers.delete(jobId);
    return;
  }

  // Grace window during which 404s from /thinking/:jobId are treated as
  // "server hasn't registered the job yet" rather than a real failure. This
  // covers the race where the reattach effect starts polling before the
  // POST /analyze response has been processed by the server.
  const NOT_READY_GRACE_MS = 90_000;
  const jobStartedAt = job.startedAt;

  void (async () => {
    const stopAt = Date.now() + 5 * 60 * 1000;
    let resolved = false;
    let consecutiveFailures = 0;
    try {
      while (Date.now() < stopAt) {
        const current = useTerminalStore.getState().strategistJobs[jobId];
        if (!current || current.status !== "running") {
          resolved = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1200));
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
        if (!tres.ok) {
          // 404 right after a job is registered just means the server hasn't
          // accepted the POST /analyze yet. Don't count it against the
          // failure budget while we're still inside the grace window.
          const inGrace = Date.now() - jobStartedAt < NOT_READY_GRACE_MS;
          if (tres.status === 404 && inGrace) {
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          consecutiveFailures += 1;
          if (consecutiveFailures >= 10) {
            useTerminalStore
              .getState()
              .errorStrategistJob(jobId, `Polling failed (HTTP ${tres.status})`);
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
      if (!resolved) {
        useTerminalStore
          .getState()
          .errorStrategistJob(
            jobId,
            "Analysis timed out after 5 minutes (no server response)",
          );
      }
    } finally {
      activePollers.delete(jobId);
    }
  })();
}

export function isPollerActive(jobId: string): boolean {
  return activePollers.has(jobId);
}
