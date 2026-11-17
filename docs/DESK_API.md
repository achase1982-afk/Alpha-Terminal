# Desk read API (`/api/desk/v1`)

Bearer-protected JSON and SSE market data for an external trading desk. Mounted outside Clerk `apiRequireAuth`.

## Authentication

```http
Authorization: Bearer <DESK_API_KEY>
```

`DESK_API_KEY` must be set on the server; otherwise all routes return **503**.

## Envelope

JSON responses include:

| Field | Description |
|-------|-------------|
| `source` | Provider id |
| `as_of` | UTC epoch ms |
| `stale` | Feed freshness flag |
| `session_date` | ET trading date `YYYY-MM-DD` |
| `asof_et` | ISO-8601 with America/New_York offset |

## `/health` feed schema

Each item:

`feed`, `source`, `last_update_ts` (UTC **ms** of last data), `age_ms`, `stale`, `stale_after_ms`, `status`, `session_date`, `asof_et`.

**Status:** `OK`, `streaming`, `stale`, `stopped`, `evicted_yielded`, `AUTH_FAIL`, `session_closed`, `error`, `reconnecting`, `not_configured`.

Outside a feed’s ET session window → `session_closed` and `stale=false`.

| Feed | stale_after_ms |
|------|----------------|
| `schwab_streamer` | 90000 |
| `schwab_quotes_rest` | 15000 RTH / 300000 off-hours |
| `schwab_chains` | 180000 |
| `live_gamma_0dte` | 180000 (09:29:50–16:00:50 ET) |
| `live_gamma` | 180000 (09:31:20–16:00:20 ET) |
| `live_net_prem` | 180000 (09:31:20–15:45:20 ET) |
| `uw_flow`, `tradier` | 180000 |
| `alpaca`, `news` | 900000 (15 min) |

`alpaca` is **news only** (not SIP/NBBO quotes).

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Feed freshness matrix |
| GET | `/quotes?symbols=&source=schwab\|tradier` | Honours `source`; no silent fallback between vendors |
| GET | `/tape/spx/stream` | SSE Schwab streamer frames `{rx_ns,c,dir?,m,session_date,rx_utc_ms}` |
| GET | `/tape/spx/raw?session_date=&since_ns=` | Gzip-backed inbound frame NDJSON (`{c,rx_ns,m}`); `since_ns` is UTC epoch ns string |
| GET | `/tape/spx?since=` | Normalized in-memory ticks |
| GET | `/chains?symbol=&expiration=` | Full Schwab chain by default (`range=ALL`, no `strikeCount`). Optional `strikeCount`, `range` (`ITM`/`NTM`/`OTM`/`ALL`). Response includes `truncated`, `contract_count`, normalized `rho`, and raw contracts. |
| GET | `/flow?symbol=&source=unusual_whales` | UW flow; `symbol=SPX` → `ticker_symbol=SPX,SPXW` + server filter |
| GET | `/bars` | Schwab price history |
| GET | `/news?symbols=&source=finnhub\|alpaca_news` | Honours `source`; Alpaca uses news API + `alpaca` feed freshness |

## Streamer

Reuses the **single** server Schwab streamer (no second login). Taps inbound/outbound frames for desk SSE. Notify **code 12** → `evicted_yielded` with backoff.

`DESK_STREAMER_ENABLED` (default `false`) is only for cutover when no app streamer exists; with the normal api-server streamer, health reflects live connection state.

## Postgres retention

- `desk_api_snapshots`: health/quotes/chains payloads, **30 days**
- `desk_spx_tape`: normalized ticks, **current + prior ET session** only
- `desk_spx_tape_raw`: 60s gzip NDJSON chunks of every inbound streamer frame, **current + prior ET session**

## Tape universe (shared Schwab streamer)

When `DESK_TAPE_UNIVERSE_ENABLED` is true (default), desk **ADD**s (never SUBS) on the app’s single streamer connection:

- `LEVELONE_EQUITIES` — `$SPX`, `SPY`, `$VIX` (fields 0–51)
- `LEVELONE_OPTIONS` — SPXW 0DTE ~2000 ATM-centered symbols (fields 0–55)
- `OPTIONS_BOOK` — ~500 ATM 0DTE (fields 0–3)

Universe refreshes on spot moves and 0DTE roll; symbol caps surface in `/health` → `desk_tape_universe`. Inbound capture counters: `/health` → `schwab_streamer.{frames,bytes,last_frame_ns}`.

## Environment

| Variable | Role |
|----------|------|
| `DESK_API_KEY` | Bearer secret (**required**) |
| `DESK_STREAMER_ENABLED` | Optional desk-only streamer flag (default off) |
| `DESK_TAPE_UNIVERSE_ENABLED` | Desk ADD tape universe on shared streamer (default on) |
| `UW_API_KEY_NEW` / `UW_API_KEY` | Unusual Whales |
| `TRADIER_API_KEY` / `TRADIER_TOKEN` | Tradier fallback quotes |
| `ALPACA_API_KEY_ID` + `ALPACA_API_SECRET_KEY` (or `APCA_*`) | Alpaca **news** path only |
| `FINNHUB_API_KEY` | Symbol news |

Each also accepts a `DESK_` prefix. Schwab data uses the existing token store (unchanged).