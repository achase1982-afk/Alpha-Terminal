# Diagnosis: `options_flow_raw_trades` null `side` / scanner aggregations (2026-05-14)

## Part 1 — Live SQL (last 24 hours)

### Query 1 — Tuning universe symbols

```sql
-- Results captured from production-connected `DATABASE_URL` in CI/agent environment.
```

| underlying_symbol | total_rows | null_side | mid_side | classified_side | null_notional | total_notional |
|---------------------|-----------:|----------:|----------:|----------------:|--------------:|---------------:|
| MU                  | 30,059     | 30,059    | 0         | 0               | 0             | 287,218,366    |
| IONQ                | 3,207      | 96        | 1,308     | 1,803           | 0             | 2,699,112      |

Other tickers in the IN list had **no rows** in the 24h window in this snapshot.

**Observations**

- **MU**: Every row has `side IS NULL`, but **notional is populated** (`null_notional = 0`, large `SUM(notional)`). This rules out “aggregation SQL ignores non-zero notional” as the primary failure mode for MU; it matches **missing aggressor classification** (CASE A), not CASE B (zero notional).
- **IONQ**: Mixed classification; majority of rows have `ask`/`bid` sides.

### Query 2 — Mega-cap core

Only **MSFT** had rows in the same 24h window in this snapshot: 6,397 rows, **3** null-side, **4,898** classified, non-zero total notional.

### Query 3 — Phase 2 / job visibility

- **Production log grep** for `phase2` / `tapeBackfillPhase2` in the last 7 days was **not run** from this repository environment (no log sink access).
- **`scanner_tape_metrics`** (latest rows for related tickers) showed recent runs such as IONQ `2026-05-13` **partial**, SMCI `2026-05-08` **complete**, etc. This table records tape backfill **runs**, not per-row Phase 2 success.

---

## Part 2 — Root cause

### Classification: **CASE A** (primary)

1. **Phase 1** can insert rows with `side: null` when `classifyForFlowPersistence` has no usable NBBO (`resolveFreshOptionNbbo` + `strictFreshQuote` path in `strategistTapeBackfill.ts`).
2. **Phase 2** is supposed to fill `side` (and refresh several fields) using Polygon `/v3/quotes` and `isNull(side)` updates keyed by `(underlying, session date, option_symbol, source_trade_id)`.
3. **Wall-clock split** was **50% phase 1 / 50% phase 2** of the symbol budget. Phase 2 work (quotes pagination + one DB transaction per OCC) is heavier than phase 1 for the same OCC list. Many OCC workers hit `phase2Deadline` immediately (`skipped_budget`) and **never run updates**, leaving large `side IS NULL` populations (MU: ~30k rows on session `2026-05-13`).
4. **Post-run `reclassifyUnclassifiedTrades`** (queued when truncation or null-side remains) defaulted to **5,000 rows** and **30s** per invocation — insufficient to drain a **30k+** backlog, and only **one** invocation was queued per backfill.

### Notional

For MU in this DB, **notional is not null**; the user-reported “$0 notional” line is consistent with **directional** aggregates (`bullishNotional + bearishNotional === 0` when all `side` are null) and/or UI copy, not with `SUM(notional)` over all prints. **CASE B** (classified side but zero notional) is **not** supported by the MU sample above.

### CASE C (API aggregation bug)

`scannerFlowContext` / `scannerV3SymbolEvents` use standard `SUM`/`CASE` on `side` and `notional`. With **all** `side` null, directional sums are legitimately zero. No API bug is required to explain MU’s state.

---

## Part 3 — Fix applied (code)

| Change | File | Purpose |
|--------|------|---------|
| **Phase 2 budget** | `artifacts/api-server/src/lib/strategistTapeBackfill.ts` | Allocate **~62%** of symbol wall time to phase 2 (`phase1Ms = floor(budgetMs * 0.38)`), reducing `skipped_budget` Phase 2 exits. |
| **Reclassify catch-up** | Same | After backfill, run up to **8** passes of `reclassifyUnclassifiedTrades` with **20k rows / 120s** per pass, stopping when a pass reclassifies fewer than **25** rows. |
| **Reclassifier defaults** | `artifacts/api-server/src/lib/optionsTradeReclassifier.ts` | Raise defaults to **20,000** rows and **120,000** ms so each pass can clear more of the backlog. |

No DB migration. **Existing rows** still need a **new** backfill run, manual `reclassifyUnclassifiedTrades` invocation, or the queued catch-up after the next qualifying tape backfill to pick up classification.

---

## Part 4 — Verification SQL (re-run after deploy / catch-up)

Re-run the Part 1 queries. Expected after healthy Phase 2 + reclassify:

- `null_side` **drops materially** vs total rows for names like MU.
- `classified_side` grows toward `total_rows` (minus intentional `mid` / unknown).
- `SUM(notional)` remains non-zero where tape exists.

Optional spot check:

```sql
SELECT COUNT(*) FILTER (WHERE side IS NULL) AS null_side
FROM options_flow_raw_trades
WHERE underlying_symbol = 'MU' AND date = CURRENT_DATE - 1;
```

(Adjust `date` to the active session you care about.)

---

## Operational notes

- **Schedule**: `runStrategistTapeBackfill` is invoked from **flow capture / strategist** paths (not a standalone cron in-repo); operators should confirm Polygon key tier and caller timeouts allow the enlarged phase 2 slice.
- **Manual catch-up**: For a one-off drain without waiting for the next backfill, call `reclassifyUnclassifiedTrades(symbol, { maxRows, deadlineMs })` from an ops script or REPL in multiple passes until `reclassified` tails off.
