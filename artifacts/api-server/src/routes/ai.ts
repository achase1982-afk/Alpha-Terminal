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
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
];

function getClient(): GoogleGenerativeAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

async function callGemini(
  prompt: string,
  modelName: string = "gemini-2.0-flash",
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
    const response = await callGemini(prompt, model ?? "gemini-2.0-flash", temperature ?? 0.3);
    res.json(RunTechnicalAnalysisResponse.parse({ response }));
  } catch (err) {
    req.log.error({ err }, "Technical analysis error");
    res.json(RunTechnicalAnalysisResponse.parse({ response: "Error running analysis. Please try again.", error: String(err) }));
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
    const response = await callGemini(prompt, model ?? "gemini-2.0-flash", temperature ?? 0.3);
    res.json(RunOptionsAnalysisResponse.parse({ response }));
  } catch (err) {
    req.log.error({ err }, "Options analysis error");
    res.json(RunOptionsAnalysisResponse.parse({ response: "Error running analysis. Please try again.", error: String(err) }));
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
    const response = await callGemini(prompt, model ?? "gemini-2.0-flash", temperature ?? 0.3);
    res.json(RunChatQueryResponse.parse({ response }));
  } catch (err) {
    req.log.error({ err }, "Chat query error");
    res.json(RunChatQueryResponse.parse({ response: "Error processing your question. Please try again.", error: String(err) }));
  }
});

export default router;
