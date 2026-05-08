# Conviction Desk strategist — data consumption audit (read-only)

**Date:** 2026-05-08  
**Scope:** Strategist **mode 5 (Conviction Desk)** only — same deterministic **data package** as Solo Desk (mode 4); only the final LLM orchestration differs (`runConvictionDesk`).  
**Validation:** `pnpm tsc --noEmit` at repo root — **pass** (no code changes).

---

## Confirm before building (resolved paths and estimate)

| Question | Resolution |
|----------|------------|
| **Conviction Desk strategist entry point** | HTTP **`POST /api/strategist/analyze`** (`artifacts/api‑server/src/routes/strategistV2.ts`, mounted under `/api` in `artifacts/api‑server/src/app.ts`). Optional **`jobId`** runs analysis in the background; synchronous path calls the same pipeline. Handler **`runAnalyzeWithIvrGate`** wraps **`analyzeTickerV2`** from **`artifacts/api‑server/src/lib/strategistV2.ts`**. When **`strategistMode === 5`** (from DB-backed **`strategist_settings`** via **`getSettings()`**), execution calls **`runConvictionDesk`** in **`artifacts/api‑server/src/lib/strategistDesk.ts`**, which builds the user prompt and invokes **`streamModel(..., CONVICTION_DESK_MODEL_SYSTEM_PROMPT, userPrompt, ...)`** (LLM). |
| **Data layer files (Schwab streamer, IBKR streamer, snapshot worker)** | **Schwab:** `artifacts/api‑server/src/lib/schwabStreamer.ts` (services include `LEVELONE_EQUITIES`, `TIMESALE_EQUITY`, `NYSE_BOOK`, `NASDAQ_BOOK`, `LEVELONE_OPTIONS`, etc.); **tuning registration:** `artifacts/api‑server/src/lib/tuningUniverseRegistrar.ts`. **IBKR:** `artifacts/api‑server/src/lib/ibStreamer.ts` with tuning L1 mapping `artifacts/api‑server/src/lib/ibTuningL1Symbols.ts` (reqId base **16_000**), imbalance symbol union `artifacts/api‑server/src/lib/ibImbalanceSymbols.ts`, dynamic pools `artifacts/api‑server/src/lib/ibDynamicSubscriptionManager.ts`. **Polygon snapshot / scanner refresh:** `artifacts/api‑server/src/lib/snapshotRefreshWorker.ts` (writes **`ticker_signal_snapshot`** and related scanner state). **Strategist-specific IB persistence:** `ibTotalviewPersistence.ts`, `ibImbalancePersistence.ts`, `ibEsDepthPersistence.ts`. |
| **Estimated number of distinct data sources** | **~32** end-to-end source systems or storage surfaces touched on the happy path (counting REST vendors, DB tables, in-memory caches, and optional handoff), before optional **`scannerContext`** or user **`flowContext`**. |

---

## Section 1: Pipeline trace

1. **Client → API:** `POST /api/strategist/analyze` with body `{ ticker, jobId?, flowContext?, scannerContext? }` (`strategistV2.ts`). Optional **`parseScannerContext`** wraps handoff from the scanner UI.
2. **Request context:** `runInStrategistRunContext` (from `strategistRunContext.ts`) runs the analysis so telemetry/diagnostics and optional scanner handoff are available to downstream code.
3. **IVR gate:** `runAnalyzeWithIvrGate` → `ensureIvrCoverage(ticker)` (`onDemandIvrBackfill.ts`). If coverage is not **ready**, the route returns an IVR-preflight result and **does not** call the model.
4. **Core orchestration:** `analyzeTickerV2` → `analyzeTickerV2Inner` (`strategistV2.ts`).
5. **Settings and regime:** `getSettings()` (DB `strategist_settings`); `getCachedRegime() ?? buildFallbackRegime()` (`regimePostProcessor.ts`) — regime is the **in-memory** snapshot last updated by **`updateRegimeFromPulse`** when Market Pulse runs (`routes/ai.ts`), not refetched inside the strategist request.
6. **Toxic / macro gate:** `checkToxicGate` may return early without model call.
7. **Equity quote + fundamentals path:** `fetchTickerData` — **Schwab REST** `GET /marketdata/v1/quotes?...fields=quote,fundamental,reference` (not the Schwab **Level I stream**). Optional **Polygon** market-cap fallback; **`getNextEarningsDate`** / earnings bundle (`earningsService.ts`); sector/volume from Schwab fundamental/quote.
8. **Analyst / FMP enrichment (parallel):** `fetchPolygonAnalystRatingsAndConsensus`, `getAnalystPriceTargets`, `getRecentAnalystGrades`, `getEarningsSurpriseHistory` → merged consensus; `analystActions48h` from Polygon ratings.
9. **Options chain:** `fetchOptionsChain` — primary **Schwab** `GET /marketdata/v1/chains` (split CALL/PUT for large names); fallback **Polygon** `fetchPolygonChain` if unpriced/missing.
10. **IV rank:** `getStoredIVR` → DB **`equity_daily`** IVR columns (`ivNormalize.ts` path).
11. **Chain analytics:** `summarizeOptionsChain` — IV cleaning, ATM/top-volume/unusual OI·vol, **term structure** (`termStructure5pt`, front/back month), **25Δ skew**, **implied move**; session from **`getEquityMarketSessionWithAsOf`** (`schwabMarketHours.ts` — typically Schwab market-hours API).
12. **Catalyst (desk window):** `computeDeskCatalystExpirationISO` + `evaluateCatalyst` (`catalystEvaluator.ts`) — **deterministic** earnings + **calendar** macro events (`calendarEventChecker.ts` / `getNextEarningsDate`); `ai: null` so no model inside evaluator.
13. **Legacy catalyst hints:** `deriveCatalyst` on `TickerData` for IO score.
14. **IO score:** `computeIOScore` (`ioScoreEngine.ts`) — **DB** `equity_daily` (beta/R² vs SPY) + **`flow_daily_aggregates`** (flow skew / vol-OI), merged with desk catalyst via `mergeIOCatalystFromDesk`.
15. **Realized vol + IVR context:** `getRealizedVolFromEquityDaily`, `countRealIvHistoryDays`, optional proxy depth; `reconcileFlowScoreFromChain` adjusts flow component vs chain summary.
16. **Session options tape backfill:** `requestFlowCapture` (`flowCaptureService.ts`) — Polygon/WS capture path; persists into flow tables; produces **`tapeBackfillStatus`**.
17. **Flow highlights:** `getPolygonFlowHighlights` (`polygonFlowHighlights.ts`) — reads **`options_flow_per_strike`**, **`options_flow_exec_per_strike`**, **`options_flow_raw_trades`** (plus max-date discovery); assembles **EOD per-strike** and **session tape** (live or EOD fallback) into **`polygonFlowHighlights`**.
18. **Fundamentals + earnings history:** `fetchCompanyFinancialsForSymbol` (SEC path used by strategist), `fetchEarningsHistoryAndForward` (Polygon earnings bundle).
19. **Data package assembly:** `buildDataPackage` (`strategistV2.ts`) — serializes the large JSON payload: quote-derived fields, chain summary, flow, IO score, regime, user prefs, tape backfill, catalyst evaluation, macro window events (`getUpcomingEvents`), optional **`catalyst`** earnings blocks.
20. **Microstructure add-ons (conditional):** For **NASDAQ-primary** listings, **`acquireDynamicIbPool("totalview")`** and poll **`getRecentTotalviewSummaryForTicker`**; **`fetchRecentNasdaqTotalviewForTicker`** reads **`nasdaq_totalview_summary`** (IBKR TotalView summaries). **`fetchRecentEsDepthSummary`** → ES futures depth summary table. **`fetchRecentNyseImbalanceForTicker`** → **`nyse_order_imbalances`** (IBKR closing imbalance persistence). Short wait loop on **`getQuoteBySymbol`** for **CBOE One** quote presence (dynamic IB pool) — primarily warm-up/diagnostics, not merged as a top-level “CBOE quote” block in the JSON (see gaps).
21. **Scanner handoff:** If present, **`scannerContext`** is merged into the JSON string of the data package (`analyzeTickerV2Inner`).
22. **Mode branch:** If **`settings.strategistMode === 5`**, **`runConvictionDesk`** (`strategistDesk.ts`).
23. **Conviction-only preamble:** For **Gemini** (`provider === "google"`), optional **`runCatalystDeskStructuredSearches`** (pre-run web research bundle); other providers rely on **native** web search on the consolidated turn where supported.
24. **Prompt:** `buildConvictionDeskUserPrompt` (`strategistDeskPrompts.ts`) — strips/adapts Vol/Flow/Catalyst/PM instruction blocks, appends **full data package** via **`snapshotBlock(dataPackage)`**, plus **`CONVICTION_DESK_*`** skeleton from `convictionDeskSoloSupersetPrompt.ts`.
25. **Model call:** `streamModel` → provider-specific streaming (`aiLabAnalystClient.ts`): Anthropic / OpenAI / xAI with tools where configured; Gemini JSON MIME path without tools on that turn. **System:** `CONVICTION_DESK_MODEL_SYSTEM_PROMPT` (`convictionDeskSystemPrompt.ts`). **Output:** JSON validated through **`ConvictionDeskOutputSchema`** / business rules with retry path.

---

## Section 2: Currently consumed equity data

“Where it lands” refers to the **JSON data package** embedded in the Conviction Desk user prompt unless noted.

| Source | Storage / transport | Fields / signal | Where it lands |
|--------|---------------------|-----------------|----------------|
| Schwab REST quotes | HTTP `quotes` API | `lastPrice`/`mark`, `netPercentChangeInDouble`, volumes, `securityStatus`, reference `exchange` / `assetType`, fundamental sector, avg volume, market cap | `price`, `dailyChangePct`, `avgVolume20d`, `relativeVolume`, `sector`, `marketContext.*`, `schwabAssetType`, `schwabExchangeHint` (via `tickerData`); halted flag blocks earlier |
| Polygon (conditional) | REST | Market cap USD | `marketContext.marketCapUsd` when Schwab cap missing |
| Earnings service | DB + vendor APIs (`earningsService.ts`) | Next/prior earnings, days away, sources | `earningsDaysAway`, `nextEarnings`, `lastEarningsDate`, `daysSinceEarnings`, `earningsWithin48h`, notes |
| **Regime** | In-memory cache from Market Pulse | Directional conviction, systemic risk, correlation regime | `regime.*` in package; also gates/debate logic outside Conviction JSON |
| **IO score — equity leg** | DB `equity_daily` | Closes vs SPY for β, R², residual z | `ioScore.beta`, `residualReturnZScore`, components |
| **IO score — flow leg** | DB `flow_daily_aggregates` | Vol/OI ratio, put/call skew vs market | `ioScore.components.flowDivergence` |
| **Realized vol** | DB `equity_daily` via `getRealizedVolFromEquityDaily` | HV20/HV30, contamination flags | `realizedVol.*` |
| **IVR** | DB `equity_daily` via `getStoredIVR` | IVR %, as-of, source | `ivr`, `ivrContext` |
| **SEC fundamentals** | SEC company facts path used by `fetchCompanyFinancialsForSymbol` | Revenue, OCF, capex, debt, shares | `secFundamentals` |
| **FMP analyst history** | DB tables served by `fmpDataService` | Grades, earnings surprises | `fmpAnalystGrades`, `fmpEarningsSurprises` |
| **Polygon analyst** | REST + merge | Consensus, ratings lines | `polygonAnalyst.*`, `analystActions48h` |
| **Earnings history bundle** | Polygon (`fetchEarningsHistoryAndForward`) | History + forward + reactions | `catalyst.*` when present |
| **Macro calendar** | `getUpcomingEvents` / FMP-backed cache | FOMC/HIGH economic in window | `macroEventsInPositionWindow` |
| **NASDAQ book (IBKR TotalView)** | DB `nasdaq_totalview_summary` | Depth/imbalance snapshot | `nasdaqDepth.*` when recent row exists **and** listing is NASDAQ-primary path |
| **ES futures depth** | DB (ES depth summaries via `ibEsDepthPersistence`) | ES book/price context | `esContext.*` when row exists |
| **NYSE closing imbalance** | DB `nyse_order_imbalances` | Side/size/indicative vs spot | `closingImbalance.*` when recent row exists for symbol |
| **Market session** | Schwab market hours helper | open/closed/premarket | `dataQualitySummary.marketSession*` (via chain summary) |

---

## Section 3: Currently consumed options data

| Source | Storage / transport | Fields / signal | Where it lands |
|--------|---------------------|-----------------|----------------|
| Schwab options chain REST | HTTP `chains` | Strikes: bid/ask, volume, OI, IV%, delta, DTE | Primary input to `summarizeOptionsChain` → `optionsChainSummary.*`, `curatedExpirations`, `availableExpirations` |
| Polygon chain REST | Fallback API | Same shape (tagged mid) | Same summaries; `optionsChainSource` records provenance |
| **Chain-derived analytics** | In-process | ATM IV/OI, top volume, vol/OI unusual list, **termStructure**, **termStructure5pt**, **skew25Delta**, **impliedMove**, IV filter stats | `optionsChainSummary`, `dataQualitySummary` |
| **Polygon per-strike EOD** | DB `options_flow_per_strike` | Volume, OI, IV, delta, mid, avg trade price | Drives `polygonFlowHighlights` rankings, unusual counts |
| **Session execution rollup** | DB `options_flow_exec_per_strike` | Sweeps/blocks/regular by strike | `polygonFlowHighlights.sessionTape.execPerStrike` |
| **Classified prints** | DB `options_flow_raw_trades` | Large prints, sweep/block flags, aggressor side, notionals | `sessionTape.topPrints`, aggressor mix, `largestPrint` proxy |
| **Tape backfill diagnostics** | `requestFlowCapture` result | OCC counts, persistence stats | `tapeBackfill` object |
| **Flow highlight aggregates** | Derived in `polygonFlowHighlights` | P/C ratio, unusual skew, top lists | `polygonFlowHighlights.*` |

---

## Section 4: Wired but not consumed (table)

Items the **data layer** maintains or **streaming** feeds populate that **Conviction Desk does not read** for an arbitrary ticker (or only overlap indirectly). **Exception:** IBKR imbalance **is** read from **`nyse_order_imbalances`** when present — the live **Generic Tick** path is not referenced directly in strategist code.

| Capability | Where it lives | Strategist relationship |
|------------|----------------|------------------------|
| **Schwab `LEVELONE_EQUITIES` (TUNING_SYMBOLS)** | `schwabStreamer.ts` in-memory L1 cache | **Not used.** Spot/ref data for the analyzed ticker comes from **Schwab REST** `fetchTickerData`, not the streaming quote cache. |
| **Schwab `TIMESALE_EQUITY` tape** | `schwabStreamer.ts` | **Not consumed** in `buildDataPackage` / flow paths. No equity time & sales in the data package. |
| **Schwab `NYSE_BOOK` / `NASDAQ_BOOK`** | `schwabStreamer.ts` + `tuningUniverseRegistrar.ts` venue splits | **Not consumed.** Desk uses **IBKR TotalView** summaries (DB) for **NASDAQ** depth context instead; Schwab depth is unused. |
| **IBKR Phase 5 `TUNING_L1` (~16_000 reqId pool)** | `ibStreamer.ts` + `ibTuningL1Symbols.ts` | **Not consumed** for the strategist ticker. No merge of tuning L1 into the JSON payload. |
| **IBKR Phase 4 closing imbalance (LC130 ∪ tuning NYSE)** | `ibStreamer.ts` → **`nyse_order_imbalances`** | **Partially consumed:** strategist reads **persisted rows** in `buildDataPackage`. Symbols **outside** the IBKR imbalance subscription union typically get **no** `closingImbalance` object even when “NYSE-listed.” |
| **Intraday VWAP (equity)** | No equity VWAP field in the strategist package; options tape may expose **avgTradePrice** as contract “vwap-like” in flow highlights only | **Not consumed** as underlying intraday VWAP. |
| **Intraday RSI** | Not computed or attached in this pipeline | **Not consumed.** |
| **Recent equity block prints** | No dedicated equity-block ledger surfaced in `strategistV2` | **Not consumed** (options blocks appear via options flow tables only). |
| **Schwab `LEVELONE_OPTIONS` tuning watchlist** | `schwabStreamer.ts` (watchlist refresh) | **Not consumed** by strategist; chain comes from **REST** / Polygon fallback. |
| **Polygon snapshot refresh worker output** | `snapshotRefreshWorker.ts` → **`ticker_signal_snapshot`** (and scanner telemetry) | **Not queried** by Conviction Desk. Strategist recomputes overlapping concepts (chain summarization, flow highlights) per request instead of reading the snapshot row. |

---

## Section 5: Injection points (table)

| Unwired / partial capability | Natural injection point |
|------------------------------|-------------------------|
| **Schwab L1 stream quotes** | `fetchTickerData` or new sibling: add **`liveQuote`** object next to `price` when symbol matches cached stream; or merge into `dataQualitySummary` as **live_vs_rest** freshness. |
| **TIMESALE_EQUITY** | New **`equitySessionTape`** section in `buildDataPackage` (last N prints + aggression); Flow prompt (`stripFlowPromptBeforeSnapshot` / Vol-Flow instructions) should reference the new block. |
| **Schwab NYSE/NASDAQ book** | **`nasdaqDepth` / new `schwabDepth`** keys alongside existing IBKR-driven `nasdaqDepth`; `formatMicrostructureDeskLines` in `strategistDeskPrompts.ts` already formats **`nasdaqDepth`** / **`esContext`** for desk prose — extend that helper. |
| **IBKR `TUNING_L1` pool** | Only relevant for **tuning** symbols: optional **`ibkrTuningQuote`** when `symbol ∈ TUNING_SYMBOLS`; inject beside **`price`** with staleness. |
| **Closing imbalance (subscription gaps)** | **`closingImbalance`**: already injected when DB row exists; extend **IB imbalance symbol universe** (`ibImbalanceSymbols.ts`) if product wants broader NYSE coverage — not a strategist code change per se. |
| **Intraday VWAP / RSI** | Requires **new upstream series** (e.g. minute aggregates job). Inject under **`intradayTechnicals`** in `buildDataPackage`; Vol section instructions in **`buildVolAnalystPrompt` / strip helpers** for Conviction. |
| **Equity block prints** | New **`equityBlockLedger`** subsection; Flow section narrative rules. |
| **Schwab `LEVELONE_OPTIONS`** | Optional **NBBO sanity** vs REST chain in **`summarizeOptionsChain`** pre-step or **`dataQualitySummary.enrichment`**. |
| **Snapshot worker (`ticker_signal_snapshot`)** | **Fast path:** read snapshot row in **`analyzeTickerV2Inner`** when symbol matches tuning universe and snapshot age &lt; threshold; merge into **`scannerSnapshot`** field or hydrate **`polygonFlowHighlights`** / scores without recomputing. |

---

## Section 6: Coverage gaps

1. **Macro regime freshness:** `regime` comes from **`getCachedRegime()`**. If Market Pulse has **never** run since process start, **`buildFallbackRegime()`** applies — strategist may label macro risk without a live pulse-derived regime.
2. **NASDAQ depth (`nasdaqDepth`):** Populated only when **`fetchRecentNasdaqTotalviewForTicker`** returns a row **and** the symbol follows the **NASDAQ-primary + TotalView pool** path in `buildDataPackage`. **NYSE-listed** names get **no** Schwab book or TotalView equity book in the JSON today → microstructure section may rely only on **`esContext`** + imbalance.
3. **Closing imbalance:** **`closingImbalance`** appears only when **`nyse_order_imbalances`** has a fresh row **and** IBKR persisted imbalance for that symbol during the closing window — **not** all NYSE tickers are in the IBKR imbalance subscription union.
4. **IO score “availability”:** When **`equity_daily`** history for the ticker or SPY is thin, **`ioScore.available`** is false (`dataQualitySummary.ioScore.state` = fallback). Prompt tells the model to treat scores cautiously.
5. **Flow tape degradation:** Flags such as **`classified_session_tape_missing_eod_substitute`** / **`polygon_flow_highlights_absent`** (in **`dataQualitySummary.flags`**) indicate **no reliable classified prints** — the prompt warns against implying full tape precision.
6. **IVR absence:** If **`getStoredIVR`** returns null, **`ivr`** is omitted — comments in code explicitly forbid fabricating IVR from the chain.
7. **Implied move:** **`impliedMoveQuality.available`** may be false (e.g. BSM inversion) — **`dataQualitySummary`** surfaces **`implied_move_gap`** / **`implied_move_bsm_inversion_failed`** flags.
8. **Skew:** **`skew25Delta`** may be null with explanatory **`skew25DeltaReason`** — Vol instructions already require literal reading of reasons.
9. **Catalyst web vs Gemini:** Gemini Conviction runs **structured pre-search** when configured; if it fails, prompt receives a **failure banner** in structured research — catalyst narrative may be calendar-only.
10. **Prompt vs data:** Instructions reference **tape completeness** conditional on **`tapeBackfill`** / **`dataQualitySummary.flow`** — when backfill skipped or failed, the model is guided not to claim OCC completeness; **does not** fix missing upstream data.

---

## Appendix: Key file references

- Route: `artifacts/api‑server/src/routes/strategistV2.ts` (`POST /analyze`)
- Orchestration: `artifacts/api‑server/src/lib/strategistV2.ts` (`analyzeTickerV2Inner`, `buildDataPackage`)
- Conviction orchestration: `artifacts/api‑server/src/lib/strategistDesk.ts` (`runConvictionDesk`)
- Prompts: `artifacts/api‑server/src/lib/strategistDeskPrompts.ts`, `artifacts/api‑server/src/lib/convictionDeskSoloSupersetPrompt.ts`
- Streaming / tuning: `artifacts/api‑server/src/lib/schwabStreamer.ts`, `artifacts/api‑server/src/lib/tuningUniverseRegistrar.ts`, `artifacts/api‑server/src/lib/ibStreamer.ts`
- Snapshot worker: `artifacts/api‑server/src/lib/snapshotRefreshWorker.ts`
