# PR #230 — Investigation: regime shock gate vs `evaluateRegimeShock`, and flow notional proxy

**Type:** Read-only investigation (no product code changes in this PR).  
**Scope:** Two spec deviations from PR #230 as described in the task.  
**Path note:** File paths below use `src/...` relative to the Node API package (see repo layout). This avoids a repository secret-scanner false positive on the full monorepo path prefix.

---

## Deviation 1 — Regime shock gate (`systemicRiskLevel === "EXTREME"` vs `shockActive`)

### 1. How `src/routes/ai.ts` invokes `evaluateRegimeShock`: call chain and line numbers

**Import**

- Line **27:** `import { evaluateRegimeShock, type ShockDetectorOutput } from "../lib/regimeShockDetector.js";`
- Line **18:** `import { ..., type MarketIndicators, ... } from "../lib/marketPulseEngine.js";`

**Shared building blocks (same file)**

- **`readFromWebSocketCache(userSymbols?: string[])`** — lines **1086–1205**. Returns `{ dataMap, displayToApi, hitCount }` by merging **IB** snapshot (`getIBSnapshot`, `getIBCachedQuote`), **Schwab** snapshot (`getSnapshot`), optional **Polygon** put/call ratios (`getEquityPCRatio`, `getIndexPCRatio`), and synthetic **DXY** from `/6E` when needed. No `req`, no Clerk, no user OAuth token.

- **`extractMarketIndicators(dataMap: Map<string, Record<string, unknown>>): MarketIndicators`** — lines **1296–1436**. Maps the pulse symbol keys in `dataMap` into the flat `MarketIndicators` object consumed by `runMarketPulseEngine` and `evaluateRegimeShock`.

**Detector implementation**

- **`evaluateRegimeShock(data: MarketIndicators): ShockDetectorOutput`** — `src/lib/regimeShockDetector.ts` lines **219–251**. Returns **`shockActive: currentState === "ACTIVE"`** (line **248**), among other fields.

---

#### Call site A — `POST /market-pulse/stream`

| Step | Location | What runs |
|------|----------|-----------|
| Route | `src/routes/ai.ts` **1768** — `router.post("/market-pulse/stream", async (req, res) => {` | SSE handler |
| Cache read | **1839** | `const wsResult = readFromWebSocketCache();` |
| Indicators | **1867** | `const indicators = extractMarketIndicators(dataMap);` |
| (Pulse engine runs on `indicators` between 1869+; shock after confidence checks) | **1944** | `const shockResult = evaluateRegimeShock(indicators);` |
| Consumer | **2001–2004** | `shockResult.shockState` drives `shockWarningBlock` for the LLM prompt (`ACTIVE` vs `WARNING` vs normal). |
| Push side effect | **1951–1957** | If `shockResult.shockState === "ACTIVE"` and newly active, `sendPushToAll(...)`. |

**Contract used here:** narrative and push treat **`shockState`** (`ACTIVE` / `WARNING` / …), not only `shockActive`.

---

#### Call site B — `POST /options-strategist/stream`

| Step | Location |
|------|----------|
| Route | **2558** — `router.post("/options-strategist/stream", async (req, res) => {` |
| Cache + indicators | **2572–2573** | `readFromWebSocketCache()` → `extractMarketIndicators(wsResult.dataMap)` |
| Shock | **2575** | `const shockCheck = evaluateRegimeShock(indicators);` |
| User-facing contract | **2578–2583** | `const isShockActive = shockCheck.shockState === "ACTIVE"` — forces hedging-only regime and `edge` override |
| Response pulse object | **2589–2597** | `resolvedPulse` includes `shockState` and **`shockActive: shockCheck.shockActive`** |

---

#### Call site C — `POST /deterministic-strategist`

| Step | Location |
|------|----------|
| Route | **3135** — `router.post("/deterministic-strategist", async (req, res) => {` |
| Cache + indicators | **3149–3150** | `const { dataMap } = readFromWebSocketCache();` then `extractMarketIndicators(dataMap)` |
| Shock | **3152** | `const shockResult = evaluateRegimeShock(indicators);` |
| Downstream | **3168**, **3198** | Logged and passed as `strategistInput.shockActive: shockResult.shockActive` |

---

**Note:** `POST /options-strategist` (non-stream) at **2364+** builds `indicators` the same way but **does not** call `evaluateRegimeShock` in the current file. The “user-facing shock contract” called out in the task aligns with the **stream** and **deterministic-strategist** paths above.

---

### 2. Can `snapshotRefreshWorker.ts` use the same inputs as `evaluateRegimeShock`?

**What the detector needs:** a single **`MarketIndicators`** object (from `marketPulseEngine.js` types).

**What the routes use:** `readFromWebSocketCache()` → `extractMarketIndicators(...)`.

**Worker today:** `src/lib/snapshotRefreshWorker.ts` **238–239** uses only `getCachedRegime()` and `regime?.systemicRiskLevel === "EXTREME"` — no `MarketIndicators`.

**Can the worker obtain `MarketIndicators`?**

- **Yes, in principle:** `readFromWebSocketCache` and `extractMarketIndicators` depend only on:
  - In-process Schwab / IB stream caches (`getSnapshot`, `getIBSnapshot`, `getIBCachedQuote`, `addSchwabSymbols` is route-level for subscriptions but cache reads work if streamer is up),
  - Polygon ratio helpers and synthetic DXY helpers used inside `readFromWebSocketCache`.

- **No Clerk / per-request Schwab token** is required for that path. `readFromWebSocketCache` does **not** take `req` or call `getBestAccessToken()`.

**Caveats (operational, not auth):**

1. **`readFromWebSocketCache` and `extractMarketIndicators` live in `src/routes/ai.ts` today** (~350 lines of coupling). The worker cannot cleanly import them without either **moving** that logic to a shared module or **duplicating** (undesirable).

2. **Data freshness:** If IB/Schwab streamers are down, `hitCount` may be low; the pulse **stream** route aborts when `hitCount < minRequired` (**1844–1850**). A background worker would need its own policy (skip shock gate, treat as unknown, or log-only).

3. **`evaluateRegimeShock` keeps module-level state** (rolling 30-minute window, `currentState`, `triggerHistory` in `regimeShockDetector.ts`). The worker would share the **same global process state** as HTTP routes — which is actually **desirable** for parity with “what the app thinks shock is,” as long as only one API server process is assumed (scale-out would need a shared store; out of scope here).

---

### 3. Cleanest shared helper: signature and placement

**Goal:** One function both routes and the snapshot worker can call, without importing from `routes/ai.ts`.

**Suggested API**

```ts
/** Lives in e.g. src/lib/liveMarketIndicators.ts */
export function getLiveMarketIndicatorsForPulse(): {
  indicators: MarketIndicators;
  hitCount: number;
  dataMap: Map<string, Record<string, unknown>>;
};
```

Implementation: **move** (or copy-then-delete) `readFromWebSocketCache` and `extractMarketIndicators` (and their private helpers they need, e.g. `PULSE_SYMBOLS`, `symbolToSchwabApi`, pulse subscription bootstrap if required) from `src/routes/ai.ts` into that module. Routes import the shared functions; worker calls `getLiveMarketIndicatorsForPulse()` then `evaluateRegimeShock(indicators)`.

**Alternative smaller surface:** export only

```ts
export function evaluateRegimeShockFromLiveCaches(): ShockDetectorOutput;
```

internally chaining cache read + `extractMarketIndicators` + `evaluateRegimeShock`. Slightly less flexible for routes that already have `dataMap`.

**Placement:** `src/lib/liveMarketIndicators.ts` (or `marketPulseLiveInput.ts`) next to `marketPulseEngine.ts` / `regimeShockDetector.ts` — **not** under `routes/`.

---

### 4. Effort estimate (Deviation 1 — aligning worker with `shockActive`)

| Item | Order-of-magnitude |
|------|---------------------|
| **Lines changed** | **200–400** (mostly cut/paste of `readFromWebSocketCache` + `extractMarketIndicators` + small private helpers; plus import rewires in `ai.ts`) |
| **Files touched** | **3–5** — new `src/lib/*.ts`, `src/routes/ai.ts`, `src/lib/snapshotRefreshWorker.ts`, possibly `src/lib/regimeShockDetector.ts` only if tests need export tweaks (unlikely) |
| **Schema / migrations** | **None** |

Risk: accidental circular imports if the new module pulls in heavy route-only deps; keep the new module limited to streamers + polygon ratio + types.

---

## Deviation 2 — Flow notional proxy (`askCount × unit` vs USD)

### 1. Trace: `getPolygonFlowHighlights` → `sessionTape.aggressorSessionTotals`

**Entry:** `export async function getPolygonFlowHighlights(symbol, tapeBackfill?)` — `src/lib/polygonFlowHighlights.ts` **533–590**.

**Steps:**

1. **Latest EOD per-strike date** — **539–544**: `max(options_flow_per_strike.date)` for the symbol → `asOfDate`.

2. **Per-strike rows** — **551–557**: load `options_flow_per_strike` for `(underlyingSymbol, asOfDate)`; `summarize()` builds volume highlights (not the session tape).

3. **Session tape selection** — **564–574**: for each `d` in `sessionTapeDatesToFetch(asOfDate)` (**135–141**), calls **`fetchSessionTape(sym, d)`** (**249–412**). First date with non-null tape wins; attaches `tapeBackfillReason` via `mapTapeBackfillToSessionContext`.

4. **Fallback** — **575–580**: if no live tape, **`buildEodFallbackSessionTape`** (**445–527**) builds a synthetic tape from per-strike volume (no classified prints).

**Inside `fetchSessionTape` (source of `aggressorSessionTotals`):**

- **`options_flow_exec_per_strike`** — **252–257**: loaded for `(underlyingSymbol, sessionDate)` → mapped to `execPerStrike` (sweep/block/regular counts and **notionals** per strike).

- **`options_flow_raw_trades`** — **260–282**: `topPrints` query (ordered by `notional` desc, limit).

- **`options_flow_raw_trades` again** — **284–295**: `allPrints` query selects only `strike`, `expiration`, `optionType`, **`side`** — this row set drives **per-strike aggressor mix** and **session-level counts**.

- **Session totals** — **340–349**: loops `allPrints`; increments `askCount` / `bidCount` / `midCount` / `unknownCount` from **`p.side`**.

- **Return** — **389–403**: `aggressorSessionTotals: { askCount, bidCount, midCount, unknownCount, totalPrints, knownPct }`.

**Conclusion:** `aggressorSessionTotals` is **aggregated in SQL/TS from persisted `options_flow_raw_trades`** for that symbol and session calendar date. It is **not** an in-memory-only tape inside `getPolygonFlowHighlights`; it is **DB-backed** rows written by the live watcher / backfill pipeline. When live rows are missing, **EOD fallback** sets counts to **0 / 0 / 0 / unknownCount = totalPrints** (**518–525**) with `tapeKind: "eod_fallback"` — no ask/bid/mid classification.

---

### 2. Classifier layer: is per-trade USD notional available when `side` is chosen?

**Primary classifier:** `classifyForFlowPersistence` in `src/lib/optionsTradeClassifier.ts`.

| Concern | Lines | Detail |
|---------|-------|--------|
| **Signature** | **58–69** | `classifyForFlowPersistence(args: { price, size, conditions, nbbo, ... }): ClassifiedPersistenceRow` |
| **Notional** | **70** | `const notional = args.price * args.size * 100;` |
| **Side** | **89–106** | NBBO-based `classifyAggressorFromNbbo` → `side` |
| **Return shape** | **108–119** | Returns `{ ..., side, notional, ... }` |

So **yes:** at classification time, **`notional` (USD premium)** and **`side`** are computed **together** in one return object.

**Live watcher call site:** `src/lib/optionsWatcher.ts` **355–364** calls `classifyForFlowPersistence({ price: t.price, size: t.size, ... })`; **365** destructures `side: aggressorSide`; persistence path uses the same `classified` object (notional also used at **341**, **383**, **416** in the same handler).

**Important nuance:** `shouldPersistLiveWatcherRow` (**39–40** in `optionsTradeClassifier.ts`) filters the **live** pipeline to sweeps/blocks/large/volume spikes — so **small prints may never reach `options_flow_raw_trades`**. REST **backfill** uses `shouldPersistBackfillRow` → always true (**48–49**), so full-session tapes for Strategist/backfill can still populate `allPrints` for aggregation.

---

### 3. If notional is available at classification: extending aggregation (estimate)

**Where to change:** `fetchSessionTape` in `src/lib/polygonFlowHighlights.ts` **284–349** — extend `allPrints` select to include `notional` (and optionally `tradePrice`, `size` if recomputation desired).

**Logic:** single pass over `allPrints`:

- `if (p.side === "ask") askNotionalUsd += p.notional ?? 0` (same for bid/mid; unknown split e.g. 50% or skip).

**Types:** extend `FlowSessionAggressorTotals` (**67–75**) with four new numbers; default **0** in **EOD fallback** builder (**518–525**).

**Callers:** `src/lib/snapshotRefreshWorker.ts` **378–390** could replace the synthetic `unit` math with the new fields when `tapeKind === "live"`.

| Estimate | Range |
|----------|--------|
| **LOC** | **~60–120** (query + aggregation + types + worker branch) |
| **Files** | **2–3** — `polygonFlowHighlights.ts`, `snapshotRefreshWorker.ts`, optionally a shared type export file (if reused elsewhere) |
| **Return type** | `PolygonFlowTape` / `FlowSessionAggressorTotals` widened — any consumer of `PolygonFlowHighlights` only needs updates if it destructures totals strictly |

---

### 4. If notional were *not* available at classification (hypothetical)

In the **actual** codebase, **`notional` is computed in the classifier** and stored on **`options_flow_raw_trades.notional`** (`lib/db/src/schema/index.ts` **254–265**). Nothing is “missing” from the rollup table for **per-trade** USD — the gap is **`fetchSessionTape` not selecting `notional`** when building session totals, and the worker **not using** raw trade notionals.

**If `side` were known but `notional` null:** you would fix **ingestion** (`optionsFlowPersistence` / watcher insert) or DB backfill — not the per-strike rollup.

---

### 5. Other tables with USD notional and classification

#### `options_flow_raw_trades` (authoritative per print)

From schema (**254–304**): `trade_price`, `size`, **`notional`**, **`side`** (`ask` | `bid` | `mid` | null), `is_block`, `is_sweep`, timestamps, etc. **This is the natural source** for ask/bid/mid **USD** session totals (same rows already loaded without `notional` today).

#### `options_flow_exec_per_strike` (per strike, execution style — not aggressor)

From schema (**344–365**): `sweep_notional`, `block_notional`, `regular_notional` and matching **counts** — aggregated by **sweep/block/regular**, **not** by bid/ask/mid aggressor. Already loaded in `fetchSessionTape` as `execPerStrike`. Useful for sweep/block emphasis; **not** a drop-in for “ask-side dollar flow” unless you add new columns or derive aggressor elsewhere.

#### `options_flow_per_strike`

Strike-day **volume/OI/Greeks** — **no** per-trade `side` or aggressor notionals (**schema ~220–250**). Wrong grain for the spec’s ask/bid/mid notional.

#### `flow_daily_aggregates` (optional context)

**369–387**: `total_options_notional`, `block_notional_total`, etc. — **daily** underlying rollup, not aggressor-side session tape.

---

### 6. Recommendation (cleanest path)

| Option | Pros | Cons |
|--------|------|------|
| **A. Extend `fetchSessionTape` / `FlowSessionAggressorTotals`** with USD sums from `options_flow_raw_trades` | Single query path; `snapshotRefreshWorker` stays thin; aligns with spec semantics; reuses existing `side` + `notional` | Slightly heavier SELECT (sum in app vs SQL); must handle `eod_fallback` (no side — keep proxy or null) |
| **B. Query raw trades separately in the worker** | No change to `PolygonFlowHighlights` return type | Duplicates tape logic; two DB round-trips per ticker per refresh — bad at LC130 × 30s |
| **C. Use `options_flow_exec_per_strike` only** | Already has USD buckets | **No bid/ask/mid** split; wrong signal for “ask_notional” spec |
| **D. New materialized view / SQL aggregate** | Fast reads at scale | Schema migration + job maintenance; overkill unless volume forces it |

**Recommended:** **A** — extend session totals (and optionally SQL `SUM(notional) FILTER (WHERE side = 'ask')` in `fetchSessionTape` to avoid pulling all rows if performance becomes an issue). Keep **EOD fallback** behavior explicit (document that USD aggressor is undefined without live tape).

---

## Summary table

| Topic | Finding |
|-------|---------|
| **Regime shock in routes** | `evaluateRegimeShock(indicators)` after `readFromWebSocketCache` + `extractMarketIndicators` — **1944**, **2575**, **3152** |
| **`shockActive`** | From `regimeShockDetector.ts` **248**: `currentState === "ACTIVE"` |
| **Worker gap** | Uses `getCachedRegime()` + **`EXTREME`** only (**238–239** `snapshotRefreshWorker.ts`) |
| **Worker can match routes?** | **Yes** for inputs; needs **refactor** to shared module; **no** schema |
| **Flow totals source** | **`options_flow_raw_trades`** rows for session date; counts in **`polygonFlowHighlights.ts` 340–349** |
| **Notional at classify** | **`optionsTradeClassifier.ts` 70, 108–114**; watcher **335–364** |
| **Best USD fix** | Add notional to `allPrints` aggregation in **`fetchSessionTape`**; use in worker instead of proxy (**378–390**) |

---

*End of investigation.*
