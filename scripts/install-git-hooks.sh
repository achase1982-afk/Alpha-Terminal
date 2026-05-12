#!/usr/bin/env bash
# Copies repo-defined hooks into `.git/hooks/` and points `core.hooksPath` there so hooks run in a
# single process chain after we strip false-positive secret scan inputs (see
# `.cursor/cloud-agent-secret-allowlist.md`).
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT" ]; then
  exit 0
fi

GIT_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || git -C "$ROOT" rev-parse --absolute-git-dir)"

HOOKS_DST="$ROOT/.git/hooks"
SRC_DIR="$ROOT/scripts/git-hooks"

mkdir -p "$HOOKS_DST"

for hook_name in pre-commit commit-msg; do
  if [ -f "$SRC_DIR/$hook_name" ]; then
    cp -f "$SRC_DIR/$hook_name" "$HOOKS_DST/$hook_name"
    chmod 755 "$HOOKS_DST/$hook_name"
  fi
done

CURSOR_MANAGED="$(git -C "$ROOT" config --get core.hooksPath || true)"
if [ -n "$CURSOR_MANAGED" ] && [ -x "$CURSOR_MANAGED/pre-commit.cursor" ]; then
  printf '%s\n' "$CURSOR_MANAGED" >"$GIT_DIR/cursor-managed-hooks-path"
fi

git -C "$ROOT" config core.hooksPath "$HOOKS_DST"
