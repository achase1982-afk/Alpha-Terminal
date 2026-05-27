# Alpha Terminal — Strategist V3 Architecture Spec

**Status:** Implemented on branch `cursor/strategist-v3-rebuild-3cd7`.  
**Replaces:** V2 in-process `strategistThinkingBuffer` + fire-and-forget Express async pattern.

> **Revision note:** The original spec called for a separate Railway service for the worker. That was overengineered for single-user scale and I/O-bound LLM work. The worker now runs as an in-process background task inside api-server (started when Express boots). All other V3 guarantees — durable jobs, single completion writer, checkpointing, push reliability, status bar, etc. — are unchanged.

Postgres-backed `strategist_jobs` is the lifecycle owner. The analyze/validate pipeline runs in api-server’s in-process worker (`src/strategistWorker/`). HTTP routes enqueue work and serve poll/history.

---

## 1. Non-negotiables

1. **Single source of truth:** `strategist_jobs` owns lifecycle.
2. **Declared completion:** `status = 'completed'` only in `persistAndComplete()` (`artifacts/api-server/src/lib/strategistV3/terminal.ts`).
3. **Client decides nothing:** no wall-clock timeouts; server poll payload is authoritative.
4. **API server owns enqueue + worker:** POST enqueue via HTTP; worker claim loop runs in the same Node process after `app.listen()`.
5. **Worker owns pipeline:** including IVR coordination (client never sees `ivr_populating`).
6. **Kill switch:** `STRATEGIST_V3_ENABLED=false` → `503 strategist_unavailable` (default `true`).

---

## 2. Key identifiers

| Field | Meaning |
|-------|---------|
| `strategist_jobs.id` | Client `jobId` (same as `strategist_history.job_id`) |
| `result_history_id` | FK → `strategist_history.id` (SERIAL) |
| `strategist_history` | Schema unchanged (no `user_id`, no top-level `kind`) |

User scoping for history reads joins `strategist_jobs.user_id` on `job_id`.

---

## 3. Implementation map

| Area | Path |
|------|------|
| DB migration | `lib/db/drizzle/0042_strategist_jobs.sql` |
| Drizzle schema | `lib/db/src/schema/index.ts` → `strategistJobsTable` |
| Enqueue + poll routes | `artifacts/api-server/src/routes/strategistCoreRoutes.ts` |
| V3 lib (jobs, poll, terminal) | `artifacts/api-server/src/lib/strategistV3/` |
| Worker (in-process) | `artifacts/api-server/src/strategistWorker/main.ts` |
| Boot hook | `artifacts/api-server/src/index.ts` → `startStrategistWorker()` + `startStrategistReaper()` after listen |
| Status bar UI | `artifacts/alpha-terminal/src/components/StrategistStatusBar.tsx` |
| Client poller | `artifacts/alpha-terminal/src/lib/strategistPoller.ts` |
| Background sync | `artifacts/alpha-terminal/src/components/StrategistJobBackgroundSync.tsx` |

---

## 4. HTTP contract (frozen)

Existing `/api/strategist/*` poll field names preserved: `serverProgressAt`, `done`, `cancelled`, `nextSince`, `tokens`, `transcript`, `result`, `validationMeta`, `source: "persisted"`.

**New:** `GET /api/strategist/jobs/active` — auth-scoped active + recently-terminal (60s) jobs.

**Cancel:**
- `POST /api/strategist/analyze/cancel` — analyze jobs only
- `POST /api/strategist/validate-trade/cancel` — validate_trade jobs only

**Enqueue:**
- `POST /api/strategist/analyze`
- `POST /api/strategist/validate-trade`

**Poll:** `GET /api/strategist/job/:jobId/final` and `GET /api/strategist/thinking/:jobId` (alias).

---

## 5. Job kinds and phases

| Kind | Worker entry | Phases |
|------|--------------|--------|
| `analyze` | `runAnalyzeJob` | `preparing_iv` → `analyzing` → (`debating` → `validating` if debate mode) → `persisting` |
| `validate_trade` | `runValidateJob` | validate pipeline → `persisting` |

`phase` column reflects live worker phase. `last_completed_phase` + `checkpoint` JSON enable crash recovery.

---

## 6. Worker analyze pipeline

### 6.1 preparing_iv

`ensureIvrReadyForWorker` blocks until IVR data is ready (worker-side; client never polls IVR backfill).

### 6.2 analyzing

Runs `analyzeTickerV2` inside `runInStrategistRunContext({ deferTelemetryUntilPersist: true, userId })`.

- **Solo / desk modes:** full result in checkpoint `analyzing.analyzeResult` + `telemetryCapture`.
- **Debate mode (`strategistMode === 2`):** `returnPreparedBeforeDebate` returns `WorkerPreparedPayload` in `analyzing.prepared`.

### 6.3 debating

`runDebateForWorker` → `runDebate` with `EXPECTED_TURNS = 7` LLM turns (`r1a`, `r1b`, `r2a`, `r2b`, `s3a`, `s3b`, `build`).

Checkpoints stored in `debating.resumeTurns`. Progress exposes `debateTurn` / `expectedTurns` on job `progress`.

### 6.4 validating

`analyzeTickerV2FinalizeAfterDebate` → `buildRecommendationFromAiState` (confidence gate through recommendation + deferred telemetry capture).

### 6.5 persisting

`persistAndComplete` only path that sets `status = 'completed'`.

---

## 7. Telemetry

During worker runs, `emitFullDiagnosticTelemetry` captures to `runContext.pendingTelemetryCapture` when `deferTelemetryUntilPersist: true`.

After history insert, `writeAnalyzeTelemetryPostCommit` persists telemetry (failure does not roll back completion). `telemetryId` may be patched onto `card_json` post-commit.

Runtime DDL for telemetry audit columns removed; use migrations `0032` / `0033`. Error helpers live in `strategistTelemetryErrors.ts`.

---

## 8. In-process worker and deployment

The worker runs as background tasks inside api-server, started when the Express server boots (`index.ts` after `app.listen()`):

- **`startStrategistWorker()`** — claim loop polls Postgres for `queued` jobs (concurrency cap 3, poll interval 1.5s, heartbeat every 10s).
- **`startStrategistReaper()`** — every 30s, requeue or fail jobs whose heartbeat is stale (>60s).

Both use the same Node.js process and Postgres connection pool as HTTP routes. **One Railway service** (api-server) — no separate worker service or dashboard setup.

**SIGTERM on redeploy:** set a `shuttingDown` flag so the claim loop stops pulling new work. In-flight jobs are not drained; they remain `running` with a stale heartbeat until the reaper requeues them after restart (checkpoint resume via `last_completed_phase`).

---

## 9. Terminal completion

`persistAndComplete`:

1. Guarded transaction: insert `strategist_history`, flip job to `completed`.
2. Post-commit telemetry write.
3. `verifyStrategistHistoryReadable(jobId)` (~500ms) before push.
4. `fireStrategistJobPush` with kind `analyze` | `validation` | `failure`.

`markJobFailed` sets `failed` and pushes kind `failure` (not `analyze_failed`).

---

## 10. Reaper

`runReaperStaleJobs` (60s heartbeat stale):

- `attempt < 3` and `last_completed_phase` set → requeue via `releaseJobForRetry`.
- Else → `markJobFailed` + push.

---

## 11. Client polling

`strategistPoller.ts` — no client-side timeouts. Poll `/strategist/thinking/:jobId?since=N` while running; `/final` for terminal state.

`StrategistJobBackgroundSync` reconciles on visibility/focus/push; toasts completion when tab was hidden.

---

## 12. Status bar

`StrategistStatusBar` polls `GET /jobs/active` every 3s. Debate phase shows `debating {turn}/{expectedTurns}` from job progress.

---

## 13. History API

`GET /api/strategist/history` — requires auth; inner join `strategist_jobs` on `job_id` filtered by `user_id`. Returns last 100 non-cleared rows.

---

## 14. Legacy `/ai/*` strategist routes

**Removed in this build.** Options/deterministic legacy strategist endpoints deleted from `routes/ai.ts`. UI uses V3 `/api/strategist/analyze` only. `deterministicStrategist.ts` retained for strike resolver types used elsewhere.

---

## 15. Push notifications

Push payload `data.kind`: `analyze` | `validation` | `failure`.

---

## 16. Failure modes

| Scenario | Behavior |
|----------|----------|
| Worker crash mid-phase | Reaper requeues if attempts remain + checkpoint; else failed + push |
| api-server SIGTERM mid-job | Job stays `running` until reaper requeues after restart |
| User cancel | `status = cancelled`; worker checks `isJobCancelled` between phases |
| Terminal race | `TerminalRaceError` if concurrent cancel completes first |
| Telemetry insert fail | Logged; job stays completed |
| History not readable pre-push | Warn log; push still fires |

---

## 17. Checkpoints schema (analyze)

```json
{
  "preparing_iv": { "ivrReady": true },
  "analyzing": { "prepared": { ... } } | { "analyzeResult": { ... }, "telemetryCapture": { ... } },
  "debating": { "debateResult": { ... }, "resumeTurns": { "r1a": "..." } },
  "validating": { "analyzeResult": { ... }, "telemetryCapture": { ... } }
}
```

---

## 18. Environment

| Variable | Default | Effect |
|----------|---------|--------|
| `STRATEGIST_V3_ENABLED` | `true` | `false` → analyze/validate enqueue 503 |
| `STRATEGIST_WORKER_CONCURRENCY` | `3` | Max in-flight jobs in claim loop |

---

## 19. CI / static checks

- `pnpm --filter @workspace/api-server typecheck`
- `pnpm --filter @workspace/alpha-terminal typecheck`
- `scripts/check-strategist-v3-static.sh` — single `completed` writer guard
- Vitest: `src/lib/strategistV3/__tests__`, debate resume, cancel/history route tests

---

## 20. Smoke tests (manual)

1. Enqueue analyze → status bar phases through debating turn counter → card in history.
2. Background tab → completion toast on return.
3. Cancel validate_trade mid-run.
4. History list only shows current user's jobs.
5. Force-restart api-server mid-job → reaper requeues within ~60s; job resumes from checkpoint.
6. Railway dashboard shows **one** api-server service (no separate worker).

---

## 21. Rollback

1. Revert merge → prior V2 path returns if still in tree.
2. Empty `strategist_jobs` harmless.
3. `STRATEGIST_V3_ENABLED=false` for emergency 503 while deploying revert.
