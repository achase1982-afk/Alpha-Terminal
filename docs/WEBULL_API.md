# Webull API access

Alpha Terminal exposes every HTTP endpoint granted to its Webull application
under the current Webull Trading API and Market Data API namespaces.

## Capability discovery

`GET /api/webull/capabilities`

This reports whether Webull is configured and connected, the supported HTTP
methods, the allowed upstream namespaces, and the server-managed token routes.
Credentials and access tokens are never returned.

## Invoke an entitled endpoint

`POST /api/webull/invoke`

```json
{
  "method": "GET",
  "path": "/market-data/stocks/snapshots/list",
  "query": {
    "symbols": "AAPL",
    "category": "US_STOCK",
    "extend_hour_required": "true",
    "overnight_required": "true"
  }
}
```

The gateway accepts every path under the two prefixes below. The category lists are a catalog, not a block list.

The gateway supports all documented HTTP methods for paths under:

- `/market-data/` — stocks, options, futures, crypto, event contracts, news,
  screeners, watchlists, fundamentals, funds, calendars, and subscription
  controls.
- `/trading/` — accounts, balances, positions, activities, transfers,
  instruments, order previews, placement, batch placement, replacement,
  cancellation, open orders, history, and order detail.

## Live quotes

Connecting Webull used to load accounts, balances, positions, and orders only.
The server now polls `GET /market-data/stocks/snapshots/list` for the symbols
the terminal is streaming (plus the core tape ETFs) and publishes those
snapshots on the same quote stream as Schwab.

Webull prints fill a symbol when Schwab or IBKR has no fresh quote. A quote
younger than 15 seconds from those feeds is left in place. Stock and ETF
symbols are requested with `category=US_STOCK` and `category=US_ETF`. The
trading access token is sent because market-data reads require it when the
app has 2FA enabled. The OpenAPI market-data subscription is separate from a
Webull app or desktop quote purchase; without that API entitlement the
snapshot call is rejected and account routes still succeed.

For endpoints with a JSON request body:

```json
{
  "method": "POST",
  "path": "/trading/orders/preview",
  "body": {
    "account_id": "WEBULL_ACCOUNT_ID",
    "new_orders": []
  }
}
```

Query arrays may be sent as arrays or comma-separated strings. Alpha Terminal
adds HMAC signing, `x-version: v3`, and the persisted `x-access-token`
server-side.

## Accounts

No account ID is hardcoded. Every account returned by
`/trading/accounts/list` can be supplied as `account_id`, so newly authorized
accounts automatically receive the same endpoint coverage. Webull remains the
source of truth for which product entitlements each account and application
may use.

## Security boundary

The upstream host is fixed to `https://api.webull.com`. Only `/market-data/`
and `/trading/` paths are accepted; traversal, arbitrary hosts, query strings
inside paths, fragments, and unsupported methods are rejected. The Webull app
secret and access token never leave the API server.
