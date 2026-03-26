import { Router, type IRouter } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  RunTechnicalAnalysisBody,
  RunTechnicalAnalysisResponse,
  RunOptionsAnalysisBody,
  RunOptionsAnalysisResponse,
  RunChatQueryBody,
  RunChatQueryResponse,
  GetAvailableModelsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const AVAILABLE_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

function getClient(): GoogleGenerativeAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

async function callGemini(
  prompt: string,
  modelName: string = "gemini-2.5-pro",
  temperature: number = 0.3
): Promise<string> {
  const client = getClient();
  if (!client) {
    return "Error: GEMINI_API_KEY not configured.";
  }

  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature },
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

function formatQuote(quote: Record<string, unknown>): string {
  return `
SYMBOL: ${quote["symbol"]}
Last: $${quote["last"] ?? "N/A"}
Bid/Ask: $${quote["bid"] ?? "N/A"} / $${quote["ask"] ?? "N/A"}
Change: ${quote["change"] ?? "N/A"} (${quote["changePct"] ?? "N/A"}%)
Volume: ${quote["volume"] ?? "N/A"}
Day Range: $${quote["low"] ?? "N/A"} - $${quote["high"] ?? "N/A"}
52W Range: $${quote["fiftyTwoWeekLow"] ?? "N/A"} - $${quote["fiftyTwoWeekHigh"] ?? "N/A"}
P/E: ${quote["peRatio"] ?? "N/A"}
`.trim();
}

function formatCandles(candles: Array<Record<string, unknown>>): string {
  if (!candles.length) return "No candle data available.";
  const recent = candles.slice(-30);
  const lines = recent.map(
    (c) => `${c["datetime"]}: O=${c["open"]}, H=${c["high"]}, L=${c["low"]}, C=${c["close"]}, V=${c["volume"]}`
  );
  return `PRICE HISTORY (last ${recent.length} bars):\n` + lines.join("\n");
}

function formatOptions(chain: Record<string, unknown>): string {
  const calls = chain["calls"] as Array<Record<string, unknown>> ?? [];
  const puts = chain["puts"] as Array<Record<string, unknown>> ?? [];
  const underlyingPrice = chain["underlyingPrice"];

  const formatContracts = (contracts: Array<Record<string, unknown>>, type: string): string => {
    const near = contracts.slice(0, 10);
    return `${type} (nearest 10):\n` + near.map(
      (c) => `Strike: $${c["strike"]}, Exp: ${c["expiration"]}, Bid: ${c["bid"]}, Ask: ${c["ask"]}, IV: ${c["iv"]}%, Delta: ${c["delta"]}, OI: ${c["openInterest"]}`
    ).join("\n");
  };

  return `OPTION CHAIN - Underlying: $${underlyingPrice}\n${formatContracts(calls, "CALLS")}\n\n${formatContracts(puts, "PUTS")}`;
}

function formatOptionsDetailed(chain: Record<string, unknown>): string {
  const calls = chain["calls"] as Array<Record<string, unknown>> ?? [];
  const puts = chain["puts"] as Array<Record<string, unknown>> ?? [];
  const underlyingPrice = chain["underlyingPrice"];

  const formatContracts = (contracts: Array<Record<string, unknown>>, type: string): string => {
    const near = contracts.slice(0, 20);
    return `${type} OPTIONS (nearest 20 strikes):\n` + near.map(
      (c) => `  Strike $${c["strike"]} | Exp: ${c["expiration"]} | DTE: ${c["dte"]} | Bid: $${c["bid"]} | Ask: $${c["ask"]} | Last: $${c["last"]} | IV: ${c["iv"]}% | Delta: ${c["delta"]} | Gamma: ${c["gamma"]} | Theta: ${c["theta"]} | Vega: ${c["vega"]} | Vol: ${c["volume"]} | OI: ${c["openInterest"]}`
    ).join("\n");
  };

  return `FULL OPTION CHAIN — Underlying Price: $${underlyingPrice}\n\n${formatContracts(calls, "CALL")}\n\n${formatContracts(puts, "PUT")}`;
}

router.get("/models", (_req, res) => {
  const data = GetAvailableModelsResponse.parse({ models: AVAILABLE_MODELS });
  res.json(data);
});

router.post("/technical-analysis", async (req, res) => {
  const parsed = RunTechnicalAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    return res.json(RunTechnicalAnalysisResponse.parse({ response: "Error: Invalid request body.", error: "validation_error" }));
  }

  const { quote, candles, model, temperature, customPrompt } = parsed.data;

  const prompt = `You are an expert financial analyst and technical trader. Analyze the following market data and provide detailed technical analysis.

${formatQuote(quote as Record<string, unknown>)}

${formatCandles((candles ?? []) as Array<Record<string, unknown>>)}

${customPrompt ? `ADDITIONAL CONTEXT: ${customPrompt}` : ""}

Please provide:
1. **Price Action Summary** - Key levels, trend direction, momentum
2. **Technical Indicators** - Analysis based on the price data (moving averages, support/resistance)
3. **Chart Patterns** - Any notable patterns detected
4. **Volume Analysis** - Volume trends and what they signal
5. **Risk Assessment** - Key risks and levels to watch
6. **Trading Outlook** - Short/medium term outlook with specific price targets

Be specific, data-driven, and concise. Use markdown formatting.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-pro", temperature ?? 0.3);
    res.json(RunTechnicalAnalysisResponse.parse({ response }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Technical analysis error");
    res.json(RunTechnicalAnalysisResponse.parse({ response: `**Analysis failed:** ${msg}`, error: msg }));
  }
});

router.post("/options-analysis", async (req, res) => {
  const parsed = RunOptionsAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    return res.json(RunOptionsAnalysisResponse.parse({ response: "Error: Invalid request body.", error: "validation_error" }));
  }

  const { quote, chain, model, temperature, customPrompt } = parsed.data;

  const prompt = `You are an expert options trader and derivatives analyst. Analyze the following options chain data.

${formatQuote(quote as Record<string, unknown>)}

${formatOptions(chain as Record<string, unknown>)}

${customPrompt ? `ADDITIONAL CONTEXT: ${customPrompt}` : ""}

Please provide:
1. **Implied Volatility Analysis** - IV levels, skew, term structure
2. **Options Flow** - Unusual activity, notable strikes, put/call analysis
3. **Key Levels** - Max pain, high OI strikes, major support/resistance via options
4. **Greeks Overview** - Delta, gamma exposure at key levels
5. **Strategy Suggestions** - 2-3 specific options strategies that make sense given current conditions (with strikes and rationale)
6. **Risk/Reward** - Risk assessment for each strategy

Be specific with strikes, expirations, and premium estimates. Use markdown formatting.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-pro", temperature ?? 0.3);
    res.json(RunOptionsAnalysisResponse.parse({ response }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Options analysis error");
    res.json(RunOptionsAnalysisResponse.parse({ response: `**Analysis failed:** ${msg}`, error: msg }));
  }
});

// ── LIVE MARKET PULSE: Symbol definitions ─────────────────────────────────────

const SCHWAB_API_BASE_PULSE = "https://api.schwabapi.com/marketdata/v1";

interface PulseSymbol {
  display: string;
  api: string;
  category: "equity" | "vol" | "breadth" | "futures" | "currency" | "commodity";
  description: string;
}

const PULSE_SYMBOLS: PulseSymbol[] = [
  { display: "SPY",   api: "SPY",    category: "equity",    description: "S&P 500 ETF — broad market barometer" },
  { display: "QQQ",   api: "QQQ",    category: "equity",    description: "Nasdaq-100 ETF — tech/growth leadership" },
  { display: "IWM",   api: "IWM",    category: "equity",    description: "Russell 2000 ETF — small-cap risk appetite" },
  { display: "$VIX",  api: "$VIX",   category: "vol",       description: "CBOE VIX — S&P implied vol (30-day), fear gauge" },
  { display: "$VVIX", api: "$VVIX",  category: "vol",       description: "VVIX — vol-of-vol, tail risk premium indicator" },
  { display: "$CPC",  api: "$CPC",   category: "vol",       description: "CBOE Put/Call Ratio — >1.0 fear, <0.7 complacency" },
  { display: "$TICK", api: "$TICK",  category: "breadth",   description: "NYSE TICK — stocks upticking minus downticking (intraday flow)" },
  { display: "$ADD",  api: "$ADD",   category: "breadth",   description: "NYSE A/D Line — advancers minus decliners (breadth)" },
  { display: "$TRIN", api: "$TRIN",  category: "breadth",   description: "TRIN/Arms Index — <1.0 bullish, >1.0 bearish distribution" },
  { display: "$DXY",  api: "$DXY",   category: "currency",  description: "US Dollar Index — dollar vs. major FX basket" },
  { display: "/ES",   api: "/ES",    category: "futures",   description: "E-mini S&P 500 Futures" },
  { display: "/NQ",   api: "/NQ",    category: "futures",   description: "E-mini Nasdaq-100 Futures" },
  { display: "/GC",   api: "/GC",    category: "commodity", description: "Gold Futures — safe-haven / real rates proxy" },
  { display: "/CL",   api: "/CL",    category: "commodity", description: "Crude Oil Futures — energy / risk appetite signal" },
];

async function fetchMacroPulseData(
  accessToken: string
): Promise<Map<string, Record<string, unknown>>> {
  const symbolsParam = PULSE_SYMBOLS.map(s => encodeURIComponent(s.api)).join(",");
  const url = `${SCHWAB_API_BASE_PULSE}/quotes?symbols=${symbolsParam}&fields=quote,fundamental,reference`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Schwab batch quote error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as Record<string, unknown>;
  const result = new Map<string, Record<string, unknown>>();

  for (const sym of PULSE_SYMBOLS) {
    const entry = json[sym.api] as Record<string, unknown> | undefined;
    const q = entry?.["quote"] as Record<string, unknown> | undefined;
    if (q) {
      result.set(sym.display, { ...q, _display: sym.display });
    }
  }

  return result;
}

function formatPulseSymbol(sym: PulseSymbol, data: Record<string, unknown> | undefined): string {
  if (!data) return `${sym.display}: NO DATA AVAILABLE`;

  const n = (k: string): string => {
    const v = data[k];
    if (typeof v === "number" && isFinite(v)) return String(v);
    return "N/A";
  };

  const last    = n("lastPrice") !== "N/A" ? n("lastPrice") : n("mark") !== "N/A" ? n("mark") : n("close");
  const chg     = n("netChange") !== "N/A" ? n("netChange") : n("markChange");
  const chgPct  = n("netPercentChange") !== "N/A" ? n("netPercentChange") : n("markPercentChange");
  const hi      = n("highPrice") !== "N/A" ? n("highPrice") : n("high");
  const lo      = n("lowPrice")  !== "N/A" ? n("lowPrice")  : n("low");
  const vol     = n("totalVolume") !== "N/A" ? n("totalVolume") : n("volume");

  const dir = chg !== "N/A" ? (Number(chg) > 0 ? "▲" : Number(chg) < 0 ? "▼" : "─") : "";

  let parts = [`Last: ${last}`];
  if (chg !== "N/A" && chgPct !== "N/A") {
    parts.push(`${dir} ${chg} (${Number(chgPct).toFixed(2)}%)`);
  }
  if (hi !== "N/A" && lo !== "N/A") parts.push(`Range: ${lo}–${hi}`);
  if (vol !== "N/A" && (sym.category === "equity" || sym.category === "futures" || sym.category === "commodity")) {
    parts.push(`Vol: ${Number(vol).toLocaleString()}`);
  }

  return `${sym.display} [${sym.description}]\n  ${parts.join(" | ")}`;
}

function buildPulseDataBlock(dataMap: Map<string, Record<string, unknown>>): string {
  const section = (cat: PulseSymbol["category"], header: string): string => {
    const syms = PULSE_SYMBOLS.filter(s => s.category === cat);
    const lines = syms.map(s => formatPulseSymbol(s, dataMap.get(s.display)));
    return `### ${header}\n${lines.join("\n")}`;
  };

  return [
    section("equity",    "── EQUITY INDICES ──"),
    section("vol",       "── VOLATILITY STRUCTURE ──"),
    section("breadth",   "── MARKET BREADTH (NYSE INTERNALS) ──"),
    section("currency",  "── MACRO / CURRENCIES ──"),
    section("futures",   "── EQUITY FUTURES ──"),
    section("commodity", "── COMMODITIES ──"),
  ].join("\n\n");
}

// ── MARKET SESSION DETECTION ─────────────────────────────────────────────────

function getMarketSession(): { session: string; timeET: string; sessionGuidance: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0");
  const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0");
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "Monday";
  const timeET = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`;
  const isWeekend = weekday === "Saturday" || weekday === "Sunday";
  const mins = hour * 60 + minute;

  let session: string;
  let sessionGuidance: string;

  if (isWeekend) {
    session = `Weekend (${weekday})`;
    sessionGuidance = "Markets are closed. Analyze the data as end-of-week positioning and provide a weekend outlook focused on what to watch for Monday's open. Discuss potential gap risk and key levels to monitor.";
  } else if (mins >= 240 && mins < 570) {
    session = "Pre-Market";
    sessionGuidance = "It is pre-market (4:00–9:30 AM ET). Focus on overnight futures, gap expectations, key pre-market movers, and how the data sets up for the opening bell. Traders need actionable prep for the open.";
  } else if (mins >= 570 && mins < 960) {
    session = "Regular Trading Hours";
    sessionGuidance = "Regular market hours are active (9:30 AM–4:00 PM ET). Provide a live intraday pulse — what is the market doing RIGHT NOW, momentum direction, key intraday levels, and whether to be aggressive or defensive into the close.";
  } else if (mins >= 960 && mins < 1200) {
    session = "After-Hours";
    sessionGuidance = "After-hours session (4:00–8:00 PM ET). Summarize how the regular session closed, key after-hours movers, and what the data implies for tomorrow's open. Help the trader plan overnight positioning.";
  } else {
    session = "Overnight";
    sessionGuidance = "Overnight session (8:00 PM–4:00 AM ET). Minimal liquidity. Focus on futures direction, overnight risk factors, and what to watch when pre-market opens. Be brief and focused on risk management.";
  }

  return { session, timeET, sessionGuidance };
}

router.post("/market-briefing", async (req, res) => {
  const { accessToken, model, temperature } = req.body as {
    accessToken?: string;
    model?: string;
    temperature?: number;
  };

  if (!accessToken) {
    return res.json({ response: "**Error:** Schwab access token required for Live Market Pulse.", error: "no_token" });
  }

  const { session, timeET, sessionGuidance } = getMarketSession();

  let dataBlock: string;
  try {
    const dataMap = await fetchMacroPulseData(accessToken);
    dataBlock = buildPulseDataBlock(dataMap);
  } catch (fetchErr: unknown) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    req.log.error({ err: fetchErr }, "Macro pulse data fetch error");
    return res.json({ response: `**Data Fetch Failed:** ${msg}`, error: msg });
  }

  const sessionLabel = session === "Regular Trading Hours" ? "Intraday"
    : session === "Pre-Market" ? "Open Prep"
    : session === "After-Hours" ? "After-Hours"
    : "Session";

  const prompt = `You are an elite Macro Prop Desk Analyst at a top-tier systematic hedge fund. Your job is to synthesize live multi-asset data into a precise, actionable market pulse used by senior traders. You think like a quant and write like a seasoned desk strategist.

═══════════════════════════════════════════════════════
LIVE MARKET PULSE — ${timeET} | SESSION: ${session}
═══════════════════════════════════════════════════════

SESSION DIRECTIVE: ${sessionGuidance}

═══════════════════════════════════════════════════════
LIVE MULTI-ASSET DATA FEED
═══════════════════════════════════════════════════════

${dataBlock}

═══════════════════════════════════════════════════════
ANALYTICAL FRAMEWORK — synthesize ALL data streams:

VOLATILITY STRUCTURE: Is VIX expanding or compressing? Is VVIX elevated (tail risk)? Does the Put/Call Ratio confirm institutional hedging or complacency?

MARKET BREADTH (NYSE INTERNALS): Is $TICK printing consistently above/below zero? Is the A/D Line ($ADD) confirming or diverging from price? Is $TRIN below 1.0 (bullish distribution) or above 1.0 (bearish volume flow)?

INTER-MARKET / MACRO: Is the dollar ($DXY) strengthening (headwind for risk assets) or weakening? Is Gold (/GC) bid (risk-off) or offered (risk-on)? Is Crude (/CL) signaling demand expansion or contraction?

EQUITY FUTURES vs CASH: Are /ES and /NQ leading or lagging the cash ETFs? Any premium/discount in futures suggesting directional intent?

CROSS-ASSET CONFIRMATION: Do all data streams CONFIRM the same narrative? Or are there DIVERGENCES that signal a trap or reversal risk?
═══════════════════════════════════════════════════════

Deliver your Live Market Pulse using EXACTLY this structure:

## ⚡ Live Market Pulse — ${session}
**One sentence. Maximum conviction. Current macro verdict.**

## 🎯 Macro Posture
**[RISK-ON / RISK-OFF / NEUTRAL / DETERIORATING / RECOVERING]** — 2 sentences explaining the regime using the specific data provided.

## 📊 Multi-Asset Synthesis
- **Equity Internals (SPY/QQQ/IWM):** [Leadership, divergences, relative strength]
- **Volatility Regime (VIX/VVIX/CPC):** [Vol structure — expanding, compressing, complacent, or fearful]
- **Breadth (TICK/ADD/TRIN):** [Is breadth confirming price action or diverging — institutional flow read]
- **Macro/FX/Commodities (DXY/Gold/Crude):** [Risk-on or risk-off signals from inter-market]
- **Futures (/ES//NQ):** [Pre-cash session bias or after-hours directional intent]

## 🔥 Primary Risk Vector
The single highest-conviction risk right now. Name the specific data point driving it. One focused paragraph.

## 💡 ${sessionLabel} Trading Bias
Specific and actionable. Preferred setup, key levels, directional lean. Mention the specific instrument and price level. (e.g., "Lean long /ES above [level] with hard stop at [level]; avoid chasing QQQ without breadth confirmation from $ADD > +500.")

Keep the entire output under 450 words. Be technically precise, data-driven, and immediately actionable. No filler. Use markdown.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-pro", temperature ?? 0.2);
    res.json({ response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Market pulse error");
    res.json({ response: `**Live Market Pulse failed:** ${msg}`, error: msg });
  }
});

router.post("/options-strategist", async (req, res) => {
  const { quote, candles, chain, model, temperature } = req.body as {
    quote?: Record<string, unknown>;
    candles?: Array<Record<string, unknown>>;
    chain?: Record<string, unknown>;
    model?: string;
    temperature?: number;
  };

  if (!quote || !chain) {
    return res.json({ response: "Error: Missing quote or options chain data.", error: "missing_data" });
  }

  // Compute SMA-20 and SMA-50 from candle data
  let sma20 = "N/A", sma50 = "N/A";
  if (candles && candles.length >= 20) {
    const closes = candles.map(c => Number(c["close"])).filter(v => !isNaN(v));
    if (closes.length >= 20) {
      sma20 = (closes.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(2);
    }
    if (closes.length >= 50) {
      sma50 = (closes.slice(-50).reduce((a, b) => a + b, 0) / 50).toFixed(2);
    }
  }

  const prompt = `You are a Master Derivatives Strategist with 20+ years of options trading experience. Your analysis must be precise, actionable, and risk-calibrated.

UNDERLYING MARKET DATA:
${formatQuote(quote)}
Technical Levels: SMA-20 = $${sma20} | SMA-50 = $${sma50}

${formatOptionsDetailed(chain)}

---
TASK: Generate high-confidence options trade recommendations for 3 timeframes. For each, identify the OPTIMAL structure (Iron Condor, Bull Call Spread, Bear Put Spread, Straddle, Strangle, Butterfly, Cash-Secured Put, Covered Call, or Calendar Spread).

Use EXACTLY this format for each trade:

### ⏱️ 0DTE — [STRUCTURE NAME]
**Direction:** 🟢 Bullish / 🔴 Bearish / ⚪ Neutral
**Confidence:** 🔥 HIGH / 🟡 MILD / 🔵 LOW
**Legs:** Buy [Strike] Call/Put, Sell [Strike] Call/Put (expiring [date])
**Entry:** Estimated debit/credit of ~$X.XX per contract
**Max Risk:** $XXX | **Max Reward:** $XXX | **R/R Ratio:** X:1
**Rationale:** One precise sentence on why this structure fits current price action, IV, and positioning.
**Exit Rules:** Profit target at X% gain; stop loss at Y% loss or [trigger condition].

---

### ⏱️ 7DTE — [STRUCTURE NAME]
[same format]

---

### ⏱️ 30DTE — [STRUCTURE NAME]
[same format]

---

## ⚠️ Key Risk Factors
- **Risk 1:** (e.g., IV crush post-catalyst, pin risk near expiration)
- **Risk 2:** (e.g., gap risk, liquidity at specific strikes)

Use only strikes that exist in the provided chain data. Be precise with numbers. Use markdown with green indicators (🟢) for bullish/calls and red (🔴) for bearish/puts.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-pro", temperature ?? 0.2);
    res.json({ response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Options strategist error");
    res.json({ response: `**Strategist failed:** ${msg}`, error: msg });
  }
});

router.post("/chat", async (req, res) => {
  const parsed = RunChatQueryBody.safeParse(req.body);
  if (!parsed.success) {
    return res.json(RunChatQueryResponse.parse({ response: "Error: Invalid request body.", error: "validation_error" }));
  }

  const { question, marketContext, model, temperature } = parsed.data;

  const prompt = `You are an expert financial analyst and trading assistant for Alpha Terminal.

${marketContext ? `CURRENT MARKET CONTEXT:\n${marketContext}\n` : "No market data currently loaded."}

USER QUESTION: ${question}

Provide a concise, expert answer. Be specific and data-driven when market data is available. Use markdown formatting where helpful.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-pro", temperature ?? 0.3);
    res.json(RunChatQueryResponse.parse({ response }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Chat query error");
    res.json(RunChatQueryResponse.parse({ response: `**Query failed:** ${msg}`, error: msg }));
  }
});

const SCHWAB_API_BASE_AI = "https://api.schwabapi.com/marketdata/v1";

interface ScannerQuote {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  volume: number;
  high: number;
  low: number;
}

interface ScannerSetup {
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: "HIGH" | "MILD" | "LOW";
  strategy: string;
  price: number;
  changePct: number;
  rationale: string;
  riskNote: string;
}

interface ScannerAiResult {
  setups: ScannerSetup[];
  marketSummary: string;
}

router.post("/market-scanner", async (req, res) => {
  const { symbols, accessToken, mode, filters, model, temperature, maxResults } = req.body as {
    symbols: string[];
    accessToken: string;
    mode: "ai" | "manual";
    filters?: {
      minChangePct?: number;
      maxChangePct?: number;
      minVolume?: number;
      minPrice?: number;
      maxPrice?: number;
    };
    model?: string;
    temperature?: number;
    maxResults?: number;
  };

  const resultCount = Math.min(Math.max(maxResults ?? 10, 1), 20);

  if (!symbols?.length || !accessToken) {
    return res.status(400).json({ error: "symbols and accessToken are required" });
  }

  const symbolList = symbols.join(",");
  let quotes: ScannerQuote[] = [];

  try {
    const schwabRes = await fetch(
      `${SCHWAB_API_BASE_AI}/quotes?symbols=${encodeURIComponent(symbolList)}&fields=quote`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (schwabRes.status === 401) {
      return res.json({ error: "unauthorized", quotes: [] });
    }

    if (schwabRes.ok) {
      const json = await schwabRes.json() as Record<string, unknown>;
      quotes = symbols
        .map(sym => {
          const entry = json[sym] as Record<string, unknown> | undefined;
          const q = entry?.["quote"] as Record<string, unknown> | undefined;
          if (!q) return null;
          return {
            symbol: sym,
            last: (q["lastPrice"] as number) ?? 0,
            change: (q["netChange"] as number) ?? 0,
            changePct: (q["netPercentChangeInDouble"] as number) ?? 0,
            volume: (q["totalVolume"] as number) ?? 0,
            high: (q["highPrice"] as number) ?? 0,
            low: (q["lowPrice"] as number) ?? 0,
          };
        })
        .filter((q): q is ScannerQuote => q !== null && q.last > 0);
    }
  } catch (err) {
    req.log.error({ err }, "Market scanner Schwab fetch error");
    return res.json({ error: "schwab_fetch_failed", quotes: [] });
  }

  if (mode === "manual") {
    const {
      minChangePct = -100, maxChangePct = 100,
      minVolume = 0, minPrice = 0, maxPrice = 999999,
    } = filters ?? {};

    const filtered = quotes.filter(q =>
      q.changePct >= minChangePct &&
      q.changePct <= maxChangePct &&
      q.volume >= minVolume * 1_000_000 &&
      q.last >= minPrice &&
      q.last <= maxPrice
    ).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    return res.json({ mode: "manual", quotes: filtered });
  }

  // AI mode
  if (!quotes.length) {
    return res.json({ mode: "ai", error: "no_data", response: "No quote data available to analyze.", setups: [] });
  }

  // Sort by absolute change % to surface the most interesting movers
  const sortedQuotes = [...quotes].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 30);

  const tableRows = sortedQuotes.map(q =>
    `${q.symbol.padEnd(6)} | $${q.last.toFixed(2).padStart(9)} | ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}% | Vol: ${(q.volume / 1e6).toFixed(1)}M | Range: ${q.low.toFixed(2)}-${q.high.toFixed(2)}`
  ).join("\n");

  const prompt = `You are an elite quantitative trader with 20+ years of systematic trading experience. You have been given real-time L1 market data for ${sortedQuotes.length} actively traded stocks.

REAL-TIME MARKET DATA (sorted by momentum):
Symbol | Last Price | Day Change | Volume  | Day Range
${tableRows}

YOUR TASK: Analyze this data and identify the TOP ${resultCount} highest-probability trading setups right now.

STRICT RULES:
1. Return EXACTLY ${resultCount} setups — no more, no less
2. Each setup must have a clear DIRECTION: BULLISH, BEARISH, or NEUTRAL
3. NEUTRAL = low volatility, range-bound, ideal for Iron Condor/Butterfly/Strangle
4. Confidence must be: HIGH (strong multi-factor confluence), MILD (moderate signals), or LOW (speculative)
5. Only choose HIGH confidence when multiple technical factors align
6. Your response must be valid JSON only — no markdown, no commentary before or after

Return this exact JSON structure:
{
  "setups": [
    {
      "symbol": "TICKER",
      "direction": "BULLISH",
      "confidence": "HIGH",
      "strategy": "Bull Call Spread / Long Calls / Short Puts",
      "price": 123.45,
      "changePct": 2.34,
      "rationale": "One precise sentence: specific technical reason this setup has edge (momentum, volume spike, breakout, etc.)",
      "riskNote": "One brief risk: what could invalidate this setup."
    }
  ],
  "marketSummary": "One sentence: overall market regime (risk-on/risk-off, trending/ranging, sector rotation)."
}`;

  try {
    const raw = await callGemini(prompt, model ?? "gemini-2.5-pro", temperature ?? 0.1);

    // Try to parse JSON — strip any markdown fences Gemini may wrap around it
    const cleaned = raw.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/im, "").trim();
    let parsed: ScannerAiResult | null = null;
    try {
      parsed = JSON.parse(cleaned) as ScannerAiResult;
    } catch {
      // If JSON parsing fails, return raw response
      return res.json({ mode: "ai", rawResponse: raw, setups: [], quotes });
    }

    return res.json({ mode: "ai", setups: parsed.setups ?? [], marketSummary: parsed.marketSummary ?? "", quotes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Market scanner AI error");
    return res.json({ mode: "ai", error: msg, setups: [], quotes });
  }
});

export default router;
