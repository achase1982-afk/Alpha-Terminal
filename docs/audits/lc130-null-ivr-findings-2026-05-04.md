# LC130 null IVR / null `ivr_source` — findings (2026-05-04)

This supplements the pipeline audit. **ETFs are out of scope** (per PR); analysis is **LC130 only**.

## Query

Latest LC130 session date:

```sql
WITH lc(s) AS (
  SELECT unnest(ARRAY[/* 130 LC130 symbols */]::text[]) AS s
),
mx AS (SELECT max(e.date) AS d FROM equity_daily e JOIN lc ON lc.s = e.symbol)
SELECT e.symbol, e.date, e.ivr, e.ivr_source, (e.iv_30d IS NOT NULL) AS has_iv30
FROM equity_daily e
JOIN lc ON lc.s = e.symbol
JOIN mx ON e.date = mx.d
WHERE e.ivr IS NULL OR e.ivr_source IS NULL
ORDER BY e.symbol;
```

## Results (production DB snapshot)

On the latest shared `equity_daily.date` for LC130:

| Bucket | Tickers | Notes |
|--------|---------|-------|
| `ivr` **NULL** and `iv_30d` **NULL** | BK, BKR, CFG, ELV, FANG, HUBS, KLAC, MPC, NOC, NSC, NXPI, PCAR, RF, SYK, TDG, TFC, TRGP (17 names) | **No IV30** on that row → `computeIVRForSymbol` cannot rank. Chain `selectIv30d` excluded all quality-filtered candidates **and** flow snapshot did not yield usable IV for that session. **Accepted** for `ivr_missing` gate unless product widens filters. |
| `ivr` **non-null** but `ivr_source` **NULL** | *(none on latest date after `ivr_source` backfill for LC130 rows with IVR set)* | Previously FITB, HBAN, OKE showed IVR without source (legacy writer). **SQL backfill** set `ivr_source = 'chain'` where `ivr` IS NOT NULL for LC130 symbols on all dates; **forward** snapshot sets `ivr_source` whenever chain/flow writes IV30. |

## HV30 historical backfill (executed)

Ran a **one-shot SQL** update on `equity_daily` for LC130 symbols: 30-day rolling sample standard deviation of log returns × √252 × 100, aligned with in-app `computeHV30` (31 closes → 30 returns). **~31k rows** updated (all historical LC130 rows with sufficient closes).

Re-ran coverage check on latest LC130 date: **HV20 and HV30 non-null for all 130**; **IVR still null on 17** (same `iv_30d` gap).

## Historical IVR — “permanently broken”?

For each symbol with **null `ivr` on latest date**, count prior rows with **non-null `ivr`**:

- **All 17 null-IVR names** had **many** historical rows with **non-null `ivr`** in `equity_daily` (not permanently broken; latest day is a **point failure** / missing IV30 for that session).

## Acceptance vs code fix

- **Missing IV30 on a given day** (illiquid / filtered chain + empty flow IV): **No bug in IVR math** — the new scanner’s `ivr_missing` gate is the correct outcome until chain/flow supplies IV30 or proxy history crosses thresholds. Optional product: widen `selectIv30d` gates for specific names (out of scope unless requested).

- **`ivr` set but `ivr_source` null**: **Fixed** via backfill SQL + forward writer always tagging source when IV is written from chain/flow.

## Logs

`failure_log` “Flow scan failed” entries for heavy names are **timeouts**, not root cause for all 17; the **dominant** explainable cause for null IVR on latest date is **`iv_30d` absent** after chain+flow passes for that session.
