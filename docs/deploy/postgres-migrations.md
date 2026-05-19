# Postgres schema migrations

Runtime telemetry logs read from `telemetry_events`. Migration **0031** adds a `service` column for filtering server vs browser rows.

## Automatic fix (no shell commands)

On startup the API runs **`ensureTelemetryEventsServiceColumn`** (backend module `ensureTelemetryEventsSchema.ts`). It executes the same **`IF NOT EXISTS`** `ALTER TABLE` and index as migration 0031. If your Postgres role can alter the app’s tables (typical when the database user owns that schema), **you do not need to run `pnpm db:migrate` by hand** for this column: redeploy or restart the backend and open Telemetry → Logs again.

If self-healing logs a warning (permissions, read-only user), use the manual steps below.

## Recommended hosted deploy

1. **Provision Postgres** and copy the **internal** connection URL (TLS where required).
2. Set **`DATABASE_URL`** on the **same process** that runs the Node backend.

3. **Start command:** keep the default **`CMD`** from the root Dockerfile (`/app/start.sh`) or `railway.toml` **`startCommand`** (same path). That runs `artifacts/api-server` **`pnpm run migrate:deploy`** (programmatic Drizzle migrator over `lib/db/drizzle`), then starts the compiled server. Do **not** override the start command to only `node dist/index.mjs` — new tables (e.g. `chat_threads` / `chat_messages` from migration 0034) will be missing and chat will 500.

4. **Redeploy** after changing `DATABASE_URL` or pulling migrations.

## Run migrations manually

From your laptop or a shell that can reach Postgres, repository root:

```bash
export DATABASE_URL='postgresql://…'
pnpm db:migrate
```

This runs the same migrator as production `migrate:deploy` / `start.sh`. Requires `pnpm install` at repo root first.

From the api-server package:

```bash
export DATABASE_URL='postgresql://…'
pnpm --filter @workspace/[REDACTED] run migrate:deploy
```

## Alternate workspace script

```bash
pnpm --filter @workspace/db run migrate
```

Uses `lib/db/src/migrate.ts` — applies the same SQL folder idempotently.

## Troubleshooting

- **`DATABASE_URL` unset:** `drizzle.config.ts` throws at migrate time — fix env before deploy.
- **Wrong database:** Pointing the backend at an empty or legacy Postgres instance yields missing tables or columns; align `DATABASE_URL` with the database you intend to use for production.
- **Logs error after deploy:** Restart the backend so self-healing runs; if it still fails, run `pnpm db:migrate` once against the URL your backend uses.
