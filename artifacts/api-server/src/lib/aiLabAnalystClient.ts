import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger.js";
import type {
  AiLabAnalystClient,
  AnalystRequest,
  AnalystResponse,
} from "./aiLabLlmTypes.js";
import type { AiLabModelProvider } from "./aiLabConfig.js";

const DEFAULT_ANALYST_MODEL = "claude-sonnet-4-20250514";

const ANALYST_SYSTEM_PROMPT = `You are an institutional-grade equity/options Analyst for a quantitative trading desk.
Given a ticker's snapshot data, market regime state, and portfolio context, propose a single trade idea.

OPTIONS-FIRST POLICY:
Alpha Terminal is primarily an options-focused platform. You SHOULD express directional views as options trades when a clean, liquid options structure exists.
- For most ideas, the recommended structure should specify: expiry (exact date or relative like "3rd Friday May"), options type and structure (long call/put, vertical debit spread, credit spread, iron condor, etc.), strikes (or clear description relative to current price/entry/target/stop), and basic sizing guidance ("small", "medium", "large").
- You MAY recommend pure equity long/short ONLY when: options liquidity is poor (wide spreads, very low OI/volume), there is no clean risk-defined options structure matching the thesis, or equity is clearly the simplest/most appropriate expression.
- When choosing equity over options, explain why in primaryProposal.structure (e.g. "Equity long — options spreads too wide at relevant strikes").
- It is acceptable to describe both the underlying directional view AND the preferred options expression. When options are viable, treat the options trade as the PRIMARY recommendation.
- Any options structure is allowed: naked short options, spreads, condors, butterflies, calendars, etc.
- Contract size represents conviction/risk signal, NOT tied to any particular account balance. Output whatever size the model believes is appropriate.

CONTEXT USAGE:
Use the provided data to ground your analysis:
- ivSummary: IV30d, IVR, HV20d, IV/HV ratio for vol-based structure selection.
- flowSummary: call/put skew, volume/OI, block activity for directional conviction.
- scannerAlignment: discoveryScore, momentumScore for signal confirmation/conflict.
- liquidityMetrics: avgSpreadPct, minOiMainStrikes for options structure viability.
- rsSummary: relative strength vs SPY for sector/momentum context.

RULES:
- Return ONLY valid JSON matching the schema below. No markdown, no commentary outside JSON.
- Be specific about entry/exit zones. Use the snapshot data to ground your numbers.
- If the data quality is poor (missing IV, no flow data), set confidence.uncertainty.dataQuality to "LOW".
- Match direction to regime: in RISK_OFF regimes, favor SHORT unless there is a compelling contrarian thesis.
- If scanner alignment disagrees with your thesis, note it in mainSignals and lower signalStrength.
- Keep analystNote under 300 words.
- primaryProposal must be filled in completely:
  - thesis: why this trade, why now.
  - structure: what you think is the best expression — for options include expiry, structure type, strikes, sizing; for equity explain why options were not used.
  - riskNotes: main risks, what invalidates the trade, key exit conditions.

REQUIRED JSON SCHEMA:
{
  "tradeIdeaCore": {
    "direction": "LONG" | "SHORT",
    "instrumentType": "STOCK" | "OPTIONS" | "STOCK+OPTIONS",
    "optionStructureType": string | null,
    "legs": [{ "legType": "CALL"|"PUT", "side": "BUY"|"SELL", "strike": number, "expiration": "YYYY-MM-DD", "quantity": number }] | null,
    "entryZone": { "min": number, "max": number } | null,
    "softStop": number | null,
    "targetZone": { "min": number, "max": number } | null,
    "timeHorizon": "INTRADAY" | "1-3D" | "3-10D" | "10+D"
  },
  "rationale": {
    "thesis": string,
    "catalyst": "FLOW" | "EARNINGS" | "TECHNICAL" | "MACRO" | "OTHER",
    "invalidation": string,
    "regimeFit": "GOOD" | "NEUTRAL" | "POOR",
    "mainSignals": [string]
  },
  "confidence": {
    "signalStrength": 0-100,
    "convictionLevel": "LOW" | "MEDIUM" | "HIGH",
    "uncertainty": {
      "dataQuality": "HIGH" | "MEDIUM" | "LOW",
      "patternReliability": number | null,
      "regimeFitScore": number | null
    }
  },
  "liquiditySnapshot": {
    "entrySpreadPct": number | null,
    "oiAtEntry": number | null,
    "volumeAtEntry": number | null,
    "volumeToOiRatio": number | null
  },
  "scannerAlignmentAtCreation": {
    "discoveryScore": number | null,
    "momentumScore": number | null,
    "modeAlignment": "AGREE" | "DISAGREE" | "NO_SIGNAL" | null
  },
  "analystNote": string,
  "primaryProposal": {
    "thesis": string,
    "structure": string,
    "riskNotes": string
  }
}`;

function buildAnalystPrompt(request: AnalystRequest): string {
  return `Generate a trade idea for ${request.symbol}.

RUN CONTEXT:
${JSON.stringify(request.runContext, null, 2)}

TICKER SNAPSHOT:
${JSON.stringify(request.tickerSnapshot, null, 2)}

REGIME STATE:
${JSON.stringify(request.regimeState, null, 2)}

PATTERN PERFORMANCE (historical, may be empty):
${JSON.stringify(request.patternPerformance, null, 2)}

ACTIVE IDEAS SUMMARY:
${JSON.stringify(request.activeIdeasSummary, null, 2)}

Respond with ONLY the JSON object. No markdown fences, no explanation.`;
}

const VALID_DIRECTIONS = new Set(["LONG", "SHORT"]);
const VALID_INSTRUMENT_TYPES = new Set(["STOCK", "OPTIONS", "STOCK+OPTIONS"]);
const VALID_CATALYSTS = new Set(["FLOW", "EARNINGS", "TECHNICAL", "MACRO", "OTHER"]);
const VALID_REGIME_FITS = new Set(["GOOD", "NEUTRAL", "POOR"]);
const VALID_CONVICTIONS = new Set(["LOW", "MEDIUM", "HIGH"]);
const VALID_DATA_QUALITIES = new Set(["HIGH", "MEDIUM", "LOW"]);
const VALID_TIME_HORIZONS = new Set(["INTRADAY", "1-3D", "3-10D", "10+D"]);

function validateAnalystResponse(parsed: any): AnalystResponse {
  if (!parsed || typeof parsed !== "object") throw new Error("Response is not an object");

  const core = parsed.tradeIdeaCore;
  if (!core || typeof core !== "object") throw new Error("Missing tradeIdeaCore");
  if (!VALID_DIRECTIONS.has(core.direction)) throw new Error(`Invalid direction: ${core.direction}`);
  if (!VALID_INSTRUMENT_TYPES.has(core.instrumentType)) throw new Error(`Invalid instrumentType: ${core.instrumentType}`);
  if (!VALID_TIME_HORIZONS.has(core.timeHorizon)) throw new Error(`Invalid timeHorizon: ${core.timeHorizon}`);

  const rat = parsed.rationale;
  if (!rat || typeof rat !== "object") throw new Error("Missing rationale");
  if (typeof rat.thesis !== "string" || !rat.thesis) throw new Error("Missing rationale.thesis");
  if (!VALID_CATALYSTS.has(rat.catalyst)) throw new Error(`Invalid catalyst: ${rat.catalyst}`);
  if (typeof rat.invalidation !== "string") throw new Error("Missing rationale.invalidation");
  if (!VALID_REGIME_FITS.has(rat.regimeFit)) throw new Error(`Invalid regimeFit: ${rat.regimeFit}`);
  if (!Array.isArray(rat.mainSignals)) throw new Error("mainSignals must be an array");

  const conf = parsed.confidence;
  if (!conf || typeof conf !== "object") throw new Error("Missing confidence");
  if (typeof conf.signalStrength !== "number" || conf.signalStrength < 0 || conf.signalStrength > 100)
    throw new Error(`Invalid signalStrength: ${conf.signalStrength}`);
  if (!VALID_CONVICTIONS.has(conf.convictionLevel)) throw new Error(`Invalid convictionLevel: ${conf.convictionLevel}`);
  if (!conf.uncertainty || !VALID_DATA_QUALITIES.has(conf.uncertainty.dataQuality))
    throw new Error("Missing or invalid uncertainty.dataQuality");

  if (!parsed.liquiditySnapshot || typeof parsed.liquiditySnapshot !== "object")
    throw new Error("Missing liquiditySnapshot");

  if (!parsed.scannerAlignmentAtCreation || typeof parsed.scannerAlignmentAtCreation !== "object")
    throw new Error("Missing scannerAlignmentAtCreation");

  if (typeof parsed.analystNote !== "string") throw new Error("Missing analystNote");

  if (!parsed.primaryProposal || typeof parsed.primaryProposal !== "object") {
    parsed.primaryProposal = {
      thesis: rat.thesis,
      structure: core.optionStructureType ?? core.instrumentType ?? "N/A",
      riskNotes: rat.invalidation,
    };
  } else {
    if (typeof parsed.primaryProposal.thesis !== "string") parsed.primaryProposal.thesis = rat.thesis;
    if (typeof parsed.primaryProposal.structure !== "string") parsed.primaryProposal.structure = core.optionStructureType ?? "N/A";
    if (typeof parsed.primaryProposal.riskNotes !== "string") parsed.primaryProposal.riskNotes = rat.invalidation;
  }

  return parsed as AnalystResponse;
}

async function callAnthropic(model: string, temperature: number, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature,
    system: ANALYST_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in Analyst LLM response");
  }
  return textBlock.text.trim();
}

async function callGemini(model: string, temperature: number, prompt: string): Promise<string> {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Gemini AI integration env vars not configured");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });

  const response = await ai.models.generateContent({
    model,
    contents: [
      { role: "user", parts: [{ text: ANALYST_SYSTEM_PROMPT + "\n\n" + prompt }] },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature,
    },
  });

  const rawText = (response.text ?? "").trim();
  if (!rawText) throw new Error("No text content in Analyst LLM response (Gemini)");
  return rawText;
}

function extractJson(rawText: string): string {
  let text = rawText;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  return text;
}

export class ConfigurableAnalystClient implements AiLabAnalystClient {
  readonly modelName: string;
  private provider: AiLabModelProvider;
  private temperature: number;

  constructor(provider: AiLabModelProvider, modelName: string, temperature: number) {
    this.provider = provider;
    this.modelName = modelName;
    this.temperature = temperature;
  }

  async generateIdea(request: AnalystRequest): Promise<AnalystResponse> {
    const prompt = buildAnalystPrompt(request);

    let rawText: string;
    switch (this.provider) {
      case "anthropic":
        rawText = await callAnthropic(this.modelName, this.temperature, prompt);
        break;
      case "google":
        rawText = await callGemini(this.modelName, this.temperature, prompt);
        break;
      default:
        throw new Error(`Unsupported analyst provider: ${this.provider}`);
    }

    const cleanText = extractJson(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      logger.error({ rawSnippet: rawText.slice(0, 500) }, "AI Lab Analyst: JSON parse failure");
      throw new Error("Analyst response is not valid JSON");
    }

    return validateAnalystResponse(parsed);
  }
}

export function createAnalystClient(
  provider: AiLabModelProvider = "anthropic",
  modelName: string = DEFAULT_ANALYST_MODEL,
  temperature: number = 0,
): AiLabAnalystClient {
  return new ConfigurableAnalystClient(provider, modelName, temperature);
}
