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

The Strategist V2 is an AI-driven pipeline: Toxic Gate → Data Gathering → Options Chain Summary → AI Trade Selection (with mandatory web search) → Leg Validation → Catalyst Calibration → Recommendation. The AI is prompted as a senior options trader on a discretionary prop desk (Jane Street/SIG style), thinking in Greeks, vol surface dynamics, skew, term structure, and probability. It hunts for asymmetric edge across any structure: verticals, iron condors, butterflies, calendars, diagonals, ratios, straddles, strangles, naked options. It does not default to safe structures or standard DTE ranges — it picks the structure where the edge lives. It must cite data sources and never invent strikes or expirations.

Web search trace (Anthropic `web_search_20250305` and Gemini `googleSearch`) is captured per-call as `{webSearchUsed, queries, sources}`. The model returns `sameDayCatalyst`, `catalystSummary`, `catalystAlignment` (ALIGNED/CONTRADICTS/NEUTRAL/NONE), and `citedHeadlines`. The server enforces: regime NO_EDGE + no catalyst → block; ALIGNED catalyst → +12 confidence; CONTRADICTS → −25 confidence (block if drops below 20). Trace is attached to the result as `ContextSourcesPayload`, rendered in `StrategistV2Card` (with http/https-only URL sanitization) and serialized into the copy-to-clipboard plaintext under `CONTEXT SOURCES`.

Pipeline flow: `analyzeTickerV2()` → `checkToxicGate()` → `fetchTickerData()` (Schwab REST) → `fetchOptionsChain()` (Polygon + Schwab fallback, all expirations up to 365d) → `computeIvrFromChain()` → `computeIOScore()` → `summarizeOptionsChain()` (ATM data, top 5 vol calls/puts, unusual vol/OI, term structure, all expirations) → `buildDataPackage()` (ticker data, chain summary, IOScore with components, regime, user preferences) → `callAiForTrade()` (uses AI Lab model settings: provider/model/temperature) → `validateAiResponse()` (check strikes exist in chain, min OI, max spread %) → one retry if validation fails → map legs to frontend format.

AI response includes: strategy, legs, entryPrice, entryRangeMin/Max (fill range), maxRisk, maxProfit, breakeven, companyContext (2 sentences), thesis (vol/flow/Greeks reasoning), exitTargets (profit target, stop loss, time stop with underlying price levels), bullInvalidation, bearInvalidation, riskOfRuin, confidence (0-100), warnings. Direction inference handles naked puts (BULLISH), naked calls (BEARISH), ratio spreads (inferred from net sell side).

Solo / Debate mode: `strategistSettings.ts` exposes `strategistMode` (1=Solo default, 2=Debate), `strategistConvergence` (1=highest_confidence, 2=synthesis, 3=hybrid default), and three model-index settings (`strategistSoloModelIdx`, `strategistDebateAModelIdx`, `strategistDebateBModelIdx`) drawn from a shared `MODEL_OPTIONS` array (Anthropic + Gemini). Setting metas with an `options[]` array render as `<select>` dropdowns in `StrategistSettingsPanel.tsx`, grouped under a pinned "AI Strategist" section. In Debate mode, `analyzeTickerV2()` calls `runDebate()` (`strategistDebate.ts`) which runs Strategist A and B in parallel for Round 1 (propose), Round 2 (critique + revise), Round 3 (final), then converges: highest_confidence picks the higher confidence final, synthesis runs one extra LLM call on A's model to merge both, hybrid uses synthesis when directions agree else highest_confidence. Web-search traces from all six rounds plus synthesis are merged into the final `ContextSourcesPayload`. The retry path on validation failure falls back to Solo on Strategist A's model. Live transcript is streamed turn-by-turn via `onTurnStart/onTurnDelta/onTurnDone` callbacks into `ThinkingEntry.transcript[]` (each turn: `{id, round:1|2|3|"synthesis", role:"A"|"B"|"synthesis"|"system", phase, model, label, text, ts, done}`); GET `/thinking/:jobId` returns the full transcript snapshot. Frontend store guards `setStrategistTranscript` with per-turn equality across the whole array (and a both-empty fast path) to avoid rerender churn during parallel A/B streaming. `AiIntelligenceTab.tsx` renders a `DebateTranscript` component with round headers and A=gold / B=cyan / synthesis=green chips; falls back to `AiThinkingFeed` when the transcript is empty (Solo mode). Key components: `regimePostProcessor.ts` for market pulse regime, `ioScoreEngine.ts` for idiosyncratic edge scores, `strategistSettings.ts` for 36+ tunable parameters. IVR is computed live from the options chain. Toxic Gate has Path A (EXTREME + HIGH correlation) and Path B (FOMC/CPI within 24h + ELEVATED risk). AI model configuration follows AI Lab settings (analystModelProvider, analystModelName, analystTemperature). Frontend card shows company context, thesis, exit targets, bull/bear invalidation, risk of ruin, fill range, confidence badge, and warnings. Manual snapshot trigger at `POST /api/snapshot/trigger`.

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
## Scanner observability & ops notes (Part 6)

### Structured log lines

All trailing-baseline queries and the LIVE_FLOW bucket emit one structured
log line per call. Search by the stable `op` field:

| `op` | Source | What it tells you |
| --- | --- | --- |
| `baseline.contract.fetch` | `optionsBaselines.getContract20dBaseline` | Per-contract 20d baseline; `degraded=true` when <10 days history. |
| `baseline.contract.error` | same | Query failed; includes `err`. |
| `baseline.ticker.batch` | `optionsBaselines.getTicker20dBaselines` | Per-scan batch; `requested`/`returned`/`hitRate`/`durationMs`. |
| `baseline.flowAccel.batch` | `optionsBaselines.getFlowAcceleration` | Flow acceleration; also reports `strongAccel` (ratio ≥1.5). |
| `baseline.trailingUnusual.fetch` | `optionsBaselines.getTrailingUnusualFlow` | `/api/unusual-options/trailing` endpoint. |
| `liveFlow.compute` | `optionsBaselines.computeLiveFlowBucket` | Per-ticker bucket trace (debug-only; flip log level to inspect). |
| `scanner.liveFlow.applied` | `deterministicScanner.v2` | Per-scan aggregate: how many candidates got LIVE_FLOW + avg/max score. |

Quick health check: `grep 'op=baseline\.' <log>` over the last open session
should show `hitRate ≥ 0.9` for LC130 (the always-on universe). Anything
sustained below that signals a backfill gap.

### Failure-mode banner state machine (scanner UI) — PLANNED

> Current implementation: the MarketScanner only renders an LC130
> "ALWAYS-ON (full coverage)" vs "ON-DEMAND (cached)" coverage badge —
> there is **no** LIVE/AMBER/EOD state machine in the UI yet. The
> three-state machine below is the **target shape** for when the Part 2
> persistent WS watcher ships; record it here so the next session
> implements consistently.

```
  LIVE   (green)   = Discovery scan completed within last 5min,
                     LIVE_FLOW.coverageRate >= 0.5 from last scan,
                     watcher heartbeat fresh (<60s).
  AMBER  (yellow)  = Trailing baselines loaded but watcher is offline,
                     OR coverageRate between 0.1 and 0.5,
                     OR watcher heartbeat stale (60s..5min).
  EOD    (gray)    = Only flat-files trailing data is contributing
                     (Part 2 disabled, watcher dead, or DB stale).
                     LIVE chips suppressed; bars still render.
```

Today the watcher is disabled (`POLYGON_OPTIONS_WS_ENABLED=false`) so when
the badge is implemented it will be a static EOD until Part 2 lands.

### Sizing note (Part 2 follow-up)

The single-vCPU container is the real constraint for the persistent
Polygon options WS watcher. During market open with 130-ticker LC plus
on-demand symbols subscribed at the contract level, sustained CPU under
the existing Schwab streamer + IB market-data path is the bottleneck —
not memory or network. Before enabling `POLYGON_OPTIONS_WS_ENABLED`:

1. Cap concurrent contract subscriptions at ~600 (3-tier: 100 hot / 300 warm / 200 cold).
2. Profile baseline CPU at open; if sustained >75%, switch to a 2-vCPU plan or move the watcher into a dedicated worker artifact.
3. The session log writes are append-only and small (<1KB per event); no I/O concern.
