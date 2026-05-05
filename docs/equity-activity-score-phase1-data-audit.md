# Phase 1 — Data availability audit: `equity_activity_score`

**Scope:** Schwab + IBKR only (no Polygon stocks subscription). Codebase audit as of branch `cursor/equity-activity-score-docs-34f6`. No live API calls were executed in this environment.

---

## 1. Schwab API

### 1.1 What real-time equity fields are pulled today?

**A. WebSocket (`LEVELONE_EQUITIES`) — primary streaming cache**

- **Service:** `LEVELONE_EQUITIES` with `SUBS` in `schwabStreamer.ts`.
- **Field mask:** `EQ_FIELDS = "0,1,2,3,4,5,8,10,11,12,15,28,29"` (see `schwabStreamer.ts`).
- **Mapped into `LiveQuote` for equities:** last (field 3), regular-session last (29), bid/ask (1,2), bid/ask size (4,5), **cumulative session volume** (8), **day high / low** (10,11), previous close (12), mark change (15), extended-hours context (28), plus derived change/changePct and `ts` (wall-clock at receive time).

**B. REST `GET https://api.schwabapi.com/marketdata/v1/quotes`**

- **Daily snapshot / batch quotes** (`dailySnapshot.fetchQuotesBatch`): `fields=quote,fundamental` — parses `lastPrice`, `totalVolume`, OHLC-style fields (`openPrice`, `highPrice`, `lowPrice`, `closePrice`), `netPercentChange`, and from `fundamental`: `avg10DaysVolume` / `avg1YearVolume`, `marketCap` (see `dailySnapshot.ts`).
- **Strategist / single-ticker** (`strategistV2.fetchTickerData`): `fields=quote,fundamental,reference` with a narrowed TypeScript row (still standard quote envelope).
- **Routes** (`routes/market.ts`): `fields=quote` or `quote,reference` or `quote,fundamental,reference` depending on endpoint.

### 1.2 Additional fields without changing subscription?

| Need | In stream today? | In REST quote today? | Notes |
|------|--------------------|----------------------|--------|
| Last | Yes | Yes (`lastPrice` / `mark`) | |
| Cumulative session volume | Yes (field 8) | Yes (`totalVolume`) | |
| Bid / ask | Yes | Typically available in full `quote` object (not all fields are typed in every caller) | Extend parsing where needed. |
| Day high / low | Yes | Yes (`highPrice`, `lowPrice`) | |
| **VWAP** | **Not in current `EQ_FIELDS`** | **Likely available** on standard Schwab quote objects as `markPrice` / vendor VWAP fields — **not currently read** in `fetchQuotesBatch` or `LiveQuote` | **Verify** against one live `GET /quotes` JSON sample for US equities; if present, no subscription change—only code/schema. |
| Mark / net change / security status | Partial (stream) | Yes (partially used) | Useful for halts / staleness gates. |

### 1.3 Endpoints and rate limit ceiling

| Path | Role |
|------|------|
| `GET /marketdata/v1/quotes` | Batched equity quotes (up to 100 symbols per request in `fetchQuotesBatch`) |
| `GET /marketdata/v1/pricehistory` | Historical OHLCV for `equity_daily` and technicals |
| WebSocket streamer (from `userPreference.streamerInfo`) | `LEVELONE_EQUITIES`, futures, options |

**Rate limits:** The codebase treats **HTTP 429** on `/quotes` as rate limiting (`routes/market.ts` logs “Schwab 429 rate limit hit”). Schwab’s published **Trader API** guidance commonly cited by integrators is on the order of **~120 requests per minute per app user** for the overall API surface; **confirm in Schwab’s current developer documentation** for your app tier. Streaming is a separate channel but still depends on OAuth/streamer health.

**Operational ceiling for REST-only refresh:** `fetchQuotesBatch` uses **100 symbols per HTTP call** and **200 ms sleep between chunks** (~5 chunks/sec max → under a 120/min REST ceiling for LC130-sized batches if nothing else consumes the budget).

---

## 2. IBKR Gateway

### 2.1 What is pulled beyond breadth-style indicators?

Permanent `reqMktData` subscriptions are started in `ibStreamer.subscribeAll()` for symbols in `permanentSymbolSet` ∩ `BREADTH_SYMBOLS` (from `registerPermanentSymbols` in `liveMarketIndicators.ts`). That set is **breadth + CBOE-style volatility indices** (e.g. `$VIX`, `$TICK`, `$ADD`, …) plus other **enabled** `ibBreadthSymbols.ts` rows (rates, futures, macro, sector ETFs, etc.). **~89** `enabled: true` breadth definitions exist in config; **not all** are in `permanentSymbolSet` (e.g. `$PCUSEQTR` / `$PCUSINXR` are pulse symbols but **disabled** on the IB side and filled from Polygon elsewhere).

**Beyond that bundle, the codebase also uses IB for:**

| Feature | Mechanism | Purpose |
|---------|-----------|---------|
| **NYSE closing imbalance (LC130 NYSE names)** | `reqMktData` + **generic tick list `"225"`** | Per-symbol imbalance state + DB persistence |
| **Market depth** | `reqMktDepth` | SPY + `/NQ` books; **ES** CME depth; dynamic **NASDAQ TotalView** pool |
| **Dynamic Cboe One** | `reqMktData` on `CBOE_ONE_EXCHANGE` | Consolidated BBO merged into Schwab quote cache |
| **Dynamic per-symbol quotes** | `subscribeQuoteForSymbol` → `reqMktData` | LRU cap **95** concurrent (`MAX_DYNAMIC_QUOTE_SLOTS`) |
| **News** | `reqNewsProviders`, `reqNewsBulletins` | Headlines / bulletins (not used for equity_activity_score) |

Tick types handled for standard L1 include **bid, ask, last, high, low, volume, close** (`ibStreamer.ts` `TT` map) — i.e. the same conceptual fields as Schwab L1 for **spot vs VWAP work**, but see §3 for merge/latency policy.

### 2.2 Concurrent market-data-line limit (subscription)

**Not encoded in the repo.** IBKR allocates **concurrent market data lines** per account based on **commissions, equity, booster packs**, etc. The **default floor is often 100 lines** for new accounts, with increases from monthly commission dollars and/or equity (see IBKR “Market Data Pricing” / API documentation).

**Action:** Read the live line count from **Account Management → Market Data Subscriptions** (or the API account summary where IB exposes line usage) for the exact deployment account.

### 2.3 Can we run **130** concurrent `reqMktData` for LC130?

**Not within the current implementation without blowing past typical line budgets.**

Rough **lower bound** on IB lines already used when Gateway is connected (code-derived):

| Bucket | Count (approx.) |
|--------|-----------------|
| Permanent breadth / vol / futures / credit / equity defs (`enabled: true` in `ibBreadthSymbols.ts`) | **~89** |
| NYSE imbalance stream (`ibImbalanceSymbols.ts`, LC130 NYSE-primary) | **~73** |
| Static depth (`DEPTH_SYMBOLS`) | **2** |
| ES CME depth | **1** |
| Dynamic TotalView pool | **≤30** |
| Dynamic Cboe One pool | **≤50** |
| Dynamic quote LRU | **≤95** |

Many of those **overlap** (e.g. dynamic pools are not always full; depth + mkt data may count separately per IB rules). Still, **89 + 73 + depth + dynamic pools** is already **well above 100** in steady state, which implies either (a) the production account has **booster / elevated line entitlements**, or (b) some subscriptions error out (e.g. **101** missing entitlement) and are skipped until restart.

**Headroom for +130 dedicated LC130 equity lines:** Only knowable after subtracting **observed** line usage from the account’s **total entitlement**. If entitlement is **100** and steady usage is **~95**, **headroom is ~5**, not 130.

**If 130 additional L1 equity streams are required:** Plan on **(1)** raising IB market-data line capacity, **(2)** **not** using IB for LC130 L1 (prefer Schwab REST or Schwab WS), or **(3)** snapshot-only `reqMktData` with `snapshot=true` in batches (different latency profile; still consumes lines depending on IB version/rules—verify).

---

## 3. Freshness: Schwab vs IBKR for a **30s** snapshot worker

### 3.1 Schwab

- **WebSocket:** Each equity tick updates `ts = Date.now()` at message receipt (`processEquityTick`), not exchange wire time — good for **staleness detection**, not for microsecond latency measurement.
- **REST `/quotes`:** Fresh at request time; subject to **429** if the global REST budget is exhausted.

### 3.2 IBKR

- `ibStreamer` updates `IBQuoteState.ts` on incoming ticks with **`Date.now()`** — same “receive time” semantics as Schwab WS.
- **Cboe One** quotes are **merged into the Schwab cache** with priority **newer `ts` wins; tie-break favors `IBKR_CBOE_ONE` over Schwab** (`injectCboeOneConsolidatedQuote`).

### 3.3 Recommendation for LC130 **30s** cadence

- **Default to Schwab REST (or WS cache if symbols are subscribed)** for **last, day volume, high/low, VWAP (once confirmed)** — aligns with existing snapshot batching and avoids IB line pressure.
- Use **IBKR** for LC130-wide L1 only if line entitlement is proven and **product** wants consolidated Cboe One for spot — still validate **101** entitlement errors in logs.
- **Reliability at 30s granularity:** Both are typically **adequate** if quotes are not stale; **Schwab** is the **lower-risk** path for **uniform coverage of all 130** names without IB line math. **IBKR** can be **more informative for BBO** when Cboe One is enabled, but it is **not** currently authoritative for every LC130 symbol in the shared cache.

---

## 4. `equity_daily` alignment (RVOL denominator)

- Table includes **`volume`**, **`median_volume_20d`**, and related fields (`lib/db/src/schema/index.ts`).
- Product spec asked for **20-day average daily volume**; codebase today often uses **`median_volume_20d`** for robustness. **Decision for Phase 2:** use **`median_volume_20d`** if populated; else **mean of last 20 `volume`** from history; document the fallback.

---

## 5. Gaps / verification checklist before build

1. [ ] Capture one live Schwab `GET /quotes` JSON for an LC130 equity and confirm **VWAP field name** and units.
2. [ ] Confirm whether `LEVELONE_EQUITIES` exposes a VWAP field id (extend `EQ_FIELDS`) or REST-only is acceptable for 30s scanner.
3. [ ] Record **IB market data line allowance** and **in-use count** from IBKR Account Management while production stack is running (include TWS if open).
4. [ ] If Polygon chain is unavailable for spot in `snapshotRefreshWorker`, confirm **Schwab** spot fallback path for **spot vs VWAP** (worker currently prefers `chain.underlyingPrice` then `equity_daily.close`).
