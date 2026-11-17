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

`feed`, `source`, `last_update_ts` (UTC **ms** of last data), `age_ms`, `stale`, `stale_after_ms`, `status`, `session_date`, `asof_et`. Optional `excluded_from_health_gate` (e.g. unset `stocknews`).

Top-level `feeds_summary` aggregates `any_stale` / `any_failure` **excluding** feeds with `excluded_from_health_gate` (StockNews is optional when `STOCKNEWS_API_KEY` is unset).

**Status:** `OK`, `streaming`, `stale`, `stopped`, `evicted_yielded`, `AUTH_FAIL`, `auth_error`, `not_authorized`, `configured`, `session_closed`, `error`, `reconnecting`, `not_configured`.

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
| `alpaca`, `alpaca_paper`, `tastytrade`, `alphavantage`, `marketaux`, `stocknews`, `eodhd`, `news` | 900000 (15 min) |
| `tradier_sandbox`, `schwab2_rest` | key-only / placeholder |

`alpaca` is **news only** (not SIP/NBBO quotes).

## Endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | Feed freshness matrix + `schwab_oauth.app1` / `schwab_oauth.app2` token expiry metadata |
| GET | `/quotes?symbols=&source=` | **Required** `source`: `schwab2` (prefer app 2 creds, fallback app 1), `schwab` (same credential resolution; labels reflect app used), `tradier`, `alpaca_paper`, `tastytrade` |
| GET | `/tape/spx/stream` | SSE Schwab streamer frames `{rx_ns,c,dir?,m,session_date,rx_utc_ms}` |
| GET | `/tape/spx/raw?session_date=&since_ns=` | Filtered desk-only streamer NDJSON (`{c,rx_ns,m}`); `rx_ns` is a JSON integer; `since_ns` remains a nanosecond string for pagination |
| GET | `/gamma/live_gamma_0dte?source=unusual_whales` | Paginated UW expiry×strike gamma snapshot |
| GET | `/gamma/live_gamma?source=unusual_whales` | Paginated UW strike gamma snapshot |
| GET | `/tape/spx?since=` | Normalized in-memory ticks |
| GET | `/chains?symbol=&expiration=&source=` | Full Schwab chain (`source=schwab2` default, `source=schwab` uses app 1). **`source` required.** |
| GET | `/flow?symbol=&source=unusual_whales` | UW flow; **`source` required** |
| GET | `/bars?symbol=&source=` | **Required** `source`: `schwab2`, `schwab`, `eodhd`, `alpaca_paper` |
| GET | `/fundamentals?symbol=&source=alphavantage` | Alpha Vantage company overview (daily call budget ~25) |
| GET | `/news?symbols=&source=` | **Required** `source`: `finnhub`, `alpaca_news`, `alphavantage`, `marketaux`, `stocknews` |

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
- `LEVELONE_OPTIONS` — multi-expiry SPXW (default: all expiries within **7 calendar days**, cap **15000**)
- `OPTIONS_BOOK` — ~500 ATM (fields 0–3)

Desk **ADD** batches up to **500** symbols per request on the single streamer (never SUBS, never a second connection). Configure:

| Variable | Default |
|----------|---------|
| `DESK_TAPE_OPTIONS_EXPIRIES` | `7d` (comma list or single `YYYY-MM-DD`) |
| `DESK_TAPE_OPTIONS_MAX` | `15000` |
| `DESK_TAPE_OPTIONS_SYMBOLS` / `DESK_TAPE_OPTIONS_SYMBOLS_URL` | optional explicit symbol list |

Universe refreshes on spot moves and expiry window changes. Desk `LEVELONE_OPTIONS` uses the shared Schwab cap (`3000` minus app SUBS count minus `150` headroom) with feed-handler strike windows per expiry. `/health` → `desk_tape_universe` includes `options_by_expiry`, `desk_levelone_options_budget`, `app_levelone_options`, `app_option_symbols_sample`, and `streamer_add_rejections`.

## Environment

| Variable | Role |
|----------|------|
| `DESK_API_KEY` | Bearer secret (**required**) |
| `DESK_STREAMER_ENABLED` | Optional desk-only streamer flag (default off) |
| `DESK_TAPE_UNIVERSE_ENABLED` | Desk ADD tape universe on shared streamer (default on) |
| `UW_API_KEY_NEW` / `UW_API_KEY` | Unusual Whales |
| `TRADIER_API_KEY` / `TRADIER_TOKEN` | Tradier fallback quotes |
| `ALPACA_API_KEY_ID` + `ALPACA_API_SECRET_KEY` (or `APCA_*`) | Alpaca **news** path only |
| `ALPACA_PAPER_API_KEY_ID` + `ALPACA_PAPER_API_SECRET_KEY` | Alpaca **paper** market data (quotes/bars); no trading endpoints |
| `TASTYTRADE_CLIENT_SECRET` + `TASTYTRADE_REFRESH_TOKEN` | OAuth refresh (cached until expiry); REST quote probe; DXLink not opened on desk |
| `SCHWAB_APP_KEY_2` + `SCHWAB_APP_SECRET_2` | Market-data-only OAuth app (no streamer, no trader/account). Authorize + token exchange use the same redirect as app 1: `https://alpha-terminal-production-f297.up.railway.app/api/auth/trader-callback` (override via `SCHWAB_TRADER_REDIRECT_URI_PROD`). Standalone reconnect: `GET /api/auth/schwab2/connect` (Clerk session → Schwab). Legacy alias: `/api/auth/schwab2-callback` → `trader-callback`. |
| `ALPHAVANTAGE_API_KEY` | News + fundamentals (~25 calls/day; boot probe + on-demand only) |
| `MARKETAUX_API_KEY`, `STOCKNEWS_API_KEY` | News |
| `EODHD_API_KEY` | EOD bars (`source=eodhd`) |
| `TRADIER_SANDBOX_TOKEN` | Stored only; health `configured` / `not_configured` |
| `FINNHUB_API_KEY` | Symbol news |

Each also accepts a `DESK_` prefix. Schwab data uses the existing token store (unchanged).