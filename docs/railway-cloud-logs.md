# Railway logs from Cursor Cloud

This repository includes `@railway/cli` and a small wrapper for Cursor Cloud agents:

```bash
pnpm railway:logs
```

The command can read recent Railway logs when the cloud environment has the
following secrets/environment variables:

```bash
RAILWAY_TOKEN=...
RAILWAY_SERVICE=...        # service name or id, for example api-server
RAILWAY_ENVIRONMENT=...    # optional, for example production
RAILWAY_DEPLOYMENT_ID=...  # optional deployment id for a specific deploy
RAILWAY_LOG_LINES=300      # optional, fetches historical logs instead of streaming
```

Do not commit `RAILWAY_TOKEN` or place it in an `.env` file tracked by git. Add it
as a Cursor Cloud environment secret so agents can use it without exposing it in
the repository.

Useful examples:

```bash
pnpm railway:logs
pnpm railway:logs -- --lines 300
pnpm railway:logs -- --since 10m
pnpm railway:logs -- --filter "optionQuote"
pnpm railway:logs -- --service api-server --environment production
pnpm railway:logs -- --deployment <deployment-id>
```

The wrapper executes `pnpm exec railway logs` and forwards any additional CLI
arguments after `--`.
