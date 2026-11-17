#!/usr/bin/env bash
# Capture BEFORE screenshots using main's OrderTicket/OptionsTab UI with the same Playwright harness/mocks.
set -euo pipefail

ROOT="$(git -C "${BASH_SOURCE%/*}/.." rev-parse --show-toplevel)"
OUT="${QA_SCREENSHOT_DIR:-$ROOT/docs/qa-pr-b}"
MAIN_REF="${QA_MAIN_REF:-origin/main}"

cd "$ROOT"
git fetch origin main

COMPONENTS=(
  artifacts/alpha-terminal/src/components/OrderTicket.tsx
  artifacts/alpha-terminal/src/components/OptionsTab.tsx
)

for f in "${COMPONENTS[@]}"; do
  git show "$MAIN_REF:$f" >"$f"
done

trap 'git checkout HEAD -- "${COMPONENTS[@]}"' EXIT

export QA_SNAPSHOT_VARIANT=before
export QA_SCREENSHOT_DIR="$OUT"
pnpm --filter @workspace/alpha-terminal exec playwright install chromium 2>/dev/null || true
pnpm --filter @workspace/alpha-terminal run test:e2e:qa-screenshots

echo "Before screenshots written to $OUT (prefix: before-)"