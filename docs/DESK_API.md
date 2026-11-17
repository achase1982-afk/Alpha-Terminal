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
| GET | `/quotes?symbols=` | Schwab REST `/marketdata/v1/quotes`; UTC ms; index bid/ask null |
| GET | `/tape/spx/stream` | SSE Schwab streamer frames `{rx_ns,c,dir?,m,session_date,rx_utc_ms}` |
| GET | `/tape/spx?since=` | Normalized in-memory ticks |
| GET | `/chains?symbol=&expiration=` | Full Schwab chain by default (`range=ALL`, no `strikeCount`). Optional `strikeCount`, `range` (`ITM`/`NTM`/`OTM`/`ALL`). Response includes `truncated`, `contract_count`, normalized `rho`, and raw contracts. |
| GET | `/flow` | Unusual Whales (max 3 concurrent UW HTTP) |
| GET | `/bars` | Schwab price history |
| GET | `/news` | Finnhub via `symbolNewsProvider` |

## Streamer

Reuses the **single** server Schwab streamer (no second login). Taps inbound/outbound frames for desk SSE. Notify **code 12** → `evicted_yielded` with backoff.

`DESK_STREAMER_ENABLED` (default `false`) is only for cutover when no app streamer exists; with the normal api-server streamer, health reflects live connection state.

## Postgres retention

- `desk_api_snapshots`: health/quotes/chains payloads, **30 days**
- `desk_spx_tape`: normalized ticks, **current + prior ET session** only

## Environment

| Variable | Role |
|----------|------|
| `DESK_API_KEY` | Bearer secret (**required**) |
| `DESK_STREAMER_ENABLED` | Optional desk-only streamer flag (default off) |
| `UW_API_KEY_NEW` / `UW_API_KEY` | Unusual Whales |
| `TRADIER_API_KEY` / `TRADIER_TOKEN` | Tradier fallback quotes |
| `ALPACA_API_KEY_ID` + `ALPACA_API_SECRET_KEY` (or `APCA_*`) | Alpaca **news** path only |
| `FINNHUB_API_KEY` | Symbol news |

Each also accepts a `DESK_` prefix. Schwab data uses the existing token store (unchanged).