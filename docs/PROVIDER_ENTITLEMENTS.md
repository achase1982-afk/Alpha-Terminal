# Provider entitlement gateways

Alpha Terminal exposes on-demand, server-authenticated gateways for every HTTP
endpoint offered by Alpaca, Tradier, Tastytrade, and Unusual Whales.

## API

- `GET /api/providers/{provider}/capabilities`
- `POST /api/providers/{provider}/invoke`

Providers are `alpaca`, `tradier`, `tastytrade`, and `unusual-whales`. Invoke
bodies accept `method`, `path`, `query`, `body`, and an optional `target`.
Alpaca targets are `live`, `paper`, and `market-data`; Tradier targets are
`production` and `sandbox`.

The gateway fixes each provider to its official host, validates path
namespaces and methods, injects credentials only on the API server, and
preserves upstream status and rate-limit headers. Upstream plan or entitlement
errors pass through unchanged.

Capabilities include all documented account, trading, market-data, instrument,
watchlist, analytics, and provider-specific product families. Capability
responses also list available stream families. Streaming connections remain
explicit and on demand; this change does not start polling, subscriptions, or
trades.

Provider credentials continue to come from the existing server environment:

- Alpaca: live and paper key pairs
- Tradier: production and sandbox tokens
- Tastytrade: OAuth client secret and refresh token
- Unusual Whales: API key
