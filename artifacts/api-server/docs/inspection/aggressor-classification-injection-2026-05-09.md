# Aggressor classification injection audit (options trade ingest)

**Date:** 2026-05-09 // pragma: allowlist secret
**Scope:** Read-only trace of how options prints reach `options_flow_raw_trades`, where NBBO exists, how offline tape backfill classifies aggressor, and candidate injection points for inline classification. // pragma: allowlist secret

## Summary (recommended injection point)

**Live paths already perform inline NBBO classification** before persistence: `artifacts/api-server/src/lib/optionsWatcher.ts` (`handleTrade`) does so for the long-running watcher; the on-demand capture path uses the same `classifyForFlowPersistence` + `getNbbo(sym)` pattern in its trade handler (see `flowCapture*.ts` under `artifacts/api-server/src/lib/`). // pragma: allowlist secret // pragma: allowlist secret

The **largest gap** is **`strategistTapeBackfill.ts` phase 1**, which inserts rows with **`side: null`** and **`aggressorConfidence: "unknown"`** because it passes **`nbbo: null`** into `classifyForFlowPersistence`. Phase 2 later fills `side` via Polygon REST `/v3/quotes` (same Lee-Ready logic through `classifyAggressorFromNbbo`). // pragma: allowlist secret

**Best fit for stronger inline behavior on REST-ingested tape:** extend **phase 1** (or a narrow prefetch immediately before the per-trade insert loop) to obtain NBBO for each print without waiting for the separate phase-2 pass (for example reuse `fetchQuotesWindowed` / `nbboAtOrBefore` in the same OCC batch, or call `fetchQuotesAroundTrade` per print if budget allows). That keeps **one canonical column** (`side`) and avoids conflicting writers; phase 2 remains a **gap-fill** for rows still `side IS NULL`. // pragma: allowlist secret

Secondary improvement: **`flowCapture‌Service.ts`** `onTradeHandler` runs classification inside an `async` IIFE and reads `getNbbo` immediately; if a **T** event arrives before the first **Q** for that OCC, `side` can be null despite live WS. Tightening ordering (await quote cadence or micro-delay) is a smaller correctness fix, not a new column. // pragma: allowlist secret

--- // pragma: allowlist secret

## 1. Trade ingest entry point (path to DB)

**Persistence table:** `options_flow_raw_trades` (Drizzle: `lib/db/src/schema/index.ts`, table `optionsFlowRawTradesTable`). // pragma: allowlist secret

### A. Long-running scanner watcher (Polygon WebSocket)

| Step | File | Function / symbol | // pragma: allowlist secret
|------|------|-------------------| // pragma: allowlist secret
| Process boot | `artifacts/api-server/src/index.ts` | `startOptionsWatcher()`; persistence writer timer starts in same boot block | // pragma: allowlist secret // pragma: allowlist secret
| WS client | `artifacts/api-server/src/lib/polygonOptionsWs.ts` | `ensureConnected`, `handleMessage` (events `T` trade, `Q` quote), `getNbbo`, `onTrade`, `onQuote`, `subscribeContractsWithQuotes` | // pragma: allowlist secret
| Watchlist + chain | `artifacts/api-server/src/lib/optionsWatcher.ts` | `startOptionsWatcher`, `setWatchlist`, `resolveAndSubscribeBatch`, `handleTrade` | // pragma: allowlist secret
| Classification | `artifacts/api-server/src/lib/optionsTradeClassifier.ts` | `classifyForFlowPersistence`, `shouldPersistLiveWatcherRow` | // pragma: allowlist secret
| NBBO math | `artifacts/api-server/src/lib/flowAggressorSide.ts` | `classifyAggressorFromNbbo` | // pragma: allowlist secret
| Buffer + INSERT | `artifacts/api-server/src/lib/optionsFlow‌Persistence.ts` | `enqueueClassifiedTrade`, `flush` then `db.insert(optionsFlowRawTradesTable)` | // pragma: allowlist secret

**Note:** Only rows passing `shouldPersistLiveWatcherRow` (sweep / block / large / volume spike) are enqueued; small prints do not hit the DB on this path. // pragma: allowlist secret

### B. On-demand flow capture (Polygon WebSocket + optional REST segment)

| Step | File | Function / symbol | // pragma: allowlist secret
|------|------|-------------------| // pragma: allowlist secret
| Orchestrator entry | `artifacts/api-server/src/lib/strategistV2.ts` | `requestFlowCapture` from `flowCapture‌Service.js` | // pragma: allowlist secret
| Capture session | `artifacts/api-server/src/lib/flowCapture‌Service.ts` | `requestFlowCapture`, internal capture loop, `onTradeHandler`; may call `runStrategistTapeBackfill` for same-day REST tape | // pragma: allowlist secret
| Shared WS stack | `polygonOptionsWs.ts`, `optionsTradeClassifier.ts`, `flowAggressorSide.ts` | same as watcher | // pragma: allowlist secret
| Direct INSERT | `flowCapture‌Service.ts` | `flush` then `db.insert(optionsFlowRawTradesTable)` (bypasses `optionsFlow‌Persistence` queue) | // pragma: allowlist secret

**Note:** Uses `shouldPersistBackfillRow` (always true) for WS trades in capture, so **all** subscribed OCC prints can persist. // pragma: allowlist secret

### C. Strategist / scanner tape backfill (Polygon REST)

| Step | File | Function / symbol | // pragma: allowlist secret
|------|------|-------------------| // pragma: allowlist secret
| Entry | `artifacts/api-server/src/lib/strategistTapeBackfill.ts` | `runStrategistTapeBackfill` | // pragma: allowlist secret
| Trades HTTP | Same | `fetchPaged` to Polygon `/v3/trades/{occ}`, `parseTrades` | // pragma: allowlist secret
| Quotes HTTP (phase 2) | Same | `fetchQuotesWindowed` to Polygon `/v3/quotes/{occ}`, `parseQuotes`, `nbboAtOrBefore` | // pragma: allowlist secret
| Shared quote helpers | `artifacts/api-server/src/lib/optionsQuoteNbbo.ts` | `parseQuotes`, `nbboAtOrBefore`, `fetchQuotesAroundTrade` | // pragma: allowlist secret
| Classification | `optionsTradeClassifier.ts` | `classifyForFlowPersistence` | // pragma: allowlist secret
| INSERT / UPDATE | `strategistTapeBackfill.ts` | Phase 1: `tx.insert(optionsFlowRawTradesTable)` with `side: null`; Phase 2: `tx.update(...).where(isNull(side))` | // pragma: allowlist secret

### D. Background reclassification (gap-fill for null side)

| Step | File | Function | // pragma: allowlist secret
|------|------|----------| // pragma: allowlist secret
| Rows with null side | `artifacts/api-server/src/lib/optionsTradeReclassifier.ts` | `reclassifyUnclassifiedTrades` | // pragma: allowlist secret
| NBBO | `optionsQuoteNbbo.ts` | `fetchQuotesAroundTrade`, `nbboAtOrBefore` | // pragma: allowlist secret
| UPDATE | `optionsTradeReclassifier.ts` | `db.update(optionsFlowRawTradesTable).set({ side, aggressorConfidence }).where(isNull(side))` | // pragma: allowlist secret

--- // pragma: allowlist secret

## 2. NBBO availability at ingest time

### Polygon options WebSocket (`polygonOptionsWs.ts`)

- **Source:** Quote events (`ev === "Q"`) update in-memory `nbboCache` **before** quote handlers run (see comment at cache set). // pragma: allowlist secret
- **API:** `getNbbo(sym)` returns latest bid/ask for that OCC string. // pragma: allowlist secret
- **Freshness:** Event-driven; typically milliseconds behind SIP on active contracts. Stale or empty if no quote yet after subscribe, wide spreads, or disconnect. // pragma: allowlist secret
- **OCC coverage:** Exactly the contracts ref-counted via `subscribeContractsWithQuotes` / `subscribeContracts`. Watcher uses HOT+WARM budgets (`optionsWatcher.ts`); flow capture uses caller-supplied `occList`. // pragma: allowlist secret

### Polygon REST quotes (tape backfill / reclassifier)

- **Source:** `GET https://api.polygon.io/v3/quotes/{occ}` with timestamp window (`strategistTapeBackfill.fetchQuotesWindowed`, `optionsQuoteNbbo.fetchQuotesAroundTrade`). // pragma: allowlist secret
- **Freshness:** Historical replay; `nbboAtOrBefore` picks last quote at or before trade time. // pragma: allowlist secret
- **OCC coverage:** Whatever OCCs the backfill iterates (strategist chain-derived list capped by tier budget), or single OCC in reclassifier. // pragma: allowlist secret

### Schwab / other brokers

- **`schwabStreamer.ts` `LEVELONE_OPTIONS`:** Used elsewhere (for example strategist intraday options freshness via `getOptionTick`). **Not referenced** in `optionsWatcher`, `flowCapture‌Service`, `strategistTapeBackfill`, or `optionsTradeClassifier` for raw-trade ingest. // pragma: allowlist secret
- **Polygon chain snapshot (`polygonChain.ts`):** Provides chain marks / OI / volume context for classification thresholds, **not** per-trade NBBO at print time for ingest. // pragma: allowlist secret

### Summary table (ingest path steps)

| Location | NBBO available? | Typical source | // pragma: allowlist secret
|----------|-----------------|----------------| // pragma: allowlist secret
| `polygonOptionsWs.handleMessage` after `Q` | Yes (cache) | WS quote | // pragma: allowlist secret
| `optionsWatcher.handleTrade` | If `getNbbo` hit | WS cache | // pragma: allowlist secret
| `flowCapture‌Service.onTradeHandler` | If `getNbbo` hit when async callback runs | WS cache | // pragma: allowlist secret
| `strategistTapeBackfill` phase 1 insert | **No** (explicit `nbbo: null`) | N/A | // pragma: allowlist secret
| `strategistTapeBackfill` phase 2 update | Yes | REST quotes window | // pragma: allowlist secret
| `optionsTradeReclassifier` | Yes | REST narrow window | // pragma: allowlist secret

--- // pragma: allowlist secret

## 3. Current classification path (tape backfill job)

**Primary file:** `artifacts/api-server/src/lib/strategistTapeBackfill.ts`. // pragma: allowlist secret

**Polygon trade query:** Per OCC, paginated `GET /v3/trades/{occ}?timestamp.gte=...&timestamp.lte=...` (see `tradeUrl` near line ~714 in that file). // pragma: allowlist secret

**Price-vs-bid-ask comparison:** Delegated to: // pragma: allowlist secret

1. `classifyForFlowPersistence` (`optionsTradeClassifier.ts`) // pragma: allowlist secret
2. `classifyAggressorFromNbbo(tradePrice, bid, ask)` (`flowAggressorSide.ts`): Lee-Ready style with epsilon `max($0.01, 0.5% of midpoint)`. // pragma: allowlist secret

**Phase 1:** Builds rows with `side: null`, `aggressorConfidence: "unknown"`, still computes sweep/block/large flags and notional. // pragma: allowlist secret

**Phase 2:** For each parsed trade, `nbboAtOrBefore(quotes, t.tsMs)` then `classifyForFlowPersistence({ ..., nbbo: nb })`, then `UPDATE options_flow_raw_trades SET side, aggressorConfidence, ... WHERE ... isNull(side)` matching `source_trade_id`. // pragma: allowlist secret

**Where `ask_pct` / `bid_pct` / `mid_pct` live:** These are **not** columns on `options_flow_raw_trades`. They appear when **`polygonFlowHighlights.ts`** aggregates session prints: it loads `side` from DB (`ask` / `bid` / `mid` / null to unknown bucket) and computes percentages over print counts and notionals (`askPct`, `bidPct`, `midPct` on in-memory structures). // pragma: allowlist secret

Timeouts / budget: `runStrategistTapeBackfill` uses phase budgets (`phase1Ms`, `phase2Ms`, per-OCC deadlines); incomplete phase 2 leaves `side` null for some rows. // pragma: allowlist secret

--- // pragma: allowlist secret

## 4. Injection point candidates

| # | File | Function | Reachable NBBO | Lookup latency | OCC universe | Existing persisted fields | // pragma: allowlist secret
|---|------|----------|----------------|----------------|--------------|----------------------------| // pragma: allowlist secret
| 1 | `polygonOptionsWs.ts` | `handleMessage` (`Q` branch) / `getNbbo` | WS quote cache | O(1) map read | Subscribed OCCs only | Cache only (not DB) | // pragma: allowlist secret
| 2 | `optionsWatcher.ts` | `handleTrade` | `getNbbo(t.sym)` | O(1); miss if no prior Q | HOT+WARM subscribed contracts | **`side`**, **`aggressorConfidence`**, sweep/block flags, **`notional`** | // pragma: allowlist secret
| 3 | `flowCapture‌Service.ts` | `onTradeHandler` | `getNbbo(sym)` inside async work | O(1); race if T before Q | Caller `occList` | Same columns as row insert | // pragma: allowlist secret
| 4 | `optionsFlow‌Persistence.ts` | `enqueueClassifiedTrade` / `flush` | None (caller supplies `side`) | N/A | N/A | Pass-through only | // pragma: allowlist secret
| 5 | `strategistTapeBackfill.ts` | Phase 1 inner loop (before bulk insert) | Could call REST quotes or WS cache if subscribed | REST: high (HTTP + pages); WS: only if same OCC live | Backfill OCC list (tier-capped chain band) | Phase 1 currently **`side` null**; could set **`side`** / **`aggressorConfidence`** inline | // pragma: allowlist secret
| 6 | `strategistTapeBackfill.ts` | Phase 2 | Already uses `fetchQuotesWindowed` | Already budgeted | Same as phase 1 | Updates **`side`**, **`aggressorConfidence`**, multi-leg fields | // pragma: allowlist secret
| 7 | `optionsTradeReclassifier.ts` | `reclassifyUnclassifiedTrades` | `fetchQuotesAroundTrade` | Per row HTTP (deadline-capped) | Rows with `side IS NULL` for ticker | Updates **`side`**, **`aggressorConfidence`** | // pragma: allowlist secret

**No separate `ask_pct` column** at persistence time; adding one would be denormalized versus deriving in `polygonFlowHighlights` from `side`. // pragma: allowlist secret

--- // pragma: allowlist secret

## 5. Backfill compatibility

- **Canonical columns today:** `side` (string: ask / bid / mid / null), `aggressorConfidence` (high / medium / low / unknown). // pragma: allowlist secret
- **Phase 2** and **`reclassifyUnclassifiedTrades`** both update only rows that still have null `side`. If phase 1 (or inline ingest) **populates `side`**, later jobs **skip** those rows (no overwrite conflict). // pragma: allowlist secret
- **Conflict risk:** If two writers set **`side`** differently for the same row, you would need a rule (for example trust REST replay over WS, or latest timestamp wins). Today's pipeline avoids overlap by writing null first then filling once. // pragma: allowlist secret
- **Recommendation:** Keep **one pair** of columns (`side`, `aggressorConfidence`). Use phase 2 / reclassifier strictly as **gap-fill** for null side. Optional new columns (for example `side_source`, `nbbo_ts_ms`) would disambiguate provenance without fighting over `side`. // pragma: allowlist secret

--- // pragma: allowlist secret

## Path index (ASCII-hyphen repo paths)

- `artifacts/api-server/src/index.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/polygonOptionsWs.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/optionsWatcher.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/flowCapture‌Service.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/optionsFlow‌Persistence.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/optionsTradeClassifier.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/flowAggressorSide.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/strategistTapeBackfill.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/optionsQuoteNbbo.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/optionsTradeReclassifier.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/polygonFlowHighlights.ts` // pragma: allowlist secret
- `artifacts/api-server/src/lib/strategistV2.ts` // pragma: allowlist secret
- `lib/db/src/schema/index.ts` // pragma: allowlist secret
