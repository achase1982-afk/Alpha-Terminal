# Verify scanner V3 universe telemetry

## What this confirms

The scanner Layer 1 endpoint `GET /api/scanner/v3/universe` emits in-process telemetry via `emitTelemetry()` into a process-local ring buffer (max 2000 entries). Those events are **not** written to PostgreSQL; clients read them via **`GET /api/telemetry`** with optional query filters.

The verification script calls that HTTP API and lists **`scanner_v3_universe_returned`** and **`scanner_v3_universe_failed`** rows from the last hour (`system=SCANNER`). It prints:

- Event name (`message` field — matches the spec event name)
- `duration_ms` and `count` from `details` (success), or `error_class` (failure)

## Invoke locally against production

Replace the host and paste a valid `Authorization` value for your environment (same session you use for the app, unless the API runs with `DEV_BYPASS_AUTH=true`).

```bash
cd /path/to/repo && API_URL="https://<your-api-host>" AUTHORIZATION="Bearer <your-token>" pnpm exec tsx scripts/src/verify-scanner-v3-telemetry.ts
```

Local API without auth (`DEV_BYPASS_AUTH=true`):

```bash
cd /path/to/repo && API_URL="http://127.0.0.1:8080" pnpm exec tsx scripts/src/verify-scanner-v3-telemetry.ts
```

## Healthy result shape

After several **Scan** taps on Layer 1 (universe only), you should see lines like:

- `scanner_v3_universe_returned` with **`count=130`** (Liquid Core 130)
- **`duration_ms`** typically small (single-digit to low tens of ms for static universe)

Example line format:

```text
2026-05-05T12:00:00.000Z	scanner_v3_universe_returned	duration_ms=8	count_or_error=130	severity=INFO
```

## Failed / empty result

- **No rows in the last hour** — the API process may have restarted (the sink is in-memory), telemetry emission failed (check server logs for `scanner_v3_* telemetry emit failed`), or you are querying the wrong host / missing auth so `/api/telemetry` did not return SCANNER events from this instance.

- **HTTP 401 from `/api/telemetry`** — provide `AUTHORIZATION` or run against an instance with dev auth bypass for tests.

There is **no SQL table** for these events; do not query Postgres for `scanner_v3_*` unless a separate pipeline is added later.
