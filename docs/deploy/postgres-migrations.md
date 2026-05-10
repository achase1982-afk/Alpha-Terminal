# Postgres schema migrations

Runtime telemetry logs (`telemetry_events`, including the `service` column added in migration **0031**) require your Railway Postgres schema to match this repository. The backend applies migrations **before** the HTTP server starts when you use the shipped container entrypoint.

## Recommended Railway layout

1. **Provision Postgres** in Railway and copy the **internal** connection URL (TLS-aware).
2. Set **`DATABASE_URL`** on the **same service** that runs the Node backend.

3. **Start command:** keep the default **`CMD`** from the root Dockerfile (`/app/start.sh`). That script runs Drizzle migrations under `lib/db`, then starts the compiled server. If you override the start command to only run `node …` without migrating first, new columns (such as `telemetry_events.service`) will never appear and the Logs UI will fail with a database error.

4. **Redeploy** after changing `DATABASE_URL` or pulling migrations.

## Run migrations manually

From your laptop or a Railway shell (with network access to Postgres), repository root:

```bash
export DATABASE_URL='postgresql://…'
pnpm db:migrate
```

This runs the same `drizzle-kit migrate` step as `start.sh`. Requires `pnpm install` at repo root first.

## Alternate workspace script

```bash
pnpm --filter @workspace/db run migrate
```

Uses `lib/db/src/migrate.ts` — applies the same SQL folder idempotently.

## Troubleshooting

- **`DATABASE_URL` unset:** `drizzle.config.ts` throws at migrate time — fix env on the service before deploy.
- **Wrong database:** Pointing the backend at an empty or legacy Postgres instance yields missing tables/columns; align `DATABASE_URL` with the database you intend to use for production.
- **502 / Logs error after deploy:** Run `pnpm db:migrate` once against the URL your backend uses, then redeploy so the app and schema stay paired.
