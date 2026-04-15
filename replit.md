# Overview

Alpha Terminal — Trading Command Center v2 is an institutional-grade, TypeScript-based trading platform designed for AI-assisted trading. It provides advanced tools, real-time market data, and AI-powered insights for options analysis, market scanning, and strategy generation. The platform aims to enhance decision-making for professional traders through a comprehensive environment with AI-powered market pulse narratives, technical analysis, and strategy generation, focusing on high-performance and data accuracy.

# User Preferences

I prefer concise and direct communication.
I value iterative development with frequent, small updates.
Please ask for my confirmation before making any significant changes to the codebase or architecture.
I prefer detailed explanations for complex technical decisions.
Do not make changes to files within the `lib/` directory unless explicitly instructed.
I prefer a coding style that emphasizes readability and maintainability, utilizing TypeScript's features effectively.

# System Architecture

## UI/UX Decisions

The UI features an institutional gold and pure black Bloomberg-style aesthetic with a system font stack. It includes circular icon buttons, pill toggles, rounded cards with gradient backgrounds, gold gradient CTA buttons, and capsule quantity steppers. The design is responsive and includes accessibility features.

## Technical Implementations

The project is a pnpm monorepo built with TypeScript. The backend uses Express 5, Zod for validation, and PostgreSQL with Drizzle ORM. Real-time L1 equity/futures quotes stream via Schwab WebSocket; portfolio data is polled from Schwab REST. IBKR is used for breadth and volatility indicators. Company names come from Schwab REST. Frontend state is managed with Zustand, and `lightweight-charts` is used for charting. Authentication is handled by Clerk and Schwab OAuth 2.0. AI integration uses Claude 4.6 (Opus/Sonnet) and Gemini 3.1 Pro Preview for market pulse narratives, technical analysis, and options strategy generation. All AI features (Market Pulse, Technical Analysis, Options Strategist, AI Chat, Scanner) support both Claude and Gemini models — user selects from a unified model dropdown. Default model is `claude-opus-4-6`. AI Lab skeptic defaults to `gemini-3.1-pro-preview`. Anthropic SDK `@anthropic-ai/sdk@^0.88`, Google GenAI SDK `@google/genai@^1.50.1`. Store version 18 auto-migrates skeptic model to `gemini-3.1-pro-preview`.

## System Settings

A comprehensive "System Settings" sidebar panel (`SystemSettingsPage.tsx`) exposes all AI Labs configuration knobs at runtime — no code changes needed. Accessible via the sidebar menu (gear icon → "System"). Settings include:
- **Models**: Analyst/Skeptic provider selection (Google/Anthropic), model names, temperature sliders
- **Universe Selection**: Choose scanning universe from Liquid Core or saved watchlists
- **System Prompts**: Full CRUD for 6 prompt roles (shared_context, analyst, analyst_rebuttal, skeptic, skeptic_reeval, universe_screener) with version history and restore
- **Deliberation Thresholds**: Max rounds, skeptic critique threshold, overnight/premarket top-N, trigger volumes, price shock %, block flow notional, scanner score delta
- **Anomaly Detection**: Volume spike, flow strength, IVR spike, RS change thresholds, VIX boundaries, min price/volume filters, data freshness
- **Trade Validation**: Max active ideas (default 20), min OI per leg (default 50), max bid-ask spread % (default 10%), min avg daily volume for stocks (default 100K)
- **Schedule**: Per-pass enable/disable toggles for all 7 scheduled analysis passes

Post-consensus validator checks (in `aiLabValidator.ts`): STALE_DATA (actual timestamp-based), WIDE_SPREAD, LOW_OI, INVALID_EXPIRATION (checks against availableExpirations list), LOW_LIQUIDITY, MAX_ACTIVE_REACHED, DUPLICATE_IDEA, CONTRADICTORY_IDEA. Removed checks: DTE_TOO_SHORT, LOW_ACTIVITY, SECTOR_CONCENTRATION, DIRECTION_SKEW, HIGH_CORRELATION_DUPLICATE. Cooldown system: rejected tickers are blocked from re-analysis for 24 hours (max 30 tickers, LRU eviction).

Backend: Prompts stored in `ai_lab_prompts` table with DB-first loading (fallback to hardcoded defaults). All config changes apply at runtime via dynamic proxy reads in `aiLabService.ts` and `refreshOrchestratorConfig()` in the orchestrator. API routes under `/api/ai-lab/settings/*`, `/api/ai-lab/prompts/*`, `/api/ai-lab/universes`.

Quote data retrieval prioritizes Schwab streamer cache, falling back to Schwab REST. Options chain data is Schwab WebSocket driven, with structure from Schwab REST. Strike prices are normalized to 2-decimal precision to prevent floating-point mismatches. The AI Lab Deliberation System uses a multi-round process between an Analyst (Claude) and a Skeptic (Gemini) to refine trade ideas, operating in "Full-Universe Mode" to select the best setups across a broad range of tickers. AI Lab model configuration (analyst/skeptic provider, model name, temperature, enabled state) is persisted to the `ai_lab_config` database table and loaded on server startup, surviving restarts.

The system incorporates curated symbol universes like "Liquid Core 130" and a "Core Balanced 383 Universe Builder" for AI Lab and deterministic scanners. IV/IVR data is computed from Polygon options snapshot data, including IV30d and IVR, with historical backfill capabilities. The database architecture uses separate PostgreSQL instances for dev and production, with self-population via Polygon API backfill. The equity backfill pipeline uses Polygon's bulk grouped daily bars endpoint for efficient data retrieval on startup.

## Strategist V2 Architecture (AI-Powered)

The Strategist V2 is now an AI-driven pipeline: Toxic Gate → Data Gathering → Options Chain Summary → AI Trade Selection → Leg Validation → Recommendation. The deterministic decision tree (selectStrategyType, determineCreditDebit, buildCandidates, scoreCandidates) has been replaced with a direct AI call — Claude/Gemini analyzes a comprehensive data package and recommends the best options trade.

Pipeline flow: `analyzeTickerV2()` → `checkToxicGate()` → `fetchTickerData()` (Schwab REST) → `fetchOptionsChain()` (Polygon + Schwab fallback, all expirations up to 365d) → `computeIvrFromChain()` → `computeIOScore()` → `summarizeOptionsChain()` (ATM data, top 5 vol calls/puts, unusual vol/OI, term structure, all expirations) → `buildDataPackage()` (ticker data, chain summary, IOScore with components, regime, user preferences) → `callAiForTrade()` (uses AI Lab model settings: provider/model/temperature) → `validateAiResponse()` (check strikes exist in chain, min OI, max spread %) → one retry if validation fails → map legs to frontend format.

Key components: `regimePostProcessor.ts` for market pulse regime, `ioScoreEngine.ts` for idiosyncratic edge scores, `strategistSettings.ts` for 36 tunable parameters. IVR is computed live from the options chain. Toxic Gate has Path A (EXTREME + HIGH correlation) and Path B (FOMC/CPI within 24h + ELEVATED risk). AI model configuration follows AI Lab settings (analystModelProvider, analystModelName, analystTemperature). Frontend shows AI rationale, confidence badge, and warnings. Manual snapshot trigger at `POST /api/snapshot/trigger`.

## System Design Choices

The monorepo structure supports shared libraries and consistent tooling. Real-time data processing is optimized through streaming and efficient state management. AI responses are grounded in fresh market data. The Market Pulse system combines deterministic scoring with AI narrative generation. IVR calculations are consistent, and a shared options chain cache reduces API calls. A Calendar-to-Strategist Event Guard System prevents conflicting strategies. A Pulse Delta Scoring Engine provides intraday market condition analysis, and a Regime Shock Detector adjusts platform behavior during market stress. A Trade Context Journal captures order entry context, and an Exit Order Staging system manages exit orders. A Failure Telemetry System provides diagnostic logging for server-side anomalies.

## Feature Specifications

Key features include SEC EDGAR integration, a dynamic Market Calendar, a MacroBar, an Institutional Tear Sheet, Multi-Watchlist support, and an Institutional Dashboard. The platform offers an AI Strategy Endpoint with confidence levels, a Pre-Trade Risk Manager performing 11 deterministic checks, and Conviction Sizing. Security features include Session Timeout and Biometric Authentication. A redesigned StrategyBuilder and Order Ticket UI enhance usability and functionality. The Portfolio and Watchlist views support extensive customizable columns and indicators, stored in localStorage. A "Discovery Mode (BETA)" scanner uses a sophisticated scoring engine for Setup Quality, Accumulation Pattern, IV Setup, Flow Divergence, and Emerging Relative Strength, incorporating IVR persistence and liquidity gates. Notification Preferences allow per-event control over Schwab order event types, configurable for In-App and Push channels.

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