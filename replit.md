# Workspace

## Overview

This project is an Alpha Terminal — a trading command center designed to provide comprehensive tools for market analysis, options trading, and AI-driven insights. It leverages a pnpm workspace monorepo with TypeScript to manage various components, including a robust API server, shared libraries, and a sophisticated frontend. The core purpose is to deliver a high-performance, institutional-grade trading interface with a focus on real-time data, advanced analytics, and AI assistance, all within a Bloomberg/TOS-style aesthetic. Key capabilities include live market streaming, detailed institutional tear sheets, an interactive options chain, and AI-powered market analysis and strategy generation.

## User Preferences

- **Communication style**: I prefer concise and direct communication.
- **Coding style**: Maintain consistency with existing TypeScript and React patterns. Prioritize clear, readable code over overly clever solutions.
- **Workflow**: I prefer an iterative development approach.
- **Interaction**: Ask for confirmation before implementing significant architectural changes or refactoring large sections of code.
- **Codebase changes**:
    - Do not introduce any blue colors into the UI.
    - Ensure all AI prompts enforce strict data grounding, forbidding the use of internal training knowledge for market trends or directional calls.
    - All text using numerical data should employ `tabular-nums`.
    - Prioritize stream-first data fetching with REST fallbacks.

## System Architecture

The project is structured as a pnpm monorepo using TypeScript.

**UI/UX Decisions:**
- **Color Palette**: Bloomberg/TOS-style with a focus on "Institutional Gold" (`#ffb800`). Backgrounds are dark (`#0c0c0c`), cards are `#1a1a1a`, and text is light (`#e4e4e7`). Absolutely no blue is permitted.
- **Typography**: Inter font with `letter-spacing -0.025em` and `tabular-nums` for all numerical displays.
- **Layout**: Edge-to-edge designs for components like the options chain to maximize screen real estate.
- **Interactive Elements**: MacroBar for quick ticker switching, collapsible sidebar for settings, and full-screen overlays for detailed analysis (Institutional Tear Sheet, AI Chat).
- **Theming**: TradingChart uses a transparent background, gold crosshair, and standard green/red candles. Volume is separated from the price Y-axis.

**Technical Implementations & Feature Specifications:**

- **Schwab OAuth**: Secure popup+polling flow for authentication with CSRF protection.
- **AI Intelligence**: Features Deep Analysis (TA + Options Strategist) and an iMessage-style chat overlay. AI models (`gemini-2.5-flash`, `gemini-2.5-pro`) are used. Strict data grounding is enforced for all AI outputs.
- **Institutional Tear Sheet**: Full-screen overlay providing live quotes, trading metrics grid, 52-week range bar, and a placeholder for 13F institutional ownership data.
- **Live Market Pulse**: Modal displaying real-time data for 14 key symbols via a single Schwab API call and institutional-grade Gemini prompts.
- **Market Scanner**: AI-driven discovery and manual filtering for stocks across configurable universes.
- **Options Tab**: Institutional TOS-style options chain using a single CSS Grid with `subgrid` rows per expiration. Strike spine uses `position:sticky` with a `--strike-left` CSS custom property (set via ResizeObserver) to stay centered in the visible scroll area regardless of sidebar width. Each OptionsGrid is one `overflow-x-auto` container; cross-expiration horizontal scroll sync via `useScrollSync`. Auto-centers strike on mount by computing `idealScroll = callsWidth - strikeLeft`. Features customizable column display via drag-and-drop modal, per-cell ITM shading (`bg-[#1e293b]`), ATM dashed gold border via absolute overlay in subgrid row, and stacked sticky layers (global CALLS/gear/PUTS header → accordion buttons).
- **Real-Time Streaming**: A singleton WebSocket client (`schwabStreamer.ts`) connects to Schwab Streamer for live LEVELONE_EQUITIES data, broadcasting ticks to SSE clients. An in-memory quote cache is maintained. `useStreamingQuotes.ts` consumes SSE, updating a Zustand `streamPrices` map. `useQuote.ts` unifies quote data, falling back to REST if stream data is stale.
- **Technical Analysis**: Backend `ta.ts` uses `technicalindicators` for RSI, EMA calculations, and data freshness checks for prompt injection.
- **State Management**: Zustand for shared state, with `analysisResult`, `strategistResult`, `briefingResult` for AI outputs and `streamPrices` for real-time quotes (non-persisted).
- **Auto-Refresh**: `useAutoRefreshToken` for automatic token refresh every 25 minutes.
- **Price Visualizations**: `useTickColor` for immediate momentum coloring, `usePriceFlash` for price pulse animations, and volume histogram separation on charts.
- **Ticker Tape**: `requestAnimationFrame`-based animation for smooth, flash-free scrolling.
- **Chart Controls**: Horizontal timeframe pill bar for dynamic period/interval selection for historical data.
- **Indices & Futures Support**: Comprehensive support for symbols like `$SPX`, `$VIX`, `/ES`, `/NQ` across all data endpoints, including Schwab-specific formatting.

**System Design Choices:**
- **Monorepo Structure**: Pnpm workspaces for managing multiple packages (`api-server`, `db`, `api-spec`, `api-client-react`, `api-zod`, `scripts`).
- **TypeScript**: `composite: true` for all packages, enabling cross-package type-checking via project references.
- **API Design**: Express 5 for the API server. Routes are modular, leveraging `@workspace/api-zod` for validation and `@workspace/db` for persistence.
- **Database**: PostgreSQL with Drizzle ORM.
- **API Codegen**: Orval generates React Query hooks (`api-client-react`) and Zod schemas (`api-zod`) from an OpenAPI specification (`api-spec`).
- **Build System**: esbuild for production bundling of the API server.

## External Dependencies

- **Schwab Developer API**: Primary data source for market data, quotes, historical data, and streaming services (LEVELONE_EQUITIES WebSocket).
- **Google Gemini API**: Used for AI intelligence features (`gemini-2.5-flash`, `gemini-2.5-pro`).
- **PostgreSQL**: Relational database for persistence.
- **Drizzle ORM**: TypeScript ORM for interacting with PostgreSQL.
- **technicalindicators (npm package)**: Library for calculating technical analysis indicators.
- **Zod**: Schema declaration and validation library.
- **Orval**: OpenAPI spec code generator.
- **React Query**: Data fetching and caching library for React.
- **Zustand**: State management library.
- **Lightweight Charts v5**: Charting library for displaying financial data.
- **Express**: Web application framework for Node.js.
- **CORS**: Middleware for enabling Cross-Origin Resource Sharing.
- **pnpm**: Package manager for monorepos.
- **esbuild**: Bundler for JavaScript and TypeScript.
- **bunny.net**: Content Delivery Network (likely for font delivery, e.g., Inter).