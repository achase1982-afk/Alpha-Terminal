import { useTerminalStore, type StrategistTranscriptTurn, type StrategistValidationMeta } from "./store";
import { fetchWithAuth, humanizeFailedApiBody } from "./fetchWithAuth";
import { toast } from "sonner";
import { deskRecommendationHasTrade, deskTradeStructureSentenceCase } from "./strategistDeskResult";

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
/** While a push/deep-link open is hydrating, block stale pollers from restarting. */
const pushOpenInFlight = new Set<string>();
const pushOpenPromiseByJobId = new Map<string, Promise<OpenStrategistFromPushResult>>();

export function isStrategistPushOpenInFlight(jobId: string): boolean {
  return pushOpenInFlight.has(jobId);
}

export type OpenStrategistFromPushResult =
  | { ok: true; ticker: string | null; jobId: string }
  | { ok: false; jobId: string; stillRunning: boolean };

// If an existing poller hasn't ticked in this long, a new caller takes over.
const STALE_POLLER_MS = 8_000;

/** One payload from `GET /strategist/thinking/:id` or `GET /strategist/job/:id/final`. */
export interface StrategistThinkingPollPayload {
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
  /** Server-side last in-job progress (ms); used for stall detection vs client wall clock. */
  serverProgressAt?: number;
}

type PollOutcome = 'running' | 'completed' | 'failed';

function recordServerProgressFromPoll(jobId: string, t: StrategistThinkingPollPayload) {
  const raw = t.serverProgressAt;
  const ts = typeof raw === "number" && Number.isFinite(raw) ? raw : Date.now();
  useTerminalStore.getState().touchStrategistServerProgress(jobId, ts);
}

/** Strip server-only conviction diagnostics so zustand persist (localStorage) does not choke on multi‑MB payloads. */
function stripConvictionDiagnosticsFromPollResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  const dr = r.deskResult as Record<string, unknown> | undefined;
  if (!dr || dr.mode !== "conviction_desk" || dr.convictionDeskRunDiagnostic == null) return result;
  const { convictionDeskRunDiagnostic: _omit, ...restDesk } = dr;
  return { ...r, deskResult: restDesk };
}

/**
 * Apply one `/thinking` or `/job/:id/final` payload to the store. When `done` is
 * true, completion is handled first so a persisted snapshot with `nextSince: 0`
 * cannot rewind the client's token cursor.
 *
 * Completion is applied even when the local job is `interrupted` or `error` so a
 * push deep-link or `/job/:id/final` reconcile can replace stale persisted state.
 * Incremental token/status updates are only applied while the job is `running`.
 */
export function applyThinkingPollResponse(jobId: string, t: StrategistThinkingPollPayload): PollOutcome {
  const job = useTerminalStore.getState().strategistJobs[jobId];

  if (t.done) {
    if (!job) return 'completed';
    if (t.cancelled) {
      useTerminalStore.getState().cancelStrategistJob(jobId);
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
      useTerminalStore.getState().completeStrategistJob(jobId, stripConvictionDiagnosticsFromPollResult(t.result));
      return 'completed';
    }
    useTerminalStore
      .getState()
      .errorStrategistJob(jobId, 'Analysis completed without a result');
    return 'failed';
  }

  if (!job || job.status !== 'running') return 'completed';

  recordServerProgressFromPoll(jobId, t);

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

async function recoverStrategistJobFromHistory(jobId: string): Promise<boolean> {
  try {
    const res = await fetchWithAuth(`${API_BASE}/strategist/history`);
    if (!res.ok) return false;
    const rows = await res.json();
    if (!Array.isArray(rows)) return false;
    useTerminalStore.getState().setStrategistHistory(rows);
    const row = rows.find(
      (r) => r && typeof r === "object" && (r as { jobId?: string }).jobId === jobId,
    );
    if (!row || !(row as { cardJson?: unknown }).cardJson) return false;

    const cardJson = (row as { cardJson: unknown }).cardJson;
    const ticker =
      typeof (row as { ticker?: string }).ticker === "string"
        ? (row as { ticker: string }).ticker.toUpperCase()
        : "";

    const existing = useTerminalStore.getState().strategistJobs[jobId];
    if (existing?.status === "done" && existing.result) {
      return true;
    }
    if (existing && existing.status !== "running") {
      useTerminalStore.getState().cancelStrategistJob(jobId);
    }
    if (!useTerminalStore.getState().strategistJobs[jobId]) {
      if (!ticker) return false;
      useTerminalStore.getState().startStrategistJob(jobId, ticker, { kind: "analyze" });
    }

    useTerminalStore
      .getState()
      .completeStrategistJob(jobId, stripConvictionDiagnosticsFromPollResult(cardJson));
    return useTerminalStore.getState().strategistJobs[jobId]?.status === "done";
  } catch {
    return false;
  }
}

function ensureStrategistJobSlotForFinal(
  jobId: string,
  t: StrategistThinkingPollPayload & { ticker?: string },
): boolean {
  const existing = useTerminalStore.getState().strategistJobs[jobId];
  if (existing?.status === "done" && existing.result) {
    return true;
  }
  if (existing && existing.status !== "running") {
    useTerminalStore.getState().cancelStrategistJob(jobId);
  }
  const ticker = typeof t.ticker === "string" && t.ticker.length > 0 ? t.ticker.toUpperCase() : "";
  if (!useTerminalStore.getState().strategistJobs[jobId]) {
    if (!ticker) return false;
    useTerminalStore.getState().startStrategistJob(jobId, ticker, {
      kind: t.kind === "validation" ? "validation" : "analyze",
      validationMeta: t.validationMeta ?? undefined,
    });
  }
  return true;
}

/**
 * Fetches persisted final state for a job (push deep-link / cold resume) and
 * applies it to the store. Creates a transient running slot when the job is
 * missing locally so `applyThinkingPollResponse` can complete it in one step.
 */
export async function hydrateStrategistJobFromPersistedFinal(jobId: string): Promise<boolean> {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/strategist/job/${encodeURIComponent(jobId)}/final?since=0`,
    );
    if (res.ok) {
      const t = (await res.json()) as StrategistThinkingPollPayload & { ticker?: string };
      if (t.done) {
        const existing = useTerminalStore.getState().strategistJobs[jobId];
        if (existing?.status === "done" && existing.result) {
          return true;
        }
        if (!ensureStrategistJobSlotForFinal(jobId, t)) {
          return recoverStrategistJobFromHistory(jobId);
        }
        const outcome = applyThinkingPollResponse(jobId, t);
        const after = useTerminalStore.getState().strategistJobs[jobId];
        if (outcome !== "running" && after?.status === "done") {
          return true;
        }
      }
    }
    return recoverStrategistJobFromHistory(jobId);
  } catch {
    return recoverStrategistJobFromHistory(jobId);
  }
}

async function recoverStrategistJobFromHistoryByTicker(ticker: string): Promise<string | null> {
  const upper = ticker.toUpperCase();
  try {
    const res = await fetchWithAuth(`${API_BASE}/strategist/history`);
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    useTerminalStore.getState().setStrategistHistory(rows);
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const row = r as { ticker?: string; jobId?: string; cardJson?: unknown };
      if (row.ticker?.toUpperCase() !== upper || !row.jobId || row.cardJson == null) continue;
      const ok = await recoverStrategistJobFromHistory(row.jobId);
      if (ok) return row.jobId;
    }
    return null;
  } catch {
    return null;
  }
}

async function openStrategistJobFromNotificationInner(
  jobId: string,
  opts?: { ticker?: string },
): Promise<OpenStrategistFromPushResult> {
  pushOpenInFlight.add(jobId);
  abortStrategistPolling(jobId);

  try {
    const hydrated = await hydrateStrategistJobFromPersistedFinal(jobId);
    if (hydrated) {
      const j = useTerminalStore.getState().strategistJobs[jobId];
      return { ok: true, ticker: j?.ticker ?? null, jobId };
    }

    const tickerHint = opts?.ticker?.toUpperCase();
    if (tickerHint) {
      const recoveredJobId = await recoverStrategistJobFromHistoryByTicker(tickerHint);
      if (recoveredJobId) {
        const j = useTerminalStore.getState().strategistJobs[recoveredJobId];
        return { ok: true, ticker: j?.ticker ?? tickerHint, jobId: recoveredJobId };
      }
    }

    const j = useTerminalStore.getState().strategistJobs[jobId];
    if (j?.status === "running") {
      startStrategistPolling(jobId, { force: true });
      return { ok: false, jobId, stillRunning: true };
    }

    return { ok: false, jobId, stillRunning: false };
  } finally {
    pushOpenInFlight.delete(jobId);
  }
}

export function openStrategistJobFromNotification(
  jobId: string,
  opts?: { ticker?: string },
): Promise<OpenStrategistFromPushResult> {
  const existing = pushOpenPromiseByJobId.get(jobId);
  if (existing) return existing;

  const promise = openStrategistJobFromNotificationInner(jobId, opts).finally(() => {
    pushOpenPromiseByJobId.delete(jobId);
  });
  pushOpenPromiseByJobId.set(jobId, promise);
  return promise;
}

/** Reconcile every in-flight job against persisted server/history (foreground push safety net). */
export async function reconcileRunningStrategistJobs(opts?: { toastOnComplete?: boolean }): Promise<void> {
  const jobs = useTerminalStore.getState().strategistJobs;
  for (const [jobId, job] of Object.entries(jobs)) {
    if (job.status !== "running" && job.status !== "interrupted") continue;
    if (pushOpenInFlight.has(jobId)) continue;
    const wasRunning = job.status === "running" || job.status === "interrupted";
    await hydrateStrategistJobFromPersistedFinal(jobId);
    const after = useTerminalStore.getState().strategistJobs[jobId];
    if (
      opts?.toastOnComplete &&
      wasRunning &&
      after?.status === "done" &&
      document.visibilityState === "hidden"
    ) {
      maybeToastForegroundRecovery(jobId);
    }
  }
}

export function toastStrategistJobCompletionIfReady(jobId: string): void {
  maybeToastForegroundRecovery(jobId);
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
      const raw = j.result as { status?: string; deskResult?: import("@/lib/strategistDeskResult").DeskResult | null } | null;
      const status = raw?.status;
      let description: string;
      if (status === "recommendation") {
        description = "Analysis finished — open the Strategist tab for the card.";
      } else if (status === "ivr_populating") {
        description = "IVR still loading — open the Strategist tab.";
      } else if (status === "desk_recommendation" && raw) {
        const hasTrade = deskRecommendationHasTrade(raw);
        const label = hasTrade ? deskTradeStructureSentenceCase(raw) : null;
        description = hasTrade
          ? label
            ? `${label} trade ready — open the Strategist tab for details.`
            : "Trade recommendation ready — open the Strategist tab for details."
          : "Analysis finished with no trade — open the Strategist tab for details.";
      } else {
        description = "Analysis finished.";
      }
      toast.success(`Strategist — ${ticker}`, {
        description,
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
  if (pushOpenInFlight.has(jobId)) return;

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
    let resolved = false;
    let consecutiveFailures = 0;

    // Try to recover a finished job whose in-memory thinking buffer was pruned
    // (server keeps it for 10 min after completion). If the persisted history
    // already has this jobId, treat it as completion instead of surfacing a
    // 404 to the user.
    const tryRecoverFromHistory = async (): Promise<boolean> => recoverStrategistJobFromHistory(jobId);
    try {
      pollLoop: while (true) {
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
          // Use `/final` (DB-first when a terminal card exists) so a backgrounded
          // tab that missed live `/thinking` polls still completes on resume.
          tres = await fetchWithAuth(
            `${API_BASE}/strategist/job/${encodeURIComponent(jobId)}/final?since=${current.nextSince}`,
          );
        } catch {
          consecutiveFailures += 1;
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        if (handle.aborted) return;

        if (!tres.ok) {
          if (tres.status === 401 || tres.status === 403) {
            const raw = await tres.text().catch(() => "");
            useTerminalStore
              .getState()
              .errorStrategistJob(jobId, humanizeFailedApiBody(tres.status, raw));
            resolved = true;
            break pollLoop;
          }
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
            let reconciledFromFinal = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const finalRes = await fetchWithAuth(
                  `${API_BASE}/strategist/job/${encodeURIComponent(jobId)}/final?since=${current.nextSince}`,
                );
                if (!finalRes.ok && (finalRes.status === 401 || finalRes.status === 403)) {
                  const raw = await finalRes.text().catch(() => "");
                  useTerminalStore
                    .getState()
                    .errorStrategistJob(jobId, humanizeFailedApiBody(finalRes.status, raw));
                  resolved = true;
                  break pollLoop;
                }
                if (finalRes.ok) {
                  const t = (await finalRes.json()) as StrategistThinkingPollPayload;
                  const outcome = applyThinkingPollResponse(jobId, t);
                  if (outcome !== "running") {
                    resolved = true;
                    await refreshHistoryAfterCompletion();
                    reconciledFromFinal = true;
                    break;
                  }
                  consecutiveFailures = 0;
                  await new Promise((r) => setTimeout(r, 1200));
                  reconciledFromFinal = true;
                  break;
                }
              } catch {
                /* try next attempt */
              }
              await new Promise((r) => setTimeout(r, 1500));
            }
            if (reconciledFromFinal) {
              continue;
            }
            const recovered = await tryRecoverFromHistory();
            if (recovered) {
              resolved = true;
              break;
            }
          }
          consecutiveFailures += 1;
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        consecutiveFailures = 0;
        const t = (await tres.json()) as StrategistThinkingPollPayload;
        const outcome = applyThinkingPollResponse(jobId, t);
        if (outcome !== "running") {
          resolved = true;
          await refreshHistoryAfterCompletion();
          maybeToastForegroundRecovery(jobId);
          break;
        }
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
    if (job.status !== "running" && job.status !== "interrupted") continue;
    try {
      const res = await fetchWithAuth(
        `${API_BASE}/strategist/job/${encodeURIComponent(jobId)}/final?since=${job.nextSince}`,
      );
      if (!res.ok) continue;
      const t = (await res.json()) as StrategistThinkingPollPayload;
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
export function resumeAllRunningPollers(opts?: {
  toastOnComplete?: boolean;
  /** When true (tab became visible), briefly show reconnecting UI while `/final` sync runs. */
  reconnectHint?: boolean;
}): void {
  void (async () => {
    const hint = opts?.reconnectHint === true;
    if (hint) {
      useTerminalStore.getState().setRunningStrategistResumeUi("reconnecting");
    }
    try {
      await syncRunningStrategistJobsFromServer({
        toastOnComplete: opts?.toastOnComplete ?? true,
      });
    } finally {
      if (hint) {
        useTerminalStore.getState().setRunningStrategistResumeUi("idle");
      }
    }
    const jobs = useTerminalStore.getState().strategistJobs;
    for (const [jobId, job] of Object.entries(jobs)) {
      if (job.status === "running" && !pushOpenInFlight.has(jobId)) {
        startStrategistPolling(jobId, { force: true });
      }
    }
  })();
}
