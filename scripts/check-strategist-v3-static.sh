#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_SRC="artifacts/api-server/src"

COMPLETED=$(
  grep -REn "status:[[:space:]]*['\"]completed['\"]|status[[:space:]]*=[[:space:]]*'completed'" "$API_SRC" --include='*.ts' 2>/dev/null || true
)

# Allow only terminal.ts persistAndComplete update
if echo "$COMPLETED" | grep -v 'strategistV3/terminal\.ts' | grep -q "strategistJobsTable"; then
  echo "FAIL: found strategist_jobs completed status write outside strategistV3/terminal.ts:"
  echo "$COMPLETED" | grep -v 'strategistV3/terminal\.ts' || true
  exit 1
fi

if ! grep -qE 'status:[[:space:]]*"completed"' "$API_SRC/lib/strategistV3/terminal.ts"; then
  echo "FAIL: persistAndComplete must set status completed"
  exit 1
fi

if grep -rq 'strategistThinkingBuffer' "$API_SRC"; then
  echo "FAIL: strategistThinkingBuffer still referenced"
  exit 1
fi

echo "OK: Strategist V3 static checks passed"
