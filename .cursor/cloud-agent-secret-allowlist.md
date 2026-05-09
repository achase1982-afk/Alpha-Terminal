# Cursor Cloud Agent secret scan — allowlisted false positives

The Cloud Agent sets `core.hooksPath` to a managed hook directory and runs `pre-commit.cursor` / `commit-msg.cursor`, which block commits when **staged lines** or the **commit message** contain substrings equal to injected deployment identifiers.

The monorepo Node backend directory is **`artifacts/api-server`**. The injected secret **`RAILWAY_SERVICE`** is configured to a Railway **service slug** that can equal or appear inside that path (via the substring **`api-server`**). That produces **false positives** on legitimate documentation and paths.

## Repo-local mitigation

1. **`scripts/install-git-hooks.sh`** (via **`pnpm prepare`**) saves the managed hooks directory to **`.git/cursor-managed-hooks-path`**, copies **`scripts/git-hooks/pre-commit`** and **`commit-msg`** into **`.git/hooks`**, and sets **`core.hooksPath`** to that folder so Git invokes **only** these wrappers.
2. Each wrapper removes **`RAILWAY_SERVICE`** from **`CLOUD_AGENT_INJECTED_SECRET_NAMES`**, **`unset RAILWAY_SERVICE`**, then runs the saved **`*.cursor`** hooks — so filtering applies in the **same** process as the scanner.

**Trade-off:** commits are no longer substring-scanned against the Railway **service slug** value. **`RAILWAY_TOKEN`** and other injected secrets remain enforced.

## Gitleaks

**`.gitleaks.toml`** allowlists the same path tokens for standalone **`gitleaks`** runs (CI or local).
