# Auto-Trader Status

**Date:** 2026-06-25

## UPDATE — Entry logic fixed: confirm the reversal, don't predict the bottom

**Why it kept buying and selling at a loss:** the swing entry was *predicting*
the bottom instead of *confirming* the turn. The old rules required volume
**drying up** and bodies **shrinking** — i.e. it bought quiet, slowing dips
**while price was still falling**, with a stop just below the rail. In any
real down-move that stop got run immediately → buy, stop out, re-arm, repeat.
Critically, `recentDirection` (the engine's short-term momentum read) was
computed but **never used** by the entry.

**The fix (`setups/swing.ts`):** an entry now requires the reversal to have
actually started, on real volume:
- The latest bar must be an **up bar that closed above the prior bar** (price
  turning up — not still falling).
- **Lower-wick rejection** of the lows (buyers defended), as before.
- **Expanding volume on the turn** (`volRatio ≥ reversalVolRatioMin`, default
  1.2) — the real-vs-fake-reversal tell, the opposite of the old "volume
  drying" rule.
- Still only in an oversold/stretched location below VWAP, RSI in band, and
  not in a clean downtrend.
- The **stop now sits just below the reversal bar's low** — if that low breaks,
  the reversal failed and you're out small.

This makes it wait for the bounce to prove itself before buying, which is what
it should have been doing all along.

**Still open (recommended next):** the *exit* is still the static broker OCO
(target = VWAP, stop = below the turn-bar low). An active "exit when momentum
rolls back over" requires cancelling the live OCO before market-selling, which
is fiddly with real orders — phased as a follow-up rather than rushed in live.

**Note:** there is no paper mode anymore (removed below), so this strategy
change goes straight to live. Stop the engine, deploy, then restart.

---

## Background — Paper Mode Removed, Engine Is Now Always Live

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
