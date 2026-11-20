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
  "path": "/market-data/fundamentals/company-profiles/get",
  "query": {
    "symbol": "AAPL",
    "category": "US_STOCK"
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
