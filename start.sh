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

# Railway startCommand (/bin/sh /app/start.sh) does not always inherit Dockerfile WORKDIR.
# migrate:deploy lives in artifacts/api-server/package.json, not the workspace root.
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="${ROOT_DIR}/artifacts/api-server"

echo "[start.sh] Running database migrations in ${SERVER_DIR}..."
# Same step as api-server `pnpm run migrate:deploy` (drizzle-orm migrator, lib/db/drizzle).
# Requires DATABASE_URL. Non-zero exit aborts the deploy.
cd "${SERVER_DIR}" && pnpm run migrate:deploy

echo "[start.sh] Migrations complete. Starting server..."
cd "${SERVER_DIR}"
exec node --enable-source-maps --max-http-header-size=65536 dist/index.mjs
