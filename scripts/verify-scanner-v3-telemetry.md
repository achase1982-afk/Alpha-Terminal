# Verify scanner V3 universe telemetry

## What this confirms

The scanner Layer 1 endpoint `GET /api/scanner/v3/universe` calls `emitTelemetry()`, which:

1. Pushes to the **in-memory ring buffer** (used by **`GET /api/telemetry`** — unchanged).
2. Appends a row to **`telemetry_events`** in Postgres (durable across deploys, restarts, and multi-instance).

This script reads **`telemetry_events`** so you can confirm events **survive deploys** and are not limited to the current process.

It lists **`scanner_v3_*`** rows from the last hour with columns: **timestamp** (`emitted_at`), **message** (event name), **level**, **`details->>'duration_ms'`**, **`details->>'count'`**.

## Invoke locally (production DB)

Export **`DATABASE_URL`** with the same Postgres URL the backend process uses (see your hosting provider’s env config).

```bash
cd /path/to/repo && DATABASE_URL="postgresql://..." pnpm exec tsx scripts/src/verify-scanner-v3-telemetry.ts
```

After **`pnpm install`** at the repo root (the scripts package depends on `pg`).

## Healthy result shape

After several **Scan** taps on Layer 1:

- Rows with **`scanner_v3_universe_returned`**, **`count`** ≈ **130**, **`duration_ms`** in the low tens of ms for static LC130.
- After a **platform redeploy**, **older rows still appear** when you widen the time window or query directly — proof of durability vs the ring buffer.

Example line (tab-separated):

```text
2026-05-05T12:00:00.000Z	scanner_v3_universe_returned	INFO	12	130
```

Columns: `emitted_at`, `message`, `level`, `duration_ms`, `count`.

## Failed / empty result

- **No rows** for recent scans — handler not emitting, wrong database, migration **`0025_telemetry_events`** not applied, or **`emitTelemetry`** DB insert failing (check logs for **`emitTelemetry: telemetry_events insert failed`**).

- **`DATABASE_URL` unset** — the script exits with an error.

Optional sanity check:

```sql
SELECT count(*) FROM telemetry_events WHERE message = 'scanner_v3_universe_returned';
```
