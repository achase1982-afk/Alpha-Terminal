# Aggressor classification injection audit (options trade ingest)

**Date:** 2026-05-09  
**Scope:** Read-only trace of how options prints reach `options_flow_raw_trades`, where NBBO exists, how offline tape backfill classifies aggressor, and candidate injection points for inline classification.

**Path convention:** Unless noted as `lib/db/...`, paths below are rooted at `artifacts/api-server` in this repository.

## Summary (recommended injection point)

**Live paths already perform inline NBBO classification** before persistence: `artifacts/api-server/src/lib/optionsWatcher.ts` (`handleTrade`) does so for the long-running watcher; the on-demand capture path uses the same `classifyForFlowPersistence` + `getNbbo(sym)` pattern in its trade handler (see `artifacts/api-server/src/lib/flowCapture*.ts`).

The **largest gap** is **`strategistTapeBackfill.ts` phase 1**, which inserts rows with **`side: null`** and **`aggressorConfidence: "unknown"`** because it passes **`nbbo: null`** into `classifyForFlowPersistence`. Phase 2 later fills `side` via Polygon REST `/v3/quotes` (same Lee-Ready logic through `classifyAggressorFromNbbo`).

**Best fit for stronger inline behavior on REST-ingested tape:** extend **phase 1** (or a narrow prefetch immediately before the per-trade insert loop) to obtain NBBO for each print without waiting for the separate phase-2 pass (for example reuse `fetchQuotesWindowed` / `nbboAtOrBefore` in the same OCC batch, or call `fetchQuotesAroundTrade` per print if budget allows). That keeps **one canonical column** (`side`) and avoids conflicting writers; phase 2 remains a **gap-fill** for rows still `side IS NULL`.

Secondary improvement: **`flowCaptureService.ts`** `onTradeHandler` runs classification inside an `async` IIFE and reads `getNbbo` immediately; if a **T** event arrives before the first **Q** for that OCC, `side` can be null despite live WS. Tightening ordering (await quote cadence or micro-delay) is a smaller correctness fix, not a new column.

---

## 1. Trade ingest entry point (path to DB)

**Persistence table:** `options_flow_raw_trades` (Drizzle: `lib/db/src/schema/index.ts`, table `optionsFlowRawTradesTable`).

### A. Long-running scanner watcher (Polygon WebSocket)

| Step | File | Function / symbol |
|------|------|-------------------|
| Process boot | `artifacts/api-server/src/index.ts` | `startOptionsWatcher()`; batched raw-trade writer timer starts in same boot block |
| WS client | `artifacts/api-server/src/lib/polygonOptionsWs.ts` | `ensureConnected`, `handleMessage` (events `T` trade, `Q` quote), `getNbbo`, `onTrade`, `onQuote`, `subscribeContractsWithQuotes` |
| Watchlist + chain | `artifacts/api-server/src/lib/optionsWatcher.ts` | `startOptionsWatcher`, `setWatchlist`, `resolveAndSubscribeBatch`, `handleTrade` |
| Classification | `artifacts/api-server/src/lib/optionsTradeClassifier.ts` | `classifyForFlowPersistence`, `shouldPersistLiveWatcherRow` |
| NBBO math | `artifacts/api-server/src/lib/flowAggressorSide.ts` | `classifyAggressorFromNbbo` |
| Buffer + INSERT | `artifacts/api-server/src/lib/optionsFlowPersistence.ts` | `enqueueClassifiedTrade`, `flush` then `db.insert(optionsFlowRawTradesTable)` |

**Note:** Only rows passing `shouldPersistLiveWatcherRow` (sweep / block / large / volume spike) are enqueued; small prints do not hit the DB on this path.

### B. On-demand flow capture (Polygon WebSocket + optional REST segment)

| Step | File | Function / symbol |
|------|------|-------------------|
| Orchestrator entry | `artifacts/api-server/src/lib/strategistV2.ts` | `requestFlowCapture` from `flowCaptureService.js` |
| Capture session | `artifacts/api-server/src/lib/flowCaptureService.ts` | `requestFlowCapture`, internal capture loop, `onTradeHandler`; may call `runStrategistTapeBackfill` for same-day REST tape |
| Shared WS stack | `artifacts/api-server/src/lib/polygonOptionsWs.ts`, `artifacts/api-server/src/lib/optionsTradeClassifier.ts`, `artifacts/api-server/src/lib/flowAggressorSide.ts` | same as watcher |
| Direct INSERT | `flowCaptureService.ts` | `flush` then `db.insert(optionsFlowRawTradesTable)` (bypasses `optionsFlowPersistence` queue) |

**Note:** Uses `shouldPersistBackfillRow` (always true) for WS trades in capture, so **all** subscribed OCC prints can persist.

### C. Strategist / scanner tape backfill (Polygon REST)

| Step | File | Function / symbol |
|------|------|-------------------|
| Entry | `artifacts/api-server/src/lib/strategistTapeBackfill.ts` | `runStrategistTapeBackfill` |
| Trades HTTP | Same | `fetchPaged` to Polygon `/v3/trades/{occ}`, `parseTrades` |
| Quotes HTTP (phase 2) | Same | `fetchQuotesWindowed` to Polygon `/v3/quotes/{occ}`, `parseQuotes`, `nbboAtOrBefore` |
| Shared quote helpers | `artifacts/api-server/src/lib/optionsQuoteNbbo.ts` | `parseQuotes`, `nbboAtOrBefore`, `fetchQuotesAroundTrade` |
| Classification | `artifacts/api-server/src/lib/optionsTradeClassifier.ts` | `classifyForFlowPersistence` |
| INSERT / UPDATE | `strategistTapeBackfill.ts` | Phase 1: `tx.insert(optionsFlowRawTradesTable)` with `side: null`; Phase 2: `tx.update(...).where(isNull(side))` |

### D. Background reclassification (gap-fill for null side)

| Step | File | Function |
|------|------|----------|
| Rows with null side | `artifacts/api-server/src/lib/optionsTradeReclassifier.ts` | `reclassifyUnclassifiedTrades` |
| NBBO | `optionsQuoteNbbo.ts` | `fetchQuotesAroundTrade`, `nbboAtOrBefore` |
| UPDATE | `optionsTradeReclassifier.ts` | `db.update(optionsFlowRawTradesTable).set({ side, aggressorConfidence }).where(isNull(side))` |

---

## 2. NBBO availability at ingest time

### Polygon options WebSocket (`artifacts/api-server/src/lib/polygonOptionsWs.ts`)

- **Source:** Quote events (`ev === "Q"`) update in-memory `nbboCache` **before** quote handlers run (see comment at cache set).
- **API:** `getNbbo(sym)` returns latest bid/ask for that OCC string.
- **Freshness:** Event-driven; typically milliseconds behind SIP on active contracts. Stale or empty if no quote yet after subscribe, wide spreads, or disconnect.
- **OCC coverage:** Exactly the contracts ref-counted via `subscribeContractsWithQuotes` / `subscribeContracts`. Watcher uses HOT+WARM budgets (`optionsWatcher.ts`); flow capture uses caller-supplied `occList`.

### Polygon REST quotes (tape backfill / reclassifier)

- **Source:** `GET https://api.polygon.io/v3/quotes/{occ}` with timestamp window (`strategistTapeBackfill.fetchQuotesWindowed`, `optionsQuoteNbbo.fetchQuotesAroundTrade`).
- **Freshness:** Historical replay; `nbboAtOrBefore` picks last quote at or before trade time.
- **OCC coverage:** Whatever OCCs the backfill iterates (strategist chain-derived list capped by tier budget), or single OCC in reclassifier.

### Schwab / other brokers

- **`artifacts/api-server/src/lib/schwabStreamer.ts` `LEVELONE_OPTIONS`:** Used elsewhere (for example strategist intraday options freshness via `getOptionTick`). **Not referenced** in `optionsWatcher`, `flowCaptureService`, `strategistTapeBackfill`, or `optionsTradeClassifier` for raw-trade ingest.
- **Polygon chain snapshot (`artifacts/api-server/src/lib/polygonChain.ts`):** Provides chain marks / OI / volume context for classification thresholds, **not** per-trade NBBO at print time for ingest.

### Summary table (ingest path steps)

| Location | NBBO available? | Typical source |
|----------|-----------------|----------------|
| `artifacts/api-server/src/lib/polygonOptionsWs.ts` (`handleMessage`) after `Q` | Yes (cache) | WS quote |
| `artifacts/api-server/src/lib/optionsWatcher.ts` (`handleTrade`) | If `getNbbo` hit | WS cache |
| `artifacts/api-server/src/lib/flowCaptureService.ts` (`onTradeHandler`) | If `getNbbo` hit when async callback runs | WS cache |
| `artifacts/api-server/src/lib/strategistTapeBackfill.ts` phase 1 insert | **No** (explicit `nbbo: null`) | N/A |
| `artifacts/api-server/src/lib/strategistTapeBackfill.ts` phase 2 update | Yes | REST quotes window |
| `artifacts/api-server/src/lib/optionsTradeReclassifier.ts` | Yes | REST narrow window |

---

## 3. Current classification path (tape backfill job)

**Primary file:** `artifacts/api-server/src/lib/strategistTapeBackfill.ts`.

**Polygon trade query:** Per OCC, paginated `GET /v3/trades/{occ}?timestamp.gte=...&timestamp.lte=...` (see `tradeUrl` near line ~714 in that file).

**Price-vs-bid-ask comparison:** Delegated to:

1. `classifyForFlowPersistence` (`artifacts/api-server/src/lib/optionsTradeClassifier.ts`)  
2. `classifyAggressorFromNbbo(tradePrice, bid, ask)` (`artifacts/api-server/src/lib/flowAggressorSide.ts`): Lee-Ready style with epsilon `max($0.01, 0.5% of midpoint)`.

**Phase 1:** Builds rows with `side: null`, `aggressorConfidence: "unknown"`, still computes sweep/block/large flags and notional.

**Phase 2:** For each parsed trade, `nbboAtOrBefore(quotes, t.tsMs)` then `classifyForFlowPersistence({ ..., nbbo: nb })`, then `UPDATE options_flow_raw_trades SET side, aggressorConfidence, ... WHERE ... isNull(side)` matching `source_trade_id`.

**Where `ask_pct` / `bid_pct` / `mid_pct` live:** These are **not** columns on `options_flow_raw_trades`. They appear when **`polygonFlowHighlights.ts`** aggregates session prints: it loads `side` from DB (`ask` / `bid` / `mid` / null to unknown bucket) and computes percentages over print counts and notionals (`askPct`, `bidPct`, `midPct` on in-memory structures).

Timeouts / budget: `runStrategistTapeBackfill` uses phase budgets (`phase1Ms`, `phase2Ms`, per-OCC deadlines); incomplete phase 2 leaves `side` null for some rows.

---

## 4. Injection point candidates

| # | File | Function | Reachable NBBO | Lookup latency | OCC universe | Existing persisted fields |
|---|------|----------|----------------|----------------|--------------|----------------------------|
| 1 | `artifacts/api-server/src/lib/polygonOptionsWs.ts` | `handleMessage` (`Q` branch) / `getNbbo` | WS quote cache | O(1) map read | Subscribed OCCs only | Cache only (not DB) |
| 2 | `optionsWatcher.ts` | `handleTrade` | `getNbbo(t.sym)` | O(1); miss if no prior Q | HOT+WARM subscribed contracts | **`side`**, **`aggressorConfidence`**, sweep/block flags, **`notional`** |
| 3 | `flowCaptureService.ts` | `onTradeHandler` | `getNbbo(sym)` inside async work | O(1); race if T before Q | Caller `occList` | Same columns as row insert |
| 4 | `optionsFlowPersistence.ts` | `enqueueClassifiedTrade` / `flush` | None (caller supplies `side`) | N/A | N/A | Pass-through only |
| 5 | `strategistTapeBackfill.ts` | Phase 1 inner loop (before bulk insert) | Could call REST quotes or WS cache if subscribed | REST: high (HTTP + pages); WS: only if same OCC live | Backfill OCC list (tier-capped chain band) | Phase 1 currently **`side` null**; could set **`side`** / **`aggressorConfidence`** inline |
| 6 | `strategistTapeBackfill.ts` | Phase 2 | Already uses `fetchQuotesWindowed` | Already budgeted | Same as phase 1 | Updates **`side`**, **`aggressorConfidence`**, multi-leg fields |
| 7 | `optionsTradeReclassifier.ts` | `reclassifyUnclassifiedTrades` | `fetchQuotesAroundTrade` | Per row HTTP (deadline-capped) | Rows with `side IS NULL` for ticker | Updates **`side`**, **`aggressorConfidence`** |

**No separate `ask_pct` column** at persistence time; adding one would be denormalized versus deriving in `polygonFlowHighlights` from `side`.

---

## 5. Backfill compatibility

- **Canonical columns today:** `side` (string: ask / bid / mid / null), `aggressorConfidence` (high / medium / low / unknown).
- **Phase 2** and **`reclassifyUnclassifiedTrades`** both update only rows that still have null `side`. If phase 1 (or inline ingest) **populates `side`**, later jobs **skip** those rows (no overwrite conflict).
- **Conflict risk:** If two writers set **`side`** differently for the same row, you would need a rule (for example trust REST replay over WS, or latest timestamp wins). Today's pipeline avoids overlap by writing null first then filling once.
- **Recommendation:** Keep **one pair** of columns (`side`, `aggressorConfidence`). Use phase 2 / reclassifier strictly as **gap-fill** for null side. Optional new columns (for example `side_source`, `nbbo_ts_ms`) would disambiguate provenance without fighting over `side`.

---

## Path index (repository paths)

- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/lib/polygonOptionsWs.ts`
- `artifacts/api-server/src/lib/optionsWatcher.ts`
- `artifacts/api-server/src/lib/flowCaptureService.ts`
- `artifacts/api-server/src/lib/optionsFlowPersistence.ts`
- `artifacts/api-server/src/lib/optionsTradeClassifier.ts`
- `artifacts/api-server/src/lib/flowAggressorSide.ts`
- `artifacts/api-server/src/lib/strategistTapeBackfill.ts`
- `artifacts/api-server/src/lib/optionsQuoteNbbo.ts`
- `artifacts/api-server/src/lib/optionsTradeReclassifier.ts`
- `artifacts/api-server/src/lib/polygonFlowHighlights.ts`
- `artifacts/api-server/src/lib/strategistV2.ts`
- `artifacts/api-server/src/lib/schwabStreamer.ts`
- `artifacts/api-server/src/lib/polygonChain.ts`
- `lib/db/src/schema/index.ts`
