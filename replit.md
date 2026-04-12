# Overview

Alpha Terminal — Trading Command Center v2 is an institutional-grade, TypeScript-based trading platform for AI-assisted trading. It provides advanced trading tools, real-time market data, and AI-powered insights for options analysis, market scanning, and strategy generation, focusing on high-performance and data accuracy for professional traders.

# User Preferences

I prefer concise and direct communication.
I value iterative development with frequent, small updates.
Please ask for my confirmation before making any significant changes to the codebase or architecture.
I prefer detailed explanations for complex technical decisions.
Do not make changes to files within the `lib/` directory unless explicitly instructed.
I prefer a coding style that emphasizes readability and maintainability, utilizing TypeScript's features effectively.

# System Architecture

## UI/UX Decisions

The UI features an institutional gold and pure black Bloomberg-style aesthetic with a system font stack. Order pages (OrderTicket.tsx and StrategyBuilder.tsx) use circular icon buttons, pill toggles, rounded cards with gradient backgrounds, gold gradient CTA buttons, Bid/Mid/Ask selectors, capsule quantity steppers, and a collapsible risk overview. The design is responsive, adapting from mobile to desktop, and includes accessibility features like aria-labels and keyboard navigation.

## Technical Implementations

The project is a pnpm monorepo using TypeScript. The backend employs Express 5, Zod for validation, and PostgreSQL with Drizzle ORM. Real-time market data from IB Gateway is streamed via WebSocket and broadcast to the frontend, while portfolio data is polled from the Schwab REST API. Frontend state is managed with Zustand, and `lightweight-charts` is used for charting. Authentication is handled by Clerk and Schwab OAuth 2.0. AI integration uses `claude-sonnet` and `claude-opus` for market pulse narratives, technical analysis, and options strategy generation, with user-switchable models and a robust scoring system for market sentiment.

### Quote Data Architecture (52W Range)
The `/api/market/quote` route has three return paths: (1) Schwab streamer cache, (2) IB cache, (3) Schwab REST fallback. The streamer and IB caches provide real-time price data but NOT 52-week range. A dedicated `fiftyTwoWeekCache` (Map, 500-entry max, 1hr TTL) stores 52W high/low from Schwab REST. On first request via cached paths, a background Schwab REST fetch (`fetch52WBackground`) populates the 52W cache with a 5s abort timeout. Subsequent requests serve 52W data from cache. The `pickNum()` helper searches `quote`, `reference`, and `fundamental` sub-objects from Schwab responses.

### Options Chain Architecture (WebSocket-Only)
The options chain is 100% Schwab WebSocket driven. The `/api/market/options` endpoint fetches chain **structure only** from Schwab REST (`/marketdata/v1/chains`) — returning strikes, expirations, schwabSymbol, and dte — with all market data (bid/ask/Greeks/IV/volume/OI) stripped. The Schwab WebSocket streamer (`LEVELONE_OPTIONS:SUBS`) fills in all live data via `useOptionsStreamStore`. DataCell components read from streaming ticks: `getStreamVal(tick, key) ?? getContractVal(contract, key)`. Expiration bar stats (IV, P/C) and the top MetricsStrip are also computed from streaming data via `useStreamingExpirationStats`. Polygon is NOT used for the options chain — it is reserved for flow aggregates, data analysis, and AI strategy scanning. The StrategyBuilder uses the same streaming-first pattern for `enrichLeg`/`updateLeg`. The `spreadPrices` calculation treats missing bid/ask as 0 with a $0.01 minimum.

## Feature Specifications

Key features include SEC EDGAR integration, a dynamic Market Calendar, a MacroBar, an Institutional Tear Sheet, Multi-Watchlist support, and an Institutional Dashboard. The platform offers an AI Strategy Endpoint with confidence levels, a Pre-Trade Risk Manager performing 11 deterministic checks, and Conviction Sizing for position adjustments. Security includes Session Timeout and Biometric Authentication. Synthetic DXY is derived from /6E futures.

The StrategyBuilder order page has undergone a significant overhaul, including bug fixes, dynamic strategy name detection, real-time risk warnings, improved visual hierarchy, and integrated Greeks/metrics. The scanner universe system now supports presets, custom watchlists, and dynamic screens, with an expanded symbol universe and an overhauled telemetry system for feature-grouped, collapsible logs.

A new Discovery Mode (BETA) scanner, powered by a sophisticated scoring engine, uses DB-backed data for equity history and flow aggregates, eliminating per-symbol API calls for faster scans. This mode features five scoring categories: Setup Quality, Accumulation Pattern, IV Setup, Flow Divergence, and Emerging Relative Strength, with support for backfill endpoints and ETF filtering.

The Strategist now includes a Strike Resolver to convert abstract engine outputs into specific vertical spread trades, integrated with SSE for streaming resolved trade data to the frontend, and a "Send to Order" functionality to pre-populate the StrategyBuilder. The Order Ticket UI has been comprehensively redesigned for both stock and options pages, enhancing consistency, readability, and functional fixes for risk validation and context preservation.

### AI Lab Deliberation System (BETA)
The AI Lab Strategist uses a multi-round deliberation between the Analyst (Claude) and Skeptic (Gemini). Flow: (1) Analyst proposes a trade idea, (2) Skeptic critiques it, (3) if critique score > 25, they enter a deliberation loop — Analyst rebuts/revises, Skeptic re-evaluates — until consensus (skeptic satisfied, analyst withdraws, or score drops below 25). Safety cap: 20 rounds max. The full conversation is logged in `ai_lab_deliberations.conversation_log` (jsonb) with every turn's arguments, scores, concessions, and changes. If the analyst agrees to withdraw during deliberation, the idea is automatically rejected. The `conversationLog` field contains a `DeliberationLog` with `totalRounds`, `reachedConsensus`, `turns[]`, and `consensusSummary`.

## System Design Choices

The monorepo structure supports shared libraries and consistent tooling. Real-time data processing is optimized through streaming and efficient state management. AI responses are grounded in fresh market data. The Market Pulse system combines deterministic scoring with AI narrative generation. IVR calculations are consistent across the platform, and a shared options chain cache reduces API calls. A Calendar-to-Strategist Event Guard System prevents conflicting strategies, and the Deterministic Strategist uses criteria-based selection with specific trading modes and premium selling gates. A Pulse Delta Scoring Engine provides intraday market condition analysis, and a Regime Shock Detector adjusts platform behavior during market stress. A Trade Context Journal captures order entry context, and an Exit Order Staging system manages exit orders. A Failure Telemetry System provides diagnostic logging for server-side anomalies.

# External Dependencies

-   **Claude**: `claude-sonnet` and `claude-opus` for AI functionalities.
-   **PostgreSQL**: Primary database.
-   **Drizzle ORM**: TypeScript ORM for database interaction.
-   **Express**: Backend API server framework.
-   **Zod**: Schema validation library.
-   **Orval**: OpenAPI spec code generator.
-   **React Query**: Data fetching and caching for the frontend.
-   **Zustand**: Frontend state management.
-   **lightweight-charts**: Financial charting library.
-   **technicalindicators**: Library for technical analysis calculations.
-   **Clerk**: App-level authentication service.
-   **Interactive Brokers API** (`@stoqey/ib`): For market breadth and depth data.
-   **web-push**: Server-side Web Push notifications.
-   **SEC EDGAR API**: Public company filings data.
-   **Benzinga API**: Comprehensive market data provider for news, earnings, economic calendar, analyst ratings, and conference calls, integrated into AI prompts for strategist recommendations.
-   **Gemini**: `gemini-2.5-flash` for AI Lab Skeptic critiques.

### AI Lab Strategist — Config & UI Integration

The AI Lab Strategist has a dedicated configuration block on the AI Parameters screen, alongside the existing MARKET PULSE, TECHNICAL ANALYSIS, OPTIONS STRATEGIST, AI CHAT, and MARKET SCANNER blocks.

**Backend Config Store (`aiLabConfig.ts`):**
- `AiLabStrategistConfig` type with: analyst/skeptic provider, model name, temperature (0-1), enabled (boolean). Shadow mode removed.
- In-memory store with `getAiLabStrategistConfig()` / `updateAiLabStrategistConfig()` helpers.
- Strict validation: allowed keys only, finite numeric bounds, provider enum (`anthropic` | `google`).
- API routes: `GET /api/ai-lab/config`, `PUT /api/ai-lab/config`.

**Structured Two-Step Deliberation Pipeline (Options-First):**
- Step 1 — Claude Analyst: produces `PrimaryProposal` with options-first policy. Prefers options structures (spreads, naked, condors, etc.) when liquid; equity only when justified. Prompt uses ivSummary, flowSummary, scannerAlignment, liquidityMetrics, rsSummary for grounded analysis.
- Step 2 — Gemini Skeptic: produces `SkepticCritique` with options-aware critiques (IV crush, spread widths, OI/volume, event risk vs expiry, sizing vs conviction, equity-vs-options justification challenge).
- Merger: `buildFinalDecision()` — tightened state machine:
  - REJECT: validation fail, OR skepticKillSignal + critiqueScore ≥ 75, OR ≥ 3 severe flags (liquidity + regime + overfit).
  - MODIFIED: only on material change (conviction downgrade, combined regime+liquidity flags, or overfit + critiqueScore ≥ 50).
  - PROCEED: critiqueScore ≥ 55 without material change → proceeds with skeptic objections explicitly noted but assessed as non-blocking.
  - `finalStructure`: renders full trade expression with leg details (Buy/Sell qty × strike type expiry); completeness guard falls back to primaryProposal.structure.
  - `resolutionRationale`: weaves skeptic objections, evidence, and suggestedChanges into all decision paths.
- Orchestrator always writes a `ai_lab_deliberations` record; only persists to `ai_lab_ideas` on PROCEED/MODIFIED.
- New endpoint: `GET /api/ai-lab/deliberations?decision=REJECT|PROCEED|MODIFIED&limit=N`.

**Frontend UI (`Sidebar.tsx` → `AiLabStrategistControl`):**
- Collapsible block with the same visual style as existing AI feature blocks.
- Two model sections (Analyst + Skeptic), each with provider dropdown, model dropdown, temperature slider.
- Enabled toggle (no shadow/live toggle — shadow mode removed).
- On-mount sync: pushes persisted local config to backend via PUT.
- Debounced sync: every UI change pushes to backend after 300ms.

**Orchestrator Integration:**
- `runPipeline()` reads config at the start of every run.
- `enabled === false` → logs `AI_LAB_DISABLED` and short-circuits.
- Clients are re-created per run from config (provider/model/temperature).

**Zustand Store (`store.ts`):**
- `aiLabStrategistConfig` field added (version 12 migration removes legacy `mode` key).
- Default: Analyst=anthropic/claude-sonnet-4-20250514/0.0, Skeptic=google/gemini-2.5-flash/0.0, enabled=false.

**AI Lab View (`AiLabStrategistView.tsx`):**
- Filter control: Shown / Rejected / All tabs.
- Expanded idea card shows collapsible `AnalystReport` section (primary proposal + skeptic critique).
- `DeliberationCard` renders rejected evaluations with full reasoning.

**DB Schema:**
- `ai_lab_deliberations` table: full audit log of every pipeline run.
- `ai_lab_ideas` table: three new JSONB columns `primaryProposal`, `skepticCritique`, `finalDecision`.

**Liquid Core 130 Universe (`liquidCore130.ts`):**
- 130-symbol curated universe of ultra-liquid, options-tradable names across 9 sectors (ETFs, Mega-Tech/AI/Semis, Growth/Meme, Financials, Healthcare, Consumer, Energy, Industrials, Additional High-Liquidity Staples).
- Primary universe for both AI Lab Strategist (anomaly scanning via `equity_daily`) and deterministic scanner.
- Replaces stale S&P 500 / NASDAQ 100 / 270-symbol backfill defaults.
- Scanner default preset; auto-watchlist universe; backfill target via POST `/api/snapshot/backfill`.
- `getUniverseAnomalies()` in `aiLabService.ts` filters `equity_daily` to Liquid Core symbols only.

**Core Balanced 383 Universe Builder (`universeBuilder.ts`):**
- Builds a 383-symbol options-tradable universe using Polygon API data.
- Pipeline: grouped daily bars (price/volume) → ticker reference names → individual ticker details (market cap, SIC description) → options chain validation → SIC-to-GICS sector classification → sector-balanced selection.
- 11 GICS sectors with per-sector targets/caps/floors; 6 sub-sector buckets (Semis, Defense, Biotech, Banks, Software, Oil & Gas).
- Auto-builds on server start; weekly rebuild schedule; manual rebuild via POST `/api/scanner/universe/rebuild` (admin-key protected).
- Dynamic presets injected into scanner: `core383` + 11 sector slices + 6 sub-sector slices (22 total universe presets).
- Snapshot endpoint: GET `/api/scanner/universe/snapshot` returns sector counts, build timestamp, candidate totals.
- 429-aware retry with exponential backoff on Polygon API calls.

**AI Lab Sub-Tab (`AiIntelligenceTab.tsx` + `AiLabStrategistView.tsx`):**
- Inside the STRATEGIST panel, a segmented control toggles between OPTIONS STRATEGIST and AI LAB views.
- Styling matches the Scanner's DETERMINISTIC/MANUAL FILTER pattern (gold border-bottom, `bg-card` wrapper).
- AI Lab view (`AiLabStrategistView.tsx`) fetches `GET /api/ai-lab/ideas?status=NEW,ACTIVE` every 30s and renders expandable idea cards.
- Handles disabled, shadow mode, loading, error, and empty states with appropriate messaging.
- Auto-run strategist effects are gated behind `strategistMode === "options"` to prevent background runs when viewing AI Lab.