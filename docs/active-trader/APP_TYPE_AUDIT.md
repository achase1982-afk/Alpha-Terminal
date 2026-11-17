# Active Trader typography & ladder audit

Measured via Playwright `getComputedStyle` on the dev fixture route (`/dev/active-trader`) in the **real Terminal shell**. Run: `node artifacts/alpha-terminal/scripts/audit-at-typography.mjs` (requires Vite on port 3000).

## Canonical styles (Options chain wins over mockup)

| Role | font-family | size | weight | letter-spacing | transform | tabular-nums | row height |
|------|-------------|------|--------|----------------|-----------|--------------|------------|
| Chain toolbar “Strike” | SF Mono stack (`optionsTheme.MONO`) | 14px | 450 | normal | none | no | 32px (`TOOLBAR_H`) |
| Expiration summary row | SF Mono | 13px / 12px label | 450 / 400 | wide on date | none | yes on stats | 32px |
| CALLS / PUTS header | SF Mono | 12px | 600 | 0.08em | uppercase | no | 32px (`HEADER_H`) |
| STRIKE subheader | SF Mono | 9px | 600 | 0.08em | uppercase | no | 20px (`SUB_HEADER_H`) |
| Column labels (Bid, Ask, …) | SF Mono | 10px | 400 | 0.08em | uppercase | no | — |
| Chain bid/ask/vol cell | SF Mono | 12px (vol) / 14px (price) | 400 | 0.01em | none | yes | 40px (`ROW_H`) |
| Chain strike pill | SF Mono | 12px | 400 | normal | none | yes | 40px |

Active Trader maps 1:1 to the above (no new font families or sizes).

## Ladder color research (pro tools → our tokens)

References: **thinkorswim** active trader / option chain, **Interactive Brokers** ladder, **Bloomberg Terminal** color discipline.

| Pattern | Industry habit | Alpha Terminal implementation |
|---------|----------------|-------------------------------|
| Put-side flow | Often magenta/cyan split; many ladders use **red/coral** for puts | **Put flow** bars use `optionsTheme.DOWN` (`#f23645`), left-aligned gradient, low-opacity track |
| Call-side flow | **Green** for call activity | **Call flow** bars use `optionsTheme.UP` (`#00d166`), right-aligned |
| Intensity | Thin gradient bars, not solid blocks | 4px bar inside 6px track, `colorcc → color22` gradient, soft glow |
| ATM / spot | Distinct strike row (gold band or outline) | ATM row: `ITM_OCEAN` wash + inset gold ring; strike column stays **chain strike pill** (`accentHex`, 12px, tabular) |
| Bid / ask | Bid red, ask green on depth ladders | Trade strip: **SELL** at bid (`DOWN`), **BUY** at ask (`UP`) |
| Position | Signed qty chip, color by direction | `+n` on `UP` tint, `−n` on `DOWN` tint, compact pill |

Mockup teal/orange call-put columns were **not** copied — the live app’s **red put / green call** convention is kept for consistency with Options chain quote colors.

## Active Trader layout (Anthony)

- **Settings collapsible** (default closed): summary row `Single · 1 · LMT mid` with chevron (matches expiration header pattern). Expanded: template, regime, filters, leg plan.
- Persisted: `localStorage` key `activeTraderSettingsPanelOpen:v1`.
- **OTO / bracket**: `atSchwabOrderBuilder.ts` — child legs default to closing instructions; validated in `AtTemplateLegPlan` + confirmation sheet (`1st` / `2nd` / `3rd` labels).

## Diff checklist (AT → chain)

| AT element | Chain reference | Status |
|------------|-----------------|--------|
| Settings summary row | `ExpirationSection` button | Chevron + 13px white |
| Ladder volumes | `PriceCell` | 12px, FW_LIGHT, tabular-nums |
| Strike column | `StrikeCell` | 12px, #000 on accent |
| Selects | Chain toolbar `SelectTrigger` | 14px, #111 bg |
| Flow colors | N/A (AT-only) | DOWN/UP tokens only |