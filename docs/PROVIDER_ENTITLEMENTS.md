# Provider entitlement gateways

Alpha Terminal exposes on-demand, server-authenticated gateways for every HTTP
endpoint offered by Alpaca, Tradier, Tastytrade, and Unusual Whales.

## API

- `GET /api/providers/{provider}/capabilities`
- `POST /api/providers/{provider}/invoke`

Providers are `alpaca`, `tradier`, `tastytrade`, and `unusual-whales`. Invoke
bodies accept `method`, `path`, `query`, `body`, and an optional `target`.
Alpaca targets are `live`, `paper`, and `market-data`; Tradier targets are
`production`, `sandbox`, and `stream`.

The gateway fixes each provider to its official host, validates path
namespaces and methods, injects credentials only on the API server, and
preserves upstream status and rate-limit headers. Upstream plan or entitlement
errors pass through unchanged.

The path prefix is the only allow rule. `products` names families so they stay
visible. An informational route that is not named there is still forwarded
when its path is under the provider prefix. Alpaca crypto reads use
`/v1beta3/` on the `market-data` target. Tradier fundamentals, dividends,
corporate actions, ratios, financials, and statistics are `/v1/` reads on
`production` or `sandbox`. Tradier market and account session streams use
target `stream` (`https://stream.tradier.com`).

Capability responses also list available stream families. Streaming connections
remain explicit and on demand; this change does not start polling,
subscriptions, or trades.

Provider credentials continue to come from the existing server environment:

- Alpaca: live and paper key pairs
- Tradier: production and sandbox tokens
- Tastytrade: OAuth client secret and refresh token
- Unusual Whales: API key
