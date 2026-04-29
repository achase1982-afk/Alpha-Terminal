import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { generateText, stepCountIs, streamText, type ToolSet } from "ai";
import { createXai, type XaiLanguageModelResponsesOptions } from "@ai-sdk/xai";
import { logger } from "./logger.js";
import { createGeminiClient, hasGeminiApiKey } from "./geminiClient.js";
import { getXaiApiKey } from "./xaiEnv.js";
import type {
  AiLabAnalystClient,
  AnalystRequest,
  AnalystResponse,
  AnalystRebuttalRequest,
  AnalystRebuttalResponse,
  UniverseScreenRequest,
  UniverseScreenResponse,
} from "./aiLabLlmTypes.js";
import { type AiLabModelProvider, getActivePrompt } from "./aiLabConfig.js";

const DEFAULT_ANALYST_MODEL = "claude-opus-4-6";
const GEMINI_WEB_SEARCH_MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Anthropic message `content` may include text, server_tool_use, web_search_tool_result, etc.; runtime blocks are wider than the SDK union. */
type AnthropicMessageContentBlock = Record<string, unknown>;

/** Raw stream events from `client.messages.stream` include content_block_* shapes not fully reflected in SDK types. */
type AnthropicStreamEvent = Record<string, unknown>;

/** Gemini `generateContent` / stream chunks expose `candidates[].groundingMetadata` for Google Search grounding. */
interface GeminiGroundingMetadata {
  webSearchQueries?: unknown;
  groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
}

interface GeminiCandidateChunk {
  candidates?: Array<{ groundingMetadata?: GeminiGroundingMetadata }>;
}

/**
 * Anthropic `web_search_20250305` tool shape — SDK `Tool` union does not include this server tool yet.
 * Included in `tools` arrays widened below and asserted only at `messages.create` / `messages.stream`.
 */
interface AnthropicWebSearchToolSpec {
  type: "web_search_20250305";
  name: string;
  max_uses: number;
}

type AnthropicMessageCreateParamsWithWebSearch = Omit<Anthropic.MessageCreateParamsNonStreaming, "tools"> & {
  tools?: ReadonlyArray<Anthropic.Tool | AnthropicWebSearchToolSpec>;
};

type AnthropicMessageStreamParamsWithWebSearch = Omit<Anthropic.MessageCreateParamsStreaming, "tools"> & {
  tools?: ReadonlyArray<Anthropic.Tool | AnthropicWebSearchToolSpec>;
};

/** Hosted OpenAI integration proxy: `chat.completions.create` accepts a dynamic JSON body not matching strict SDK overloads. */
interface OpenAIChatCompletionsCreateClient {
  chat: {
    completions: {
      create: (p: Record<string, unknown>) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
    };
  };
}

function asOpenAIChatCompletionsCreateClient(client: OpenAI): OpenAIChatCompletionsCreateClient {
  // Hosted proxy accepts a dynamic JSON body; widen through `unknown` because SDK overloads reject `Record<string, unknown>`.
  const proxy: unknown = client;
  return proxy as OpenAIChatCompletionsCreateClient;
}

/** OpenAI SDK types lag the Responses API (`web_search_preview`, reasoning, streaming). */
interface OpenAIResponsesClientNonStream {
  responses: {
    create: (p: Record<string, unknown>) => Promise<{ output?: unknown; output_text?: string }>;
  };
}

interface OpenAIResponsesClientStream {
  responses: {
    create: (p: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
  };
}

function errorCauseMessage(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("cause" in err)) return null;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause) return null;
  if (cause instanceof Error) {
    const codeValue = (cause as Error & { code?: unknown }).code;
    const code = typeof codeValue === "string" ? ` ${codeValue}` : "";
    return `${cause.name}${code}: ${cause.message}`;
  }
  return String(cause);
}

function geminiErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = errorCauseMessage(err);
  return cause ? `${message} (cause: ${cause})` : message;
}

function isRetryableGeminiWebSearchError(err: unknown): boolean {
  const msg = geminiErrorMessage(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR|socket|network/i.test(msg);
}

async function withGeminiRetry<T>(
  operation: "generateContent" | "generateContentStream",
  model: string,
  run: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= GEMINI_WEB_SEARCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      if (!isRetryableGeminiWebSearchError(err) || attempt === GEMINI_WEB_SEARCH_MAX_ATTEMPTS) {
        break;
      }
      const delayMs = Math.min(500 * attempt * attempt, 5000);
      logger.warn(
        { err, model, operation, attempt, nextAttemptInMs: delayMs },
        "Gemini web-search call failed transiently; retrying",
      );
      await sleep(delayMs);
    }
  }

  const msg = geminiErrorMessage(lastErr);
  throw new Error(`Gemini ${operation} failed for ${model}: ${msg}`);
}

export const DEFAULT_ANALYST_SYSTEM_PROMPT = `You are the Senior Options Strategist Analyst for a quantitative trading desk.

GROUNDING RULES:
1. You have access to the data snapshot provided AND your full training knowledge about markets, stocks, sectors, options pricing, earnings patterns, and institutional behavior. Use both. The snapshot gives you current numbers. Your knowledge gives you context about what those numbers mean. You are not limited to the snapshot.
2. Before making ANY bullish, bearish, or neutral claim on a ticker, you MUST first explicitly reference the actual recent price action, key levels, volume, and market regime shown in the snapshot. Do not assume or hallucinate recent performance.
3. If the snapshot does not contain clear recent price action or trend data for a ticker, you must state uncertainty clearly and avoid strong directional statements.
4. Every major claim must be backed by specific data points from the snapshot (e.g. "MSFT is up 2.8% today with strong volume at key resistance per the level-1 data").

If nothing meets a 75+ conviction threshold, set signalStrength below 75 and note "LOW CONVICTION — data does not support a strong directional view" in analystNote. Do not force a recommendation.

OPTIONS-FIRST POLICY:
Alpha Terminal is primarily an options-focused platform. You SHOULD express directional views as options trades when a clean, liquid options structure exists.
- Be EXTREMELY specific and actionable: exact expiration date (YYYY-MM-DD), exact strike price, buy/sell call/put, spread details, entry price/level.
- When recommending a trade, you MUST pick an expiration from the availableExpirations list provided in the data. Use YYYY-MM-DD format. Do not invent expiration dates.
- You MUST only recommend real, currently-traded contracts. If the exact strike you want is not in the data, choose the closest liquid one and explicitly say so. Never invent contracts.
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
- News, earnings calendar, and analyst ratings.
- Current market regime (from Market Pulse results).
- availableExpirations: list of valid options expiration dates (ISO format) to choose from.

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

export const DEFAULT_ANALYST_REBUTTAL_SYSTEM_PROMPT = `You are an institutional-grade equity/options Analyst engaged in a deliberation with a Skeptic on a quantitative trading desk.

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
  const snap = request.tickerSnapshot as Record<string, unknown>;
  const optionsChain = snap.optionsChainSummary ?? null;
  const snapshotWithoutChain = { ...snap };
  delete snapshotWithoutChain.optionsChainSummary;

  let optionsSection = "";
  if (optionsChain && typeof optionsChain === "object" && (optionsChain as any).available) {
    optionsSection = `\nLIVE OPTIONS CHAIN SUMMARY (from Polygon):\n${JSON.stringify(optionsChain, null, 2)}\n`;
  } else {
    optionsSection = `\nLIVE OPTIONS CHAIN: Not available (options market may be closed or no data). Use ivSummary and flowSummary from the ticker snapshot for volatility and flow context. If recommending options, flag data quality as LOW.\n`;
  }

  return `Generate a trade idea for ${request.symbol}.

RUN CONTEXT:
${JSON.stringify(request.runContext, null, 2)}

TICKER SNAPSHOT:
${JSON.stringify(snapshotWithoutChain, null, 2)}
${optionsSection}
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

  const snap = request.tickerSnapshot as Record<string, unknown>;
  const optionsChain = snap.optionsChainSummary ?? null;
  const snapshotWithoutChain = { ...snap };
  delete snapshotWithoutChain.optionsChainSummary;

  let optionsSection = "";
  if (optionsChain && typeof optionsChain === "object" && (optionsChain as any).available) {
    optionsSection = `\nLIVE OPTIONS CHAIN SUMMARY (from Polygon):\n${JSON.stringify(optionsChain, null, 2)}\n`;
  } else {
    optionsSection = `\nLIVE OPTIONS CHAIN: Not available.\n`;
  }

  return `DELIBERATION ROUND ${request.round} — Respond to the Skeptic's critique for ${request.symbol}.

RUN CONTEXT:
${JSON.stringify(request.runContext, null, 2)}

TICKER SNAPSHOT:
${JSON.stringify(snapshotWithoutChain, null, 2)}
${optionsSection}
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

function normalizeTimeHorizon(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "3-10D";
  const s = raw.toUpperCase().replace(/\s+/g, "");
  if (VALID_TIME_HORIZONS.has(s)) return s;
  if (s.includes("INTRA")) return "INTRADAY";
  const m = s.match(/(\d+)/g);
  if (m && m.length >= 1) {
    const maxDays = Math.max(...m.map(Number));
    if (maxDays <= 3) return "1-3D";
    if (maxDays <= 10) return "3-10D";
    return "10+D";
  }
  return "3-10D";
}

function validateAnalystResponse(parsed: any): AnalystResponse {
  if (!parsed || typeof parsed !== "object") throw new Error("Response is not an object");

  const core = parsed.tradeIdeaCore;
  if (!core || typeof core !== "object") throw new Error("Missing tradeIdeaCore");
  if (!VALID_DIRECTIONS.has(core.direction)) throw new Error(`Invalid direction: ${core.direction}`);
  if (!VALID_INSTRUMENT_TYPES.has(core.instrumentType)) throw new Error(`Invalid instrumentType: ${core.instrumentType}`);
  core.timeHorizon = normalizeTimeHorizon(core.timeHorizon);

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
  const CONVICTION_NORMALIZE: Record<string, string> = {
    "MODERATE": "MEDIUM", "MEDIUM_HIGH": "HIGH", "MEDIUM_LOW": "LOW",
    "VERY_HIGH": "HIGH", "VERY_LOW": "LOW", "NEUTRAL": "MEDIUM",
  };
  if (CONVICTION_NORMALIZE[conf.convictionLevel]) {
    conf.convictionLevel = CONVICTION_NORMALIZE[conf.convictionLevel];
  }
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

async function callAnthropic(model: string, temperature: number, prompt: string, systemPrompt: string): Promise<string> {
  return callAnthropicWithSystem(model, temperature, systemPrompt, prompt);
}

export async function callAnthropicWithSystem(model: string, temperature: number, systemPrompt: string, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey, timeout: 20 * 60 * 1000 });

  const isNew = /^claude-(opus|sonnet)-4-([7-9]|\d{2,})/.test(model);
  const THINKING_BUDGET = 4096;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: isNew ? 12288 : THINKING_BUDGET + 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  };
  if (isNew) {
    // Claude 4.7+: adaptive thinking — SDK `thinking` union lags the Messages API shape.
    params.thinking = { type: "adaptive", display: "summarized" } as Anthropic.MessageCreateParamsNonStreaming["thinking"];
  } else {
    // Older Claude: extended thinking with a budget; temperature must be 1
    params.thinking = { type: "enabled", budget_tokens: THINKING_BUDGET };
    params.temperature = 1;
  }
  void temperature;
  const message = await client.messages.create(params);

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in Analyst LLM response");
  }
  return textBlock.text.trim();
}

async function callGemini(model: string, temperature: number, prompt: string, systemPrompt: string): Promise<string> {
  return callGeminiWithSystem(model, temperature, systemPrompt, prompt);
}

export async function callGeminiWithSystem(model: string, temperature: number, systemPrompt: string, prompt: string): Promise<string> {
  if (!hasGeminiApiKey()) throw new Error("Gemini AI integration env vars not configured");
  const ai = createGeminiClient();

  const supportsThinking = /^gemini-(2\.5|3)/.test(model);
  const config: Record<string, unknown> = {
    responseMimeType: "application/json",
    maxOutputTokens: 8192,
    temperature,
  };
  if (supportsThinking) {
    // Dynamic thinking budget: model decides how much to think
    config.thinkingConfig = { thinkingBudget: -1, includeThoughts: false };
  }
  const response = await ai.models.generateContent({
    model,
    contents: [
      { role: "user", parts: [{ text: systemPrompt + "\n\n" + prompt }] },
    ],
    config: config as Parameters<typeof ai.models.generateContent>[0]["config"],
  });

  const rawText = (response.text ?? "").trim();
  if (!rawText) throw new Error("No text content in Analyst LLM response (Gemini)");
  return rawText;
}

async function callOpenAI(model: string, temperature: number, prompt: string, systemPrompt: string): Promise<string> {
  return callOpenAIWithSystem(model, temperature, systemPrompt, prompt);
}

export async function callOpenAIWithSystem(model: string, temperature: number, systemPrompt: string, prompt: string): Promise<string> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    throw new Error("OpenAI AI integration env vars not configured (AI_INTEGRATIONS_OPENAI_*)");
  }
  const client = new OpenAI({ apiKey, baseURL, timeout: 20 * 60 * 1000 });

  // gpt-5.x and o-series require max_completion_tokens (not max_tokens),
  // ignore custom temperature, and use reasoning_effort for "thinking".
  const thinking = /^gpt-5/.test(model) || /^o[34]/.test(model);
  const params: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  };
  if (thinking) {
    params.reasoning_effort = /^gpt-5\.5/.test(model) ? "high" : "medium";
  } else {
    params.temperature = temperature;
  }

  const completion = await asOpenAIChatCompletionsCreateClient(client).chat.completions.create(params);

  const text = completion.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("No text content in Analyst LLM response (OpenAI)");
  return text;
}

function makeXaiProvider() {
  const apiKey = getXaiApiKey();
  if (!apiKey) throw new Error("xAI API key not configured (set XAI_API_KEY or GROK_XAI)");
  return createXai({ apiKey });
}

export async function callXaiWithSystem(model: string, temperature: number, systemPrompt: string, prompt: string): Promise<string> {
  const xai = makeXaiProvider();
  const { text } = await generateText({
    model: xai(model),
    system: systemPrompt,
    temperature,
    prompt,
  });
  const rawText = text.trim();
  if (!rawText) throw new Error("No text content in Analyst LLM response (xAI)");
  return rawText;
}

function mergeXaiWebSearchTraceFromSteps(steps: unknown[]): { queries: string[]; sources: WebSearchSource[] } {
  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const trs = (step as { toolResults?: unknown }).toolResults;
    if (!Array.isArray(trs)) continue;
    for (const tr of trs) {
      const out = tr && typeof tr === "object" && "output" in tr
        ? (tr as { output?: unknown }).output
        : tr && typeof tr === "object" && "result" in tr
          ? (tr as { result?: unknown }).result
          : undefined;
      if (!out || typeof out !== "object") continue;
      const q = (out as Record<string, unknown>).query;
      if (typeof q === "string" && q.trim()) queries.push(q.trim());
      const srcs = (out as Record<string, unknown>).sources;
      if (Array.isArray(srcs)) {
        for (const s of srcs) {
          if (s && typeof s === "object") {
            const url = (s as { url?: string }).url;
            const title = (s as { title?: string }).title;
            if (typeof url === "string" && url && !seenUrls.has(url)) {
              seenUrls.add(url);
              sources.push({ title: typeof title === "string" && title ? title : url, url });
            }
          }
        }
      }
    }
  }
  return { queries, sources };
}

function xaiReasoningProviderOptions(model: string): { xai: XaiLanguageModelResponsesOptions } | undefined {
  if (model.includes("non-reasoning")) return { xai: { reasoningEffort: "low" } };
  const isReasoningVariant =
    (model.includes("reasoning") && !model.includes("non-reasoning"))
    || /grok-4-1-fast-reasoning|grok-4-fast-reasoning|grok-4\.20-0309-reasoning|grok-4\.20-multi-agent/.test(model);
  if (isReasoningVariant) return { xai: { reasoningEffort: "high" } };
  return undefined;
}

export async function callXaiWithSystemAndWebSearch(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
): Promise<WebSearchResult> {
  const xai = makeXaiProvider();
  const reasoningOpts = xaiReasoningProviderOptions(model);
  const result = await generateText({
    model: xai.responses(model),
    system: systemPrompt,
    temperature,
    prompt,
    tools: { web_search: xai.tools.webSearch() } as ToolSet,
    stopWhen: stepCountIs(15),
    ...(reasoningOpts ? { providerOptions: reasoningOpts } : {}),
  });

  const { queries, sources } = mergeXaiWebSearchTraceFromSteps(result.steps);
  const text = result.text.trim();
  if (!text) throw new Error("No text content in Strategist LLM response (xAI web search)");

  return {
    text,
    trace: { webSearchUsed: queries.length > 0, queries, sources },
  };
}

export async function streamCallXaiWithSystemAndWebSearch(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (status: string) => void,
): Promise<WebSearchResult> {
  const xai = makeXaiProvider();
  onStatus?.("Calling xAI with web search…");

  const reasoningOpts = xaiReasoningProviderOptions(model);
  const result = streamText({
    model: xai.responses(model),
    system: systemPrompt,
    temperature,
    prompt,
    tools: { web_search: xai.tools.webSearch() } as ToolSet,
    stopWhen: stepCountIs(15),
    ...(reasoningOpts ? { providerOptions: reasoningOpts } : {}),
  });

  for await (const part of result.fullStream) {
    if (part.type === "text-delta" && part.text) {
      onDelta(part.text);
    } else if (part.type === "tool-call") {
      onStatus?.("Searching the web…");
    }
  }

  const steps = await result.steps;
  const text = (await result.text).trim();
  if (!text) throw new Error("No text content in Strategist LLM stream (xAI)");

  const { queries, sources } = mergeXaiWebSearchTraceFromSteps(steps);

  return {
    text,
    trace: { webSearchUsed: queries.length > 0, queries, sources },
  };
}

export function extractJson(rawText: string): string {
  let text = rawText;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  return text;
}

// ----- Web search variants -----------------------------------------------
// Returns the model's final text output along with a trace of any web
// searches that were executed and the sources that were referenced. Used by
// the Strategist to make web search a first-class part of analysis.

export interface WebSearchSource {
  title: string;
  url: string;
  date?: string;
}
export interface WebSearchTrace {
  webSearchUsed: boolean;
  queries: string[];
  sources: WebSearchSource[];
}
export interface WebSearchResult {
  text: string;
  trace: WebSearchTrace;
}

const ANTHROPIC_WEB_SEARCH_MAX_USES = 5;

const ANTHROPIC_WEB_SEARCH_TOOL: AnthropicWebSearchToolSpec = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: ANTHROPIC_WEB_SEARCH_MAX_USES,
};

function asAnthropicContentBlocks(content: unknown): AnthropicMessageContentBlock[] {
  return content as AnthropicMessageContentBlock[];
}

function asAnthropicStreamEvent(event: unknown): AnthropicStreamEvent {
  return event as AnthropicStreamEvent;
}

export async function callAnthropicWithSystemAndWebSearch(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
): Promise<WebSearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey, timeout: 20 * 60 * 1000 });

  const isNew = /^claude-(opus|sonnet)-4-([7-9]|\d{2,})/.test(model);
  const THINKING_BUDGET = 4096;
  const params: AnthropicMessageCreateParamsWithWebSearch = {
    model,
    max_tokens: isNew ? 16384 : THINKING_BUDGET + 12288,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
    tools: [ANTHROPIC_WEB_SEARCH_TOOL],
  };
  if (isNew) {
    params.thinking = { type: "adaptive", display: "summarized" } as Anthropic.MessageCreateParamsNonStreaming["thinking"];
  } else {
    params.thinking = { type: "enabled", budget_tokens: THINKING_BUDGET };
    params.temperature = 1;
  }
  void temperature;

  const message = await client.messages.create(params as Anthropic.MessageCreateParamsNonStreaming);

  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  const textChunks: string[] = [];

  for (const block of asAnthropicContentBlocks(message.content)) {
    const t = block.type as string | undefined;
    if (t === "text") {
      const txt = (block as { text?: string }).text;
      if (txt) textChunks.push(txt);
    } else if (t === "server_tool_use") {
      const inp = (block as { input?: Record<string, unknown> }).input;
      const q = inp?.query;
      if (typeof q === "string" && q.trim()) queries.push(q.trim());
    } else if (t === "web_search_tool_result") {
      const content = (block as { content?: unknown }).content;
      if (Array.isArray(content)) {
        for (const item of content as Array<Record<string, unknown>>) {
          const url = item.url as string | undefined;
          if (!url || seenUrls.has(url)) continue;
          seenUrls.add(url);
          sources.push({
            title: (item.title as string | undefined) ?? url,
            url,
            date: (item.page_age as string | undefined) ?? undefined,
          });
        }
      }
    }
  }

  const text = textChunks.join("\n").trim();
  if (!text) throw new Error("No text content in Strategist LLM response (web search)");

  return {
    text,
    trace: {
      webSearchUsed: queries.length > 0,
      queries,
      sources,
    },
  };
}

export async function streamCallAnthropicWithSystemAndWebSearch(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (status: string) => void,
): Promise<WebSearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  // Opus 4.7 with adaptive thinking + web search can run 4-8 minutes per turn;
  // a Debate (6 turns + arbitration) easily exceeds the SDK's default 10-minute
  // socket timeout. Bump to 20 minutes per call so debates complete instead of
  // failing mid-stream with an opaque "request timed out".
  const client = new Anthropic({ apiKey, timeout: 20 * 60 * 1000 });

  const isNew = /^claude-(opus|sonnet)-4-([7-9]|\d{2,})/.test(model);
  const THINKING_BUDGET = 4096;
  const params: AnthropicMessageStreamParamsWithWebSearch = {
    model,
    max_tokens: isNew ? 16384 : THINKING_BUDGET + 12288,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
    tools: [ANTHROPIC_WEB_SEARCH_TOOL],
    stream: true,
  };
  if (isNew) {
    // Streaming + adaptive thinking: same API shape as non-streaming; SDK types omit `adaptive` here.
    params.thinking = { type: "adaptive", display: "summarized" } as Anthropic.MessageCreateParamsStreaming["thinking"];
  } else {
    params.thinking = { type: "enabled", budget_tokens: THINKING_BUDGET };
    params.temperature = 1;
  }
  void temperature;

  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  let fullText = "";

  const stream = client.messages.stream(params as Anthropic.MessageCreateParamsStreaming);
  for await (const event of stream) {
    const ev = asAnthropicStreamEvent(event);
    const evType = ev.type as string | undefined;
    if (evType === "content_block_start") {
      const block = ev.content_block as Record<string, unknown> | undefined;
      const bType = block?.type as string | undefined;
      if (bType === "server_tool_use") {
        const inp = block?.input as Record<string, unknown> | undefined;
        const q = inp?.query;
        if (typeof q === "string" && q.trim()) {
          queries.push(q.trim());
          onStatus?.(`Searching the web: "${q.trim().slice(0, 80)}"`);
        }
      } else if (bType === "web_search_tool_result") {
        const content = block?.content;
        if (Array.isArray(content)) {
          for (const item of content as Array<Record<string, unknown>>) {
            const url = item.url as string | undefined;
            if (!url || seenUrls.has(url)) continue;
            seenUrls.add(url);
            sources.push({
              title: (item.title as string | undefined) ?? url,
              url,
              date: (item.page_age as string | undefined) ?? undefined,
            });
          }
          onStatus?.(`Found ${sources.length} source${sources.length === 1 ? "" : "s"}`);
        }
      } else if (bType === "thinking") {
        onStatus?.("Reasoning…");
      } else if (bType === "text") {
        onStatus?.("Drafting recommendation…");
      }
    } else if (evType === "content_block_delta") {
      const delta = ev.delta as Record<string, unknown> | undefined;
      const dType = delta?.type as string | undefined;
      if (dType === "text_delta") {
        const txt = delta?.text as string | undefined;
        if (txt) {
          fullText += txt;
          onDelta(txt);
        }
      } else if (dType === "thinking_delta") {
        const txt = (delta?.thinking as string | undefined) ?? "";
        if (txt) onDelta(txt);
      }
    }
  }

  // Ensure final message captures any tool results we may have missed
  // via the streamed events (server_tool_use results sometimes arrive
  // batched inside the final message).
  try {
    const finalMessage = await stream.finalMessage();
    for (const block of asAnthropicContentBlocks(finalMessage.content)) {
      const t = block.type as string | undefined;
      if (t === "server_tool_use") {
        const inp = (block as { input?: Record<string, unknown> }).input;
        const q = inp?.query;
        if (typeof q === "string" && q.trim() && !queries.includes(q.trim())) {
          queries.push(q.trim());
        }
      } else if (t === "web_search_tool_result") {
        const content = (block as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const item of content as Array<Record<string, unknown>>) {
            const url = item.url as string | undefined;
            if (!url || seenUrls.has(url)) continue;
            seenUrls.add(url);
            sources.push({
              title: (item.title as string | undefined) ?? url,
              url,
              date: (item.page_age as string | undefined) ?? undefined,
            });
          }
        }
      }
    }
  } catch {
    // ignore — we already accumulated from deltas
  }

  const text = fullText.trim();
  if (!text) throw new Error("No text content in Strategist LLM response (stream)");

  return {
    text,
    trace: {
      webSearchUsed: queries.length > 0,
      queries,
      sources,
    },
  };
}

export async function callGeminiWithSystemAndWebSearch(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
): Promise<WebSearchResult> {
  if (!hasGeminiApiKey()) throw new Error("Gemini AI integration env vars not configured");

  const supportsThinking = /^gemini-(2\.5|3)/.test(model);
  // Note: Gemini does not allow responseMimeType=application/json with tools.
  const config: Record<string, unknown> = {
    maxOutputTokens: 12288,
    temperature,
    tools: [{ googleSearch: {} }],
  };
  if (supportsThinking) {
    config.thinkingConfig = { thinkingBudget: -1, includeThoughts: false };
  }
  const response = await withGeminiRetry(
    "generateContent",
    model,
    async () => {
      const ai = createGeminiClient();
      return ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + prompt }] }],
        config: config as Parameters<typeof ai.models.generateContent>[0]["config"],
      });
    },
  );

  const rawText = (response.text ?? "").trim();
  if (!rawText) throw new Error("No text content in Strategist LLM response (Gemini web search)");

  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  const geminiResponse = response as GeminiCandidateChunk;
  const candidates = geminiResponse.candidates;
  const meta = candidates?.[0]?.groundingMetadata;
  if (meta) {
    if (Array.isArray(meta.webSearchQueries)) {
      for (const q of meta.webSearchQueries) {
        if (typeof q === "string" && q.trim()) queries.push(q.trim());
      }
    }
    if (Array.isArray(meta.groundingChunks)) {
      for (const ch of meta.groundingChunks) {
        const url = ch.web?.uri;
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        sources.push({ title: ch.web?.title ?? url, url });
      }
    }
  }

  return {
    text: rawText,
    trace: {
      webSearchUsed: queries.length > 0,
      queries,
      sources,
    },
  };
}

export async function streamCallGeminiWithSystemAndWebSearch(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (status: string) => void,
): Promise<WebSearchResult> {
  if (!hasGeminiApiKey()) throw new Error("Gemini AI integration env vars not configured");

  const supportsThinking = /^gemini-(2\.5|3)/.test(model);
  const config: Record<string, unknown> = {
    maxOutputTokens: 12288,
    temperature,
    tools: [{ googleSearch: {} }],
  };
  if (supportsThinking) {
    config.thinkingConfig = { thinkingBudget: -1, includeThoughts: false };
  }

  onStatus?.("Calling Gemini with web search…");
  const { fullText, lastChunk } = await withGeminiRetry(
    "generateContentStream",
    model,
    async () => {
      const ai = createGeminiClient();
      const stream = await ai.models.generateContentStream({
        model,
        contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + prompt }] }],
        config: config as Parameters<typeof ai.models.generateContentStream>[0]["config"],
      });

      let attemptText = "";
      let attemptLastChunk: unknown = null;
      for await (const chunk of stream) {
        attemptLastChunk = chunk;
        const txt = (chunk as { text?: string }).text;
        if (txt) {
          attemptText += txt;
        }
      }
      return { fullText: attemptText, lastChunk: attemptLastChunk };
    },
  );

  if (fullText) {
    onDelta(fullText);
  }

  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();

  const lastGeminiChunk = lastChunk as GeminiCandidateChunk;
  const candidates = lastGeminiChunk.candidates;
  const meta = candidates?.[0]?.groundingMetadata;
  if (meta) {
    if (Array.isArray(meta.webSearchQueries)) {
      for (const q of meta.webSearchQueries) {
        if (typeof q === "string" && q.trim()) queries.push(q.trim());
      }
    }
    if (Array.isArray(meta.groundingChunks)) {
      for (const ch of meta.groundingChunks) {
        const url = ch.web?.uri;
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        sources.push({ title: ch.web?.title ?? url, url });
      }
    }
  }

  const text = fullText.trim();
  if (!text) throw new Error("No text content in Strategist LLM stream (Gemini)");

  return {
    text,
    trace: { webSearchUsed: queries.length > 0, queries, sources },
  };
}

// =====================================================================
// OpenAI (ChatGPT) — uses Responses API with web_search_preview tool for
// parity with Anthropic/Gemini web-search behavior. GPT-5 / o-series
// "thinking" models use the `reasoning` parameter and cannot accept a
// custom temperature (must be 1).
// =====================================================================

const OPENAI_MAX_OUTPUT_TOKENS = 16384;

function isOpenAIThinkingModel(model: string): boolean {
  // gpt-5.x family (5, 5.2, 5.4, 5.5, 5-mini, 5-nano) and o-series (o3, o4-mini)
  // use the Responses API reasoning parameter and ignore custom temperature.
  return /^gpt-5/.test(model) || /^o[34]/.test(model);
}

function makeOpenAIClient(): OpenAI {
  // User-owned billing: calls go directly to api.openai.com using the user's
  // personal OPENAI_API_KEY (NOT the Replit AI Integrations proxy).
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  // Match the 20-minute timeout we use for Anthropic — debate turns with
  // reasoning + web search can run multiple minutes per call.
  return new OpenAI({ apiKey, timeout: 20 * 60 * 1000 });
}

function buildOpenAIResponseParams(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model,
    instructions: systemPrompt,
    input: prompt,
    tools: [{ type: "web_search_preview" }],
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
  };
  if (isOpenAIThinkingModel(model)) {
    // gpt-5.5 with thinking → high reasoning effort; others → medium for
    // balanced cost/quality. Summary "auto" surfaces reasoning summaries
    // when the model emits them.
    const effort = /^gpt-5\.5/.test(model) ? "high" : "medium";
    params.reasoning = { effort, summary: "auto" };
  } else {
    params.temperature = temperature;
  }
  return params;
}

function extractOpenAIResponseTrace(
  output: unknown,
  queries: string[],
  sources: WebSearchSource[],
  seenUrls: Set<string>,
  textChunks: string[],
): void {
  if (!Array.isArray(output)) return;
  for (const item of output as Array<Record<string, unknown>>) {
    const itemType = item.type as string | undefined;
    if (itemType === "message") {
      const content = item.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const partType = part.type as string | undefined;
        if (partType === "output_text") {
          const txt = part.text as string | undefined;
          if (txt) textChunks.push(txt);
          const annotations = part.annotations as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(annotations)) {
            for (const ann of annotations) {
              if (ann.type !== "url_citation") continue;
              const url = ann.url as string | undefined;
              if (!url || seenUrls.has(url)) continue;
              seenUrls.add(url);
              sources.push({ title: (ann.title as string | undefined) ?? url, url });
            }
          }
        }
      }
    } else if (itemType === "web_search_call") {
      const action = item.action as Record<string, unknown> | undefined;
      const q = action?.query as string | undefined;
      if (typeof q === "string" && q.trim() && !queries.includes(q.trim())) {
        queries.push(q.trim());
      }
    }
  }
}

export async function callOpenAIWithSystemAndWebSearch(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
): Promise<WebSearchResult> {
  const client = makeOpenAIClient();
  const params = buildOpenAIResponseParams(model, temperature, systemPrompt, prompt);

  // OpenAI SDK types lag the Responses API surface for web_search_preview + reasoning.
  const response = await (client as OpenAIResponsesClientNonStream).responses.create(params);

  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  const textChunks: string[] = [];
  extractOpenAIResponseTrace(response.output, queries, sources, seenUrls, textChunks);

  // Fallback to convenience getter if no message blocks were parsed.
  const text = (textChunks.join("\n").trim() || (response.output_text ?? "").trim());
  if (!text) throw new Error("No text content in Strategist LLM response (OpenAI web search)");

  return {
    text,
    trace: { webSearchUsed: queries.length > 0, queries, sources },
  };
}

export async function streamCallOpenAIWithSystemAndWebSearch(
  model: string,
  temperature: number,
  systemPrompt: string,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (status: string) => void,
): Promise<WebSearchResult> {
  const client = makeOpenAIClient();
  const params = { ...buildOpenAIResponseParams(model, temperature, systemPrompt, prompt), stream: true };

  onStatus?.("Calling OpenAI with web search…");

  const stream = await (client as OpenAIResponsesClientStream).responses.create(params);

  const queries: string[] = [];
  const sources: WebSearchSource[] = [];
  const seenUrls = new Set<string>();
  let fullText = "";
  let finalResponse: unknown = null;

  for await (const event of stream) {
    const evType = event.type as string | undefined;
    if (evType === "response.output_text.delta") {
      const delta = event.delta as string | undefined;
      if (delta) {
        fullText += delta;
        onDelta(delta);
      }
    } else if (evType === "response.web_search_call.in_progress" || evType === "response.web_search_call.searching") {
      onStatus?.("Searching the web…");
    } else if (evType === "response.web_search_call.completed") {
      onStatus?.("Web search complete");
    } else if (evType === "response.reasoning_summary_text.delta") {
      // Surface reasoning summaries as status, not as text content.
      const delta = event.delta as string | undefined;
      if (delta) onStatus?.(`Reasoning: ${delta.slice(0, 80)}`);
    } else if (evType === "response.output_item.added") {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === "web_search_call") {
        onStatus?.("Searching the web…");
      } else if (item?.type === "message") {
        onStatus?.("Drafting response…");
      } else if (item?.type === "reasoning") {
        onStatus?.("Reasoning…");
      }
    } else if (evType === "response.completed") {
      finalResponse = (event as { response?: unknown }).response;
    }
  }

  // Pull queries + sources from the final response payload (annotations are
  // attached when the message item is finalized).
  if (finalResponse && typeof finalResponse === "object") {
    const output = (finalResponse as { output?: unknown }).output;
    extractOpenAIResponseTrace(output, queries, sources, seenUrls, []);
  }

  const text = fullText.trim();
  if (!text) throw new Error("No text content in Strategist LLM stream (OpenAI)");

  return {
    text,
    trace: { webSearchUsed: queries.length > 0, queries, sources },
  };
}

export const DEFAULT_UNIVERSE_SCREEN_SYSTEM_PROMPT = `You are the Senior Options Strategist for a quantitative trading desk. You are being given compact summaries for the active stock universe.

YOUR TASK: Review ALL tickers and pick the 1-3 BEST trade opportunities. You are the first filter — be selective but not overly restrictive. Good setups exist most days.

RULES:
1. You have access to the data summaries provided AND your full training knowledge. Use both to identify the most interesting setups.
2. If nothing looks compelling (no ticker has a clear edge), return an EMPTY picks array. Do NOT force a trade.
3. A "good pick" needs MULTIPLE confirming signals: unusual flow + technical setup, IV anomaly + directional catalyst, momentum + relative strength, etc.
4. Consider the current REGIME when picking. In RISK_OFF / HIGH_VOL, favor defensive or short ideas. In TRENDING_UP / LOW_VOL, favor momentum longs.
5. Avoid picking tickers that overlap with activeIdeas (already have open positions).
6. For each pick, explain WHY in 2-3 sentences citing specific data from the summary.

DATA COLUMNS:
- close: latest closing price
- return5d/return20d: 5-day and 20-day returns (decimal, e.g. 0.05 = 5%)
- volRatio: today's volume / 20-day median volume (>1.8 = spike)
- iv30d: 30-day implied volatility (null = no options data)
- ivr: IV rank 0-100 (null = no data, >60 = elevated)
- hv20d: 20-day historical volatility
- flowDirection: BULLISH/BEARISH/NEUTRAL (options flow bias)
- callPutSkew: call/put volume skew (0-1, higher = more directional)
- blockCount: number of large block trades today
- rsVsSpy5d: 5-day relative strength vs SPY (positive = outperforming)
- anomalyFlags: detected anomalies (VOL_SPIKE, IVR_HIGH, UNUSUAL_FLOW, BLOCK_ACTIVITY, MOMENTUM_UP, MOMENTUM_DOWN)

RETURN ONLY valid JSON matching this schema:
{
  "picks": [
    {
      "symbol": "AAPL",
      "direction": "LONG" | "SHORT",
      "conviction": 0-100,
      "reasoning": "string (2-3 sentences with specific data citations)"
    }
  ],
  "marketCommentary": "string (1-2 sentences on overall market tone from the data)",
  "skippedReason": null | "string (why no picks if picks is empty)"
}`;

function buildUniverseScreenPrompt(request: UniverseScreenRequest): string {
  const tickerLines = request.tickers.map(t => {
    const flags = t.anomalyFlags.length > 0 ? t.anomalyFlags.join(",") : "-";
    const iv30dStr = t.iv30d != null ? (t.iv30d * 100).toFixed(0) + "%" : "-";
    const hv20dStr = t.hv20d != null ? t.hv20d.toFixed(0) + "%" : "-";
    return `${t.symbol}|${t.close}|${(t.return5d * 100).toFixed(1)}%|${(t.return20d * 100).toFixed(1)}%|${t.volRatio.toFixed(1)}x|${iv30dStr}|${t.ivr != null ? t.ivr.toFixed(0) : "-"}|${hv20dStr}|${t.flowDirection ?? "-"}|${t.callPutSkew != null ? t.callPutSkew.toFixed(2) : "-"}|${t.blockCount ?? 0}|${t.rsVsSpy5d != null ? (t.rsVsSpy5d * 100).toFixed(1) + "%" : "-"}|${flags}`;
  }).join("\n");

  return `FULL UNIVERSE SCREEN — pick the best 1-3 trades from ${request.tickers.length} tickers.

RUN CONTEXT:
${JSON.stringify(request.runContext, null, 2)}

REGIME:
${JSON.stringify(request.regimeState, null, 2)}

ACTIVE IDEAS (avoid overlap):
${JSON.stringify(request.activeIdeasSummary, null, 2)}

TICKER DATA (symbol|close|ret5d|ret20d|volRatio|iv30d|ivr|hv20d|flowDir|cpSkew|blocks|rsVsSpy5d|flags):
${tickerLines}

Respond with ONLY the JSON object. No markdown fences, no explanation.`;
}

function validateUniverseScreenResponse(parsed: any, universeSymbols?: Set<string>): UniverseScreenResponse {
  if (!parsed || typeof parsed !== "object") throw new Error("Response is not an object");
  if (!Array.isArray(parsed.picks)) throw new Error("Missing picks array");

  const seenSymbols = new Set<string>();
  const picks = parsed.picks
    .slice(0, 3)
    .map((p: any) => {
      if (!p.symbol || typeof p.symbol !== "string") throw new Error("Pick missing symbol");
      if (!["LONG", "SHORT"].includes(p.direction)) throw new Error(`Invalid direction: ${p.direction}`);
      if (typeof p.conviction !== "number" || p.conviction < 0 || p.conviction > 100) throw new Error(`Invalid conviction: ${p.conviction}`);
      return {
        symbol: p.symbol.toUpperCase(),
        direction: p.direction as "LONG" | "SHORT",
        conviction: p.conviction,
        reasoning: typeof p.reasoning === "string" ? p.reasoning : "",
      };
    })
    .filter((p: { symbol: string }) => {
      if (seenSymbols.has(p.symbol)) return false;
      seenSymbols.add(p.symbol);
      if (universeSymbols && !universeSymbols.has(p.symbol)) return false;
      return true;
    });

  return {
    picks,
    marketCommentary: typeof parsed.marketCommentary === "string" ? parsed.marketCommentary : "",
    skippedReason: typeof parsed.skippedReason === "string" ? parsed.skippedReason : null,
  };
}

async function resolveSystemPrompt(role: "analyst" | "analyst_rebuttal" | "universe_screener", defaultPrompt: string): Promise<string> {
  const sharedCtx = await getActivePrompt("shared_context");
  const rolePrompt = await getActivePrompt(role);
  const base = rolePrompt ?? defaultPrompt;
  return sharedCtx ? `${sharedCtx}\n\n${base}` : base;
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
    const systemPrompt = await resolveSystemPrompt("analyst", DEFAULT_ANALYST_SYSTEM_PROMPT);

    let rawText: string;
    switch (this.provider) {
      case "anthropic":
        rawText = await callAnthropic(this.modelName, this.temperature, prompt, systemPrompt);
        break;
      case "google":
        rawText = await callGemini(this.modelName, this.temperature, prompt, systemPrompt);
        break;
      case "openai":
        rawText = await callOpenAI(this.modelName, this.temperature, prompt, systemPrompt);
        break;
      case "xai":
        rawText = await callXaiWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
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

  async screenUniverse(request: UniverseScreenRequest): Promise<UniverseScreenResponse> {
    const prompt = buildUniverseScreenPrompt(request);
    const universeSymbols = new Set(request.tickers.map(t => t.symbol.toUpperCase()));
    const systemPrompt = await resolveSystemPrompt("universe_screener", DEFAULT_UNIVERSE_SCREEN_SYSTEM_PROMPT);

    let rawText: string;
    switch (this.provider) {
      case "anthropic":
        rawText = await callAnthropicWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "google":
        rawText = await callGeminiWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "openai":
        rawText = await callOpenAIWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "xai":
        rawText = await callXaiWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      default:
        throw new Error(`Unsupported analyst provider: ${this.provider}`);
    }

    const cleanText = extractJson(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      logger.error({ rawSnippet: rawText.slice(0, 500) }, "AI Lab Analyst: universe screen JSON parse failure");
      throw new Error("Universe screen response is not valid JSON");
    }

    return validateUniverseScreenResponse(parsed, universeSymbols);
  }

  async rebutCritique(request: AnalystRebuttalRequest): Promise<AnalystRebuttalResponse> {
    const prompt = buildRebuttalPrompt(request);
    const systemPrompt = await resolveSystemPrompt("analyst_rebuttal", DEFAULT_ANALYST_REBUTTAL_SYSTEM_PROMPT);

    let rawText: string;
    switch (this.provider) {
      case "anthropic":
        rawText = await callAnthropicWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "google":
        rawText = await callGeminiWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "openai":
        rawText = await callOpenAIWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "xai":
        rawText = await callXaiWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
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
