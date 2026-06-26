# Alpha-Terminal

## Repository

GitHub: `achase1982-afk/Alpha-Terminal`
Base branch: `main`

## Required: One New Branch + One New PR Per Change

**Every distinct change gets its OWN new branch and its OWN new pull request.**
Never reuse a branch that already has an open PR — GitHub only allows one open
PR per branch, so reusing a branch silently piles new commits onto the old PR
instead of creating a new one.

Workflow for each change:

1. Create a NEW uniquely-named branch off `main`, e.g.
   `claude/<short-change-description>` (a fresh name every time — never reuse
   one that already has a PR).
2. Make the change and commit with a descriptive message.
3. `git push -u origin <new-branch-name>`.
4. **Immediately** create a pull request with `mcp__github__create_pull_request`
   (base `main`), with a clear title and summary. Do not wait to be asked; do
   not say "let me know if you want a PR." Every push gets its own PR, no
   exceptions.

This way each change is reviewable and deployable on its own, and the user can
always see exactly what is on each branch.
