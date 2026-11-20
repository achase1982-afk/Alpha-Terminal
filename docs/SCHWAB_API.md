# Schwab API access

Alpha Terminal exposes the complete Schwab Trader API – Individual surface
through authenticated server-side gateways. Existing specialized routes remain
in place.

## Capability discovery

`GET /api/schwab/capabilities`

Returns app-1/app-2 connection state, all REST namespaces and methods, every
documented streamer service, and the raw WebSocket event names. No token or app
secret is returned.

## REST invocation

`POST /api/schwab/invoke`

```json
{
  "method": "GET",
  "path": "/marketdata/v1/movers/$SPX",
  "query": {
    "sort": "PERCENT_CHANGE_UP"
  }
}
```

Allowed namespaces:

- `/marketdata/v1/` — batch/single quotes, option chains, expiration chains,
  price history, movers, market hours, instruments, and CUSIP lookup.
- `/trader/v1/` — linked accounts, balances, positions, all account/order and
  transaction queries, order preview/place/detail/replace/cancel, and user
  preferences.

Market data uses app 2 by default with app-1 fallback on an authorization
failure. Trader paths always use app 1. Pass `"app": "app1"` to explicitly use
the brokerage app for a market-data request.

The response preserves Schwab's HTTP status and important `Location` and
`Schwab-Client-CorrelId` headers. Response headers identify the app used and
whether fallback occurred.

## Streamer invocation

`POST /api/schwab/stream/invoke`

```json
{
  "service": "LEVELONE_FOREX",
  "command": "SUBS",
  "parameters": {
    "keys": "EUR/USD",
    "fields": "0,1,2,3,4,5,6,7,8"
  }
}
```

Supported services:

- `LEVELONE_EQUITIES`
- `LEVELONE_OPTIONS`
- `LEVELONE_FUTURES`
- `LEVELONE_FUTURES_OPTIONS`
- `LEVELONE_FOREX`
- `NYSE_BOOK`
- `NASDAQ_BOOK`
- `OPTIONS_BOOK`
- `CHART_EQUITY`
- `CHART_FUTURES`
- `SCREENER_EQUITY`
- `SCREENER_OPTION`
- `ACCT_ACTIVITY`
- `TIMESALE_EQUITY`
- `TIMESALE_FUTURES`
- `TIMESALE_OPTIONS`

Supported commands are `SUBS`, `ADD`, `UNSUBS`, and `VIEW`. Requests are
on-demand; Alpha Terminal does not subscribe every service at boot and consume
Schwab limits unnecessarily.

Gateway-requested services are emitted to application WebSocket clients as:

- `schwabStreamerResponse` — subscription response and entitlement errors.
- `schwabStreamerData` — raw service data.

Existing parsed quote, chart, book, time-and-sale, and account events continue
unchanged.

## Security boundary

The host is fixed to `https://api.schwabapi.com`. Only the two documented REST
namespaces and allowlisted streamer services/commands are accepted. Traversal,
arbitrary hosts, embedded query strings/fragments, and malformed parameters are
rejected. OAuth credentials remain server-side.
