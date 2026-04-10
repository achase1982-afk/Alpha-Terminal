# Overview

Alpha Terminal — Trading Command Center v2 is an institutional-grade, TypeScript-based trading platform designed to be a leader in AI-assisted trading solutions. It offers advanced trading tools, real-time market data, and AI-powered insights for options analysis, market scanning, and strategy generation. The platform prioritizes high-performance and data accuracy, aiming to deliver a comprehensive trading environment for professional users.

# User Preferences

I prefer concise and direct communication.
I value iterative development with frequent, small updates.
Please ask for my confirmation before making any significant changes to the codebase or architecture.
I prefer detailed explanations for complex technical decisions.
Do not make changes to files within the `lib/` directory unless explicitly instructed.
I prefer a coding style that emphasizes readability and maintainability, utilizing TypeScript's features effectively.

# System Architecture

## UI/UX Decisions

The UI adopts an institutional gold and pure black Bloomberg-style aesthetic using a system font stack (no monospace). Both the stock order page (OrderTicket.tsx) and options order page (StrategyBuilder.tsx) have been fully redesigned with: circular icon buttons, pill toggles, rounded cards with gradient backgrounds, dashed dividers, gold gradient CTA buttons (h-42, rounded-full), Bid/Mid/Ask pill selectors, capsule quantity steppers, collapsible risk overview with payoff diagram placeholder and greeks grid, rounded review modal sheet, and circular icon success/error screens. Design tokens: GOLD #f5a623, UP #2ecc71, DOWN #ff4b5c, BG #050607, CARD_GRAD linear-gradient(145deg, #111319, #080a0f), BORDER #23262c, R_CARD 14px, CTA_GRAD linear-gradient(135deg, #f5a623, #ffce73). The layout is responsive, adapting from mobile to desktop with a two-panel structure on wider screens, and incorporates accessibility features like aria-labels on icon-only buttons, semantic HTML, and keyboard navigation. Specific design choices include TOS-style fixed column widths for portfolio tables with horizontal scroll and sticky symbol columns.

## Technical Implementations

The project is a pnpm monorepo built with TypeScript. The backend utilizes Express 5, Zod for validation, and PostgreSQL with Drizzle ORM. Real-time market data from IB Gateway is streamed via WebSocket and cached server-side, then broadcast to the frontend. Portfolio data is streamed via a server-side poller of the Schwab REST API. Frontend state is managed with Zustand, and `lightweight-charts` is used for charting. Authentication is handled by Clerk (app-level) and Schwab OAuth 2.0 (market data). AI integration leverages `claude-sonnet` and `claude-opus` for market pulse narratives, technical analysis, and options strategy generation, with user-switchable models. The Market Pulse engine uses a robust scoring system across 7 clusters for market sentiment.

## Feature Specifications

Key features include SEC EDGAR integration, a dynamic Market Calendar with economic events and earnings, a MacroBar, an Institutional Tear Sheet, and Multi-Watchlist support. The Institutional Dashboard provides a 6-panel grid for advanced trading metrics. An AI Strategy Endpoint generates strategies with confidence levels. A Pre-Trade Risk Manager performs 11 deterministic checks on strategies, and Conviction Sizing adjusts position sizes. Security features include Session Timeout and Biometric Authentication. Synthetic DXY is derived from /6E futures.

### Order Page Overhaul (7 Parts Complete)
The StrategyBuilder order page was overhauled across 7 parts:
1. **Bug Fixes**: Limit order always includes price, DTE uses UTC midnight parsing with fallback, IV normalized to percentage with >500% warning.
2. **Strategy Name Detection**: `detectStrategyType()` covers all major strategies (bull put, bear call, iron condor, calendar, diagonal, butterfly, straddle, strangle, naked, custom). Displayed prominently with color coding.
3. **Risk Warnings**: Wide bid-ask per-leg inline warning (>200% of mid), insufficient Greeks warning, naked position red banner.
4. **Visual Hierarchy**: Greek symbols → words (Delta/Gamma/Theta/Vega), Net Credit/Max Risk prominent (18px), quantity presets [1,5,10,25], Advanced Settings collapsible, Pre-Trade Risk below AI Co-Pilot (collapsed by default).
5. **Real-Time Greeks/Metrics**: All metrics recalculate reactively via useMemo when legs/strikes/quantity change.
6. **Roll & Close Position Flows**: Close populates inverse legs with mid price. Roll opens close order then navigates to options chain for new position. Confirmation modal shows "Confirm Close" with CLOSE labels.
7. **Strategist Greeks Integration**: `LegPayload` includes gamma/theta/vega alongside delta. System prompt has delta-based strike selection rules (30Δ credit spreads, 16Δ iron condors, 45-50Δ debit spreads, 50Δ calendars). Strategist card shows all Greeks per leg.

### Scanner Universe & Watchlist Overhaul (April 2026)

- **Mid-Cap 200 preset** added to `PRESET_UNIVERSES` in `scanner.ts` — ~200 options-liquid US mid-cap stocks ($2B–$10B) across tech, healthcare, consumer, finance, industrials, energy/materials, and real estate.
- **Auto-watchlist universe** changed from `sp100` → `sp500` — Top Movers Today, Volume Surge, and High Volatility now screen the full S&P 500 (493 symbols) instead of just S&P 100.
- **topN** increased from 20 → 50 in `schwabDynamicScreener.ts` (default) and in the refresh-auto-watchlists route.
- **FMP screener fallback** added via `runScreenWithFallback()` in `scanner.ts` — when `FMP_API_KEY` is not configured, dynamic screens (Mid Cap Movers, Large Cap Liquid, High IV Opportunity) automatically use a Schwab-based screener on the appropriate preset universe (midcap200 for cap-constrained screens, sp500 otherwise). Logged with `usedFallback: true`.
- **Default scanner universe** in MarketScanner.tsx changed from `preset:sp100` → `preset:sp500`.
- **Jumpiness fix**: `setDetResult(null)` and `setManualQuotes([])` removed from scan initiation — previous results remain visible while rescanning. A slim "RESCANNING N TICKERS" banner shows instead of the full spinner overlay.

### Scanner V2 — Discovery Mode (BETA)

New scoring engine in `deterministicScanner.v2.ts` implementing the Discovery Mode spec. Runs alongside the original Momentum preset (v1 preserved in `deterministicScanner.ts`).

**5 scoring categories (100 pts total, threshold: 55):**
- **Setup Quality** (20 pts): 1A=proximity to SMA20 (7pt), 1B=ATR5/ATR20 compression ratio (7pt), 1C=Pulse bias vs price position (6pt)
- **Accumulation Pattern** (15 pts): 2A=vol5d/vol20d ratio 1.2-2.0x (6pt), 2B=VR + price range flat (5pt), 2C=OBV 10d slope normalized vs price (4pt)
- **IV Setup** (25 pts): 3A=IVR level (7pt), 3B=IVR 5-day change — tracked via rolling cache (10pt), 3C=IV30d/HV20d ratio — earnings capped (8pt)
- **Flow Divergence** (25 pts): 4A=notional-weighted vol/OI (8pt), 4B=abs(call-put)/total skew (5pt), 4C=block trade count (5pt), 4D=flow direction vs price direction (7pt)
- **Emerging RS** (15 pts): 5A=RS ratio 5d vs 20d slope (8pt), 5B=ticker 5d vs sector ETF 5d (7pt)

**Key features:**
- **DB-backed data (T003 refactor):** Scanner reads equity history from `equity_daily` table and flow data from `flow_daily_aggregates` + `options_flow_per_strike` tables in batch SQL queries. Only live Schwab quotes used for current prices. Eliminates per-symbol API calls — 30-symbol scan completes in ~400ms.
- Backfill endpoints populate snapshot tables: `/api/snapshot/backfill` (equity, 62 trading days) and `/api/snapshot/backfill-flow` (Polygon options, configurable days).
- Universe expanded to 370 symbols via `getDefaultUniverse()` in `snapshot.ts`.
- OBV computed from daily candles via linear regression slope
- HV20d from stdev of log returns × √252
- IVR estimated from rolling IV30d percentile cache (improves accuracy over time)
- IVR 5-day change tracked via module-level timestamp cache
- 11 GICS sector ETFs subscribed for RS comparison (XLK, XLF, XLE, XLV, XLI, XLC, XLY, XLP, XLU, XLRE, XLB)
- Directional lean (BULLISH/BEARISH/MIXED) shown per candidate card
- Flow N/A renormalization: `(SQ+ACC+IV+RS)/75*100` when flow data unavailable from DB
- Earnings within 14d: caps 3B (max 4) and 3C (max 3)
- IPO < 60 trading days and price < $10 excluded
- Micro-override still fires at score >= 90

**Migration:**
- `/api/ai/deterministic-scan` accepts `scanMode: "DISCOVERY" | "MOMENTUM"` (default: "DISCOVERY")
- MarketScanner UI shows DISCOVERY BETA / MOMENTUM toggle above scan button
- Score bars dynamically switch to show correct V2 categories (SETUP/ACCUM/IV SET/FLOW/RS)
- Directional lean badge (green BULLISH / red BEARISH / gold MIXED) shown next to score
- "Flow data unavailable" notice when Polygon data missing (score renormalized)
- Results header shows "DISCOVERY BETA" or "MOMENTUM" badge

### Collapsed Scanner Cards & ETF Filtering (April 2026)
- **Collapsed by default**: `DeterministicCard` renders as a single-row summary showing rank, ticker (clickable to navigate), sector, micro-override shield icon, directional lean badge, price/change%, IVR, score, and expand chevron. Clicking anywhere on the row expands to reveal score breakdown bars, detailed stats, upcoming events, and "Send to Strategist" button.
- **Scan reset**: Cards auto-collapse when `scanTimestamp` changes (new scan results), preventing stale expanded state.
- **ETF exclusion**: `EXCLUDED_ETFS` set in `deterministicScanner.v2.ts` reduced to ~30 leveraged/inverse ETFs only (SQQQ, TQQQ, SOXL, LABU, etc.). Liquid index/sector ETFs (SPY, QQQ, IWM, SOXX, XLF, GLD, etc.) now pass through the scanner.
- **Universe deduplication**: `getDefaultUniverse()` in `snapshot.ts` uses a Set-based dedup filter to prevent duplicate symbols causing redundant API calls and DB writes.

### Telemetry Overhaul — Feature-Grouped Collapsible Logs (April 2026)
- **Backend**: `TelemetryEvent` now has `feature` and `batchId` fields. `createTelemetryBatch(feature)` generates unique batch IDs per feature run. `getGroupedEvents()` groups entries by batchId and returns `{ groups, ungrouped }`. API route supports `?grouped=true`.
- **Callers updated**: Market Pulse (`ai.ts`), Strategist (`ai.ts`), Discovery Scanner v2 (`deterministicScanner.v2.ts`), and Momentum Scanner v1 (`deterministicScanner.ts`) all emit telemetry with feature + batchId tags.
- **Frontend**: `TelemetryPage.tsx` fully redesigned with collapsible batch rows showing feature label (MARKET PULSE, SCANNER, STRATEGIST), timestamp, entry count, summary, error/warn badges, and system tags. Expandable to individual entries with severity-colored left borders, full message text (no truncation), and expandable JSON details. Mobile-first: `whiteSpace: pre-wrap`, `wordBreak: break-word`, no `maxHeight` or `textOverflow ellipsis`. Filters: system buttons with unread badges, severity toggles, show-resolved checkbox, auto-refresh toggle (3s interval). Batch timestamp uses latest event for recency sorting.

### Dynamic Scanner Universe System
Three-layer universe system for the Market Scanner replacing hardcoded stock lists:
- **Presets**: Hardcoded S&P 100, S&P 500, Nasdaq 100 symbol lists served from `scanner.ts` (no JSON files to avoid bundler issues). Keys: `preset:sp100`, `preset:sp500`, `preset:ndx100`.
- **Custom Watchlists**: DB-backed (`scanner_watchlists` table) with full CRUD. "Favorites" auto-created per user. Keys: `watchlist:{id}`. WatchlistEditor modal for managing symbols with ticker search/autocomplete via `/api/scanner/search`.
- **Dynamic Screens**: DB-backed (`scanner_screens` table) with FMP screener integration. Filter criteria: market cap, volume, price, sectors, exchange, options volume. Three default screens seeded per user. 8 AM ET daily refresh scheduler. Keys: `screen:{id}`. ScreenBuilder modal for creating/editing screens.
- Frontend hook `useScannerUniverses.ts` manages all three layers with caching. localStorage watchlists are auto-synced to DB on first load.
- Scanner watchlists are surfaced in the regular WatchlistView dropdown (under "Scanner Watchlists" section). When selected, symbols are synced to a local watchlist keyed as `scanner_{id}` with `[S]` prefix in name.
- Routes: `/api/scanner/universes`, `/api/scanner/watchlists`, `/api/scanner/screens`, `/api/scanner/search`.

### Discovery V2 Snapshot Pipeline (April 2026)

Daily snapshot-based data architecture for Discovery scanner scoring. Scanner reads from persisted snapshots, NOT real-time API calls.

**7 Database Tables:**
1. `equity_daily` — OHLCV + IVR/IV/HV + derived fields (SMA20, ATR5/20, OBV, RS ratio, median volumes, price change %) per symbol per day. 60-day retention. Unique on (symbol, date).
2. `options_chain_daily` — Full Schwab chain per strike/expiry/day (bid/ask/mid/last/volume/OI/IV/greeks). 20-day retention. Unique on (underlying, date, type, strike, expiration).
3. `options_flow_per_strike` — Polygon flow per strike/expiry/day (volume, OI, avg trade price). 20-day retention.
4. `options_flow_raw_trades` — Individual Polygon trade prints for block/sweep detection. 20-day retention.
5. `flow_daily_aggregates` — Computed per symbol per day: call/put volume, vol/OI ratio, PC skew, block count, flow direction (BULLISH/BEARISH/NEUTRAL), 20d rolling notional avg. 60-day retention.
6. `reference_data` — Sector ETF mapping, ADR flag, IPO date. Permanent.
7. `corporate_events` — Earnings dates/timing, split dates. Rolling 90 days.
8. `snapshot_collection_log` — Tracks collection runs (status, row counts, errors).

**Collection Pipeline (`dailySnapshot.ts`):**
- `collectEquitySnapshots()` — Schwab quotes + price history → Table 1 with all derived fields
- `collectOptionsChainSnapshots()` — Schwab chains + Polygon IV enrichment → Table 2
- `collectPolygonFlowFromAPI()` — Polygon options snapshots → Table 3
- `computeFlowAggregates()` — Aggregates from Table 3 → Table 5
- `runFullSnapshot()` — Orchestrates all above, logs to Table 8
- `backfillPolygonFlow()` — Historical flow backfill via Polygon REST API (slow, per-contract)

**Polygon Flat Files (`polygonFlatFiles.ts`):**
- **Source**: Polygon S3 flat files (`us_options_opra/day_aggs_v1`). One bulk download per trading day covers ALL symbols.
- **Requires**: `POLYGON_S3_ACCESS_KEY` + `POLYGON_S3_SECRET_KEY` (separate from `POLYGON_API_KEY`).
- **Writes to**: `polygon_options_history` table (separate from `options_flow_per_strike`).
- **Functions**: `syncDate()`, `syncDateRange()`, `getSyncStatus()`.
- **Important**: Options flow backfill data comes from Polygon, NOT Schwab. The backfill endpoint `/api/snapshot/backfill-flow` uses only `POLYGON_API_KEY`.

**API Routes (`/api/snapshot/`):**
- `GET /status` — Latest 5 collection runs
- `POST /collect` — Full snapshot (async background), requires `x-access-token` header
- `POST /equity-only` — Equity data only
- `POST /flow-only` — Polygon flow + aggregates only

**Scanner reads from snapshots** — Discovery scoring categories (Setup Quality 20pt, Accumulation 15pt, IV Setup 25pt, Flow Divergence 25pt, Emerging RS 15pt) consume Tables 1+5 instead of live API calls.

### Schwab LEVELONE_OPTIONS Streaming Field Map
The Schwab `LEVELONE_OPTIONS` service uses different field indices than `LEVELONE_EQUITIES`. Correct mapping (verified against schwab-py):
- 2=Bid, 3=Ask, 4=Last, 8=Volume, 9=OI, 10=IV, 16=BidSize, 17=AskSize, 19=NetChange, 28=Delta, 29=Gamma, 30=Theta, 31=Vega, 37=Mark.
- Field 12=ExpirationYear (NOT delta). Previous bug showed "2026.00" in delta column due to this mismatch.

### Strategist Strike Resolution & Send to Order
The Deterministic Strategist now resolves abstract engine output into specific vertical spread trades:
- **Strike Resolver** (`strikeResolver.ts`): Full pipeline — input validation → expiration selection (DTE + earnings exclusion) → delta-targeted strike selection → width-leg snap → pricing → conviction sizing → P/L calculation → schema validation. Supports 4 verticals: BULL_CALL_SPREAD, BEAR_PUT_SPREAD, BULL_PUT_SPREAD, BEAR_CALL_SPREAD. Unsupported strategies return structured "coming soon" fallback.
- **SSE Integration** (`ai.ts`): After engine criteria, fetches chain via `getOrFetchChain`, builds `AccountSnapshot`, calls `resolveStrikes()`, streams `resolvedTrade` or `resolutionError` SSE events, and injects resolved data into Claude prompt for narrative.
- **Frontend Display** (`AiIntelligenceTab.tsx`): `DetCriteriaCard` shows specific strikes/pricing/sizing when resolved, or falls back to abstract criteria. Gold "Send to Order" CTA button when trade is resolved.
- **Send to Order Flow** (`Terminal.tsx`): `handleSendToOrder` maps ResolvedTrade legs → StrategyLeg[] and opens StrategyBuilder pre-populated with symbol, expiration, strikes, and quantities.
- **Chain Source Banner**: When chain data is from previous close (pre-market/after-hours), a banner warns that prices may differ at open.

### Order Ticket UI Overhaul (Stock Redesign + Options Polish + Functional Fixes)
Comprehensive overhaul of `OrderTicket.tsx` covering three areas:
- **Stock Page Redesign**: Matched to options page design system — gold ticker symbol, prominent green/red Buy/Sell toggle (solid fill when active), matching card backgrounds (CARD_GRAD), consistent font hierarchy via centralized `S` scale object, Bid/Mid/Ask pill selectors, tighter density with reduced gaps/padding.
- **Options Page Polish**: All font sizes bumped +1pt via mode-aware `S` scale (options: body 14, label 13, section 15, price 17; stock: body 13, label 12, section 14, price 16). Greeks display compact single-row.
- **Functional Fixes**: (1) Review button NEVER disabled by risk status — `blockedByRisk` removed from `isValid`. (2) Options/Stock toggle is functional — `onSwitchToStock`/`onSwitchToOptions` callbacks preserve full options context (strategy legs, single-option symbol, net price, credit flag) in `savedOptionsCtxRef` and restore when toggling back. (3) Both pages fit core content on one screen via density improvements.

## System Design Choices

The monorepo structure facilitates shared libraries and consistent tooling. A clear separation of concerns is maintained across all layers. Real-time data processing is optimized through streaming and efficient state management. AI responses are strictly grounded in fresh market data. The Market Pulse system uses a two-layer architecture combining deterministic scoring with AI narrative generation. IVR calculations are consistent across the platform using a single `computeIVR()` function. The Strategist Command Bar obtains IVR, Put/Call ratio, and Market Maker Move from the Schwab options chain. Server-side token fallback ensures robust market data fetching. The options chain is strike-centered around the underlying price server-side for consistent strike displays. A shared options chain cache improves performance by reducing duplicate Schwab API calls. A Calendar-to-Strategist Event Guard System implements 5 rules to block or warn about strategies conflicting with upcoming market events. The Deterministic Strategist replaces AI-driven strategy selection with a criteria-based system, featuring 4 trading modes and 6 premium selling gates. A Pulse Delta Scoring Engine provides a secondary scoring system for intraday market condition changes. A Regime Shock Detector monitors market triggers and adjusts platform behavior (e.g., pausing scanner, forcing hedging-only mode) during periods of market stress. A Trade Context Journal automatically captures market context at order entry. An Exit Order Staging system automatically manages exit orders for credit spreads, including profit targets and time stop monitoring. A Failure Telemetry System provides internal diagnostic logging for server-side errors and anomalies.

# External Dependencies

-   **Claude**: `claude-sonnet` and `claude-opus` for AI.
-   **PostgreSQL**: Database.
-   **Drizzle ORM**: TypeScript ORM.
-   **Express**: API server framework.
-   **Zod**: Schema validation.
-   **Orval**: OpenAPI spec code generator.
-   **React Query**: Data fetching and caching.
-   **Zustand**: State management.
-   **lightweight-charts**: Financial charting.
-   **technicalindicators**: Technical analysis calculations.
-   **Clerk**: App-level authentication.
-   **Interactive Brokers API** (`@stoqey/ib`): Market breadth and depth data.
-   **web-push**: Server-side Web Push notifications.
-   **SEC EDGAR API**: Public company filings data.
-   **Benzinga API**: Comprehensive market data provider. Key: `BENZINGA_API_KEY`. Endpoints integrated:
    - **News**: Primary news source with ticker associations; dedup priority over Finnhub/Polygon.
    - **Earnings Calendar**: Bulk earnings with date/timing/EPS/revenue for 29 major tickers. Yahoo fallback.
    - **Economic Calendar**: Importance≥3 US macro events (CPI, FOMC, NFP, etc.) with 6hr cache. Replaces hardcoded FOMC/economic events in MarketCalendar when available.
    - **Analyst Ratings**: Recent upgrades/downgrades/initiations with price targets (2hr cache, symbol-filterable). Displayed in CompanyResearchHub.
    - **Analyst Insights**: Per-symbol AI-generated analyst sentiment summaries. Shown alongside ratings.
    - **Conference Calls**: 3-month lookahead with webcast URLs.
    - **Strategist Integration**: Upcoming economic catalysts (14-day window) and recent analyst ratings for the target symbol are injected into both the regular and streaming strategist prompts, so the AI factors macro events and analyst sentiment into trade recommendations.