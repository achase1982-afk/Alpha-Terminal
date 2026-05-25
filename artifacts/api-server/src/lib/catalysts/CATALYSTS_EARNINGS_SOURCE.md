# Catalysts earnings-date source

The **Catalysts** tab does **not** call Benzinga or Schwab on page load.

| Field | Source |
|-------|--------|
| Universe | S&P Composite 1500 (`spComposite1500Symbols.ts`) |
| `last_earnings_date` | Schwab `/quotes` fundamental (`lastEarningsDate`) — reference only, harvested weekly |
| `next_earnings_date` | **Primary:** FMP earnings calendar → `corporate_events` (backfilled for SP1500 before each harvest) |
| BMO/AMC on cards | Inferred from `corporate_events` history when consistent; otherwise omitted |
| Strategist / scanner / `/earnings-date` | `earningsService.ts` (unchanged) |

Schwab batch quotes rarely expose `nextEarningsDate`; do not rely on it for discovery coverage.

**Manual / scheduled harvest:** `pnpm run catalyst:harvest` (FMP backfill + Schwab last-date sweep + DB merge).
