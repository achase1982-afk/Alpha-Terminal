# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Alpha Terminal — Trading Command Center v2

Key features implemented:
- **MacroBar**: Fixed sticky bar with clickable SPY/QQQ/IWM/VIX cards; clicking sets active symbol
- **Sidebar**: Compact pill overlays, clean timeframe grid, Schwab auth panel (popup OAuth + manual paste fallback)
- **Tabs**: CHART | OPTIONS | AI INTELLIGENCE | SCAN
- **AI Intelligence Tab**: Deep Analysis (TA + Options Strategist) — chat removed, lives in overlay now
- **AI Chat Overlay**: Full-screen iMessage-style chat accessible from sidebar "AI CHAT ASSISTANT" button; AbortController lifecycle; sticky bottom input with safe-area-inset
- **Company Tear Sheet**: Clickable active ticker badge → full-screen overlay with Schwab fundamentals (Market Cap, Shares Out, P/E, EPS, Beta, Div Yield), AI-generated Sympathy & Competitors, placeholder sections for Headlines and Institutional Flow; backend routes `/api/market/fundamentals` and `/api/ai/sympathy-plays`
- **Live Market Pulse**: Sidebar button → modal; backend fetches 14-symbol batch (SPY/QQQ/IWM/$VIX/$VVIX/$CPC/$TICK/$ADD/$TRIN/$DXY//ES//NQ//GC//CL) in single Schwab call; institutional-grade session-aware Gemini prompt
- **Market Scanner**: AI Discovery + Manual Filter modes; configurable scan universe (S&P 100, Nasdaq 100, High Beta, Custom), max results (1-20), sortable results table with ticker/strategy/confidence/thesis columns
- **Options Tab**: Chain table with Options Strategist results panel above (collapsible)
- **Backend AI routes**: `/api/ai/market-briefing`, `/api/ai/options-strategist`, `/api/ai/chat`, `/api/ai/analyze`
- **Zustand store**: `analysisResult`, `strategistResult`, `briefingResult` shared state
- **useAutoRefreshToken**: 25-min auto-refresh; detects expired tokens in API responses

### Real-Time Streaming Architecture (Schwab Streamer WebSocket)
- `artifacts/api-server/src/lib/schwabStreamer.ts` — singleton WS client to Schwab Streamer
  - Calls `/trader/v1/userPreference` to get streamer info, then opens `wss://` connection
  - Sends LOGIN, then subscribes to `LEVELONE_EQUITIES` (fields 0,1,2,3,8,12,13,15,20,38,29)
  - Broadcasts live ticks to all SSE clients; maintains in-memory quote cache
  - Exponential backoff reconnect (1s → 2s → 4s … capped at 30s)
- `artifacts/api-server/src/routes/stream.ts` — SSE + control endpoints
  - `POST /api/stream/start` — start/restart WS with new token + symbol list
  - `POST /api/stream/symbols` — add symbols to existing subscription
  - `GET  /api/stream/quotes` — SSE endpoint; sends `event: quote` + `event: heartbeat`
  - `GET  /api/stream/snapshot` — JSON snapshot of current cache
  - `GET  /api/stream/status` — connection health
- `artifacts/alpha-terminal/src/hooks/useStreamingQuotes.ts` — app-root SSE consumer
  - Opens `EventSource("/api/stream/quotes")` on token arrival
  - Writes each `event: quote` into Zustand `streamPrices` map
  - Sets `streamConnected` true on heartbeat / open, false on error
- `artifacts/alpha-terminal/src/hooks/useQuote.ts` — unified quote hook
  - Returns stream data (< 60s old) when available; falls back to REST poll every 1s (3s on 429 rate limit)
  - All price components use this instead of `useGetQuote` directly
- `streamPrices: Record<string, LiveQuote>` in Zustand store (non-persisted)
  - `partialize` excludes it from localStorage persistence
  - Per-symbol Zustand selectors mean only the changed symbol's card re-renders

### Quote Data Flow
```
Schwab LEVELONE_EQUITIES WS
        ↓  ticks (< 1s)
schwabStreamer.ts (server cache + broadcast)
        ↓  SSE text/event-stream
useStreamingQuotes.ts (EventSource)
        ↓  setStreamQuote()
Zustand streamPrices map
        ↓  useQuote(sym) selector
MetricsBar / MacroCard / TapeItem  ← ONLY these re-render on each tick
```

### OAuth Flow Architecture (Grok-Standard Seamless Flow)
- **Desktop: Popup-based flow** (when `SCHWAB_REDIRECT_URI` points to `/api/auth/callback`):
  - `POST /api/auth/init-flow` — server mints cryptographic flowId, stores in `pendingFlows`
  - `GET /api/auth/url?state=<flowId>` — builds Schwab auth URL with `state` param
  - AuthPanel opens popup via `window.open`, starts 2s polling on `/api/auth/flow-status`
  - Schwab callback exchanges code, stores tokens in `flowStore` keyed by flowId, redirects to `/oauth-success`
  - `OauthSuccess.tsx` page posts `window.opener.postMessage` for instant notification, then closes
  - Polling on `/api/auth/flow-status?flowId=X` serves as fallback if postMessage is blocked
  - `GET /api/auth/flow-tokens/:flowId` returns and deletes tokens (one-time use, 2 min TTL)
  - Polling stops if: popup closed + 3 cycles, or 90 cycles (3 min timeout)
- **Mobile: Direct navigation flow** — `isMobile()` UA detection in AuthPanel; uses `window.location.href` instead of popup; server detects mobile UA in `/callback` and redirects to `/?schwab=connected&flowId=X` (or `/?schwab=error&message=X`); AuthPanel reads query params on mount, consumes flow tokens, clears URL
- **Manual paste fallback** (when `SCHWAB_REDIRECT_URI` is `https://127.0.0.1/`):
  - Two-step: open Schwab login in new tab, paste redirect URL back, `POST /api/auth/callback` exchanges code

### Null-Stripping (Schwab API Safety)
- `stripNulls()` utility in `market.ts` and `ai.ts` converts `null` → `undefined` recursively before Zod `.parse()` calls
- Prevents Zod validation failures when Schwab returns `null` for optional numeric/string fields (Zod `.optional()` accepts `undefined` but rejects `null`)
- Frontend also strips nulls in `AiIntelligenceTab.tsx` before sending payloads to AI endpoints (guards against stale cached data)

### Known constraints
- Gemini models: only `gemini-2.5-flash` and `gemini-2.5-pro` work
- `lightweight-charts` v5: `chart.addSeries(CandlestickSeries, opts)` pattern
- Direct `fetch("/api/ai/...")` used for new AI routes (not orval-generated hooks)
- **Tick Direction Coloring**: `useTickColor` hook (`src/hooks/useTickColor.ts`) — tracks previous price per symbol; Last Price number colored by immediate momentum (green uptick / red downtick), daily change line colored by net change
- **Ticker Tape**: JS `requestAnimationFrame` animation (not CSS keyframes) for flash-free scrolling; speed controlled via `tapeSpeed` store value + sidebar slider
- **Chart Controls**: Dual Period/Interval `<select>` dropdowns above chart (ThinkorSwim-style); Period options: 1 Day, 5 Day, 1 Month, 3 Month, 1 Year; Interval dynamically switches between intraday (1/5/15/30 Min) and daily (Daily/Weekly) based on period; maps to Schwab `periodType/period/frequencyType/frequency` params; server validates all params against whitelists
- **Indices & Futures Support**: Symbols like `$SPX`, `$VIX`, `/ES`, `/NQ` work across all endpoints (quote, history, options, streaming); `INDEX_SYMBOL_MAP` handles both friendly (SPX) and `$`-prefixed ($SPX) forms → `$SPX.X` Schwab format; URL encoding handled via `encodeURIComponent` and `URLSearchParams`; `reverseKeyMap` in streamer maps Schwab keys back to user-facing symbols
- VIX MacroCard inverts color (rising = red/fear, falling = green/calm)
- 52W High/Low and P/E are REST-only fields (Schwab Streamer doesn't carry fundamental data)

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
