# Overview

This project, "Alpha Terminal — Trading Command Center v2," is a pnpm workspace monorepo using TypeScript, designed as an institutional-grade trading platform. It offers advanced trading tools, real-time market data, and AI-powered insights. The platform integrates with Schwab for data and authentication, providing features like advanced charting, options analysis, AI-driven market scanning, and strategy generation. The primary goal is to deliver a comprehensive, high-performance trading environment with a focus on data accuracy and user experience, aiming for leadership in AI-assisted trading solutions.

# User Preferences

I prefer concise and direct communication.
I value iterative development with frequent, small updates.
Please ask for my confirmation before making any significant changes to the codebase or architecture.
I prefer detailed explanations for complex technical decisions.
Do not make changes to files within the `lib/` directory unless explicitly instructed.
I prefer a coding style that emphasizes readability and maintainability, utilizing TypeScript's features effectively.

# System Architecture

## UI/UX Decisions

The UI features an institutional gold color palette with a dark theme, Inter font, and `tabular-nums`. Key components include a fixed MacroBar, a slide-out Sidebar (Command Center) with portal-based sub-pages, a ThinkorSwim-replica Options Tab, an AI Chat Overlay, Market Pulse Dashboard (SSE-streamed structured JSON with 7 fixed clusters and composite scoring), Market Scanner, `lightweight-charts` based Charting, a `requestAnimationFrame`-driven Ticker Tape, and CSS keyframe Price Pulse Animations. The Markets view uses a 5-tab `MarketDataTabs` bar (NEWS, OPTIONS, AI, SCAN, CHART) with icons, sticky at `top: 118px` to pin under the ticker tape. The AI tab uses iOS-style pill sub-tabs. Audit panels for Market Pulse and Options Strategist display raw data and rules applied.

## Technical Implementations

The project is a pnpm monorepo with TypeScript. The API is an Express 5 server using Zod for validation. PostgreSQL with Drizzle ORM is used for the database. Real-time streaming is handled by a singleton WebSocket client connecting to Schwab Streamer, broadcasting live ticks to the frontend via a second WebSocket server. The frontend uses Zustand for state management and `lightweight-charts` for charting. Authentication uses Clerk for app-level login and Schwab OAuth 2.0 for market data APIs. A development bypass for authentication (`DEV_BYPASS_AUTH=true`) is available. Market data flows from Schwab WebSocket to a server-side cache, then to the frontend via WebSocket, with REST API polling as a fallback. The Market Pulse engine and AI narratives read from this single live cache. A robust scoring engine (v2) with 7 bias tiers and cluster disagreement penalties determines market sentiment. The Options Strategist (v3) uses a three-layer architecture: Auto-Pulse for market regime classification, Regime-Driven Scan to build and score strategies, and Gemini for narrative generation. AI integration defaults to `gemini-2.5-flash` with `gemini-2.5-pro` as an option. Technical analysis uses the `technicalindicators` npm package. TanStack Query (React Query) is used as a caching layer for AI results (Strategist, Technicals, Market Scanner) so they persist across tab navigation. QueryClient is configured with 30min staleTime and 60min gcTime. Cache hooks (`useStrategistCache`, `useTechnicalsCache`, `useScanCache`) use `enabled: false` queries with manual `setQueryData` writes. Market Pulse uses Zustand store (global, persists inherently) with a dual-write to TanStack Query cache. Run-id guards protect against race conditions from overlapping stream requests.

## Feature Specifications

Features include a MacroBar displaying key indices, an Institutional Tear Sheet for fundamental data, and an Options Chain with bid/ask, Greeks, configurable columns, and a MetricsStrip. The AI Strategy Endpoint generates strategies based on historical data and TA, with mandated `aiConfidence` levels. `useTickColor` provides price momentum coloring. Search History stores recent symbols. Comprehensive support for Indices & Futures is integrated across all data endpoints.

### Strategy-Aware Risk Evaluation (optionsStrategist.ts)
- `RiskCategory` type: `DEFINED | CASH_SECURED | MARGIN_BASED`
- `evaluateRisk()` returns per-strategy risk metrics (max_loss for defined, strike×100 for CSP, managed stop for margin)
- `RiskEvaluation` interface: `category`, `risk_metric`, `risk_label`, `capital_required?`, `within_limits`
- `risk_reward_display` field: human-readable "Risk $X / Reward $Y" format
- All 11 strategy builders populate `risk_evaluation` and `risk_reward_display` fields

### Pre-Trade Risk Manager
- Backend: `preTradeRiskEngine.ts` with 7 deterministic checks: Pulse Alignment, R/R ≥ threshold, Bid/Ask Spread ≤15%, PoP ≥35%, Position Size ≤ max%, Vol Environment, DTE ≥ min
- API route: `POST /api/ai/pre-trade-check` runs engine + Gemini Flash one-liner
- Frontend: `PreTradeCheckPanel` shows green/yellow/red checklist below each strategy card
- `RiskCategoryBadge` shows Defined Risk / Cash Secured / Margin Based on each card header
- Settings (persisted in Zustand): `preTradeEnabled`, `preTradeBlockOnRed`, `preTradeMinRR` (0.25), `preTradeMaxPositionPct` (3%), `preTradeMinDTE` (5), `accountSize` (25000)
- Auto-runs when strategies load; results are per-strategy

### Session Timeout & Biometric Auth
- All security preferences stored in `localStorage` under key `alphaTerminalSecurityPrefs`
- `SecurityPrefs` interface: `sessionTimeout` (number, minutes), `biometricLogin`, `biometricSensitiveData`, `biometricTradeConfirmation` (all boolean)
- Session timeout options: 15, 30, 60, 90 minutes, or Never (0). Default: 30 min
- `useAutoLock` hook reads timeout from `alphaTerminalSecurityPrefs.sessionTimeout`, no hardcoded timeout values
- Biometric auth uses WebAuthn API (native browser) + Clerk passkeys (`clerk.user.createPasskey()`)
- Login screen: "Sign in with Face ID" button (passkey strategy) shown when `biometricLogin=true` and WebAuthn supported
- `useBiometricGate` hook: local device-level WebAuthn verification for sensitive data access
- `useTradeConfirmationGate` hook: local device-level WebAuthn verification before trade execution
- Security Settings UI in sidebar: segmented timeout control, passkey registration button, 3 biometric toggles
- Legacy `at_auto_lock_minutes` localStorage key auto-migrated to new prefs format
- Key files: `securityPrefs.ts`, `useAutoLock.ts`, `useBiometric.ts`, `main.tsx`, `Sidebar.tsx`

## System Design Choices

The monorepo structure facilitates shared libraries and consistent tooling. TypeScript Composite Projects ensure robust type-checking. A clear separation of concerns is maintained across UI, API, database, and streaming logic. Real-time data is optimized through streamed data with REST fallback and performant state management. Strict AI grounding ensures AI responses are based solely on provided, fresh market data. The Market Pulse system uses a two-layer architecture: a deterministic scoring engine (pure TypeScript math/rules) that calculates composite scores and bias, and Gemini (temperature=0) which writes only the narrative based on these pre-calculated scores. The bias strip (`AiBiasStrip`) provides a visual indication of market bias. Market Pulse settings are persisted in Zustand, allowing user-defined indicator management and strategy preferences.

# External Dependencies

-   **Schwab Developer API**: OAuth, market data, and streaming.
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
-   **Clerk**: App-level authentication.