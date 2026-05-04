# `selectIv30d` root cause — 17 LC130 tickers with NULL IVR (2026-05-04)

**Scope:** Audit only (no code changes). **Universe:** LC130 names that had **NULL `ivr`** on the latest snapshot row in `equity_daily` when this audit was run:  
`BK`, `BKR`, `CFG`, `ELV`, `FANG`, `HUBS`, `KLAC`, `MPC`, `NOC`, `NSC`, `NXPI`, `PCAR`, `RF`, `SYK`, `TDG`, `TFC`, `TRGP`.

**Snapshot session date:** `2026-05-04` (matches `max(equity_daily.date)` across these symbols).

**Source of truth for `selectIv30d`:** `src/lib/dailySnapshot.ts` in the HTTP API service package (under the top-level `artifacts/` tree). Same logic is used for chain-derived and flow-derived IV30 selection.

---

## Section 6 — `selectIv30d` filter inventory (read first)

Implementation: `selectIv30d(symbol, spot, rows: Iv30Candidate[])` in `dailySnapshot.ts`.

### Preconditions (before `.filter`)

| Step | Code location | Condition | Constant / rule |
|------|---------------|-----------|-----------------|
| Early return | `if (spot <= 0) return null;` | Spot must be positive | N/A |

### Per-row map (`rows.map`)

| Field | Logic |
|-------|--------|
| `iv` | `normalizeIV(r.impliedVolatility)` — see `ivNormalize.ts` (reject null, non-finite, ≤ -100, scale if > 5, clamp to ~0.01–5). |
| `dte` | `r.dte ?? 0` — **missing DTE becomes 0** (always fails DTE window below). |
| `relSpread` | If `bid, ask > 0`: `(ask-bid)/mid`, else `null`. **`null` relSpread is allowed** through the spread gate. |
| `volume` | `r.volume ?? r.dailyVolume ?? 0` |
| `openInterest` | `r.openInterest ?? 0` |
| `moneyness` | `abs(strike - spot) / spot` |

### `.filter` gate (TypeScript `.filter` callback)

All of the following must be **true** for a row to become a candidate. **First failing condition per row** depends on row shape; for the 17 tickers on 2026-05-04 the **hard blocker is always DTE** (see §5).

| # | Condition in code | Constant | Approx. line (file may shift) |
|---|---------------------|----------|--------------------------------|
| 1 | `c.iv != null` | IV must survive `normalizeIV` | ~403 |
| 2 | `c.dte >= IV30_MIN_DTE` | `IV30_MIN_DTE = 20` | ~404 |
| 3 | `c.dte <= IV30_MAX_DTE` | `IV30_MAX_DTE = 40` | ~405 |
| 4 | `c.moneyness <= IV30_ATM_MONEYNESS` | `0.05` (±5% of spot) | ~406 |
| 5 | `(c.relSpread == null \|\| c.relSpread <= IV30_MAX_REL_SPREAD)` | `0.35` | ~407 |
| 6 | `(c.openInterest >= IV30_MIN_OPEN_INTEREST \|\| c.volume >= IV30_MIN_VOLUME)` | OI ≥ **10** OR volume ≥ **1** | ~408 |

Constants are file-level in `dailySnapshot.ts` near the top of the module (lines **36–41** in the audited revision):

```typescript
// dailySnapshot.ts — IV30 constants (excerpt)
const IV30_MIN_DTE = 20;
const IV30_MAX_DTE = 40;
const IV30_ATM_MONEYNESS = 0.05;
const IV30_MIN_OPEN_INTEREST = 10;
const IV30_MIN_VOLUME = 1;
const IV30_MAX_REL_SPREAD = 0.35;
```

### Post-filter

| Step | Code | Effect |
|------|------|--------|
| Sort | `abs(dte - 30) + moneyness * 100` | Prefers ~30 DTE and tighter ATM |
| Median IV | Top 6 candidates → `medianOf` | Needs ≥1 candidate |

### Rationale vs “arbitrary”

- **DTE 20–40, ATM 5%, spread cap, OI/volume floor:** Introduced / tightened under **`8f8e2a65` — “Harden IV30 selection for strategist IVR”** (per `git log` on `dailySnapshot.ts`). That commit message frames the change as **hardening** IVR inputs, not a documented exchange standard.
- **OI ≥ 10 OR volume ≥ 1:** A **liquidity screen**; threshold values are **order-of-magnitude heuristics** (not derived from an exchange spec in-repo).
- **Spread ≤ 35% of mid:** Standard **quality** guard against illiquid quotes; width is a **policy choice**.
- **DTE window excluding 45-calendar-day tenors while Schwab chain often surfaces 11d and 45d slices:** **Not documented** in code as intentional; it interacts with **Schwab’s returned expiration ladder** (see §5). That mismatch is the dominant operational issue for these 17 names.

---

## Section 5 — Pattern analysis (all 17)

**Single failure mode:** **`c.dte >= 20 && c.dte <= 40` is false for every `options_chain_daily` row** (and equivalently for `options_flow_per_strike`) on `2026-05-04` for all 17 symbols.

Evidence: distinct `dte` values present in `options_chain_daily` for each symbol **never intersect** `[20, 40]`. Typical ladder for this session: **`{11, 45, …}`** plus longer tenors (74, 109, 137, …) — **11 and 45 bracket the window but do not enter it**.

Therefore:

- **`selectIv30d` does not “fail” on OI, spread, or moneyness first** — the candidate list is **empty after the DTE predicate**, so the function returns **`null`** at **`if (candidates.length === 0) return null;`** (~line **416**).

Secondary note: **Flow IV** uses the **same `selectIv30d`** on `options_flow_per_strike` rows (`computeIVFromFlow` → `selectIv30d(sym, spot, ivStrikes)`), so **the same DTE gap** applies. Flow rows **do** carry `implied_volatility` for many contracts (see per-ticker `flow_iv_rows` in §1), but **IV never reaches** `equity_daily.iv_30d` because **`selectIv30d` returns null**.

---

## Section 3 — Why no flow IV fallback (code path)

1. **`collectPolygonFlowFromAPI`** (`dailySnapshot.ts`) writes `options_flow_per_strike` from Polygon snapshot results (`parsePolygonSnapshotResultToFlowRow`). **Implied vol** is stored when Polygon returns it (`normalizeIV` on `r["implied_volatility"]`).

2. **`computeIVFromFlow`** loads per-strike rows for `(underlying, date)` and calls **`selectIv30d(sym, spot, ivStrikes)`** — **same filter** as chain.

3. If **`selectIv30d` returns `null`**, **`computeIVFromFlow` does not write `iv30d`** (it only adds `iv30d` / `ivrSource: "flow"` when `iv30d != null`). **IVR** is then computed with `iv30d ?? existing row` in current code; if chain also wrote no IV, **`ivr` stays null**.

**Was there flow data?** Yes — hundreds of `options_flow_per_strike` rows per symbol; **many rows have non-null `implied_volatility`** (see §1 table `flow_iv_rows`).

**Was flow IV “rejected by another filter”?** **No separate post-`selectIv30d` filter** for flow IV. Rejection is **inside `selectIv30d`** (DTE window first).

---

## Sections 1, 2, 4 — Ticker-by-ticker (17 rows)

**Legend (§1 metrics):** All counts are for **`options_chain_daily`** on **`2026-05-04`**.

| Symbol | Chain rows | Distinct expiries (≈) | Distinct strikes (≈) | Distinct `dte` values (from DB) | Rows with `20 ≤ dte ≤ 40` | Flow rows (same date) | Flow rows with IV |
|--------|------------|----------------------|----------------------|-----------------------------------|----------------------------|------------------------|---------------------|
| BK | 450 | 7 | 44 | 11,45,137,228,256,319,627 | **0** | 450 | 400 |
| BKR | 344 | 9 | 31 | 11,45,74,137,165,228,256,319,627 | **0** | 344 | 336 |
| CFG | 364 | 8 | 30 | 11,45,74,165,200,256,627,956 | **0** | 364 | 329 |
| ELV | 776 | 8 | 68 | 11,45,74,137,228,256,319,627 | **0** | 776 | 754 |
| FANG | 614 | 9 | 39 | 11,45,74,137,228,256,319,409,627 | **0** | 614 | 536 |
| HUBS | 824 | 6 | 96 | 11,45,137,228,256,627 | **0** | 824 | 790 |
| KLAC | 2196 | 8 | 200 | 11,45,137,228,256,319,409,627 | **0** | 2196 | 2157 |
| MPC | 790 | 10 | 46 | 11,45,74,137,165,228,256,319,409,627 | **0** | 790 | 717 |
| NOC | 1466 | 9 | 155 | 11,45,109,137,200,228,256,319,627 | **0** | 1466 | 1386 |
| NSC | 692 | 9 | 46 | 11,45,74,137,228,256,319,409,627 | **0** | 692 | 616 |
| NXPI | 800 | 9 | 48 | 11,45,74,137,165,228,256,319,627 | **0** | 800 | 792 |
| PCAR | 824 | 9 | 80 | 11,45,109,137,200,228,256,319,627 | **0** | 824 | 799 |
| RF | 336 | 9 | 29 | 11,45,109,137,200,228,256,319,627 | **0** | 336 | 314 |
| SYK | 508 | 7 | 42 | 11,45,74,137,228,256,319 | **0** | 508 | 426 |
| TDG | 1146 | 6 | 161 | 11,45,109,137,200,228 | **0** | 1146 | 859 |
| TFC | 364 | 9 | 23 | 11,45,137,228,256,319,409,627,956 | **0** | 364 | 353 |
| TRGP | 512 | 7 | 42 | 11,45,74,137,165,228,319 | **0** | 512 | 476 |

### §2 — Exact failing condition (same for all 17)

Inside `selectIv30d`, after mapping, **every row** fails this compound gate because **`dte` is never in `[20, 40]`**:

- **Line ~404:** `c.dte >= IV30_MIN_DTE` → **false** for `dte ∈ {11, 45, 74, …}` when `IV30_MIN_DTE = 20`.
- Equivalently **line ~405:** `c.dte <= IV30_MAX_DTE` fails for long-dated LEAPS (`dte > 40`).

So **`.filter(...)` yields `candidates.length === 0`**, then:

- **Line ~416:** `if (candidates.length === 0) return null;`

**`selectIv30d` therefore did not reach** OI/spread/moneyness rejection for these names — there were **zero rows** that simultaneously satisfied DTE + IV normalization + ATM + spread + OI/volume.

### §1b — “Near 30-day expiry” strikes (practical lens: **11d and 45d** only)

Because the chain has **no 20–40d slice**, the only tenors **close to 30d** in the stored ladder are **`dte = 11`** and **`dte = 45`**. The table below restricts to **`dte IN (11, 45)`** and **`moneyness ≤ 5%`** (same ATM rule as `selectIv30d`), aggregated **per symbol** (both calls/puts combined):

| Symbol | Rows (11 & 45, ±5% moneyness) | Max OI (among those rows) | Max volume | Min rel spread (non-null) | Max rel spread | Rows with relSpread ≤ 0.35 (or null) |
|--------|-------------------------------|----------------------------|-------------|-----------------------------|----------------|----------------------------------------|
| BK | 12 | 8096 | 6 | 0.045 | 1.000 | 8 |
| BKR | 4 | 6104 | 1454 | 0.025 | 0.097 | 4 |
| CFG | 12 | 1705 | 16 | 0.298 | 1.273 | 2 |
| ELV | 16 | 576 | 19 | 0.063 | 0.667 | 14 |
| FANG | 8 | 2029 | 226 | 0.097 | 0.226 | 8 |
| HUBS | 12 | 1134 | 9 | 0.070 | 0.321 | 12 |
| KLAC | 36 | 388 | 165 | 0.045 | 0.179 | 36 |
| MPC | 8 | 4270 | 176 | 0.020 | 0.208 | 8 |
| NOC | 48 | 203 | 77 | 0.040 | 1.394 | 45 |
| NSC | 12 | 718 | 1 | 0.139 | 1.755 | 8 |
| NXPI | 12 | 2013 | 98 | 0.026 | 0.306 | 12 |
| PCAR | 16 | 868 | 10 | 0.149 | 1.455 | 4 |
| RF | 12 | 5339 | 11 | 0.049 | 0.720 | 7 |
| SYK | 12 | 547 | 20 | 0.065 | 0.361 | 11 |
| TDG | 48 | 319 | 1 | 0.073 | 0.419 | 46 |
| TFC | 8 | 9242 | 69 | 0.051 | 0.400 | 7 |
| TRGP | 8 | 1552 | 177 | 0.024 | 0.292 | 8 |

**Reading this alongside §2:** For example **KLAC** has **36** ATM rows at 11d/45d with **max OI 388**, **tight spreads**, and **all 36 rows pass `normalizeIV`** — yet **`selectIv30d` still returns null** solely because **`dte` is 11 or 45**, not `[20, 40]`.

### §4 — Minimum loosening that would recover IV (per ticker)

**Uniform fix:** expand the DTE window to **include 45** (and optionally **11**), e.g. **`[15, 50]`** or **`[11, 45]`**.

| Symbol | If window expanded to **11–45** (hypothetical) | If only **extend max to 45** (20–45) |
|--------|-----------------------------------------------|--------------------------------------|
| BK | Would include **11d & 45d** ATM rows; **likely** IV30 from median of up to 6 passes (watch **spread** on 11d — max spread hit **1.0** on some rows). | **Still excludes 11d**; **45d alone** often yields **≤6** ATM candidates → IV computable for most. |
| BKR | **High confidence** — all 4 ATM rows at 11/45 pass spread + OI/vol + IV. | **45d-only** subset still likely sufficient. |
| CFG | **45d** side has **6/6** spread-ok rows; **11d** has wider spreads — widening window helps but **spread gate** still removes some 11d rows. | **20–45** likely enough (45d slice strong). |
| ELV | **45d** dominates (14/16 spread-ok); **11d** has wider tails. | **20–45** likely enough. |
| FANG | Clean on both tenors. | **20–45** enough. |
| HUBS | All 12 rows spread-ok. | **20–45** enough. |
| KLAC | **36** clean ATM rows — **exemplar** case for “large cap excluded by DTE window only”. | **20–45** enough. |
| MPC | Clean. | **20–45** enough. |
| NOC | **45d** has **45/48** spread-ok; **11d** has **wider** spreads (max **1.39**). | **20–45** recovers most IV signal without the worst 11d quotes. |
| NSC | **Spread** pain on some rows (max **1.76**); **45d** still has **8/12** spread-ok. | **20–45** + optional **spread** tweak if needed. |
| NXPI | Clean. | **20–45** enough. |
| PCAR | **Spread** stress (max **1.45**); only **4/16** spread-ok — may need **spread loosening** *in addition* to DTE if including **11d**. | **45d-only** likely cleaner. |
| RF | Mixed spreads; **7/12** spread-ok overall. | **20–45** likely recovers median IV from cleaner 45d slice. |
| SYK | **11/12** spread-ok — easy. | **20–45** enough. |
| TDG | **46/48** spread-ok — easy. | **20–45** enough. |
| TFC | **7/8** spread-ok — easy. | **20–45** enough. |
| TRGP | **8/8** spread-ok — easy. | **20–45** enough. |

**Defensible “minimal” policy change (recommended framing):**

1. **Change DTE window to `[20, 45]`** (inclusive) — captures Schwab’s common **45-calendar-day** slice while still excluding **11d** weekly “noise” for IV30. Recovers **all 17** here without admitting **11d** microstructure.

2. **Optional second step** (only if you also want **11d** information): **`[15, 45]`** — use only if product accepts **shorter-dated** IV for “IV30” labeling; rename or document that label to avoid implying 30-calendar-day horizon.

**What not to do first:** blindly lowering **OI from 10 → 1** — for these 17, **OI is not the primary gate**; it would **not fix** the empty candidate set while **adding** noise for genuinely thin names.

---

## Section 7 — Defensible loosening summary (recover “real” names without junk)

| Lever | Current | Proposed | Rationale |
|-------|---------|----------|-----------|
| **DTE window** | `[20, 40]` | **`[20, 45]`** (or `[18, 45]` if you want small buffer) | Matches **observed Schwab/Polygon ladders** (11 & 45 are standard; **45 is liquid**). **40 cuts out** a common monthly tenor. |
| **ATM moneyness** | 5% | **Keep 5%** | Already reasonable; not the failure mode here. |
| **Rel spread** | 0.35 | **Keep 0.35** initially | Prevents obviously broken quotes; several names still pass with 0.35 cap at 45d. |
| **OI / volume** | OI ≥ 10 OR vol ≥ 1 | **Keep** unless you see IV outliers after DTE fix | Not the gating issue for these 17. |

---

## Bottom line

**`selectIv30d` returned `null` for all 17 tickers because the Schwab-sourced chain (and Polygon flow mirror) contained **no contracts with `dte` between 20 and 40** on `2026-05-04`, while many names had **rich, liquid 45d ATM chains** that were excluded solely by `IV30_MAX_DTE = 40`.**

This is **not** “these names have no options market”; it is a **calendar-tenor mismatch** between **data availability** and **filter constants**. The fix is primarily **policy / windowing**, not indiscriminate OI cuts.

---

## Query appendix (reproducible)

Distinct DTEs per symbol on `2026-05-04`:

```sql
SELECT underlying_symbol,
       array_agg(DISTINCT dte ORDER BY dte) AS dtes,
       count(*) FILTER (WHERE dte BETWEEN 20 AND 40) AS in_iv30_window
FROM options_chain_daily
WHERE date = '2026-05-04'
  AND underlying_symbol IN (/* 17 symbols */)
GROUP BY underlying_symbol;
```

ATM ±5% stats at `dte IN (11,45)` use `equity_daily.close` as spot for `2026-05-04` (same as snapshot `selectIv30d`).
