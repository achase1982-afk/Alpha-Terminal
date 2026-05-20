#!/bin/sh
# Pre-start schema migration hook for Railway deploys.
#
# Runs Drizzle migrations against the production DATABASE_URL before the
# server process starts. Any pending SQL files in lib/db/drizzle/ are
# applied in order. Already-applied migrations are skipped (idempotent).
#
# If migration fails the container exits with a non-zero code so Railway
# marks the deploy as failed rather than starting a server with an out-of-
# sync schema.
set -e

# Railway startCommand (/bin/sh /app/start.sh) does not inherit Dockerfile WORKDIR.
# Must cd into artifacts/api-server (matches Dockerfile WORKDIR).
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="${ROOT_DIR}/artifacts/api-server"

if [ ! -f "${SERVER_DIR}/package.json" ]; then
  echo "[start.sh] ERROR: api-server package missing at ${SERVER_DIR}" >&2
  echo "[start.sh] artifacts listing:" >&2
  ls -la "${ROOT_DIR}/artifacts" 2>&1 >&2 || true
  exit 1
fi

echo "[start.sh] Running database migrations in ${SERVER_DIR}..."
cd "${SERVER_DIR}"
# Same as package.json "migrate:deploy"; call node directly so pnpm cannot read root package.json.
node ./scripts/migrate-deploy.mjs

echo "[start.sh] Migrations complete. Starting server..."
exec node --enable-source-maps --max-http-header-size=65536 dist/index.mjs
