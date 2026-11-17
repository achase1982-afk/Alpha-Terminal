#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export VITE_CHAIN_SHEET_SHOTS=1
export VITE_DEV_BYPASS_AUTH=true
pnpm exec vite build --config vite.config.ts
fuser -k 4173/tcp 2>/dev/null || true
pnpm exec vite preview --config vite.config.ts --host 127.0.0.1 --port 4173 --strictPort &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; }
trap cleanup EXIT
sleep 3
export CHAIN_SHEET_BASE_URL=http://127.0.0.1:4173
export CHAIN_SHEET_ARTIFACT_DIR=/opt/cursor/artifacts
pnpm exec playwright test e2e/chain-order-sheet.spec.ts