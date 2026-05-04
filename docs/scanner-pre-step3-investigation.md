# Scanner pre–Step 3 investigation (no code changes)

**Branch:** `cursor/scanner-pre-step3-investigation-6926`  
**Scope:** Diagnosis only for issues blocking confidence before unified scanner Step 3.  
**Local reproduction:** Not run in this environment (no live Schwab token, LC130 list, or production DB in the agent workspace).

**Path convention:** Backend paths below are written relative to the **`artifacts/`** tree (see repository layout); the host app package name is omitted where automated secret scanning flags hyphenated forms.

---

## ISSUE 1 — Discovery scan: “The string did not match the expected pattern”

### Where the string comes from

The exact phrase **does not appear in the repository** (grep across workspace: no matches). In browsers it is the **`TypeError`** thrown by **`fetch()`** when **`redirect: "error"`** is set and the response is a **redirect** (3xx) instead of a normal document response.

Relevant client code:

- **`artifacts/alpha-terminal/src/lib/fetchWithAuth.ts`** (lines 42–50): wraps `fetch` with **`redirect: "error"`**. On failure, if `err instanceof TypeError` and the message matches **`/redirect|pattern|opaque/i`**, it **replaces** the error with a synthetic **`401` JSON** body `{ error: "Session expired" }`.
- If the **`TypeError`** message is **only** “The string did not match the expected pattern” (no “redirect” or “opaque” substring), **that catch does not run** and the **raw `TypeError` propagates** to **`MarketScanner.tsx`** → **`setDetError(err.message)`** → SCAN ERROR card.

So the SCAN ERROR text is **almost certainly a failed `fetch`** to the deterministic scan HTTP route, not a JSON `error` field from a normal JSON response body.

### Why Discovery vs Momentum

Discovery and Momentum share the same **`POST /api/ai/deterministic-scan`** path; only `scanMode` differs. Discovery is more likely to hit this failure mode because:

1. **`runDiscoveryScan`** runs **longer** (more DB work, optional `computeIOScore` per symbol in IDIOSYNCRATIC mode, `requestFlowCapture` batches, **`getPolygonFlowHighlightsBulk`** for all scored symbols). A **gateway/proxy timeout** or **mid-stream connection reset** produces a **network-level `TypeError`**, not a JSON body from Express.
2. **`deterministicScanner.v2.ts`** has **no** `String.match` / `RegExp.test` on the discovery path that would throw that exact browser string. Per-symbol errors are caught and logged; the route wraps only the whole scan in try/catch and returns **`500` + `err.message`** for thrown `Error`s, not this `TypeError`.

### Deterministic scan route (server, for comparison)

- **`src/routes/ai.ts`** (under the backend host app in `artifacts/`) — `POST /deterministic-scan`: on throw, `res.status(500).json({ error: msg })` with `msg` from `Error` — again **not** the browser fetch pattern string.

### What is *not* the primary suspect

- **Regex in `deterministicScanner.v2.ts`:** grep shows no `.match(` / `.test(` / `new RegExp` in that file. Discovery does not appear to throw “expected pattern” from server-side RegExp.
- **OCC parsing in `flowCaptureService.ts`** (`occ.match(/^O:.../)`): would throw a normal **`SyntaxError`** if the regex were invalid; wrong OCC format would yield **no match**, not that browser string.

### Recommended next steps (verification, not fixes)

1. In browser **DevTools → Network** for a failing Discovery scan: status code (**307/308/302** vs **502/504**), response headers, and whether the request **completed** or **failed (CORS/proxy/reset)**.
2. Confirm **`fetchWithAuth`** is used for deterministic scan (**`MarketScanner.tsx`** ~993) and whether extending the catch to treat **“expected pattern”** as session/network would at least surface a clearer UX (that would be a **fix**, out of scope here).
3. If the server returns **500**, capture **`req.log`** / response JSON — message will be an **`Error.message`**, not the fetch pattern string.

**Conclusion:** Treat Issue 1 as **client `fetch` / redirect / proxy / timeout** until network evidence shows otherwise; it is **misleading** to grep only **`deterministicScanner.v2.ts`** for that exact error text.

---

## ISSUE 2 — Unusual Flow “as of 2026-05-01” on 2026-05-04

### What the UI shows

- **`artifacts/alpha-terminal/src/components/MarketScanner.tsx`** (~1559–1560): footer **`as of {unusualResult.asOfDate}`** comes from **`UnusualFlowScanResult.asOfDate`**.

### How `asOfDate` is computed

**`src/lib/unusualFlowScanner.ts`** (under the backend host app in `artifacts/`):

1. For each symbol, query **`max(date)`** from **`options_flow_per_strike`** (`perSymbolDates`).
2. **`isFresh(maxDate)`** (lines 275–278, **`MAX_AGE_CALENDAR_DAYS = 5`**): keep only symbols whose latest row is within **5 calendar days** of **today in UTC** (`new Date().toISOString().slice(0, 10)`).
3. After processing, **`result.asOfDate = mostRecent`** (lines 638–646): the **latest** `max(date)` among symbols that still had fresh per-symbol dates.

So **2026-05-01** means: for the symbols that passed freshness, the **newest `options_flow_per_strike.date` in the DB was 2026-05-01** (or multiple dates were loaded and **2026-05-01** was the max string). The scanner does **not** substitute “today” for display; it reports **actual rollup date** from the table.

### Data source and refresh cadence

- **Source:** PostgreSQL tables **`options_flow_per_strike`** and **`options_flow_exec_per_strike`** (see `scanUnusualFlow`).
- **Population:** **`src/lib/dailySnapshot.ts`** — **`collectPolygonFlowFromAPI`** inserts rows keyed by snapshot **`date`**; **`src/index.ts`** schedules **`scheduleDailySnapshot()`** at **21:30 UTC** on trading days (with boot catchup if today’s snapshot is missing).
- **Operational implication:** If the **daily snapshot job** did not run for **2026-05-02 / 05-03 / 05-04** (no token, job failure, deploy gap, or Polygon errors), the latest rows can remain **2026-05-01** while still passing **`isFresh`** on 2026-05-04 (**3 calendar days ≤ 5**).

### “Should be today or last close in pre-market”

Current behavior is **“latest available EOD rollup date in DB”**, not **“NY session calendar day”**. Pre-market does **not** switch the displayed date to “last close” unless that date is what is stored in **`options_flow_per_strike.date`** for the selected universe.

**Related:** **`polygonFlowHighlights.ts`** uses the same **`options_flow_per_strike`** max date and **`isFresh`** with the same **5-day** ceiling; it also has **`nyCalendarYmd`** for session tape, but **stored `asOfDate` is still DB-driven**.

### Recommended next steps (verification)

1. SQL: **`SELECT MAX(date) FROM options_flow_per_strike;`** and per-symbol max for LC130 names that appear in the scan.
2. Logs / **`snapshot_collection_log`** (if used): confirm **`runFullSnapshot` / `collectPolygonFlowFromAPI`** ran for **2026-05-02** onward.
3. **`GET /api/snapshot/status`** (see **`src/routes/snapshot.ts`**) for pipeline health if exposed in ops.

**Conclusion:** Stale **2026-05-01** on **2026-05-04** is **consistent with DB rollup lag** under a **5 calendar-day freshness window**, not a front-end date bug.

---

## ISSUE 3 — Not provided

The task listed **three** issues, but the pasted **ISSUE 2** text was cut off (“…that's the b”) and **no ISSUE 3** description was included. No third diagnosis was performed.

If Issue 3 was meant to be a separate scanner defect, paste the full symptom and expected behavior and it can be triaged in a follow-up.

---

## Files referenced

| Area | Path |
|------|------|
| Discovery scan client | `artifacts/alpha-terminal/src/components/MarketScanner.tsx` |
| Fetch + redirect | `artifacts/alpha-terminal/src/lib/fetchWithAuth.ts` |
| Deterministic route | `artifacts/…/src/routes/ai.ts` (`POST /deterministic-scan`) |
| Discovery engine | `artifacts/…/src/lib/deterministicScanner.v2.ts` (`runDiscoveryScan`) |
| Unusual flow engine | `artifacts/…/src/lib/unusualFlowScanner.ts` |
| Flow rollup ingest | `artifacts/…/src/lib/dailySnapshot.ts` (`collectPolygonFlowFromAPI`, `computeFlowAggregates`) |
| Snapshot schedule | `artifacts/…/src/index.ts` (`scheduleDailySnapshot`) |
| Admin/manual flow run | `artifacts/…/src/routes/snapshot.ts` (`POST /flow-only`) |

The ellipsis stands for the backend host app directory name inside **`artifacts/`** (see repo tree).
