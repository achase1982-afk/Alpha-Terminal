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

---

## Follow-up (PR #217) — Why Discovery might fail when Momentum / Unusual Flow do not

### Executive summary

The **browser** `TypeError` (“expected pattern”) still means **`fetch()` + `redirect: 'error'`** on the **single** scanner HTTP call the UI makes for Discovery/Momentum. **Discovery does not use a different URL, method, or path than Momentum** on the wire. Any “Discovery-only” behavior is almost certainly **duration / payload size / server outcome** of the **same** route (`POST …/deterministic-scan` with `scanMode: "DISCOVERY"` vs `"MOMENTUM"`), or an **intermittent** edge/proxy issue that shows up more often when the handler runs longer — not a separate Discovery route in Express.

`scannerUnusualFlow.ts` is **not** in the Alpha Terminal scan button path for Unusual Flow in `MarketScanner.tsx` (that UI calls **`POST …/ai/unusual-flow-scan`** in `routes/ai.ts`). The `/api/scanner/unusual-flow` router is a **different** product surface (job-based Polygon WS scan).

---

### 1. Frontend request construction (`MarketScanner.tsx`)

| Tab | Endpoint | Method | Body |
|-----|----------|--------|------|
| **Discovery** | `` `${API_BASE}/ai/deterministic-scan` `` (`API_BASE` = `/api`) | `POST` | `JSON.stringify({ symbols: syms, accessToken: accessToken \|\| "", scanMode })` with **`scanMode === "DISCOVERY"`** (default when tab is Discovery) |
| **Momentum** | **Same URL** | `POST` | **Same shape**; only **`scanMode === "MOMENTUM"`** |
| **Unusual Flow** | `` `${API_BASE}/ai/unusual-flow-scan` `` | `POST` | `JSON.stringify({ symbols: syms, filters: unusualFilters, mode: presetMode, activePreset, basePreset: … })` — **different path**, **larger** body (filter object), no `accessToken` in body |

**Differences:** Unusual Flow hits a **different** handler (`/ai/unusual-flow-scan`). Discovery vs Momentum differ **only** by one JSON field (`scanMode`) and the same `symbols` array; **no** trailing slash or query string variance for deterministic scan.

---

### 2. Backend route branching (`routes/ai.ts`)

Both modes use **one** route:

- Reads `scanMode` from body; defaults to **`DISCOVERY`** if not `MOMENTUM`.
- Same shock gate, same pulse context, same `traderToken` resolution.
- **`scanMode === "DISCOVERY"`** → `runDiscoveryScan(…)`; else → `runDeterministicScan(…)` from **`deterministicScanner.ts`** (v1).

**No** separate middleware for Discovery. **No** auth header difference between modes (Schwab bearer comes from body `accessToken` inside the scanners; Clerk JWT is on the incoming request via `fetchWithAuth` like all other calls).

---

### 3. Where Discovery diverges from Momentum (server work)

**Shared (both v1 and v2):** `fetchQuotesBatch` → Schwab **`/quotes`**; `fetchPortfolioSymbols` → Schwab **`/accounts?fields=positions`** (if `traderToken`); `fetchPriceHistory` → Schwab **`/pricehistory`**.

**Momentum-only (`deterministicScanner.ts`):** per symbol (batched concurrency 5): **`fetchOptionsChainSummary`** → Schwab **`/chains`** — many chain requests.

**Discovery-only (`deterministicScanner.v2.ts` → `runDiscoveryScan`):**

- **DB:** `equity_daily`, `flow_daily_aggregates`, `options_flow_per_strike`, `equity_daily` IVR, `getFlowAcceleration`, telemetry inserts — **no HTTP** for Polygon in the main flow path (liquidity/flow use **`fetchFlowDataFromDB`**, not live Polygon snapshot in the hot path; `fetchPolygonOptionsData` exists but is **not** referenced from `runDiscoveryScan` in the traced file).
- **After** the main scoring loop (Discovery-only blocks):
  1. **IDIOSYNCRATIC mode:** `computeIOScore` per scored row — **DB only** in `ioScoreEngine.ts` (no `fetch` there).
  2. **`requestFlowCapture(sym)`** for top-N symbols (`CFG.flowCaptureTopN`, default capped 20–50) — **internal** flow capture (Polygon WS / Schwab / chain helpers per `flowCaptureService.ts`); failures are caught and logged, not thrown to the route.
  3. **`getPolygonFlowHighlightsBulk(symbols)`** — **DB only** (`polygonFlowHighlights.ts`: `options_flow_per_strike` + session tape tables).
  4. **`getNextEarningsDate`** for each **candidate** in the pool — **`earningsService.ts` uses `fetch`** to vendor/Yahoo endpoints (can be many calls).
  5. Larger **JSON response** (per-candidate metadata, Polygon highlights, catalyst chips, etc.).

**Unusual Flow (`unusualFlowScanner.ts`):** **DB-only** read path for `POST /ai/unusual-flow-scan` — no Schwab token in body; no `runDiscoveryScan`.

---

### 4. Outbound HTTP from `runDiscoveryScan` (candidates for 3xx — only if misread as server-side)

Node **`fetch` follows redirects by default**; a Polygon or Schwab **302** inside the **Node process** would **not** surface the **browser** “expected pattern” error. That error remains **client-side** on the **browser → API** request.

If the symptom were **instead** a **500** with a message from an internal `fetch`, the suspects would be:

1. **Schwab** (`Schwab market data host`) — quotes, price history, accounts (shared with Momentum where used).
2. **`getNextEarningsDate`** — external HTTP per candidate (Discovery-only at scale).
3. **Flow capture** — internal stack may call **Polygon REST** (`polygonChain.ts` etc.); redirects would be consumed inside Node.

---

### 5. Most likely explanation when “only Discovery” fails (same edge, same wrapper)

Because **URL and wrapper are identical** for Discovery vs Momentum:

1. **Proxy / gateway timeout or reset** on the **long-running** `POST /api/ai/deterministic-scan` when `scanMode` is **DISCOVERY** (more CPU, more DB, bulk highlights, top-N flow capture, many `getNextEarningsDate` calls, **larger JSON**). Some clients/proxies surface that as a **`TypeError`** rather than a clean HTTP status (similar class of failure as redirect-with-`redirect: 'error'`).
2. **Intermittent 302** on the **same** path (auth/session middleware) that happens to correlate with longer requests — **Network tab** (`Location` header, status chain) is decisive.

**Not supported by code review:** a Discovery-specific **different URL** or Express branch that returns 302 only for Discovery.

---

### 6. Recent git history (signal, not proof of regression)

```text
git log --oneline -30 -- artifacts/.../deterministicScanner.v2.ts artifacts/.../routes/ai.ts
```

Recent themes include: scanner → Strategist wiring, Polygon flow / live flow / flow capture, unusual-flow bonus and **`getPolygonFlowHighlightsBulk`**, LIVE_FL diagnostics. Those **increase Discovery work and response size** relative to older builds — consistent with **timeout** correlation, not a new redirect-only path.

---

### 7. Recommended fixes (once confirmed)

| If evidence shows… | Fix direction |
|-------------------|---------------|
| **502/504 / connection reset** on deterministic-scan for Discovery only | Raise **nginx `proxy_read_timeout`** (and upstream `server.timeout` already 120s in `index.ts`); or **shorten Discovery** server-side (e.g. lower `flowCaptureTopN`, batch/limit `getNextEarningsDate`, defer highlights to async). |
| **302/307** to login or CDN with **`Location`** | Fix **auth/session** or **canonical host** (www vs apex); optionally **`redirect: 'follow'`** for same-site API in `fetchWithAuth` **only** if policy allows (trade-off: may hide auth bugs). |
| **Rare false correlation** | Add **structured client logging** (status, `res.redirected`, `res.url`) before `res.json()` on scan responses. |

**Disambiguation in one request:** From the browser, run **Momentum** and **Discovery** back-to-back with DevTools open; compare **time to first byte**, **status**, **`redirected`**, and **response size**. If Discovery always exceeds a fixed threshold (e.g. 60s), treat as **timeout** first.

---

### 8. `scannerUnusualFlow.ts` note

Mounted at **`/api/scanner`** (`routes/index.ts`). **Not** used by `MarketScanner`’s Unusual Flow tab, which calls **`/api/ai/unusual-flow-scan`**. No change to Issue 1 diagnosis from this file unless a different client calls `/api/scanner/unusual-flow`.
