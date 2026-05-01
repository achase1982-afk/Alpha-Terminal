# Strategist pipeline — audit follow-up (Items 27, 29, 32)

This document records **review findings** and **validation procedure** for the post-audit pipeline work. It is not a substitute for running production checks.

## Item 27 — Polygon plan tier audit

### What we rely on

- **REST** (`api.polygon.io`): options chain snapshot, options trades/quotes (`strategistTapeBackfill`, `polygonFlowHighlights`), analyst Benzinga partner routes (`polygonAnalystData`).
- **WebSocket** (`wss://socket.polygon.io/options`): live options trades + quotes (`polygonOptionsWs`, `optionsWatcher`).
- **Flat files (S3)**: `polygon_options_history` backfill (scheduled in the API server bootstrap).

### Tier implications (documentary)

| Tier (typical) | Effect on this codebase |
|----------------|---------------------------|
| **Starter** | Tape backfill **skips** when `probePolygonRate` reports starter (`strategistTapeBackfill`); live WS may still connect but REST-heavy paths degrade. |
| **Developer / Advanced** | Full REST tape + chain usage as implemented. |
| **Unlimited / Enterprise** | Same code paths; higher rate limits reduce 429 risk during batch jobs. |

### Operator checklist

1. Confirm `POLYGON_API_KEY` is set and not a **revoked** starter key if tape backfill is required for Desk mode.
2. Watch logs for `starter_tier` skip in `strategistTapeBackfill` and for HTTP **429** on Polygon REST.
3. Disabling Polygon flat-file sync via env disables historical-options sync — **20d baselines** in `polygon_options_history` will not advance; flow baseline features degrade gracefully (`optionsBaselines` returns null when history is thin).

---

## Item 29 — Write-time enrichment performance review

### Hot paths

| Path | Work per event / batch |
|------|-------------------------|
| **Live watcher `handleTrade`** | NBBO lookup, `classifyForFlowPersistence`, optional `FlowLegWindow` annotate/record, `enqueueClassifiedTrade` (buffered flush). |
| **Persistence flush** | Single batched `INSERT` every 5s or 1000 rows (`optionsFlowPersistence`). |
| **Chain resolve** | Polygon chain fetch + `getContracts20dBaselineBatch` + optional Schwab snapshot (`optionsWatcher`). |
| **Tape backfill** | Per OCC: Polygon trades + quotes + `getContract20dBaseline` + inserts. |

### Findings (static review)

- **Batch baselines** for the watcher reduce N round-trips vs per-OCC queries.
- **Strike baseline table** (`options_flow_strike_baseline_daily`, when migration **0004** is applied) amortizes repeated classification; nightly `refreshVolumeVsBaselineFromStrikeTable` is a single `UPDATE … FROM` join.
- **Risk:** Very large `options_flow_raw_trades` tables — ensure **indexes** from migration **0003** exist; retention job deletes rows older than **90 days** (`flowRawTradesReclassify`).

### Suggested metrics (production)

- Log or dashboard: `flowPersist` batch duration, flush failure rate, watcher `watcher.resolve` duration, tape backfill `tradesInserted` / `occCompleted`.

---

## Item 32 — Integrated pipeline validation (Solo Desk spot check)

### Preconditions

- Schwab tokens valid (ticker + chain).
- `POLYGON_API_KEY` valid; not on starter tier if tape backfill is required.
- DB migrations **0003** and **0004** applied where applicable.

### Tickers

| Symbol | What to validate |
|--------|------------------|
| **AAPL** | Liquid chain, skew + term structure, flow highlights, optional session tape. |
| **RIVN** | Mid-cap flow + tiered notional thresholds; desk prompts receive `marketContext`. |
| **COF** | Bank / lower-liquidity name — MISSING_DATA or thinner chain paths; `dataQualitySummary` flags. |

### Steps (manual)

1. Alpha Terminal → **Strategist** → run **Analyze** for each symbol (Solo Desk / mode 4 if configured).
2. Confirm card renders: recommendation, block, or desk output; no stuck **running** after ~30 min (client timeout in `strategistPoller`).
3. For a forced **MISSING_DATA** (invalid symbol), confirm **Retry** appears and `fetchFailureMode` shows when returned by API.
4. Optional: confirm `schemaVersion` on result JSON when **Item 23** PR is merged.

### Record results below (fill after run)

| Ticker | Date (UTC) | Result status | Notes |
|--------|------------|-----------------|-------|
| AAPL | | | |
| RIVN | | | |
| COF | | | |
