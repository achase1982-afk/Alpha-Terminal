# Auto-Trader Status — Paper Mode Removed, Engine Is Now Always Live

**Date:** 2026-06-25

## TL;DR

The TypeScript deterministic engine no longer has a paper/shadow mode. It has
been **ripped out entirely** — every signal now places a real Schwab bracket
order. There is no longer any switch, flag, or config that makes the engine
"log only." If the engine is running and a setup fires, it trades for real.

Previously the engine was gated by `runMode: "shadow"`, which made it evaluate
symbols but never place orders. That gate is gone.

## What changed

- Removed the `runMode` / `RunMode` concept from the engine entirely
  (`types.ts`, `state.ts`, `config.ts`, `index.ts`, `execution.ts`,
  `reconcile.ts`, `routes/engine.ts`).
- `execution.ts` no longer short-circuits — `placeBracket`, `cancelOrder`, and
  `flattenPosition` always hit the Schwab Trader API.
- Removed the bar-touch "simulated exit" path (`manageOpenPosition`). In live
  trading the broker's OCO bracket performs the real exit and the 15s broker
  reconciliation (`reconcile.ts`) syncs engine state to broker truth.
- Broker reconciliation now runs unconditionally (it was previously live-only).
- Removed the `setMode` control endpoint.
- Removed `runMode` from `config.yaml`.

## One requirement to actually trade

`accountHash` **must be set** in `config.yaml`. Config validation now fails fast
on startup if it's missing — because there's no paper fallback anymore, a missing
account hash is a hard error rather than a silent "log only."

A valid Schwab trader token must also be present (same as before).

## Safety guards still in place

Removing paper mode did **not** remove the risk controls. These still apply:

- Daily loss halt (`dailyLossHaltPct`, default 3% of equity).
- Loss-streak halt + cooldown (`lossStreakLimit`, `cooldownMinutes`).
- Max trades per day (`tradesPerDay`).
- Per-trade and max position sizing (`riskPerTradePct`, `maxPositionSizePct`).
- Cancel-timeout on unfilled entries, with position rollback.
- Time-stop flatten (`timeStop`, default 15:55 ET).

## Verification

- `tsc --noEmit` clean.
- All 18 engine tests pass (swing setup, cancel-timeout, reconciliation).

## Note on the legacy Python auto-trader

There is a separate, older Python system under `autotrader/` (`run.py`, `src/`)
that still has its own `shadow_mode` and an interactive "type 'go live'"
confirmation. It is **not** the system that places (or placed) orders for the
live engine and was left structurally intact. If we want that one stripped to
live-only as well, that's a separate change — say the word.
