#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG="$ROOT/artifacts/alpha-terminal"
PORT="${PORT:-3000}"

cd "$PKG"
export VITE_AUTH_DISABLED=1
export CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-pk_test_auth_disabled_e2e}"
pnpm run build

SESSION="e2e-auth-disabled-preview"
tmux -f /exec-daemon/tmux.portal.conf has-session -t "=$SESSION" 2>/dev/null \
  && tmux -f /exec-daemon/tmux.portal.conf kill-session -t "$SESSION" \
  || true

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$SESSION" -c "$PKG" -- \
  "${SHELL:-bash}" -lc "PORT=$PORT pnpm run serve"

for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then break; fi
  sleep 1
done

AUTH_DISABLED_E2E_BASE="http://127.0.0.1:$PORT" pnpm exec playwright test e2e/auth-disabled-terminal.spec.ts

tmux -f /exec-daemon/tmux.portal.conf kill-session -t "$SESSION" 2>/dev/null || true