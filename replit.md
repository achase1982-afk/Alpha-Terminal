# Overview

This project, "Alpha Terminal — Trading Command Center v2," is a pnpm workspace monorepo using TypeScript, designed to be an institutional-grade trading platform. It provides advanced trading tools, real-time market data, and AI-powered insights, integrating with Schwab for data and authentication. Key capabilities include advanced charting, options analysis, and AI-driven market scanning and strategy generation. The platform aims to offer a comprehensive, high-performance trading environment with a focus on data accuracy and user experience, striving for market leadership in AI-assisted trading solutions.

# User Preferences

I prefer concise and direct communication.
I value iterative development with frequent, small updates.
Please ask for my confirmation before making any significant changes to the codebase or architecture.
I prefer detailed explanations for complex technical decisions.
Do not make changes to files within the `lib/` directory unless explicitly instructed.
I prefer a coding style that emphasizes readability and maintainability, utilizing TypeScript's features effectively.

# System Architecture

## UI/UX Decisions

The UI features a Bloomberg/TOS-style institutional gold color palette with a dark theme (no blue shades), Inter font, and `tabular-nums`. Key components include a fixed MacroBar, a collapsible Sidebar, an Institutional Tear Sheet for detailed financials, and a ThinkorSwim-replica Options Tab with a dark gray palette, sticky headers, and configurable columns. Other UI elements are an AI Chat Overlay, Market Pulse Dashboard (structured JSON-driven AI analysis embedded in AI tab with bias strip, cluster cards, action plan, and invalidation box), Market Scanner, `lightweight-charts` based Charting, a `requestAnimationFrame`-driven Ticker Tape, and CSS keyframe Price Pulse Animations.

## Technical Implementations

The project is a pnpm monorepo with TypeScript. The API is an Express 5 server using Zod for validation and Orval for codegen. PostgreSQL with Drizzle ORM is used for the database. Real-time streaming is handled by a singleton WebSocket client connecting to Schwab Streamer, which broadcasts live ticks to the frontend via a second WebSocket server at `/ws/prices` (authenticated via Clerk token in query string). On connect, the server sends a full cache snapshot; subsequent ticks arrive in real-time with zero delay. The frontend auto-reconnects with exponential backoff (1s→30s cap). Quote data flows from Schwab WS → server cache → frontend WS → Zustand stores → UI hooks. Options streaming uses volatile Zustand storage with fine-grained selectors. Connection state is managed via streamerStatus WS events with auto-recovery for token expiration.

Authentication combines Clerk for app-level login and Schwab OAuth 2.0 for Market Data and Accounts & Trading APIs, with a chained single-login flow. Schwab tokens are persisted server-side in `.data/schwab-tokens.json` and auto-refreshed proactively. Market News is sourced from Finnhub and Polygon.io, merged and deduplicated. An in-app article reader uses a server-side proxy to fetch and clean HTML content. Earnings dates are fetched from Yahoo Finance. AI integration uses Gemini models (`gemini-2.5-flash` and `gemini-2.5-pro`) with strict data grounding rules for market briefing, options strategy, and technical analysis. Technical analysis uses the `technicalindicators` npm package. Zustand is used for state management, with React Query for data fetching and error handling. The build system uses `esbuild` and `tsc`.

## Feature Specifications

Features include a MacroBar displaying key indices, an Institutional Tear Sheet for fundamental data, and an Options Chain with bid/ask, Greeks, configurable columns, ATM-centered strike slicing, and a MetricsStrip. The AI Strategy Endpoint generates strategies based on historical data and TA, with mandated `aiConfidence` levels. `useTickColor` provides price momentum coloring. Search History stores recent symbols. Comprehensive support for Indices & Futures is integrated across all data endpoints, including index options and futures options.

## System Design Choices

The monorepo structure facilitates shared libraries and consistent tooling. TypeScript Composite Projects ensure robust type-checking. A clear separation of concerns is maintained across UI, API, database, and streaming logic. Real-time data is optimized through streamed data with REST fallback and performant state management. Strict AI grounding is a core principle to ensure AI responses are based solely on provided, fresh market data. The Market Pulse system uses a dedicated `/api/ai/market-pulse` endpoint that returns strict JSON (bias, clusters, action plan, invalidation) instead of markdown, with a dedicated Zustand store (`marketPulseStore`) and component suite in `components/pulse/`. The bias strip (`AiBiasStrip`) is persistently visible below the MacroBar. Market Pulse settings (auto-refresh, risk tolerance, bias strip toggle) are in the Sidebar settings panel.

# External Dependencies

-   **Schwab Developer API**: OAuth, market data (quotes, candles, fundamentals, options chains), and streaming.
-   **Gemini Models**: `gemini-2.5-flash` and `gemini-2.5-pro` for AI capabilities.
-   **PostgreSQL**: Database.
-   **Drizzle ORM**: TypeScript ORM.
-   **Express**: API server framework.
-   **Zod**: Schema validation.
-   **Orval**: OpenAPI spec code generator.
-   **React Query**: Data fetching and caching.
-   **Zustand**: State management.
-   **lightweight-charts**: Financial charting.
-   **technicalindicators**: Technical analysis calculations.
-   **bunny.net**: CDN for fonts.
-   **Clerk**: App-level authentication.