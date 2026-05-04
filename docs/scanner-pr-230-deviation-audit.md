# PR #230 — Spec deviation audit (read-only)

This document explains **three intentional deviations** between the **Unified Scanner Rebuild V1** specification and what **PR #230** shipped. It is written for reviewers: what was substituted, why, what triggers it, how it compares to the spec, and a recommendation.

**Scope:** No implementation changes in this audit—analysis and citations only.

---

## Deviation 1 — Regime shock gate (`regime_shock` disqualifier)

### What the spec said

- Snapshot rows should carry **`regime_shock_active`** (boolean) derived from **“regime state (read from market pulse cached state)”**.
- Hard gate: when true → disqual flag **`regime_shock`** (and composite score forced to 0 in the scoring pipeline).

The spec’s mental model aligns with the **existing HTTP scanner shock block**: `evaluateRegimeShock(extractMarketIndicators(readFromWebSocketCache()))` → **`shockActive`** blocks scans when the shock state machine is **`ACTIVE`**.

### What was shipped

In `snapshotRefreshWorker.ts`, the worker sets:

```typescript
const regime = getCachedRegime();
const regimeShockActive = regime?.systemicRiskLevel === "EXTREME";
// ...
if (regimeShockActive) disqual.push("regime_shock");
```

So **`regime_shock`** is attached when the **structured regime cache** says **`systemicRiskLevel === "EXTREME"`**, not when **`evaluateRegimeShock`** reports active shock.

---

### 1. Enum values for `systemicRiskLevel`

**Defined in** `src/lib/regimePostProcessor.ts`:

```typescript
// Lines 16-17 — src/lib/regimePostProcessor.ts
export type SystemicRiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "EXTREME";
```

There is **no** `HIGH` level in this enum (only four levels).

---

### 2. How each `systemicRiskLevel` is assigned (source, inputs, thresholds)

**Function:** `deriveSystemicRiskLevel(pulse: EngineOutput)` in `regimePostProcessor.ts`.

**Inputs:** Cluster scores from the **Market Pulse engine output** (`EngineOutput`):

- `pulse.clusters.volLevel?.score` → `vol`
- `pulse.clusters.volTerm?.score` → `volTerm`
- `pulse.clusters.credit?.score` → `credit`

**Formula:**

```typescript
// Lines 58-68 — src/lib/regimePostProcessor.ts
export function deriveSystemicRiskLevel(pulse: EngineOutput): SystemicRiskLevel {
  const vol = pulse.clusters.volLevel?.score ?? 0;
  const volTerm = pulse.clusters.volTerm?.score ?? 0;
  const credit = pulse.clusters.credit?.score ?? 0;

  const riskScore = ((-vol) * 0.40 + (-volTerm) * 0.30 + (-credit) * 0.30);

  if (riskScore >= 1.5) return "EXTREME";
  if (riskScore >= 0.8) return "ELEVATED";
  if (riskScore >= 0.3) return "MODERATE";
  return "LOW";
}
```

**Interpretation:**

| Level      | Condition on `riskScore` |
|-----------|---------------------------|
| `EXTREME` | `riskScore >= 1.5`      |
| `ELEVATED`| `riskScore >= 0.8`      |
| `MODERATE`| `riskScore >= 0.3`      |
| `LOW`     | else                      |

**Where `pulse` comes from:** `updateRegimeFromPulse(pulse)` (same file) is called when Market Pulse completes; it writes `cachedRegime` including `systemicRiskLevel` and `updatedAt`. **`getCachedRegime()`** returns that in-memory snapshot (or `null` before first pulse).

**Important:** This path is **not** reading raw Schwab WS quotes directly in the worker—it reads the **post-processed pulse clusters** that already fed the regime object.

---

### 3. What `EXTREME` specifically requires

`EXTREME` is **composite**, not a single hard rule like “VIX > N”.

It requires the **weighted sum**  
`riskScore = (-vol)*0.40 + (-volTerm)*0.30 + (-credit)*0.30`  
to be **≥ 1.5**.

So it fires when **vol level, vol term structure, and credit clusters** are simultaneously “bad enough” in the negative direction (higher cluster stress → more negative `-cluster` contribution → higher `riskScore`). It is **not** tied to the discrete `VIX_SPIKE` / `ES_CRASH` triggers of `regimeShockDetector.ts` unless those happen to move the pulse cluster scores in a way that crosses 1.5.

---

### 4. Production frequency: `systemicRiskLevel === "EXTREME"` (last 90 days)

**Data source used:** `strategist_telemetry.regime` (JSONB), which stores the structured regime blob (includes `systemicRiskLevel`).

**Environment:** Queries were run against the database reachable as `DATABASE_URL` in the audit environment (treat as **the connected deployment’s data**; other environments may differ).

**Queries:**

```sql
-- Rows in window
SELECT COUNT(*) AS rows_90d
FROM strategist_telemetry
WHERE timestamp >= NOW() - INTERVAL '90 days';
-- Result (audit run): 295

-- Distribution of systemicRiskLevel
SELECT regime->>'systemicRiskLevel' AS lvl, COUNT(*)
FROM strategist_telemetry
WHERE timestamp >= NOW() - INTERVAL '90 days'
  AND regime IS NOT NULL
GROUP BY 1
ORDER BY 2 DESC;
-- Results: MODERATE 201, LOW 86, ELEVATED 8, (no EXTREME row in this breakdown)

-- Explicit EXTREME count
SELECT COUNT(*) AS extreme_count
FROM strategist_telemetry
WHERE timestamp >= NOW() - INTERVAL '90 days'
  AND (regime->>'systemicRiskLevel') = 'EXTREME';
-- Result: 0
```

**Conclusion for this dataset:** In the last **90 days**, **`EXTREME` did not appear once** in `strategist_telemetry.regime` for the sampled DB. That implies the shipped gate **`systemicRiskLevel === "EXTREME"`** would **almost never** add `regime_shock` in practice—**stricter / rarer** than a shock detector that can go `ACTIVE` on three distinct trigger families within 30 minutes.

---

### 5. `evaluateRegimeShock` (WS-derived) — definition and contrast

**Location:** `src/lib/regimeShockDetector.ts`  
**Exported function:** `evaluateRegimeShock(data: MarketIndicators): ShockDetectorOutput`

**Inputs:** `MarketIndicators` — the same abstract indicator bundle used by Market Pulse / `extractMarketIndicators` in `routes/ai.ts` (built from **Schwab + IB caches**, PC ratios, synthetic DXY, etc.). It is **not** the pulse `EngineOutput`; it is **line-level market indicators**.

**Triggers (events pushed into a 30-minute rolling window):**

| Trigger             | Condition (simplified) |
|---------------------|-------------------------|
| `VIX_SPIKE`         | `abs((vixChange/prevVix)*100) >= 20` |
| `ES_CRASH`          | `abs(esChange) >= 2.0` (note: threshold param in `fireTrigger` is `-2.0` but the check is on magnitude) |
| `CREDIT_SPREAD_BLOW`| HY–IE spread z-score vs 20-day rolling; z < `-sigma` (sigma 2.0 early bootstrap, 1.5 after enough samples) |
| `BREADTH_FLIP`      | ADD and ADDQ both flip sign with large magnitude (500 / 300) |

**State machine:** `NORMAL` → `WARNING` (≥2 **distinct** trigger types in window) → `ACTIVE` (≥3 distinct types). **`shockActive`** is `currentState === "ACTIVE"` (not `WARNING`).

```typescript
// Lines 244-251 — src/lib/regimeShockDetector.ts
  return {
    shockState: currentState,
    activeTriggers: [...triggerHistory],
    shockActivatedAt,
    shockActive: currentState === "ACTIVE",
    previousState,
    transitionedAt: transitioned ? now : lastTransitionAt,
  };
```

**Same inputs?**  
**Partially.** Both ultimately depend on **live market data**, but:

- **`deriveSystemicRiskLevel`** consumes **pulse cluster scores** (processed engine output).
- **`evaluateRegimeShock`** consumes **raw indicator fields** (VIX level/change, ES change, HYG/IEF, ADD/ADDQ) and its **own** rolling memory (`triggerHistory`, credit spread buffer, previous ADD).

**Can they disagree?**  
**Yes.**

- Shock can go **`ACTIVE`** with **three different trigger types** even if pulse cluster scores never push `riskScore` to 1.5 → **`systemicRiskLevel`** might stay `ELEVATED` or `MODERATE`.
- Conversely, **`EXTREME`** could theoretically be reached from sustained poor cluster scores **without** ever hitting three shock trigger types in 30 minutes (so **`shockActive`** false while `EXTREME` true)—less likely given telemetry showed **zero** `EXTREME` in 90d, but the architectures differ.

**Which is more conservative (more often blocks / flags risk)?**  
For **scanner disqualification**, “conservative” usually means **more often excluding names**.

- **`shockActive`** (ACTIVE only) can fire on **short-lived dislocations** meeting trigger rules—it is **orthogonal** to pulse cluster math.
- **`EXTREME`** in telemetry **did not fire at all** in 90d on the audited DB → for practical purposes it is **much less likely** to disqualify than **`shockActive`**.

So relative to the **spec’s intent** (“pause scanning during shock”), **`EXTREME` is not conservative enough**—it is **almost always inactive** compared to shock ACTIVE.

---

### 6. Recommendation (regime gate)

**Prefer aligning the snapshot worker with the same signal the API already uses for user-facing “scan blocked” semantics:**

1. **Primary:** Use **`evaluateRegimeShock(extractMarketIndicators(readFromWebSocketCache()))`** (or a small shared helper that returns `shockActive`) and map **`shockActive === true`** → `regime_shock_active` + disqual **`regime_shock`**. This matches the spec’s “regime shock” language and the legacy scan routes’ behavior.

2. **If you want a second layer:** Keep **`systemicRiskLevel`** as **informational** (e.g., store in JSON or soft penalty) but **do not** rely on `EXTREME` alone for hard gate unless product explicitly wants “only the worst sustained stress” to block.

**Reason:** Telemetry shows **`EXTREME` is rare-to-nonexistent** in production samples, while **`shockActive`** is the user-visible “regime shock” contract elsewhere in the app.

---

## Deviation 2 — Flow notional proxy vs dollar thresholds

### What the spec said

- **`flow_summary`** should include **`ask_notional`, `bid_notional`, `mid_notional`, `ask_pct`, …`** from **`options_flow_per_strike`** rollup (and related flow context).
- **`flow_alignment_score`** gates on **ask-side dollar notional** vs **tier thresholds**: mega **100k**, large **50k**, mid **25k**, small **10k**.
- Tape quality gates: **`not_run` / `degraded`** → score 0.

### What was shipped

`getPolygonFlowHighlights` is used (DB rollup + session tape). For notionals, the worker **does not** sum `options_flow_per_strike` dollars by aggressor. It derives:

```typescript
// Lines 378-389 — src/lib/snapshotRefreshWorker.ts
  const tape = flowHl?.sessionTape;
  const totals = tape?.aggressorSessionTotals;
  const printTotal = totals?.totalPrints ?? 0;
  let askNotional = 0;
  let bidNotional = 0;
  let midNotional = 0;
  if (printTotal > 0 && totals) {
    const scale = (flowHl?.totalCallVolume ?? 0) + (flowHl?.totalPutVolume ?? 0) || 1;
    const unit = (spot && spot > 0 ? spot * 0.02 : 1000) * (scale / Math.max(printTotal, 1));
    askNotional = totals.askCount * unit;
    bidNotional = totals.bidCount * unit;
    midNotional = totals.midCount * unit + totals.unknownCount * unit * 0.5;
  }
```

So **`ask_notional` in `flow_summary` is not USD from trades**; it is **`askCount * unit`**, where `unit` scales with **(total option volume) / (classified print count)** and **spot**.

Tier thresholds from spec (**100k / 50k / 25k / 10k**) are still applied in code as **numeric comparisons** against these **proxy** values—so the gate is **dimensionally consistent** with “bigger number = more flow” but **not** “USD notional from rollup.”

---

### 1. `options_flow_per_strike` — columns (schema)

From `lib/db/src/schema/index.ts` (`optionsFlowPerStrikeTable` → table `options_flow_per_strike`):

| Column (SQL)           | Type (Drizzle) | Role |
|------------------------|----------------|------|
| `id`                   | serial PK      | Row id |
| `underlying_symbol`    | text           | Underlying ticker |
| `date`                 | date           | Session / rollup date |
| `option_type`          | text           | call / put |
| `strike`               | real           | Strike |
| `expiration`           | date           | Expiry |
| `dte`                  | integer        | Days to expiry |
| `daily_volume`         | integer        | Volume |
| `open_interest`        | integer        | OI |
| `bid`, `ask`, `mid`    | real           | Prices |
| `implied_volatility`   | real           | IV |
| `delta` … `vega`      | real           | Greeks |
| `avg_trade_price`      | real           | VWAP-ish |
| `created_at`           | timestamp      | Ingest time |

**Not present:** per-row **`ask_notional` / `bid_notional` / `mid_notional`**, aggressor-side classification, sweep/block tags, or trade counts **at this grain**. Those live primarily on **`options_flow_raw_trades`** (`notional`, `side`, `is_block`, `is_sweep`, …) and **`options_flow_exec_per_strike`** (aggregated execution notionals).

---

### 2. Why dollar notional was not taken directly from `options_flow_per_strike`

1. **The rollup is strike-day aggregates** (volume, OI, NBBO, IV)—**not** a decomposition of **aggressor-side dollar flow**. You cannot read “$X ask-side on this strike today” from those columns alone.
2. **Aggressor and block semantics** require **tape / prints** (`options_flow_raw_trades` or the session tape structures built in `polygonFlowHighlights.ts`), or **`options_flow_exec_per_strike`** (sweep/block/regular notionals).
3. **PR #230** chose a **fast path** already used elsewhere: **`getPolygonFlowHighlights`** returns **`sessionTape.aggressorSessionTotals`** (counts) plus strike rollups—**no new SQL aggregation** and no heavy per-ticker scan of raw trades in the 30s worker loop.

So the gap is both **schema** (per-strike table lacks side-notional) and **semantics** (spec asked for rollup-based dollars; implementation used tape-count proxy).

---

### 3. “Session tape print counts” — exact formula

Let:

- `A` = `totals.askCount`
- `B` = `totals.bidCount`
- `M` = `totals.midCount`
- `U` = `totals.unknownCount`
- `P` = `totals.totalPrints` (must be > 0)
- `V` = `totalCallVolume + totalPutVolume` from highlights (or 1 if zero)
- `S` = spot (or fallback branch uses `1000` in the `unit` expression when spot missing)

Then:

```
unit = (S > 0 ? S * 0.02 : 1000) * (V / max(P, 1))
ask_notional_proxy = A * unit
bid_notional_proxy = B * unit
mid_notional_proxy = M * unit + U * unit * 0.5
ask_pct = 100 * ask_notional_proxy / (ask + bid + mid)_proxy
```

**Mapping to tier thresholds:** The **same numeric thresholds** (100k, 50k, 25k, 10k) are compared to **`ask_notional_proxy`**, not to real USD. So a “mid cap needs 25k” gate is really “needs **25k units of this synthetic scale**.”

---

### 4. Concrete example A — one $5M ask block + 200 small ~$200 prints

**Spec intent (dollar gate):** Ask-side notional **dominated by the block** → likely **≥ $5M** on ask → **passes** mid-tier **$25k** threshold easily; **`ask_pct`** should be very high.

**Shipped proxy (order of magnitude):** Depends on how the tape classifier attributes the block vs retail prints:

- If the **block counts as a small number of ask-classified prints** (`A` small) but **`totalPrints` is large** (200+ prints), then **`unit` shrinks** because `V/P` is small when `P` is inflated by many tiny prints.
- **`ask_notional_proxy = A * unit`** can be **far below** $5M even when economic ask flow was huge.

**Net:** Proxy **can under-score** concentrated block flow when print count is high—**opposite** of the spec’s dollar gate.

---

### 5. Concrete example B — no blocks, 500 small ask prints, **$40k** total ask notional (spec dollars)

**Spec gate:** **$40k > $25k** mid threshold → **passes** threshold; flow score then depends on `ask_share` and clamp multiplier.

**Shipped proxy:** If those prints are classified mostly as ask (`A` high) but **`unit`** is tuned by `V/P`, the product `A * unit` **might** land in a similar ballpark—or not—**but it is not guaranteed to equal $40k** or preserve rank ordering vs other tickers.

**Net:** Proxy **may align sometimes**, but it is **not calibrated** to match USD; it is **count × heuristic scale**.

---

### 6. What it would take to ship real `ask_notional` / `bid_notional` / `mid_notional`

**Options:**

| Approach | Schema | App logic | Effort (relative) |
|----------|--------|-----------|---------------------|
| **A. Aggregate raw trades** per underlying/session from `options_flow_raw_trades` (`side`, `notional`) | Optional materialized columns or a new rollup table | SQL or TS batch in worker | **Medium–high** (volume at LC130 × frequency) |
| **B. Use `options_flow_exec_per_strike`** (`sweep_notional`, `block_notional`, `regular_notional`) + classify aggressor mix | Possibly extend rollup if “ask” notional not stored | Join + sum in worker | **Medium** |
| **C. Extend `polygonFlowHighlights` / tape** to expose **USD totals** alongside counts | Prefer none if computed in-memory | Change highlight builder once | **Medium** |

**Recommendation:** **Extend rollup or highlights to expose true USD ask/bid/mid notionals** (or reuse exec-per-strike) and **delete the proxy** for gating. Keep proxy only as a **temporary** measure if perf blocks immediate SQL work.

---

## Deviation 3 — `disqual_flags` partial index (`cardinality` vs null vs empty)

### What the spec implied

Filter candidates where **`disqual_flags` is null or empty** (no active disqualifiers).

### What was shipped (migration SQL)

```typescript
// Lines 40-41 — lib/db/drizzle/0014_ticker_signal_snapshot.sql
CREATE INDEX IF NOT EXISTS idx_tss_composite ON ticker_signal_snapshot (composite_score DESC)
  WHERE (disqual_flags IS NULL OR cardinality(disqual_flags) = 0);
```

The **runtime query** in `scannerV2.ts` uses a similar predicate (`NULL` **or** `cardinality(...) = 0`).

---

### 1. Postgres semantics: `cardinality` vs `array_length` vs `IS NULL`

**Column is `TEXT[]`.**

| Expression | `NULL` column | `{}` empty array | `{x}` |
|------------|---------------|------------------|-------|
| `disqual_flags IS NULL` | true | false | false |
| `cardinality(disqual_flags)` | **NULL** | **0** | 1+ |
| `cardinality(disqual_flags) = 0` | **UNKNOWN** (filters as false in `WHERE` unless `OR IS NULL`) | true | false |
| `array_length(disqual_flags, 1)` | NULL | **NULL** | 1+ |
| `array_length(disqual_flags, 1) IS NULL` | true | **true** | false |

**Key point:** `array_length(..., 1)` is **NULL for empty arrays**, so it conflates **NULL column** and **`{}`**. **`cardinality`** distinguishes **empty** (`0`) from **NULL column** (`cardinality` NULL).

The partial index **`IS NULL OR cardinality = 0`** correctly indexes:

- **SQL NULL** (unknown / not set)
- **`{}`** (explicit empty)

It does **not** require `array_length`.

---

### 2. What the worker actually writes

In `snapshotRefreshWorker.ts`, the upsert uses:

- `disqualFlags: disqual.length ? disqual : null`

So in practice:

| Situation | Stored value |
|-----------|----------------|
| No flags  | **`NULL`** (not `{}`) |
| Has flags | `['halted', ...]` |

**`{}` is not written** by the current worker for the clean case.

---

### 3. Does the partial index include all “clean” rows?

For the worker’s **`NULL` clean rows:** **yes** (`disqual_flags IS NULL` branch).

For hypothetical **`{}` clean rows:** **yes** (`cardinality = 0` branch).

---

### 4. Risk of inconsistency (`NULL` vs `{}`)

**Today:** Worker normalizes “clean” to **`NULL`**, so **`{}` should not appear** unless a future code path inserts it.

**If `{}` appears later:** The index and queries still work **as written** (`cardinality({}) = 0`).

**Recommendation:** **Keep `IS NULL OR cardinality(...) = 0`**; optionally add a **DB check** or **application invariant** “never store `{}`” for cleanliness, but it is **not required** for correctness with the current index.

---

### 5. Recommendation (index)

**Keep as-is** (NULL + empty coverage). It is **more explicit** than `array_length(...,1) IS NULL` alone, which would **mis-handle** empty arrays if they ever appeared.

---

## Deliverable checklist

| Section | Spec vs shipped | Code / SQL references | Examples / data | Recommendation |
|--------|-----------------|------------------------|-----------------|----------------|
| **Deviation 1** | Shock vs `EXTREME` | `regimePostProcessor.ts`, `regimeShockDetector.ts`, `snapshotRefreshWorker.ts` | Telemetry: **0** `EXTREME` / 90d; shock is separate FSM | Gate on **`evaluateRegimeShock`…shockActive** (or shared helper) |
| **Deviation 2** | USD vs proxy | `options_flow_per_strike` schema; `snapshotRefreshWorker.ts` lines 378–389 | Numeric walkthrough of proxy vs intent | Add **real USD** rollup or exec aggregation; remove proxy for gates |
| **Deviation 3** | Index predicate | `0014_ticker_signal_snapshot.sql`; worker sets `null` not `{}` | Postgres semantics table | **Keep** `NULL OR cardinality=0` |

---

*End of audit.*
