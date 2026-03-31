import { Router, type IRouter } from "express";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  RunTechnicalAnalysisBody,
  RunTechnicalAnalysisResponse,
  RunOptionsAnalysisBody,
  RunOptionsAnalysisResponse,
  RunChatQueryBody,
  RunChatQueryResponse,
  GetAvailableModelsResponse,
} from "@workspace/api-zod";
import { computeIndicators, formatTAContext, isDataStale, type Candle } from "../lib/ta.js";
import { runMarketPulseEngine, type MarketIndicators, type BiasLabel } from "../lib/marketPulseEngine.js";

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
  modelName: string = "gemini-2.5-flash",
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

// ── Options chain data sanitization ──────────────────────────────────────────
// Schwab uses sentinel values like -999 for missing IV on illiquid/expiring strikes.
// Inverted bid/ask (bid > ask) also signals stale or broken quotes.
// We sanitize before passing to AI so it never sees corrupted-looking numbers.
function sanitizeContracts(
  contracts: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return contracts
    .filter((c) => {
      const bid = Number(c["bid"]);
      const ask = Number(c["ask"]);
      // Drop contracts with a clearly inverted spread (bid > ask and both > 0)
      if (!isNaN(bid) && !isNaN(ask) && bid > 0 && ask > 0 && bid > ask) return false;
      return true;
    })
    .map((c) => {
      const iv = Number(c["iv"]);
      // Replace any negative IV sentinel (e.g. -999, -1) with null so formatters show N/A
      return { ...c, iv: isNaN(iv) || iv < 0 ? null : iv };
    });
}

function formatOptions(chain: Record<string, unknown>): string {
  const rawCalls = chain["calls"] as Array<Record<string, unknown>> ?? [];
  const rawPuts  = chain["puts"]  as Array<Record<string, unknown>> ?? [];
  const underlyingPrice = chain["underlyingPrice"];

  const formatContracts = (contracts: Array<Record<string, unknown>>, type: string): string => {
    const clean = sanitizeContracts(contracts).slice(0, 10);
    return `${type} (nearest 10):\n` + clean.map(
      (c) => {
        const iv = c["iv"] != null ? `${c["iv"]}%` : "N/A";
        return `Strike: $${c["strike"]}, Exp: ${c["expiration"]}, Bid: ${c["bid"]}, Ask: ${c["ask"]}, IV: ${iv}, Delta: ${c["delta"]}, OI: ${c["openInterest"]}`;
      }
    ).join("\n");
  };

  return `OPTION CHAIN - Underlying: $${underlyingPrice}\n${formatContracts(rawCalls, "CALLS")}\n\n${formatContracts(rawPuts, "PUTS")}`;
}

function formatOptionsDetailed(chain: Record<string, unknown>): string {
  const rawCalls = chain["calls"] as Array<Record<string, unknown>> ?? [];
  const rawPuts  = chain["puts"]  as Array<Record<string, unknown>> ?? [];
  const underlyingPrice = chain["underlyingPrice"];

  const formatContracts = (contracts: Array<Record<string, unknown>>, type: string): string => {
    const clean = sanitizeContracts(contracts);

    const byExp = new Map<string, Array<Record<string, unknown>>>();
    for (const c of clean) {
      const exp = String(c["expiration"] ?? "unknown");
      if (!byExp.has(exp)) byExp.set(exp, []);
      byExp.get(exp)!.push(c);
    }

    const sortedExps = [...byExp.entries()].sort((a, b) => {
      const dteA = Number(a[1][0]?.["dte"] ?? 999);
      const dteB = Number(b[1][0]?.["dte"] ?? 999);
      return dteA - dteB;
    });
    const limitedExps = sortedExps.slice(0, 3);

    const sections: string[] = [];
    for (const [exp, group] of limitedExps) {
      const dte = group[0]?.["dte"] ?? "?";
      const nearest = group.slice(0, 10);
      const lines = nearest.map((c) => {
        const iv = c["iv"] != null ? `${c["iv"]}%` : "N/A";
        return `  Strike $${c["strike"]} | Bid: $${c["bid"]} | Ask: $${c["ask"]} | Last: $${c["last"]} | IV: ${iv} | Delta: ${c["delta"]} | Gamma: ${c["gamma"]} | Theta: ${c["theta"]} | Vega: ${c["vega"]} | Vol: ${c["volume"]} | OI: ${c["openInterest"]}`;
      });
      sections.push(`${type} — Exp: ${exp} (${dte} DTE) [${nearest.length} of ${group.length} strikes]\n${lines.join("\n")}`);
    }
    return sections.join("\n\n");
  };

  const expirations = new Set<string>();
  for (const c of rawCalls) expirations.add(String((c as Record<string, unknown>)["expiration"] ?? ""));
  for (const c of rawPuts) expirations.add(String((c as Record<string, unknown>)["expiration"] ?? ""));

  return `FULL OPTION CHAIN — Underlying Price: $${underlyingPrice} | ${expirations.size} expiration(s) available\n\n${formatContracts(rawCalls, "CALL")}\n\n${formatContracts(rawPuts, "PUT")}`;
}

const OPTIONS_DATA_QUALITY_NOTE = `DATA QUALITY NOTE: This chain has been pre-sanitized. Strikes with inverted bid/ask spreads have been removed. Any IV shown as "N/A" indicates missing or invalid data — this is normal for deep OTM/ITM strikes, expiring contracts, and illiquid series. Do NOT interpret N/A IV values, wide bid/ask spreads, or zero-volume strikes as data corruption or system errors. They reflect standard market illiquidity and should be acknowledged as such, not flagged as risk factors.`;

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

  const prompt = `You are an expert financial analyst and technical trader.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below for any claims about price levels, trends, momentum, support/resistance, or market direction. You are FORBIDDEN from using your internal training knowledge for market trends, price targets, or directional calls. If the data is insufficient for a conclusion, say "Insufficient data" — do NOT fabricate or supplement with internal knowledge.

═══ CONTEXT DATA ═══
${formatQuote(quote as Record<string, unknown>)}

${formatCandles((candles ?? []) as Array<Record<string, unknown>>)}
═══ END CONTEXT DATA ═══

${customPrompt ? `ADDITIONAL CONTEXT: ${customPrompt}` : ""}

Analyze ONLY the above data and provide:
1. **Price Action Summary** - Key levels, trend direction, momentum
2. **Technical Indicators** - Analysis based on the price data (moving averages, support/resistance)
3. **Chart Patterns** - Any notable patterns detected
4. **Volume Analysis** - Volume trends and what they signal
5. **Risk Assessment** - Key risks and levels to watch
6. **Trading Outlook** - Short/medium term outlook with specific price targets

Be specific, data-driven, and concise. Use markdown formatting.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-flash", temperature ?? 0.3);
    res.json(RunTechnicalAnalysisResponse.parse({ response }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Technical analysis error");
    res.json(RunTechnicalAnalysisResponse.parse({ response: `**Analysis failed:** ${msg}`, error: msg }));
  }
});

router.post("/technical-analysis/stream", async (req, res) => {
  const parsed = RunTechnicalAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body." });
  }

  const { quote, candles, model, temperature, customPrompt } = parsed.data;

  const prompt = `You are an expert financial analyst and technical trader.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below for any claims about price levels, trends, momentum, support/resistance, or market direction. You are FORBIDDEN from using your internal training knowledge for market trends, price targets, or directional calls. If the data is insufficient for a conclusion, say "Insufficient data" — do NOT fabricate or supplement with internal knowledge.

═══ CONTEXT DATA ═══
${formatQuote(quote as Record<string, unknown>)}

${formatCandles((candles ?? []) as Array<Record<string, unknown>>)}
═══ END CONTEXT DATA ═══

${customPrompt ? `ADDITIONAL CONTEXT: ${customPrompt}` : ""}

Analyze ONLY the above data and provide:
1. **Price Action Summary** - Key levels, trend direction, momentum
2. **Technical Indicators** - Analysis based on the price data (moving averages, support/resistance)
3. **Chart Patterns** - Any notable patterns detected
4. **Volume Analysis** - Volume trends and what they signal
5. **Risk Assessment** - Key risks and levels to watch
6. **Trading Outlook** - Short/medium term outlook with specific price targets

Be specific, data-driven, and concise. Use markdown formatting.`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  req.socket?.setKeepAlive(true);
  req.setTimeout(0);
  res.setTimeout(0);
  if (req.socket) req.socket.setTimeout(0);
  res.write(": ok\n\n");
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": ping\n\n");
    }
  }, 5000);

  try {
    const google = createGoogleGenerativeAI({ apiKey });
    const chosenModel = model ?? "gemini-2.5-flash";
    const result = streamText({
      model: google(chosenModel),
      prompt,
      temperature: temperature ?? 0.3,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 2048 } },
      },
    });

    for await (const part of result.fullStream) {
      const p = part as any;
      const delta = p.textDelta ?? p.text;
      if (part.type === "reasoning" && delta) {
        res.write(`data: ${JSON.stringify({ reasoning: delta })}\n\n`);
      } else if (part.type === "text-delta" && delta) {
        res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
      }
    }
    clearInterval(heartbeat);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: unknown) {
    clearInterval(heartbeat);
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Technical analysis stream error");
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

router.post("/options-analysis", async (req, res) => {
  const parsed = RunOptionsAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    return res.json(RunOptionsAnalysisResponse.parse({ response: "Error: Invalid request body.", error: "validation_error" }));
  }

  const { quote, chain, model, temperature, customPrompt } = parsed.data;

  const prompt = `You are an expert options trader and derivatives analyst.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below for any claims about IV levels, skew, flow, strikes, greeks, or directional bias. You are FORBIDDEN from using your internal training knowledge for market trends, price predictions, or directional calls. Every number you cite must come from the data below. If the data is insufficient, say "Insufficient data" — do NOT fabricate.

═══ CONTEXT DATA ═══
${OPTIONS_DATA_QUALITY_NOTE}

${formatQuote(quote as Record<string, unknown>)}

${formatOptions(chain as Record<string, unknown>)}
═══ END CONTEXT DATA ═══

${customPrompt ? `ADDITIONAL CONTEXT: ${customPrompt}` : ""}

Analyze ONLY the above data and provide:
1. **Implied Volatility Analysis** - IV levels, skew, term structure
2. **Options Flow** - Unusual activity, notable strikes, put/call analysis
3. **Key Levels** - Max pain, high OI strikes, major support/resistance via options
4. **Greeks Overview** - Delta, gamma exposure at key levels
5. **Strategy Suggestions** - 2-3 specific options strategies that make sense given current conditions (with strikes and rationale)
6. **Risk/Reward** - Risk assessment for each strategy

Be specific with strikes, expirations, and premium estimates. Use markdown formatting.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-flash", temperature ?? 0.3);
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
  category: "equity" | "vol" | "breadth" | "futures" | "currency" | "commodity" | "rates" | "credit";
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
  { display: "$TNX",  api: "$TNX",   category: "rates",     description: "10-Year Treasury Yield Index" },
  { display: "$TYX",  api: "$TYX",   category: "rates",     description: "30-Year Treasury Yield Index" },
  { display: "$VIX9D", api: "$VIX9D", category: "vol",      description: "CBOE 9-Day VIX — near-term implied vol" },
  { display: "$VIX3M", api: "$VIX3M", category: "vol",      description: "CBOE 3-Month VIX — medium-term implied vol" },
  { display: "$SKEW", api: "$SKEW",  category: "vol",       description: "CBOE SKEW — tail risk / crash hedging indicator" },
  { display: "HYG",   api: "HYG",    category: "credit",    description: "iShares High Yield Corporate Bond ETF — credit risk appetite" },
  { display: "LQD",   api: "LQD",    category: "credit",    description: "iShares Investment Grade Corporate Bond ETF" },
  { display: "IEF",   api: "IEF",    category: "credit",    description: "iShares 7-10 Year Treasury Bond ETF" },
  { display: "$ADVN", api: "$ADVN",  category: "breadth",   description: "NYSE Advancing Issues — breadth count" },
  { display: "$DECN", api: "$DECN",  category: "breadth",   description: "NYSE Declining Issues — breadth count" },
  // $UVOL and $DVOL removed -- Schwab does not serve these symbols.
  // If a secondary data source (e.g. IQFeed) is added later, re-enable here.
];

// Maps user-facing symbols to Schwab API format (adds $ prefix for known indices)
const INDEX_TO_SCHWAB: Record<string, string> = {
  "VIX": "$VIX", "VVIX": "$VVIX", "SPX": "$SPX", "NDX": "$NDX",
  "RUT": "$RUT", "DJI": "$DJI", "DJIA": "$DJI", "COMP": "$COMP",
  "DXY": "$DXY", "TNX": "$TNX", "TYX": "$TYX", "VXN": "$VXN",
  "TICK": "$TICK", "ADD": "$ADD", "TRIN": "$TRIN", "CPC": "$CPC",
  "OEX": "$OEX", "MNX": "$MNX", "XSP": "$XSP",
  "VIX9D": "$VIX9D", "VIX3M": "$VIX3M", "SKEW": "$SKEW",
  "ADVN": "$ADVN", "DECN": "$DECN",
};

function symbolToSchwabApi(userSymbol: string): string {
  const upper = userSymbol.toUpperCase().trim().replace(/\.X$/, "");
  return INDEX_TO_SCHWAB[upper] ?? upper;
}

async function fetchMacroPulseData(
  accessToken: string,
  userSymbols?: string[]
): Promise<{ displayToApi: Map<string, string>; dataMap: Map<string, Record<string, unknown>> }> {
  let pairs: Array<{ display: string; api: string }>;

  if (userSymbols && userSymbols.length > 0) {
    pairs = userSymbols.map(s => ({
      display: s.toUpperCase().trim(),
      api: symbolToSchwabApi(s),
    }));
  } else {
    pairs = PULSE_SYMBOLS.map(s => ({ display: s.display, api: s.api }));
  }

  const symbolsParam = pairs.map(p => encodeURIComponent(p.api)).join(",");
  const url = `${SCHWAB_API_BASE_PULSE}/quotes?symbols=${symbolsParam}&fields=quote,fundamental,reference`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Schwab batch quote error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as Record<string, unknown>;
  const displayToApi = new Map<string, string>(pairs.map(p => [p.display, p.api]));
  const dataMap = new Map<string, Record<string, unknown>>();

  for (const pair of pairs) {
    const entry = (json[pair.api] ?? json[pair.display]) as Record<string, unknown> | undefined;
    const q = entry?.["quote"] as Record<string, unknown> | undefined;
    if (q) {
      dataMap.set(pair.display, { ...q });
    }
  }

  return { displayToApi, dataMap };
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

function extractQuoteFields(data: Record<string, unknown>): {
  last: string; chg: string; chgPct: string; hi: string; lo: string; vol: string;
} {
  const n = (k: string): string => {
    const v = data[k];
    return typeof v === "number" && isFinite(v) ? String(v) : "N/A";
  };
  return {
    last:   [n("lastPrice"), n("mark"), n("close")].find(v => v !== "N/A") ?? "N/A",
    chg:    [n("netChange"), n("markChange")].find(v => v !== "N/A") ?? "N/A",
    chgPct: [n("netPercentChange"), n("markPercentChange")].find(v => v !== "N/A") ?? "N/A",
    hi:     [n("highPrice"), n("high")].find(v => v !== "N/A") ?? "N/A",
    lo:     [n("lowPrice"), n("low")].find(v => v !== "N/A") ?? "N/A",
    vol:    [n("totalVolume"), n("volume")].find(v => v !== "N/A") ?? "N/A",
  };
}

function buildPulseDataBlock(
  dataMap: Map<string, Record<string, unknown>>,
  userSymbols?: string[]
): string {
  // Dynamic path: user-specified symbols, flat list (no category grouping)
  if (userSymbols && userSymbols.length > 0) {
    const lines = userSymbols.map(sym => {
      const display = sym.toUpperCase().trim();
      const data = dataMap.get(display);
      if (!data) return `${display}: NO DATA AVAILABLE`;
      const { last, chg, chgPct, hi, lo, vol } = extractQuoteFields(data);
      const dir = chg !== "N/A" ? (Number(chg) > 0 ? "▲" : Number(chg) < 0 ? "▼" : "─") : "";
      const parts = [`Last: ${last}`];
      if (chg !== "N/A") parts.push(`${dir}${chg} (${Number(chgPct).toFixed(2)}%)`);
      if (hi !== "N/A" && lo !== "N/A") parts.push(`Range: ${lo}–${hi}`);
      if (vol !== "N/A") parts.push(`Vol: ${Number(vol).toLocaleString()}`);
      return `${display}: ${parts.join(" | ")}`;
    });
    return `### LIVE MULTI-ASSET DATA (${userSymbols.length} instruments)\n${lines.join("\n")}`;
  }

  // Default categorized path (using predefined PULSE_SYMBOLS with descriptions)
  const section = (cat: PulseSymbol["category"], header: string): string => {
    const syms = PULSE_SYMBOLS.filter(s => s.category === cat);
    const lines = syms.map(s => formatPulseSymbol(s, dataMap.get(s.display)));
    return `### ${header}\n${lines.join("\n")}`;
  };

  return [
    section("equity",    "── EQUITY INDICES ──"),
    section("vol",       "── VOLATILITY STRUCTURE ──"),
    section("rates",     "── RATES / TREASURIES ──"),
    section("credit",    "── CREDIT / FIXED INCOME ──"),
    section("breadth",   "── MARKET BREADTH (NYSE INTERNALS) ──"),
    section("currency",  "── MACRO / CURRENCIES ──"),
    section("futures",   "── EQUITY FUTURES ──"),
    section("commodity", "── COMMODITIES ──"),
  ].join("\n\n");
}

function extractMarketIndicators(dataMap: Map<string, Record<string, unknown>>): MarketIndicators {
  const num = (sym: string, field: string): number | null => {
    const entry = dataMap.get(sym) ?? dataMap.get(sym.replace(/^\$/, ''));
    if (!entry) return null;
    const v = entry[field];
    return typeof v === 'number' && isFinite(v) ? v : null;
  };

  const lastOrMark = (sym: string): number | null => {
    return num(sym, 'lastPrice') ?? num(sym, 'mark') ?? num(sym, 'closePrice') ?? num(sym, 'close') ?? null;
  };

  const pctChange = (sym: string): number | null => {
    return num(sym, 'netPercentChange') ?? num(sym, 'markPercentChange') ?? null;
  };

  // BUG FIX 1: TNX and TYX — Schwab quotes yield indices as (yield% × 10).
  // e.g. TNX=43.42 → actual 10Y yield = 4.342%. Divide by 10 for real-world units.
  const yieldIndex = (sym: string): number | null => {
    const raw = lastOrMark(sym);
    if (raw === null) return null;
    // Values clearly in ×10 format (e.g. 43.42 for 4.342%). Normalize to actual %.
    return raw > 10 ? Math.round((raw / 10) * 10000) / 10000 : raw;
  };

  // BUG FIX 2: UVOL/DVOL sentinel guard now handled in schwabStreamer.ts pick() function.
  // safeVol helper removed — $UVOL/$DVOL no longer polled.

  // BUG FIX 3: ADD — Schwab's $ADD intraday net A/D often returns 0 when no real
  // tick is available. Fall back to computing ADVN − DECN from the same snapshot.
  const advn = lastOrMark('$ADVN');
  const decn = lastOrMark('$DECN');
  const addRaw = lastOrMark('$ADD');
  const add = (addRaw !== null && addRaw !== 0)
    ? addRaw
    : (advn !== null && decn !== null ? advn - decn : null);

  return {
    vix: lastOrMark('$VIX'),
    vixChange: pctChange('$VIX'),
    vvix: lastOrMark('$VVIX'),
    vvixChange: pctChange('$VVIX'),
    vix3m: lastOrMark('$VIX3M'),
    vix3mChange: pctChange('$VIX3M'),
    vix9d: lastOrMark('$VIX9D'),
    vix9dChange: pctChange('$VIX9D'),
    skew: lastOrMark('$SKEW'),

    // BUG FIX 1 applied: yields in actual % (e.g. 4.342 not 43.42)
    tnx: yieldIndex('$TNX'),
    tnxChange: pctChange('$TNX'),
    tyx: yieldIndex('$TYX'),
    tyxChange: pctChange('$TYX'),

    hyg: lastOrMark('HYG'),
    hygChange: pctChange('HYG'),
    lqd: lastOrMark('LQD'),
    lqdChange: pctChange('LQD'),
    ief: lastOrMark('IEF'),
    iefChange: pctChange('IEF'),
    nyicdx: null,
    nyicdxChange: null,

    advn,
    decn,
    tick: lastOrMark('$TICK'),
    trin: lastOrMark('$TRIN'),
    add, // BUG FIX 3 applied: computed from ADVN−DECN if API returns 0

    // $UVOL and $DVOL removed -- Schwab does not serve these symbols.
    // If a secondary data source (e.g. IQFeed) is added later, re-enable here.
  };
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
  const { accessToken, symbols, model, temperature } = req.body as {
    accessToken?: string;
    symbols?: string[];
    model?: string;
    temperature?: number;
  };

  if (!accessToken) {
    return res.json({ response: "**Error:** Schwab access token required for Live Market Pulse.", error: "no_token" });
  }

  const { session, timeET, sessionGuidance } = getMarketSession();

  let dataBlock: string;
  try {
    const { dataMap } = await fetchMacroPulseData(accessToken, symbols);
    dataBlock = buildPulseDataBlock(dataMap, symbols && symbols.length > 0 ? symbols : undefined);
  } catch (fetchErr: unknown) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    req.log.error({ err: fetchErr }, "Macro pulse data fetch error");
    return res.json({ response: `**Data Fetch Failed:** ${msg}`, error: msg });
  }

  const sessionLabel = session === "Regular Trading Hours" ? "Intraday"
    : session === "Pre-Market" ? "Open Prep"
    : session === "After-Hours" ? "After-Hours"
    : "Session";

  const symbolList = symbols && symbols.length > 0
    ? symbols.map(s => s.toUpperCase().trim()).join(", ")
    : PULSE_SYMBOLS.map(s => s.display).join(", ");

  const prompt = `You are an elite Macro Prop Desk Analyst at a top-tier systematic hedge fund.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below. Every price, ratio, volume, and indicator value you cite MUST come from this data. You are ABSOLUTELY FORBIDDEN from using your internal training knowledge for market trends, price targets, or directional predictions. If a data field shows "NO DATA AVAILABLE", skip it — do NOT substitute with internal knowledge.

═══════════════════════════════════════════════════════
LIVE MARKET PULSE — ${timeET} | SESSION: ${session}
INSTRUMENTS SCANNED: ${symbolList}
═══════════════════════════════════════════════════════

SESSION DIRECTIVE: ${sessionGuidance}

═══ CONTEXT DATA ═══
${dataBlock}
═══ END CONTEXT DATA ═══

═══════════════════════════════════════════════════════
ANALYTICAL FRAMEWORK — synthesize ONLY the data streams you have:

For any VOLATILITY instruments (VIX, VVIX, Put/Call ratios): assess whether vol is expanding or compressing, and whether institutional hedging or complacency dominates.

For any BREADTH indicators (TICK, ADD/Advance-Decline, TRIN/Arms): determine if breadth is confirming or diverging from price. TRIN < 1.0 = bullish volume distribution; > 1.0 = bearish. Consistent positive TICK = institutional buying pressure.

For any MACRO/FX/COMMODITY instruments (DXY, Gold, Crude, rates): determine whether the inter-market configuration is risk-on or risk-off. Dollar strength = headwind for equities; Gold bid = safe-haven demand; Crude bid = risk appetite.

For any EQUITY FUTURES (ES, NQ, etc.): assess whether futures are leading or lagging cash, and what any premium/discount implies for directional intent.

For any EQUITY ETFs (SPY, QQQ, IWM, etc.): assess breadth, leadership rotation, and key technical levels.

CROSS-ASSET: Do all data streams CONFIRM the same narrative? Or are there DIVERGENCES that signal a trap or reversal risk?

IMPORTANT: Only comment on instruments you have data for. Skip any category where no data was provided.
═══════════════════════════════════════════════════════

Deliver your Live Market Pulse using EXACTLY this structure:

## ⚡ Live Market Pulse — ${session}
**One sentence. Maximum conviction. Current macro verdict based on the data above.**

## 🎯 Macro Posture
**[RISK-ON / RISK-OFF / NEUTRAL / DETERIORATING / RECOVERING]** — 2 sentences explaining the regime using only the data provided above.

## 📊 Multi-Asset Synthesis
Write one bullet per major data category you have data for (e.g., Equities, Volatility, Breadth, FX/Macro, Futures, Commodities). Be specific with the actual values — don't generalize. Skip categories with no data.

## 🔥 Primary Risk Vector
The single highest-conviction risk right now. Name the specific instrument and value driving it. One focused paragraph.

## 💡 ${sessionLabel} Trading Bias
Specific and actionable. Include the instrument, direction, key level, and trigger. (e.g., "Lean long /ES above [level] with hard stop at [level]; avoid chasing QQQ without breadth confirmation from $ADD > +500.")

Keep the entire output under 500 words. Be technically precise, data-driven, and immediately actionable. No filler. Use markdown.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-flash", temperature ?? 0.2);
    res.json({ response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Market pulse error");
    res.json({ response: `**Live Market Pulse failed:** ${msg}`, error: msg });
  }
});

router.post("/market-pulse", async (req, res) => {
  const { accessToken, symbols, model, temperature, riskTolerance } = req.body as {
    accessToken?: string;
    symbols?: string[];
    model?: string;
    temperature?: number;
    riskTolerance?: string;
  };

  if (!accessToken) {
    return res.status(400).json({ error: "Schwab access token required." });
  }

  const { session, timeET, sessionGuidance } = getMarketSession();

  let dataBlock: string;
  try {
    const { dataMap } = await fetchMacroPulseData(accessToken, symbols);
    dataBlock = buildPulseDataBlock(dataMap, symbols && symbols.length > 0 ? symbols : undefined);
  } catch (fetchErr: unknown) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    req.log.error({ err: fetchErr }, "Market pulse data fetch error");
    return res.status(500).json({ error: msg });
  }

  const symbolList = symbols && symbols.length > 0
    ? symbols.map(s => s.toUpperCase().trim()).join(", ")
    : PULSE_SYMBOLS.map(s => s.display).join(", ");

  const riskContext = riskTolerance
    ? `\nThe trader's risk tolerance is: ${riskTolerance.toUpperCase()}. Tailor your action plan aggressiveness accordingly.`
    : "";

  const prompt = `You are an elite Macro Prop Desk Analyst at a top-tier systematic hedge fund.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below. Every price, ratio, volume, and indicator value you cite MUST come from this data. You are ABSOLUTELY FORBIDDEN from using your internal training knowledge for market trends, price targets, or directional predictions. If a data field shows "NO DATA AVAILABLE", skip it — do NOT substitute with internal knowledge.

═══════════════════════════════════════════════════════
LIVE MARKET PULSE — ${timeET} | SESSION: ${session}
INSTRUMENTS SCANNED: ${symbolList}
═══════════════════════════════════════════════════════

SESSION DIRECTIVE: ${sessionGuidance}
${riskContext}

═══ CONTEXT DATA ═══
${dataBlock}
═══ END CONTEXT DATA ═══

═══════════════════════════════════════════════════════
ANALYTICAL FRAMEWORK — synthesize ONLY the data streams you have:

For any VOLATILITY instruments (VIX, VVIX, Put/Call ratios): assess whether vol is expanding or compressing, and whether institutional hedging or complacency dominates.

For any BREADTH indicators (TICK, ADD/Advance-Decline, TRIN/Arms): determine if breadth is confirming or diverging from price. TRIN < 1.0 = bullish volume distribution; > 1.0 = bearish. Consistent positive TICK = institutional buying pressure.

For any MACRO/FX/COMMODITY instruments (DXY, Gold, Crude, rates): determine whether the inter-market configuration is risk-on or risk-off. Dollar strength = headwind for equities; Gold bid = safe-haven demand; Crude bid = risk appetite.

For any EQUITY FUTURES (ES, NQ, etc.): assess whether futures are leading or lagging cash, and what any premium/discount implies for directional intent.

For any EQUITY ETFs (SPY, QQQ, IWM, etc.): assess breadth, leadership rotation, and key technical levels.

CROSS-ASSET: Do all data streams CONFIRM the same narrative? Or are there DIVERGENCES that signal a trap or reversal risk?

IMPORTANT: Only comment on instruments you have data for. Skip any category where no data was provided.
═══════════════════════════════════════════════════════

YOU MUST RESPOND WITH VALID JSON ONLY. No markdown. No code fences. No explanation outside the JSON.

Use EXACTLY this JSON schema:
{
  "bias": {
    "direction": "BULLISH" | "BEARISH" | "NEUTRAL",
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "regime": "RISK-ON" | "RISK-OFF" | "NEUTRAL" | "DETERIORATING" | "RECOVERING",
    "headline": "One sentence. Maximum conviction. Current macro verdict."
  },
  "clusters": [
    {
      "id": "unique-slug",
      "category": "equity" | "volatility" | "breadth" | "macro" | "futures" | "commodities",
      "title": "Short cluster title",
      "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "summary": "2-3 sentence analysis of this cluster using ONLY the data provided.",
      "keyData": [
        { "label": "Instrument name", "value": "price or value", "direction": "up" | "down" | "flat" }
      ]
    }
  ],
  "actionPlan": {
    "primaryTrade": "Specific trade description",
    "direction": "BULLISH" | "BEARISH" | "NEUTRAL",
    "instrument": "Primary instrument symbol",
    "entry": "Entry level or condition",
    "stop": "Stop loss level",
    "target": "Profit target level",
    "rationale": "Why this trade makes sense given the data",
    "alternativePlays": ["Alternative trade 1", "Alternative trade 2"]
  },
  "invalidation": {
    "conditions": ["Condition that would invalidate the thesis"],
    "keyLevels": [
      { "instrument": "Symbol", "level": "Price level", "significance": "Why this level matters" }
    ]
  }
}

RULES:
- Include 2-6 clusters covering the data categories you have data for.
- Each cluster's keyData array should have 1-4 data points with actual values from the context data.
- The actionPlan must reference specific instruments and levels from the data.
- Include 1-3 invalidation conditions and 2-4 key levels.
- All values must come from the context data. Do NOT fabricate prices or levels.
- Be technically precise, data-driven, and immediately actionable.`;

  try {
    const raw = await callGemini(prompt, model ?? "gemini-2.5-flash", temperature ?? 0.2);

    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
    }

    const parsed = JSON.parse(cleaned);

    const result = {
      ...parsed,
      session,
      timeET,
      instrumentCount: (symbols && symbols.length > 0 ? symbols : PULSE_SYMBOLS.map(s => s.display)).length,
      generatedAt: Date.now(),
    };

    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Market pulse JSON error");
    res.status(500).json({ error: `Market Pulse failed: ${msg}` });
  }
});

router.post("/market-pulse/stream", async (req, res) => {
  const { accessToken, symbols, model, temperature, preferences, previousBias } = req.body as {
    accessToken?: string;
    symbols?: string[];
    model?: string;
    temperature?: number;
    previousBias?: BiasLabel;
    preferences?: {
      allowedStrategies?: string[];
      defaultSpreadWidth?: string;
      maxContracts?: string;
      accountSizeTier?: string;
      preferredTickers?: string;
      maxRiskPerTrade?: string;
    };
  };

  if (!accessToken) {
    return res.status(400).json({ error: "Schwab access token required." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  req.socket?.setKeepAlive(true);
  req.setTimeout(0);
  res.setTimeout(0);
  if (req.socket) req.socket.setTimeout(0);
  res.write(": ok\n\n");
  res.flushHeaders();
  res.write(`event: thinking\ndata: ${JSON.stringify({ type: "thinking", text: "Fetching live market data..." })}\n\n`);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": ping\n\n");
    }
  }, 5000);

  const { session, timeET, sessionGuidance } = getMarketSession();

  let dataMap: Map<string, Record<string, unknown>>;
  let dataBlock: string;
  try {
    const result = await fetchMacroPulseData(accessToken, symbols);
    dataMap = result.dataMap;
    dataBlock = buildPulseDataBlock(dataMap, symbols && symbols.length > 0 ? symbols : undefined);
    res.write(`event: thinking\ndata: ${JSON.stringify({ type: "thinking", text: "Market data loaded. Running scoring engine..." })}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch (fetchErr: unknown) {
    clearInterval(heartbeat);
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    req.log.error({ err: fetchErr }, "Market pulse stream data fetch error");
    res.write(`event: error\ndata: ${JSON.stringify({ type: "error", message: msg })}\n\n`);
    res.end();
    return;
  }

  const indicators = extractMarketIndicators(dataMap);
  const engineResult = runMarketPulseEngine(indicators, previousBias);

  const spyRaw = dataMap.get("SPY");
  const spyChangePct: number | null = typeof spyRaw?.netPercentChange === "number" ? spyRaw.netPercentChange : null;
  const spyDivergenceBlock = (() => {
    if (spyChangePct === null) return "";
    const spyDir = spyChangePct > 0 ? "UP" : spyChangePct < 0 ? "DOWN" : "FLAT";
    const biasBullish = engineResult.bias === "STRONGLY_BULLISH" || engineResult.bias === "MODERATELY_BULLISH" || engineResult.bias === "SLIGHTLY_BULLISH";
    const biasBearish = engineResult.bias === "STRONGLY_BEARISH" || engineResult.bias === "MODERATELY_BEARISH" || engineResult.bias === "SLIGHTLY_BEARISH";
    const diverges = (biasBullish && spyDir === "DOWN") || (biasBearish && spyDir === "UP");
    const line = `Current SPY performance: ${spyChangePct >= 0 ? "+" : ""}${spyChangePct.toFixed(2)}% (${spyDir})`;
    if (diverges) {
      return `\n${line}\nDIVERGENCE DETECTED: The macro bias is ${engineResult.bias} but SPY is ${spyDir} ${Math.abs(spyChangePct).toFixed(2)}% today. Your narrative MUST address this divergence. Explain whether macro is leading price, or whether the equity weakness could signal something the macro indicators are not capturing.`;
    }
    return `\n${line}`;
  })();

  console.log("[PULSE ENGINE] Deterministic result:", JSON.stringify({
    bias: engineResult.bias,
    composite: engineResult.compositeScore,
    confidence: engineResult.confidenceScore,
    clusters: Object.fromEntries(
      Object.entries(engineResult.clusters).map(([k, v]) => [k, { score: v.score, quality: v.dataQuality }])
    ),
  }));

  res.write(`event: thinking\ndata: ${JSON.stringify({ type: "thinking", text: `Engine scored: ${engineResult.bias} (composite ${engineResult.compositeScore >= 0 ? '+' : ''}${engineResult.compositeScore.toFixed(2)}, confidence ${engineResult.confidenceScore}%). Generating AI narrative...` })}\n\n`);
  if (typeof (res as any).flush === "function") (res as any).flush();

  const instrumentCount = (symbols && symbols.length > 0 ? symbols : PULSE_SYMBOLS.map(s => s.display)).length;

  const strategyPrefsBlock = preferences
    ? `\nUSER PREFERENCES:
- Allowed strategies: ${preferences.allowedStrategies?.join(", ") || "All"}
- Default spread width: ${preferences.defaultSpreadWidth || "Standard"}
- Preferred tickers: ${preferences.preferredTickers || "Any"}`
    : "";

  const narrativePrompt = `You are a senior market strategist writing institutional-grade analysis. You receive pre-calculated market scores from a deterministic scoring engine. Your job is to INTERPRET the scores, NOT recalculate them.

RULES:
- DO NOT change, override, or recalculate any cluster scores, composite score, bias label, or confidence values. They are final.
- Write a concise 1-2 sentence synthesis explaining WHY this combination of cluster scores produces the given bias.
- Write a concise 1 sentence session bias summary for today's intraday lean.
- Generate 2-3 action plan items with IF/THEN strategy guidance.
- The 30 macro indicators are DATA INPUTS ONLY. NEVER suggest trading them directly.
- NEVER include specific entry prices, stops, or targets. Those belong in the Options Strategist.
- Return ONLY a raw JSON object matching the schema below. No markdown, no backticks.

DETERMINISTIC ENGINE OUTPUT (DO NOT MODIFY THESE VALUES):
${JSON.stringify(engineResult, null, 2)}

RAW INDICATOR DATA FOR CONTEXT:
${dataBlock}

SESSION: ${session} | TIME: ${timeET}
SESSION DIRECTIVE: ${sessionGuidance}
${spyDivergenceBlock}${strategyPrefsBlock}

Write ONLY the narrative fields. Return this exact JSON structure:
{
  "sessionBiasSummary": "1 sentence about today's intraday lean",
  "synthesisSummary": "1-2 sentences explaining why the cluster scores produce this bias",
  "actionPlan": [
    {
      "condition": "IF [condition based on the scores and data]",
      "strategy": "THEN [strategy guidance for user's preferred tickers]",
      "rationale": "Brief explanation",
      "riskPosture": "FULL" | "REDUCED" | "QUARTER" | "NO_TRADE",
      "conviction": "HIGH" | "MODERATE" | "LOW"
    }
  ],
  "invalidationConditions": ["1-3 short conditions that would change the thesis"]
}`;

  try {
    const google = createGoogleGenerativeAI({ apiKey });
    const result = streamText({
      model: google("gemini-2.5-pro"),
      prompt: narrativePrompt,
      temperature: 0,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 2048 } },
      },
    });

    let responseBuffer = "";

    for await (const part of result.fullStream) {
      if (
        part.type === "reasoning" ||
        part.type === "thought" ||
        (part as any).type === "thinking" ||
        (part as any).type === "step-start"
      ) {
        const text = (part as any).textDelta || (part as any).text || (part as any).content || "";
        if (text) {
          res.write(`event: thinking\ndata: ${JSON.stringify({ type: "thinking", text })}\n\n`);
          if (typeof (res as any).flush === "function") (res as any).flush();
        }
      } else if (part.type === "text-delta") {
        responseBuffer += (part as any).textDelta ?? (part as any).text ?? "";
      }
    }

    clearInterval(heartbeat);
    console.log("[PULSE STREAM] Narrative buffer length:", responseBuffer.length);

    let cleaned = responseBuffer.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    try {
      const narrative = JSON.parse(cleaned);

      const finalPulse = {
        ...engineResult,
        rawIndicators: indicators,
        dataAge: { oldestSource: "schwab-batch", oldestSourceAge: 0 },
        sessionBias: {
          label: engineResult.bias === 'NO_EDGE' ? 'NO_EDGE' :
                 engineResult.compositeScore > 0 ? 'BULLISH' :
                 engineResult.compositeScore < 0 ? 'BEARISH' : 'NEUTRAL',
          summary: narrative.sessionBiasSummary || '',
        },
        structuralRegime: {
          label: engineResult.structuralRegime,
          timeframe: '1-5 day outlook',
          summary: narrative.synthesisSummary || '',
        },
        riskState: {
          label: engineResult.riskState,
          reason: engineResult.riskReason,
        },
        invalidation: {
          conditions: narrative.invalidationConditions || [],
        },
        actionPlan: narrative.actionPlan || [],
        session,
        timeET,
        instrumentCount,
        generatedAt: Date.now(),
      };

      res.write(`event: result\ndata: ${JSON.stringify({ type: "complete", pulse: finalPulse })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    } catch (parseErr) {
      console.error("[PULSE STREAM] Narrative JSON parse failed:", parseErr);
      console.error("[PULSE STREAM] Raw narrative:", cleaned.substring(0, 500));
      req.log.error({ err: parseErr, rawLength: responseBuffer.length }, "Market pulse narrative parse error");

      const fallbackPulse = {
        ...engineResult,
        rawIndicators: indicators,
        dataAge: { oldestSource: "schwab-batch", oldestSourceAge: 0 },
        sessionBias: {
          label: engineResult.bias === 'NO_EDGE' ? 'NO_EDGE' :
                 engineResult.compositeScore > 0 ? 'BULLISH' :
                 engineResult.compositeScore < 0 ? 'BEARISH' : 'NEUTRAL',
          summary: 'AI narrative unavailable — engine scores are still valid.',
        },
        structuralRegime: {
          label: engineResult.structuralRegime,
          timeframe: '1-5 day outlook',
          summary: 'AI narrative generation failed. Scores shown are deterministic.',
        },
        riskState: {
          label: engineResult.riskState,
          reason: engineResult.riskReason,
        },
        invalidation: { conditions: [] },
        actionPlan: [],
        session,
        timeET,
        instrumentCount,
        generatedAt: Date.now(),
      };
      res.write(`event: result\ndata: ${JSON.stringify({ type: "complete", pulse: fallbackPulse })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();
    }

    res.end();
  } catch (err: unknown) {
    clearInterval(heartbeat);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[PULSE STREAM] Error:", err);
    req.log.error({ err }, "Market pulse stream error");
    res.write(`event: error\ndata: ${JSON.stringify({ type: "error", message: "Generation failed. Please try again." })}\n\n`);
    res.end();
  }
});

interface StrategistSettings {
  autopilot?: boolean;
  maxRisk?: number;
  minPoP?: number;
  minRR?: string;
  bias?: string;
  premium?: string;
  avoidEarnings?: boolean;
}

function buildStrategistPrompt(
  quote: Record<string, unknown>,
  chain: Record<string, unknown>,
  sma20: string,
  sma50: string,
  maxRiskValue: number,
  autopilot: boolean,
  settings?: StrategistSettings,
): string {
  const minPoP = settings?.minPoP ?? 70;
  const minRR = settings?.minRR ?? "1:2";
  const bias = settings?.bias ?? "auto";
  const premium = settings?.premium ?? "any";
  const avoidEarnings = settings?.avoidEarnings ?? true;

  const userConstraintBlock = autopilot
    ? `- Autopilot = TRUE: Ignore user directional bias. Generate mathematically optimal trades based solely on quantitative edge, technical confluence, and statistical probability.
- Max Risk Per Trade: NEVER exceed $${maxRiskValue}. Size every position to stay under this hard cap.`
    : `- Autopilot = FALSE: Strictly filter strategies to match ALL of the following user constraints:
  - Max Risk Per Trade: NEVER exceed $${maxRiskValue}. Size every position to stay under this hard cap.
  - Minimum Probability of Profit (PoP): ${minPoP}%
  - Minimum Risk/Reward Ratio: ${minRR}
  - Directional Bias: ${bias === "auto" ? "Auto-Detect from data" : bias.charAt(0).toUpperCase() + bias.slice(1)}
  - Premium Type: ${premium === "any" ? "Any (credit or debit)" : premium === "credit" ? "Net Credit only" : "Net Debit only"}`;

  const earningsLine = avoidEarnings
    ? `- Avoid Earnings / Catalyst: ON — explicitly flag and REJECT any strategy whose hold period overlaps a known earnings date or major macro catalyst.`
    : `- Avoid Earnings / Catalyst: OFF — earnings overlap is acceptable.`;

  return `You are a Tier-1 institutional quantitative options engine. Never use conversational filler or preambles. Output the top 3 optimal strategies based on a holistic synthesis of all provided market data.

═══ CONTEXT DATA ═══
${OPTIONS_DATA_QUALITY_NOTE}

UNDERLYING MARKET DATA:
${formatQuote(quote)}
Technical Levels: SMA-20 = $${sma20} | SMA-50 = $${sma50}

${formatOptionsDetailed(chain)}
═══ END CONTEXT DATA ═══

USER CONSTRAINTS (MANDATORY):
${userConstraintBlock}
${earningsLine}

STRATEGY RULES:
- Liquidity Gate: Only recommend options with sufficient open interest (>50 OI) and tight bid-ask spreads (spread < 15% of mid price).
- Exits: Every strategy MUST include strict Exit Rules — a specific Profit Target percentage, Stop Loss percentage, and Time Exit rule.
- Position Sizing: State the exact number of contracts to trade to stay under the Max Risk limit of $${maxRiskValue}.
- Use only strikes that exist in the provided chain data. Be precise with numbers.

OUTPUT FORMAT:
You MUST output a JSON array of exactly 3 strategy objects, followed by a brief text rationale section.

The JSON structure MUST be exactly:
\`\`\`json
[
  {
    "strategyName": "String (e.g., 7DTE Bull Call Spread)",
    "targetEntryTrigger": "String (Precise price or technical trigger for entry, ONE line only)",
    "entryCostCredit": "String (e.g., Net Debit $1.25 per spread)",
    "maxRisk": "String (e.g., $250)",
    "maxReward": "String (e.g., $500)",
    "rrRatio": "String (e.g., 1:2)",
    "pop": "String (e.g., 72%)",
    "breakevens": "String (e.g., $248.25)",
    "positionSize": "String (e.g., Buy 2 contracts)",
    "exitRules": "String (Profit target at 50% max gain; stop loss at 100% of premium; close by 2 DTE)",
    "rationale": "String (2-3 sentences max, strictly clinical analysis)",
    "aiConfidence": "String (High, Medium, or Low)",
    "aiConfidenceReason": "String (one-sentence justification for the confidence level)"
  }
]
\`\`\`

MANDATORY AI CONFIDENCE:
You must ALWAYS output this exact line for every strategy object in the JSON: an "aiConfidence" field with value "High", "Medium", or "Low", and an "aiConfidenceReason" field with a one-sentence justification.

Output ONLY the JSON array first (no markdown code fence, no backticks, just the raw [ ... ] array), then a brief "## Key Risk Factors" section in markdown after the JSON.`;
}

router.post("/options-strategist", async (req, res) => {
  const { quote, candles, chain, model, temperature, settings } = req.body as {
    quote?: Record<string, unknown>;
    candles?: Array<Record<string, unknown>>;
    chain?: Record<string, unknown>;
    model?: string;
    temperature?: number;
    settings?: {
      autopilot?: boolean;
      maxRisk?: number;
      minPoP?: number;
      minRR?: string;
      bias?: string;
      premium?: string;
      avoidEarnings?: boolean;
    };
  };

  if (!quote || !chain) {
    return res.json({ response: "Error: Missing quote or options chain data.", error: "missing_data" });
  }

  const rawCalls = (chain["calls"] as unknown[] | undefined) ?? [];
  const rawPuts  = (chain["puts"]  as unknown[] | undefined) ?? [];
  req.log.info({ callCount: rawCalls.length, putCount: rawPuts.length, underlying: chain["underlyingPrice"] }, "Options strategist chain received");

  if (rawCalls.length === 0 && rawPuts.length === 0) {
    return res.json({ response: "**Error:** The options chain data is empty — no call or put contracts were provided. This can happen when the market is closed or the access token has expired. Please re-authenticate and try again.", error: "empty_chain" });
  }

  let sma20 = "N/A", sma50 = "N/A";
  if (candles && candles.length >= 20) {
    const closes = candles.map(c => Number(c["close"])).filter(v => !isNaN(v));
    if (closes.length >= 20) sma20 = (closes.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(2);
    if (closes.length >= 50) sma50 = (closes.slice(-50).reduce((a, b) => a + b, 0) / 50).toFixed(2);
  }

  const maxRiskValue = settings?.maxRisk ?? 250;
  const autopilot = settings?.autopilot ?? true;
  const prompt = buildStrategistPrompt(quote, chain, sma20, sma50, maxRiskValue, autopilot, settings);

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-flash", temperature ?? 0.2);
    res.json({ response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Options strategist error");
    res.json({ response: `**Strategist failed:** ${msg}`, error: msg });
  }
});

router.post("/options-strategist/stream", async (req, res) => {
  const { quote, candles, chain, model, temperature, settings } = req.body as {
    quote?: Record<string, unknown>;
    candles?: Array<Record<string, unknown>>;
    chain?: Record<string, unknown>;
    model?: string;
    temperature?: number;
    settings?: {
      autopilot?: boolean;
      maxRisk?: number;
      minPoP?: number;
      minRR?: string;
      bias?: string;
      premium?: string;
      avoidEarnings?: boolean;
    };
  };

  if (!quote || !chain) {
    return res.status(400).json({ error: "Missing quote or options chain data." });
  }

  const rawCalls = (chain["calls"] as unknown[] | undefined) ?? [];
  const rawPuts  = (chain["puts"]  as unknown[] | undefined) ?? [];
  if (rawCalls.length === 0 && rawPuts.length === 0) {
    return res.status(400).json({ error: "Options chain is empty." });
  }

  let sma20 = "N/A", sma50 = "N/A";
  if (candles && candles.length >= 20) {
    const closes = candles.map(c => Number(c["close"])).filter(v => !isNaN(v));
    if (closes.length >= 20) sma20 = (closes.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(2);
    if (closes.length >= 50) sma50 = (closes.slice(-50).reduce((a, b) => a + b, 0) / 50).toFixed(2);
  }

  const maxRiskValue = settings?.maxRisk ?? 250;
  const autopilot = settings?.autopilot ?? true;
  const prompt = buildStrategistPrompt(quote, chain, sma20, sma50, maxRiskValue, autopilot, settings);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  req.socket?.setKeepAlive(true);
  req.setTimeout(0);
  res.setTimeout(0);
  if (req.socket) req.socket.setTimeout(0);
  res.write(": ok\n\n");
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": ping\n\n");
    }
  }, 5000);

  try {
    const google = createGoogleGenerativeAI({ apiKey });
    const chosenModel = model ?? "gemini-2.5-flash";
    const result = streamText({
      model: google(chosenModel),
      prompt,
      temperature: temperature ?? 0.2,
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: 2048 } },
      },
    });

    for await (const part of result.fullStream) {
      const p = part as any;
      const delta = p.textDelta ?? p.text;
      if (part.type === "reasoning" && delta) {
        res.write(`data: ${JSON.stringify({ reasoning: delta })}\n\n`);
      } else if (part.type === "text-delta" && delta) {
        res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
      }
    }
    clearInterval(heartbeat);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: unknown) {
    clearInterval(heartbeat);
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Options strategist stream error");
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

router.post("/chat", async (req, res) => {
  try {
    const { messages, marketContext } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      marketContext?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Gemini API key not configured." });
    }

    const google = createGoogleGenerativeAI({ apiKey });

    const systemPrompt = `You are Alpha Terminal, a world-class AI assistant powered by Gemini. You have access to real-time Google Search and your full general knowledge. Your primary UI is the Alpha Financial Terminal.
- Today is ${new Date().toDateString()}. Current time: ${new Date().toLocaleString()}.
- If a user asks about today's news, current events, live scores, or real-time market trends, use Google Search to get fresh data.
- If the user asks a general question (like how to make a pizza), answer it directly and concisely.
- If the user asks about specific stock data and Schwab context is provided below, use that live data.
- Keep answers concise. Use bullet points or short lines when listing data.
- Never start sentences with "As an AI..." or "I am a financial terminal and cannot..." or any variant. Just answer the question.
- No greetings, no sign-offs, no "sure" or "great question."
- Do not refuse to answer non-financial questions.

STRICT DATA GROUNDING RULE FOR MARKET/TRADING QUESTIONS:
- When answering questions about specific stock prices, trends, technical levels, or trading strategies, you must ONLY use the Context Data provided below.
- You are FORBIDDEN from using your internal training knowledge to state current prices, recent price movements, support/resistance levels, or directional predictions for any specific security.
- If no Schwab context data is provided and the user asks about a specific stock's current state, tell them to connect Schwab for live data or use Google Search for the latest.
- For general financial education (e.g. "what is a put option"), internal knowledge is fine.

${marketContext ? `═══ LIVE SCHWAB CONTEXT DATA ═══\n${marketContext}\n═══ END CONTEXT DATA ═══` : "No live Schwab data connected."}`;

    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: systemPrompt,
      temperature: 0.1,
      tools: {
        googleSearch: google.tools.googleSearch({}),
      },
      messages: messages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Connection", "keep-alive");

    // Heartbeat: send a newline every 5s while Gemini searches so the proxy
    // doesn't cut the connection before the first real text chunk arrives.
    let firstChunkSent = false;
    const heartbeat = setInterval(() => {
      if (!firstChunkSent && !res.writableEnded) {
        res.write("\n");
      }
    }, 5000);

    try {
      for await (const chunk of result.textStream) {
        if (!firstChunkSent) {
          firstChunkSent = true;
          clearInterval(heartbeat);
        }
        res.write(chunk);
      }
    } finally {
      clearInterval(heartbeat);
    }
    res.end();
  } catch (error) {
    req.log.error({ err: error }, "Chat stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal Server Error" });
    }
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

  const prompt = `You are an elite quantitative trader with 20+ years of systematic trading experience.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below. Every price, volume, and change value you cite MUST come from this data. You are FORBIDDEN from using internal training knowledge for market trends, price targets, or directional predictions. If data is insufficient, say so — do NOT fabricate.

═══ CONTEXT DATA ═══
REAL-TIME MARKET DATA (sorted by momentum) — ${sortedQuotes.length} instruments:
Symbol | Last Price | Day Change | Volume  | Day Range
${tableRows}
═══ END CONTEXT DATA ═══

YOUR TASK: Analyze ONLY the above data and identify the TOP ${resultCount} highest-probability trading setups right now.

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
    const raw = await callGemini(prompt, model ?? "gemini-2.5-flash", temperature ?? 0.1);

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

// ── GROUNDED STRATEGY ENDPOINT ────────────────────────────────────────────────
// Fetches 30-day 1-minute candles from Schwab, runs RSI(14)/EMA(50)/EMA(200),
// builds a strict context block, and sends to Gemini with data-grounding enforced.

const SCHWAB_API_BASE_STRATEGY = "https://api.schwabapi.com/marketdata/v1";

router.post("/strategy", async (req, res) => {
  const { symbol, accessToken, question, model, temperature } = req.body as {
    symbol?: string;
    accessToken?: string;
    question?: string;
    model?: string;
    temperature?: number;
  };

  if (!symbol || !accessToken) {
    return res.status(400).json({ error: "symbol and accessToken are required" });
  }

  if (!question) {
    return res.status(400).json({ error: "question is required" });
  }

  const upperSymbol = symbol.toUpperCase().trim();
  const apiSymbol = symbolToSchwabApi(upperSymbol);

  // Step 1: Fetch 30 days of 1-minute candles from Schwab
  let candles: Candle[] = [];
  let fetchTimestamp: string | null = null;

  try {
    const params = new URLSearchParams({
      symbol: apiSymbol,
      periodType: "day",
      period: "30",
      frequencyType: "minute",
      frequency: "1",
      needExtendedHoursData: "false",
    });

    const schwabRes = await fetch(`${SCHWAB_API_BASE_STRATEGY}/pricehistory?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (schwabRes.status === 401) {
      return res.json({ error: "unauthorized", response: "Schwab session expired. Please re-authenticate." });
    }

    if (!schwabRes.ok) {
      return res.json({
        error: "data_fetch_failed",
        response: "**Incomplete real-time data. Strategy generation aborted.** Schwab API returned an error.",
      });
    }

    const json = await schwabRes.json() as { candles?: Array<Record<string, unknown>> };
    const rawCandles = json.candles ?? [];

    candles = rawCandles.map(c => ({
      datetime: new Date(c["datetime"] as number).toISOString(),
      open: c["open"] as number,
      high: c["high"] as number,
      low: c["low"] as number,
      close: c["close"] as number,
      volume: c["volume"] as number,
    }));

    fetchTimestamp = new Date().toISOString();
  } catch (err) {
    req.log.error({ err }, "Strategy candle fetch error");
    return res.json({
      error: "data_fetch_failed",
      response: "**Incomplete real-time data. Strategy generation aborted.** Failed to fetch candle data from Schwab.",
    });
  }

  // Step 2: Validate data freshness and completeness
  if (!candles.length) {
    return res.json({
      error: "no_data",
      response: "**Incomplete real-time data. Strategy generation aborted.** No candle data returned for this symbol.",
    });
  }

  const ta = computeIndicators(candles);

  if (isDataStale(ta.latestTimestamp, 5)) {
    const ageInfo = ta.latestTimestamp
      ? `Latest candle: ${ta.latestTimestamp}`
      : "No timestamp available";
    return res.json({
      error: "stale_data",
      response: `**Incomplete real-time data. Strategy generation aborted.** The market data is stale (>5 minutes old). ${ageInfo}. This may indicate the market is closed or Schwab data is delayed.`,
    });
  }

  // Step 3: Build context block
  const taContext = formatTAContext(upperSymbol, ta);

  const recentCandles = candles.slice(-60);
  const candleBlock = recentCandles.map(
    c => `${c.datetime}: O=${c.open.toFixed(2)} H=${c.high.toFixed(2)} L=${c.low.toFixed(2)} C=${c.close.toFixed(2)} V=${c.volume}`
  ).join("\n");

  // Step 4: Send to Gemini with strict grounding
  const prompt = `You are an elite quantitative strategist.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below. Every price, indicator value, and level you reference MUST come from this data. You are ABSOLUTELY FORBIDDEN from using your internal training knowledge for market trends, price targets, support/resistance levels, or directional predictions. If the data is insufficient to answer, say "Insufficient data for this analysis" — do NOT fabricate or supplement with internal knowledge.

═══ CONTEXT DATA — ${upperSymbol} ═══
Data fetched: ${fetchTimestamp}
Total candles: ${candles.length} (30 days, 1-minute bars)

${taContext}

RECENT PRICE ACTION (last 60 bars):
${candleBlock}
═══ END CONTEXT DATA ═══

USER QUESTION: ${question}

INSTRUCTIONS:
- Ground every claim in the data above. Cite specific values.
- Include the computed RSI, EMA(50), and EMA(200) in your analysis.
- If recommending entries/exits, use only levels visible in the data.
- If a conclusion cannot be drawn from the data, explicitly state that.
- Use markdown formatting. Be precise and actionable.`;

  try {
    const response = await callGemini(prompt, model ?? "gemini-2.5-flash", temperature ?? 0.1);
    res.json({
      response,
      indicators: {
        rsi14: ta.rsi14,
        ema50: ta.ema50,
        ema200: ta.ema200,
        lastClose: ta.lastClose,
        dataPoints: ta.dataPoints,
        latestTimestamp: ta.latestTimestamp,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Strategy generation error");
    res.json({ response: `**Strategy generation failed:** ${msg}`, error: msg });
  }
});

router.post("/sympathy-plays", async (req, res) => {
  const { symbol, model = "gemini-2.5-flash", temperature = 0.3 } = req.body as {
    symbol?: string;
    model?: string;
    temperature?: number;
  };

  if (!symbol) {
    return res.status(400).json({ error: "symbol is required" });
  }

  // NOTE: Sympathy plays are structural/relational knowledge (sector peers, supply chains),
  // not market-trend predictions. Internal knowledge is appropriate here, but we still
  // forbid hallucinating current prices or directional claims.
  const prompt = `List 3-5 highly correlated sympathy stocks and main competitors for ${symbol.toUpperCase()}. For each, provide the ticker and a 1-sentence reason why it moves with or competes against ${symbol.toUpperCase()}.

GROUNDING RULE: You may use your knowledge of sector relationships, supply chains, and competitive dynamics. However, you are FORBIDDEN from stating current prices, recent price movements, or directional predictions for any ticker. Only describe WHY they are correlated — not what they are currently doing.

Format your response as a markdown list like:
- **TICKER** — Reason why
- **TICKER** — Reason why

Be concise and institutional-grade. Focus on actual market correlations, sector peers, and supply-chain links.`;

  try {
    const response = await callGemini(prompt, model, temperature);
    res.json({ response });
  } catch (err) {
    req.log.error({ err }, "Sympathy plays AI error");
    res.json({ response: "Unable to generate sympathy plays at this time." });
  }
});

export default router;
