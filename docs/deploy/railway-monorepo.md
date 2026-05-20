# Railway monorepo: api-server + alpha-terminal

`Cannot GET /` on the alpha-terminal URL means the container is running **Express (api-server)**, not nginx serving the Vite `dist/` build.

## Required: one config file per Railway service

This repo has **no** root `railway.toml`. Each service must point at its own config file (Settings → Config-as-code → **Railway config file**):

| Railway service   | Config file path                      | Dockerfile built                          |
|-------------------|---------------------------------------|-------------------------------------------|
| **api-server**    | `artifacts/api-server/railway.toml`   | `artifacts/api-server/Dockerfile`         |
| **alpha-terminal**| `artifacts/alpha-terminal/railway.toml` | `artifacts/alpha-terminal/Dockerfile` |

Leave **Root Directory** empty (repo root) so Docker `COPY . /app` sees the full monorepo.

## alpha-terminal checklist

1. **Config file**: `artifacts/alpha-terminal/railway.toml` (not the api-server path).
2. **Start command**: must be `/docker-entrypoint.sh` or empty so the dashboard does not keep `/bin/sh /app/start.sh`.
3. **Variables**: `CLERK_PUBLISHABLE_KEY` at build time (see root `railpack.toml`); optional `API_BACKEND` or `API_SERVER_HOST` + `API_SERVER_PORT` for `/api` proxying.
4. **Do not** set `DATABASE_URL` on alpha-terminal (backend only).
5. **Custom domain**: attach the public domain to the **alpha-terminal** service, not api-server.

## Verify a deploy

In the deployment build logs you should see:

- alpha-terminal: `load build definition from artifacts/alpha-terminal/Dockerfile`, then `runtime image populated OK`
- api-server: `load build definition from artifacts/api-server/Dockerfile`, then `[start.sh] Starting server...`

If alpha-terminal logs show `start.sh` or `node dist/index.mjs`, the wrong config file or start command is still active.
