# Alpha-Terminal — Auto-Trader Investigation (2026-06-25)

**Author:** Claude Code session · **Branch reviewed:** `claude/app-area-review-312sbr`
**Question investigated:** What prompt/data drives the autotrader? Why no trades today after 25 min? Why did it buy-and-sell-at-a-loss yesterday?

---

## TL;DR

There are **two completely separate auto-trade systems** in the repo, and they were **swapped yesterday (June 24)**:

- **Old:** an LLM-driven "aggressive momentum trader" (`src/lib/autoTrade/`).
- **New:** a deterministic, rule-based Opening-Range-Breakout (ORB) engine with **no LLM in the trade path** (`src/engine/`).

The `/auto-trade/start` route now starts the **deterministic** engine. The LLM trader is no longer wired to the trade path.

Three consequences:
1. **Yesterday's churn** (buy → sell at a loss, repeatedly) was the **LLM** system. Its prompt is deliberately aggressive with an asymmetric bias: hard 65-confidence floor to BUY, **zero** floor to SELL, and "exit a stalled trade immediately." On noisy 1-min bars this whipsaws and eats the spread on each round-trip.
2. **Today's silence** is the **deterministic** engine, which takes at most one trade/day on a breakout — *and* has a **real bug** (below) that makes it essentially unable to ever fire an entry with the shipped config.
3. The rich "data package" you remember feeding the trader went to the **LLM** system. The deterministic engine sees a much thinner slice of data.

---

## The two systems

| | **Old: LLM trader** | **New: deterministic ORB engine** |
|---|---|---|
| Location | `artifacts/api-server/src/lib/autoTrade/` | `artifacts/api-server/src/engine/` |
| Decision brain | LLM (`generateText`) picks BUY/SELL/HOLD each poll | Pure math rules — **no LLM** |
| Trades/day | Many (polling loop) | At most **1** per day, breakout only |
| Wired to `/auto-trade/start`? | **No (disconnected)** | **Yes — this runs today** |

**Timeline (git log):**
- `2026-06-24  5b631e3  feat(engine): TypeScript ORB engine — deterministic, no LLM in trade path`
- `2026-06-24  4f64f0d  Wire deterministic ORB engine to existing /auto-trade routes`

Confirmation that the route uses the deterministic engine: `routes/autoTrade.ts:14` imports `startEngine` from `../engine/index.js`, and `/start` calls it (`routes/autoTrade.ts:63`). The old LLM `startAutoTrade()` is only referenced by a boot-time reconcile import (`index.ts:80`), not the trade path.

---

## 1. The LLM prompt (OLD system — drove yesterday's trades)

File: `artifacts/api-server/src/lib/autoTrade/decision.ts:38` (`buildSystemPrompt`).

It's an **"aggressive intraday momentum trader"** with these key (paraphrased) rules:

- "Chronic HOLD is not risk management — it is failure to trade. Act."
- **BUY** requires **65+ confidence**; below that it's demoted to HOLD (also hard-enforced in code at `decision.ts:124`).
- **SELL has NO confidence floor** — "when in doubt about a position, exit."
- "A position that is NOT making money is costing money in opportunity. Exit cleanly. Re-enter on the next clean setup."
- "If momentum has stalled (RSI flat, price at/below VWAP, volume drying up) — output SELL immediately."
- Falling-knife rule (don't buy dumps), trend-entry rule (buy above VWAP/EMA50/EMA200 with rising RSI), SPY macro tilt.

The model is called on a **polling loop** (`lib/autoTrade/engine.ts`), re-deciding every cycle.

### Why this churned buy→sell at a loss
The asymmetry is the cause: **high bar to enter, zero bar to exit**, plus an explicit instruction that a stalled trade is a failure to be exited *immediately*. On 1-minute noise, the next poll after a BUY frequently looks "stalled," so it SELLs right back out — losing the bid/ask spread each round-trip. Consistent small losses that *feel* like a bug but are actually the prompt's design. This is a **prompt-tuning** problem, not a crash.

---

## 2. Why the deterministic engine hasn't traded today (REAL BUG)

The ORB entry gate requires **RVOL ≥ 1.5** (relative volume = today's volume vs. a normal day at the same time). Gate is in `setups/orb.ts:16`.

**Problem:** the engine has **no historical average-volume source.** The Schwab live quote only carries *today's* cumulative `volume` (`schwabStreamer.ts:22`, `LiveQuote`), no average. So the engine approximates the daily baseline from *today's own pace* (`engine/index.ts:195`), which is **circular**:

```
// engine/index.ts onTick():
impliedDaily = (sessionVol / elapsed) * 390          // elapsed = bars.length

// features.ts setRvolFromAvgVolume():
expected = avgDailyVolume * (elapsed / 390)
         = (sessionVol / elapsed) * 390 * (elapsed / 390)
         = sessionVol
rvol     = sessionVol / expected
         = sessionVol / sessionVol
         = 1.0     // ALWAYS
```

**RVOL is mathematically pinned at 1.0**, which is always `< 1.5`, so `checkSetup()` returns `null` on every tick → **no entry ever fires** with the default config.

Compounding factors:
- RVOL is only computed **after 30 bars** (~30 min); before that it's `0` (`engine/index.ts:195`). So the first half-hour is dead regardless.
- Default `rvolThreshold = 1.5` (`engine/config.ts`).

**Net:** "25 minutes, no trades" is not a fluke — the engine would stay silent all day.

### Fix direction
RVOL needs a **real average-daily-volume baseline** (historical, e.g. from the DB / a per-minute volume profile — the code even references an intended `buildVolumeProfile()` / `volumeProfile` map that isn't populated). Quick stopgap: lower `rvolThreshold` toward ~1.0, but that defeats the volume filter's purpose.

---

## 3. What data each system can access

**NEW deterministic engine (running now) — thin slice:**
- Schwab **1-minute OHLCV bars** for ONE symbol (`getStrategistChartEquityBars`)
- Schwab **Level-1 quote**: bid / ask / last
- Derived in-engine: opening-range high/low (first 15 min), ATR(14), cumulative VWAP, spread, RVOL (broken)
- **Single symbol only** — `/start` writes only `config.tickers[0]` to the engine (`routes/autoTrade.ts:62`); additional tickers are ignored.
- No fundamentals, no news, no options chain, no SPY/macro.

**OLD LLM system (yesterday) — the full "data package" (`snapshot.ts`):**
- Live L1 quote: bid/ask/last/day H-L/volume/change%
- Last 10 one-minute bars (OHLCV)
- VWAP + price-vs-VWAP
- TA indicators (`ta.ts`): RSI, EMA50, EMA200, ATR(14), trend labels (BULLISH/BEARISH/PULLBACK/RECOVERY)
- **SPY macro backdrop**: SPY vs its EMA200, slope, day change
- Optional "playbook" pattern memory, plus position summary / budget remaining / max-per-trade / session label

---

## Risk-guard logic (deterministic engine, for reference)

`engine/risk.ts` `canEnter()` blocks entries on: halt flag, daily-loss halt, cooldown window, max trades/day (`tradesPerDay=3`), symbol-already-traded-today, loss-streak limit, open position, price sanity (stop<entry<target), min size, and a per-trade risk-dollar cap (`startingEquity * riskPerTradePct`, default 1% of $1,000 = $10/trade). Note the default `startingEquity` is **$1,000** (`engine/config.ts`) — very small position sizing.

---

## Recommended next steps (pick a direction)

1. **Decide which trader you want on.** They're different philosophies — LLM (active, churns) vs. ORB (one breakout/day, currently inert).
2. **If keeping the deterministic engine:** fix the RVOL baseline (real historical avg volume / volume profile) so the 1.5 gate is reachable. This is a clean, contained fix.
3. **If bringing back the LLM trader:** rebalance the prompt's buy/sell asymmetry and/or slow the poll cadence to stop the 1-min whipsaw losses.
4. Also worth addressing: the engine trades **only the first ticker**; the per-trade risk budget is tiny ($10 on $1,000); RVOL dead for first 30 min.

---

## File reference index

- `artifacts/api-server/src/routes/autoTrade.ts` — start/stop/config routes (now wired to deterministic engine)
- `artifacts/api-server/src/engine/index.ts` — deterministic engine hot loop; RVOL bug at `onTick()` ~line 195
- `artifacts/api-server/src/engine/setups/orb.ts` — ORB entry rule; RVOL gate line 16
- `artifacts/api-server/src/engine/features.ts` — `setRvolFromAvgVolume()` (circular calc)
- `artifacts/api-server/src/engine/risk.ts` — risk guards
- `artifacts/api-server/src/engine/config.ts` — defaults (rvolThreshold 1.5, startingEquity 1000)
- `artifacts/api-server/src/lib/autoTrade/decision.ts` — **LLM system prompt** (line 38)
- `artifacts/api-server/src/lib/autoTrade/snapshot.ts` — data fed to the LLM
- `artifacts/api-server/src/lib/autoTrade/engine.ts` — old LLM polling loop
- `artifacts/api-server/src/lib/schwabStreamer.ts` — `LiveQuote` shape (no avg volume)
