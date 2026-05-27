# Alpha Terminal — Strategist V3 Architecture Spec

**Status:** Design spec for agent implementation (single-PR ship model).  
**Branch:** `cursor/strategist-v3-rebuild-3cd7` (continues from Phase 1 foundation).

This document is the authoritative architecture spec for Strategist V3. Implementation replaces the V2 in-process `strategistThinkingBuffer` + fire-and-forget Express async pattern with Postgres-backed `strategist_jobs` and a dedicated `@workspace/strategist-worker` service.

## Summary of non-negotiables

1. **Single source of truth:** `strategist_jobs` owns lifecycle.
2. **Declared completion:** `status = 'completed'` only in `persistAndComplete()` guarded transaction.
3. **Client decides nothing:** no wall-clock timeouts; server poll payload is authoritative.
4. **API server stateless:** POST enqueue only; no in-memory job buffer.
5. **Worker owns pipeline:** including IVR coordination (client never sees `ivr_populating`).
6. **Kill switch:** `STRATEGIST_V3_ENABLED=false` → `503 strategist_unavailable` (default `true`).

## Key identifiers

- `strategist_jobs.id` = client `jobId` string (same as `strategist_history.job_id`).
- `result_history_id` = INT → `strategist_history.id` (SERIAL).
- `strategist_history` schema unchanged (no `user_id`, no top-level `kind`).

## Implementation map (this repo)

| Area | Path |
|------|------|
| DB migration | `lib/db/drizzle/0042_strategist_jobs.sql` |
| Drizzle schema | `lib/db/src/schema/index.ts` → `strategistJobsTable` |
| Enqueue + poll routes | `artifacts/api-server/src/routes/strategistCoreRoutes.ts` |
| V3 lib (jobs, poll, terminal) | `artifacts/api-server/src/lib/strategistV3/` |
| Worker entry | `artifacts/api-server/src/strategistWorker/main.ts` |
| Worker package (Railway) | `artifacts/strategist-worker/` |
| Status bar UI | `artifacts/alpha-terminal/src/components/StrategistStatusBar.tsx` |
| Client poller (no timeouts) | `artifacts/alpha-terminal/src/lib/strategistPoller.ts` |

## Frozen HTTP contract

Preserved per backend audit Section 10: all existing `/api/strategist/*` endpoints and poll payload field names (`serverProgressAt`, `done`, `cancelled`, `nextSince`, `tokens`, `transcript`, `result`, `validationMeta`, `source: "persisted"`).

New: `GET /api/strategist/jobs/active` — auth-scoped; active + recently-terminal (60s) jobs for status bar.

## Legacy `/ai/*` strategist routes

**Decision in this build:** **Leave unchanged** — `AiIntelligenceTab.tsx` still calls `/ai/options-strategist/stream` and `/ai/deterministic-strategist`. Follow-up PR may delete after UI migration.

## Rollback

1. Revert merge → V2 code returns (if revert includes pre-V3 commit).
2. `strategist_jobs` table may remain empty/unused — harmless.
3. Kill switch: `STRATEGIST_V3_ENABLED=false` → analyze returns 503 while revert deploys.

## Pre-merge CI

- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/strategist-worker run typecheck` (delegates to api-server)
- `scripts/check-strategist-v3-static.sh` — exactly one `status = 'completed'` writer
- Unit tests under `artifacts/api-server/src/lib/strategistV3/__tests__/`

For the full narrative spec (sections 1–20, failure modes, smoke tests, open decisions), see the architecture discussion in PR #530+ and the product owner handoff document in the issue thread.
