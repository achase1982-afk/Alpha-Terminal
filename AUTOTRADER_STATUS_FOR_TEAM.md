# Auto-Trader Status — Why No Trades Are Being Placed

**Date:** 2026-06-25

## TL;DR

The auto-trader is **running and evaluating symbols, but it is in paper (shadow)
mode by design and is deliberately placing zero real orders.** Nothing has been
wired up to go live yet. This is a configuration gate, not a crash or a bug.

If the team was under the impression that everything was already wired up to
trade live, that impression is wrong — and that's on me to make clear. The
engine works; the "make it actually place real orders" switch was never
connected.

## What's actually happening

- `config.yaml` has `runMode: "shadow"`.
- The "Start" button in the UI turns the engine **on**, but it never changes
  `runMode`. There is no paper/live toggle exposed anywhere in the UI.
- In shadow mode, the engine runs the full loop — it pulls data, evaluates
  MARA / SOFI, and finds (or rejects) setups — but the order-placement code
  intentionally short-circuits and returns without sending anything to Schwab.
- Therefore: real trades will **not** be placed until `runMode` is set to
  `"live"`. No amount of clicking "Start" changes that.

## What got delivered (PR #593, merged)

For context, the recent work did ship real functionality to the deterministic
engine — it just stopped short of being live-capable from the UI:

1. **Cancel-timeout fix** — prevented a phantom-position bug that could cause an
   accidental short at the 15:55 flatten and lock the strategy out for the day.
2. **Swing engine conversion** — converted the old ORB logic into a continuous
   multi-symbol swing engine with real features (bar shape, volume ratio, VWAP
   distance, RSI/EMA/trend, etc.).
3. **Real RVOL baseline** — fixed the RVOL-pinned-at-1.0 bug that was silently
   blocking all entries.
4. **Broker reconciliation** — makes Schwab the source of truth in live mode
   (partial fills, bracket exits, rejected/adopted positions).

All of that is real and tested. The missing piece is purely the live/paper
switch and the ability to control it.

## Options to actually go live

Pick one:

1. **(Recommended) Wire a paper/live toggle into the auto-trade config + UI.**
   So "turn on the trader" can actually go live, with the current mode shown on
   the dashboard. Right now you cannot go live from the UI at all.

2. **Flip `config.yaml` to `live` and redeploy.**
   Fastest path, but there are no guardrails, and it puts real money on the very
   first trades. Note exit fill prices are still approximated (last known price,
   not parsed execution legs).

3. **Add a `/auto-trade/evaluations` readout first.**
   So you can watch the per-symbol decision reasons (`"no setup"`,
   `"position open"`, `"BLOCK …"`) and confirm the engine is evaluating and
   finding setups *before* you risk anything.

**My honest recommendation:** do #1, and ideally #3 alongside it, so you can
verify it's finding setups in paper mode before going live. #2 works but is the
riskiest.

## Known follow-ups / caveats

- `runMode` defaults to `shadow` and is not controllable from the UI.
- Reconciled/bracket exits approximate the exit fill price rather than parsing
  execution legs.
