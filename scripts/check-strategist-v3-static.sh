#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPLETED=$(rg -n "status:\s*['\"]completed['\"]|status\s*=\s*'completed'" artifacts/api-server/src --glob '*.ts' || true)
COUNT=$(echo "$COMPLETED" | grep -c 'strategistJobsTable' || true)

# Allow only terminal.ts persistAndComplete update
if echo "$COMPLETED" | rg -v 'strategistV3/terminal\.ts' | rg -q "strategistJobsTable"; then
  echo "FAIL: found strategist_jobs completed status write outside strategistV3/terminal.ts:"
  echo "$COMPLETED" | rg -v 'strategistV3/terminal\.ts' || true
  exit 1
fi

if ! rg -q "status:\s*\"completed\"" artifacts/api-server/src/lib/strategistV3/terminal.ts; then
  echo "FAIL: persistAndComplete must set status completed"
  exit 1
fi

if rg -q 'strategistThinkingBuffer' artifacts/api-server/src; then
  echo "FAIL: strategistThinkingBuffer still referenced"
  exit 1
fi

echo "OK: Strategist V3 static checks passed"
