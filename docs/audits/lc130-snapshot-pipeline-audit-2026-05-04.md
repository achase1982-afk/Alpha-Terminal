# LC130 snapshot and backfill pipeline — coverage audit (2026-05-04)

Investigation only (no code changes in this PR). Data was queried from the production Postgres database using the connection supplied to this audit environment, with cross-checks against application source in `artifacts/api‑server` and `lib/db`. <!-- pragma: allowlist secret -->

**Universe note:** The audit brief named a `liquidCore130` module path that is not present in this tree; the canonical list is `artifacts/api‑server/src/data/liquidCore130.ts` (130 symbols as of 2026-05-04).

**Methodology (tables §2–3):**

- **Equity row freshness:** `equity_daily.created_at` for the row with `date = max(date)` per symbol (the latest trading date stored for that symbol).
- **Chain / flow freshness:** `max(created_at)` in `options_chain_daily` and `options_flow_per_strike` per underlying.
- **STALE:** any of the three timestamps above older than 24 hours relative to query time **UTC** (~2026-05-04 21:05 UTC).
- **MISSING:** no row in the table for that symbol (none occurred for LC130 in this snapshot).
- **Earnings “current entry”:** `YES` if `corporate_events` has any row for the symbol with `earnings_date >= current_date` (forward-looking calendar row in DB). This is **not** the same as runtime `getNextEarningsDate()` (vendor + Finnhub + Yahoo); see §5.
- **IVR / HV20 / HV30:** taken from the same latest `equity_daily` row. HV30 is empty for all LC130 names in this DB because the daily snapshot path does not populate `hv_30d` (only `hv_20d` is written in `collectEquitySnapshots` / grouped bars); HV30 is expected from separate HV proxy backfill if configured.

---

## 1. Scheduler status

### `scheduleDailySnapshot` (`artifacts/api‑server/src/index.ts`)

- **Installed:** Yes. It is invoked from the deferred boot block together with other schedules (`scheduleDailySnapshot()` at server start).
- **Cadence:** Not cron syntax. `scheduleNext()` computes the next **21:30 UTC** firing on a **US trading day** (weekdays excluding a hard-coded 2026 US holiday list). After each run it reschedules the next trading day’s 21:30 UTC slot.
- **Boot catchup:** If today is a trading day, UTC hour ≥ 14, and `snapshot_collection_log` has no `status = 'completed'` row for today, the server polls for a Schwab token (60s for 30 minutes, then 30 minutes) until 21:30 UTC, then defers to the regular schedule.
- **Skip conditions:** No Schwab token (`getBestAccessToken()` null) → job logs and returns; per-date in-flight `Set` prevents duplicate runs for the same calendar date.

### Evidence: last successful full snapshot (`snapshot_collection_log`)

| date       | status    | started_at (UTC)      | completed_at (UTC) | equity_rows | chain_rows | flow_rows | aggregate_rows |
| ---------- | --------- | --------------------- | ------------------ | ----------- | ---------- | --------- | ---------------- |
| 2026-05-04 | completed | 2026-05-04 19:46:09   | 2026-05-04 20:12:31 | 144         | 199019     | 239178    | 133              |
| 2026-05-01 | completed | 2026-05-01 21:30:00   | 2026-05-01 21:38:26 | 144         | 128955     | 33234     | 133              |
| 2026-04-30 | completed | 2026-04-30 21:30:00   | 2026-04-30 21:38:43 | 143         | 127963     | 32984     | 132              |
| 2026-04-22 | failed    | 2026-04-22 21:30:00   | 2026-04-23 12:52:50 | 141         | 120793     | 32484     | 130              | auto-recovered stale `running` |
| 2026-04-17 | failed    | 2026-04-17 21:30:00   | 2026-04-22 01:29:03 | 0           | 0          | 0         | 0                | auto-recovered stale `running` |

Prior completed runs from 2026-04-21 through 2026-05-01 show **21:30 UTC** starts (~8 minutes duration). **2026-05-04** started at **19:46 UTC** (off the usual cron minute), consistent with **boot catchup** after deploy or restart rather than the scheduled tick alone.

### Other scheduled / boot backfill jobs (same server)

| Mechanism | Schedule / trigger | Role |
| --------- | ------------------- | ---- |
| `scheduleDailyScreenRefresh` | First run after local **13:00 UTC** equivalent, then every 24h | Refreshes saved scanner screens in DB (`runDailyScreenRefresh` in `routes/scanner.ts`) — **not** LC130 snapshot tables. |
| `scheduleCanonicalIvAccumulator` | **22:00 UTC** daily | `accumulateCanonicalIvForDate` — IV accumulator, separate from per-symbol `equity_daily` HV/IVR in snapshot. |
| `schedulePolygonFlatFilesSync` | **03:30 UTC** daily (+ optional boot catchup) | Overnight **options tape** flat-file import into `polygon_options_history` (see `index.ts` flat-files section for credential env vars and kill switches). **Last success sample:** `polygon_sync_log` trade_date **2026-05-01** synced **2026-05-02 04:29 UTC**. | <!-- pragma: allowlist secret -->
| `scheduleNightlyFlowRawMaintenance` | **04:45 UTC** daily | Raw flow maintenance / reclassify (`runNightlyFlowRawMaintenance`). |
| `startUniverseRebuildSchedule` | Weekly interval | Core options universe rebuild (`universeBuilder.ts`). |
| `triggerLiquidCoreBackfill` | Once at boot | `updateEquityDailyFromGroupedBars` for LC130 (Polygon grouped daily) — **not** the same as `runFullSnapshot`. |
| `triggerFlowBootstrap` | Once at boot if `flow_daily_aggregates` empty | `backfillPolygonFlow` REST backfill (30d) — rare after initial deploy. |
| `startPolygonPCRatioPoller` | Every **60s** | Polls Polygon options snapshot totals for **SPY** and **SPX** (not LC130-wide). |
| `startOptionsWatcher` + `startFlowPersistence` + `startFlowRollup` | Watcher tick + rollup **60s** | Live Polygon options tape → raw trades → `options_flow_exec_per_strike` when WS enabled. |
| `scheduleScannerJobsGc` | Hourly | Cleans `scanner_jobs`. |

**“Last successful run”** is clearest per subsystem: use `snapshot_collection_log.completed_at` for the EOD pipeline, `polygon_sync_log.synced_at` for flat files, and logs/telemetry for intraday pollers.

---

## 2. Data coverage per LC130 ticker

**Summary at audit time:** 0 / 130 **STALE** on equity, chain, or flow freshness; 0 **MISSING**. **9** symbols have a forward `corporate_events` row; **121** do not. **17** symbols have **null IVR** on the latest row; **130** have **null HV30** (column unused by current snapshot writer). **HV20** is populated for all 130 on the latest date.

Full table sorted by **oldest `options_flow_per_strike` activity first** (then chain, then equity), with **OK** = updated within 24h:

<!-- LC130_COVERAGE_TABLE_BEGIN -->

| Symbol | Eq updated (latest row) | Eq<24h | Chain<24h | Flow<24h | Earn row≥today | IVR | HV20 | HV30 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DIA | 2026-05-04 14:46 | OK | OK | OK | NO | 29.0 | 14.00 | — |
| TQQQ | 2026-05-04 14:46 | OK | OK | OK | NO | 60.0 | 44.32 | — |
| NVDA | 2026-05-04 14:46 | OK | OK | OK | NO | 43.0 | 34.83 | — |
| AAPL | 2026-05-04 14:46 | OK | OK | OK | YES | 19.0 | 26.10 | — |
| AMZN | 2026-05-04 14:46 | OK | OK | OK | NO | 12.0 | 27.06 | — |
| MSFT | 2026-05-04 14:46 | OK | OK | OK | NO | 18.0 | 34.16 | — |
| AMD | 2026-05-04 14:46 | OK | OK | OK | NO | 72.0 | 60.73 | — |
| GOOGL | 2026-05-04 14:46 | OK | OK | OK | NO | 22.0 | 37.78 | — |
| GOOG | 2026-05-04 14:46 | OK | OK | OK | YES | 19.0 | 37.53 | — |
| SMCI | 2026-05-04 14:46 | OK | OK | OK | YES | 68.0 | 68.73 | — |
| PLTR | 2026-05-04 14:46 | OK | OK | OK | NO | 43.0 | 57.18 | — |
| CRWD | 2026-05-04 14:46 | OK | OK | OK | YES | 64.0 | 53.90 | — |
| PANW | 2026-05-04 14:46 | OK | OK | OK | NO | 96.0 | 48.05 | — |
| MU | 2026-05-04 14:46 | OK | OK | OK | YES | 56.0 | 56.27 | — |
| MRVL | 2026-05-04 14:46 | OK | OK | OK | YES | 85.0 | 47.43 | — |
| INTC | 2026-05-04 14:46 | OK | OK | OK | NO | 52.0 | 90.80 | — |
| QCOM | 2026-05-04 14:46 | OK | OK | OK | NO | 36.0 | 62.87 | — |
| AMAT | 2026-05-04 14:46 | OK | OK | OK | NO | 77.0 | 45.70 | — |
| LRCX | 2026-05-04 14:46 | OK | OK | OK | NO | 51.0 | 50.93 | — |
| KLAC | 2026-05-04 14:46 | OK | OK | OK | NO | — | 48.25 | — |
| NXPI | 2026-05-04 14:46 | OK | OK | OK | NO | — | 84.38 | — |
| TXN | 2026-05-04 14:46 | OK | OK | OK | NO | 19.0 | 67.49 | — |
| ADI | 2026-05-04 14:46 | OK | OK | OK | NO | 71.0 | 38.53 | — |
| MCHP | 2026-05-04 14:46 | OK | OK | OK | NO | 65.0 | 46.35 | — |
| HOOD | 2026-05-04 14:46 | OK | OK | OK | YES | 22.0 | 83.65 | — |
| RIVN | 2026-05-04 14:46 | OK | OK | OK | NO | 24.0 | 50.90 | — |
| DKNG | 2026-05-04 14:46 | OK | OK | OK | NO | 72.0 | 42.47 | — |
| ROKU | 2026-05-04 14:46 | OK | OK | OK | NO | 12.0 | 38.90 | — |
| PATH | 2026-05-04 14:46 | OK | OK | OK | NO | 83.0 | 59.74 | — |
| DDOG | 2026-05-04 14:46 | OK | OK | OK | NO | 62.0 | 56.26 | — |
| HUBS | 2026-05-04 14:46 | OK | OK | OK | NO | — | 72.27 | — |
| SHOP | 2026-05-04 14:46 | OK | OK | OK | NO | 54.0 | 55.83 | — |
| CRDO | 2026-05-04 14:46 | OK | OK | OK | NO | 66.0 | 101.99 | — |
| APP | 2026-05-04 14:46 | OK | OK | OK | NO | 48.0 | 60.19 | — |
| NFLX | 2026-05-04 14:46 | OK | OK | OK | NO | 37.0 | 43.43 | — |
| JPM | 2026-05-04 14:46 | OK | OK | OK | NO | 32.0 | 19.69 | — |
| BAC | 2026-05-04 14:46 | OK | OK | OK | NO | 31.0 | 18.65 | — |
| GS | 2026-05-04 14:46 | OK | OK | OK | NO | 38.0 | 27.30 | — |
| SCHW | 2026-05-04 14:46 | OK | OK | OK | NO | 40.0 | 38.69 | — |
| BLK | 2026-05-04 14:46 | OK | OK | OK | NO | 43.0 | 27.47 | — |
| MS | 2026-05-04 14:46 | OK | OK | OK | NO | 34.0 | 27.11 | — |
| AXP | 2026-05-04 14:46 | OK | OK | OK | NO | 25.0 | 28.40 | — |
| COF | 2026-05-04 14:46 | OK | OK | OK | NO | 25.0 | 32.20 | — |
| PNC | 2026-05-04 14:46 | OK | OK | OK | NO | 39.0 | 21.04 | — |
| TFC | 2026-05-04 14:46 | OK | OK | OK | NO | — | 20.59 | — |
| USB | 2026-05-04 14:46 | OK | OK | OK | NO | 35.0 | 20.22 | — |
| FITB | 2026-05-04 14:46 | OK | OK | OK | NO | 23.0 | 21.85 | — |
| HBAN | 2026-05-04 14:46 | OK | OK | OK | NO | 28.0 | 22.33 | — |
| CFG | 2026-05-04 14:46 | OK | OK | OK | NO | — | 20.96 | — |
| BK | 2026-05-04 14:46 | OK | OK | OK | NO | — | 18.35 | — |
| LLY | 2026-05-04 14:46 | OK | OK | OK | NO | 17.0 | 44.62 | — |
| UNH | 2026-05-04 14:46 | OK | OK | OK | NO | 2.0 | 40.03 | — |
| JNJ | 2026-05-04 14:46 | OK | OK | OK | NO | 57.0 | 17.64 | — |
| ABBV | 2026-05-04 14:46 | OK | OK | OK | NO | 46.0 | 27.42 | — |
| PFE | 2026-05-04 14:46 | OK | OK | OK | NO | 40.0 | 19.74 | — |
| MRK | 2026-05-04 14:46 | OK | OK | OK | NO | 50.0 | 30.01 | — |
| AMGN | 2026-05-04 14:46 | OK | OK | OK | NO | 28.0 | 27.16 | — |
| GILD | 2026-05-04 14:46 | OK | OK | OK | NO | 64.0 | 20.20 | — |
| VRTX | 2026-05-04 14:46 | OK | OK | OK | NO | 53.0 | 19.37 | — |
| REGN | 2026-05-04 14:46 | OK | OK | OK | NO | 22.0 | 31.70 | — |
| BMY | 2026-05-04 14:46 | OK | OK | OK | NO | 37.0 | 31.87 | — |
| MDT | 2026-05-04 14:46 | OK | OK | OK | NO | 90.0 | 24.46 | — |
| SYK | 2026-05-04 14:46 | OK | OK | OK | NO | — | 32.05 | — |
| ISRG | 2026-05-04 14:46 | OK | OK | OK | NO | 13.0 | 36.31 | — |
| BSX | 2026-05-04 14:46 | OK | OK | OK | NO | 26.0 | 49.29 | — |
| ELV | 2026-05-04 14:46 | OK | OK | OK | NO | — | 30.66 | — |
| CI | 2026-05-04 14:46 | OK | OK | OK | NO | 31.0 | 26.80 | — |
| HUM | 2026-05-04 14:46 | OK | OK | OK | NO | 28.0 | 42.41 | — |
| WMT | 2026-05-04 14:46 | OK | OK | OK | NO | 69.0 | 27.95 | — |
| PG | 2026-05-04 14:46 | OK | OK | OK | NO | 17.0 | 21.35 | — |
| KO | 2026-05-04 14:46 | OK | OK | OK | NO | 53.0 | 21.69 | — |
| PEP | 2026-05-04 14:46 | OK | OK | OK | NO | 27.0 | 19.02 | — |
| MCD | 2026-05-04 14:46 | OK | OK | OK | NO | 59.0 | 20.61 | — |
| NKE | 2026-05-04 14:46 | OK | OK | OK | NO | 33.0 | 26.53 | — |
| TGT | 2026-05-04 14:46 | OK | OK | OK | NO | 42.0 | 28.84 | — |
| DG | 2026-05-04 14:46 | OK | OK | OK | NO | 79.0 | 34.76 | — |
| DLTR | 2026-05-04 14:46 | OK | OK | OK | NO | 83.0 | 43.63 | — |
| BURL | 2026-05-04 14:46 | OK | OK | OK | NO | 57.0 | 26.93 | — |
| ROST | 2026-05-04 14:46 | OK | OK | OK | NO | 74.0 | 21.04 | — |
| TJX | 2026-05-04 14:46 | OK | OK | OK | NO | 68.0 | 21.06 | — |
| XOM | 2026-05-04 14:46 | OK | OK | OK | NO | 98.0 | 29.36 | — |
| CVX | 2026-05-04 14:46 | OK | OK | OK | NO | 89.0 | 27.23 | — |
| COP | 2026-05-04 14:46 | OK | OK | OK | NO | 86.0 | 38.88 | — |
| OXY | 2026-05-04 14:46 | OK | OK | OK | NO | 73.0 | 42.01 | — |
| SLB | 2026-05-04 14:46 | OK | OK | OK | NO | 27.0 | 22.44 | — |
| BKR | 2026-05-04 14:46 | OK | OK | OK | NO | — | 35.04 | — |
| EOG | 2026-05-04 14:46 | OK | OK | OK | NO | 59.0 | 29.12 | — |
| FANG | 2026-05-04 14:46 | OK | OK | OK | NO | — | 30.00 | — |
| DVN | 2026-05-04 14:46 | OK | OK | OK | NO | 69.0 | 34.87 | — |
| MPC | 2026-05-04 14:46 | OK | OK | OK | NO | — | 40.87 | — |
| PSX | 2026-05-04 14:46 | OK | OK | OK | NO | 61.0 | 38.36 | — |
| VLO | 2026-05-04 14:46 | OK | OK | OK | NO | 48.0 | 44.97 | — |
| OKE | 2026-05-04 14:46 | OK | OK | OK | NO | 65.0 | 28.53 | — |
| TRGP | 2026-05-04 14:46 | OK | OK | OK | NO | — | 26.96 | — |
| LNG | 2026-05-04 14:46 | OK | OK | OK | NO | 59.0 | 31.45 | — |
| CAT | 2026-05-04 14:46 | OK | OK | OK | NO | 26.0 | 43.44 | — |
| HON | 2026-05-04 14:46 | OK | OK | OK | NO | 64.0 | 26.12 | — |
| RTX | 2026-05-04 14:46 | OK | OK | OK | NO | 31.0 | 28.23 | — |
| LMT | 2026-05-04 14:46 | OK | OK | OK | NO | 29.0 | 26.48 | — |
| NOC | 2026-05-04 14:46 | OK | OK | OK | NO | — | 29.77 | — |
| BA | 2026-05-04 14:46 | OK | OK | OK | NO | 23.0 | 33.27 | — |
| DAL | 2026-05-04 14:46 | OK | OK | OK | NO | 34.0 | 36.47 | — |
| UAL | 2026-05-04 14:46 | OK | OK | OK | NO | 39.0 | 50.98 | — |
| LUV | 2026-05-04 14:46 | OK | OK | OK | NO | 32.0 | 49.45 | — |
| UNP | 2026-05-04 14:46 | OK | OK | OK | NO | 26.0 | 32.84 | — |
| NSC | 2026-05-04 14:46 | OK | OK | OK | NO | — | 29.58 | — |
| GEHC | 2026-05-04 14:46 | OK | OK | OK | NO | 29.0 | 59.37 | — |
| TDG | 2026-05-04 14:46 | OK | OK | OK | NO | — | 40.89 | — |
| MA | 2026-05-04 14:46 | OK | OK | OK | NO | 40.0 | 26.19 | — |
| CRM | 2026-05-04 14:46 | OK | OK | OK | NO | 87.0 | 51.59 | — |
| NOW | 2026-05-04 14:46 | OK | OK | OK | NO | 30.0 | 95.98 | — |
| DIS | 2026-05-04 14:46 | OK | OK | OK | NO | 64.0 | 21.97 | — |
| SPY | 2026-05-04 14:46 | OK | OK | OK | NO | 33.0 | 11.82 | — |
| QQQ | 2026-05-04 14:46 | OK | OK | OK | NO | 42.0 | 15.27 | — |
| IWM | 2026-05-04 14:46 | OK | OK | OK | NO | 26.0 | 16.75 | — |
| SLV | 2026-05-04 14:46 | OK | OK | OK | NO | 29.0 | 40.69 | — |
| META | 2026-05-04 14:46 | OK | OK | OK | NO | 10.0 | 47.46 | — |
| AVGO | 2026-05-04 14:46 | OK | OK | OK | NO | 54.0 | 41.07 | — |
| COIN | 2026-05-04 14:46 | OK | OK | OK | NO | 54.0 | 60.75 | — |
| SNOW | 2026-05-04 14:46 | OK | OK | OK | NO | 100.0 | 81.51 | — |
| RF | 2026-05-04 14:46 | OK | OK | OK | YES | — | 22.81 | — |
| COST | 2026-05-04 14:46 | OK | OK | OK | NO | 65.0 | 18.93 | — |
| KR | 2026-05-04 14:46 | OK | OK | OK | NO | 37.0 | 24.23 | — |
| CSX | 2026-05-04 14:46 | OK | OK | OK | NO | 26.0 | 28.27 | — |
| PCAR | 2026-05-04 14:46 | OK | OK | OK | NO | — | 34.54 | — |
| V | 2026-05-04 14:46 | OK | OK | OK | NO | 29.0 | 32.12 | — |
| ACN | 2026-05-04 14:46 | OK | OK | OK | NO | 69.0 | 41.99 | — |
| TSLA | 2026-05-04 14:46 | OK | OK | OK | YES | 20.0 | 39.09 | — |
| GLD | 2026-05-04 14:46 | OK | OK | OK | NO | 34.0 | 19.73 | — |
| USO | 2026-05-04 14:46 | OK | OK | OK | NO | 52.0 | 69.73 | — |

<!-- LC130_COVERAGE_TABLE_END -->

**Interpretation gaps vs strategist “earnings calendar”:** Most LC130 names show **Earn row≥today = NO** in `corporate_events` because that table is populated from Polygon/Benzinga earnings bundles (`polygonEarningsHistory.ts`), not from every `getNextEarningsDate()` resolution. Runtime earnings for scanner/strategist still hit vendor + Finnhub + Yahoo (see §5).

---

## 3. ETF coverage (LC130 ETFs and sector ETFs used by IV pass)

### LC130 ETFs (SPY, QQQ, IWM, DIA, TQQQ, GLD, SLV, USO)

Same pipeline as single names: all show **OK** within 24h in §2. **SPY / QQQ / GLD** appear last in the sorted table because their `options_flow_per_strike` writes finished later in the 2026-05-04 run (large option universes).

### Sector ETFs in `SECTOR_ETF_SYMBOLS` but not in LC130 (XLE, XLF, XLK, XLV, …)

`runFullSnapshot` adds these for the **IV/IVR pass** (`computeIVFromFlow`) even when they are not in the LC130 list.

| Symbol | `equity_daily` max date | `options_chain_daily` (max created_at) | `options_flow_per_strike` (max created_at) |
| ------ | ----------------------- | ---------------------------------------- | -------------------------------------------- |
| XLE, XLF, XLK, XLV, XLI, XLC, XLY, XLP, XLU, XLRE, XLB | 2026-05-04 | *(no rows)* | 2026-04-29 … 2026-04-29 (varies); **XLRE / XLC: no flow rows** |

So sector ETFs get **equity** snapshots but typically **do not** get Schwab `options_chain_daily` rows and have **stale or missing** Polygon per-strike flow compared to LC130. That is expected from the current symbol list passed to `collectOptionsChainSnapshots` / `collectPolygonFlowFromAPI` (LC130 + tracked only), not a Polygon ETF limitation.

### “Polygon flow scan failing” for SPY / QQQ / GLD — what the telemetry shows

`failure_log` entries for **`Flow scan failed for SPY|QQQ|GLD`** in the last few days carry:

```json
{"symbol":"SPY","date":"2026-05-04","error":"The operation was aborted due to timeout"}
```

That string is produced when **`fetch()` hits `AbortSignal.timeout(20_000)`** inside `fetchWithRetry` in `dailySnapshot.ts` — i.e. **slow or hung HTTP to Polygon**, not an HTTP 4xx/5xx from a wrong path. **SPY/QQQ/GLD** rank highest in **retry counts** in the last 7d sample (6 / 4 / 4 failures) because their option snapshots are the largest and spend longest in pagination.

A direct **`GET /v3/snapshot/options/{ticker}`** probe with the environment’s API key returned **200 + results** for SPY, QQQ, GLD, and AAPL, so the endpoint and ticker symbols are valid; failures correlate with **timeout / volume**, not “ETFs unsupported.”

---

## 4. Root causes (STALE / MISSING / partial metrics)

| Symptom | Cause in code / data | Notes |
| ------- | -------------------- | ----- |
| No STALE/MISSING for LC130 tables on 2026-05-04 | Full snapshot completed; per-symbol loop eventually wrote rows. | If snapshot had **failed entirely**, chain/flow could lag while equity from grouped bars still updates. |
| `snapshot_collection_log` **failed** rows (Apr 17, Apr 22) | **Stale `running` recovery** and/or **45-minute hard timeout** on `runFullSnapshot` — documented in `dailySnapshot.ts`. | After timeout, **inner fetches may still run** (race caveat in code comments). |
| SPY/QQQ/GLD **telemetry failures** | **`collectPolygonFlowFromAPI`**: sequential symbol loop, **20s per HTTP** timeout, **up to 50 pages × 3 passes** per symbol for dense names → frequent **`AbortSignal` timeout** under load. | Not wrong ticker; not ETF-specific denial — **duration / pagination / timeout**. |
| **IVR null** on 17 names | **`computeIVFromFlow`** only sets IVR when IV30 can be derived from flow rows with usable IV; `computeIVRForSymbol` may return null if history insufficient. | Separate from chain `ivr_source='chain'` path. |
| **HV30 null** everywhere | Snapshot pipeline writes **`hv_20d`** from closes; **`hv_30d`** not set in `collectEquitySnapshots` / grouped bar path in the reviewed code. | Use `hvProxyBackfill` or extend snapshot if HV30 is required. |
| **`onConflictDoNothing` on `options_flow_per_strike`** | Inserts use **`onConflictDoNothing()`** in `collectPolygonFlowFromAPI` (and `backfillPolygonFlow`). | Re-runs **silently skip** updating existing strike-day keys — if Polygon **corrects** volumes/IV later, DB may stay stale until a manual purge or upsert change. |
| **`corporate_events` sparse** | Table is filled from **Polygon Benzinga** earnings bundle flows, not from every scanner earnings lookup. | Do not equate empty `corporate_events` with “no earnings.” |
| Sector ETF **missing chain/flow** | **Not in `symbols` array** for chain/flow collection in `runFullSnapshot`. | RS/sector logic still ingests **equity** for those tickers. |

---

## 5. Yahoo HTTP 401

### Every Yahoo HTTP caller in this repository (grep: `query1.finance.yahoo.com` / `finance.yahoo.com/quote`)

| File | Purpose |
| ---- | ------- |
| `artifacts/api‑server/src/lib/earningsService.ts` | `fetchYahoo`: `quoteSummary?modules=calendarEvents`; on non-200, **fallback scrape** of `finance.yahoo.com/quote/{sym}/`. Logs **`logFailure("YAHOO", ...)`** on failures. |
| `artifacts/api‑server/src/routes/market.ts` | `fetchYahooEarningsDate` — same pattern for market routes / HTML helpers. |
| `artifacts/api‑server/src/routes/market.ts` | **Search link** builder (`https://finance.yahoo.com/search?...`) — not an API call. |
| `attached_assets/*.txt` | Archived pasted content only. |

### Primary vs fallback (`earningsService.getNextEarningsDate`)

Order of authority:

1. **Vendor primary** (Benzinga API key present) when **confirmed** earnings date is returned.
2. Else **Finnhub** (`/calendar/earnings`) and **Yahoo** in parallel; logic **prefers Finnhub** when both exist / disagree.
3. Else vendor unconfirmed, else Yahoo alone.

So **Yahoo is not the sole primary**; it is a **parallel / fallback** path whenever vendor-confirmed data is absent.

### Telemetry volume

In **`failure_log` last 7 days:** **`YAHOO` + `WARN` = 1225`**. Finnhub failures in `earningsService.fetchFinnhub` only call `logger.warn` (they are **not** written to `failure_log` under a `FINNHUB` system). Sample Yahoo rows show **`Yahoo earnings calendar fetch failed: HTTP 401`** with `details.status = 401` for many LC130 symbols on **2026-05-04**.

### Should Yahoo be removed?

Not strictly required for *data* if **`FINNHUB_API_KEY`** and/or **vendor calendar** cover the universe — but **401 indicates Yahoo is blocking unauthenticated `quoteSummary`**. Options: **remove Yahoo**, **replace with a supported API**, or **add compliant credentials / rate limits** if contractually available. Scraping `finance.yahoo.com/quote` as fallback may hit the same wall and adds operational risk.

---

## Proposed remediation plan (for review — not implemented)

1. **Polygon flow collection hardening:** Raise or tier timeouts for `fetchWithRetry` in snapshot flow; reduce passes or page caps for mega-underlyings; add **per-symbol timing metrics**; consider **widening strike filters** instead of multiple full passes for SPY/QQQ.
2. **`options_flow_per_strike` upsert policy:** Replace **`onConflictDoNothing`** with **`onConflictDoUpdate`** for fields that must reflect EOD corrections, or **delete-then-insert** for the session date — align with any known duplicate-key behavior.
3. **HV30 / IVR contract:** Either **populate `hv_30d`** in the daily snapshot path or **document** that HV30 comes exclusively from `hvProxyBackfill`; add **alerts** when `ivr` is null while chain IV exists.
4. **Sector ETFs:** If scanner/regime needs sector **chain/flow**, add **`SECTOR_ETF_SYMBOLS`** to `collectOptionsChainSnapshots` / `collectPolygonFlowFromAPI` inputs (accepting higher Polygon/Schwab cost).
5. **Yahoo 401:** Prefer **Finnhub + vendor** only in production; **gate Yahoo** behind env flag; **throttle** telemetry noise (one summary per scan vs per ticker).
6. **Discovery latency:** **`runDiscoveryScan`** scores **sequentially** after batch DB loads; optional **bounded parallelism** for CPU-only scoring (not API), or **defer** `getPolygonFlowHighlightsBulk` / earnings fetches with batching.

---

## Appendix: SQL snippets used

LC130 list was inlined as a 130-element array matching `liquidCore130.ts`. Staleness threshold: `now() - interval '24 hours'`. `failure_log` queries filtered by `system`, `message`, and `timestamp`.
