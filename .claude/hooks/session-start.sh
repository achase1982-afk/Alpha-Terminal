#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs workspace dependencies, and when the cloud environment provides
# live-data credentials (Environment variables in "Update cloud environment"),
# boots the api-server in the background so sessions can test against real
# data instead of empty panels.
#
# Database note: the sandbox egress proxy only passes TLS-shaped traffic, so
# raw Postgres connections to external hosts (e.g. Railway's TCP proxy) hang
# at the protocol preamble and can never work from here. When the provided
# DATABASE_URL is unreachable, this hook falls back to a local Postgres 16
# with migrations applied — schema-complete, empty of account data. HTTPS
# market-data APIs (FMP/Polygon/Schwab endpoints) still work either way.
set -euo pipefail

# Local (CLI) sessions manage their own dev servers — web containers only.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Async: the session starts immediately while this finishes in the background.
echo '{"async": true, "asyncTimeout": 600000}'

# SessionStart also fires on resume/compact — if the server is already live,
# there is nothing to do (and a second start would EADDRINUSE-crash-loop).
if curl -sf -o /dev/null "http://localhost:8080/api/auth/status"; then
  echo "[session-start] api-server already live on :8080 — nothing to do."
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Idempotent; the container cache makes warm starts fast.
pnpm install

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[session-start] No DATABASE_URL in the environment — frontend-only mode (API-backed panels render empty)."
  exit 0
fi

reachable_db() {
  # Run from api-server so `pg` resolves from its node_modules.
  (cd artifacts/api-server && timeout 8 node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 6000 });
    c.connect().then(() => c.query('select 1')).then(() => process.exit(0)).catch(() => process.exit(1));
  " >/dev/null 2>&1)
}

start_local_postgres() {
  local PGBIN=/usr/lib/postgresql/16/bin
  local PGDATA=/var/lib/postgresql/claude-data16
  if [ ! -x "$PGBIN/pg_ctl" ]; then
    echo "[session-start] Postgres 16 binaries not found — cannot start local fallback DB."
    return 1
  fi
  # PG_VERSION marks a completed initdb; anything else is a broken partial
  # init (e.g. an interrupted previous session) — wipe and redo.
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    rm -rf "$PGDATA"
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA"
    su postgres -c "$PGBIN/initdb -D $PGDATA -U alpha --auth=trust" >/dev/null
  fi
  if ! su postgres -c "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
    # Log lives in postgres's own home — /tmp/alpha-terminal is root-owned.
    su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /var/lib/postgresql/claude-postgres.log -o '-p 5433 -k /tmp' start" >/dev/null
  fi
  sleep 1
  su postgres -c "$PGBIN/createdb -h /tmp -p 5433 -U alpha alphaterm" 2>/dev/null || true
  export DATABASE_URL="postgres://alpha@localhost:5433/alphaterm"
  # Local throwaway DB: applying migrations here is always safe.
  (cd artifacts/api-server && node ./scripts/migrate-deploy.mjs) >/dev/null
}

mkdir -p /tmp/alpha-terminal

if reachable_db; then
  echo "[session-start] DATABASE_URL is reachable — using it."
else
  echo "[session-start] DATABASE_URL is NOT reachable from this sandbox (raw Postgres traffic cannot cross the egress proxy)."
  echo "[session-start] Falling back to a local Postgres with migrations applied (schema-complete, no account data)."
  if ! start_local_postgres; then
    echo "[session-start] Local Postgres fallback failed — continuing frontend-only."
    exit 0
  fi
fi

# Persist the effective DATABASE_URL for the session (psql, scripts, tests).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export DATABASE_URL=\"$DATABASE_URL\"" >> "$CLAUDE_ENV_FILE"
fi

echo "[session-start] Building api-server…"
if ! (cd artifacts/api-server && pnpm run build); then
  echo "[session-start] api-server build failed — continuing without live data."
  exit 0
fi

# Watchdog keeps the server always live: if it crashes mid-session it
# restarts after 3s. Runs the server directly (skips migrate:deploy for
# remote DBs on purpose: a feature branch must not auto-apply new
# migrations to a shared database).
# 8080 is where the frontend dev proxy (vite.config.ts) expects the API.
# HOST=0.0.0.0: the server defaults to "::" for Railway's IPv6 networking,
# but Claude Code web containers are IPv4-only ("::" throws EAFNOSUPPORT).
pkill -f alpha-api-watchdog 2>/dev/null || true
(
  cd artifacts/api-server
  PORT="${PORT:-8080}" HOST="${HOST:-0.0.0.0}" DATABASE_URL="$DATABASE_URL" \
    nohup bash -c 'exec -a alpha-api-watchdog bash -c "
      while true; do
        node --enable-source-maps --max-http-header-size=65536 dist/index.mjs >> /tmp/alpha-terminal/api-server.log 2>&1
        echo \"[watchdog] api-server exited (\$?) — restarting in 3s\" >> /tmp/alpha-terminal/api-server.log
        sleep 3
      done"' > /dev/null 2>&1 &
)

# Give it a moment, then report status without failing the session on error.
for _ in 1 2 3 4 5 6; do
  sleep 2
  if curl -sf -o /dev/null "http://localhost:8080/api/auth/status"; then
    echo "[session-start] api-server is up on :8080 (logs: /tmp/alpha-terminal/api-server.log)."
    exit 0
  fi
done
echo "[session-start] api-server did not answer yet — check /tmp/alpha-terminal/api-server.log."
