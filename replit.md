# Overview

This project is a pnpm workspace monorepo using TypeScript, designed as a sophisticated trading command center, "Alpha Terminal — Trading Command Center v2". Its primary purpose is to provide institutional-grade trading tools, real-time market data, and AI-powered insights to traders. The platform integrates with Schwab for data and authentication, offering features like advanced charting, options analysis, and AI-driven market scanning and strategy generation. The overarching goal is to deliver a comprehensive, high-performance trading environment with a focus on data accuracy and user experience, aiming for market leadership in AI-assisted trading platforms.

# User Preferences

I prefer concise and direct communication.
I value iterative development with frequent, small updates.
Please ask for my confirmation before making any significant changes to the codebase or architecture.
I prefer detailed explanations for complex technical decisions.
Do not make changes to files within the `lib/` directory unless explicitly instructed.
I prefer a coding style that emphasizes readability and maintainability, utilizing TypeScript's features effectively.

# System Architecture

## UI/UX Decisions

The UI adopts a Bloomberg/TOS-style institutional gold color palette, featuring a dark theme with `#0c0c0c` background, `#1a1a1a` cards, `#262626` borders, `#e4e4e7` text, and `#ffb800` as the primary accent color (Institutional Gold). Critically, the design eschews all shades of blue. Typography uses Inter font with `letter-spacing -0.025em` and `tabular-nums` for data consistency. UI components include:

-   **MacroBar**: Fixed sticky bar with clickable SPY/QQQ/IWM/VIX cards.
-   **Sidebar**: Collapsible settings panel with sections for Chart Overlays, Macro Tickers, Marquee Setup, and AI Parameters.
-   **Institutional Tear Sheet**: Full-screen overlay for detailed company financials, including a HeroHeader with live prices, TradingMetricsGrid, 52-Week Range Bar, and Institutional Ownership Card.
-   **Options Tab**: ThinkorSwim-replica options chain with `#1C1C1E` dark gray palette (no pure black), edge-to-edge layout, CALLS|gear|PUTS sticky header (h-9, z-30), sticky sub-header row (h-[22px], z-20) with scroll-synced column labels, TOS-format expiration rows (date + DTE + totalStrikes + "Weeklys" tag + atmIV% + expectedMove), compact ROW_H=40 data rows with bold white numbers, "Size: XX" / "OI: XX" sub-labels, COL_W=72 / STRIKE_W=56, ATM gold dashed line, ITM blue shading, and configurable draggable columns. Date parsing uses regex extraction for Schwab format compatibility. Weekly/monthly detection based on 3rd-Friday rule.
-   **AI Chat Overlay**: Full-screen iMessage-style chat interface for AI interaction.
-   **Live Market Pulse Modal**: Displays real-time data for 14 key symbols.
-   **Market Scanner**: AI Discovery and Manual Filter modes with configurable scan universe and sortable results.
-   **Charting**: `lightweight-charts` v5 with transparent background, gold crosshair, green/red candles, and distinct price/volume scales. Features a horizontal timeframe pill bar and a semi-transparent legend.
-   **Ticker Tape**: `requestAnimationFrame`-driven animation for smooth, flash-free scrolling.
-   **Price Pulse Animation**: CSS keyframe animation for price changes (green for uptick, red for downtick).

## Technical Implementations

-   **Monorepo**: pnpm workspaces with TypeScript 5.9.
-   **API**: Express 5 server (`artifacts/api-server`) with Zod for validation and Orval for API codegen.
-   **Database**: PostgreSQL with Drizzle ORM (`lib/db`).
-   **Real-Time Streaming**: Singleton WebSocket client (`schwabStreamer.ts`) connecting to Schwab Streamer for LEVELONE_EQUITIES and LEVELONE_OPTIONS, broadcasting live ticks to SSE clients. Features exponential backoff for reconnects. Options streaming uses per-contract Schwab symbol keys (e.g. `AAPL  260417C00200000`).
-   **Quote Data Flow**: Schwab WS → Server cache/broadcast → SSE → Zustand `streamPrices` map (equities) / `options-stream-store` (options) → `useQuote` hook / `useOptionTick` selector for UI components.
-   **Options Stream Store**: Volatile Zustand store (`options-stream-store.ts`) with per-contract `OptionTick` records and fine-grained selectors via `useOptionTick(contractKey)` for cell-level re-renders.
-   **Connection State**: 3-state `streamStatus` (`"offline"` | `"connecting"` | `"live"`) with liveness checks — status only becomes `"live"` after receiving real-time ticks, and reverts to `"connecting"` if no ticks arrive within 10 seconds.
-   **Authentication**: Schwab OAuth 2.0 with popup + polling flow, server-side token storage, CSRF protection, and auto-refresh for tokens.
-   **AI Integration**: Backend AI routes (`/api/ai/...`) for market briefing, options strategist, chat, analysis, and strategy generation. Enforces a "Strict Data Grounding Rule" for AI prompts, forbidding internal training knowledge for market predictions and requiring citation of provided context data.
-   **Technical Analysis**: `technicalindicators` npm package for RSI, EMA, etc., integrated into the strategy endpoint.
-   **State Management**: Zustand store for shared application state, with `partialize` for selective persistence.
-   **Error Handling**: React Query cancellation on query-key changes and strategist race guard.
-   **Build System**: `esbuild` for CJS bundles, `tsc --build --emitDeclarationOnly` for typechecking.

## Feature Specifications

-   **MacroBar**: Displays SPY/QQQ/IWM/VIX, clickable to set active symbol. VIX MacroCard inverts color for rising/falling fear.
-   **Institutional Tear Sheet**: Provides comprehensive fundamental and real-time quote data, with skeleton loaders for pending data.
-   **Options Chain**: Displays bid, ask, bidSize, askSize, last, volume, openInterest, delta, gamma, theta, IV. Columns are configurable and draggable. Supports ATM-centered strike slicing and ITM shading. MetricsStrip shows live computed ATM IV, Expected Move, Put/Call Volume Ratio, and Total Open Interest from the full (unsliced) chain data.
-   **AI Strategy Endpoint**: Fetches 30-day 1-minute candles, computes TA, validates data freshness, and generates strategy with Gemini, including strict data grounding.
-   **Tick Direction Coloring**: `useTickColor` hook colors last price based on immediate momentum.
-   **Search History**: Stores and displays recently viewed symbols with quick-save functionality.
-   **Indices & Futures Support**: Comprehensive support for symbols like $SPX, $VIX, /ES, /NQ across all data endpoints.

## System Design Choices

-   **Monorepo Structure**: Facilitates shared libraries and consistent tooling across `api-server`, `api-client-react`, `api-zod`, `db`, and `scripts`.
-   **TypeScript Composite Projects**: Ensures robust type-checking and efficient dependency management across packages.
-   **Separation of Concerns**: Clear boundaries between UI components, API, database, and streaming logic.
-   **Optimized Real-Time Data**: Prioritizes streamed data with REST fallback, and employs performant state management (Zustand selectors) to minimize re-renders.
-   **Strict AI Grounding**: A core design principle to prevent hallucination and ensure AI responses are based solely on provided, fresh market data.

# External Dependencies

-   **Schwab Developer API**: For OAuth, market data (quotes, historical candles, fundamentals, options chains), and streaming data.
-   **Gemini Models**: `gemini-2.5-flash` and `gemini-2.5-pro` for AI capabilities.
-   **PostgreSQL**: Relational database for persistence.
-   **Drizzle ORM**: TypeScript ORM for database interaction.
-   **Express**: Node.js web application framework for the API server.
-   **Zod**: Schema declaration and validation library.
-   **Orval**: OpenAPI spec code generator for API client and Zod schemas.
-   **React Query**: Data fetching and caching library for React.
-   **Zustand**: Fast and scalable state management solution.
-   **lightweight-charts**: Financial charting library.
-   **technicalindicators**: npm package for technical analysis calculations.
-   **bunny.net**: Content delivery network for fonts (Inter).