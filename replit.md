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

The UI adopts an institutional gold and pure black Bloomberg-style aesthetic, using the SF Mono font. It features compact and efficient designs for components like the Order Ticket and Options Chain, including interactive elements such as a Mini Payoff Diagram and AI Trade Co-Pilot panel. The layout is responsive, adapting from mobile to desktop with a two-panel structure on wider screens, and incorporates accessibility features like semantic HTML and keyboard navigation. Specific design choices include TOS-style fixed column widths for portfolio tables with horizontal scroll and sticky symbol columns.

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

### Dynamic Scanner Universe System
Three-layer universe system for the Market Scanner replacing hardcoded stock lists:
- **Presets**: Hardcoded S&P 100, S&P 500, Nasdaq 100 symbol lists served from `scanner.ts` (no JSON files to avoid bundler issues). Keys: `preset:sp100`, `preset:sp500`, `preset:ndx100`.
- **Custom Watchlists**: DB-backed (`scanner_watchlists` table) with full CRUD. "Favorites" auto-created per user. Keys: `watchlist:{id}`. WatchlistEditor modal for managing symbols with ticker search/autocomplete via `/api/scanner/search`.
- **Dynamic Screens**: DB-backed (`scanner_screens` table) with FMP screener integration. Filter criteria: market cap, volume, price, sectors, exchange, options volume. Three default screens seeded per user. 8 AM ET daily refresh scheduler. Keys: `screen:{id}`. ScreenBuilder modal for creating/editing screens.
- Frontend hook `useScannerUniverses.ts` manages all three layers with caching. localStorage watchlists are auto-synced to DB on first load.
- Routes: `/api/scanner/universes`, `/api/scanner/watchlists`, `/api/scanner/screens`, `/api/scanner/search`.

### Schwab LEVELONE_OPTIONS Streaming Field Map
The Schwab `LEVELONE_OPTIONS` service uses different field indices than `LEVELONE_EQUITIES`. Correct mapping (verified against schwab-py):
- 2=Bid, 3=Ask, 4=Last, 8=Volume, 9=OI, 10=IV, 16=BidSize, 17=AskSize, 19=NetChange, 28=Delta, 29=Gamma, 30=Theta, 31=Vega, 37=Mark.
- Field 12=ExpirationYear (NOT delta). Previous bug showed "2026.00" in delta column due to this mismatch.

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