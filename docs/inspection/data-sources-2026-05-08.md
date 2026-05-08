# Data source wiring inspection (HTTP API backend package)

**Scope:** Static inspection of the `artifacts/` TypeScript server package only (no runtime probes).  
**Date:** 2026-05-08  
**Focus:** Live subscriptions, scheduled jobs, and active REST/WebSocket paths for Schwab, IBKR (Gateway), Polygon, and FMP.

---

## Phase 1 — Schwab streamer

**Implementation:** `src/lib/schwabStreamer.ts`  
**Boot / lifecycle:** Server starts the streamer when valid trader tokens exist (`src/index.ts` deferred init), unless `DISABLE_SCHWAB_STREAMER=1` or `true`. Token refresh can start or augment subscriptions. There is **no** `UNSUBS` path in this module: equity/futures/option subscription sets only grow; Schwab receives full replacement `SUBS` lists when new keys are added after LOGIN.

### Subscription services wired (actual code)

| Service | Purpose (fields) | Symbol source | Lifecycle |
|--------|------------------|---------------|-----------|
| `ADMIN` | `LOGIN` | OAuth token + `userPreference.streamerInfo` | Every connect |
| `LEVELONE_EQUITIES` | L1 equity/index quote stream (`EQ_FIELDS`) | Union built from: (1) `ensurePulseSubscriptions()` in `liveMarketIndicators.ts` (non-breadth, non-`$` vol entries from `PULSE_SYMBOLS` — e.g. SPY, HYG, `/DX` skipped in equity list); (2) hardcoded `SCHWAB_EQUITY_SYMS` / `_EARLY` on boot and token refresh in `index.ts`; (3) client-driven `addSymbols` via WebSocket (`wsServer.ts` — tickers clients watch); (4) `POST /api/stream/start` & `/symbols` (`routes/stream.ts`); (5) equity underlyings derived from **portfolio positions** when portfolio polling runs (`wsServer.ts` — adds holdings’ equity/ETF/index symbols). **Liquid Core 130 is not bulk-subscribed here by default.** | Always-on while connected once symbols are in the set; portfolio adds symbols on each poll when positions exist |
| `LEVELONE_FUTURES` | L1 futures (`FUT_FIELDS`) | Same pattern: `SCHWAB_FUTURES_SYMS` hardcoded lists in `index.ts`, `ensurePulseSubscriptions()` futures leg, portfolio `FUTURE` positions, `POST /stream`, WS client watchlists | Same |
| `LEVELONE_OPTIONS` | L1 option contract quotes | Portfolio `OPTION` / `INDEX_OPTION` symbols; `POST /api/stream/option-symbols`; `routes/market.ts` adds chain contract keys when serving option chain requests | On-demand / portfolio-driven |
| `LEVELONE_FUTURES_OPTIONS` | L1 futures options | Portfolio `FUTURE_OPTION` symbols; `POST /api/stream/option-symbols` (keys prefixed `./`) | On-demand / portfolio-driven |
| `ACCT_ACTIVITY` | Order / account events (`keys` = `schwabClientCorrelId`, fields `0–3`) | Account-level (Streamer correlator id) | Sent after successful `LOGIN` each session; confirmation tracked in-module |

### Not present in code (explicitly)

- No `CHART_EQUITY`, `CHART_FUTURES`, `TIMESALE_EQUITY`, `TIMESALE_FUTURES`, `NYSE_BOOK`, `NASDAQ_BOOK`, `OPTIONS_BOOK`, or similar Level-2/time-series services appear in `buildRequest` / handlers.

### Feature flags / kill switches

- **`DISABLE_SCHWAB_STREAMER`:** When `1` or `true`, streamer is not started on boot; token refresh still calls `addFuturesSymbols` / `addSchwabSymbols` in one branch — subscription state may update but no live socket without connect (see `index.ts`).

---

## Phase 2 — IBKR streamer (Gateway / tunnel)

**TCP target:** `IBApi` connects to `host`/`port` from `IBKR_GATEWAY_URL` or `IB_HOST`, defaulting to `127.0.0.1:4001` (`ibStreamer.ts`).  
**WebSocket bridge:** If `IBKR_GATEWAY_URL` / `IB_HOST` is `ws:`/`wss:`, `ibWsProxy.ts` listens on **local TCP port 4001** and tunnels to the remote WebSocket (typical for Cloudflare-to-Mac Gateway setups). The hostname `ibkr.nucolbyterminal.com` is **not** hardcoded; it must be supplied via environment.

### Always-on / connect-time subscriptions

| Mechanism | API | Symbol scope | Notes |
|-----------|-----|--------------|-------|
| **Breadth + vol + macro “permanent” L1** | `reqMktData` (empty generic tick list) | **Not** the full `ibBreadthSymbols.ts` list: only symbols registered via `registerPermanentSymbols()`. Today that is the **breadth cluster + `$…` volatility indices** from `PULSE_SYMBOLS` (**23 display symbols**), registered at module load in `liveMarketIndicators.ts`. | Other `ALL_BREADTH_SYMBOLS` rows remain in config but are **not** subscribed unless they share `reqId` paths used elsewhere (they do not for disabled rows). |
| **NYSE closing auction imbalance** | `reqMktData` with **generic tick `225`** | **NYSE-listed Liquid Core names** — `IMBALANCE_SYMBOLS` derived from `LIQUID_CORE_SYMBOLS` where `primaryListing === "NYSE"` (**74 symbols** in current data file). | Distinct `reqId` block starting `12000`. |
| **Static market depth** | `reqMktDepth` | `/NQ` (CME front month), `SPY` (SMART, `isSmartDepth=true`), **10 levels** each (`DEPTH_SYMBOLS`). | Refreshed on each `subscribeDepth()` |
| **ES futures depth** | `reqMktDepth` | Front-month **ES** on **CME**, **5 levels**, `reqId` `14000` (`ES_DEPTH_SYMBOL_DEF`). | Persists summaries via `ibEsDepthPersistence` |
| **News** | `reqNewsProviders`, `reqNewsBulletins(true)` | Symbol-agnostic | Live bulletins + provider list; historical news by contract via `fetchNewsForSymbol` |

### Dynamic / LRU pools (on demand)

| Pool | API | Capacity / TTL | Wired by |
|------|-----|----------------|----------|
| **Nasdaq TotalView-style book** | `reqMktDepth` on `STK` / `NASDAQ`, **5 levels** | **30** slots, **10 min** TTL (`ibDynamicSubscriptionManager.ts`) | `acquireDynamicIbPool("totalview", symbol)` — **Strategist v2** (`strategistV2.ts`) |
| **Cboe One consolidated L1** | `reqMktData` on `STK` / exchange **`CBOE`** (`ibCboeOneSymbols.ts`) | **50** slots, **10 min** TTL | `acquireDynamicIbPool("cboeOne", symbol)` — merges into Schwab cache via `injectCboeOneConsolidatedQuote` |
| **On-demand equity/index/fut L1** | `reqMktData` | **95** concurrent `reqMktData` lines (`MAX_DYNAMIC_QUOTE_SLOTS`), LRU eviction | `subscribeQuoteForSymbol` — **`routes/market.ts`** (e.g. when clients need IB fallback quote) |
| **On-demand depth** | `reqMktDepth` | Unbounded map `dynamicDepthSymbols` (per-symbol manual unsubscribe API exists) | `subscribeDepthForSymbol` / `unsubscribeDepthForSymbol` |

### Symbol-agnostic vs symbol-scoped

- **Symbol-agnostic:** News bulletins/providers; stale-breadth watchdog in the 30s summary timer (telemetry only).
- **Symbol-scoped:** Everything else above.

### Config entries “wired but disabled”

In `ibBreadthSymbols.ts`, `enabled: false` skips symbols in `getEnabledSymbols()` (examples: `$SKEW`, `/DX`, many CBOE put/call ratio indices like `$CPC`, `$CPCE`, `$PCSPY`, …). Those **`reqId`s are never subscribed** in the current `subscribeAll` loop.

### Separate diagnostic path (not general market stack)

- **`ibkrTickEntitlementPilot.ts` + admin route:** One-off tick-by-tick entitlement test; writes `ibkr_diagnostics_runs`. Not part of continuous scanner/strategist wiring.

---

## Phase 3 — Polygon

### Unusual options activity / flow — live paths

1. **`polygonUnusualFlowScan.ts` (orchestrator)**  
   - **REST:** `fetchPolygonChain` per underlying (`polygonChain.ts`) to pick ATM/near-DTE contracts.  
   - **WebSocket:** `wss://socket.polygon.io/options` via `polygonOptionsWs.ts`.  
   - **Channels:** **`T.{OCC}`** per contract only (`subscribeContracts`) — **not** a firehose `T.*`.  
   - **Filter:** Contract list is **explicit OCC list** from chain selection; underlying tickers come from **caller-supplied `FlowScanInput.tickers`**.  
   - **Env gate:** `POLYGON_OPTIONS_WS_ENABLED=1` required; otherwise throws / disabled.

2. **`optionsWatcher.ts` (persistent watcher)**  
   - **REST:** `fetchPolygonChain` on a schedule (**30 min** chain refresh) and on tier changes.  
   - **WebSocket:** `subscribeContractsWithQuotes` → **`T.{OCC}` + `Q.{OCC}`** (NBBO for aggressor inference).  
   - **Symbol set:** **HOT/WARM/COLD tiers**; HOT/WARM sizes capped (`HOT_TICKERS_MAX=30`, `WARM=50`, contracts per tier). Populated from **deterministic scanner outputs** (`setWatchlist` callers), not a static file.  
   - **Same env gate** as above.

3. **`flowCaptureService.ts` & `flowTimeSalesHub.ts`**  
   - Use **`subscribeContractsWithQuotes`** for session captures / SSE time & sales (per-contract `T` + `Q`).

### Polygon REST polling (live cadence)

- **Put/call volume ratios:** `polygonPutCallRatio.ts` — **`/v3/snapshot/options/{underlying}`** paginated, **`SPY`** and **`SPX`**, **`60s`** interval (`startPolygonPCRatioPoller` from `index.ts`). Feeds `liveMarketIndicators` display names `$PCUSEQTR` / `$PCUSINXR`.

### Scheduled / batch Polygon usage

- **Daily snapshot job** (`index.ts` → `runFullSnapshot` / `dailySnapshot.ts`): Schwab token + **Polygon chain/IV** processing for **`LIQUID_CORE_SYMBOL_STRINGS` ∪ active `tracked_tickers`** (see `getDailySnapshotSymbols`). Populates `equity_daily`, options tables, IV, HV, etc.  
- **Equity daily grouped bars backfill** (`updateEquityDailyFromGroupedBars`): Polygon aggregates for LC130 when boot detects thin history (`index.ts` `triggerLiquidCoreBackfill`).  
- **Flow aggregates bootstrap:** `backfillPolygonFlow` — **30-day** REST backfill when `flow_daily_aggregates` empty (`triggerFlowBootstrap`).  
- **Polygon flat-file nightly sync:** `schedulePolygonFlatFilesSync` — **03:30 UTC** daily for **prior trading day**, universe **`LIQUID_CORE_SYMBOL_STRINGS`**, gated by vendor flat-file env toggles and catch-up settings (`index.ts`). <!-- pragma: allowlist secret -->
- **Scanner snapshot worker:** `snapshotRefreshWorker.ts` — **`30s`** during **09:00–16:30 ET** weekdays for **LC130**; uses `fetchPolygonChain`, `polygonFlowHighlights`, `fetchEarningsHistoryAndForward`, etc.

### Other on-demand Polygon REST (representative)

- **`polygonChain.ts`:** Option chain for user/strategist/scanner paths.  
- **`optionsQuoteNbbo.ts`:** `/v3/quotes` paged fetch for trade classification.  
- **`polygonAnalystData.ts`:** Benzinga partner endpoints under `api.polygon.io`.  
- **`polygonReferenceContracts.ts`, `polygonTickerMarketCap.ts`, `polygonMarketCalendar.ts`, `scannerTechnicalContext.ts`:** Reference, market cap fallback, calendar, daily bars fallback.  
- **Rate / plan probe:** `polygonRateProbe.ts`.

---

## Phase 4 — FMP

**Boot:** `getFmpApiKeyOrThrow()` in `index.ts` — server exits if `FMP_API_KEY` missing.

### Scheduled jobs (from `src/index.ts`)

| Job | Cadence | Endpoints (via `fmpClient.ts` / `fmpBackfill.ts`) | Symbol / scope |
|-----|---------|---------------------------------------------------|----------------|
| **Canonical IV accumulator** | Daily **22:00 UTC** | Reads **DB** `options_chain_daily` / `equity_daily` (Schwab snapshot output), not FMP | Symbols present in chain table for that date |
| **`runFmpEarningsBackfill`** (= `backfillEarningsCalendar`) | Same 22:00 UTC tick | `GET stable/earnings-calendar` | **Next 90 days**, filtered to **Liquid Core 130** |
| **`backfillEconomicCalendar`** | Same 22:00 UTC tick | `GET stable/economic-calendar` | **US macro**, **60-day** window; **symbol-agnostic** |
| **Weekly analyst / surprises / estimates** | **Sunday 23:00 UTC** | `price-target-consensus`, `grades`, `earnings` (surprises), `analyst-estimates` | **Per LC130 symbol** (full loops in `fmpBackfill.ts`) |
| **Daily screen refresh** | **~13:00 ET** (computed from UTC in `scheduleDailyScreenRefresh`) | **`/api/v3/stock-screener`** (`fmpScreener.ts`) | Filter-driven universe (not fixed 130) |
| **Macro calendar cache warm** | Boot (best-effort) | DB → `refreshMacroCalendarCacheFromDb` | Derived from persisted FMP macro rows |

### Batch backfill functions in `fmpBackfill.ts` (invoked by scripts / ops, not all from `index.ts`)

- **`backfillEquityDailyHistory`:** `historical-price-eod/full` — **LC130**, from fixed start `2021-01-01`.  
- **`syncCorporateEventsForTuningSymbol`:** Chunked `earnings-calendar` with **symbol filter**, `earnings`, `splits` — used by **tuning backfill job** (`jobs/tuningUniverseBackfill.ts`), not the main server loop.

### On-demand FMP (representative)

- **`scannerCatalysts`:** `getFmpDividendsCalendar` for **ex-div** map over **scanner symbol batch** (180-day horizon request).  
- **`fmpScreener`:** Scanner routes (`routes/scanner.ts`).  
- **`fmpDataService` / `earningsService`:** Read **DB** rows originally populated by FMP (and Benzinga primary vendor for “next earnings” — outside FMP).  
- **`polygonAnalystData.mergeFmpPriceTargetIntoConsensus`:** merges FMP price targets when present.

---

## Phase 5 — Cross-source coverage map (scanner / strategist consumption)

**Legend — tuning universe column:** **Covered** = same pipelines as LC130 production (scanner worker, FMP LC backfills, Polygon options paths) apply **if** the symbol is in LC130 or receives the same jobs. **Partial** = available only when symbol is in LC130, on a watchlist/client subscription, or manual route. **Not covered** = no automatic wiring for that symbol class. **Symbol-agnostic** = market-wide.

Rows reference **where the wiring exists in this repo**, not commercial entitlement status.

| Data type | Schwab | IBKR | Polygon | FMP | Tuning universe (22-name bench) |
|-----------|--------|------|---------|-----|----------------------------------|
| **Equity price (L1)** | `LEVELONE_EQUITIES` + futures service for `/` symbols; portfolio/client augment | Permanent **23** breadth/vol + **dynamic** `subscribeQuoteForSymbol` | None for equity L1 | None | **Partial** — only names also subscribed via pulse/portfolio/WS client; **no** dedicated `TUNING_SYMBOLS` streamer hook in code (see Open questions) |
| **Time & sales (equity)** | Not wired (no `TIMESALE_*`) | Not wired as consolidated tape | None in inspected paths | None | **Not covered** |
| **Time & sales (options)** | Not primary | Not primary | **`T.{OCC}`** on options WS (`polygonOptionsWs`) | None | **Partial** — only if name is in scanner-driven watcher / flow scan / capture |
| **Equity book depth** | None | `reqMktDepth` **/NQ**, **SPY**; **ES** depth; **dynamic** SMART/FUT depth; TotalView pool for NASDAQ L2 summaries | None | None | **Partial** — on-demand only (`subscribeDepthForSymbol`, strategist TotalView pool) |
| **Breadth / internals** | Duplicates some indices on Schwab stream for pulse, but strategist pulse **prefers IB** for breadth keys | **Permanent** `reqMktData` on **23** pulse breadth/vol symbols | None | None | **Symbol-agnostic** (indices) |
| **Imbalance (closing auction)** | None | **Generic tick 225** on **NYSE LC** names | None | None | **Partial** — only if ticker is NYSE-listed LC name |
| **Options flow / UOA** | None | None | **WS** scan + watcher + flow capture; **REST** flow backfill & highlights | None | **Partial** — watcher is **scanner-ranked**, not static 22 |
| **Options chain snapshots** | `routes/market.ts` uses Schwab API for chains (outside streamer) | Not primary | **`fetchPolygonChain`** widely | None | **Partial** — chain pulls are **on demand** per ticker |
| **Options NBBO streaming** | `LEVELONE_OPTIONS` when subscribed | None | **`Q.{OCC}`** when using `subscribeContractsWithQuotes` | None | **Partial** |
| **Earnings calendar** | Not primary | None | Benzinga via Polygon for history | **`earnings-calendar` → `corporate_events`** (LC130 schedule + tuning job) | **Partial** — FMP tuning sync is **CLI job**; live server uses LC130 schedule |
| **EPS estimate (forward)** | Not primary | None | Analyst endpoints optional | **Calendar + analyst-estimates** rows | **Partial** |
| **EPS actual** | Not primary | None | Earnings history module uses DB | **`/earnings` surprises** backfill | **Partial** |
| **Revenue estimate / actual** | Not primary | None | Via Polygon/FMP composites in DB | FMP calendar + surprises | **Partial** |
| **Dividends** | Not primary | None | None in core paths | **`dividends-calendar`** in catalyst layer | **Partial** |
| **Splits** | Not primary | None | None | **`splits`** in `syncCorporateEventsForTuningSymbol` / corporate_events | **Partial** |
| **HV20 / HV30 / HV60** | Not primary | None | Optional **daily bars** fallback for history | **FMP EOD** can populate `equity_daily`; HV computed in **`dailySnapshot` / backfill jobs** from closes | **Covered** for symbols in **`equity_daily`** refresh universe (LC130 + tracked); tuning names need to be in that universe or backfilled manually |

---

## Open questions

1. **Tuning universe vs streaming:** `src/data/tuningUniverse.ts` states all 22 names are persistently subscribed on Schwab and IBKR; **no** `TUNING_SYMBOLS` registration appears in `index.ts`, `schwabStreamer.ts`, or `ibStreamer.ts`. Actual streaming follows **pulse lists, portfolio, clients, and LC130 batch jobs**, not that file. Confirm intended behavior.

2. **Commercial entitlements:** Schwab streamer field sets, Polygon plan tier, FMP plan limits, and **IBKR market data subscriptions** (CBOE One, TotalView, NYSE imbalance tick 225, etc.) cannot be verified from the repo.

3. **Live runtime:** Gateway host reachable, Cloudflare tunnel mapping (attached assets suggest port **7497** in some configs vs API default **4001**), and whether production `IBKR_GATEWAY_URL` matches the stoqey client’s expectation.

4. **Schwab subscription growth:** No `UNSUBS` implementation — long-running processes may retain stale symbols until reconnect logic or process restart.

5. **Next earnings at API read path:** `earningsService.ts` prefers **Benzinga** vendor API for forward calendar; FMP is secondary via DB. Not one of the four requested vendors but affects “earnings calendar” in production.

6. **Put/call display:** CBOE index put/call rows in `ibBreadthSymbols.ts` are **disabled**; UI ratios `$PCUSEQTR` / `$PCUSINXR` are **Polygon snapshot volume math**, not live CBOE index ticks.
