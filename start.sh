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

# Capture WORKDIR set by Dockerfile so we can return to it after migrating.
SERVER_DIR="$PWD"

echo "[start.sh] Running database migrations..."
# Run from the monorepo root so pnpm resolves the workspace toolchain (tsx) and
# @workspace/db the same way as local `pnpm --filter @workspace/db run migrate`.
# The server image default working directory is the API bundle dir, not the repo root.
cd /app
pnpm --filter @workspace/db run migrate

echo "[start.sh] Migrations complete. Starting server..."
cd "$SERVER_DIR"
exec node --enable-source-maps --max-http-header-size=65536 dist/index.mjs
