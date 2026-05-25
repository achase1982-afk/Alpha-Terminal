# Catalysts earnings-date source

The **Catalysts** tab does **not** call Benzinga or Schwab on page load.

| Layer | Source |
|-------|--------|
| Universe | S&P Composite 1500 (`spComposite1500Symbols.ts`) |
| Dates | `catalyst_earnings_dates` — weekly paced Schwab `nextEarningsDate` harvest |
| BMO/AMC | Inferred from `corporate_events` history when consistent; otherwise omitted |
| Strategist / scanner / `/earnings-date` | `earningsService.ts` (vendor calendar → FMP DB → Finnhub) |

This is intentional: Catalysts needs a bounded, quality-screened universe and broker-aligned dates without bulk calendar truncation. Per-symbol flows keep the shared resolver until that table is wired in as an optional `earningsService` source.
