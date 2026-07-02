#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs workspace dependencies, and when the cloud environment provides
# live-data credentials (Environment variables in "Update cloud environment"),
# boots the api-server in the background so sessions can test against real
# quotes/portfolio data instead of empty panels.
set -euo pipefail

# Local (CLI) sessions manage their own dev servers — web containers only.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Idempotent; the container cache makes warm starts fast.
pnpm install

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[session-start] No DATABASE_URL in the environment — frontend-only mode (API-backed panels render empty)."
  exit 0
fi

echo "[session-start] DATABASE_URL present — building api-server for live data…"
if ! (cd artifacts/api-server && pnpm run build); then
  echo "[session-start] api-server build failed — continuing without live data."
  exit 0
fi

# Start directly (skips migrate:deploy on purpose: a feature branch must not
# auto-apply new migrations to a shared database; run them deliberately).
mkdir -p /tmp/alpha-terminal
(
  cd artifacts/api-server
  # 8080 is where the frontend dev proxy (vite.config.ts) expects the API.
  # HOST=0.0.0.0: the server defaults to "::" for Railway's IPv6 networking,
  # but Claude Code web containers are IPv4-only (":: " throws EAFNOSUPPORT).
  PORT="${PORT:-8080}" HOST="${HOST:-0.0.0.0}" \
    nohup node --enable-source-maps --max-http-header-size=65536 dist/index.mjs \
    > /tmp/alpha-terminal/api-server.log 2>&1 &
)

# Give it a moment, then report status without failing the session on error.
sleep 3
if curl -sf -o /dev/null "http://localhost:8080/api/auth/status"; then
  echo "[session-start] api-server is up on :8080 (logs: /tmp/alpha-terminal/api-server.log)."
else
  echo "[session-start] api-server did not answer yet — check /tmp/alpha-terminal/api-server.log."
fi
