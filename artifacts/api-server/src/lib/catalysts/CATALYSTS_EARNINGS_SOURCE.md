# Catalysts earnings-date source

The **Catalysts** tab does **not** call Benzinga or Schwab on page load.

| Layer | Source |
|-------|--------|
| **Universe** | Full FMP earnings calendar in harvest window → tradeability gate + options (no index gate) |
| `last_earnings_date` | Schwab `/quotes` `lastEarningsDate` (reference; weekly harvest for discovered symbols) |
| `next_earnings_date` | FMP calendar → `corporate_events` → `catalyst_earnings_dates` |
| **Harvest window** | **16 calendar days** forward (weekly sweep + 10-day tab buffer) |
| **Optional tag** | `inSp1500` on cards from `spComposite1500Symbols.ts` (display only) |
| Strategist / scanner | `earningsService.ts` (unchanged) |

**Manual harvest:** `pnpm run catalyst:harvest` (FMP backfill + Schwab last dates + feed rebuild).

`spComposite1500Symbols.ts` is retained for optional labeling only — it does **not** gate inclusion.
