import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger.js";
import type {
  AiLabAnalystClient,
  AnalystRequest,
  AnalystResponse,
  AnalystRebuttalRequest,
  AnalystRebuttalResponse,
} from "./aiLabLlmTypes.js";
import type { AiLabModelProvider } from "./aiLabConfig.js";

const DEFAULT_ANALYST_MODEL = "claude-sonnet-4-20250514";

const ANALYST_SYSTEM_PROMPT = `You are the Senior Options Strategist Analyst for a quantitative trading desk. You have full access ONLY to the complete market snapshot provided in this call.

CRITICAL GROUNDING RULES — you MUST obey these at all times:
1. You have NO knowledge outside the snapshot you receive. All analysis, trends, price action, directional calls, and conclusions must be derived exclusively from data in this snapshot.
2. Before making ANY bullish, bearish, or neutral claim on a ticker, you MUST first explicitly reference the actual recent price action, key levels, volume, and market regime shown in the snapshot. Do not assume or hallucinate recent performance.
3. If the snapshot does not contain clear recent price action or trend data for a ticker, you must state uncertainty clearly and avoid strong directional statements.
4. Every major claim must be backed by specific data points from the snapshot (e.g. "MSFT is up 2.8% today with strong volume at key resistance per the level-1 data").

If nothing meets a 75+ conviction threshold, set signalStrength below 75 and note "LOW CONVICTION — data does not support a strong directional view" in analystNote. Do not force a recommendation.

OPTIONS-FIRST POLICY:
Alpha Terminal is primarily an options-focused platform. You SHOULD express directional views as options trades when a clean, liquid options structure exists.
- Be EXTREMELY specific and actionable: exact expiration date (YYYY-MM-DD), exact strike price, buy/sell call/put, spread details, entry price/level.
- You MUST only recommend real, currently-traded contracts that exist in the snapshot you received. If the exact strike or expiration you want is not in the data, choose the closest liquid one and explicitly say so. Never invent contracts.
- For most ideas, the recommended structure should specify: expiry (exact date), options type and structure (long call/put, vertical debit spread, credit spread, iron condor, etc.), strikes, and basic sizing guidance ("small", "medium", "large").
- You MAY recommend pure equity long/short ONLY when: options liquidity is poor (wide spreads, very low OI/volume), there is no clean risk-defined options structure matching the thesis, or equity is clearly the simplest/most appropriate expression.
- When choosing equity over options, explain why in primaryProposal.structure (e.g. "Equity long — options spreads too wide at relevant strikes").
- Any options structure is allowed: naked short options, spreads, condors, butterflies, calendars, etc.
- Contract size represents conviction/risk signal, NOT tied to any particular account balance.

CONTEXT USAGE — use the provided data to ground your analysis:
- Level 1 futures and equities data for price action, volume, and key levels.
- Options chain data (strikes, expirations, greeks, IV, volume, open interest) for structure selection and liquidity validation.
- ivSummary: IV30d, IVR, HV20d, IV/HV ratio for vol-based structure selection.
- flowSummary: call/put skew, volume/OI, block activity for directional conviction.
- scannerAlignment: discoveryScore, momentumScore for signal confirmation/conflict.
- liquidityMetrics: avgSpreadPct, minOiMainStrikes for options structure viability.
- rsSummary: relative strength vs SPY for sector/momentum context.
- News, earnings calendar, and analyst ratings (only what is in the snapshot).
- Current market regime (from Market Pulse results).

RULES:
- Return ONLY valid JSON matching the schema below. No markdown, no commentary outside JSON.
- Be specific about entry/exit zones. Use the snapshot data to ground your numbers.
- If the data quality is poor (missing IV, no flow data), set confidence.uncertainty.dataQuality to "LOW".
- Match direction to regime: in RISK_OFF regimes, favor SHORT unless there is a compelling contrarian thesis.
- If scanner alignment disagrees with your thesis, note it in mainSignals and lower signalStrength.
- Keep analystNote under 300 words. Include specific entry price/level, target price, stop-loss, and risk/reward estimate.
- primaryProposal must be filled in completely:
  - thesis: why this trade, why now — grounded in snapshot data with specific data points cited.
  - structure: exact contract details — expiration date, strike price, buy/sell call/put, spread legs. For equity explain why options were not used.
  - riskNotes: main risks, what invalidates the trade, key exit conditions, stop-loss level.

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

const ANALYST_REBUTTAL_SYSTEM_PROMPT = `You are an institutional-grade equity/options Analyst engaged in a deliberation with a Skeptic on a quantitative trading desk.

The Skeptic has critiqued your trade idea. You must now respond to their objections. You have three options:
1. DEFEND your original idea — rebut the Skeptic's points with data-driven arguments. Explain why their concerns don't apply or are overweighted.
2. CONCEDE and MODIFY — accept valid points and revise your idea (adjust strikes, size, structure, timing, etc.). Show the updated trade idea.
3. AGREE to WITHDRAW — if the Skeptic's objections are so compelling that the idea is fundamentally flawed, set agreesWithSkeptic=true and explain why you're abandoning the trade.

Be honest and intellectually rigorous. If the Skeptic made a good point, acknowledge it. If they're wrong, explain why with data.

The conversation continues until you and the Skeptic reach agreement. You should converge toward a consensus — either a refined trade or agreement to pass.

RULES:
- Return ONLY valid JSON matching the schema below. No markdown, no commentary outside JSON.
- revisedIdea must be a complete AnalystResponse (same schema as original), even if you only changed small parts.
- rebuttalNote: your argument/response to the Skeptic (under 300 words).
- concessions: what you agreed with from the Skeptic's critique.
- changesFromPrevious: what you changed in this revision (or "No changes — defending original position").
- agreesWithSkeptic: true ONLY if you're conceding the idea should be killed/withdrawn entirely.

REQUIRED JSON SCHEMA:
{
  "revisedIdea": { <full AnalystResponse schema> },
  "rebuttalNote": string,
  "concessions": string,
  "changesFromPrevious": string,
  "agreesWithSkeptic": boolean
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

function buildRebuttalPrompt(request: AnalystRebuttalRequest): string {
  const historyStr = request.conversationHistory.map(t =>
    `[Round ${t.round} — ${t.role.toUpperCase()}]: ${t.content.note}`
  ).join("\n\n");

  return `DELIBERATION ROUND ${request.round} — Respond to the Skeptic's critique for ${request.symbol}.

RUN CONTEXT:
${JSON.stringify(request.runContext, null, 2)}

TICKER SNAPSHOT:
${JSON.stringify(request.tickerSnapshot, null, 2)}

REGIME STATE:
${JSON.stringify(request.regimeState, null, 2)}

YOUR CURRENT IDEA:
${JSON.stringify(request.currentIdea, null, 2)}

SKEPTIC'S CRITIQUE (score: ${request.skepticCritique.critiqueScore}/100):
${JSON.stringify(request.skepticCritique.skepticCritique, null, 2)}

Skeptic flags: ${JSON.stringify(request.skepticCritique.flags)}
Skeptic note: ${request.skepticCritique.criticNote}

CONVERSATION SO FAR:
${historyStr || "This is the first rebuttal round."}

Respond with ONLY the JSON object. No markdown fences, no explanation.`;
}

function validateRebuttalResponse(parsed: any): AnalystRebuttalResponse {
  if (!parsed || typeof parsed !== "object") throw new Error("Response is not an object");
  if (!parsed.revisedIdea) throw new Error("Missing revisedIdea");
  const validated = validateAnalystResponse(parsed.revisedIdea);
  return {
    revisedIdea: validated,
    rebuttalNote: typeof parsed.rebuttalNote === "string" ? parsed.rebuttalNote : "",
    concessions: typeof parsed.concessions === "string" ? parsed.concessions : "None",
    changesFromPrevious: typeof parsed.changesFromPrevious === "string" ? parsed.changesFromPrevious : "N/A",
    agreesWithSkeptic: typeof parsed.agreesWithSkeptic === "boolean" ? parsed.agreesWithSkeptic : false,
  };
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
  return callAnthropicWithSystem(model, temperature, ANALYST_SYSTEM_PROMPT, prompt);
}

async function callAnthropicWithSystem(model: string, temperature: number, systemPrompt: string, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in Analyst LLM response");
  }
  return textBlock.text.trim();
}

async function callGemini(model: string, temperature: number, prompt: string): Promise<string> {
  return callGeminiWithSystem(model, temperature, ANALYST_SYSTEM_PROMPT, prompt);
}

async function callGeminiWithSystem(model: string, temperature: number, systemPrompt: string, prompt: string): Promise<string> {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Gemini AI integration env vars not configured");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });

  const response = await ai.models.generateContent({
    model,
    contents: [
      { role: "user", parts: [{ text: systemPrompt + "\n\n" + prompt }] },
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

  async rebutCritique(request: AnalystRebuttalRequest): Promise<AnalystRebuttalResponse> {
    const prompt = buildRebuttalPrompt(request);

    let rawText: string;
    switch (this.provider) {
      case "anthropic":
        rawText = await callAnthropicWithSystem(this.modelName, this.temperature, ANALYST_REBUTTAL_SYSTEM_PROMPT, prompt);
        break;
      case "google":
        rawText = await callGeminiWithSystem(this.modelName, this.temperature, ANALYST_REBUTTAL_SYSTEM_PROMPT, prompt);
        break;
      default:
        throw new Error(`Unsupported analyst provider: ${this.provider}`);
    }

    const cleanText = extractJson(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      logger.error({ rawSnippet: rawText.slice(0, 500) }, "AI Lab Analyst: rebuttal JSON parse failure");
      throw new Error("Analyst rebuttal response is not valid JSON");
    }

    return validateRebuttalResponse(parsed);
  }
}

export function createAnalystClient(
  provider: AiLabModelProvider = "anthropic",
  modelName: string = DEFAULT_ANALYST_MODEL,
  temperature: number = 0,
): AiLabAnalystClient {
  return new ConfigurableAnalystClient(provider, modelName, temperature);
}
