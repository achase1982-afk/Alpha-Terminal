import { Router, type IRouter } from "express";
import { logFailure } from "../lib/telemetry.js";
import { emitTelemetry, createTelemetryBatch } from "../lib/telemetryStore.js";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
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
import { runMarketPulseEngine, formatClusterDebugLine, verifyEngineScoring, type MarketIndicators, type BiasLabel, type SessionType } from "../lib/marketPulseEngine.js";
import { updateRegimeFromPulse } from "../lib/regimePostProcessor.js";
import { getSnapshot, addSymbols as addSchwabSymbols, addFuturesSymbols as addSchwabFuturesSymbols, getSchwabCacheDiagnostics, type LiveQuote } from "../lib/schwabStreamer.js";
import { getIBSnapshot, getIBCachedQuote, registerPermanentSymbols } from "../lib/ibStreamer.js";
import { getBestAccessToken, getTokens } from "../lib/tokenStore.js";
import { getSyntheticDxyPrevClose } from "../lib/syntheticDxy.js";
import { selectStrategies, selectStrategiesByRegime, classifyRegime, checkOverrideConflict, classifyTicker, computeBeta, applyBetaToProfile, computeExpectedMove, computeIVR, STRATEGIST_SYSTEM_PROMPT, type OptionContract, type StrategyPayload, type RegimeClassification, type TickerProfile, type DailyCandle, type ConvictionParams } from "../lib/optionsStrategist.js";
import { runPreTradeChecks, type PreTradeInput, type PreTradeResult } from "../lib/preTradeRiskEngine.js";
import { evaluateRegimeShock, type ShockDetectorOutput } from "../lib/regimeShockDetector.js";
import { getDeltaHealth, getSnapshotsForAI, triggerManualSnapshot, triggerEventSnapshot, type DeltaHealthPayload } from "../lib/deltaEngine.js";
import { sendPushToAll } from "../lib/pushService.js";
import { checkEventConflicts, getUpcomingEvents, type EventCheckResult } from "../lib/calendarEventChecker.js";
import { chainCache, getOrFetchChain, CHAIN_CACHE_TTL, getCachedEconEvents, getCachedRatings } from "./market.js";
import { runDeterministicScan } from "../lib/deterministicScanner.js";
import { runDiscoveryScan } from "../lib/deterministicScanner.v2.js";
import { getEquityPCRatio, getIndexPCRatio } from "../lib/polygonPutCallRatio.js";
import {
  runDeterministicStrategist,
  fetchPortfolioContext,
  fetchTickerMarketData,
  buildNarrativePrompt,
  type ScannerInput,
  type PulseInput,
  type StrategistInput,
  type StrategistOutput,
} from "../lib/deterministicStrategist.js";
import { resolveStrikes, type AccountSnapshot, type ChainData, type ResolvedTrade, type StrikeResolutionError } from "../lib/strikeResolver.js";

const router: IRouter = Router();

let lastPulseResult: { pulse: Record<string, unknown>; generatedAt: number; thinkingTokens: string[] } | null = null;
let lastPulseError: string | null = null;
let pulseGenerationInFlight = false;
let pulseThinkingBuffer: string[] = [];
let pulseStatusText = "Generating AI analysis...";

function safeSseWrite(res: import("express").Response, data: string) {
  try {
    if (!res.writableEnded && !res.destroyed) {
      res.write(data);
      if (typeof (res as any).flush === "function") (res as any).flush();
      if ((res as any).socket && typeof (res as any).socket.write === "function") {
        (res as any).socket.uncork?.();
      }
      return true;
    }
  } catch {}
  return false;
}

function sseFlushPadding(res: import("express").Response) {
  const pad = ": " + " ".repeat(2048) + "\n\n";
  safeSseWrite(res, pad);
}

const DEFAULT_MODEL = "claude-opus-4-6";

const AVAILABLE_MODELS = [
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-20250514",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

export function isClaude47OrNewer(model: string): boolean {
  return /^claude-(opus|sonnet)-4-([7-9]|\d{2,})/.test(model);
}

interface NativeStreamOptions {
  prompt: string;
  systemPrompt?: string;
  modelName?: string;
  temperature?: number;
  thinkingBudget?: number;
  onThinking?: (text: string) => void;
  onText?: (text: string) => void;
}

const THINKING_CAPABLE_MODELS = new Set([
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-20250514",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
]);

async function nativeStreamClaude(opts: NativeStreamOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const {
    prompt,
    systemPrompt,
    modelName,
    temperature = 0,
    thinkingBudget,
    onThinking,
    onText,
  } = opts;

  const client = new Anthropic({ apiKey });

  const resolvedModel = modelName || DEFAULT_MODEL;
  // Default thinking ON for all Claude models. Caller-supplied budget takes precedence; otherwise use 2048.
  const effectiveBudget = thinkingBudget && thinkingBudget > 0 ? thinkingBudget : 2048;
  const useThinking = THINKING_CAPABLE_MODELS.has(resolvedModel);

  let fullText = "";

  const isNew = isClaude47OrNewer(resolvedModel);
  const params: Anthropic.MessageStreamParams = {
    model: resolvedModel,
    max_tokens: useThinking ? Math.max(16000, effectiveBudget + 8000) : 4096,
    messages: [{ role: "user", content: prompt }],
  };

  if (systemPrompt) {
    params.system = systemPrompt;
  }

  if (useThinking) {
    if (isNew) {
      // Claude 4.7+: extended thinking budgets removed; use adaptive instead
      params.thinking = { type: "adaptive", display: "summarized" } as unknown as Anthropic.MessageStreamParams["thinking"];
    } else {
      params.thinking = { type: "enabled", budget_tokens: effectiveBudget };
      params.temperature = 1;
    }
  } else if (!isNew) {
    // Claude 4.7+: temperature/top_p/top_k must be omitted (400 otherwise)
    params.temperature = temperature;
  }
  void temperature;

  const stream = client.messages.stream(params);

  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      if (event.delta.type === "thinking_delta") {
        if (onThinking) onThinking(event.delta.thinking);
      } else if (event.delta.type === "text_delta") {
        fullText += event.delta.text;
        if (onText) onText(event.delta.text);
      }
    }
  }

  return fullText;
}

function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini-");
}

async function nativeStreamGemini(opts: NativeStreamOptions): Promise<string> {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Gemini AI integration env vars not configured");

  const {
    prompt,
    systemPrompt,
    modelName = "gemini-3.1-pro-preview",
    temperature = 0,
    onThinking,
    onText,
  } = opts;

  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });

  const contents = systemPrompt
    ? [{ role: "user" as const, parts: [{ text: systemPrompt + "\n\n" + prompt }] }]
    : [{ role: "user" as const, parts: [{ text: prompt }] }];

  const supportsThinking = /^gemini-(2\.5|3)/.test(modelName);
  const streamConfig: Record<string, unknown> = {
    maxOutputTokens: 8192,
    temperature,
  };
  if (supportsThinking) {
    streamConfig.thinkingConfig = { thinkingBudget: -1, includeThoughts: false };
  }
  const response = await ai.models.generateContentStream({
    model: modelName,
    contents,
    config: streamConfig as Parameters<typeof ai.models.generateContentStream>[0]["config"],
  });
  void onThinking;

  let fullText = "";
  for await (const chunk of response) {
    const text = chunk.text ?? "";
    if (text) {
      fullText += text;
      if (onText) onText(text);
    }
  }

  return fullText;
}

async function nativeStream(opts: NativeStreamOptions): Promise<string> {
  const model = opts.modelName || DEFAULT_MODEL;
  if (isGeminiModel(model)) {
    return nativeStreamGemini(opts);
  }
  return nativeStreamClaude(opts);
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

async function callClaude(
  prompt: string,
  modelName: string = DEFAULT_MODEL,
  temperature: number = 0.3
): Promise<string> {
  const client = getClient();
  if (!client) {
    return "Error: ANTHROPIC_API_KEY not configured.";
  }

  const createParams: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelName,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  };
  if (!isClaude47OrNewer(modelName)) {
    createParams.temperature = temperature;
  }
  const message = await client.messages.create(createParams);

  const content = message.content[0];
  return content.type === "text" ? content.text : "No response";
}

async function callGeminiDirect(
  prompt: string,
  modelName: string = "gemini-3.1-pro-preview",
  temperature: number = 0.3
): Promise<string> {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) return "Error: Gemini AI integration not configured.";

  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  const response = await ai.models.generateContent({
    model: modelName,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 8192, temperature },
  });

  return (response.text ?? "").trim() || "No response";
}

async function callModel(
  prompt: string,
  modelName: string = DEFAULT_MODEL,
  temperature: number = 0.3
): Promise<string> {
  if (isGeminiModel(modelName)) {
    return callGeminiDirect(prompt, modelName, temperature);
  }
  return callClaude(prompt, modelName, temperature);
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

router.post("/technical-snapshot", async (req, res) => {
  const { quote, candles } = req.body ?? {};
  if (!quote?.symbol) {
    return res.json({ error: "Missing quote.symbol" });
  }

  const prompt = `You are a financial analyst. Analyze ONLY the data below and return a JSON object.

${formatQuote(quote as Record<string, unknown>)}

${formatCandles((candles ?? []) as Array<Record<string, unknown>>)}

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "trend": "Strong Uptrend" | "Uptrend" | "Sideways" | "Downtrend" | "Strong Downtrend",
  "trendSignal": "bullish" | "neutral" | "bearish",
  "rsi": <number 0-100 or null if insufficient data>,
  "rsiLabel": "Overbought" | "Neutral" | "Oversold",
  "resistance1": <number or null>,
  "support1": <number or null>,
  "resistance2": <number or null>,
  "support2": <number or null>,
  "shortTermOutlook": "<one sentence>"
}

If data is insufficient for any field, use null. Base RSI on 14-period calculation from the candle closes. Support/resistance from recent swing highs/lows.`;

  try {
    const client = getClient();
    if (!client) return res.json({ error: "ANTHROPIC_API_KEY not configured" });

    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    });
    
    const content = response.content[0];
    const text = content.type === "text" ? content.text : "No response";
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Technical snapshot error");
    void logFailure("MARKET_PULSE", "ERROR", `Claude technical snapshot failed: ${msg}`, { endpoint: "/technical-snapshot", error: msg });
    res.json({ error: msg });
  }
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
    const response = await callModel(prompt, model ?? DEFAULT_MODEL, temperature ?? 0.3);
    res.json(RunTechnicalAnalysisResponse.parse({ response }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Technical analysis error");
    void logFailure("MARKET_PULSE", "ERROR", `Claude technical analysis failed: ${msg}`, { endpoint: "/technical-analysis", error: msg });
    res.json(RunTechnicalAnalysisResponse.parse({ response: `**Analysis failed:** ${msg}`, error: msg }));
  }
});

router.post("/technical-analysis/stream", async (req, res) => {
  const parsed = RunTechnicalAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body." });
  }

  const { quote, candles, model, temperature, customPrompt, fundamentals } = parsed.data;

  const fundBlock = fundamentals ? `
FUNDAMENTALS DATA:
Market Cap: ${fundamentals.marketCap != null ? `$${(fundamentals.marketCap / 1e9).toFixed(2)}B` : "N/A"}
Shares Outstanding: ${fundamentals.sharesOutstanding != null ? `${(fundamentals.sharesOutstanding / 1e9).toFixed(2)}B` : "N/A"}
P/E Ratio: ${fundamentals.peRatio != null ? fundamentals.peRatio.toFixed(2) : "N/A"}
EPS: ${fundamentals.eps != null ? `$${fundamentals.eps.toFixed(2)}` : "N/A"}
Beta: ${fundamentals.beta != null ? fundamentals.beta.toFixed(2) : "N/A"}
Dividend Yield: ${fundamentals.dividendYield != null ? `${fundamentals.dividendYield.toFixed(2)}%` : "N/A"}
52W High: ${fundamentals.high52 != null ? `$${fundamentals.high52.toFixed(2)}` : "N/A"}
52W Low: ${fundamentals.low52 != null ? `$${fundamentals.low52.toFixed(2)}` : "N/A"}
` : "";

  const prompt = `You are an expert financial analyst and technical trader at a top-tier institutional desk.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below for any claims about price levels, trends, momentum, support/resistance, or market direction. For fundamental metrics where specific data is provided, derive calculations from that data. For fundamental metrics where data is marked "N/A", you may use your knowledge of the company's most recently reported public financials (10-K, 10-Q). Always label time periods: (TTM), (MRQ), (FY24), etc. If you truly cannot determine a metric, use null.

═══ CONTEXT DATA ═══
${formatQuote(quote as Record<string, unknown>)}

${formatCandles((candles ?? []) as Array<Record<string, unknown>>)}
${fundBlock}
═══ END CONTEXT DATA ═══

${customPrompt ? `ADDITIONAL CONTEXT: ${customPrompt}` : ""}

Analyze the above data. Return ONLY valid JSON (no markdown, no code fences, no explanation outside the JSON). Use this exact structure:
{
  "priceAction": {
    "status": "<current price with today's % change, e.g. $185.42 (+1.2% today)>",
    "trend": "<one sentence describing the current trend>",
    "momentum": "<one sentence on momentum>",
    "bias": "<one of: Lean Bullish, Neutral-Bullish, Neutral, Neutral-Bearish, Lean Bearish>"
  },
  "support": [
    { "level": "$XX.XX", "label": "Immediate", "note": "<brief note like today's low>" },
    { "level": "$XX.XX", "label": "Strong", "note": "<brief note>" },
    { "level": "$XX.XX", "label": "Critical", "note": "<brief note>" }
  ],
  "resistance": [
    { "level": "$XX.XX", "label": "Immediate", "note": "<brief note like today's high>" },
    { "level": "$XX.XX-$XX.XX", "label": "Next", "note": "<brief note>" },
    { "level": "$XX.XX-$XX.XX", "label": "Major", "note": "<brief note>" }
  ],
  "chartPattern": {
    "recent": "<describe recent pattern>",
    "range": "$XX.XX - $XX.XX",
    "setup": "<current setup description>"
  },
  "volumeAnalysis": {
    "today": "<today's volume e.g. 45.2M>",
    "todayLabel": "<one of: low, moderate, elevated, heavy>",
    "elevated": [
      { "date": "<recent date>", "vol": "<volume>" }
    ],
    "pattern": "<volume pattern description>",
    "signal": "<what volume is telling us>"
  },
  "risks": [
    { "type": "Downside", "desc": "<specific risk>", "severity": "high" },
    { "type": "Upside", "desc": "<specific risk>", "severity": "medium" },
    { "type": "Volatility", "desc": "<specific risk>", "severity": "medium" }
  ],
  "criticalLevels": [
    { "level": "$XX.XX", "direction": "<what happens at this level>" }
  ],
  "outlook": {
    "shortTerm": { "timeframe": "1-5 days", "points": ["<key point>", "<key point>"] },
    "mediumTerm": { "timeframe": "1-4 weeks", "points": ["<key point>", "<key point>"] },
    "targets": { "upside": ["$XX.XX", "$XX.XX"], "downside": ["$XX.XX", "$XX.XX"] },
    "rangePosition": { "pctFromLow": <number 0-100>, "pctFromHigh": <number 0-100> }
  },
  "valuation": {
    "peTrailing": "<P/E trailing with period label e.g. 29.9x (TTM)>",
    "peForward": "<forward P/E e.g. 28.1x (FY25E)>",
    "peg": "<PEG ratio e.g. 1.85>",
    "priceBook": "<P/B e.g. 8.2x>",
    "priceSales": "<P/S e.g. 3.0x>",
    "evRevenue": "<EV/Revenue e.g. 5.2x>",
    "evEbitda": "<EV/EBITDA e.g. 13.0x>",
    "earningsYield": "<earnings yield e.g. 3.34%>"
  },
  "profitability": {
    "grossMargin": "<e.g. 33.3% (TTM)>",
    "opMargin": "<e.g. 20.5% (TTM)>",
    "netMargin": "<e.g. 14.5% (TTM)>",
    "ebitdaMargin": "<e.g. 22.1% (TTM)>",
    "roe": "<e.g. 35.1%>",
    "roa": "<e.g. 12.4%>",
    "roic": "<e.g. 21.1%>"
  },
  "growth": {
    "revYoY": "<e.g. +21.1% YoY>",
    "epsYoY": "<e.g. -7.1% YoY>",
    "fwdRevGrowth": "<e.g. +3.2% (consensus)>",
    "fwdEpsGrowth": "<e.g. +12.5% (consensus)>"
  },
  "balanceSheet": {
    "totalDebt": "<e.g. $12.5B>",
    "netDebt": "<e.g. $-8.2B (net cash)>",
    "debtEquity": "<e.g. 0.15x>",
    "currentRatio": "<e.g. 1.84x>",
    "quickRatio": "<e.g. 1.51x>",
    "interestCoverage": "<e.g. 42.1x>"
  },
  "cashFlow": {
    "fcfTTM": "<e.g. $3.6B>",
    "fcfYield": "<e.g. 0.27%>",
    "fcfPerShare": "<e.g. $1.12>",
    "fcfMargin": "<e.g. 3.7% (TTM)>",
    "capexRevenue": "<e.g. 8.2%>"
  },
  "dividends": {
    "yield": "<e.g. 0.00% or 1.52%>",
    "annualDiv": "<e.g. $0.00 or $3.28>",
    "payoutRatio": "<e.g. N/A or 42.3%>",
    "exDivDate": "<e.g. N/A or Feb 7, 2025>",
    "frequency": "<e.g. None or Quarterly>"
  },
  "shareStructure": {
    "sharesShort": "<e.g. 78.5M>",
    "shortPctFloat": "<e.g. 2.45%>",
    "daysToCover": "<e.g. 1.8>",
    "instOwnership": "<e.g. 46.2%>",
    "insiderOwnership": "<e.g. 12.9%>"
  },
  "earningsAnalyst": {
    "nextEarnings": "<e.g. Apr 22, 2025>",
    "lastEpsSurprise": "<e.g. +12.3%>",
    "consensus": "<one of: STRONG BUY, BUY, HOLD, SELL, STRONG SELL>",
    "meanTarget": "<e.g. $288.98>",
    "numAnalysts": "<e.g. 42>",
    "impliedMove": "<e.g. ±5.2%>"
  },
  "optionsProfile": {
    "ivRank": "<e.g. 45 / 100>",
    "ivPercentile": "<e.g. 52%>",
    "iv30d": "<e.g. 28.5%>",
    "putCallRatio": "<e.g. 0.85>",
    "shortInterest": "<e.g. 2.45% float>",
    "borrowRate": "<e.g. 0.32% ann.>"
  }
}

Every price level MUST come from the provided data. For fundamental sections, use the provided fundamentals data as the single source of truth for market cap, shares, P/E, and EPS. Derive other metrics from your knowledge of the company's latest public filings. Be specific, data-driven, and always label time periods.`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured." });
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
    const chosenModel = model ?? DEFAULT_MODEL;
    await nativeStream({
      prompt,
      modelName: chosenModel,
      temperature: temperature ?? 0.3,
      thinkingBudget: 2048,
      onThinking: (text) => {
        res.write(`data: ${JSON.stringify({ reasoning: text })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      },
      onText: (text) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      },
    });
    clearInterval(heartbeat);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: unknown) {
    clearInterval(heartbeat);
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Technical analysis stream error");
    void logFailure("MARKET_PULSE", "ERROR", `Claude streaming analysis failed: ${msg}`, { endpoint: "/technical-analysis/stream", error: msg });
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
    const response = await callModel(prompt, model ?? DEFAULT_MODEL, temperature ?? 0.3);
    res.json(RunOptionsAnalysisResponse.parse({ response }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Options analysis error");
    void logFailure("MARKET_PULSE", "ERROR", `Claude options analysis failed: ${msg}`, { endpoint: "/options-analysis", error: msg });
    res.json(RunOptionsAnalysisResponse.parse({ response: `**Analysis failed:** ${msg}`, error: msg }));
  }
});

// ── LIVE MARKET PULSE: Symbol definitions ─────────────────────────────────────


interface PulseSymbol {
  display: string;
  api: string;
  category: "equity" | "vol" | "breadth" | "futures" | "currency" | "commodity" | "rates" | "credit";
  description: string;
}

const PULSE_SYMBOLS: PulseSymbol[] = [
  { display: "SPY",     api: "SPY",     category: "equity",    description: "S&P 500 ETF — broad market barometer" },
  { display: "QQQ",     api: "QQQ",     category: "equity",    description: "Nasdaq-100 ETF — tech/growth leadership" },
  { display: "IWM",     api: "IWM",     category: "equity",    description: "Russell 2000 ETF — small-cap risk appetite" },

  { display: "$VIX",    api: "$VIX",    category: "vol",       description: "CBOE VIX — S&P implied vol (30-day), fear gauge" },
  { display: "$VVIX",   api: "$VVIX",   category: "vol",       description: "VVIX — vol-of-vol, tail risk premium indicator" },
  { display: "$VIX1D",  api: "$VIX1D",  category: "vol",       description: "CBOE 1-Day VIX — ultra-short implied vol" },
  { display: "$VIX9D",  api: "$VIX9D",  category: "vol",       description: "CBOE 9-Day VIX — near-term implied vol" },
  { display: "$VIX3M",  api: "$VIX3M",  category: "vol",       description: "CBOE 3-Month VIX — medium-term implied vol" },
  { display: "$VXN",    api: "$VXN",    category: "vol",       description: "CBOE Nasdaq VIX — tech sector implied vol" },
  { display: "$RVX",    api: "$RVX",    category: "vol",       description: "CBOE Russell 2000 VIX — small-cap implied vol" },
  { display: "$OVX",    api: "$OVX",    category: "vol",       description: "CBOE Oil VIX — crude oil implied vol" },
  { display: "$GVZ",    api: "$GVZ",    category: "vol",       description: "CBOE Gold VIX — gold implied vol" },

  { display: "$PCUSEQTR", api: "$PCUSEQTR", category: "vol",   description: "CBOE Equity Put/Call Ratio (Polygon SPY options)" },
  { display: "$PCUSINXR", api: "$PCUSINXR", category: "vol",   description: "CBOE Index Put/Call Ratio (Polygon SPX options)" },

  { display: "$TICK",   api: "$TICK",   category: "breadth",   description: "NYSE TICK — stocks upticking minus downticking" },
  { display: "$ADD",    api: "$ADD",    category: "breadth",   description: "NYSE A/D Line — advancers minus decliners" },
  { display: "$TRIN",   api: "$TRIN",   category: "breadth",   description: "NYSE TRIN/Arms Index — <1.0 bullish, >1.0 bearish" },
  { display: "$ADVN",   api: "$ADVN",   category: "breadth",   description: "NYSE Advancing Issues" },
  { display: "$DECN",   api: "$DECN",   category: "breadth",   description: "NYSE Declining Issues" },
  { display: "$UVOL",   api: "$UVOL",   category: "breadth",   description: "NYSE Up Volume" },
  { display: "$DVOL",   api: "$DVOL",   category: "breadth",   description: "NYSE Down Volume" },

  { display: "$TICKI",  api: "$TICKI",  category: "breadth",   description: "NASDAQ TICK" },
  { display: "$ADDQ",   api: "$ADDQ",   category: "breadth",   description: "NASDAQ A/D Line" },
  { display: "$TRINQ",  api: "$TRINQ",  category: "breadth",   description: "NASDAQ TRIN" },
  { display: "$ADVNQ",  api: "$ADVNQ",  category: "breadth",   description: "NASDAQ Advancing Issues" },
  { display: "$DECNQ",  api: "$DECNQ",  category: "breadth",   description: "NASDAQ Declining Issues" },
  { display: "$UVOLQ",  api: "$UVOLQ",  category: "breadth",   description: "NASDAQ Up Volume" },
  { display: "$DVOLQ",  api: "$DVOLQ",  category: "breadth",   description: "NASDAQ Down Volume" },

  { display: "$TNX",    api: "$TNX",    category: "rates",     description: "10-Year Treasury Yield Index" },
  { display: "$TYX",    api: "$TYX",    category: "rates",     description: "30-Year Treasury Yield Index" },
  { display: "$IRX",    api: "$IRX",    category: "rates",     description: "13-Week T-Bill Yield Index" },
  { display: "/ZB",     api: "/ZB",     category: "rates",     description: "30Y Treasury Bond Futures" },
  { display: "/ZT",     api: "/ZT",     category: "rates",     description: "2Y Treasury Note Futures" },
  { display: "/ZF",     api: "/ZF",     category: "rates",     description: "5Y Treasury Note Futures" },
  { display: "/ZN",     api: "/ZN",     category: "rates",     description: "10Y Treasury Note Futures" },
  { display: "/ZQ",     api: "/ZQ",     category: "rates",     description: "30-Day Fed Funds Futures" },

  { display: "HYG",     api: "HYG",     category: "credit",    description: "iShares High Yield Corporate Bond ETF" },
  { display: "LQD",     api: "LQD",     category: "credit",    description: "iShares Investment Grade Corporate Bond ETF" },
  { display: "IEF",     api: "IEF",     category: "credit",    description: "iShares 7-10 Year Treasury Bond ETF" },
  { display: "TLT",     api: "TLT",     category: "credit",    description: "iShares 20+ Year Treasury Bond ETF" },

  { display: "/ES",     api: "/ES",     category: "futures",   description: "E-mini S&P 500 Futures" },
  { display: "/NQ",     api: "/NQ",     category: "futures",   description: "E-mini Nasdaq-100 Futures" },
  { display: "/YM",     api: "/YM",     category: "futures",   description: "Mini Dow Jones Futures" },
  { display: "/RTY",    api: "/RTY",    category: "futures",   description: "E-mini Russell 2000 Futures" },

  { display: "/GC",     api: "/GC",     category: "commodity", description: "Gold Futures — safe-haven / real rates proxy" },
  { display: "/CL",     api: "/CL",     category: "commodity", description: "Crude Oil Futures (WTI)" },
  { display: "/BZ",     api: "/BZ",     category: "commodity", description: "Brent Crude Oil Futures (Schwab WS)" },
  { display: "/HG",     api: "/HG",     category: "commodity", description: "Copper Futures — global growth proxy" },

  { display: "/DX",     api: "/DX",     category: "currency",  description: "US Dollar Index Futures" },
  { display: "/6E",     api: "/6E",     category: "currency",  description: "Euro FX Futures" },
  { display: "/6J",     api: "/6J",     category: "currency",  description: "Japanese Yen Futures — risk-off proxy" },

  { display: "$DXY",    api: "$DXY",    category: "currency",  description: "US Dollar Index (synthetic from /6E)" },
];

// Maps user-facing symbols to Schwab API format (adds $ prefix for known indices)
const INDEX_TO_SCHWAB: Record<string, string> = {
  "VIX": "$VIX", "VVIX": "$VVIX", "SPX": "$SPX", "NDX": "$NDX",
  "RUT": "$RUT", "DJI": "$DJI", "DJIA": "$DJI", "COMP": "$COMP",
  "DXY": "$DXY", "TNX": "$TNX", "TYX": "$TYX", "IRX": "$IRX",
  "VXN": "$VXN", "RVX": "$RVX", "OVX": "$OVX", "GVZ": "$GVZ",
  "TICK": "$TICK", "ADD": "$ADD", "TRIN": "$TRIN",
  "OEX": "$OEX", "MNX": "$MNX", "XSP": "$XSP",
  "VIX1D": "$VIX1D", "VIX9D": "$VIX9D", "VIX3M": "$VIX3M",
  "ADVN": "$ADVN", "DECN": "$DECN",
  "UVOL": "$UVOL", "DVOL": "$DVOL",
  "TICKI": "$TICKI", "ADDQ": "$ADDQ", "TRINQ": "$TRINQ",
  "ADVNQ": "$ADVNQ", "DECNQ": "$DECNQ",
  "UVOLQ": "$UVOLQ", "DVOLQ": "$DVOLQ",
};

function symbolToSchwabApi(userSymbol: string): string {
  const upper = userSymbol.toUpperCase().trim().replace(/\.X$/, "");
  return INDEX_TO_SCHWAB[upper] ?? upper;
}

registerPermanentSymbols(
  PULSE_SYMBOLS
    .filter(s => s.category === "breadth" || (s.category === "vol" && s.display.startsWith("$")))
    .map(s => s.display)
);

function ensurePulseSubscriptions() {
  const equitySyms: string[] = [];
  const futuresSyms: string[] = [];
  for (const s of PULSE_SYMBOLS) {
    if (s.category === "breadth" || (s.category === "vol" && s.display.startsWith("$"))) continue;
    if (s.display.startsWith("/")) {
      futuresSyms.push(s.display);
    } else {
      equitySyms.push(s.api);
    }
  }
  if (equitySyms.length > 0) addSchwabSymbols(equitySyms);
  if (futuresSyms.length > 0) addSchwabFuturesSymbols(futuresSyms);
}
ensurePulseSubscriptions();


function readFromWebSocketCache(
  userSymbols?: string[]
): { dataMap: Map<string, Record<string, unknown>>; displayToApi: Map<string, string>; hitCount: number } {
  const ibSnapshot = getIBSnapshot();
  const ibCacheBySymbol = new Map<string, LiveQuote>();
  for (const q of ibSnapshot) {
    ibCacheBySymbol.set(q.symbol, q);
  }

  const schwabSnapshot = getSnapshot();
  const schwabCacheBySymbol = new Map<string, LiveQuote>();
  for (const q of schwabSnapshot) {
    schwabCacheBySymbol.set(q.symbol, q);
  }

  let pairs: Array<{ display: string; api: string }>;
  if (userSymbols && userSymbols.length > 0) {
    pairs = userSymbols.map(s => ({
      display: s.toUpperCase().trim(),
      api: symbolToSchwabApi(s),
    }));
  } else {
    pairs = PULSE_SYMBOLS.map(s => ({ display: s.display, api: s.api }));
  }

  const displayToApi = new Map<string, string>(pairs.map(p => [p.display, p.api]));
  const dataMap = new Map<string, Record<string, unknown>>();
  let hitCount = 0;

  for (const pair of pairs) {
    let q: LiveQuote | null | undefined = null;

    const pulseDef = PULSE_SYMBOLS.find(s => s.display === pair.display);
    const isIBSymbol = pulseDef
      && (pulseDef.category === "breadth" || (pulseDef.category === "vol" && pulseDef.display.startsWith("$")));

    if (isIBSymbol) {
      q = ibCacheBySymbol.get(pair.display) ?? getIBCachedQuote(pair.display);
    } else {
      q = schwabCacheBySymbol.get(pair.display)
        ?? schwabCacheBySymbol.get(pair.api);
    }

    if (q && q.last !== null) {
      hitCount++;
      dataMap.set(pair.display, {
        lastPrice: q.last,
        mark: q.last,
        closePrice: q.close,
        close: q.close,
        netChange: q.change,
        markChange: q.change,
        netPercentChange: q.changePct,
        markPercentChange: q.changePct,
        highPrice: q.high,
        high: q.high,
        lowPrice: q.low,
        low: q.low,
        totalVolume: q.volume,
        volume: q.volume,
        bidPrice: q.bid,
        askPrice: q.ask,
      });
    }
  }

  const eqPC = getEquityPCRatio();
  if (eqPC && eqPC.ratio !== null) {
    hitCount += dataMap.has("$PCUSEQTR") ? 0 : 1;
    dataMap.set("$PCUSEQTR", {
      lastPrice: eqPC.ratio, mark: eqPC.ratio,
      closePrice: null, close: null,
      netChange: null, markChange: null,
      netPercentChange: null, markPercentChange: null,
      highPrice: null, high: null, lowPrice: null, low: null,
      totalVolume: eqPC.putVolume + eqPC.callVolume, volume: eqPC.putVolume + eqPC.callVolume,
      bidPrice: null, askPrice: null,
      putVolume: eqPC.putVolume, callVolume: eqPC.callVolume,
      source: "polygon",
    });
  }
  const idxPC = getIndexPCRatio();
  if (idxPC && idxPC.ratio !== null) {
    hitCount += dataMap.has("$PCUSINXR") ? 0 : 1;
    dataMap.set("$PCUSINXR", {
      lastPrice: idxPC.ratio, mark: idxPC.ratio,
      closePrice: null, close: null,
      netChange: null, markChange: null,
      netPercentChange: null, markPercentChange: null,
      highPrice: null, high: null, lowPrice: null, low: null,
      totalVolume: idxPC.putVolume + idxPC.callVolume, volume: idxPC.putVolume + idxPC.callVolume,
      bidPrice: null, askPrice: null,
      putVolume: idxPC.putVolume, callVolume: idxPC.callVolume,
      source: "polygon",
    });
  }

  if (!dataMap.has("$DXY") || !(dataMap.get("$DXY")?.["lastPrice"])) {
    const sixE = schwabCacheBySymbol.get("/6E") ?? ibCacheBySymbol.get("/6E");
    if (sixE && sixE.last && sixE.close && sixE.close > 0) {
      const eurChangePct = ((sixE.last - sixE.close) / sixE.close) * 100;
      const DXY_PREV_CLOSE = getSyntheticDxyPrevClose();
      const dxyChangePct = -eurChangePct * 0.576;
      const syntheticDxy = Math.round((DXY_PREV_CLOSE * (1 + dxyChangePct / 100)) * 1000) / 1000;
      const dxyChange = Math.round((syntheticDxy - DXY_PREV_CLOSE) * 1000) / 1000;
      dataMap.set("$DXY", {
        lastPrice: syntheticDxy, mark: syntheticDxy,
        closePrice: DXY_PREV_CLOSE, close: DXY_PREV_CLOSE,
        netChange: dxyChange, markChange: dxyChange,
        netPercentChange: Math.round(dxyChangePct * 10000) / 10000,
        markPercentChange: Math.round(dxyChangePct * 10000) / 10000,
        highPrice: null, high: null, lowPrice: null, low: null,
        totalVolume: null, volume: null, bidPrice: null, askPrice: null,
        synthetic: true, derivedFrom: "/6E",
      });
      hitCount++;
    }
  }

  return { dataMap, displayToApi, hitCount };
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

  const advn = lastOrMark('$ADVN');
  const decn = lastOrMark('$DECN');
  const addRaw = lastOrMark('$ADD');
  const add = addRaw !== null
    ? addRaw
    : (advn !== null && decn !== null ? advn - decn : null);
  const tickVal = lastOrMark('$TICK');
  const trinVal = lastOrMark('$TRIN');

  const advnq = lastOrMark('$ADVNQ');
  const decnq = lastOrMark('$DECNQ');
  const addqRaw = lastOrMark('$ADDQ');
  const addq = addqRaw !== null
    ? addqRaw
    : (advnq !== null && decnq !== null ? advnq - decnq : null);

  return {
    vix: lastOrMark('$VIX'),
    vixChange: pctChange('$VIX'),
    vvix: lastOrMark('$VVIX'),
    vvixChange: pctChange('$VVIX'),
    vix1d: lastOrMark('$VIX1D'),
    vix1dChange: pctChange('$VIX1D'),
    vix3m: lastOrMark('$VIX3M'),
    vix3mChange: pctChange('$VIX3M'),
    vix9d: lastOrMark('$VIX9D'),
    vix9dChange: pctChange('$VIX9D'),
    vxn: lastOrMark('$VXN'),
    vxnChange: pctChange('$VXN'),
    rvx: lastOrMark('$RVX'),
    rvxChange: pctChange('$RVX'),
    ovx: lastOrMark('$OVX'),
    ovxChange: pctChange('$OVX'),
    gvz: lastOrMark('$GVZ'),
    gvzChange: pctChange('$GVZ'),
    vixFut: lastOrMark('$VIX'),
    vixFutChange: pctChange('$VIX'),

    tnx: yieldIndex('$TNX'),
    tnxChange: pctChange('$TNX'),
    tyx: yieldIndex('$TYX'),
    tyxChange: pctChange('$TYX'),
    irx: yieldIndex('$IRX'),
    irxChange: pctChange('$IRX'),
    zb: lastOrMark('/ZB'),
    zbChange: pctChange('/ZB'),
    zt: lastOrMark('/ZT'),
    ztChange: pctChange('/ZT'),
    zf: lastOrMark('/ZF'),
    zfChange: pctChange('/ZF'),
    zn: lastOrMark('/ZN'),
    znChange: pctChange('/ZN'),
    zq: lastOrMark('/ZQ'),
    zqChange: pctChange('/ZQ'),

    hyg: lastOrMark('HYG'),
    hygChange: pctChange('HYG'),
    lqd: lastOrMark('LQD'),
    lqdChange: pctChange('LQD'),
    ief: lastOrMark('IEF'),
    iefChange: pctChange('IEF'),
    tlt: lastOrMark('TLT'),
    tltChange: pctChange('TLT'),

    advn,
    decn,
    tick: tickVal,
    trin: trinVal,
    add,
    uvol: lastOrMark('$UVOL'),
    dvol: lastOrMark('$DVOL'),
    ticki: lastOrMark('$TICKI'),
    trinq: lastOrMark('$TRINQ'),
    addq,
    advnq,
    decnq,
    uvolq: lastOrMark('$UVOLQ'),
    dvolq: lastOrMark('$DVOLQ'),

    es: lastOrMark('/ES'),
    esChange: pctChange('/ES'),
    nq: lastOrMark('/NQ'),
    nqChange: pctChange('/NQ'),
    ym: lastOrMark('/YM'),
    ymChange: pctChange('/YM'),
    rty: lastOrMark('/RTY'),
    rtyChange: pctChange('/RTY'),
    spy: lastOrMark('SPY'),
    spyChange: pctChange('SPY'),
    qqq: lastOrMark('QQQ'),
    qqqChange: pctChange('QQQ'),
    iwm: lastOrMark('IWM'),
    iwmChange: pctChange('IWM'),

    gc: lastOrMark('/GC'),
    gcChange: pctChange('/GC'),
    cl: lastOrMark('/CL'),
    clChange: pctChange('/CL'),
    bz: lastOrMark('/BZ'),
    bzChange: pctChange('/BZ'),
    hg: lastOrMark('/HG'),
    hgChange: pctChange('/HG'),
    dx: lastOrMark('$DXY') ?? lastOrMark('/DX'),
    dxChange: pctChange('$DXY') ?? pctChange('/DX'),
    sixE: lastOrMark('/6E'),
    sixEChange: pctChange('/6E'),
    sixJ: lastOrMark('/6J'),
    sixJChange: pctChange('/6J'),

    cpce: lastOrMark('$PCUSEQTR'),
    cpci: lastOrMark('$PCUSINXR'),
  };
}

// ── MARKET SESSION DETECTION ─────────────────────────────────────────────────

function sessionToEngineType(session: string): SessionType {
  if (session.includes('Pre-Market')) return 'PRE_MARKET';
  if (session.includes('Regular')) return 'RTH';
  if (session.includes('Weekend')) return 'WEEKEND';
  return 'OVERNIGHT';
}

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
  ensurePulseSubscriptions();
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
    const wsResult = readFromWebSocketCache(symbols);
    const expectedCount = symbols && symbols.length > 0 ? symbols.length : PULSE_SYMBOLS.length;
    const minRequired = Math.max(5, Math.ceil(expectedCount * 0.4));
    const missingSym = PULSE_SYMBOLS.filter(s => !wsResult.dataMap.has(s.display)).map(s => s.display);
    req.log.info({ source: "ib+schwab", hits: wsResult.hitCount, expected: expectedCount, minRequired, missing: missingSym }, "Pulse data from IB/Schwab cache");
    if (wsResult.hitCount < minRequired) {
      return res.json({ response: `**Waiting for WebSocket data.** Only ${wsResult.hitCount}/${expectedCount} symbols available (need ${minRequired}). Ensure the live streamer is connected.`, error: "insufficient_ws_data" });
    }
    dataBlock = buildPulseDataBlock(wsResult.dataMap, symbols && symbols.length > 0 ? symbols : undefined);
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
    const response = await callModel(prompt, model ?? DEFAULT_MODEL, temperature ?? 0.2);
    res.json({ response });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Market pulse error");
    res.json({ response: `**Live Market Pulse failed:** ${msg}`, error: msg });
  }
});

router.post("/market-pulse", async (req, res) => {
  ensurePulseSubscriptions();
  const { symbols, model, temperature, riskTolerance } = req.body as {
    accessToken?: string;
    symbols?: string[];
    model?: string;
    temperature?: number;
    riskTolerance?: string;
  };

  const { session, timeET, sessionGuidance } = getMarketSession();

  let dataBlock: string;
  try {
    const wsResult = readFromWebSocketCache(symbols);
    const expectedCount = symbols && symbols.length > 0 ? symbols.length : PULSE_SYMBOLS.length;
    const minRequired = Math.max(5, Math.ceil(expectedCount * 0.4));
    const missingAnalysis = PULSE_SYMBOLS.filter(s => !wsResult.dataMap.has(s.display)).map(s => s.display);
    req.log.info({ source: "ib+schwab", hits: wsResult.hitCount, expected: expectedCount, minRequired, missing: missingAnalysis }, "Analysis data from IB/Schwab cache");
    if (wsResult.hitCount < minRequired) {
      return res.status(503).json({ error: `Insufficient WebSocket data: ${wsResult.hitCount}/${expectedCount} symbols (need ${minRequired}). Ensure the live streamer is connected.` });
    }
    dataBlock = buildPulseDataBlock(wsResult.dataMap, symbols && symbols.length > 0 ? symbols : undefined);
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
    const raw = await callModel(prompt, model ?? DEFAULT_MODEL, temperature ?? 0.2);

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

router.get("/delta-health", (_req, res) => {
  const health = getDeltaHealth();
  if (!health) return res.json({ status: "awaiting_baseline" });
  return res.json(health);
});

router.post("/delta-snapshot", (req, res) => {
  const { triggerType, eventMeta } = req.body as { triggerType?: string; eventMeta?: Record<string, unknown> };
  if (triggerType === "event") {
    triggerEventSnapshot(eventMeta);
  } else {
    triggerManualSnapshot();
  }
  const health = getDeltaHealth();
  return res.json({ ok: true, deltaHealth: health });
});

router.get("/market-pulse/latest", (_req, res) => {
  if (pulseGenerationInFlight) {
    return res.json({ status: "in_flight", thinkingTokens: pulseThinkingBuffer, statusText: pulseStatusText });
  }
  if (lastPulseError) {
    const err = lastPulseError;
    lastPulseError = null;
    return res.json({ status: "error", error: err });
  }
  if (lastPulseResult && (Date.now() - lastPulseResult.generatedAt) < 2 * 60 * 60 * 1000) {
    return res.json({ status: "ready", pulse: lastPulseResult.pulse, thinkingTokens: lastPulseResult.thinkingTokens });
  }
  return res.json({ status: "none" });
});

router.post("/market-pulse/stream", async (req, res) => {
  ensurePulseSubscriptions();
  const { symbols, model, temperature, preferences, previousBias } = req.body as {
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured." });
  }

  pulseGenerationInFlight = true;
  lastPulseError = null;
  pulseThinkingBuffer = [];
  pulseStatusText = "Fetching market data...";
  let clientConnected = true;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Transfer-Encoding": "chunked",
  });

  req.socket?.setKeepAlive(true);
  req.socket?.setNoDelay(true);
  req.setTimeout(0);
  res.setTimeout(0);
  if (req.socket) req.socket.setTimeout(0);
  (res as any).socket?.setNoDelay?.(true);

  req.on("close", () => {
    clientConnected = false;
    req.log.info("Pulse stream client disconnected — generation will continue in background");
  });

  safeSseWrite(res, ": ok\n\n");
  res.flushHeaders();
  sseFlushPadding(res);
  safeSseWrite(res, `event: status\ndata: ${JSON.stringify({ type: "status", text: "Fetching live market data..." })}\n\n`);

  const heartbeat = setInterval(() => {
    if (!clientConnected || res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    safeSseWrite(res, ": ping\n\n");
  }, 5000);

  const { session, timeET, sessionGuidance } = getMarketSession();

  let dataMap: Map<string, Record<string, unknown>>;
  let dataBlock: string;
  try {
    // Always read the full PULSE_SYMBOLS from cache so all 59 rawIndicator fields
    // can be populated by extractMarketIndicators.  The user's `symbols` selection
    // only controls which indicators are sent to the AI in the dataBlock — it must
    // not limit which cache entries are available.
    const wsResult = readFromWebSocketCache();
    const expectedCount = PULSE_SYMBOLS.length;
    const minRequired = Math.max(5, Math.ceil(expectedCount * 0.4));
    const missingStream = PULSE_SYMBOLS.filter(s => !wsResult.dataMap.has(s.display)).map(s => s.display);
    req.log.info({ source: "ib+schwab", hits: wsResult.hitCount, expected: expectedCount, minRequired, missing: missingStream }, "Pulse stream data from IB/Schwab cache");
    if (wsResult.hitCount < minRequired) {
      clearInterval(heartbeat);
      pulseGenerationInFlight = false;
      lastPulseError = `Insufficient market data: ${wsResult.hitCount}/${expectedCount} symbols available (need ${minRequired}). Ensure the live streamer is connected.`;
      safeSseWrite(res, `event: error\ndata: ${JSON.stringify({ type: "error", message: lastPulseError })}\n\n`);
      if (!res.writableEnded) res.end();
      return;
    }
    dataMap = wsResult.dataMap;
    dataBlock = buildPulseDataBlock(dataMap, symbols && symbols.length > 0 ? symbols : undefined);
    pulseStatusText = "Market data loaded. Running scoring engine...";
    safeSseWrite(res, `event: status\ndata: ${JSON.stringify({ type: "status", text: "Market data loaded. Running scoring engine..." })}\n\n`);
  } catch (fetchErr: unknown) {
    clearInterval(heartbeat);
    pulseGenerationInFlight = false;
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    lastPulseError = `Market data fetch failed: ${msg}`;
    req.log.error({ err: fetchErr }, "Market pulse stream data fetch error");
    safeSseWrite(res, `event: error\ndata: ${JSON.stringify({ type: "error", message: lastPulseError })}\n\n`);
    if (!res.writableEnded) res.end();
    return;
  }

  const indicators = extractMarketIndicators(dataMap);

  const pulseBatch = createTelemetryBatch("MARKET_PULSE");
  emitTelemetry("MARKET_PULSE", "INFO", "Pulse refresh initiated — extracting indicators", {
    dataSymbols: dataMap.size,
    session,
    timeET,
  }, "MARKET_PULSE", pulseBatch);

  const indNames = ["vix", "vix9d", "vix3m", "vix1d", "tick", "trin", "add", "advn", "decn", "dvol", "uvol",
    "tickiQ", "trinQ", "addQ", "advnQ", "decnQ", "dvolQ", "uvolQ",
    "spy", "qqq", "iwm", "dia", "tlt", "hyg", "lqd",
    "tnx", "tyx", "irx", "dxy", "gc", "cl", "hg",
    "es", "nq", "ym", "rty", "vvix", "rvx", "vxn", "ovx", "gvz",
    "pcEquity", "pcIndex"] as const;
  for (const name of indNames) {
    const val = (indicators as any)[name];
    if (val !== undefined && val !== null) {
      emitTelemetry("MARKET_PULSE", "INFO", `Indicator ${name.toUpperCase()} = ${typeof val === "number" ? val.toFixed(4) : val}`, {
        indicator: name,
        value: val,
        source: "cache",
        status: "live",
      }, "MARKET_PULSE", pulseBatch);
    }
  }

  req.log.info({
    breadthData: { tick: indicators.tick, trin: indicators.trin, add: indicators.add, advn: indicators.advn, decn: indicators.decn },
    volTermData: { vix: indicators.vix, vix9d: indicators.vix9d, vix3m: indicators.vix3m },
  }, "Market pulse engine input (breadth + volTerm)");
  const engineResult = runMarketPulseEngine(indicators, previousBias, sessionToEngineType(session));

  void updateRegimeFromPulse(engineResult).catch(() => {});

  const clusterNames = Object.keys(engineResult.clusters) as Array<keyof typeof engineResult.clusters>;
  for (const cn of clusterNames) {
    const cl = engineResult.clusters[cn];
    if (!cl) continue;
    emitTelemetry("MARKET_PULSE", "INFO", `Cluster ${cn}: score ${(cl.score ?? 0).toFixed(2)}, weight ${(cl.weight ?? 0).toFixed(2)}, rules [${(cl.rulesApplied ?? []).join(", ")}]`, {
      cluster: cn,
      score: cl.score ?? 0,
      weight: cl.weight ?? 0,
      rulesApplied: cl.rulesApplied ?? [],
    }, "MARKET_PULSE", pulseBatch);
  }

  emitTelemetry("MARKET_PULSE", "INFO", `Pulse scored: ${engineResult.bias} — composite ${engineResult.compositeScore >= 0 ? "+" : ""}${engineResult.compositeScore.toFixed(2)}, confidence ${engineResult.confidenceScore}%`, {
    bias: engineResult.bias,
    composite: engineResult.compositeScore,
    confidence: engineResult.confidenceScore,
  }, "MARKET_PULSE", pulseBatch);

  req.log.info({
    breadthScore: engineResult.clusters.breadth.score,
    breadthRules: engineResult.clusters.breadth.rulesApplied,
    volTermScore: engineResult.clusters.volTerm.score,
    volTermRules: engineResult.clusters.volTerm.rulesApplied,
    composite: engineResult.compositeScore,
    confidence: engineResult.confidenceScore,
    bias: engineResult.bias,
  }, "Market pulse engine output (breadth + volTerm scores)");

  if (engineResult.confidenceScore < 20) {
    emitTelemetry("MARKET_PULSE", "WARN", `Low pulse confidence: ${engineResult.confidenceScore}% — data may be insufficient`, {
      confidence: engineResult.confidenceScore,
      bias: engineResult.bias,
      composite: engineResult.compositeScore,
    }, "MARKET_PULSE", pulseBatch);
    void logFailure("MARKET_PULSE", "WARN", `Low pulse confidence: ${engineResult.confidenceScore}% — data may be insufficient`, {
      confidence: engineResult.confidenceScore,
      bias: engineResult.bias,
      composite: engineResult.compositeScore,
    });
  }

  const shockResult = evaluateRegimeShock(indicators);
  req.log.info({
    shockState: shockResult.shockState,
    activeTriggers: shockResult.activeTriggers.map(t => t.trigger),
    previousState: shockResult.previousState,
  }, "Regime shock detector output");

  if (shockResult.shockState === "ACTIVE" && shockResult.previousState !== "ACTIVE") {
    sendPushToAll({
      title: "⚠️ REGIME SHOCK ACTIVE",
      body: `${shockResult.activeTriggers.length} triggers fired: ${shockResult.activeTriggers.map(t => t.trigger).join(", ")}`,
      tag: "regime-shock",
      data: { shockState: "ACTIVE" },
    }).catch(() => {});
  }
  if (shockResult.shockState === "NORMAL" && shockResult.previousState === "COOLING") {
    sendPushToAll({
      title: "✅ REGIME SHOCK CLEARED",
      body: "Market shock has fully cooled down. Normal operations resumed.",
      tag: "regime-shock-clear",
      data: { shockState: "NORMAL" },
    }).catch(() => {});
  }

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

  const clusterDebug = formatClusterDebugLine(engineResult);
  pulseStatusText = `Engine scored: ${engineResult.bias} (composite ${engineResult.compositeScore >= 0 ? '+' : ''}${engineResult.compositeScore.toFixed(2)}, confidence ${engineResult.confidenceScore}%). Generating AI narrative...`;
  safeSseWrite(res, `event: status\ndata: ${JSON.stringify({ type: "status", text: `${pulseStatusText} ${clusterDebug}.` })}\n\n`);

  const instrumentCount = (symbols && symbols.length > 0 ? symbols : PULSE_SYMBOLS.map(s => s.display)).length;

  const strategyPrefsBlock = preferences
    ? `\nUSER PREFERENCES:
- Allowed strategies: ${preferences.allowedStrategies?.join(", ") || "All"}
- Default spread width: ${preferences.defaultSpreadWidth || "Standard"}
- Preferred tickers: ${preferences.preferredTickers || "Any"}`
    : "";

  const upcomingEvents = getUpcomingEvents(2);
  const upcomingEventsBlock = upcomingEvents.length > 0
    ? `\nUPCOMING MARKET EVENTS (next 2 trading days):\n${upcomingEvents.map(e => `- ${e.dateFormatted}${e.time ? ` ${e.time}` : ""}: ${e.title} [${e.importance}]`).join("\n")}\nFactor these events into your action plan. If a HIGH-importance event is imminent, mention it in your synthesis and adjust conviction accordingly.`
    : "";

  const shockWarningBlock = shockResult.shockState === "ACTIVE"
    ? `\n⚠️ REGIME SHOCK ACTIVE — ${shockResult.activeTriggers.length} triggers fired (${shockResult.activeTriggers.map(t => t.trigger).join(", ")}). Your narrative MUST lead with a shock warning. Emphasize capital preservation. Recommend hedging only. Do NOT recommend directional entries.\n`
    : shockResult.shockState === "WARNING"
    ? `\n⚠️ REGIME SHOCK WARNING — ${shockResult.activeTriggers.length} triggers fired (${shockResult.activeTriggers.map(t => t.trigger).join(", ")}). Your narrative should note elevated regime stress and recommend caution. Suggest reduced position sizes.\n`
    : "";

  const narrativePrompt = `You are a senior market strategist writing institutional-grade analysis. You receive pre-calculated market scores from a deterministic scoring engine. Your job is to INTERPRET the scores, NOT recalculate them.
${shockWarningBlock}
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
${spyDivergenceBlock}${strategyPrefsBlock}${upcomingEventsBlock}

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
    let hasEmittedThinking = false;
    const responseBuffer = await nativeStream({
      prompt: narrativePrompt,
      modelName: model ?? DEFAULT_MODEL,
      temperature: temperature ?? 0,
      thinkingBudget: 4096,
      onThinking: (text) => {
        hasEmittedThinking = true;
        pulseThinkingBuffer.push(text);
        if (clientConnected) {
          safeSseWrite(res, `event: thinking\ndata: ${JSON.stringify({ type: "thinking", text })}\n\n`);
        }
      },
      onText: (text) => {
        if (!hasEmittedThinking) {
          pulseThinkingBuffer.push(text);
          if (clientConnected) {
            safeSseWrite(res, `event: thinking\ndata: ${JSON.stringify({ type: "thinking", text })}\n\n`);
          }
        }
      },
    });

    clearInterval(heartbeat);

    let cleaned = responseBuffer.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    let finalPulse: Record<string, unknown>;
    try {
      const narrative = JSON.parse(cleaned);

      const deltaHealth = getDeltaHealth();
      const rawConfidence = engineResult.confidenceScore;
      const deltaAdj = deltaHealth?.confidenceAdjustment ?? 0;
      const displayedConfidence = Math.min(100, Math.max(0, rawConfidence + deltaAdj));

      finalPulse = {
        ...engineResult,
        confidenceScore: displayedConfidence,
        rawConfidenceScore: rawConfidence,
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
          reasoning: engineResult.riskStateReasoning,
        },
        invalidation: {
          conditions: narrative.invalidationConditions || [],
        },
        actionPlan: narrative.actionPlan || [],
        shockState: shockResult.shockState,
        activeTriggers: shockResult.activeTriggers,
        shockActivatedAt: shockResult.shockActivatedAt,
        shockActive: shockResult.shockActive,
        deltaHealth: deltaHealth ?? undefined,
        upcomingEvents,
        session,
        timeET,
        instrumentCount,
        generatedAt: Date.now(),
      };
    } catch (parseErr) {
      console.error("[PULSE STREAM] Narrative JSON parse failed:", parseErr);
      console.error("[PULSE STREAM] Raw narrative:", cleaned.substring(0, 500));
      req.log.error({ err: parseErr, rawLength: responseBuffer.length }, "Market pulse narrative parse error");

      const deltaHealthFb = getDeltaHealth();
      const rawConfFb = engineResult.confidenceScore;
      const deltaAdjFb = deltaHealthFb?.confidenceAdjustment ?? 0;
      const displayedConfFb = Math.min(100, Math.max(0, rawConfFb + deltaAdjFb));

      finalPulse = {
        ...engineResult,
        confidenceScore: displayedConfFb,
        rawConfidenceScore: rawConfFb,
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
          reasoning: engineResult.riskStateReasoning,
        },
        invalidation: { conditions: [] },
        actionPlan: [],
        shockState: shockResult.shockState,
        activeTriggers: shockResult.activeTriggers,
        shockActivatedAt: shockResult.shockActivatedAt,
        shockActive: shockResult.shockActive,
        deltaHealth: deltaHealthFb ?? undefined,
        upcomingEvents,
        session,
        timeET,
        instrumentCount,
        generatedAt: Date.now(),
      };
    }

    lastPulseResult = { pulse: finalPulse, generatedAt: Date.now(), thinkingTokens: [...pulseThinkingBuffer] };
    pulseGenerationInFlight = false;
    req.log.info({ clientConnected, bias: (finalPulse as any).bias, thinkingTokenCount: pulseThinkingBuffer.length }, "Pulse generation complete — result cached");

    safeSseWrite(res, `event: result\ndata: ${JSON.stringify({ type: "complete", pulse: finalPulse })}\n\n`);
    if (!res.writableEnded) res.end();
  } catch (err: unknown) {
    clearInterval(heartbeat);
    pulseGenerationInFlight = false;
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error("[PULSE STREAM] Error:", err);
    req.log.error({ err }, "Market pulse stream error");
    let cleanMsg = rawMsg;
    try {
      const parsed = JSON.parse(rawMsg);
      if (parsed?.error?.message) cleanMsg = parsed.error.message;
      else if (parsed?.message) cleanMsg = parsed.message;
    } catch {
      // not JSON, use raw message as-is
    }
    lastPulseError = `Generation failed — ${cleanMsg}. Please retry.`;
    safeSseWrite(res, `event: error\ndata: ${JSON.stringify({ type: "error", message: lastPulseError })}\n\n`);
    if (!res.writableEnded) res.end();
  }
});

const SCHWAB_CHAIN_BASE = "https://api.schwabapi.com/marketdata/v1";

function parseChainContracts(map: Record<string, unknown>): OptionContract[] {
  const contracts: OptionContract[] = [];
  for (const expDate of Object.values(map)) {
    const strikeMap = expDate as Record<string, unknown>;
    for (const [, options] of Object.entries(strikeMap)) {
      const optionArr = options as Array<Record<string, unknown>>;
      for (const opt of optionArr) {
        contracts.push({
          strike: opt["strikePrice"] as number,
          expiration: opt["expirationDate"] as string,
          schwabSymbol: opt["symbol"] as string | undefined,
          bid: opt["bid"] as number | undefined,
          ask: opt["ask"] as number | undefined,
          last: opt["last"] as number | undefined,
          volume: opt["totalVolume"] as number | undefined,
          openInterest: opt["openInterest"] as number | undefined,
          iv: opt["volatility"] as number | undefined,
          delta: opt["delta"] as number | undefined,
          gamma: opt["gamma"] as number | undefined,
          theta: opt["theta"] as number | undefined,
          vega: opt["vega"] as number | undefined,
          dte: opt["daysToExpiration"] as number | undefined,
        });
      }
    }
  }
  return contracts;
}

async function fetchDailyCandles(
  symbol: string,
  accessToken: string,
): Promise<DailyCandle[]> {
  try {
    const apiSymbol = symbolToSchwabApi(symbol);
    const params = new URLSearchParams({
      symbol: apiSymbol,
      periodType: "month",
      period: "1",
      frequencyType: "daily",
      frequency: "1",
      needExtendedHoursData: "false",
    });
    const res = await fetch(`${SCHWAB_CHAIN_BASE}/pricehistory?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { candles?: Array<{ close: number }> };
    return (json.candles ?? []).map((c) => ({ close: c.close }));
  } catch {
    return [];
  }
}

async function buildTickerProfile(
  calls: OptionContract[],
  puts: OptionContract[],
  underlyingPrice: number,
  symbol: string,
  accessToken: string,
  logger?: { info: (...args: unknown[]) => void },
): Promise<TickerProfile> {
  let profile = classifyTicker(calls, puts, underlyingPrice);

  const [tickerCandles, spyCandles] = await Promise.all([
    fetchDailyCandles(symbol.toUpperCase().trim(), accessToken),
    fetchDailyCandles("SPY", accessToken),
  ]);

  if (tickerCandles.length >= 6 && spyCandles.length >= 6) {
    const beta = computeBeta(tickerCandles, spyCandles);
    profile = applyBetaToProfile(profile, beta);
  }


  return profile;
}

async function fetchEarningsDaysAway(
  symbol: string,
  _accessToken: string,
): Promise<number | null> {
  // Unified earnings source. Previously this function projected the next
  // earnings date by adding ~91-day quarter offsets to Schwab's
  // `lastEarningsDate`, which produced stale and conflicting values vs the
  // real calendar (e.g. RIVN's actual April 30 print would show as a synthetic
  // ~May 7 estimate). Now we delegate to earningsService — the same Benzinga →
  // Yahoo source of truth used by strategistV2, catalystEvaluator, and the
  // discovery scanner — so every consumer sees the same date.
  try {
    const result = await getNextEarningsDate(symbol);
    return result.daysAway;
  } catch {
    return null;
  }
}

function buildChainAnalytics(
  tickerProfile: TickerProfile,
  earningsDaysAway: number | null,
  strategies: StrategyPayload[],
  vix: number | null,
  pulseComposite: number,
  pulseConfidence: number,
  pulseEdge: string,
  expectedMove: number,
  underlyingPrice: number,
) {
  const preTradeResults: PreTradeResult[] = [];
  for (const strategy of strategies) {
    const input: PreTradeInput = {
      strategy,
      pulseComposite,
      pulseConfidence,
      pulseEdge,
      vix,
      accountSize: 25000,
      ivr: tickerProfile.ivr,
      putSkew: tickerProfile.putSkew,
      earningsDaysAway,
      expectedMove,
      underlyingPrice,
      settings: {
        minRR: 0.25,
        maxPositionPct: 3,
        minDTE: 5,
        blockOnRed: false,
      },
    };
    preTradeResults.push(runPreTradeChecks(input));
  }

  return {
    ivr: tickerProfile.ivr,
    putSkew: tickerProfile.putSkew,
    earningsDaysAway,
    expectedMove,
    preTradeResults,
  };
}

function getVixFromCache(): number | null {
  const snap = getSnapshot().find((q) => q.symbol === "$VIX" || q.symbol === "VIX");
  if (!snap) return null;
  return snap.last ?? null;
}

router.post("/options-strategist", async (req, res) => {
  const { symbol, accessToken: bodyToken, todayEdge } = req.body as {
    symbol?: string;
    accessToken?: string;
    todayEdge?: string;
  };
  const accessToken = bodyToken || getBestAccessToken();

  if (!symbol || !accessToken) {
    return res.json({ strategies: [], narrative: "", error: "Symbol is required and no access token available." });
  }

  const wsResult = readFromWebSocketCache();
  const indicators = extractMarketIndicators(wsResult.dataMap);
  const engineResult = runMarketPulseEngine(indicators, undefined, sessionToEngineType(getMarketSession().session));
  const regime = classifyRegime(engineResult, indicators);

  const userOverride = todayEdge && todayEdge !== "auto" && todayEdge !== engineResult.todayEdge ? todayEdge : null;
  const overrideWarning = userOverride ? checkOverrideConflict(userOverride, engineResult.compositeScore, engineResult.bias) : null;
  const edge = userOverride ?? engineResult.todayEdge;

  const resolvedPulse = {
    composite: engineResult.compositeScore,
    confidence: engineResult.confidenceScore,
    label: engineResult.bias,
    todayEdge: engineResult.todayEdge,
    size: engineResult.sizeRecommendation,
    timestamp: Date.now(),
  };

  req.log.info({ regime: regime.regime, edge, composite: engineResult.compositeScore, userOverride }, "Strategist auto-pulse + regime classified");

  if (regime.regime === "NO_REGIME" && !userOverride) {
    return res.json({
      strategies: [],
      narrative: "No actionable regime detected. The scoring engine shows insufficient conviction to recommend a trade. Sit this one out.",
      edge: edge || "NO_EDGE",
      regime,
      pulse: resolvedPulse,
    });
  }

  try {
    const chainSymbol = symbol.toUpperCase().trim();

    const cachedChain = chainCache.get(chainSymbol);
    const cacheIsFresh = cachedChain && cachedChain.underlyingPrice && (Date.now() - cachedChain.fetchedAt) < CHAIN_CACHE_TTL;

    let calls: OptionContract[];
    let puts: OptionContract[];
    let underlyingPrice: number;

    if (cacheIsFresh) {
      calls = cachedChain.calls as OptionContract[];
      puts = cachedChain.puts as OptionContract[];
      underlyingPrice = cachedChain.underlyingPrice!;
      req.log.info({ symbol, cacheAge: Date.now() - cachedChain.fetchedAt }, "Strategist: using cached chain");
    } else {
      const freshChain = await getOrFetchChain(chainSymbol, accessToken, req.log);
      if (freshChain && freshChain.underlyingPrice) {
        calls = freshChain.calls as OptionContract[];
        puts = freshChain.puts as OptionContract[];
        underlyingPrice = freshChain.underlyingPrice;
      } else {
        const dteForChain = Math.max(regime.dteRange.max, 45);
        const params = new URLSearchParams({
          symbol: chainSymbol,
          contractType: "ALL",
          strikeCount: "30",
          range: "ALL",
          daysToExpiration: String(dteForChain),
        });
        if (chainSymbol.startsWith("/")) params.set("assetClass", "FUTURES");

        const chainRes = await fetch(`${SCHWAB_CHAIN_BASE}/chains?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!chainRes.ok) {
          const errBody = await chainRes.text().catch(() => "");
          req.log.error({ status: chainRes.status, body: errBody }, "Strategist chain fetch failed");
          return res.json({ strategies: [], narrative: "", error: `Chain fetch failed (${chainRes.status})` });
        }

        const chainJson = await chainRes.json() as Record<string, unknown>;
        underlyingPrice = (chainJson["underlyingPrice"] as number) ?? 0;
        const callMap = (chainJson["callExpDateMap"] as Record<string, unknown>) ?? {};
        const putMap = (chainJson["putExpDateMap"] as Record<string, unknown>) ?? {};
        calls = parseChainContracts(callMap);
        puts = parseChainContracts(putMap);
      }
    }

    req.log.info({ symbol, regime: regime.regime, edge, callCount: calls.length, putCount: puts.length, underlyingPrice, dteRange: regime.dteRange }, "Strategist scanning chain with regime params");

    if (calls.length === 0 && puts.length === 0) {
      return res.json({ strategies: [], narrative: "Options chain is empty. Market may be closed or token expired.", error: "empty_chain", regime, pulse: resolvedPulse });
    }

    const [tickerProfile, earningsDaysAway] = await Promise.all([
      buildTickerProfile(calls, puts, underlyingPrice, symbol, accessToken, req.log),
      fetchEarningsDaysAway(symbol, accessToken),
    ]);
    const expectedMove = computeExpectedMove(calls, puts, underlyingPrice);
    req.log.info({ symbol, underlyingPrice, expectedMove, earningsDaysAway }, "Strategist: expectedMove computed");
    const convictionParams: ConvictionParams = {
      earningsDaysAway,
      confidence: resolvedPulse.confidence,
    };
    let strategies = selectStrategiesByRegime(regime, calls, puts, tickerProfile, convictionParams);

    for (const s of strategies) {
      if (s.convictionSizing) {
        req.log.info({ strategy: s.strategy_type, sizing: s.convictionSizing }, "Strategist: conviction sizing");
      }
    }

    const eventCheckResults: EventCheckResult[] = [];
    const blockedIndices = new Set<number>();
    for (let i = 0; i < strategies.length; i++) {
      const s = strategies[i];
      const maxDTE = s.dte ?? regime.dteRange.max;
      const evCheck = checkEventConflicts(symbol, maxDTE, s.strategy_type, earningsDaysAway);
      eventCheckResults.push(evCheck);
      if (evCheck.hardBlocks.length > 0) {
        blockedIndices.add(i);
        req.log.info({ strategy: s.strategy_type, dte: maxDTE, hardBlocks: evCheck.hardBlocks }, "Strategist: strategy blocked by event guard");
      }
    }

    const blockedStrategyNames = strategies.filter((_, i) => blockedIndices.has(i)).map(s => s.strategy_type);
    strategies = strategies.filter((_, i) => !blockedIndices.has(i));

    const eventGuardSummary = {
      blockedStrategies: [...new Set(blockedStrategyNames)],
      eventConflicts: eventCheckResults.flatMap(r => r.eventConflicts).filter((v, i, a) => a.findIndex(e => e.date === v.date && e.eventTitle === v.eventTitle) === i),
      hardBlocks: eventCheckResults.flatMap(r => r.hardBlocks).filter((v, i, a) => a.indexOf(v) === i),
      warnings: eventCheckResults.flatMap(r => r.warnings).filter((v, i, a) => a.indexOf(v) === i),
    };

    if (strategies.length === 0) {
      const blockReason = eventGuardSummary.hardBlocks.length > 0
        ? `All strategies blocked by event guards:\n${eventGuardSummary.hardBlocks.join("\n")}`
        : `No viable setups found for the ${regime.regime} regime in the current chain. The available premium does not support a favorable risk/reward (minimum 0.20:1). Consider: waiting for better conditions, trying a different expiration range, or switching strategy direction.`;
      return res.json({
        strategies: [],
        narrative: blockReason,
        edge,
        regime,
        pulse: resolvedPulse,
        tickerProfile,
        eventGuard: eventGuardSummary,
      });
    }

    const chainAnalytics = buildChainAnalytics(
      tickerProfile, earningsDaysAway, strategies,
      getVixFromCache(), resolvedPulse.composite, resolvedPulse.confidence, edge,
      expectedMove, underlyingPrice,
    );

    const payload = {
      pulse: resolvedPulse,
      regime,
      equity: { symbol, price: underlyingPrice, change: 0, changePct: 0 },
      strategies,
      tickerProfile,
      chainAnalytics,
      eventGuard: eventGuardSummary,
    };

    const eventGuardPromptBlock = eventGuardSummary.warnings.length > 0 || eventGuardSummary.blockedStrategies.length > 0
      ? `\n\nEVENT GUARD SYSTEM:\n${eventGuardSummary.blockedStrategies.length > 0 ? `Blocked strategies (removed): ${eventGuardSummary.blockedStrategies.join(", ")}\n` : ""}${eventGuardSummary.warnings.length > 0 ? `Warnings:\n${eventGuardSummary.warnings.map(w => `- ${w}`).join("\n")}\n` : ""}You MUST mention relevant event risks in your narrative. Explain why blocked strategies were removed if any.`
      : "";

    const econEvents = getCachedEconEvents();
    const now = new Date().toISOString().slice(0, 10);
    const twoWeeksOut = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const upcomingEcon = econEvents.filter(e => e.date >= now && e.date <= twoWeeksOut);
    const econBlock = upcomingEcon.length > 0
      ? `\n\nUPCOMING ECONOMIC CATALYSTS (next 14 days):\n${upcomingEcon.map(e => `- ${e.date} ${e.time || ""} ${e.eventName}${e.consensus ? ` (consensus: ${e.consensus})` : ""}${e.prior ? ` (prior: ${e.prior})` : ""}`).join("\n")}\nYou MUST factor these catalysts into your trade thesis. If CPI, FOMC, or NFP falls within the strategy's expiration window, mention the volatility risk and how it affects the trade. If a major event is tomorrow or today, explicitly warn about holding through it.`
      : "";

    const recentRatings = getCachedRatings().filter(r => r.ticker === symbol).slice(0, 5);
    const ratingsBlock = recentRatings.length > 0
      ? `\n\nRECENT ANALYST ACTIVITY for ${symbol}:\n${recentRatings.map(r => `- ${r.date}: ${r.analyst} ${r.actionCompany} ${r.ratingCurrent}${r.ptCurrent ? ` PT $${parseFloat(r.ptCurrent).toFixed(0)}` : ""}${r.ptPrior ? ` (was $${parseFloat(r.ptPrior).toFixed(0)})` : ""}`).join("\n")}\nMention any relevant analyst sentiment shifts in your narrative.`
      : "";

    const narrativePrompt = `${STRATEGIST_SYSTEM_PROMPT}${eventGuardPromptBlock}${econBlock}${ratingsBlock}\n\nHere is the payload:\n\n${JSON.stringify(payload, null, 2)}`;
    const narrative = await callClaude(narrativePrompt, DEFAULT_MODEL, 0.2);

    res.json({ strategies, narrative, edge, underlyingPrice, regime, pulse: resolvedPulse, overrideWarning, tickerProfile, chainAnalytics, eventGuard: eventGuardSummary });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Options strategist error");
    res.json({ strategies: [], narrative: "", error: msg });
  }
});

router.post("/options-strategist/stream", async (req, res) => {
  const { symbol, accessToken, todayEdge, model, temperature } = req.body as {
    symbol?: string;
    accessToken?: string;
    todayEdge?: string;
    model?: string;
    temperature?: number;
  };

  const resolvedToken = accessToken || getBestAccessToken();
  if (!symbol || !resolvedToken) {
    return res.status(400).json({ error: "Symbol is required and no access token available." });
  }

  const wsResult = readFromWebSocketCache();
  const indicators = extractMarketIndicators(wsResult.dataMap);
  const engineResult = runMarketPulseEngine(indicators, undefined, sessionToEngineType(getMarketSession().session));
  const shockCheck = evaluateRegimeShock(indicators);
  const regime = classifyRegime(engineResult, indicators);

  const isShockActive = shockCheck.shockState === "ACTIVE";
  if (isShockActive) {
    regime.regime = "RISK-OFF" as any;
    regime.direction = "BEARISH" as any;
    regime.dteRange = { min: 7, max: 21 };
    req.log.info({ shockState: shockCheck.shockState, triggers: shockCheck.activeTriggers.map(t => t.trigger) }, "Strategist: shock active — forcing hedging-only mode");
  }

  const userOverride = todayEdge && todayEdge !== "auto" && todayEdge !== engineResult.todayEdge ? todayEdge : null;
  const overrideWarning = userOverride ? checkOverrideConflict(userOverride, engineResult.compositeScore, engineResult.bias) : null;
  const edge = isShockActive ? "BEARISH_EDGE" : (userOverride ?? engineResult.todayEdge);

  const resolvedPulse = {
    composite: engineResult.compositeScore,
    confidence: engineResult.confidenceScore,
    label: engineResult.bias,
    todayEdge: engineResult.todayEdge,
    size: engineResult.sizeRecommendation,
    timestamp: Date.now(),
    shockState: shockCheck.shockState,
    shockActive: shockCheck.shockActive,
  };

  req.log.info({ regime: regime.regime, edge, composite: engineResult.compositeScore, userOverride, shockActive: shockCheck.shockActive }, "Strategist stream: auto-pulse + regime classified");

  if (regime.regime === "NO_REGIME" && !userOverride && !isShockActive) {
    return res.json({
      strategies: [],
      narrative: "No actionable regime detected. The scoring engine shows insufficient conviction to recommend a trade. Sit this one out.",
      edge: edge || "NO_EDGE",
      regime,
      pulse: resolvedPulse,
    });
  }

  try {
    const chainSymbol = symbol.toUpperCase().trim();

    const cachedChain = chainCache.get(chainSymbol);
    const cacheIsFresh = cachedChain && cachedChain.underlyingPrice && (Date.now() - cachedChain.fetchedAt) < CHAIN_CACHE_TTL;

    let calls: OptionContract[];
    let puts: OptionContract[];
    let underlyingPrice: number;

    if (cacheIsFresh) {
      calls = cachedChain.calls as OptionContract[];
      puts = cachedChain.puts as OptionContract[];
      underlyingPrice = cachedChain.underlyingPrice!;
      req.log.info({ symbol, cacheAge: Date.now() - cachedChain.fetchedAt }, "Strategist stream: using cached chain");
    } else {
      const freshChain = await getOrFetchChain(chainSymbol, resolvedToken, req.log);
      if (freshChain && freshChain.underlyingPrice) {
        calls = freshChain.calls as OptionContract[];
        puts = freshChain.puts as OptionContract[];
        underlyingPrice = freshChain.underlyingPrice;
      } else {
        const dteForChain = Math.max(regime.dteRange.max, 45);
        const params = new URLSearchParams({
          symbol: chainSymbol,
          contractType: "ALL",
          strikeCount: "30",
          range: "ALL",
          daysToExpiration: String(dteForChain),
        });
        if (chainSymbol.startsWith("/")) params.set("assetClass", "FUTURES");

        const chainRes = await fetch(`${SCHWAB_CHAIN_BASE}/chains?${params.toString()}`, {
          headers: { Authorization: `Bearer ${resolvedToken}` },
        });

        if (!chainRes.ok) {
          const errBody = await chainRes.text().catch(() => "");
          req.log.error({ status: chainRes.status, body: errBody }, "Strategist chain fetch failed");
          return res.status(502).json({ error: `Chain fetch failed (${chainRes.status})` });
        }

        const chainJson = await chainRes.json() as Record<string, unknown>;
        underlyingPrice = (chainJson["underlyingPrice"] as number) ?? 0;
        const callMap = (chainJson["callExpDateMap"] as Record<string, unknown>) ?? {};
        const putMap = (chainJson["putExpDateMap"] as Record<string, unknown>) ?? {};
        calls = parseChainContracts(callMap);
        puts = parseChainContracts(putMap);
      }
    }

    req.log.info({ symbol, regime: regime.regime, edge, callCount: calls.length, putCount: puts.length, underlyingPrice, dteRange: regime.dteRange }, "Strategist scanning chain with regime params");

    if (calls.length === 0 && puts.length === 0) {
      return res.json({ strategies: [], narrative: "Options chain is empty.", error: "empty_chain", regime, pulse: resolvedPulse });
    }

    const [tickerProfile, earningsDaysAway] = await Promise.all([
      buildTickerProfile(calls, puts, underlyingPrice, symbol, resolvedToken, req.log),
      fetchEarningsDaysAway(symbol, resolvedToken),
    ]);
    const expectedMove = computeExpectedMove(calls, puts, underlyingPrice);
    req.log.info({ symbol, underlyingPrice, expectedMove, earningsDaysAway }, "Strategist stream: expectedMove computed");
    const convictionParams: ConvictionParams = {
      earningsDaysAway,
      confidence: resolvedPulse.confidence,
    };
    let strategies = selectStrategiesByRegime(regime, calls, puts, tickerProfile, convictionParams);

    for (const s of strategies) {
      if (s.convictionSizing) {
        req.log.info({ strategy: s.strategy_type, sizing: s.convictionSizing }, "Strategist stream: conviction sizing");
      }
    }

    const streamCheckResults: EventCheckResult[] = [];
    const streamBlockedIdx = new Set<number>();
    for (let i = 0; i < strategies.length; i++) {
      const s = strategies[i];
      const maxDTE = s.dte ?? regime.dteRange.max;
      const evCheck = checkEventConflicts(symbol, maxDTE, s.strategy_type, earningsDaysAway);
      streamCheckResults.push(evCheck);
      if (evCheck.hardBlocks.length > 0) {
        streamBlockedIdx.add(i);
        req.log.info({ strategy: s.strategy_type, dte: maxDTE, hardBlocks: evCheck.hardBlocks }, "Strategist stream: strategy blocked by event guard");
      }
    }

    const streamBlockedNames = strategies.filter((_, i) => streamBlockedIdx.has(i)).map(s => s.strategy_type);
    strategies = strategies.filter((_, i) => !streamBlockedIdx.has(i));

    const streamEventGuard = {
      blockedStrategies: [...new Set(streamBlockedNames)],
      eventConflicts: streamCheckResults.flatMap(r => r.eventConflicts).filter((v, i, a) => a.findIndex(e => e.date === v.date && e.eventTitle === v.eventTitle) === i),
      hardBlocks: streamCheckResults.flatMap(r => r.hardBlocks).filter((v, i, a) => a.indexOf(v) === i),
      warnings: streamCheckResults.flatMap(r => r.warnings).filter((v, i, a) => a.indexOf(v) === i),
    };

    if (strategies.length === 0) {
      const blockReason = streamEventGuard.hardBlocks.length > 0
        ? `All strategies blocked by event guards:\n${streamEventGuard.hardBlocks.join("\n")}`
        : `No viable setups found for the ${regime.regime} regime in the current chain. The available premium does not support a favorable risk/reward (minimum 0.20:1). Consider: waiting for better conditions, trying a different expiration range, or switching strategy direction.`;
      return res.json({
        strategies: [],
        narrative: blockReason,
        edge,
        regime,
        pulse: resolvedPulse,
        tickerProfile,
        eventGuard: streamEventGuard,
      });
    }

    const chainAnalytics = buildChainAnalytics(
      tickerProfile, earningsDaysAway, strategies,
      getVixFromCache(), resolvedPulse.composite, resolvedPulse.confidence, edge,
      expectedMove, underlyingPrice,
    );

    const strategistPayload = {
      pulse: resolvedPulse,
      regime,
      equity: { symbol, price: underlyingPrice, change: 0, changePct: 0 },
      strategies,
      tickerProfile,
      chainAnalytics,
      eventGuard: streamEventGuard,
    };

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

    res.write(`data: ${JSON.stringify({ strategies, edge, underlyingPrice, regime, pulse: resolvedPulse, overrideWarning, tickerProfile, chainAnalytics, eventGuard: streamEventGuard })}\n\n`);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 5000);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const streamEventGuardPrompt = streamEventGuard.warnings.length > 0 || streamEventGuard.blockedStrategies.length > 0
      ? `\n\nEVENT GUARD SYSTEM:\n${streamEventGuard.blockedStrategies.length > 0 ? `Blocked strategies (removed): ${streamEventGuard.blockedStrategies.join(", ")}\n` : ""}${streamEventGuard.warnings.length > 0 ? `Warnings:\n${streamEventGuard.warnings.map(w => `- ${w}`).join("\n")}\n` : ""}You MUST mention relevant event risks in your narrative. Explain why blocked strategies were removed if any.`
      : "";

    const streamEconEvents = getCachedEconEvents();
    const streamNow = new Date().toISOString().slice(0, 10);
    const streamTwoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const streamUpcomingEcon = streamEconEvents.filter(e => e.date >= streamNow && e.date <= streamTwoWeeks);
    const streamEconBlock = streamUpcomingEcon.length > 0
      ? `\n\nUPCOMING ECONOMIC CATALYSTS (next 14 days):\n${streamUpcomingEcon.map(e => `- ${e.date} ${e.time || ""} ${e.eventName}${e.consensus ? ` (consensus: ${e.consensus})` : ""}${e.prior ? ` (prior: ${e.prior})` : ""}`).join("\n")}\nYou MUST factor these catalysts into your trade thesis. If CPI, FOMC, or NFP falls within the strategy's expiration window, mention the volatility risk and how it affects the trade.`
      : "";

    const streamSymbol = (symbol || "").toUpperCase().trim();
    const streamRecentRatings = getCachedRatings().filter(r => r.ticker === streamSymbol).slice(0, 5);
    const streamRatingsBlock = streamRecentRatings.length > 0
      ? `\n\nRECENT ANALYST ACTIVITY for ${streamSymbol}:\n${streamRecentRatings.map(r => `- ${r.date}: ${r.analyst} ${r.actionCompany} ${r.ratingCurrent}${r.ptCurrent ? ` PT $${parseFloat(r.ptCurrent).toFixed(0)}` : ""}${r.ptPrior ? ` (was $${parseFloat(r.ptPrior).toFixed(0)})` : ""}`).join("\n")}\nMention any relevant analyst sentiment shifts.`
      : "";

    try {
      const narrativePrompt = `${STRATEGIST_SYSTEM_PROMPT}${streamEventGuardPrompt}${streamEconBlock}${streamRatingsBlock}\n\nHere is the payload:\n\n${JSON.stringify(strategistPayload, null, 2)}`;

      await nativeStream({
        prompt: narrativePrompt,
        modelName: model ?? DEFAULT_MODEL,
        temperature: temperature ?? 0.2,
        thinkingBudget: 2048,
        onThinking: (text) => {
          res.write(`data: ${JSON.stringify({ reasoning: text })}\n\n`);
          if (typeof (res as any).flush === "function") (res as any).flush();
        },
        onText: (text) => {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
          if (typeof (res as any).flush === "function") (res as any).flush();
        },
      });
    } catch (aiErr: unknown) {
      const msg = aiErr instanceof Error ? aiErr.message : String(aiErr);
      req.log.error({ err: aiErr }, "Strategist narrative stream error");
      const cleanMsg = msg.includes("overloaded") ? "AI model temporarily overloaded. Try again in a moment."
        : msg.includes("rate_limit") ? "AI rate limit reached. Try again in a moment."
        : "AI analysis temporarily unavailable. Tap to retry.";
      res.write(`data: ${JSON.stringify({ error: cleanMsg })}\n\n`);
    }

    clearInterval(heartbeat);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Options strategist stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    } else {
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  }
});

router.post("/chat", async (req, res) => {
  try {
    const { messages, marketContext, model: reqModel } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      marketContext?: string;
      model?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required." });
    }

    const chosenModel = reqModel ?? DEFAULT_MODEL;

    const systemPrompt = `You are Alpha Terminal, a world-class AI assistant powered by advanced AI. Your primary UI is the Alpha Financial Terminal.
- Today is ${new Date().toDateString()}. Current time: ${new Date().toLocaleString()}.
- If the user asks a general question (like how to make a pizza), answer it directly and concisely.
- If the user asks about specific stock data and Schwab context is provided below, use that live data.
- Keep answers concise. Use bullet points or short lines when listing data.
- Never start sentences with "As an AI..." or "I am a financial terminal and cannot..." or any variant. Just answer the question.
- No greetings, no sign-offs, no "sure" or "great question."
- Do not refuse to answer non-financial questions.

STRICT DATA GROUNDING RULE FOR MARKET/TRADING QUESTIONS:
- When answering questions about specific stock prices, trends, technical levels, or trading strategies, you must ONLY use the Context Data provided below.
- You are FORBIDDEN from using your internal training knowledge to state current prices, recent price movements, support/resistance levels, or directional predictions for any specific security.
- If no Schwab context data is provided and the user asks about a specific stock's current state, tell them to connect Schwab for live data.
- For general financial education (e.g. "what is a put option"), internal knowledge is fine.

${marketContext ? `═══ LIVE SCHWAB CONTEXT DATA ═══\n${marketContext}\n═══ END CONTEXT DATA ═══` : "No live Schwab data connected."}`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Connection", "keep-alive");

    let firstChunkSent = false;
    const heartbeat = setInterval(() => {
      if (!firstChunkSent && !res.writableEnded) {
        res.write("\n");
      }
    }, 5000);

    if (isGeminiModel(chosenModel)) {
      const gemBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
      const gemApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
      if (!gemBaseUrl || !gemApiKey) {
        clearInterval(heartbeat);
        return res.status(500).json({ error: "Gemini AI integration not configured." });
      }

      const ai = new GoogleGenAI({ apiKey: gemApiKey, httpOptions: { apiVersion: "", baseUrl: gemBaseUrl } });

      const lastUserMsg = messages[messages.length - 1]?.content ?? "";
      const conversationHistory = messages.slice(0, -1).map(m =>
        `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
      ).join("\n\n");

      const fullPrompt = conversationHistory
        ? `${systemPrompt}\n\nConversation so far:\n${conversationHistory}\n\nUser: ${lastUserMsg}`
        : `${systemPrompt}\n\nUser: ${lastUserMsg}`;

      try {
        const stream = await ai.models.generateContentStream({
          model: chosenModel,
          contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
          config: { maxOutputTokens: 8192, temperature: 0.1 },
        });

        for await (const chunk of stream) {
          const text = chunk.text ?? "";
          if (text) {
            if (!firstChunkSent) { firstChunkSent = true; clearInterval(heartbeat); }
            res.write(text);
          }
        }
      } finally {
        clearInterval(heartbeat);
      }
      res.end();
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        clearInterval(heartbeat);
        return res.status(500).json({ error: "Claude API key not configured." });
      }

      const anthropic = createAnthropic({ apiKey });
      const result = streamText({
        model: anthropic(chosenModel),
        system: systemPrompt,
        temperature: 0.1,
        messages: messages.map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      });

      try {
        for await (const chunk of result.textStream) {
          if (!firstChunkSent) { firstChunkSent = true; clearInterval(heartbeat); }
          res.write(chunk);
        }
      } finally {
        clearInterval(heartbeat);
      }
      res.end();
    }
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

interface ScannerOptionsAnalytics {
  ivr: number | null;
  pcRatio: number | null;
  expectedMove: number | null;
}

async function fetchScannerOptionsAnalytics(symbol: string, accessToken: string, log: any): Promise<ScannerOptionsAnalytics> {
  const result: ScannerOptionsAnalytics = { ivr: null, pcRatio: null, expectedMove: null };
  try {
    const apiSymbol = symbolToSchwabApi(symbol);
    const params = new URLSearchParams({
      symbol: apiSymbol,
      contractType: "ALL",
      strikeCount: "20",
      includeUnderlyingQuote: "true",
    });
    const chainRes = await fetch(`${SCHWAB_API_BASE_AI}/chains?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!chainRes.ok) return result;
    const chainJson = await chainRes.json() as Record<string, unknown>;
    const underlyingPrice = (chainJson["underlyingPrice"] as number) ?? 0;
    if (underlyingPrice <= 0) return result;

    const parseMap = (map: unknown): OptionContract[] => {
      const contracts: OptionContract[] = [];
      if (!map || typeof map !== "object") return contracts;
      for (const expDate of Object.values(map as Record<string, unknown>)) {
        for (const opts of Object.values(expDate as Record<string, unknown>)) {
          for (const o of (opts as Array<Record<string, unknown>>)) {
            contracts.push({
              strike: (o["strikePrice"] as number) ?? 0,
              expiration: (o["expirationDate"] as string)?.split("T")[0] ?? "",
              schwabSymbol: (o["symbol"] as string) ?? "",
              bid: (o["bid"] as number) ?? 0,
              ask: (o["ask"] as number) ?? 0,
              volume: (o["totalVolume"] as number) ?? 0,
              openInterest: (o["openInterest"] as number) ?? 0,
              iv: (o["volatility"] as number) ?? 0,
              delta: (o["delta"] as number) ?? 0,
              dte: (o["daysToExpiration"] as number) ?? undefined,
            });
          }
        }
      }
      return contracts;
    };

    const calls = parseMap(chainJson["callExpDateMap"]);
    const puts = parseMap(chainJson["putExpDateMap"]);
    const allContracts = [...calls, ...puts];

    if (allContracts.length > 0) {
      const exps = [...new Set(allContracts.map(c => c.expiration))].sort();
      result.ivr = computeIVR(allContracts, underlyingPrice, exps);
      result.expectedMove = computeExpectedMove(calls, puts, underlyingPrice);

      let callVol = 0, putVol = 0;
      for (const c of calls) callVol += c.volume || 0;
      for (const p of puts) putVol += p.volume || 0;
      result.pcRatio = callVol > 0 ? Math.round((putVol / callVol) * 100) / 100 : null;
    }
  } catch (err) {
    log.warn({ symbol, err }, "Scanner options analytics fetch failed");
  }
  return result;
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
  ivr?: number | null;
  pcRatio?: number | null;
  expectedMove?: number | null;
}

interface ScannerAiResult {
  setups: ScannerSetup[];
  marketSummary: string;
}

// ── Unusual Options Activity scanner ─────────────────────────────────
// Pure flow-based scan: queries Polygon per-strike data already in our
// DB, applies user-tunable thresholds (minStrikes, minVoiRatio,
// minVolume, skewFilter), and returns ranked candidates with scorecard
// data. No price/momentum/IVR signal — strictly options activity.
router.post("/unusual-flow-scan", async (req, res) => {
  try {
    const { scanUnusualFlow } = await import("../lib/unusualFlowScanner.js");
    const { symbols, filters } = req.body as {
      symbols?: string[];
      filters?: {
        minStrikes?: number;
        minVoiRatio?: number;
        minVolume?: number;
        skew?: "any" | "bullish" | "bearish" | "non_balanced";
      };
    };
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: "symbols required" });
    }
    if (symbols.length > 500) {
      return res.status(400).json({ error: "too many symbols (max 500)" });
    }
    const result = await scanUnusualFlow(symbols, filters ?? {});
    return res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "unusual-flow-scan failed");
    return res.status(500).json({ error: err?.message ?? "scan failed" });
  }
});

router.post("/deterministic-scan", async (req, res) => {
  const { symbols, accessToken: bodyToken3, scanMode: reqScanMode, returnAll } = req.body as {
    symbols: string[];
    accessToken: string;
    scanMode?: "DISCOVERY" | "MOMENTUM";
    returnAll?: boolean;
  };
  const accessToken = bodyToken3 || getBestAccessToken();
  const scanMode: "DISCOVERY" | "MOMENTUM" = reqScanMode === "MOMENTUM" ? "MOMENTUM" : "DISCOVERY";

  if (!symbols?.length || !accessToken) {
    return res.status(400).json({ error: "symbols are required and no access token available" });
  }

  const { dataMap } = readFromWebSocketCache();
  const shockResult = evaluateRegimeShock(extractMarketIndicators(dataMap));
  if (shockResult.shockActive) {
    return res.json({
      error: "shock_active",
      message: "Scanning paused — regime shock active",
      shockState: shockResult.shockState,
    });
  }

  let pulseComposite = 0;
  let pulseConfidence = 0;
  let pulseBias = "NO_EDGE";

  if (lastPulseResult) {
    const p = lastPulseResult.pulse as Record<string, unknown>;
    pulseComposite = (p["compositeScore"] as number) ?? 0;
    pulseConfidence = (p["confidenceScore"] as number) ?? 0;
    pulseBias = (p["bias"] as string) ?? "NO_EDGE";
  }

  const traderTokenSet = getTokens("trader");
  const traderToken = traderTokenSet?.accessToken ?? null;
  if (!traderToken) {
    req.log.warn("Deterministic scan: no trader token — portfolio position filter will be skipped");
  }

  try {
    const pulseCtx = { composite: pulseComposite, confidence: pulseConfidence, bias: pulseBias };
    const result = scanMode === "DISCOVERY"
      ? await runDiscoveryScan(symbols, accessToken, traderToken, pulseCtx, req.log, { returnAll: !!returnAll })
      : await runDeterministicScan(symbols, accessToken, traderToken, pulseCtx, req.log);
    res.json({ ...result, scanMode });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Deterministic scan error");
    res.status(500).json({ error: msg });
  }
});

function buildResolvedNarrativePrompt(
  criteria: import("../lib/deterministicStrategist.js").StrategyCriteria,
  trade: ResolvedTrade,
  pulseSummary: string,
  scannerBreakdown: string | null,
): string {
  const lines: string[] = [];
  lines.push("You are a senior options strategist. The system has selected and fully resolved a vertical spread trade with specific strikes, prices, and sizing. Your job is to write 2-3 paragraphs presenting this trade recommendation clearly.");
  lines.push("");
  lines.push("RULES:");
  lines.push("- Do NOT modify any numbers from the resolved trade. Present them exactly as given.");
  lines.push("- Do NOT suggest alternatives or override the trade selection.");
  lines.push("- Do NOT use em dashes.");
  lines.push("- Mention any warnings from the resolution process.");
  lines.push("- Be specific about the dollar amounts, risk, and profit targets.");
  lines.push("- If chain_source is 'previous_close', emphasize that prices are from the last session.");
  lines.push("");
  lines.push("RESOLVED TRADE:");
  lines.push(`Strategy: ${trade.strategy} (${trade.direction})`);
  lines.push(`Ticker: ${trade.ticker}`);
  lines.push(`Expiration: ${trade.expiration} (${trade.dte} DTE)`);
  lines.push(`Long Leg: ${trade.legs[0].action.toUpperCase()} ${trade.legs[0].strike} ${trade.legs[0].type} at $${trade.legs[0].executable_price.toFixed(2)} (delta ${trade.legs[0].delta.toFixed(2)})`);
  lines.push(`Short Leg: ${trade.legs[1].action.toUpperCase()} ${trade.legs[1].strike} ${trade.legs[1].type} at $${trade.legs[1].executable_price.toFixed(2)} (delta ${trade.legs[1].delta.toFixed(2)})`);
  lines.push(`${trade.pricing.display}`);
  lines.push(`Max Risk: $${trade.risk.max_loss_per_contract} per contract ($${trade.sizing.total_risk} total)`);
  lines.push(`Max Gain: $${trade.risk.max_gain_per_contract} per contract ($${trade.sizing.total_max_gain} total)`);
  lines.push(`Breakeven: $${trade.risk.breakeven}`);
  lines.push(`${trade.risk.profit_target_display}`);
  lines.push(`${trade.risk.stop_loss_display}`);
  lines.push(`Recommended: ${trade.sizing.recommended_contracts} contract(s) (${trade.sizing.size_modifier} size)`);
  lines.push(`Chain Source: ${trade.chain_source}`);
  if (trade.scanner_score != null) lines.push(`Scanner Score: ${trade.scanner_score}`);
  lines.push("");
  if (trade.warnings.length > 0) {
    lines.push("WARNINGS:");
    for (const w of trade.warnings) lines.push(`  - ${w}`);
    lines.push("");
  }
  lines.push("STRATEGY CRITERIA (for context):");
  lines.push(`Mode: ${criteria.mode} - ${criteria.modeReason}`);
  lines.push(`Premium Selling: ${criteria.premiumSellingApproved ? "APPROVED" : "DENIED"}`);
  lines.push("");
  lines.push("MARKET PULSE SUMMARY:");
  lines.push(pulseSummary);
  if (scannerBreakdown) {
    lines.push("");
    lines.push("SCANNER BREAKDOWN:");
    lines.push(scannerBreakdown);
  }
  return lines.join("\n");
}

router.post("/deterministic-strategist", async (req, res) => {
  const { symbol, accessToken: bodyToken2, scannerData, model, temperature } = req.body as {
    symbol?: string;
    accessToken?: string;
    scannerData?: ScannerInput;
    model?: string;
    temperature?: number;
  };
  const accessToken = bodyToken2 || getBestAccessToken();

  if (!symbol || !accessToken) {
    return res.status(400).json({ error: "symbol is required and no access token available" });
  }

  const { dataMap } = readFromWebSocketCache();
  const indicators = extractMarketIndicators(dataMap);
  const engineResult = runMarketPulseEngine(indicators, undefined, sessionToEngineType(getMarketSession().session));
  const shockResult = evaluateRegimeShock(indicators);
  const vix = getVixFromCache();

  const pulse: PulseInput = {
    composite: engineResult.compositeScore,
    confidence: engineResult.confidenceScore,
    bias: engineResult.bias,
    avoidShortPremium: engineResult.avoidShortPremium,
    vix,
  };

  req.log.info({
    symbol,
    composite: pulse.composite,
    confidence: pulse.confidence,
    bias: pulse.bias,
    shockActive: shockResult.shockActive,
    avoidShortPremium: pulse.avoidShortPremium,
    vix,
  }, "Deterministic strategist: starting");

  const traderTokenSet = getTokens("trader");
  const traderToken = traderTokenSet?.accessToken ?? null;

  const [portfolio, tickerData, eventCheck] = await Promise.all([
    fetchPortfolioContext(traderToken),
    fetchTickerMarketData(
      symbol,
      accessToken,
      scannerData?.ivr,
      scannerData ? (scannerData.atmSpreadPct <= 1.5 ? "ADEQUATE" : "THIN") : undefined,
    ),
    Promise.resolve(checkEventConflicts(
      symbol,
      scannerData ? 45 : 30,
      "SPREAD",
      null,
    )),
  ]);

  const strategistInput: StrategistInput = {
    symbol: symbol.toUpperCase(),
    pulse,
    scannerData: scannerData ?? null,
    tickerData,
    portfolio,
    shockActive: shockResult.shockActive,
    eventCheck,
  };

  const strategistBatch = createTelemetryBatch("STRATEGIST");
  emitTelemetry("STRATEGIST", "INFO", `Analysis initiated for ${symbol} (source: ${scannerData ? "scanner" : "manual"})`, {
    ticker: symbol,
    source: scannerData ? "scanner" : "manual",
    pulseComposite: pulse.composite,
    pulseConfidence: pulse.confidence,
    pulseBias: pulse.bias,
    shockActive: shockResult.shockActive,
  }, "STRATEGIST", strategistBatch);

  const result: StrategistOutput = runDeterministicStrategist(strategistInput);

  emitTelemetry("STRATEGIST", result.criteria ? "INFO" : "WARN",
    result.criteria
      ? `${symbol}: ${result.mode} → ${result.criteria.strategyType} (delta ${result.criteria.idealDelta}, DTE ${result.criteria.idealDTE})`
      : `${symbol}: rejected — ${result.rejection ?? "no qualifying mode"}`,
    {
      ticker: symbol,
      mode: result.mode,
      rejection: result.rejection,
      strategyType: result.criteria?.strategyType,
      idealDelta: result.criteria?.idealDelta,
      idealDTE: result.criteria?.idealDTE,
    },
    "STRATEGIST", strategistBatch,
  );

  req.log.info({
    symbol,
    mode: result.mode,
    rejection: result.rejection,
    strategyType: result.criteria?.strategyType,
    premiumApproved: result.criteria?.premiumSellingApproved,
  }, "Deterministic strategist: result");

  if (!result.criteria) {
    return res.json({
      criteria: null,
      rejection: result.rejection,
      mode: result.mode,
      modeReason: result.modeReason,
      pulse: {
        composite: pulse.composite,
        confidence: pulse.confidence,
        bias: pulse.bias,
      },
      shockActive: shockResult.shockActive,
      portfolio: { microOverrideCount: portfolio.microOverrideCount },
    });
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

  res.write(`data: ${JSON.stringify({
    criteria: result.criteria,
    mode: result.mode,
    modeReason: result.modeReason,
    pulse: { composite: pulse.composite, confidence: pulse.confidence, bias: pulse.bias },
    shockActive: shockResult.shockActive,
    portfolio: { microOverrideCount: portfolio.microOverrideCount },
    tickerData,
  })}\n\n`);

  let resolvedTrade: ResolvedTrade | null = null;
  let resolutionError: StrikeResolutionError | null = null;

  try {
    const chainSymbol = symbol.toUpperCase();
    const chainData = await getOrFetchChain(chainSymbol, accessToken, req.log);

    if (chainData) {
      let accountNetLiq = portfolio.totalEquity;
      let accountBP = portfolio.totalEquity * 0.5;

      if (traderToken) {
        try {
          const acctRes = await fetch("https://api.schwabapi.com/trader/v1/accounts?fields=positions", {
            headers: { Authorization: `Bearer ${traderToken}` },
          });
          if (acctRes.ok) {
            const accts = await acctRes.json() as Array<Record<string, unknown>>;
            for (const acct of accts) {
              const sa = acct["securitiesAccount"] as Record<string, unknown> | undefined;
              if (!sa) continue;
              const balances = (sa["currentBalances"] ?? sa["projectedBalances"]) as Record<string, unknown> | undefined;
              if (balances) {
                accountNetLiq = (balances["liquidationValue"] as number) ?? (balances["equity"] as number) ?? accountNetLiq;
                accountBP = (balances["buyingPower"] as number) ?? (balances["availableFunds"] as number) ?? accountBP;
                break;
              }
            }
          }
        } catch { /* use portfolio defaults */ }
      }

      const accountSnapshot: AccountSnapshot = {
        netLiquidatingValue: accountNetLiq,
        availableBuyingPower: accountBP,
      };

      const chainForResolver: ChainData = {
        symbol: chainData.symbol,
        underlyingPrice: chainData.underlyingPrice,
        calls: chainData.calls,
        puts: chainData.puts,
        fetchedAt: chainData.fetchedAt,
      };

      const resolution = resolveStrikes(result.criteria, chainForResolver, accountSnapshot, scannerData ?? null);

      if (resolution.resolved) {
        resolvedTrade = resolution.trade;
        req.log.info({
          symbol,
          strategy: resolvedTrade.strategy,
          expiration: resolvedTrade.expiration,
          longStrike: resolvedTrade.legs[0].strike,
          shortStrike: resolvedTrade.legs[1].strike,
          contracts: resolvedTrade.sizing.recommended_contracts,
          chainSource: resolvedTrade.chain_source,
        }, "Strike resolution: success");

        res.write(`data: ${JSON.stringify({ resolvedTrade })}\n\n`);
      } else {
        resolutionError = resolution.error;
        req.log.warn({
          symbol,
          errorCode: resolutionError.error_code,
          message: resolutionError.user_message,
        }, "Strike resolution: failed");

        res.write(`data: ${JSON.stringify({ resolutionError })}\n\n`);
      }
    } else {
      req.log.warn({ symbol }, "Strike resolution: no chain data available");
      resolutionError = {
        error: true,
        error_code: "NO_VALID_STRIKES",
        user_message: `Options chain data unavailable for ${symbol}. Cannot resolve strikes.`,
        fallback_params: result.criteria,
      };
      res.write(`data: ${JSON.stringify({ resolutionError })}\n\n`);
    }
  } catch (srErr: unknown) {
    const msg = srErr instanceof Error ? srErr.message : String(srErr);
    req.log.error({ err: srErr }, "Strike resolution: unexpected error");
    resolutionError = {
      error: true,
      error_code: "NO_VALID_STRIKES",
      user_message: `Strike resolution failed: ${msg}`,
      fallback_params: result.criteria,
    };
    res.write(`data: ${JSON.stringify({ resolutionError })}\n\n`);
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 5000);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const pulseSummary = `Composite: ${pulse.composite.toFixed(2)}, Confidence: ${pulse.confidence}, Bias: ${pulse.bias}, VIX: ${vix?.toFixed(2) ?? "N/A"}, Avoid Short Premium: ${pulse.avoidShortPremium}`;

  let scannerBreakdown: string | null = null;
  if (scannerData) {
    scannerBreakdown = `Total Score: ${scannerData.totalScore}/100, Trend: ${scannerData.components.trendAlignment}, RS: ${scannerData.components.relativeStrength}, Volume: ${scannerData.components.volumeConfirmation}, IVR: ${scannerData.components.ivrScore}, Liquidity: ${scannerData.components.optionsLiquidity}, Micro-Override: ${scannerData.microOverrideEligible}`;
  }

  let narrativePrompt: string;
  if (resolvedTrade) {
    narrativePrompt = buildResolvedNarrativePrompt(result.criteria, resolvedTrade, pulseSummary, scannerBreakdown);
  } else {
    narrativePrompt = buildNarrativePrompt(result.criteria, pulseSummary, scannerBreakdown);
  }

  try {
    await nativeStream({
      prompt: narrativePrompt,
      modelName: model ?? DEFAULT_MODEL,
      temperature: temperature ?? 0.2,
      thinkingBudget: 2048,
      onThinking: (text) => {
        res.write(`data: ${JSON.stringify({ reasoning: text })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      },
      onText: (text) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
      },
    });
  } catch (aiErr: unknown) {
    const msg = aiErr instanceof Error ? aiErr.message : String(aiErr);
    req.log.error({ err: aiErr }, "Deterministic strategist narrative error");
    const cleanMsg = msg.includes("overloaded") ? "AI model temporarily overloaded. Trade details above are still valid."
      : msg.includes("rate_limit") ? "AI rate limit reached. Trade details above are still valid."
      : "AI analysis temporarily unavailable. Trade details above are still valid.";
    res.write(`data: ${JSON.stringify({ error: cleanMsg })}\n\n`);
  }

  clearInterval(heartbeat);
  res.write("data: [DONE]\n\n");
  res.end();
});

router.post("/market-scanner", async (req, res) => {
  const { symbols, accessToken: bodyToken4, mode, filters, model, temperature, maxResults } = req.body as {
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
  const accessToken = bodyToken4 || getBestAccessToken();

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

  const sortedQuotes = [...quotes].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 30);

  const enrichCount = Math.min(sortedQuotes.length, 15);
  const topMovers = sortedQuotes.slice(0, enrichCount);
  const analyticsMap = new Map<string, ScannerOptionsAnalytics>();
  let vixLevel: number | null = null;

  try {
    const snap = getSnapshot();
    const vixQuote = snap.find(q => q.symbol === "$VIX" || q.symbol === "VIX");
    if (vixQuote) vixLevel = vixQuote.last ?? null;
  } catch { /* ignore */ }

  try {
    const analyticsResults = await Promise.allSettled(
      topMovers.map(q => fetchScannerOptionsAnalytics(q.symbol, accessToken, req.log))
    );
    topMovers.forEach((q, i) => {
      const r = analyticsResults[i];
      if (r.status === "fulfilled") analyticsMap.set(q.symbol, r.value);
    });
    req.log.info({ enriched: analyticsMap.size, total: sortedQuotes.length }, "Scanner options enrichment complete");
  } catch (err) {
    req.log.warn({ err }, "Scanner options enrichment failed, proceeding with price-only data");
  }

  const tableRows = sortedQuotes.map(q => {
    const a = analyticsMap.get(q.symbol);
    const ivrStr = a?.ivr != null ? `IVR:${a.ivr}%` : "";
    const pcStr = a?.pcRatio != null ? `P/C:${a.pcRatio.toFixed(2)}` : "";
    const emStr = a?.expectedMove != null ? `EM:±$${a.expectedMove.toFixed(2)}` : "";
    const optsSuffix = [ivrStr, pcStr, emStr].filter(Boolean).join(" | ");
    return `${q.symbol.padEnd(6)} | $${q.last.toFixed(2).padStart(9)} | ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}% | Vol: ${(q.volume / 1e6).toFixed(1)}M | Range: ${q.low.toFixed(2)}-${q.high.toFixed(2)}${optsSuffix ? ` | ${optsSuffix}` : ""}`;
  }).join("\n");

  const vixContext = vixLevel != null ? `\nVIX Level: ${vixLevel.toFixed(2)} (${vixLevel > 25 ? "ELEVATED — favor credit/premium-selling strategies" : vixLevel < 15 ? "LOW — favor debit/directional strategies" : "MODERATE — both credit and debit viable"})` : "";

  const prompt = `You are an elite quantitative options trader with 20+ years of systematic trading experience. You specialize in options strategies informed by implied volatility analytics.

STRICT GROUNDING RULE: You must ONLY use the Context Data provided below. Every price, volume, IVR, P/C ratio, expected move, and change value you cite MUST come from this data. You are FORBIDDEN from using internal training knowledge for market trends, price targets, or directional predictions. If data is insufficient, say so — do NOT fabricate.

═══ CONTEXT DATA ═══
REAL-TIME MARKET DATA (sorted by momentum) — ${sortedQuotes.length} instruments:
Symbol | Last Price | Day Change | Volume  | Day Range | Options Analytics
${tableRows}
${vixContext}

OPTIONS ANALYTICS KEY:
- IVR = IV Rank (0-100): >50 = elevated IV, favor credit/premium-selling strategies; <30 = low IV, favor debit/directional strategies
- P/C = Put/Call volume ratio: >1.0 = bearish flow, <0.7 = bullish flow
- EM = Expected Move (ATM straddle): the options market's implied move for nearest expiration
═══ END CONTEXT DATA ═══

YOUR TASK: Analyze ONLY the above data and identify the TOP ${resultCount} highest-probability OPTIONS trading setups right now.

STRATEGY SELECTION RULES (consistent with institutional options strategy framework):
1. When IVR > 50: Favor CREDIT strategies (Iron Condor, Credit Spread, Short Strangle, Cash-Secured Put)
2. When IVR < 30: Favor DEBIT strategies (Long Calls/Puts, Debit Spread, Calendar Spread)
3. When IVR 30-50: Either credit or debit viable — use directional signals to decide
4. NEUTRAL direction with high IVR = Iron Condor or Iron Butterfly
5. Strategy breakevens should ideally fall outside the Expected Move range for credit strategies
6. P/C ratio > 1.2 with bearish momentum = bearish bias; P/C < 0.7 with bullish momentum = bullish bias

STRICT RULES:
1. Return EXACTLY ${resultCount} setups — no more, no less
2. Each setup must have a clear DIRECTION: BULLISH, BEARISH, or NEUTRAL
3. NEUTRAL = low volatility, range-bound, ideal for Iron Condor/Butterfly/Strangle
4. Confidence must be: HIGH (strong multi-factor confluence including IVR alignment), MILD (moderate signals), or LOW (speculative)
5. Only choose HIGH confidence when price momentum, volume, AND options analytics (IVR/P/C) all align
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
      "rationale": "One precise sentence: specific reason this setup has edge — reference IVR, P/C ratio, expected move, and/or momentum data.",
      "riskNote": "One brief risk: what could invalidate this setup."
    }
  ],
  "marketSummary": "One sentence: overall market regime (risk-on/risk-off, trending/ranging, VIX environment)."
}`;

  try {
    const raw = await callModel(prompt, model ?? DEFAULT_MODEL, temperature ?? 0.1);

    // Try to parse JSON — strip any markdown fences Claude may wrap around it
    const cleaned = raw.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/im, "").trim();
    let parsed: ScannerAiResult | null = null;
    try {
      parsed = JSON.parse(cleaned) as ScannerAiResult;
    } catch {
      // If JSON parsing fails, return raw response
      return res.json({ mode: "ai", rawResponse: raw, setups: [], quotes });
    }

    const enrichedSetups = (parsed.setups ?? []).map(s => {
      const a = analyticsMap.get(s.symbol);
      return { ...s, ivr: a?.ivr ?? null, pcRatio: a?.pcRatio ?? null, expectedMove: a?.expectedMove ?? null };
    });
    return res.json({ mode: "ai", setups: enrichedSetups, marketSummary: parsed.marketSummary ?? "", quotes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Market scanner AI error");
    return res.json({ mode: "ai", error: msg, setups: [], quotes });
  }
});

// ── GROUNDED STRATEGY ENDPOINT ────────────────────────────────────────────────
// Fetches 30-day 1-minute candles from Schwab, runs RSI(14)/EMA(50)/EMA(200),
// builds a strict context block, and sends to Claude with data-grounding enforced.

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

  // Step 4: Send to Claude with strict grounding
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
    const response = await callModel(prompt, model ?? DEFAULT_MODEL, temperature ?? 0.1);
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
  const { symbol, model = DEFAULT_MODEL, temperature = 0.3 } = req.body as {
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
    const response = await callModel(prompt, model, temperature);
    res.json({ response });
  } catch (err) {
    req.log.error({ err }, "Sympathy plays AI error");
    res.json({ response: "Unable to generate sympathy plays at this time." });
  }
});

router.post("/pre-trade-check", async (req, res) => {
  try {
  const { strategy, pulseComposite, pulseConfidence, pulseEdge, vix, accountSize, settings, ivr, putSkew, earningsDaysAway } = req.body as PreTradeInput;

  if (!strategy || !strategy.strategy_type || strategy.max_loss === undefined) {
    return res.status(400).json({ error: "Valid strategy payload is required" });
  }

  const input: PreTradeInput = {
    strategy,
    pulseComposite: pulseComposite ?? 0,
    pulseConfidence: pulseConfidence ?? 0,
    pulseEdge: pulseEdge ?? "NO_EDGE",
    vix: vix ?? null,
    accountSize: accountSize ?? 25000,
    ivr: ivr ?? undefined,
    putSkew: putSkew ?? undefined,
    earningsDaysAway: earningsDaysAway ?? null,
    settings: {
      minRR: settings?.minRR ?? 0.25,
      maxPositionPct: settings?.maxPositionPct ?? 3,
      minDTE: settings?.minDTE ?? 5,
      blockOnRed: settings?.blockOnRed ?? false,
    },
  };

  const result = runPreTradeChecks(input);

  let aiOneLiner = "";
  try {
    const summary = result.checks.map(c => `${c.label}: ${c.status} (${c.value})`).join("; ");
    const prompt = `You are a risk manager giving a one-sentence summary of a pre-trade risk check. Be direct and concise. The overall result is ${result.overall} with ${result.passCount} passes, ${result.warnCount} warnings, ${result.failCount} fails. Details: ${summary}. Strategy: ${strategy.strategy_type}. Give exactly one short sentence (max 20 words) that a trader would find useful.`;
    aiOneLiner = await callClaude(prompt, DEFAULT_MODEL, 0.3);
  } catch {
    aiOneLiner = result.overall === "PASS" ? "All checks passed. Clear to trade."
      : result.overall === "WARN" ? "Caution: some checks flagged. Review before entry."
      : "Multiple risk flags. Consider passing on this setup.";
  }

  res.json({ ...result, aiOneLiner });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Pre-trade check error");
    res.status(500).json({ error: msg });
  }
});

router.get("/market-pulse/verify", (_req, res) => {
  const { passed, output } = verifyEngineScoring();
  res.json({ passed, output });
});

router.get("/market-pulse/raw-debug", (_req, res) => {
  const { dataMap, hitCount } = readFromWebSocketCache();
  const indicators = extractMarketIndicators(dataMap);
  const nullFields: string[] = [];
  const presentFields: Record<string, number> = {};
  for (const [k, v] of Object.entries(indicators)) {
    if (k.endsWith('Change') || k.endsWith('change')) continue;
    if (v === null || v === undefined) nullFields.push(k);
    else presentFields[k] = v as number;
  }
  // also dump the raw dataMap keys and their lastPrice
  const dmSample: Record<string, unknown> = {};
  for (const [sym, entry] of dataMap.entries()) {
    dmSample[sym] = { lastPrice: entry.lastPrice, closePrice: entry.closePrice, close: entry.close };
  }
  res.json({ hitCount, presentCount: Object.keys(presentFields).length, nullCount: nullFields.length, presentFields, nullFields, dataMapSample: dmSample });
});

router.get("/market-pulse/data-check", (_req, res) => {
  const { dataMap } = readFromWebSocketCache();
  const now = Date.now();
  const rows: Record<string, unknown>[] = [];

  // Fallback aliases: if the primary symbol has no data, check these alternates
  const FALLBACK_ALIAS: Record<string, string> = {
    "/DX": "$DXY",
  };
  const snapshot = getSnapshot();

  for (const sym of PULSE_SYMBOLS) {
    let d = dataMap.get(sym.display);
    let cached = snapshot.find(q => q.symbol === sym.api || q.symbol === sym.display);

    // Try fallback alias if primary has no data
    const alias = FALLBACK_ALIAS[sym.display];
    if (!d && alias) d = dataMap.get(alias);
    if (!cached && alias) cached = snapshot.find(q => q.symbol === alias);

    const last = d ? (d["lastPrice"] ?? d["mark"] ?? d["close"] ?? null) : null;
    const ageMs = cached ? now - cached.ts : null;
    rows.push({
      symbol: sym.display,
      category: sym.category,
      last,
      close: d?.["closePrice"] ?? d?.["close"] ?? null,
      change: d?.["netChange"] ?? null,
      hasData: last !== null,
      ageSec: ageMs !== null ? Math.round(ageMs / 1000) : null,
      ...(alias && { source: last !== null ? (dataMap.get(sym.display) ? sym.display : alias) : undefined }),
    });
  }

  const total = rows.length;
  const withData = rows.filter(r => r["hasData"]).length;
  const missing = rows.filter(r => !r["hasData"]).map(r => r["symbol"]);
  const stale = rows.filter(r => typeof r["ageSec"] === "number" && (r["ageSec"] as number) > 60).length;
  const schwabDiag = getSchwabCacheDiagnostics();

  res.json({
    summary: { total, withData, missing: total - withData, stale },
    missingSymbols: missing,
    schwabCache: schwabDiag,
    rows,
  });
});

{
  const { passed, output } = verifyEngineScoring();
  console.log(output);
  if (!passed) {
    console.error("ENGINE VERIFICATION FAILED — see output above");
  }
}

export default router;
