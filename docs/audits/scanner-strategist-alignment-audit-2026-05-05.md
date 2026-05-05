# Scanner vs Strategist edge signatures — alignment audit (2026-05-05)

**Scope:** Investigation only (no product code changes).  
**Goal:** Compare what recent Strategist runs actually keyed on (structured `strategistPayload` in `strategist_telemetry.full_diagnostic`) against the snapshot scanner’s current sub-scores and composite.

**Method:** Five recent rows were selected from `strategist_telemetry` by ticker and recency: **NVDA** id 298, **KO** id 297, **CRWD** id 296 (long call calendar thesis), **CRWD** id 295 (pass / no clean edge), **MU** id 293. For each row, `full_diagnostic->'strategistPayload'->vol|flow|catalyst` text fields were read in full. Scanner behavior is inferred from the snapshot refresh worker implementation (term / IV–RV / skew / catalyst / flow sub-scores and composite weights).

**Path-substring note:** Code references below use shortened or generic path fragments (e.g. `…/lib/snapshotRefreshWorker.ts`) to satisfy repository secret-scanning rules; the real file lives under the Node backend package tree (avoid embedding vendor or host path tokens in docs).

---

## 1. Per-run extraction (Strategist “reasoning” surface)

The Strategist does not persist free-form `raw_ai_response` for these rows (length zero in DB), but it **does** persist a rich `strategistPayload` with `vol`, `flow`, and `catalyst` sub-objects. The bullets below are **direct extractions** from those fields.

### 1.1 NVDA — `strategist_telemetry` id **298** (recommendation; overnight-style timestamp)

**Vol**

- **Term structure / expiries compared:** Explicit calendar of ATM IVs: **2026-05-06**, **2026-05-08**, trough into **2026-05-11**–**2026-05-18**; **event expiry 2026-05-22** at **47.47%** vs **2026-05-18** **34.90%** (**+12.57** vol pts); vs **2026-06-05** **44.05%** (**+3.42**); back of strip **2026-06-12**/**2026-06-18** down to **2026-08-21** **37.40%**. Skips **0DTE 2026-05-04** as null. References **`TermStructureExpiries`** coverage (**9 of 10** curated expiries clean).
- **IV vs realized / implied move:** **HV20 34.85%**, **HV30 36.58%** (no earnings contamination flag). **2026-05-06** 2-day implied move **$4.62 / 2.34%**, straddle IV **39.54%** ≈ **+4.69** vs HV20, **+2.96** vs HV30. Pre-event strip “close to realized.” **2026-05-22** **47.47%** ≈ **+10.89** vs HV30, attributed to **May 20 earnings** plus **same-day macro overlap** (not “surface error”).
- **Skew:** **2026-05-13** 25Δ put **38.04%** vs call **34.64%** → **+3.40** vol pts; `clean_25d_first_expiry`; cautious about extrapolating to earnings expiry without clean skew object there.
- **State / hygiene:** Closed session; **IV removed 2,365** contracts (reason mix: noLiquidity, oneSidedMarket, pennyOption, ceilingClamp, surfaceOutlier); **ivr_contamination_elevated** not set; **IVR 43** on **257** days.

**Flow**

- **Patterns:** Call-heavy tape but **not** clean one-way institutional into earnings. Highlights **195C 2026-05-08**: sweeps/blocks, **~$6.33M** block notional, repeat ask-side blocks. **200C 2026-05-06** huge volume (**92.2% unknown** side). Large **212.5P 2026-05-15** **~$4.11M** block with **side null**. **AggressorSessionTotals**: only **12.4%** known-side prints; **unknown notional ~$184.95M** vs small ask/bid/mid buckets.
- **Dominant read:** Short-dated upside **before** catalyst; meaningful **two-way** and **unknown-side** limits directional confidence.

**Catalyst**

- **Primary:** **Q1 FY2027 earnings Wed 2026-05-20 after close**; first listed capture expiry **2026-05-22**; notes **FOMC minutes same day** and follow-on macro.
- **Earnings history:** Only **4 of 16** quarters with usable reaction data; last four: beats but **three** closed **down**; avg abs c2c **~3.16%** vs avg pre-earnings implied move **~6.80%**; **IV crush** all positive, avg **~14.66%** (wide range).
- **Bar / asymmetry:** Forward consensus vs prior outlook band (revenue high end ~**$79.56B**), margin bands, **China/export** commentary; asymmetry **not cleanly bullish** despite strong fundamentals (beats → **negative** c2c pattern).

**Macro overlap (as cited)**

- Same-day **FOMC minutes** with earnings; additional macro in window (referenced in catalyst read).

---

### 1.2 KO — id **297**

**Vol**

- **Term structure:** **Front-week 21.27** monotonic decay to **7/17** trough **16.35**, small bump **8/21 16.93** (expiry that **captures 7/21 BMO earnings**) vs **7/17** spread only **0.58** vol pts — “thin earnings premium.” LEAP **2027-01-15** **15.78**; “no kink.”
- **IV vs realized:** **HV20 21.6 / HV30 18.6**; notes **HV20 post-earnings contaminated** by **+3.86%** move (not flagged). Mid-month ATM **~18.78–18.93** “on top of” HV30; front-week **+2.6** vs HV30 “weekly gamma,” not edge. **5/8** implied move **$1.415 / 1.81%**.
- **Skew:** **5/15** 25Δ put **20.58** / call **19.57** → **+1.01** vol pts (`clean_25d_first_expiry`); wing note **80C** vs **79P** micro skew.

**Flow**

- **Block / side / repeat:** **78P 5/22** mid blocks (**288 + 221** lots, **~$60k**), **78P 5/15** **480-lot** mid **~$32.6k**, paired **77.5P** prints → **protection laddering** read. **75C 5/15** **130-lot** mid **~$47.6k** largest print — **delta substitute**. **81C 5/29** **vol/OI 3.2x**, modest size.
- **Aggressor mix:** **33.8% ask / 22.2% bid / 39.6% mid / 4.4% unknown**; mid-heavy **$598k** vs **$211k** ask vs **$137k** bid — “negotiated/two-way.”
- **Retail:** **80C 5/8** largest contract volume, **61% ask**, small clips, **OI 6,572** — lottery chase.

**Catalyst**

- **Primary:** **Q2 earnings 2026-07-21 BMO**; **8/21** clean capture; **7/17** last pre-earnings clean expiry; **5/8–7/17** window “macro dominated” (lists **PPI, CPI, FOMC minutes, PCE, NFP**, etc.). **Q1 just printed 4/28** with guide raise.
- **History:** Four quarters: gaps and c2c with **mean abs c2c ~2.5%** mixed sign; **IV crush ~13–19%** where `iv_reaction` exists; drift series “noisy.”
- **Bar:** Consensus EPS/revenue vs guide raise; operating margin / mix / **geopolitical** overhang from Q1 call.

**Macro overlap**

- Explicit list of macro dates intersecting **5/29**, **6/12**, **6/18** expiries; staples **beta −0.04** called out.

---

### 1.3 CRWD — id **296** (long call **calendar** thesis)

**Vol**

- **Term structure / expiries:** **5pt** strip: **5/8 57.05 → 5/15 53.36 → 5/22 null → 5/29 48.32 → 6/5 52.44 → 6/12 null → 6/18 50.41 → 7/17 48.04 → 8/21 46.77**. Core anomaly: **5/29** (earnings **5/28 AMC** + **CPI / FOMC minutes / PCE**) **below** **5/15** and **6/5**. Straddle mid on **5/29 470** backs out **~49 vol**; wide spreads, thin OI (**62** calls / **1** put). “Fair” **5/29** after crush + event premium modeled **~55–57**; current **~6–8** vol pts **cheap**.
- **IV vs realized:** **HV20 53.88**, **HV30 52.00**; **5/8** ~**+3** vs HV20; **5/15** ~matched HV20; **5/29** **~5–6 vol pts below** HV20/HV30 despite event stack — dislocation thesis.
- **Skew:** **5/15** 25Δ put **53.41** / call **51.29** → **+2.12** (`clean_25d_first_expiry`); **5/29** wings “gappy / iv_unreliable” — no wing skew trade.

**Flow**

- **Tape quality:** **mid-dominant** (**61.7%** mid), **P/C 0.75**, backfill **partial** with dedupe drops — sweep/block counts “floor estimates.”
- **Strikes:** **5/15 500C** **82% ask**, **124-lot** block **~$73k**, sweeps — “cleanest institutional footprint” but **vol/OI ~0.4** and **misses earnings**. **5/22 500C** **100-lot** at **bid** **~$64.5k** — counterweight. **5/8 480C** high vol/OI but **58.6% mid**. **5/15 470C** deep **OI** anchor for calendar. **5/29 470** thin but where IV underprice sits.
- **Retail:** **5/8** far OTM calls (e.g. **525C**, **530C**) lottery signatures.

**Catalyst**

- **Primary / dates:** Earnings **2026-05-28 AMC**; **date conflict** with forward block showing **2026-06-02 AMC** — stresses **5/29** vs **6/5** capture. Macro stack listed inside **5/29** window.
- **History:** Last four prints: gap-down modal opening but **positive** c2c **3 of 4**; **IV crush** avg **24.8%**; data gaps on older quarters acknowledged.
- **Bar / asymmetry:** Consensus vs company **narrow revenue band**, **ARR** targets, post-outage narrative; upgrades raised bar; vol underpricing called **sharper** edge than direction.

**Macro overlap**

- **PPI, CPI, FOMC minutes, PCE, NFP** explicitly tied to expiries in window.

---

### 1.4 CRWD — id **295** (pass — “no clean edge”)

**Vol**

- Same **5pt** ATM list as 296; **5/22** and **6/12** null; **5/29** still **48.12** vs **6/5 52.89** “despite” **2026-05-28** catalyst — **date uncertainty** or dislocation, but **null neighbors** block “clean variance isolation.”
- **IV vs realized:** **HV20 53.88**, **HV30 52.00**; **5/8** **+3.53** vs HV20, **+5.41** vs HV30; **5/15** “in line” HV30; **5/29** **below** HV20/HV30. **5/8** straddle **$23.05 / 4.9%**, IV **58.46**; **5/29 470** straddle **~$48.48 ~10.3%** spot — “25-DTE package” not clean earnings move.
- **Skew:** **5/15** **+1.85** vol pts put-over-call — “normal insurance.”
- **Hygiene:** **IVR 64**, **28.1%** contracts IV removed; BSM telemetry disagreement — rely on **cleaned ATM** and **25Δ**, not raw wings.

**Flow**

- **Tape:** **partial** / timeout / truncation flags; **5/8 480C** largest pocket, **58.7% mid**, **18.8% ask** — “weekly trading” not clean buy. **5/15 500C** best ask pocket but **does not capture earnings**. **5/22 500C** **100-lot** at **bid** conflicts uniform accumulation.
- **Retail:** Far upside weeklies; **480/485** clusters mid-heavy.

**Catalyst**

- Same earnings **vs** **6/2** date conflict; high bar on **ARR / guide**; agrees **scanner bullish lean understandable** but **scanner no_clear_edge correct** — insufficient clean institutional **event-expiry** sponsorship.

**Macro overlap**

- Same macro list tied to expiries.

---

### 1.5 MU — id **293**

**Vol**

- **Term structure:** Strip **5/8 85.84 → 5/15 78.23 → … → 7/17 74.73** (contains **6/23** print) vs **8/21 73.60** — **~1 vol pt** earnings premium “too tight” **51 days** out; **5/8→5/15** **~7 vol pt** step with **no name catalyst** (calls out **CPI 5/13**, **PPI 5/12** into **5/15**).
- **IV vs realized:** **HV20 56.51**, **HV30 71.59**; **5/8** **~+29** vs HV20, **~+14** vs HV30; **5/8** straddle **7.36% / $42.75** vs spot **$580.85**; back **73–75** ~fair to HV30 once earnings treated as embedded jump.
- **Skew:** **5/15** **−1.07** vol pts (calls over puts); far OTM call wing bid; far OTM puts also bid — **25Δ** on first clean expiry preferred.

**Flow**

- **Calendar / roll:** **600C 5/15** **88% ask** vs **600C 5/8** **51.9% bid** — **calendar/diagonal**, not directional. **590C 5/15** bid blocks → **overwrite**. **P/C 0.73** but session totals **bid-heavy**; backfill **65/186 OCC**, `tape_backfill_incomplete`.
- **Strikes:** Pin-zone puts on **5/8** with extreme **vol/OI**; **500P** lotto signature.

**Catalyst**

- **Primary:** **Fiscal Q3 2026 earnings ~2026-06-23 AMC** (51d); **FOMC 6/17** six days before earnings; **CPI 5/13**, **PCE 6/26**.
- **History:** Four quarters with reactions: implied move avg **8.85%**, IV crush avg **18.6%**; wide **5d** outcomes (**−23%** to **+26%**).
- **Bar:** Consensus EPS/revenue; **HBM3E/HBM4**, DRAM/NAND trajectory; sell-side PT dispersion (**$400–$1000**); spot **above** consensus mean.

**Macro overlap**

- **CPI**, **FOMC** proximity to earnings, **PCE** cited.

---

## 2–3. Mapping: Strategist criterion → scanner sub-score

**Scanner sub-scores today** (from `…/lib/snapshotRefreshWorker.ts`):  
`term_structure` (front vs next calendar week ATM IV), `iv_vs_realized` (front-week ATM IV minus HV20 in vol points), `flow_alignment` (tier threshold on **ask USD** notional share among **ask+bid+mid**, plus tape quality gate), `skew_anomaly` (25Δ skew on **front** expiry only), `catalyst_proximity` (earnings days + confirmed flag vs a **generic** `getUpcomingEvents(5)` macro score), composite **0.30 / 0.25 / 0.20 / 0.15 / 0.10** respectively when not disqualified.

| Strategist criterion (from sample runs) | Current scanner score | Match quality | Gap |
|----------------------------------------|------------------------|---------------|-----|
| **Multi-expiry ATM term shape** including **pre-event vs event vs post-event** (e.g. NVDA **5/18 vs 5/22**, CRWD **5/15 vs 5/29 vs 6/5**, MU **7/17 vs 8/21**, KO **7/17 vs 8/21** earnings kink) | `term_structure` = **frontWeek vs nextWeek** only | **Poor** | Strategist uses **curated 5–10 expiries** and **event-adjacent** pairs; scanner uses **two adjacent weeks**, misses **inversion** (CRWD) and **earnings kink magnitude** (KO thin 0.58pt still noted). |
| **IV vs realized at multiple horizons** (compare **5/8, 5/15, 5/29** to HV20/HV30; event IV premium vs HV30 — NVDA) | `iv_vs_realized` = **front** vs **HV20** only | **Partial** | No **HV30**, no **per-expiry** IV–RV gap, no **straddle-implied move %** vs RV. |
| **Implied move / straddle** (% spot, $, BSM) at chosen expiry | *(none as score)* | **None** | Strategist repeatedly cites **straddle implied move**; scanner stores some front straddle fields in payload but **does not score** them vs RV or vs history. |
| **IVR** and **IV hygiene** (clamped %, contamination flags) | `ivr` used for **disqual** and edge typing, **not** a sub-score | **Partial** | Strategist **conditions conviction** on hygiene; scanner mostly binary / non-scored. |
| **25Δ skew** at **first clean expiry** (often **not** 0DTE; may be **5/13**, **5/15**) | `skew_anomaly` on **front** expiry 25Δ only | **Poor–partial** | NVDA skew anchored **2026-05-13**; CRWD/MU anchored **5/15**; scanner may use **different** expiry than Strategist’s `skew25DeltaReason` target. |
| **Wing / far OTM** behavior | *(none)* | **None** | MU cited **650/700/750C** wing; scanner does not encode wing steepness. |
| **Flow: sweep / block / repeat cluster** notional and **print quality** | *(not in linear sub-scores)*; edge classifier uses unusual volume skew | **Poor** | Strategist leans heavily on **sweep/block counts**, **repeat same-side**, **largest print** notional; scanner **flow_alignment** is **session ask%** after threshold, no sweep/block structure. |
| **Known-side vs unknown-side %** (NVDA **~12.4%** known; KO mid-heavy; CRWD mid-heavy) | `flow_alignment` **rewards ask share** of **known** ask+bid+mid bucket | **Poor** | When **unknown** dominates (NVDA), Strategist **down-weights** directionality; scanner can still score flow if **ask** notional is large among **known** legs — **misaligned** with strategist’s “unknown dilutes signal” handling. |
| **Mid vs ask vs bid** interpretation (protection ladders, rolls) | Same as above | **Poor** | Mid-heavy tape (KO, CRWD) = **two-way / hedge** in Strategist; scanner has **no mid-penalty** in score. |
| **Vol/OI** and **opening vs closing** interest at **specific strikes** | Top strike volume in summary only; not same as strategist key_strikes | **Partial** | Strategist builds **JSON key_strikes** with narrative; scanner does not score **vol/OI** at catalyst-expiry anchors (**470** on **5/29**, etc.). |
| **Tape backfill completeness** | `tape_not_run` / quality affects flow score magnitude | **Partial** | Strategist **explicitly** downgrades conviction on `tape_backfill_incomplete`; scanner gates **not_run** but does not model **partial** OCC coverage as a first-class score input. |
| **Earnings reaction stats** (gap, c2c, 5d, 20d, IV crush, sample size) | *(none)* | **None** | Every run uses `catalyst.historical_pattern` deeply; scanner has **no** earnings reaction / crush distribution score. |
| **Consensus vs guide “bar to clear”** | *(none)* | **None** | Forward EPS/rev, guide bands, ARR bars — central to pass/trade in sample; scanner ignores. |
| **Catalyst calendar vs listed expiry** (which expiry **captures** event; date conflicts **5/28 vs 6/2**) | `catalyst_proximity` = days to next earnings + macro score | **Partial** | Proximity only; no **expiry fit** score, no **date ambiguity** flag, no **macro stack inside chosen expiry** (Strategist lists PPI/CPI/FOMC/PCE vs **5/15** vs **5/29**). |
| **Macro overlap in position window** (desk window / expiry spanning FOMC) | `macroOverlapScore()` uses **fixed** `getUpcomingEvents(5)` unrelated to user desk window | **Poor** | Strategist’s `macroEventsInPositionWindow` is **expiry-scoped** in `strategistV2` data package; scanner macro score is **not** the same object. |
| **Post-earnings “pass” with flow still bullish** (CRWD 295) | `flow_alignment` + `unusualSkew` can still push **BULLISH** edge typing | **Risk** | Strategist explicitly validates **scanner no_clear_edge**; a linear composite can **overweight** headline flow vs **event-expiry** quality and **curve** ambiguity. |

---

## 4. Recommendations — sub-scores: replace, augment, add, remove

**Replace**

- **`term_structure` (front vs next week):** Replace with a **curve-shape** score computed on the **same expiry grid** Strategist uses (at minimum: **near, pre-event, event, post-event** ATM IVs from polygon chain or precomputed `termStructure5pt`-like series), including **inversion** and **event kink** height vs pre-event — not only backwardation between **two** adjacent tenors.

**Augment**

- **`iv_vs_realized`:** Augment to **multiple** gaps (front, pre-event, event) vs **HV20 and HV30**, and optionally vs **straddle-implied move** for the **event** expiry.
- **`flow_alignment`:** Augment with **sweep/block/repeat** concentration, **known-side coverage**, and **mid-share penalty** (or a separate **two-way / hedge** flag that caps directional flow score).
- **`catalyst_proximity`:** Augment with **expiry-capture fit** (days to earnings vs DTE), **date-confidence** (single vs conflicting earnings dates), and **macro density inside [now, expiry]**.

**Add** (no equivalent today)

- **`earnings_edge_signature`:** Distribution of **gap / c2c / 5d / crush** from enrichment (same family as `catalyst.earnings_history` / `earnings_reaction_summary` in the Strategist data package).
- **`bar_vs_consensus`:** Normalized distance of consensus to **guidance band** (where fundamentals exist in DB).
- **`implied_move_richness`:** Event-straddle implied move vs **historical implied** band and/or vs **RV** (Strategist repeatedly compares to “historical 6.5–8% band” on CRWD).
- **`liquidity_anchor_score`:** OI/volume at **structural anchors** (e.g. deepest OI near ATM for short leg of calendars) — strategist uses this to justify **470** calendar strikes.

**Remove or demote** (noise relative to this sample)

- **Pure `unusualSkew`-driven directional labels** without **event-expiry** confirmation should **not** feed the same weight as curve dislocation; consider **removing** skew from the **composite** until expiry alignment matches Strategist, or **gate** skew score when `tape_quality` is partial / unknown-side > X%.
- **Generic `macroOverlapScore()`** as currently implemented should be **removed** from catalyst scoring **unless** it mirrors **position-window-scoped** macro (otherwise it adds **uncorrelated** noise vs Strategist).

---

## 5. Revised composite weighting (indicative, from this sample)

Across these five runs, the decisive signals were:

1. **Term structure relative to catalyst expiries** (inversions, kink height, post-event slope) — **primary** in NVDA, CRWD 296, MU, KO.  
2. **Implied move / IV vs HV at the relevant expiry** — **primary** in NVDA, CRWD, MU.  
3. **Flow quality** (sweeps/blocks/repeat, known-side %, mid penalty) — **secondary**; often **contradicted** headline volume (CRWD 295/296, MU, NVDA).  
4. **Earnings history + bar vs guide** — **gating** on pass vs trade (NVDA asymmetry, CRWD bar, MU bimodal outcomes).  
5. **Macro-in-window** — **modifier**, not a standalone bullish/bearish driver.

**Suggested revised weight budget (composite 100%):**

| Component | Suggested weight | Rationale (sample-driven) |
|-----------|------------------|---------------------------|
| **Catalyst-expiry term shape** (replacement for current term_structure) | **0.30–0.35** | Central to NVDA, both CRWD paths, MU, KO. |
| **Implied move / IV vs RV (multi-expiry)** | **0.25–0.30** | Repeated straddle and HV comparisons. |
| **Flow quality (structure + known-side + anti-mid)** | **0.15–0.20** | Important when clean (CRWD 500C ask pocket); often **should reduce** score when unknown/mid-heavy. |
| **Earnings reaction + bar / consensus pressure** | **0.15–0.20** | Strong pass/trade discriminator; absent today. |
| **Skew (expiry-aligned)** | **0.05–0.10** | Used as **confirm/deny**, rarely the sole edge in these five. |
| **Macro-in-position-window** | **0.05** | Material modifier (overlap with earnings / CPI / FOMC); should not dominate. |

**Calibration note:** Weights should be re-fit once new sub-scores exist; this split reflects **which dimensions actually moved** the documented `strategistPayload` narratives, not statistical backtest on PnL.

---

## 6. Reproducibility (DB)

Example selection used for this audit:

```sql
SELECT id, timestamp, ticker, result
FROM strategist_telemetry
WHERE ticker IN ('NVDA','KO','CRWD','MU')
ORDER BY timestamp DESC
LIMIT 25;
```

Extract `full_diagnostic->'strategistPayload'` for ids **298, 297, 296, 295, 293** to reproduce sections 1.x verbatim.

---

## 7. Limitations

- **Sample size = 5** rows; conclusions are **directional** for product design, not statistically validated for hit rate.  
- Strategist also consumes **`data_package`** (chain summary, polygon highlights, tape backfill, etc.); this audit focused on the **persisted `strategistPayload` text** because `raw_ai_response` was empty for these runs.  
- Implementing the recommended scores requires **engineering alignment** on shared expiry grids and enrichment availability in the snapshot worker — out of scope for this document.
