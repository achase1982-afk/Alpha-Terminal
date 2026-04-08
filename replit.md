# Overview

Alpha Terminal — Trading Command Center v2 is an institutional-grade, TypeScript-based trading platform. It aims to be a leader in AI-assisted trading solutions by offering advanced trading tools, real-time market data (via IB Gateway), and AI-powered insights. Key capabilities include advanced charting, options analysis, AI-driven market scanning, and strategy generation, all within a high-performance, data-accurate environment.

# User Preferences

I prefer concise and direct communication.
I value iterative development with frequent, small updates.
Please ask for my confirmation before making any significant changes to the codebase or architecture.
I prefer detailed explanations for complex technical decisions.
Do not make changes to files within the `lib/` directory unless explicitly instructed.
I prefer a coding style that emphasizes readability and maintainability, utilizing TypeScript's features effectively.

# System Architecture

## UI/UX Decisions

The UI features an institutional gold (`#fbbf24`) and pure black (`#000000`) Bloomberg-style aesthetic, utilizing the SF Mono font with `tabular-nums`. Key components like the full-screen Order Ticket and Options Chain are designed for compactness and efficiency, with interactive elements such as a Mini Payoff Diagram and AI Trade Co-Pilot panel. The design emphasizes responsive layout, adapting from mobile to desktop with a two-panel structure on wider screens. Accessibility features include semantic HTML and keyboard navigation. Portfolio positions table uses TOS-style fixed column widths (symbol: 110px, data cols: 52-84px) with horizontal scroll, sticky symbol column, single continuous `borderRight: 2px solid #3f3f46` separator, and no column resize handles.

## Technical Implementations

The project is a pnpm monorepo built with TypeScript. The backend uses Express 5, Zod for validation, and PostgreSQL with Drizzle ORM. Real-time market data from IB Gateway is streamed via WebSocket and cached server-side, then broadcast to the frontend. Portfolio data is streamed via a server-side poller of the Schwab REST API. Frontend state is managed with Zustand, and `lightweight-charts` is used for charting. Authentication is handled by Clerk (app-level) and Schwab OAuth 2.0 (market data). AI integration leverages `claude-sonnet` and `claude-opus` for market pulse narratives, technical analysis, and options strategy generation, with user-switchable models. The Market Pulse engine uses a robust scoring system across 7 clusters for market sentiment, while the Options Strategist employs a three-layer architecture for strategy building and scoring. Technical analysis relies on the `technicalindicators` npm package, and TanStack Query caches AI results.

## Feature Specifications

Core features include SEC EDGAR integration for filings and financial data, a dynamic Market Calendar with economic events (CPI/PPI/NFP breakdown views, FOMC rate decisions with vote counts/dissenters/rate history/dot plot links) and earnings, a MacroBar, an Institutional Tear Sheet, and Multi-Watchlist support. The Institutional Dashboard offers a 6-panel grid with advanced trading metrics. AI Strategy Endpoint generates strategies with confidence levels. A Pre-Trade Risk Manager performs 11 deterministic checks on strategies, and Conviction Sizing adjusts position sizes based on multiple factors. Security is enhanced with Session Timeout and Biometric Authentication. Synthetic DXY is derived from /6E futures to provide a dollar index proxy.

## System Design Choices

The monorepo structure ensures shared libraries and consistent tooling. A clear separation of concerns is maintained across all layers. Real-time data processing is optimized through streaming and efficient state management. AI responses are strictly grounded in fresh market data, with a two-layer architecture for the Market Pulse system combining deterministic scoring with AI narrative generation.

## Server-Side Token Fallback

All market data endpoints (`/quote`, `/history`, `/options`, `/ticker-stats`) and AI endpoints (`/options-strategist`, `/options-strategist/stream`, `/deterministic-strategist`, `/deterministic-scan`, `/market-scanner`) use server-side token fallback via `getAccessToken("market")` or `getBestAccessToken()`. The client sends `accessToken || ""` — if empty, the server uses its own stored Schwab tokens from the OAuth flow. Frontend `useEffect` hooks for quote/stats fetching use `useRef` for the token to avoid re-fetch loops when the token loads asynchronously. The `/ticker-stats` endpoint is non-blocking: it returns cached chain data immediately and fires a background fetch if the cache is stale/missing, with the client retrying once after 3 seconds if IVR/EM come back null.

## Calendar-to-Strategist Event Guard System

The Calendar Event Checker (`artifacts/api-server/src/lib/calendarEventChecker.ts`) ports the frontend calendar event generation logic to the server and implements 5 event guard rules:
1. **Earnings Guard** — blocks credit/premium-selling strategies when earnings fall within DTE
2. **FOMC Guard** — blocks credit strategies when an FOMC decision or minutes fall within DTE
3. **Economic Release Guard** — blocks index credit strategies when high-impact releases (NFP, CPI, PPI, PCE, GDP) fall within DTE
4. **OpEx Guard** — warns about pin risk when OpEx/witching is within 1 trading day
5. **Ex-Div Guard** — warns about early assignment risk on short calls near ex-div dates

The checker runs after `selectStrategiesByRegime` in both `/options-strategist` and `/options-strategist/stream` endpoints. Strategies with hard blocks are removed; warnings are passed to the Claude narrative prompt via an `EVENT GUARD SYSTEM` block. The `eventGuard` payload (blockedStrategies, eventConflicts, hardBlocks, warnings) is included in all strategist responses. Holiday-aware trading day calculations ensure accurate event proximity checks. Upcoming events (next 2 trading days) are also injected into the Market Pulse narrative prompt and included in the pulse SSE data.

## Deterministic Strategist

The Deterministic Strategist (`artifacts/api-server/src/lib/deterministicStrategist.ts`) replaces the old AI-driven strategy selection with a fully deterministic, criteria-based system. It consumes scanner output, Market Pulse regime data, and the event calendar, then outputs a strategy criteria object (not contracts) plus a Claude narrative for human-readable explanation.

**4 Trading Modes:**
1. **HIGH_CONVICTION_DIRECTIONAL** (Mode 1) -- |composite| >= 0.75, confidence >= 60; full size, 21-45 DTE
2. **LOW_CONVICTION_DIRECTIONAL** (Mode 2) -- |composite| 0.30-0.75, confidence 30-60; half size, 14-21 DTE
3. **MICRO_OVERRIDE** (Mode 3) -- composite near-neutral but scanner score >= 90 with micro-override eligibility; half size, 7-21 DTE, max 2 positions
4. **HEDGING_DEFENSIVE** (Mode 4) -- shock active; defensive only, protective puts

**6 Premium Selling Gates** (all must pass for credit spreads): IVR >= 50, range-bound (within 1 ATR of SMA20), no events within DTE, Pulse not AVOID_SHORT_PREMIUM, VIX < 22, adequate options liquidity. If any gate fails, the system falls back to debit spreads.

**Volume Scoring:** The VOL cluster (0–20 pts) uses time-of-day–normalized volume. `getSessionElapsedFraction()` computes the fraction of the regular session (9:30–16:00 ET) elapsed, then projects today's partial-day volume to a full-day equivalent before comparing to the 20-day historical average. Weekend/pre-market/post-market scans use fraction = 1.0 (raw volume, no projection). Elapsed fraction is computed once per scan for deterministic consistency across all symbols.

**Endpoint:** POST `/api/ai/deterministic-strategist` -- accepts { symbol, accessToken, scannerData? }. Returns SSE stream with criteria object + Claude narrative. Non-criteria results (rejection/no-edge) return JSON.

**Frontend:** "Send to Strategist" button on scanner cards passes full candidate data to the deterministic strategist. The recommendation card shows mode badge, strategy criteria grid, premium gate pass/fail panel, event warnings, and streaming Claude narrative. A disabled "Check Live Pricing" button indicates Risk Gate is coming soon.

## Regime Shock Detector

The Regime Shock Detector (`artifacts/api-server/src/lib/regimeShockDetector.ts`) monitors 6 triggers: VIX ±20%, /ES ±2%, HYG-IEF credit spread widening >1.5σ (20-day rolling, min 5 days), SKEW drop >10pts from prior reading, ADD+ADDQ simultaneous breadth flip, and PCSPY >2σ (20-day rolling). It uses a 4-state machine: NORMAL → WARNING (2 triggers/30min) → ACTIVE (3 triggers/30min) → COOLING → NORMAL (triggers must clear for 60 continuous minutes). The detector is called after the Market Pulse engine runs and its output is included in the SSE pulse result (`shockState`, `activeTriggers`, `shockActivatedAt`, `shockActive`). When ACTIVE, the AI narrative is prepended with a shock warning, the Scanner is paused, and the Strategist forces hedging-only mode. Push notifications fire on ACTIVE entry and COOLING→NORMAL transition.

## Trade Context Journal

The Trade Context Journal (`lib/db/src/schema/index.ts` → `tradeJournal` table, `artifacts/api-server/src/routes/journal.ts`) automatically captures full market context at order entry time. When a trade is placed via the Order Ticket, `journalContext` is sent alongside the Schwab order payload and persisted to PostgreSQL with the Schwab order ID.

**Captured context:** symbol, strategy type, direction, Pulse composite/confidence/bias, IVR, scanner score, trading mode, event conflicts, entry price, credit/debit flag, max loss/gain (calculated from spread width), thesis (from Strategist narrative), and full leg data.

**Frontend:** A "Journal" tab in the Portfolio section shows all entries with stats (win rate, avg P/L, mode breakdown). Entry detail view shows full context. A "Log Result" form allows recording exit price, realized P/L, whether the plan was followed, and notes.

**API routes:** `GET /api/journal/entries`, `GET /api/journal/entries/:id`, `POST /api/journal/entries`, `PATCH /api/journal/entries/:id/result`, `GET /api/journal/stats`, `GET /api/journal/staged-exits`.

## Exit Order Staging

The Exit Order Staging system (`artifacts/api-server/src/lib/exitStaging.ts`) automatically manages exit orders for credit spread trades.

**On fill (ExecutionCreated):** When a credit spread order fills, the system looks up the journal entry, calculates a 50% profit target (buy-to-close at half the entry credit), and places a GTC exit order via Schwab API. The exit is recorded in the `staged_exits` table with idempotency guard (no duplicate exits for same entry order).

**Time stop monitoring (60s interval):** Monitors active staged exits for DTE elapsed percentage. Sends push notifications at 50% time elapsed, 75% time elapsed, and DTE-1 (expiration tomorrow).

**Stop loss alerts:** `checkStopLoss()` function sends push notification when current spread value reaches 2x entry credit. Called on demand when spread pricing is available.

**Account correctness:** The entry account hash is persisted in the journal entry and used for exit order placement, ensuring exits go to the correct account.

## Failure Telemetry System

The Failure Telemetry system (`artifacts/api-server/src/lib/telemetry.ts`) provides internal diagnostic logging for errors, failures, and anomalies across all server-side systems.

**Schema:** `failure_log` table (id, timestamp, system, severity, message, details JSONB, resolved bool, resolvedAt). 30-day auto-cleanup runs daily.

**Utility:** `logFailure(system, severity, message, details?)` — fire-and-forget (`void logFailure(...)`) writes to DB + Pino logger. If severity=CRITICAL, auto-sends push notification via `sendPushToAll()`.

**Instrumented systems:** SCHWAB_API (rate limits, non-200, options chain fails), SCHWAB_STREAM (disconnect, LOGIN fail, ACCT_ACTIVITY timeout, 5-min market-hours CRITICAL), IBKR (disconnect, breadth stale 60s market hours CRITICAL, connection failures), YAHOO (earnings fetch failures), SEC_EDGAR (insider transaction failures), SCANNER (quote batch failures, zero candidates), STRATEGIST (no mode qualified), EXIT_STAGING (order placement failures, monitor errors, stop loss errors), PUSH_NOTIFICATION (delivery failures, 410 Gone), MARKET_PULSE (Claude API failures across all AI endpoints).

**API:** GET `/api/telemetry` (filterable by system, severity, since, limit), GET `/api/telemetry/counts` (unresolved ERROR+CRITICAL count), PATCH `/api/telemetry/:id/resolve`, DELETE `/api/telemetry/clear-resolved`.

**Frontend:** TelemetryPage in Settings sidebar with AlertTriangle icon and red badge showing unresolved ERROR+CRITICAL count (polls every 30s). Table with color-coded rows (gray INFO, yellow WARN, red ERROR, pulsing red CRITICAL), system/severity filter buttons, resolve per-row, clear resolved, expandable JSON details.

# External Dependencies

-   **Claude**: `claude-sonnet-4-6-20250620` (default) and `claude-opus-4-6-20250620` for AI.
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
-   **Interactive Brokers API** (`@stoqey/ib`): Market breadth and depth data via TCP socket to IB Gateway, proxied through a Cloudflare tunnel.
-   **web-push**: Server-side Web Push notifications.
-   **SEC EDGAR API**: Public company filings data.