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
    const clean = sanitizeContracts(contracts).slice(0, 20);
    return `${type} OPTIONS (nearest 20 strikes):\n` + clean.map(
      (c) => {
        const iv = c["iv"] != null ? `${c["iv"]}%` : "N/A";
        return `  Strike $${c["strike"]} | Exp: ${c["expiration"]} | DTE: ${c["dte"]} | Bid: $${c["bid"]} | Ask: $${c["ask"]} | Last: $${c["last"]} | IV: ${iv} | Delta: ${c["delta"]} | Gamma: ${c["gamma"]} | Theta: ${c["theta"]} | Vega: ${c["vega"]} | Vol: ${c["volume"]} | OI: ${c["openInterest"]}`;
      }
    ).join("\n");
  };

  return `FULL OPTION CHAIN — Underlying Price: $${underlyingPrice}\n\n${formatContracts(rawCalls, "CALL")}\n\n${formatContracts(rawPuts, "PUT")}`;
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

${OPTIONS_DATA_QUALITY_NOTE}

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

// Maps user-facing symbols to Schwab API format (adds $ prefix for known indices)
const INDEX_TO_SCHWAB: Record<string, string> = {
  "VIX": "$VIX", "VVIX": "$VVIX", "SPX": "$SPX", "NDX": "$NDX",
  "RUT": "$RUT", "DJI": "$DJI", "DJIA": "$DJI", "COMP": "$COMP",
  "DXY": "$DXY", "TNX": "$TNX", "TYX": "$TYX", "VXN": "$VXN",
  "TICK": "$TICK", "ADD": "$ADD", "TRIN": "$TRIN", "CPC": "$CPC",
  "OEX": "$OEX", "MNX": "$MNX", "XSP": "$XSP",
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

  const prompt = `You are an elite Macro Prop Desk Analyst at a top-tier systematic hedge fund. Your job is to synthesize live multi-asset data into a precise, actionable market pulse used by senior traders. You think like a quant and write like a seasoned desk strategist.

═══════════════════════════════════════════════════════
LIVE MARKET PULSE — ${timeET} | SESSION: ${session}
INSTRUMENTS SCANNED: ${symbolList}
═══════════════════════════════════════════════════════

SESSION DIRECTIVE: ${sessionGuidance}

═══════════════════════════════════════════════════════
LIVE MULTI-ASSET DATA FEED
═══════════════════════════════════════════════════════

${dataBlock}

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

${OPTIONS_DATA_QUALITY_NOTE}

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

${marketContext ? `LIVE SCHWAB DATA:\n${marketContext}` : ""}`;

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

    for await (const chunk of result.textStream) {
      res.write(chunk);
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

router.post("/sympathy-plays", async (req, res) => {
  const { symbol, model = "gemini-2.5-flash", temperature = 0.3 } = req.body as {
    symbol?: string;
    model?: string;
    temperature?: number;
  };

  if (!symbol) {
    return res.status(400).json({ error: "symbol is required" });
  }

  const prompt = `List 3-5 highly correlated sympathy stocks and main competitors for ${symbol.toUpperCase()}. For each, provide the ticker and a 1-sentence reason why it moves with or competes against ${symbol.toUpperCase()}.

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
