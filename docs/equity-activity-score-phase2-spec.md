# Phase 2 — Scanner sub-score spec: `equity_activity_score`

**Status:** Specification only (no implementation in this PR). **Data sources:** Schwab + IBKR + `equity_daily` (no Polygon **stocks** subscription required). Polygon options chain for spot may remain optional; **Schwab quote/REST** should supply spot, volume, and VWAP once Phase 1 fields are confirmed.

---

## 1. Purpose

Add an **`equity_activity_score`** (0–100) with a **`equity_activity_direction`** flag (`bullish` | `bearish` | `neutral`) to:

1. **Scanner v2** composite — reserve **10%** of existing component weights for later tuning (exact re-weight TBD after validation). Current v1 composite mix in code is `term * 0.3 + ivRv * 0.25 + flow * 0.2 + edge * 0.15 + skew * 0.05 + macro * 0.05` (`scannerScoringV2.scannerCompositeV1`); product should decide whether the 10% comes proportionally from each bucket or from a single donor (e.g. flow).
2. **Strategist context** — same flag helps **confirm or disambiguate** options-flow direction without naming vendors in user-facing copy.

---

## 2. Inputs (by source)

| Input | Source | Notes |
|-------|--------|--------|
| `cum_volume` | Schwab **REST** `totalVolume` and/or **WS** field 8 | Session cumulative; align with RTH vs full session in spec for scoring window. |
| `adv20` | `equity_daily.median_volume_20d` (preferred) or computed mean | Matches “20-day ADV” intent; document if median vs mean. |
| `spot` | Schwab last / mid; fallback `equity_daily.close` | Worker already falls back if chain spot missing. |
| `vwap` | Schwab REST (and optionally WS) once field confirmed | **Blocked until Phase 1 JSON verification.** |
| `quote_ts` | Cache `ts` or REST `asOf` if available | Staleness gate (e.g. skip if > 60s old for intraday signal). |

**IBKR:** Optional enhancement for **spot/BBO** via Cboe One merge — **not required** if Schwab path validated. Do **not** rely on 130 dedicated IB `reqMktData` lines without entitlement proof (Phase 1).

---

## 3. Sub-components

### 3.1 RVOL score (`S_rvol`, 0–100)

Let `rvol = cum_volume / max(adv20, 1)`.

| RVOL range | Label | `S_rvol` |
|------------|-------|----------|
| 1.0 – 1.5 | Normal | **0** |
| 1.5 – 2.0 | Elevated | **30** |
| 2.0 – 3.0 | Significant | **60** |
| ≥ 3.0 | Exceptional | **100** |

**Edge rules:**

- Below **1.0×:** `S_rvol = 0` (no “negative” RVOL score).
- **Boundary:** Use half-open intervals consistently, e.g. `[1.5, 2.0)` → 30, `[2.0, 3.0)` → 60, `≥3` → 100.
- **Missing `adv20`:** Emit `quality_flags` / null component; do not fake RVOL.

### 3.2 VWAP conviction score (`S_vwap`, 0–100) + direction

Define `d_pct = (spot - vwap) / vwap * 100` (null if either missing).

**Volume confirmation weight** `w_vol` — maps how much session volume has “confirmed” the move vs ADV:

- Let `f = clamp(cum_volume / (2 * adv20), 0, 1)` — at **2× ADV** cumulative, `f → 1` (tunable).
- `w_vol = 0.35 + 0.65 * f` so low-time-of-day volume does not max out conviction.

**Base magnitude** `m = clamp(|d_pct| / 0.5, 0, 1)` — **0.5%** away from VWAP saturates magnitude (tunable after backtest).

**Raw conviction** `c_raw = m * w_vol` → scale to 0–100: `S_vwap = round(100 * c_raw)`.

**Direction flag logic:**

- If `rvol < 1.5` **or** `S_vwap < 30`: treat as **low conviction** — set `S_vwap` to **0–30** band (e.g. `min(S_vwap, 30)`), direction **`neutral`** unless RVOL alone is high (see composite).
- If `rvol ≥ 1.5` and `spot > vwap`: **bullish** conviction; `S_vwap` in **70–100** = `clamp(55 + 45 * c_raw, 70, 100)` (monotonic, avoids double-counting with RVOL).
- If `rvol ≥ 1.5` and `spot < vwap`: **bearish** conviction; same score magnitude with **`bearish`** direction.

**Strategist use:** Pass **`equity_activity_direction`** + `d_pct` + `rvol` so the model can reconcile with flow without implying vendor names.

---

## 4. Composite `equity_activity_score` (0–100)

Single scalar for scanner sorting:

**Option A (recommended v0):** Weighted blend  
`equity_activity_score = round(0.55 * S_rvol + 0.45 * S_vwap_dir)`  

where `S_vwap_dir` is `S_vwap` for directional cases, or down-weighted neutral per §3.2.

**Option B (strict max):** `max(S_rvol, S_vwap)` — simple but loses joint signal.

**Neutral composite:** If **either** input missing → null score + telemetry; if RVOL low and VWAP neutral → **low overall** (e.g. `< 35`).

**Direction output:** `equity_activity_direction`:

- `bullish` if `rvol ≥ 1.5` and `spot > vwap` and `S_vwap ≥ 70`
- `bearish` if `rvol ≥ 1.5` and `spot < vwap` and `S_vwap ≥ 70`
- else `neutral`

(Adjust thresholds to match backtest; keep **aligned with product copy** in Phase 2 bullets.)

---

## 5. Integration points (implementation later)

| Surface | Change |
|---------|--------|
| `ticker_signal_snapshot` / scanner row builder | Persist `equity_activity_score`, `equity_activity_direction`, optional `equity_activity_debug` JSONB (rvol, d_pct, cum_volume, adv20, vwap_source). |
| `scannerScoringV2` | Add component; **reserve 10%** from existing weights (TBD). |
| `snapshotRefreshWorker` | After DB reads, attach Schwab REST batch (or WS cache) for LC130; **30s** cadence friendly. |
| Strategist payload | Include direction + key numerics in structured context. |

---

## 6. Non-goals (this phase)

- No Polygon **stock** aggregates for RVOL/VWAP.
- No new IB **130-line** requirement unless Account Management proves capacity.
- No change to options flow scoring logic beyond consuming the new flag as **context**.

---

## 7. Open parameters (tune in validation)

- VWAP field choice and **RTH vs full session** alignment.
- `adv20` median vs mean.
- VWAP distance saturation (**0.5%** default) and volume confirmation curve.
- Composite **0.55 / 0.45** split vs learned weights.
