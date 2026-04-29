# Data Audit: Four-Desk Pipeline Refactor

**Audit Date:** 2026-04-29  
**Purpose:** Confirm data availability for the proposed Flow Desk / Positioning Desk / Catalyst Desk / Synthesis Desk refactor before any code changes begin.

**Legend:**  
- **AVAILABLE** — Data exists in the stack, is wired end-to-end, and is production-ready.  
- **AVAILABLE_WITH_GAPS** — Data exists but has known limitations, partial coverage, or quality issues.  
- **NOT_AVAILABLE** — Data does not exist in the stack and would need to be built or subscribed.

---

## 1. Flow Desk Data Audit

### 1.1 Options Time and Sales — Per-Print Fields

| Field | Status | Detail |
|-------|--------|--------|
| timestamp | **AVAILABLE** | `PolygonOptionTrade.timestamp` (ms epoch, SIP timestamp) via `polygonOptionsWs.ts` line 51 |
| ticker (underlying) | **AVAILABLE** | Derived from OCC symbol in `PolygonOptionTrade.sym` (e.g. `O:SPY251219C00450000`) |
| strike | **AVAILABLE** | Parsed from OCC symbol via `parseOccSymbol()` in the Polygon flat-file sync module and encoded in the sym field |
| expiry | **AVAILABLE** | Parsed from OCC symbol |
| contract type (C/P) | **AVAILABLE** | Parsed from OCC symbol |
| price | **AVAILABLE** | `PolygonOptionTrade.price` — per-contract trade price |
| size | **AVAILABLE** | `PolygonOptionTrade.size` — contract count |
| exchange code | **AVAILABLE** | `PolygonOptionTrade.exchange` — numeric exchange ID |
| conditions array | **AVAILABLE** | `PolygonOptionTrade.conditions` — array of OPRA condition codes. Sweep detection uses code 219 (`SWEEP_CONDITION_CODES` in `optionsConditionCodes.ts`). Block detection inferred from `size >= 100` (`BLOCK_MIN_SIZE`). |
| bid at time of print | **AVAILABLE** | Via NBBO cache from Q (quote) channel subscription. `getNbbo(sym)` returns `NbboSnapshot.bid`. Requires `subscribeContractsWithQuotes()` which subscribes both T+Q channels. Used in `flowTimeSalesHub.ts` for Lee-Ready classification. |
| ask at time of print | **AVAILABLE** | Same mechanism — `NbboSnapshot.ask`. Updated on every inbound Q event before trade handlers fire. |

**Polygon Options Trades Endpoint — Wired?**  
**AVAILABLE.** The Polygon Options WebSocket client (`polygonOptionsWs.ts`, 722 lines) is fully wired:
- Real-time trade tape via `wss://socket.polygon.io/options` (T channel)
- Real-time quotes via Q channel for NBBO
- Ref-counted subscriptions, reconnect hardening, auth lifecycle
- Env-gated by `POLYGON_OPTIONS_WS_ENABLED=1` + `POLYGON_API_KEY`
- Max 1000 concurrent channel subscriptions per connection

**Historical Options Trades:**  
**AVAILABLE_WITH_GAPS.** Historical data comes from two sources:
1. **Polygon S3 EOD Data** (EOD sync module): Day-level aggregates (volume, OI, close, VWAP per contract per day) from the Polygon S3 options data bucket. Synced to `polygon_options_history` DB table. This is **aggregate** data, not tick-level time-and-sales.
2. **Polygon REST API** (`polygonChain.ts`): Snapshot endpoint `v3/snapshot/options/{symbol}` returns current-session data only — not historical tick data.

**Gap:** No historical tick-level time-and-sales is stored. The EOD data provides daily OHLCV per contract, not individual prints. To pull true historical T&S, the Polygon `v3/trades/{optionsTicker}` REST endpoint would need to be wired.

### 1.2 Derived Aggregations Per Strike Per Session

| Metric | Status | Detail |
|--------|--------|--------|
| Average print size | **NOT_AVAILABLE** | Not computed as a per-strike aggregate. Individual print sizes are available live via `PolygonOptionTrade.size` but no session-level per-strike avg is persisted. |
| Sweep percentage | **AVAILABLE_WITH_GAPS** | Live sweep detection exists in `polygonUnusualFlowScan.ts` (time-clustered sweep windows of 100ms with ≥3 legs) and in `optionsConditionCodes.ts` (condition 219). Per-strike sweep counts stored in `options_flow_exec_per_strike` table (`sweepCount`, `sweepNotional`, `sweepVolume`). Gap: only populated when the watcher is active for that ticker; not computed retroactively from EOD data. |
| Ask-aggressor percentage | **AVAILABLE_WITH_GAPS** | Lee-Ready aggressor classification implemented in `flowTimeSalesHub.ts` (`classifyAggressor()`): buy if price > NBBO midpoint, sell if below, tick-rule fallback at midpoint. Available live via SSE `TimeSalesEvent.aggressor`. Gap: aggressor classification is not persisted to DB — the `options_flow_raw_trades` table has a `side` column but it's populated from live flow only when the watcher/hub is active. No retroactive computation from EOD data. |
| Bid-aggressor percentage | **AVAILABLE_WITH_GAPS** | Same as ask-aggressor — derived from the same Lee-Ready classifier. |
| Total prints count | **AVAILABLE_WITH_GAPS** | `FlowContractMetric.tradeCount` computed per contract in `polygonUnusualFlowScan.ts`. Per-strike counts in `options_flow_exec_per_strike` (`sweepCount + blockCount + regularCount`). Gap: only for live-observed periods. |
| Cross-strike correlation flag | **NOT_AVAILABLE** | No logic exists to detect prints at multiple strikes within 30-second windows from same/related exchanges. Would need to be built as a new aggregation over the live trade stream or historical tick data. |

### 1.3 Lookback Window

| Requirement | Status | Detail |
|-------------|--------|--------|
| Current session | **AVAILABLE** | Live trade tape via Polygon WS; `polygonUnusualFlowScan.ts` records trades during configurable scan windows (5-90 seconds). `optionsWatcher.ts` provides persistent session monitoring. |
| Last 5 sessions baseline | **AVAILABLE_WITH_GAPS** | The EOD sync module syncs daily aggregates from S3 to `polygon_options_history`. `optionsBaselines.ts` computes 20-day trailing baselines and 3-day vs 20-day flow acceleration ratios. `polygonFlowHighlights.ts` queries per-strike flow from `options_flow_per_strike` with a 5-calendar-day staleness ceiling. Gap: these are daily volume/OI aggregates, not tick-level T&S. For tick-level 5-session lookback, would need historical T&S storage. |

---

## 2. Positioning Desk Data Audit

### 2.1 Full Options Chain Snapshot — Per-Strike Fields

| Field | Status | Source |
|-------|--------|--------|
| strike | **AVAILABLE** | `PolygonParsedContract.strike` (Polygon) or Schwab chain API |
| expiry | **AVAILABLE** | `PolygonParsedContract.expiration` |
| contract type | **AVAILABLE** | Separated into `calls[]` / `puts[]` arrays |
| bid | **AVAILABLE** | `PolygonParsedContract.bid` / Schwab `bid` |
| ask | **AVAILABLE** | `PolygonParsedContract.ask` / Schwab `ask` |
| last | **AVAILABLE** | `PolygonParsedContract.last` |
| volume | **AVAILABLE** | `PolygonParsedContract.volume` (day volume) |
| open interest | **AVAILABLE** | `PolygonParsedContract.openInterest` |
| implied volatility | **AVAILABLE** | `PolygonParsedContract.iv` (from Polygon snapshot Greeks) |
| delta | **AVAILABLE** | `PolygonParsedContract.delta` |
| gamma | **AVAILABLE** | `PolygonParsedContract.gamma` |
| theta | **AVAILABLE** | `PolygonParsedContract.theta` |
| vega | **AVAILABLE** | `PolygonParsedContract.vega` |

**Chain Sources:** Dual-source with fallback — `fetchOptionsChain()` in `strategistV2.ts` tries Schwab first (`/marketdata/v1/chains`), falls back to Polygon (`fetchPolygonChain()` → `v3/snapshot/options/{symbol}`). Source tracked as `ChainSource` enum: `"schwab" | "polygon-fallback" | "schwab-unpriced" | "none"`.

**Access Pattern:** Live fetch on demand (per-ticker strategist analysis). Paginated up to 12 pages (250 contracts/page). Max 60 DTE default, configurable.

### 2.2 IV Percentile / IV Rank

| Requirement | Status | Detail |
|-------------|--------|--------|
| IVR computation | **AVAILABLE** | `computeIVRForSymbol()` in `ivNormalize.ts` — 252-day percentile rank of current IV30 against trailing history. Uses `equity_daily.iv30d` or `iv30d_proxy` column. |
| 30-day trailing window | **AVAILABLE** | `IVR_MIN_HISTORY = 60` rows required, `IVR_LOOKBACK = 252` days used. 30-day IV stored in `equity_daily.iv_30d`. |
| 90-day trailing window | **AVAILABLE_WITH_GAPS** | The IVR computation always uses a 252-day lookback. A configurable 90-day window is not separately implemented but could be derived from the same `equity_daily` table. |
| 1-year trailing window | **AVAILABLE** | This is the default — 252-day lookback in `computeIVRForSymbol()`. |
| Historical IV data | **AVAILABLE** | `equity_daily.iv_30d` (real chain/flow IV from BSM) and `iv_30d_proxy` (HV × VRP fallback). Distinct columns, never mixed. |
| IVR source tracking | **AVAILABLE** | `IvrSource` type: `"chain" | "flow" | "hv_proxy" | "canonical" | "real_iv"`. Tracked per row in `equity_daily.ivr_source`. |

**Access Pattern:** Stored IVR read from DB (`getStoredIVR()`), staleness ceiling of 10 days (`IVR_MAX_STALENESS_DAYS`). Proxy fallback when real IV history < 60 days.

### 2.3 Term Structure

| Requirement | Status | Detail |
|-------------|--------|--------|
| ATM IV across multiple expiries | **AVAILABLE** | `ChainSummary.frontMonthIV` and `backMonthIV` computed in `summarizeOptionsChain()`. The `curatedExpirations` array contains per-strike IV for up to 3 DTE buckets: `near_0_7d`, `mid_7_30d`, `far_30_60d`. Each bucket includes IV for all sampled strikes. |
| Contango/backwardation detection | **AVAILABLE** | Computed in both `strategistV2.ts` (`buildDataPackage()`) and `strategistValidate.ts`. Logic: `frontMonthIV > backMonthIV → BACKWARDATION`, `backMonthIV > frontMonthIV → CONTANGO`. Emitted as `termStructure` in the data package with explicit `frontMonthIV` and `backMonthIV` values. |
| 5+ simultaneous expiries | **AVAILABLE_WITH_GAPS** | The chain snapshot returns all available expirations up to 60 DTE. `availableExpirations` array typically contains 5+ entries for liquid names. However, the term structure summary only compares front vs back (2 points), not a full 5-point curve. Per-expiration ATM IV can be derived from `curatedExpirations` data. |

### 2.4 Skew

| Requirement | Status | Detail |
|-------------|--------|--------|
| 25-delta skew metric | **NOT_AVAILABLE** | No explicit 25-delta call IV minus 25-delta put IV computation exists. The `curatedExpirations` array includes per-strike delta and IV, so 25-delta skew can be computed from existing chain data by interpolating or finding the nearest 0.25-delta contracts. |
| P/C volume skew | **AVAILABLE** | `ChainSummary.putCallVolumeRatio` computed from chain. `PolygonFlowHighlights.unusualSkew` ("bullish"/"bearish"/"balanced") from flow data. |
| Flow skew divergence | **AVAILABLE** | `IOScoreResult.components.flowDivergence.skewDivergence` — computed against market average. |

**What would be needed:** A dedicated `compute25DeltaSkew()` function that finds the 25-delta call and put strikes (or interpolates) from the chain and returns their IV difference. All input data is already available in `curatedExpirations`.

### 2.5 Historical Realized Volatility

| Requirement | Status | Detail |
|-------------|--------|--------|
| Realized vol computation | **AVAILABLE** | `equity_daily.hv_20d` (20-day HV) and `equity_daily.hv_30d` (30-day HV) stored per symbol per day. |
| Configurable windows | **AVAILABLE_WITH_GAPS** | 20-day and 30-day windows are pre-computed and stored. Other windows (10d, 60d, 90d) are not pre-computed. `computeTodayHvProxy()` in `ivNormalize.ts` demonstrates the HV calculation (log returns, annualized std dev) but is hardcoded to 30-day. |
| IV/HV ratio | **AVAILABLE** | `equityDailyExtras.ivHvRatio` = `iv30d / hv20d`, computed in `getEquityDailyExtras()`. |

**Access Pattern:** Read from `equity_daily` table on demand. Updated by the daily snapshot job.

### 2.6 Implied Move Calculation

| Requirement | Status | Detail |
|-------------|--------|--------|
| ATM straddle / spot | **AVAILABLE_WITH_GAPS** | `ChainSummary` contains `atmCallBid`, `atmCallAsk`, `atmPutBid`, `atmPutAsk` and the underlying price. ATM straddle mid = `(atmCallMid + atmPutMid)` and implied move = straddle / underlying. However, no dedicated `impliedMove` field is computed and exposed. The `preTradeRiskEngine.ts` references "expected move (ATM straddle)" and the `optionsStrategist.ts` system prompt references "expectedMove" but these rely on the AI models computing it from the chain data rather than a deterministic server-side calculation. |
| Weighted average nearest expiries | **NOT_AVAILABLE** | No weighted-average implied move across nearest expiries is computed. Would need to blend front and back expiry ATM straddles weighted by DTE. |

**What would be needed:** A `computeImpliedMove()` function that: (1) finds the ATM straddle mid for the nearest expiry, (2) optionally weights across the two nearest expiries, (3) divides by spot price. All input data is in `ChainSummary`.

### 2.7 Front-Week IV Artifact Handling

| Requirement | Status | Detail |
|-------------|--------|--------|
| 500% IV ceiling clamping | **AVAILABLE** | `IV_CEILING_PCT = 500` in `strategistV2.ts` line 1221. All per-contract IVs above 500% are clamped during `summarizeOptionsChain()`. |
| Artifact count tracking | **AVAILABLE** | `ChainSummary.ivArtifactsClampedCount` — number of contracts whose IV was clamped. |
| Artifact flag exposed to consumers | **AVAILABLE** | `ivArtifactNote` field in the data package warns the AI model when clamping occurred. `ivCeilingPct` field reports the ceiling value. |
| Consistency | **AVAILABLE_WITH_GAPS** | The 500% ceiling is applied in `strategistV2.ts` only. The `ivSanityFloor.ts` module applies a separate `HARD_CEILING = 5.0` (500%) to `iv30d` values for the daily snapshot path, plus per-symbol floors. The `ivNormalize.ts` module applies `IV_MAX_VALID = 5` (500%) for IVR computation. Three modules enforce the same 500% ceiling independently — consistent in value but not centralized. |

---

## 3. Catalyst Desk Data Audit

### 3.1 Earnings Calendar

| Requirement | Status | Detail |
|-------------|--------|--------|
| Ticker | **AVAILABLE** | `NextEarnings.symbol` |
| Earnings date | **AVAILABLE** | `NextEarnings.earningsDate` (YYYY-MM-DD) |
| Time of day (BMO/AMC) | **AVAILABLE** | `NextEarnings.time` — "BMO" (before market open, hour < 10), "AMC" (after market close, hour >= 16), or HH:MM |
| Confirmed vs estimated | **AVAILABLE** | `NextEarnings.confirmed` — boolean. Benzinga: `date_confirmed === 1`. Finnhub: within 30 days = confirmed. Yahoo: always unconfirmed. |
| EPS/revenue estimates | **AVAILABLE** | `NextEarnings.epsEstimate`, `epsPrior`, `revenueEstimate`, `revenuePrior`, `period`, `periodYear` (Benzinga primary source) |
| Last earnings date | **AVAILABLE** | `NextEarnings.lastEarningsDate` and `lastEarningsDaysSince` — from Benzinga past-print detection |

**Reliability:** Multi-source agreement logic in `earningsService.ts`:
1. Benzinga (primary, API key required) — confirmed dates are single source of truth
2. Finnhub (disambiguator, API key required) — IR feed dates, within-30d = confirmed
3. Yahoo (fallback, no key) — `quoteSummary` endpoint + HTML scrape fallback

6-hour cache TTL for positive results, 30-minute for negative.

### 3.2 Macro Calendar

| Event Type | Status | Detail |
|------------|--------|--------|
| FOMC decisions | **AVAILABLE** | Hardcoded known dates 2024-2027 in `calendarEventChecker.ts` (`FOMC_KNOWN` map). Computed for future years. Includes FOMC Minutes (decision + 21 days). |
| CPI Report | **AVAILABLE** | Generated algorithmically — 2nd Tuesday of each month. |
| PPI Report | **AVAILABLE** | Day before CPI (2nd Tuesday - 1). |
| NFP (Jobs Report) | **AVAILABLE** | 1st Friday of each month. |
| GDP | **AVAILABLE** | Last Thursday of Jan/Apr/Jul/Oct (advance estimate). |
| PCE Price Index | **AVAILABLE** | Last Friday of each month. |
| Monthly OpEx | **AVAILABLE** | 3rd Friday (shifted if holiday). |
| Quad Witching | **AVAILABLE** | 3rd Friday of Mar/Jun/Sep/Dec. |

**Time-window queries:** `getUpcomingEvents(withinTradingDays)` in `calendarEventChecker.ts` returns events within N trading days from today. `checkEventConflicts(symbol, proposedDTE, strategyType, earningsDaysAway)` checks events between today and a proposed expiration. The `catalystEvaluator.ts` uses both for the catalyst evaluation window between today and the trade's far-leg expiration.

**Access Pattern:** Generated deterministically from date arithmetic, cached per calendar year. No external API dependency.

### 3.3 Historical Earnings Reaction Data

| Requirement | Status | Detail |
|-------------|--------|--------|
| Implied move at time of each historical print | **NOT_AVAILABLE** | No historical pre-earnings ATM straddle / implied move is stored. The chain snapshot is live-only. |
| Realized move on the print | **NOT_AVAILABLE** | No historical earnings-day realized move is computed or stored. The `equity_daily` table has daily OHLC data that could be used to compute post-earnings gap/move, but no service does this. |
| Beat/miss/inline classification | **NOT_AVAILABLE** | No EPS surprise classification is stored or computed. Benzinga provides `eps_est` and `eps_prior` for the *upcoming* print only, not historical prints. |

**What would be needed:**
1. A historical earnings calendar (past dates + EPS surprise data) — available from Benzinga's `/calendar/earnings` with historical date ranges, or a dedicated provider like Alpha Vantage / FMP earnings surprise endpoint.
2. A service that, for each past earnings date, queries the pre-earnings ATM straddle (from `options_chain_daily` if populated for that date) and the post-earnings move (from `equity_daily` close-to-close or open gap).
3. Beat/miss classification: `actual_eps - estimated_eps` compared to zero.

### 3.4 Analyst Price Target Data

| Requirement | Status | Detail |
|-------------|--------|--------|
| Current consensus target | **NOT_AVAILABLE** | No analyst price target service exists. The strategist system prompt instructs the AI model to search `<TICKER> analyst upgrade downgrade price target` via web search, but no deterministic server-side data source is wired. |
| Recent upgrades/downgrades | **NOT_AVAILABLE** | Same — delegated to AI web search. The market route (`routes/market.ts` line 1785) references a `priceTarget` field from an unidentified source but no dedicated analyst actions service. |

**What would be needed:** An analyst consensus data provider subscription (Benzinga Pro, TipRanks, or similar) and a service that caches per-ticker consensus targets + recent rating changes with trailing-window queries.

### 3.5 Sector Context

| Requirement | Status | Detail |
|-------------|--------|--------|
| Ticker-to-sector mapping | **AVAILABLE** | `SECTOR_MAP` hardcoded in `deterministicScanner.ts` and `deterministicScanner.v2.ts` — covers ~130 liquid core names across all 11 GICS sectors. `reference_data` DB table has `sector_etf` field. |
| Sector ETF mapping | **AVAILABLE** | `SECTOR_TO_ETF` map in `deterministicScanner.v2.ts`: Technology→XLK, Financials→XLF, Energy→XLE, Healthcare→XLV, etc. (11 sectors). |
| Recent sector ETF performance | **AVAILABLE_WITH_GAPS** | `equity_daily` table stores daily OHLC for sector ETFs (XLK, XLF, etc.) when they're included in the universe. `priceChangePct5d` and `priceChangePct10d` available. Relative strength vs SPY (`rsRatio`) computed. Gap: sector ETF data depends on the daily snapshot job including those symbols — if a sector ETF is not in the tracked universe, its data may be stale or absent. The scanner v2 uses `getSectorEtf()` to identify the ETF but does not explicitly fetch its recent performance for context display. |

---

## 4. Synthesis Desk Data Audit

### 4.1 Three Desk Output Consumption

**AVAILABLE.** The current architecture already assembles a comprehensive `dataPackage` (built in `strategistV2.ts` `buildDataPackage()`) that contains:
- Chain summary (Positioning Desk equivalent)
- Polygon flow highlights (Flow Desk equivalent)
- Catalyst evaluation (Catalyst Desk equivalent)
- Regime, IO score, equity extras, IVR

The synthesis desk would read structured outputs from the three new desks rather than the raw data package. No new raw market data is needed.

### 4.2 Economics Validator

| Requirement | Status | Detail |
|-------------|--------|--------|
| Pre-flight validation | **AVAILABLE** | `strategistValidate.ts` (1253 lines) implements a full Bull/Bear validation debate with `PROCEED` / `PROCEED_WITH_CAUTION` / `DO_NOT_PROCEED` verdicts. Solo mode also supported. Web search mandate enforced. |
| Pre-trade risk engine | **AVAILABLE** | `preTradeRiskEngine.ts` provides deterministic risk checks (breakeven vs expected move, Greeks limits, etc.). |
| Economics reconciliation | **AVAILABLE** | `strategistV2.ts` lines ~830-900 reconcile AI-proposed economics against real Schwab leg prices — computes actual max profit, max loss, breakeven from real bid/ask data. Server overrides AI-fabricated numbers. |

### 4.3 NO_TRADE Decision

| Requirement | Status | Detail |
|-------------|--------|--------|
| NO_TRADE output type | **AVAILABLE_WITH_GAPS** | The current pipeline supports several rejection states: `status: "no_viable_setup"`, `"toxic_block"`, `"failed_insufficient_history"`. The `StrategistV2Result.blockReason` carries structured rejection with `RejectionCategory` (TOXIC_BLOCK, LOW_CONFIDENCE, NO_EDGE, CATALYST_CONFLICT, VALIDATION_FAIL, MISSING_DATA, STOCK_HALTED, PRICING_MARKET_CLOSED, EARNINGS_INSIDE_EXPIRY, UNKNOWN). AI can also return `strategy: "no_trade"` with confidence < 20. |
| Reasoning in NO_TRADE | **AVAILABLE** | `BlockReason.detail` carries free-form reasoning. `BlockReason.suggestedAction` provides next-step guidance. |
| Renderer handling | **AVAILABLE** | Frontend `StrategistV2Card.tsx` renders rejection states with category pills, detail text, and suggested actions. `NO_TRADE` as a `RiskPosture` is rendered in `ActionPlanCard.tsx` with a red indicator. |
| Downstream consumer handling | **AVAILABLE_WITH_GAPS** | The strategist history table (`strategist_history.card_json`) persists both recommendation and rejection cards. Push notifications (`strategistNotifications.ts`) fire on completion. Gap: the `NO_TRADE` semantics are currently spread across multiple status values (`no_viable_setup`, `toxic_block`, etc.) rather than a single explicit `NO_TRADE` status. A new desk pipeline would benefit from unifying these into a single `NO_TRADE` status with a reason enum. |

---

## 5. Scanner Data Audit

### 5.1 Flow Asymmetry Filter

| Sub-filter | Status | Detail |
|------------|--------|--------|
| Unusual volume above threshold | **AVAILABLE** | `polygonFlowHighlights.ts` computes `unusualStrikeCount` where vol/OI ≥ 3 AND volume ≥ 500. `unusualFlowBonusPoints()` scores 0-10 based on count. `optionsBaselines.ts` `isIntradayVolumeBreakout()` fires when todayVol ≥ 3× baseline AND ≥ 200. |
| P/C ratio outside historical band | **AVAILABLE_WITH_GAPS** | `polygonPutCallRatio.ts` polls SPY/SPX P/C ratios every 60s (equity + index). Per-ticker P/C available from `ChainSummary.putCallVolumeRatio` and `PolygonFlowHighlights.putCallVolumeRatio`. `equity_daily.put_call_ratio` stores daily snapshots. Gap: no "historical band" computation exists — there's no service that computes the trailing percentile of P/C ratio to determine when it's "outside band." Currently used as a raw scalar. |
| Flow acceleration | **AVAILABLE** | `getFlowAcceleration()` in `optionsBaselines.ts` — 3-day vs trailing 20-day volume ratio from `polygon_options_history`. Integrated into scanner v2 scoring. |

### 5.2 Positioning Dislocation Filter

| Sub-filter | Status | Detail |
|------------|--------|--------|
| IV percentile above threshold | **AVAILABLE** | `getStoredIVR()` returns IVR (0-100 percentile rank) with source tracking. Scanner v2 (`deterministicScanner.v2.ts`) fetches IVR from DB in batch via `fetchIvrFromDB()`. |
| Term structure dislocation | **AVAILABLE_WITH_GAPS** | `frontMonthIV` and `backMonthIV` available in chain summary. Contango/backwardation detection exists. Gap: no quantified "dislocation score" — it's currently a binary contango/backwardation label with raw IV values, not a z-score or percentile against historical norm. |
| Skew outside band | **NOT_AVAILABLE** | As noted in section 2.4, no 25-delta skew metric is computed. P/C volume skew exists but delta-based IV skew does not. No historical skew band is maintained. |

### 5.3 Catalyst Proximity Filter

| Sub-filter | Status | Detail |
|------------|--------|--------|
| Earnings within position window | **AVAILABLE** | `getNextEarningsDate()` returns `daysAway`. Scanner v1 (`deterministicScanner.ts`) filters out tickers with earnings within 5 trading days. Scanner v2 suppresses within `earningsSuppressDays: 14`. `evaluateCatalyst()` checks earnings within DTE window. |
| Macro event within position window | **AVAILABLE** | `getUpcomingEvents()` and `checkEventConflicts()` detect FOMC, NFP, CPI, PPI, PCE, GDP within any trading-day window. |

### 5.4 Efficient Scanning Across Liquid Core 130

| Requirement | Status | Detail |
|-------------|--------|--------|
| Universe definition | **AVAILABLE** | `liquidCore130.ts` exports `LIQUID_CORE_SYMBOLS` — the canonical 130-ticker universe. Also stored in `universes.json`. |
| Batch data fetching | **AVAILABLE** | Scanner v1: `fetchQuotesBatch()` processes 50 symbols per Schwab API call. Scanner v2: batch IVR from DB, batch flow highlights via `getPolygonFlowHighlightsBulk()`, batch flow acceleration via `getFlowAcceleration()`. |
| Rate limiting awareness | **AVAILABLE_WITH_GAPS** | Polygon EOD sync has an S3-request cap (default 200). Polygon WS has 1000-channel cap with ref-counting. Schwab quote batching (50/request) avoids per-symbol rate limits. Gap: no explicit Polygon REST API rate limiter (the chain snapshot endpoint is called per-ticker without rate-limiting logic). For a full 130-ticker chain scan via Polygon REST, rate limiting would be needed. The scanner v2 uses DB-stored data (no live Polygon REST calls per scan), which avoids this issue. |
| Concurrency control | **AVAILABLE** | Scanner v2: `maxScanConcurrency: 5` limits parallel per-ticker scoring. Scanner v1: processes sequentially after batch quote fetch. |

---

## Summary: Gaps and Build Requirements

### Items that need to be **built** for the four-desk refactor:

| Priority | Item | Desk | Effort Estimate |
|----------|------|------|-----------------|
| **HIGH** | Historical tick-level options T&S storage + Polygon REST trades endpoint integration | Flow | New service: Polygon `v3/trades/{optionsTicker}` client, DB table for tick-level trades, backfill job |
| **HIGH** | Per-strike per-session derived aggregations (avg print size, sweep %, aggressor %, cross-strike correlation) | Flow | New aggregation service consuming live trade stream; persists to a new summary table |
| **HIGH** | Historical earnings reaction service (implied move at print, realized move, beat/miss) | Catalyst | New service: historical earnings dates (Benzinga), historical chain snapshots (from `options_chain_daily`), equity gap computation |
| **HIGH** | Analyst price target / consensus data source | Catalyst | New data subscription (Benzinga Pro, TipRanks, or similar) + caching service |
| **MEDIUM** | 25-delta IV skew computation | Positioning | New function: interpolate/find 25Δ calls and puts from existing chain data, compute IV difference |
| **MEDIUM** | Implied move calculation (deterministic, server-side) | Positioning | New function: ATM straddle mid / spot, optionally weighted across nearest expiries |
| **MEDIUM** | P/C ratio historical band (percentile) | Scanner | New service: trailing percentile of daily P/C ratio from `equity_daily.put_call_ratio` or `flow_daily_aggregates.pc_skew` |
| **MEDIUM** | Term structure dislocation score | Scanner | New function: quantified front-back IV spread as z-score against trailing history |
| **MEDIUM** | Skew historical band | Scanner | Requires 25Δ skew computation first, then trailing percentile |
| **LOW** | Sector ETF performance context | Catalyst | Ensure sector ETFs are always in daily snapshot universe; add explicit recent-performance query |
| **LOW** | Unified NO_TRADE status | Synthesis | Refactor: consolidate `no_viable_setup` / `toxic_block` / etc. into explicit `NO_TRADE` with reason sub-type |
| **LOW** | Cross-strike correlation flag | Flow | New detection algorithm over live trade stream |

### Items that are **fully available** and need no changes:

- Options chain snapshot with all per-strike fields (bid, ask, last, volume, OI, IV, delta, gamma, theta, vega)
- IVR / IV rank with 252-day lookback and source tracking
- Term structure front/back comparison with contango/backwardation detection
- Realized volatility (HV20, HV30) and IV/HV ratio
- Front-week IV artifact handling (500% ceiling, count, flag)
- Earnings calendar (multi-source: Benzinga, Finnhub, Yahoo) with BMO/AMC timing and confirmed/estimated
- Full macro calendar (FOMC, CPI, PPI, NFP, GDP, PCE) with time-window queries
- Catalyst evaluator (earnings + macro + AI-supplied events within DTE window)
- Economics validator / pre-flight validation
- NO_TRADE decision handling through renderer
- Scanner pre-filtering with flow, IVR, and catalyst proximity checks
- Efficient batch scanning across liquid core 130 universe

### Known Data Quality Issues:

1. **IVR proxy vs real IV mixing:** The `ivNormalize.ts` module has extensive safeguards to prevent mixing HV-proxy and real-IV series when computing IVR percentile. `shouldUseProxyIvSeries()` gates the choice. The `todayIvOverride` path was removed to prevent cross-series inflation (COST IVR bug). This is well-handled but complex — any refactor touching IVR should preserve these guards.

2. **IV artifact clamping at 500%:** Consistently enforced at 500% across three modules (`strategistV2.ts`, `ivSanityFloor.ts`, `ivNormalize.ts`) but not centralized. Could become inconsistent if only one module is updated.

3. **Polygon flow data staleness:** `polygonFlowHighlights.ts` enforces a 5-calendar-day staleness ceiling (`MAX_AGE_CALENDAR_DAYS = 5`). Stale data returns `null` rather than serving misleading signals.

4. **Sweep condition code history:** Earlier code used wrong condition codes (218, 152, 153) for sweep detection. Now centralized to OPRA code 219 in `optionsConditionCodes.ts`. Historical data classified with old codes may have incorrect sweep flags.

5. **Earnings date disagreement:** Multi-source agreement logic handles Benzinga/Finnhub/Yahoo disagreements well (see RIVN case in code comments). The priority chain is: Benzinga confirmed > Finnhub+Yahoo agreement > Finnhub alone > Benzinga unconfirmed > Yahoo alone. 

6. **Daily snapshot coverage:** `equity_daily` data (IV30, HV20, ATR, SMA, RS ratio) depends on the daily snapshot job running successfully. If the job fails or misses tickers, downstream services degrade gracefully to `null` but the data gap is silent.
