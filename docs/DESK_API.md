# Desk read API (`/api/desk/v1`)

Bearer-protected JSON (and one SSE) surface for an external trading desk. Clerk session auth does **not** apply to these routes.

## Authentication

```http
Authorization: Bearer <DESK_API_KEY>
```

Server env: `DESK_API_KEY` (required). If unset, all routes return **503**.

## Response envelope

Every JSON body includes:

| Field | Description |
|-------|-------------|
| `source` | Upstream provider id |
| `as_of` | ISO-8601 timestamp |
| `stale` | Freshness flag for the primary feed |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Per-feed freshness for `schwab_quotes`, `schwab_chains`, `spx_tape`, `uw_flow`, `tradier`, `alpaca`, `news` |
| GET | `/quotes?symbols=SPY,QQQ,$SPX` | Schwab quotes (+ optional Tradier/Alpaca fallback blobs) |
| GET | `/tape/spx/stream` | SSE ticks for SPX / SPY / ES |
| GET | `/tape/spx?since=<iso>` | Ring buffer ticks since timestamp |
| GET | `/chains?symbol=SPX&expiration=YYYY-MM-DD` | Schwab option chain for one expiry (30s cache) |
| GET | `/flow` | Unusual Whales flow alerts (60s cache, max 3 concurrent UW HTTP calls) |
| GET | `/bars?symbol=&timeframe=1m\|5m\|1d&limit=` | Schwab price history |
| GET | `/news?symbols=` | Finnhub symbol news via `symbolNewsProvider` |

Base URL on Railway: `https://<api-server-host>/api/desk/v1`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DESK_API_KEY` | Bearer secret for desk clients (**required**) |
| `UW_API_KEY_NEW` | Unusual Whales (preferred) |
| `UW_API_KEY` | Unusual Whales fallback |
| `TRADIER_API_KEY` or `TRADIER_TOKEN` | Tradier quotes fallback |
| `ALPACA_API_KEY_ID` + `ALPACA_API_SECRET_KEY` | Alpaca quotes fallback |
| `APCA_API_KEY_ID` + `APCA_API_SECRET_KEY` | Alpaca alternate names |
| `FINNHUB_API_KEY` | Symbol news (existing provider) |

Each name also accepts a `DESK_` prefix (e.g. `DESK_TRADIER_API_KEY`). Schwab market data uses the existing server token store (no desk-specific Schwab env).

## Stale thresholds (defaults)

- Quotes / SPX tape: **15s** during RTH, **120s** otherwise
- Chains / UW flow: **120s**
- News: **15 min**

Missing optional provider keys surface as `not_configured` on `/health`, not hard errors.