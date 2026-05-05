# IBKR tick-by-tick pilot — runbook & results template

Use during **US RTH** with **live IB Gateway**. Primary path: **Settings → Diagnostics → Run IBKR Tick Entitlement Test** (calls `POST /api/admin/diagnostics/ibkr-tick-pilot`). Optional: `scripts/auditIbkrSubscriptions.ts` for OPRA probes.

---

## 1. Active market data subscriptions (trading account — as provided)

### US equity streaming & BBO

| Subscription | Notes |
|----------------|--------|
| US Real-Time Non Consolidated Streaming Quotes (IBKR-PRO) — **waived** | BBO: BATS, BYX, EDGX, EDGA, IEX |
| Cboe One (NP,L1) — **$1/mo** | BBO: BZX, BYX, EDGX, EDGA |
| Cboe One Add-On Bundle (NP,L1) — **$1/mo** (waived at $5 commissions) | |
| US Equity and Options Add-On Streaming Bundle (NP) — **$4.50/mo** | |
| US Securities Snapshot and Futures Value Bundle (NP,L1) — **$10/mo** (waived at $30 commissions) | |

### US equity depth (L2)

| Subscription | Notes |
|----------------|--------|
| NASDAQ TotalView-OpenView (NP,L2) — **$16.50/mo** | |
| NASDAQ TotalView-OpenView EDS (NP,L2) — **$1/mo** | |
| IEX Depth of Book (NP,L2) — **waived** | |

### Imbalances

| Subscription |
|----------------|
| NYSE Order Imbalances (NP) — $1/mo |
| NYSE ARCA Order Imbalances (NP) — $1/mo |
| NYSE MKT Order Imbalances (NP) — $1/mo |

### Options L2 (OPRA L1 prerequisite)

ISE, NASDAQ Options, NYSE AMEX Options, NYSE Arca Options (each priced per portal).

### Futures, indices, bonds/FX, other

Per your inventory (CBOT, US Futures Value PLUS, ICE, CME indices, Cboe MSCI, NASDAQ Global Index, bonds, IDEALPRO FX, mutual funds, crypto, Korea, Alt European — mostly waived or as listed).

### Notably absent (tape)

| Missing | Implication for tick-by-tick |
|---------|-------------------------------|
| **NYSE Network A (CTA)** — primary NYSE tape | **NYSE-listed** prints consolidated on **NYSE** may be **denied or degraded** (e.g. **354**, **10168**) for full tape; **confirm empirically** on **JPM**, **BAC**. |
| **NYSE AMEX Network B (CTA)** | Same class of risk for some symbols. |
| **NASDAQ Network C (UTP)** — you noted *appears bundled via TotalView prerequisite* | **NASDAQ-listed** names often OK for depth; **Last** ticks still need **streaming** entitlement — verify on **NVDA**, **AAPL**, etc. |

**Pricing** in this doc is **as you reported**; always confirm current amounts in Client Portal.

---

## 2. Subscription → API capability → `ibStreamer.ts` usage

| Capability | Typical API | Consumed in `ibStreamer.ts`? |
|------------|-------------|------------------------------|
| L1 / BBO streaming | `reqMktData` | **Yes** (breadth, dynamic quotes, Cboe One pool, imbalance uses `reqMktData` + generic tick **225**) |
| L2 / book | `reqMktDepth` | **Yes** (SPY, `/NQ`, ES, dynamic TotalView) |
| Tick-by-tick last / all last | `reqTickByTickData` `"Last"` / `"AllLast"` | **No** (pilot script only) |
| Tick-by-tick NBBO | `reqTickByTickData` `"BidAsk"` | **No** |
| Historical tape | `reqHistoricalTicks` | **No** |

**Paid-but-unused (relative to tick-by-tick roadmap):** anything above that your subscriptions **support** but the **server never requests** — especially **`reqTickByTickData`** paths until the pilot or product code adds them.

---

## 3. Pilot symbols (venue probe)

| Symbol | Listing (for hypothesis) |
|--------|---------------------------|
| NVDA, AAPL, MSFT, AMD, MU | NASDAQ |
| JPM, BAC | NYSE |

---

## 4. How to run

### 4.1 Alpha Terminal (recommended)

1. Set **`ADMIN_API_KEY`** on the API server and **`VITE_ADMIN_API_KEY`** (same value) in the web build.
2. Open **Settings → Diagnostics**.
3. During **9:30–16:00 ET** (weekdays), click **Run IBKR Tick Entitlement Test** (60s). Results persist to **`ibkr_diagnostics_runs`** and appear in the panel.

### 4.2 curl (admin key)

```bash
curl -sS -X POST "$API_BASE/admin/diagnostics/ibkr-tick-pilot" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -d '{"triggeredByUserId":"manual-curl"}' | jq .
```

### 4.3 Optional: OPRA probe script

```bash
# From the backend package that contains scripts/auditIbkrSubscriptions.ts
export IB_AUDIT_CLIENT_ID=87
export IB_PORT=4002
npx tsx scripts/auditIbkrSubscriptions.ts
```

**Output:** `/tmp/ibkr_subscription_audit.json`

---

## 5. Concurrent market data lines

**Not returned in the API response.** During the run, capture from **TWS / Client Portal** (market data line usage) a **screenshot or numeric max / in-use**. Paste into §7 below.

**Headroom for LC130 tick streams:** `max_lines - in_use_at_test_time - safety_buffer` (IB counts concurrent streams; tick-by-tick usually consumes lines per stream — confirm for your Gateway version).

---

## 6. Results template — paste after RTH run

### 6.1 Run metadata

| Field | Value |
|--------|--------|
| Date / time (ET) | |
| Gateway host:port | |
| `IB_PILOT_CLIENT_ID` | |
| `IB_AUDIT_CLIENT_ID` | |
| Production API server stopped? (Y/N) | |

### 6.2 Line count (from portal / TWS)

| Field | Value |
|--------|--------|
| Max concurrent lines | |
| Lines in use during pilot | |
| Notes | |

### 6.3 Per-symbol tick-by-tick (API / DB row `per_symbol_results`)

| Symbol | Venue (hypothesis) | Accepted? (Y/N/partial) | Error code | Error message | Tick count (60s) | Ticks/s | Exchange / venue field visible? (Y/N + field name) | Special conditions visible? (Y/N) |

### 6.4 Sample payloads

Paste **one** raw `sampleTicks` entry (redact if needed) for:

1. **MU** (NASDAQ)
2. **JPM** (NYSE)

### 6.5 NASDAQ vs NYSE conclusion

| Question | Answer |
|----------|--------|
| Did all NASDAQ names stream Last ticks? | |
| Did both NYSE names stream? | |
| If NYSE failed, code (354 / 10168 / other)? | |

### 6.6 `auditIbkrSubscriptions` summary

Paste `probes` array from `/tmp/ibkr_subscription_audit.json` (or full file).

### 6.7 Equity activity / block-trade feasibility (Phase 2)

| Question | Yes / No / Partial | Notes |
|----------|-------------------|--------|
| Sufficient **Last** tick stream for LC130-style tape features without new subs? | | |
| If **No** for NYSE, add **NYSE Network A (CTA)** (or portal-equivalent) — confirm **name + monthly price** in portal before buying | | |

---

## 7. Error code quick reference

| Code | Typical meaning |
|------|-----------------|
| **354** | Requested market data not subscribed |
| **10168** | Display suppressed / entitlement |
| **10089** | Max tick-by-tick requests (varies) |
| **200** | No security definition |
| **101** | No market data permissions |

---

## 8. JSON skeleton (manual merge if combining files)

```json
{
  "runMeta": {
    "etTimestamp": "",
    "gateway": "127.0.0.1:4002",
    "ibPilotClientId": 91,
    "ibAuditClientId": 87,
    "maxConcurrentLines": null,
    "linesInUse": null
  },
  "tickByTickPilot": {},
  "auditIbkrSubscriptions": {}
}
```

Replace `{}` with `GET /api/diagnostics/ibkr-tick-pilot/:id` JSON (or export from `ibkr_diagnostics_runs`) and `/tmp/ibkr_subscription_audit.json` respectively.
