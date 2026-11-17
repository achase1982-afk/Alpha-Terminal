#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export VITE_DEV_BYPASS_AUTH=true
fuser -k 3000/tcp 2>/dev/null || true
pnpm exec vite --config vite.config.ts --host 127.0.0.1 --port 3000 --strictPort &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:3000/" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
export CHAIN_ORDER_BASE_URL="http://127.0.0.1:3000/dev/chain-order-sheet"
export CHAIN_ORDER_ARTIFACT_DIR="/opt/cursor/artifacts"
pnpm exec playwright test e2e/chain-order-sheet.spec.ts