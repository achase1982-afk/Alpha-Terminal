# Scanner system audit — snapshot backend (read-only)

**Date:** 2026-05-05  
**Scope:** Document how the snapshot-based scanner surfaces candidates, how it compares to the PR #230 “Strategist-aligned candidate engine” intent, and operational verification steps. **No code changes** in this audit.

**Path convention:** References use `src/...` under the Node API package (same secret-scanner workaround as prior audits).

---

## Executive summary

- **Surfacing model:** The worker **writes one row per LC130 ticker** every successful cycle. **Candidates** are **not** chosen in the worker by a “passes all signals” flag; the **API** returns every universe ticker whose row has **`disqual_flags` null or empty** and **`composite_score >= minScore`** (default **0**). So **all non-disqualified LC130 names appear** for `preset:liquidCore130` with default query params — **not** “only names above a composite threshold,” unless the client raises `minScore`.

- **Composite score** is a **weighted sum of five component scores** when **no** disqualifiers apply; otherwise it is **0**. Components are **independent** inputs to that sum (not AND/OR gating for surfacing).

- **`regime_shock`:** Worker uses **`evaluateRegimeShock(indicators).shockActive`** once per cycle (`runOneCycle`), passed into each `refreshTicker` — aligned with **PR #235** intent (not `systemicRiskLevel === "EXTREME"`).

- **API cap:** `GET /api/v2/scan` applies **`limit` max 50** (default **25**) — this is a **response slice**, not “only top N are candidates in the DB.” The scanner is **not** a ranker for eligibility, but the **HTTP response is capped**.

- **Live verification** (Section 7): requires **DB + authenticated** access in your environment; SQL and curl patterns are provided below.

---

## 1. `ticker_signal_snapshot` schema and population

### 1.1 Columns (from `lib/db/src/schema/index.ts` — table `ticker_signal_snapshot`)

| Column (SQL) | Drizzle type | Purpose |
|--------------|--------------|---------|
| `ticker` | `text` PK | Upper symbol; one row per ticker refreshed |
| `sector` | `text` | From `getScannerSector` |
| `market_cap_tier` | `text` | `mega` / `large` / `mid` / `small` from equity market cap |
| `spot` | `numeric` | Underlying: chain price or `equity_daily.close` |
| `daily_change_pct` | `numeric` | From `equity_daily.price_change_pct_5d` (5d % in worker) |
| `halted` | `boolean` | From `equity_daily.halt_status` |
| `ivr` | `numeric` | From `equity_daily` |
| `ivr_source` | `text` | From `equity_daily` |
| `hv20` | `numeric` | From `equity_daily` |
| `hv30` | `numeric` | From `equity_daily` |
| `atm_iv_by_expiry` | `jsonb` | ATM IV curve points (front/next expiries) |
| `skew_25d_by_expiry` | `jsonb` | 25Δ put/call IV and skew per expiry |
| `implied_move_front_pct` | `numeric` | Front straddle implied move % of spot |
| `implied_move_front_abs` | `numeric` | Front straddle $ move |
| `atm_oi_front` | `integer` | ATM front-week call OI (disqual if &lt; 100) |
| `bid_ask_width_atm_front` | `numeric` | ATM (ask−bid)/mid — `wide_spread` if &gt; 0.3 |
| `flow_summary` | `jsonb` | Ask/bid/mid notionals (USD when live tape), `ask_pct`, `top_strike`, `tape_quality` |
| `earnings_date` | `date` | Next earnings |
| `earnings_days_away` | `integer` | DTE to earnings |
| `earnings_confirmed` | `boolean` | Earnings calendar confirmation |
| `macro_overlap_score` | `numeric` | 0–100 from next 5 calendar events |
| `regime_shock_active` | `boolean` | Snapshot of shock FSM at cycle time |
| `composite_score` | `numeric` | Weighted blend (0 if disqualified) |
| `component_scores` | `jsonb` | `term_structure`, `iv_vs_realized`, `flow_alignment`, `skew_anomaly`, `catalyst_proximity`, **`edge_type`** |
| `disqual_flags` | `text[]` | String tags; `null` when none |
| `surfacing_reasons` | `text[]` | Human-readable reasons when sub-scores cross “high” thresholds |
| `snapshot_at` | `timestamptz` | Row snapshot time |
| `last_attempt_at` | `timestamptz` | Attempt start |
| `last_success_at` | `timestamptz` | Success time (same as attempt in current worker) |
| `chain_updated_at` | `timestamptz` | When Polygon chain was used |
| `flow_updated_at` | `timestamptz` | When flow highlights were read |
| `ivr_updated_at` | `timestamptz` | From `equity_daily.date` |
| `earnings_updated_at` | `timestamptz` | Set on refresh |

### 1.2 Score columns — functions in `src/lib/snapshotRefreshWorker.ts`

| Stored field | JSON key / column | Function | Line range (approx.) |
|--------------|-------------------|----------|----------------------|
| `component_scores.term_structure` | `term_structure` | `scoreTermStructure(frontWeekAtmIv, nextWeekAtmIv)` | **166–178** |
| `component_scores.iv_vs_realized` | `iv_vs_realized` | `scoreIvVsRealized(frontWeekAtmIv, hv20)` | **181–191** |
| `component_scores.flow_alignment` | `flow_alignment` | Inline block after `flowNotionalThreshold(tier)` | **414–428** |
| `component_scores.skew_anomaly` | `skew_anomaly` | `scoreSkew(skewPtsFront)` | **194–204** |
| `component_scores.catalyst_proximity` | `catalyst_proximity` | `scoreCatalyst(earningsDaysAway, confirmed, macroScore)` with `macroScore = macroOverlapScore()` | **207–221**, **223–231** |
| `component_scores.edge_type` | `edge_type` | `classifyEdgeType({...})` from `scannerEdgeType.ts` | **482–493** |
| `composite_score` | `composite_score` | Weighted sum (see §2) when `disqual.length === 0`, else **0**; optional age decay | **454–467** |

### 1.3 Formulas and weights

**Term structure** (`scoreTermStructure`): requires `frontIv` and `nextIv`. `spread = front − next`. If `spread ≤ 0` → score **0**. Else piecewise: `spread ≤ 5` → `4×spread`; `5 < spread ≤ 15` → `20 + 4×(spread−5)`; else → `min(100, 60 + 2.5×(spread−15))`.

**IV vs realized** (`scoreIvVsRealized`): `hvPts = hvToVolPoints(hv20)` (if hv &lt; 1, ×100). `gap = frontIv − hvPts`. If `gap ≤ 0` → **0**. Else `min(100, 5×gap)`.

**Flow alignment** (inline): If `tape_quality` is `not_run` or **`degraded`** → **0** (note: worker currently sets `complete` / `partial` / `not_run` only — **`degraded` is never assigned** but would zero flow if it were). Else if `askNotional` (USD when live tape) **&lt; tier threshold** → **0**. Thresholds: mega **100k**, large **50k**, mid **25k**, small **10k**. Else `askShare = ask/(ask+bid+mid)`, `mult = clamp(ask/threshold, 1, 3)`, `flowScore = min(100, askShare×100×(mult/3))`.

**Skew** (`scoreSkew`): `|skewPts| &lt; 2` → 0; `&lt; 5` → `(abs−2)×15`; `&lt; 10` → `45 + 8×(abs−5)`; else `min(100, 85 + 2×(abs−10))`.

**Catalyst** (`scoreCatalyst`): earnings window points (100 / 75 / 40) vs `max(that, macroOverlapScore)`. Macro: next **5** events — HIGH **+40**, MEDIUM **+20**, else **+8** each, cap **100**.

**Composite** (when **no** disqualifiers):

`0.30×term + 0.25×flow + 0.20×ivRv + 0.15×catalyst + 0.10×skew`

Then if still qualified: if chain age **&gt; 90s** → `×0.8`; if flow age **&gt; 300s** → `×0.9`.

### 1.4 LC130 row coverage

`runOneCycle` maps **`LC130 = [...LIQUID_CORE_SYMBOL_STRINGS]`** and `Promise.all` with `pLimit(10)` calls **`refreshTicker` per symbol** (**551–561**). Each successful call **upserts** that ticker (**530–536**). **Failed** tickers are counted in `scanner_health.failed_tickers` but **do not** necessarily update that symbol’s row on failure (depends on whether the error occurs before/after DB write).

**Confirmation query (run in prod):**

```sql
SELECT COUNT(*) AS row_count FROM ticker_signal_snapshot;
-- Expect 130 when worker has populated all symbols at least once

SELECT tickers_attempted, tickers_succeeded, tickers_failed,
       cycle_started_at, cycle_completed_at,
       failed_tickers
FROM scanner_health
ORDER BY cycle_completed_at DESC
LIMIT 1;
```

### 1.5 Sample rows (five tickers)

**Not executed in this audit environment** (no `DATABASE_URL`). Run:

```sql
SELECT ticker, composite_score, component_scores, disqual_flags,
       flow_summary->>'tape_quality' AS tape_q,
       regime_shock_active, snapshot_at
FROM ticker_signal_snapshot
WHERE ticker IN ('SPY','AAPL','IWM','XOM','JPM')
ORDER BY ticker;
```

Paste results into your runbook; full JSON blobs are large.

### 1.6 Investigator note — `apiKey` in worker

The checked-in `refreshTicker` references **`apiKey`** when calling `fetchPolygonChain` (see `src/lib/snapshotRefreshWorker.ts` around the `Promise.all` that loads chain data). A line-by-line read of the top of that file in this audit workspace **does not** show a nearby `const apiKey = process.env[...]` binding. **Treat as a merge/regression risk:** confirm on the branch you deploy that `POLYGON_API_KEY` is read into `apiKey` before `refreshTicker`; if `apiKey` is ever `undefined` at runtime, chain-dependent inputs may be null without a build-time TypeScript error (depending on TS settings).

---

## 2. Candidate criteria

### 2.1 What “qualifies” for scan **API** results

Applied in **`src/routes/scannerV2.ts`** at **query time** (not a separate “candidate” column in DB):

1. `ticker` **IN** resolved universe list (`resolveScannerUniverseSymbolsForUser`).
2. **`disqual_flags` IS NULL OR cardinality(disqual_flags) = 0`** (**177–179**).
3. **`coalesce(composite_score::float, 0) >= minScore`** query param (**181**). Default **`minScore` = 0** (**127**).

**There is no minimum composite score** unless the client passes `minScore &gt; 0`. With default **0**, **every** non-disqualified universe symbol is returned (subject to **`limit`** — see §4).

### 2.2 Per-signal thresholds (for **non-zero** sub-scores)

These gates affect **component scores**, not a separate AND gate for listing:

| Signal | “Off” / zero score condition | Non-zero requires |
|--------|------------------------------|-------------------|
| Term structure | `frontIv` or `nextIv` null, or `front ≤ next` | Positive front-vs-next IV spread |
| IV vs realized | `frontIv` or `hvPts` null, or `gap ≤ 0` | IV above HV20 in vol points |
| Flow | Tape `not_run` / `degraded`, or `askNotional &lt; tier USD` | Live tape USD ask notional ≥ tier |
| Skew | `\|skewPts\| &lt; 2` | Larger \|25Δ skew\| |
| Catalyst | Earnings far / macro low | Near-term earnings or high macro overlap |

### 2.3 ALL vs ANY vs weighted

- **Listing:** **ANY** ticker that passes **disqual** + **`minScore`** filter (default all-clean names).
- **Composite:** **Weighted sum** of five components — **not** “all must exceed X.”
- **Disqualifiers:** **ANY** single flag forces **composite = 0** and prevents listing (because `disqual_flags` becomes non-empty).

### 2.4 Where filtering happens

| Concern | Location |
|---------|----------|
| Disqualifiers + composite | **`refreshTicker`** builds `disqual` and `composite` (**446–467**) |
| “Who appears in API” | **`scannerV2.ts`** SQL `WHERE` (**171–185**) |

---

## 3. `disqual_flags` — values and code paths

| Flag | Condition | `snapshotRefreshWorker.ts` (approx. lines) |
|------|-------------|---------------------------------------------|
| `halted` | `eqRow.haltStatus` truthy | **447** |
| `ivr_missing` | `ivr == null` | **448** |
| `low_oi` | `atmOiFront &lt; 100` | **449** |
| `tape_not_run` | `tapeQuality === "not_run"` | **450** |
| `regime_shock` | `regimeShockActive === true` from `evaluateRegimeShock` | **451** |
| `wide_spread` | `bidAskWidthAtmFront &gt; 0.3` | **452** |

**`regime_shock`:** `runOneCycle` sets `regimeShockActive = evaluateRegimeShock(indicators).shockActive` (**546–547**) — **`shockActive`** is `currentState === "ACTIVE"` in `regimeShockDetector.ts`. Matches **PR #235** alignment.

**No other strings** are pushed to `disqual` in the current worker.

---

## 4. `src/routes/scannerV2.ts` — selection and response

### 4.1 Filters

- Universe membership (**`inArray(ticker, upper)`**).
- **`disqual_flags` null or empty array** (partial index friendly).
- **`composite_score ≥ minScore`** (numeric cast in SQL).

### 4.2 Ordering

**`ORDER BY coalesce(composite_score::double precision, 0) DESC`** (**184**).

### 4.3 `limit`

**`Math.min(50, max(1, parseInt(limit,10)||25))`** (**126**). Default **25** — **this caps the HTTP response**, not DB eligibility. To return **all** qualifying tickers in one call, the client must pass **`limit=50`** and ensure the universe has ≤50 symbols, or the API must be extended (out of audit scope).

### 4.4 Response body

Per request: `candidates` (mapped cards), `snapshot_completed_at`, `snapshot_age_seconds`, `stale`, `scan_at` (**188–194**).

Each candidate is built by **`rowToCandidate`** (**25–114**): ticker, spot, changePct, sector, tier, hard-coded `surfacedBy: ["momentum"]`, composite, `edgeType`, components (trend = term, RS = `0.8×term`, volRegime = ivRv, flowScore, liquidity from OI), flow snapshot, catalyst window, empty `riskFlags`, `surfacingReasons`, optional chain/flow timestamps.

### 4.5 Response headers (staleness)

When `scanner_health` has a latest `cycle_completed_at` (**147–159**):

- `X-Scanner-Snapshot-At`: ISO of that timestamp  
- `X-Scanner-Snapshot-Age-Seconds`: integer seconds since completion  
- `X-Scanner-Stale`: `true` if age **&gt; 300s** (5 min) per `STALE_AFTER_SECONDS` (**8**, **165–169**)

If **no** health row ever: **503** with worker-not-initialized message (**154–158**).

---

## 5. Frontend — `MarketScanner.tsx` / `UnifiedScannerCard.tsx`

### 5.1 `MarketScanner.tsx`

- **`useUnifiedScan`** → `GET /api/v2/scan?universe=…&limit=25&minScore=0` (**default params in hook**).
- Renders **`candidates.map`** in server order (**no client re-sort**).
- **`SnapshotFreshnessBanner`** + **Retry** when `phase === "complete"` (**529–544**).
- **Zero results:** copy “No candidates found…” when `candidates.length === 0` (same block as list).

### 5.2 Client-side filter / cap

- **No** extra filter beyond what the API returned.
- **Implicit cap:** **`limit=25`** from the hook — user sees **at most 25** rows even if more qualify server-side.

### 5.3 `UnifiedScannerCard.tsx`

Shows ticker, sector color, composite-related bars, flow / tape pill, IV metrics, handoff to Strategist, etc. (see component **~78+**).

---

## 6. Cross-check vs PR #230 snapshot spec & PR #234 audit

### 6.1 Alignment

- **Precomputed table + worker + sync GET** — matches snapshot architecture.
- **Regime gate** — now **`shockActive`** path (**§3**); prior EXTREME-only deviation is **resolved** in current worker.
- **Flow USD** — live tape uses **`askNotionalUsd`** / etc. from `polygonFlowHighlights` when `sessionAggregateSource === "live_raw_trades"` (**377–386**) — aligns with post–PR #235 flow-notional fix direction.

### 6.2 Deviations / gaps (beyond #234 doc)

| Topic | Finding |
|-------|---------|
| **Default `minScore=0`** | API returns **all** clean-tickers up to **`limit`**; spec language often implies “candidates = materially scored names.” Behavior is **“non-disqualified universe slice.”** |
| **`limit` default 25** | Conflicts with “could be 30+” **per HTTP response** unless client passes `limit=50` or API changes. |
| **`surfacedBy: ["momentum"]`** | Hard-coded in **`rowToCandidate`** (**64**); not three-engine semantics. |
| **`tape_quality` `degraded`** | Type and flow-zero branch exist, worker **never sets** `degraded`. |

### 6.3 Dead orchestrator wiring

- **`src/routes/`** (grep): **no** `unifiedScannerEngine`, `deterministicScanner`, or `scanner_jobs` imports found in current tree.
- Stray **comment** in `aiLabService.ts` referencing deterministic scanner v2 (**631**) — **comment only**, not wired.

---

## 7. Live state verification (run in your environment)

### 7.1 Latest `scanner_health`

```sql
SELECT id,
       cycle_started_at,
       cycle_completed_at,
       EXTRACT(EPOCH FROM (cycle_completed_at - cycle_started_at)) AS duration_seconds,
       tickers_attempted,
       tickers_succeeded,
       tickers_failed,
       failed_tickers
FROM scanner_health
ORDER BY cycle_completed_at DESC
LIMIT 3;
```

### 7.2 Scan endpoint — count and tickers

Replace `TOKEN` and host:

```bash
curl -sS -H "Authorization: Bearer TOKEN" \
  "https://<host>/api/v2/scan?universe=preset:liquidCore130&limit=50&minScore=0" \
  | jq '{n: (.candidates|length), tickers: [.candidates[].ticker], snapshot_completed_at, stale}'
```

### 7.3 If zero results — sample five failing tickers

Pick five LC130 symbols and inspect:

```sql
SELECT ticker, composite_score, disqual_flags, component_scores
FROM ticker_signal_snapshot
WHERE ticker = ANY(ARRAY['AAA','BBB',...])
ORDER BY ticker;
```

For each flag in **`disqual_flags`**, map to **§3**. If **`disqual_flags` empty** but still excluded, check **`composite_score &lt; minScore`** or **not in universe** resolution.

---

## Checklist

| # | Topic | Status |
|---|--------|--------|
| 1 | Schema + score mapping | Documented |
| 2 | Candidate rules + AND/OR | Documented; note `minScore` + `limit` |
| 3 | Disqual flags + regime shock | Documented; shock = `shockActive` |
| 4 | `scannerV2` filter/order/headers | Documented |
| 5 | Frontend | Documented |
| 6 | Spec cross-check | Documented + gaps |
| 7 | Live SQL/curl | **Template only** — run in prod |

---

*End of audit.*
