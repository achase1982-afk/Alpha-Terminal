# Overview

Alpha Terminal — Trading Command Center v2 is an institutional-grade, TypeScript-based trading platform for AI-assisted trading. It provides advanced trading tools, real-time market data, and AI-powered insights for options analysis, market scanning, and strategy generation, focusing on high-performance and data accuracy for professional traders. The project aims to deliver a comprehensive trading environment with AI-powered market pulse narratives, technical analysis, and strategy generation, enhancing decision-making for professional traders.

# User Preferences

I prefer concise and direct communication.
I value iterative development with frequent, small updates.
Please ask for my confirmation before making any significant changes to the codebase or architecture.
I prefer detailed explanations for complex technical decisions.
Do not make changes to files within the `lib/` directory unless explicitly instructed.
I prefer a coding style that emphasizes readability and maintainability, utilizing TypeScript's features effectively.

# System Architecture

## UI/UX Decisions

The UI features an institutional gold and pure black Bloomberg-style aesthetic with a system font stack. Key components like order pages use circular icon buttons, pill toggles, rounded cards with gradient backgrounds, gold gradient CTA buttons, Bid/Mid/Ask selectors, capsule quantity steppers, and a collapsible risk overview. The design is responsive and includes accessibility features.

## Technical Implementations

The project is a pnpm monorepo built with TypeScript. The backend uses Express 5, Zod for validation, and PostgreSQL with Drizzle ORM. Real-time L1 equity/futures quotes stream via Schwab WebSocket; portfolio data is polled from Schwab REST. IBKR is used **only** for breadth indicators ($TICK, $ADD, $TRIN, $ADVN, $DECN, $UVOL, $DVOL, $TICKI, $ADDQ, $TRINQ, $ADVNQ, $DECNQ, $UVOLQ, $DVOLQ, $PCUSEQTR, $PCUSINXR) and volatility indices ($VIX, $VVIX, $VIX1D, $VIX9D, $VIX3M, $VXN, $RVX, $OVX, $GVZ) — no equity/ETF/futures quote subscriptions go through IB. Company names come from Schwab REST. Frontend state is managed with Zustand, and `lightweight-charts` is used for charting. Authentication is handled by Clerk and Schwab OAuth 2.0. AI integration uses `claude-sonnet` and `claude-opus` for market pulse narratives, technical analysis, and options strategy generation, with user-switchable models and a robust scoring system.

Quote data retrieval uses Schwab streamer cache first, then falls back to Schwab REST, with a dedicated cache for 52-week high/low data populated asynchronously. IB cached quotes are only checked for breadth/vol symbols ($-prefixed). Options chain data is entirely Schwab WebSocket driven for market data, with the structure fetched from Schwab REST. The StrategyBuilder and other components leverage this streaming-first pattern. **Strike key normalization**: All strike prices are normalized to 2-decimal precision (`Math.round(v*100)/100`) at parse time on both server (Schwab `parseContracts`, Polygon chain parser) and client (`buildExpirationGroups` uses string keys via `toFixed(2)`). This prevents floating-point mismatches (e.g., `342.5` vs `342.50000000000003`) that cause call/put row desync, ghost 0.00 rows on ITM strikes, and -999 IV sentinel display bugs on REST refresh. The streaming store (`options-stream-store.ts`) also sanitizes IV ≤ -999 → null at merge time.

The AI Lab Deliberation System utilizes a multi-round process between an Analyst (Claude) and a Skeptic (Gemini) to refine trade ideas, logging the full conversation and decision-making process. The system includes strict validation and a structured two-step deliberation pipeline that prioritizes options-first proposals. The AI Lab operates in "Full-Universe Mode": the PREMARKET_PLAN pass gathers compact summaries for ALL 130 LC130 tickers, sends them in one `screenUniverse()` call to the analyst, who picks the best 1-3 setups. Only selected tickers then proceed through the full analyst→skeptic→deliberation pipeline. This eliminates per-ticker forced analysis and allows the AI to compare across the entire universe before committing.

The system incorporates curated symbol universes like "Liquid Core 130" for AI Lab and deterministic scanners, and a "Core Balanced 383 Universe Builder" that dynamically builds a sector-balanced, options-tradable universe from Polygon API data.

## Feature Specifications

Key features include SEC EDGAR integration, a dynamic Market Calendar, a MacroBar, an Institutional Tear Sheet, Multi-Watchlist support, and an Institutional Dashboard. The platform offers an AI Strategy Endpoint with confidence levels, a Pre-Trade Risk Manager performing 11 deterministic checks, and Conviction Sizing. Security features include Session Timeout and Biometric Authentication. A redesigned StrategyBuilder and Order Ticket UI enhance usability and functionality.

The Portfolio view supports 25 TOS-matching columns (mark, cost, qty, mktVal, plOpen, plPct, plDay, maint, netLiq, markPctChg, markChg, plYtd, tradePrice, margin, delta, extrinsic, totalCost, todayClose, yesterdayClose, expiration, bwSpx, bwSpy, instrumentType, bpEffect, bwNdx) with a full-screen Position Settings panel for drag-to-reorder, add/remove columns, and a Reset button. Columns are stored in localStorage under `alpha_visible_columns_v2` with hydration guards (dedup, valid-key filtering). Default visible columns: mark, plPct, plDay, plOpen, netLiq, markPctChg, markChg. Generic `renderCells()` pattern drives equity rows, option rows, spread summary rows, and footer totals.

The Watchlist view supports 22 TOS-matching indicators (mark, markChg, volume, rsi, pcRatio, beta, changePct, mmm, mktCap, yesterdayClose, weightedClose, pctChg20d, pctChgYtd, initMargin, divFreq, change, price, dayHigh, dayLow, open, bid, ask) with a full-screen Watchlist Settings panel for drag-to-reorder, add/remove columns, and a Reset button. Indicators are stored in localStorage under `wl_indicators_v2` with hydration guards. Default visible: change, changePct, volume, price, dayHigh, dayLow, bid, ask.

A "Discovery Mode (BETA)" scanner uses a sophisticated scoring engine with DB-backed data for faster scans, focusing on Setup Quality, Accumulation Pattern, IV Setup, Flow Divergence, and Emerging Relative Strength. **IVR persistence**: score3A and score3B read IVR from the `equity_daily.ivr` column via `fetchIvrFromDB()` (batch query), not from in-memory cache. `ivr5dAgo` is the IVR value from the row 5 trading days back in `equity_daily`. This survives server restarts. **IV30d**: Read from the most recent `equity_daily.iv_30d` row (decoupled from flow_daily_aggregates dates to avoid date mismatch nulls). **Liquidity gate**: `computeLiqFromStrikes` sanitizes corrupt Polygon snapshot bid/ask (rejects ask > bid×10 or ask > spot×2), uses widened thresholds for snapshot data (≤5%→15, ≤10%→12, ≤20%→9, ≤35%→6), and falls back to score 9 when totalOI≥5000 despite wide spreads. `returnAll` param on `/api/ai/deterministic-scan` returns full sub-score breakdown for all scored symbols. The liquidity gate in `computeLiqFromStrikes` falls back to a passing score (15) when no strikes exist in the 20-60 DTE range (e.g., historical backfill data with short DTEs only). The daily snapshot cron (`scheduleDailySnapshot`) runs at 21:30 UTC (4:30 PM ET) on trading days, calling `runFullSnapshot` for the LC130 universe. Flow backfill via `POST /api/snapshot/backfill-flow` supports resumable Polygon flow data collection. The Strategist includes a Strike Resolver to convert AI outputs into specific vertical spread trades, integrated with SSE for real-time data streaming. Diagnostic endpoints: `GET /api/ai/market-pulse/data-check` shows per-symbol data availability with Schwab cache diagnostics (subscribed symbols, cache keys, futures key map, connection state); `GET /api/ai/market-pulse/raw-debug` shows raw indicator values and null fields. Both IB and Schwab caches log periodic summaries (every 30s) showing which symbols have data.

A Notification Preferences system (store v14) gives per-event control over all 9 Schwab order event types (OrderCreated, OrderAccepted, ExecutionCreated, CancelAccepted, OrderUROutCompleted, OrderRejected, CancelRejected, OrderExpired, OrderModified). Users configure In-App and Push channels independently via the Sidebar Notifications page, with a Master Switch to disable all alerts. In-app filtering is enforced in `useMarketStream.ts` before alerts reach `OrderAlertWatcher`. Push notification server-side filtering is pending implementation.

The IV/IVR data pipeline computes implied volatility from Polygon options snapshot data stored in `options_flow_per_strike`. The `computeIVFromFlow()` function derives IV30d (ATM 20-40 DTE IV proxy), IVR (IV rank over 252 trading days), and put/call ratio for each symbol. It runs automatically during `runFullSnapshot` and can be triggered manually via `POST /api/snapshot/compute-iv`. Flow aggregates are computed from the same source via `computeFlowAggregates()` and can be recomputed via `POST /api/snapshot/recompute-aggregates`. **IVR backfill**: IVR requires 20+ historical IV data points. When backfilling, `computeIVFromFlow` must be called **chronologically for each date** (oldest→newest) so each date's IVR has enough prior IV values. The first ~20 trading dates will have IV but no IVR (insufficient lookback). From date 21+, all 130 LC130 symbols have IVR. As of Apr 2026: 43 dates (Feb 6–Apr 9) have 130/130 IVR coverage. `put_call_ratio` is now time-varying: `computeIVFromFlow` queries each date's own per-strike flow (from `options_flow_per_strike`) rather than projecting from the latest snapshot date. All 130 LC130 symbols have >1 distinct daily PCR value. For dates without per-strike flow, put_call_ratio is left unchanged.

**Database architecture**: Replit provisions separate PostgreSQL databases for dev and production (via `DATABASE_URL`). Both databases use the `helium` hostname which resolves to different physical instances per environment. The code is designed to be self-sufficient — each environment auto-populates its own data on startup via Polygon API backfill, ensuring both environments reach the same data state independently.

The equity backfill pipeline uses two Polygon-based approaches (no Schwab token needed): (1) `updateEquityDailyFromGroupedBars()` — the primary startup fast-path that calls Polygon's bulk grouped daily bars endpoint (`/v2/aggs/grouped/locale/us/market/stocks/{date}`) once per trading date, returning all US stocks in one call; 5s delay between dates to respect Polygon rate limits. (2) `backfillEquityFromPolygon()` — the legacy per-symbol backfill with 13s inter-symbol delays and 15s/30s/45s retry backoffs for Polygon's free tier. **Smart startup backfill**: On startup, `triggerLiquidCoreBackfill()` runs immediately (no Schwab token dependency) and checks `COUNT(DISTINCT date)` in equity_daily for LC130 sample symbols. If fewer than 60 dates exist (matching `ipoMinDays` scanner threshold), triggers a deep backfill of 90 trading days from Polygon grouped bars (~7.5 min). If 60+ dates exist, only fetches the last 5 days (incremental). This ensures production databases self-populate on first deploy. The `getCompactUniverseSummaries()` function filters `latestDate` to LC130 symbols only (not global max) to avoid returning empty summaries when non-LC130 symbols have more recent data. The analyst validation layer normalizes LLM-generated `timeHorizon` values (e.g., "7-14D" → "10+D") instead of rejecting them.

## System Design Choices

The monorepo structure supports shared libraries and consistent tooling. Real-time data processing is optimized through streaming and efficient state management. AI responses are grounded in fresh market data. The Market Pulse system combines deterministic scoring with AI narrative generation. IVR calculations are consistent, and a shared options chain cache reduces API calls. A Calendar-to-Strategist Event Guard System prevents conflicting strategies, and a Deterministic Strategist uses criteria-based selection. A Pulse Delta Scoring Engine provides intraday market condition analysis, and a Regime Shock Detector adjusts platform behavior during market stress. A Trade Context Journal captures order entry context, and an Exit Order Staging system manages exit orders. A Failure Telemetry System provides diagnostic logging for server-side anomalies.

# External Dependencies

-   **Claude**: `claude-sonnet` and `claude-opus` for AI functionalities.
-   **PostgreSQL**: Primary database.
-   **Drizzle ORM**: TypeScript ORM.
-   **Express**: Backend API server framework.
-   **Zod**: Schema validation.
-   **Orval**: OpenAPI spec code generator.
-   **React Query**: Data fetching and caching.
-   **Zustand**: Frontend state management.
-   **lightweight-charts**: Financial charting.
-   **technicalindicators**: Technical analysis calculations.
-   **Clerk**: App-level authentication.
-   **Interactive Brokers API** (`@stoqey/ib`): Market breadth and depth data.
-   **web-push**: Server-side Web Push notifications.
-   **SEC EDGAR API**: Public company filings data.
-   **Benzinga API**: Market data provider for news, earnings, and economic calendar.
-   **Gemini**: `gemini-2.5-flash` for AI Lab Skeptic critiques.