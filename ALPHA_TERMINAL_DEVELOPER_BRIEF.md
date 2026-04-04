# Alpha Terminal — Developer Brief

## What Is This?

Institutional-grade AI-powered trading terminal. Mobile-first (iPhone Pro Max 430x932px).
Bloomberg/ThinkorSwim-style dark UI with gold (#FFB800) accent on dark (#1C1C1E) background.
Real-time streaming market data, AI-driven analysis, options strategy engine.

---

## Tech Stack

| Layer         | Technology                                                  |
|---------------|-------------------------------------------------------------|
| **Frontend**  | React 19 + TypeScript + Vite 7                              |
| **Styling**   | Tailwind CSS 4 (dark theme, mobile-first)                   |
| **State**     | Zustand (client state) + TanStack React Query (server state)|
| **Routing**   | Wouter (lightweight)                                        |
| **Charts**    | Lightweight Charts (TradingView) + Recharts                 |
| **UI Kit**    | Radix UI primitives + shadcn/ui components                  |
| **Backend**   | Express 5 (Node.js) + TypeScript                            |
| **AI**        | Anthropic Claude (Sonnet 4.6 / Opus 4.6) via Vercel AI SDK  |
| **Auth**      | Clerk (user auth) + Schwab OAuth (brokerage)                |
| **Streaming** | WebSocket (ws) — Schwab Level 1 real-time quotes            |
| **Logging**   | Pino                                                        |
| **Monorepo**  | pnpm workspaces                                             |
| **Build**     | esbuild (API server), Vite (frontend)                       |
| **Hosting**   | Replit                                                      |

---

## Project Size

| Metric                       | Value        |
|------------------------------|--------------|
| Total lines of code (TS/TSX) | ~36,000      |
| Source files (TS/TSX/CSS)    | ~210         |
| Frontend components          | ~70 files    |
| Backend server files         | ~19 files    |
| Project size (with deps)     | ~1.3 GB      |
| Project size (source only)   | ~15 MB       |

---

## Architecture

```
workspace/
├── artifacts/
│   ├── alpha-terminal/          # Frontend (React + Vite)
│   │   └── src/
│   │       ├── components/      # UI components (~70 files)
│   │       ├── hooks/           # Custom hooks (streaming, quotes, caching)
│   │       ├── lib/             # Stores, utils, fetch helpers
│   │       ├── pages/           # Terminal.tsx (main page), not-found
│   │       ├── stores/          # Market Pulse Zustand store
│   │       ├── views/           # Full-page views (TearSheet)
│   │       └── types/           # TypeScript types
│   │
│   └── api-server/              # Backend (Express + Node.js)
│       └── src/
│           ├── routes/          # API route handlers
│           │   ├── ai.ts        # AI endpoints (2,484 lines — largest file)
│           │   ├── market.ts    # Market data / options chains (1,156 lines)
│           │   ├── auth.ts      # Schwab OAuth flow
│           │   ├── stream.ts    # WebSocket streaming control
│           │   ├── portfolio.ts # Account positions, orders, transactions
│           │   └── ib.ts        # Interactive Brokers (placeholder)
│           └── lib/             # Core engines
│               ├── optionsStrategist.ts  # Options strategy scoring (1,565 lines)
│               ├── marketPulseEngine.ts  # Market regime classifier (887 lines)
│               ├── schwabStreamer.ts      # Schwab WebSocket client (905 lines)
│               ├── preTradeRiskEngine.ts  # Pre-trade risk checks
│               ├── tokenStore.ts          # OAuth token management
│               ├── ta.ts                  # Technical analysis (RSI, MACD, etc.)
│               └── wsServer.ts            # Client-facing WebSocket server
│
├── packages/                    # Shared workspace packages
│   ├── api-client-react/        # Generated API client hooks
│   ├── api-zod/                 # Shared Zod schemas
│   └── db/                      # Drizzle ORM database layer
│
└── package.json                 # pnpm workspace root
```

---

## External APIs (4 total)

| API              | Purpose                                    | Auth Method        |
|------------------|--------------------------------------------|--------------------|
| **Schwab API**   | Market data, options chains, quotes, orders | OAuth 2.0 (PKCE)  |
| **Schwab Stream**| Real-time Level 1 WebSocket quotes          | OAuth token        |
| **Google Claude**| AI analysis, strategy generation, chat      | API key            |
| **Finnhub**      | News feed                                   | API key            |
| **Polygon.io**   | Supplementary market data                   | API key            |

---

## Environment Variables Required

```
CLERK_PUBLISHABLE_KEY      # Clerk frontend auth
CLERK_SECRET_KEY           # Clerk backend auth
SCHWAB_APP_KEY             # Schwab Market Data OAuth
SCHWAB_APP_SECRET
SCHWAB_REDIRECT_URI
SCHWAB_TRADER_APP_KEY      # Schwab Trader OAuth (orders)
SCHWAB_TRADER_APP_SECRET
SCHWAB_TRADER_REDIRECT_URI
ANTHROPIC_API_KEY             # Anthropic Claude AI
FINNHUB_API_KEY            # Finnhub news
POLYGON_API_KEY            # Polygon.io data
VITE_DEV_BYPASS_AUTH=true  # Skip Clerk auth in dev
```

---

## API Endpoints (40+ routes)

### AI Routes (`/api/ai/...`)
| Method | Path                        | Description                              |
|--------|-----------------------------|------------------------------------------|
| POST   | `/technical-snapshot`        | Quick TA snapshot for a symbol           |
| POST   | `/technical-analysis`        | Full AI technical analysis               |
| POST   | `/technical-analysis/stream` | Streamed (SSE) technical analysis        |
| POST   | `/options-analysis`          | AI options chain analysis                |
| POST   | `/options-strategist`        | 3-layer strategy engine (regime→score→AI)|
| POST   | `/options-strategist/stream` | Streamed strategist output               |
| POST   | `/market-pulse`              | Market regime classification             |
| POST   | `/market-pulse/stream`       | Streamed market pulse                    |
| POST   | `/market-briefing`           | AI market briefing                       |
| POST   | `/market-scanner`            | AI-powered stock scanner                 |
| POST   | `/chat`                      | General AI chat assistant                |
| POST   | `/strategy`                  | Strategy generation                      |
| POST   | `/sympathy-plays`            | Find correlated movers                   |
| POST   | `/pre-trade-check`           | Pre-trade risk validation                |
| GET    | `/models`                    | List available AI models                 |

### Market Data Routes (`/api/market/...`)
| Method | Path              | Description                              |
|--------|-------------------|------------------------------------------|
| GET    | `/quote/:symbol`   | Real-time quote                          |
| GET    | `/quotes`          | Batch quotes                             |
| GET    | `/chain/:symbol`   | Full options chain                       |
| GET    | `/candles/:symbol` | Price history (candles)                  |
| GET    | `/movers/:index`   | Top movers by index                      |
| GET    | `/news`            | Market news (Finnhub)                    |
| GET    | `/pc-ratio`        | P/C ratio + IVR + Expected Move          |
| GET    | `/fundamentals`    | Company fundamentals                     |
| GET    | `/technicals`      | Computed TA indicators                   |

### Auth Routes (`/api/auth/...`)
| Method | Path               | Description                             |
|--------|--------------------|-----------------------------------------|
| GET    | `/url`             | Get Schwab OAuth URL                    |
| GET    | `/callback`        | OAuth callback handler                  |
| POST   | `/refresh`         | Refresh access token                    |
| GET    | `/status`          | Token status check                      |
| GET    | `/trader-url`      | Trader OAuth URL                        |
| POST   | `/trader-refresh`  | Refresh trader token                    |

### Portfolio Routes (`/api/portfolio/...`)
| Method | Path               | Description                             |
|--------|--------------------|-----------------------------------------|
| GET    | `/accounts`        | Linked brokerage accounts               |
| GET    | `/positions`       | Current positions                       |
| GET    | `/orders`          | Order history                           |
| GET    | `/transactions`    | Transaction history                     |

### Streaming Routes (`/api/stream/...`)
| Method | Path               | Description                             |
|--------|--------------------|-----------------------------------------|
| POST   | `/start`           | Start Schwab WebSocket stream           |
| POST   | `/symbols`         | Subscribe to equity symbols             |
| POST   | `/option-symbols`  | Subscribe to option contracts           |
| GET    | `/quotes`          | Get cached streaming quotes             |
| GET    | `/status`          | Stream connection status                |

### WebSocket
| Endpoint          | Description                                    |
|-------------------|------------------------------------------------|
| `/api/ws/prices`  | Client-facing WS — pushes real-time prices     |

---

## Frontend Pages & Features

### Main Terminal (`Terminal.tsx` — single-page app)
- **Ticker Tape** — Scrolling real-time prices across top
- **AI Bias Strip** — Market regime indicator (bullish/bearish/neutral)
- **Macro Index Cards** — SPY, QQQ, IWM, VIX at a glance
- **Metrics Bar** — Price, change, volume, day range, 52-week range
- **Market Session Clock** — Pre-market / Market Open / After Hours countdown

### Bottom Navigation Tabs
1. **Scanner** — AI-powered stock screener with options analytics
2. **Markets** — Main market data view with sub-tabs:
   - News — Finnhub news feed with in-app browser
   - Options — Full chain viewer with Greeks, streaming prices
   - Company — Fundamental data, research hub
   - Chart — TradingView-style candlestick charts with TA overlays
3. **AI (Strategist)** — Center button, two modes:
   - Pulse — 7-cluster market regime analysis engine
   - Strategist — Options strategy recommendations
4. **Search** — Symbol search overlay
5. **Watchlist** — Custom watchlist management with streaming prices

### Additional Views
- **Sidebar** — Portfolio view, positions, account info
- **AI Chat Overlay** — Full-screen conversational AI assistant
- **Institutional Tear Sheet** — Comprehensive stock analysis page

---

## Core Engines (Backend)

### 1. Market Pulse Engine (`marketPulseEngine.ts`)
7-cluster market regime classifier:
- Breadth (TICK, TRIN, ADD, ADVN/DECN)
- Volatility Term Structure (VIX9D/VIX, VIX/VIX3M, SKEW)
- Rates & Credit
- Vol Level
- Risk Appetite
- Macro
Outputs: composite score (0-100), bias tier, confidence level

### 2. Options Strategist (`optionsStrategist.ts`)
3-layer architecture:
1. Auto-Pulse → market regime classification
2. Regime-Driven Scan → strategy selection + scoring
3. Claude AI → narrative generation with trade plan
Computes: IVR, expected move, P/C ratio, Greeks analysis

### 3. Schwab Streamer (`schwabStreamer.ts`)
Real-time WebSocket client for Schwab Level 1 data.
All price updates flow through WebSocket — no REST polling for prices.

### 4. Pre-Trade Risk Engine (`preTradeRiskEngine.ts`)
Validates trades before execution: position sizing, max loss, portfolio correlation.

---

## Key Design Decisions

- **Mobile-first**: Designed for iPhone Pro Max (430x932px)
- **WebSocket-only prices**: All live prices stream via WS, never REST polled
- **No blue anywhere**: Strict gold (#FFB800) + dark (#1C1C1E) palette
- **No colored background tints**: Outlines/borders only, no filled boxes
- **Scanner stays mounted**: Uses `display: none/block` to persist state across tabs
- **Clerk auth bypass**: `VITE_DEV_BYPASS_AUTH=true` for local development

---

## How to Run

```bash
# Install dependencies
pnpm install

# Start API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Start frontend (Vite dev server)
pnpm --filter @workspace/alpha-terminal run dev
```

---

## Heaviest Files (by lines of code)

| File                                    | Lines  | Purpose                        |
|-----------------------------------------|--------|--------------------------------|
| `api-server/src/routes/ai.ts`           | 2,484  | All AI endpoints               |
| `api-server/src/lib/optionsStrategist.ts`| 1,565 | Options strategy engine         |
| `alpha-terminal/src/components/AiIntelligenceTab.tsx` | 1,509 | AI Pulse + Strategist UI |
| `api-server/src/routes/market.ts`       | 1,156  | Market data endpoints          |
| `api-server/src/lib/schwabStreamer.ts`   | 905    | Schwab WebSocket client        |
| `api-server/src/lib/marketPulseEngine.ts`| 887   | Market regime classifier       |
| `alpha-terminal/src/components/OptionsTab.tsx` | 885 | Options chain viewer        |
