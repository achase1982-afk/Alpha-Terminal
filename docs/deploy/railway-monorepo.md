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

## UI loads but no data (empty quotes, “Loading news…”)

The app calls `/api/*` on the **alpha-terminal** host; nginx proxies those to the **api-server** using `API_BACKEND`. If the backend port is wrong (frontend defaults to **8080**, Railway often assigns a random **5xxx** port), every API call fails and the UI looks empty.

### Fix (pick one) — Railway → **alpha-terminal** → **Variables**

Use the exact **api-server** service name from your project canvas (replace `api-server` below if yours differs):

| Variable | Value |
|----------|--------|
| `API_SERVER_PORT` | `${{api-server.PORT}}` |

Or set a full URL:

| Variable | Value |
|----------|--------|
| `API_BACKEND` | `http://${{api-server.RAILWAY_PRIVATE_DOMAIN}}:${{api-server.PORT}}` |

Or use the public backend URL (no port):

| Variable | Value |
|----------|--------|
| `API_BACKEND` | `https://${{api-server.RAILWAY_PUBLIC_DOMAIN}}` |

### Alternative — Railway → **api-server** → **Variables**

| Variable | Value |
|----------|--------|
| `PORT` | `8080` |

Redeploy **api-server**, then **alpha-terminal**. The frontend default `api-server.railway.internal:8080` will then match.

### Verify

In **alpha-terminal** deploy logs after restart:

- `[probe] TCP OK` or `discovered backend at .../api/healthz`
- Not `[probe] TCP FAIL` or the port-8080 warning

In the browser (while logged in), open DevTools → Network → reload → `/api/market/quote` or `/api/market/news` should be **200**, not 502/504.
