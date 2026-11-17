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
  artifacts/alpha-terminal/src/components/StrategyBuilder.tsx
)

MATH_PKG="lib/order-ticket-math"
MATH_PATHS=()
while IFS= read -r rel; do
  MATH_PATHS+=("$rel")
done < <(git ls-tree -r --name-only "$MAIN_REF" "$MATH_PKG")

restore_paths() {
  git checkout HEAD -- "${COMPONENTS[@]}"
  if ((${#MATH_PATHS[@]} > 0)); then
    git checkout HEAD -- "${MATH_PATHS[@]}"
  fi
}

for f in "${COMPONENTS[@]}"; do
  git show "$MAIN_REF:$f" >"$f"
done

for f in "${MATH_PATHS[@]}"; do
  git show "$MAIN_REF:$f" >"$f"
done

trap restore_paths EXIT

export QA_SNAPSHOT_VARIANT=before
export QA_SCREENSHOT_DIR="$OUT"
pnpm --filter @workspace/alpha-terminal exec playwright install chromium 2>/dev/null || true
pnpm --filter @workspace/alpha-terminal run test:e2e:qa-screenshots

echo "Before screenshots written to $OUT (prefix: before-)"