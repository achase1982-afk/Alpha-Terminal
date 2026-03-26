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

router.post("/market-briefing", async (req, res) => {
  const { spyQuote, qqqQuote, iwmQuote, vixQuote, model, temperature } = req.body as {
    spyQuote?: Record<string, unknown>;
    qqqQuote?: Record<string, unknown>;
    iwmQuote?: Record<string, unknown>;
    vixQuote?: Record<string, unknown>;
    model?: string;
    temperature?: number;
  };

  const prompt = `You are a senior market strategist at a top-tier hedge fund. Based on the following real-time market data, deliver a concise Pre-Market Overview assessing the current market posture.

REAL-TIME MARKET DATA:
${spyQuote ? `SPY (S&P 500 ETF):\n${formatQuote(spyQuote)}` : "SPY: N/A"}

${qqqQuote ? `QQQ (Nasdaq-100 ETF):\n${formatQuote(qqqQuote)}` : "QQQ: N/A"}

${iwmQuote ? `IWM (Russell 2000 ETF):\n${formatQuote(iwmQuote)}` : "IWM: N/A"}

${vixQuote ? `VIX (Volatility Index):\n${formatQuote(vixQuote)}` : "VIX: N/A"}

---
Provide a structured briefing using EXACTLY this format:

## 🎯 Market Posture
State the overall market stance: **[BULLISH / BEARISH / NEUTRAL]** — one bold conviction sentence.

## 📊 Key Observations
- Observation 1 (breadth, momentum, or macro signal)
- Observation 2 (relative strength/weakness across indices)
- Observation 3 (volatility regime or risk-off/risk-on signal)

## ⚡ Sector Focus
Which indices are leading and which are lagging. Note any divergence between SPY/QQQ/IWM.

## 🎲 Risk Factors
- Risk 1 (intraday risk)
- Risk 2 (structural risk)

## 💡 Trading Bias
A concrete, actionable bias for the session. Be specific (e.g., "Favor long setups on pullbacks to SPY $X, avoid chasing").

Keep it under 300 words. Be sharp, data-driven, and professional. Use markdown.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-pro", temperature ?? 0.2);
    res.json({ response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Market briefing error");
    res.json({ response: `**Briefing failed:** ${msg}`, error: msg });
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
  const { symbols, accessToken, mode, filters, model, temperature } = req.body as {
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
  };

  if (!symbols?.length || !accessToken) {
    return res.status(400).json({ error: "symbols and accessToken are required" });
  }

  // Batch fetch all quotes in a single Schwab API call
  const symbolList = symbols.slice(0, 50).join(",");
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

YOUR TASK: Analyze this data and identify the TOP 3 highest-probability trading setups right now.

STRICT RULES:
1. Return EXACTLY 3 setups — no more, no less
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
