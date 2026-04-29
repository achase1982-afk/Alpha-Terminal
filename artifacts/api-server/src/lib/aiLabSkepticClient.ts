import Anthropic from "@anthropic-ai/sdk";
import { callOpenAIWithSystem, callXaiWithSystem } from "./aiLabAnalystClient.js";
import { createGeminiClient, getGeminiApiKey } from "./geminiClient.js";
import { logger } from "./logger.js";
import type {
  AiLabSkepticClient,
  SkepticRequest,
  SkepticResponse,
  SkepticReEvalRequest,
  SkepticReEvalResponse,
} from "./aiLabLlmTypes.js";
import { type AiLabModelProvider, getActivePrompt } from "./aiLabConfig.js";

const DEFAULT_SKEPTIC_MODEL = "gemini-3.1-pro-preview";

/** Shape of `tickerSnapshot.optionsChainSummary` when Polygon chain data exists. */
interface OptionsChainSummaryAvailable {
  available: boolean;
}

export const DEFAULT_SKEPTIC_SYSTEM_PROMPT = `You are the Devil's Advocate on a quantitative trading desk.
Given a candidate trade idea produced by the Analyst, your job is to find weaknesses, risks, and reasons it could fail.

OPTIONS-AWARENESS:
Alpha Terminal is options-first. When critiquing:
- If the Analyst proposed options, challenge the structure: Is IV too high (crush risk)? Are spreads too wide? Is OI/volume sufficient? Could a different structure (spread vs naked, different expiry) reduce risk?
- If the Analyst chose equity over options, evaluate whether that choice is justified — challenge it if liquid options exist.
- Consider event risk (earnings, ex-div, FOMC) relative to the chosen expiry.
- Evaluate sizing relative to conviction and vol environment.

RULES:
- Return ONLY valid JSON matching the schema below. No markdown, no commentary outside JSON.
- critiqueScore: 0 = no concern at all, 100 = extremely dangerous idea. Be calibrated: 30-50 is typical for reasonable ideas.
- Set flags honestly. If liquidity is thin, say so. If the idea overlaps with active portfolio exposure, flag redundancy.
- Keep criticNote under 200 words. Be specific: cite data points from the snapshot (IV levels, flow skew, spread widths, OI, volume ratios).
- skepticCritique must be fully filled in:
  - objections: concrete critiques (fundamental, technical, vol, event risk, sizing, timing).
  - evidence: references to data or context (upcoming earnings, SEC filing issues, stretched chart, IV crush risk, conflicting flow, spread width, low OI).
  - suggestedChanges: explicit action recommendations such as "kill this idea," "reduce size," "switch to defined-risk spread," "wait until after event," "change target/stop," or "use equity instead."

REQUIRED JSON SCHEMA:
{
  "critiqueScore": 0-100,
  "flags": {
    "liquidityConcern": boolean,
    "regimeMismatch": boolean,
    "overfitWarning": boolean,
    "redundancyWithActiveIdeas": boolean
  },
  "criticNote": string,
  "skepticCritique": {
    "objections": string,
    "evidence": string,
    "suggestedChanges": string
  }
}`;

export const DEFAULT_SKEPTIC_REEVAL_SYSTEM_PROMPT = `You are the Devil's Advocate on a quantitative trading desk, engaged in an ongoing deliberation with the Analyst.

The Analyst has responded to your critique — they may have defended their position, made concessions, or modified their trade idea. Your job is to re-evaluate.

You must decide:
1. SATISFIED — the Analyst addressed your concerns adequately (either with solid rebuttals or meaningful modifications). Set satisfiedWithChanges=true.
2. STILL CONCERNED — the Analyst hasn't addressed your core objections. Explain what remains unresolved and give an updated critiqueScore. Keep pushing.
3. AGREE TO PROCEED — even if you have minor concerns, the idea is good enough. Set satisfiedWithChanges=true and note remaining minor concerns.

The goal is to reach consensus. Don't be stubborn for the sake of it — if the Analyst made a good case, acknowledge it. But don't cave if there are real risks.

RULES:
- Return ONLY valid JSON matching the schema below. No markdown, no commentary outside JSON.
- critiqueScore: 0-100. Should reflect your UPDATED assessment after the Analyst's response.
- satisfiedWithChanges: true if you're ready to let this proceed (with or without minor caveats).
- remainingConcerns: what's still bothering you (or "None — satisfied with the revised proposal").

REQUIRED JSON SCHEMA:
{
  "critiqueScore": 0-100,
  "flags": {
    "liquidityConcern": boolean,
    "regimeMismatch": boolean,
    "overfitWarning": boolean,
    "redundancyWithActiveIdeas": boolean
  },
  "criticNote": string,
  "skepticCritique": {
    "objections": string,
    "evidence": string,
    "suggestedChanges": string
  },
  "satisfiedWithChanges": boolean,
  "remainingConcerns": string
}`;

function buildReEvalPrompt(request: SkepticReEvalRequest): string {
  const historyStr = request.conversationHistory.map(t =>
    `[Round ${t.round} — ${t.role.toUpperCase()}]: ${t.content.note}`
  ).join("\n\n");

  return `DELIBERATION ROUND ${request.round} — Re-evaluate the Analyst's response for ${request.symbol}.

RUN CONTEXT:
${JSON.stringify(request.runContext, null, 2)}

TICKER SNAPSHOT:
${JSON.stringify(request.tickerSnapshot, null, 2)}

REGIME STATE:
${JSON.stringify(request.regimeState, null, 2)}

ANALYST'S REVISED IDEA:
${JSON.stringify(request.revisedIdea, null, 2)}

ANALYST'S REBUTTAL:
${request.analystRebuttal.rebuttalNote}

ANALYST'S CONCESSIONS: ${request.analystRebuttal.concessions}
CHANGES FROM PREVIOUS: ${request.analystRebuttal.changesFromPrevious}
ANALYST AGREES TO WITHDRAW: ${request.analystRebuttal.agreesWithSkeptic}

FULL CONVERSATION:
${historyStr}

Respond with ONLY the JSON object. No markdown fences, no explanation.`;
}

function validateReEvalResponse(parsed: any): SkepticReEvalResponse {
  const base = validateSkepticResponse(parsed);
  return {
    ...base,
    satisfiedWithChanges: typeof parsed.satisfiedWithChanges === "boolean" ? parsed.satisfiedWithChanges : false,
    remainingConcerns: typeof parsed.remainingConcerns === "string" ? parsed.remainingConcerns : base.criticNote,
  };
}

function buildSkepticPrompt(request: SkepticRequest): string {
  const snap = request.tickerSnapshot as Record<string, unknown>;
  const optionsChain = snap.optionsChainSummary ?? null;
  const snapshotWithoutChain = { ...snap };
  delete snapshotWithoutChain.optionsChainSummary;

  let optionsSection = "";
  if (optionsChain && typeof optionsChain === "object" && (optionsChain as OptionsChainSummaryAvailable).available) {
    optionsSection = `\nLIVE OPTIONS CHAIN SUMMARY (from Polygon):\n${JSON.stringify(optionsChain, null, 2)}\n`;
  } else {
    optionsSection = `\nLIVE OPTIONS CHAIN: Not available (options market may be closed or no data).\n`;
  }

  return `Critique this trade idea for ${request.symbol}.

RUN CONTEXT:
${JSON.stringify(request.runContext, null, 2)}

TICKER SNAPSHOT:
${JSON.stringify(snapshotWithoutChain, null, 2)}
${optionsSection}
REGIME STATE:
${JSON.stringify(request.regimeState, null, 2)}

CANDIDATE IDEA (from Analyst):
${JSON.stringify(request.candidateIdea, null, 2)}

Respond with ONLY the JSON object. No markdown fences, no explanation.`;
}

function validateSkepticResponse(parsed: any): SkepticResponse {
  if (!parsed || typeof parsed !== "object") throw new Error("Response is not an object");

  if (typeof parsed.critiqueScore !== "number" || parsed.critiqueScore < 0 || parsed.critiqueScore > 100)
    throw new Error(`Invalid critiqueScore: ${parsed.critiqueScore}`);

  const flags = parsed.flags;
  if (!flags || typeof flags !== "object") throw new Error("Missing flags");
  if (typeof flags.liquidityConcern !== "boolean") throw new Error("Invalid flags.liquidityConcern");
  if (typeof flags.regimeMismatch !== "boolean") throw new Error("Invalid flags.regimeMismatch");
  if (typeof flags.overfitWarning !== "boolean") throw new Error("Invalid flags.overfitWarning");
  if (typeof flags.redundancyWithActiveIdeas !== "boolean") throw new Error("Invalid flags.redundancyWithActiveIdeas");

  if (typeof parsed.criticNote !== "string") throw new Error("Missing criticNote");

  if (!parsed.skepticCritique || typeof parsed.skepticCritique !== "object") {
    parsed.skepticCritique = {
      objections: parsed.criticNote,
      evidence: "See criticNote above.",
      suggestedChanges: parsed.critiqueScore >= 60 ? "Consider reducing size or waiting for confirmation." : "Proceed with standard risk management.",
    };
  } else {
    if (typeof parsed.skepticCritique.objections !== "string") parsed.skepticCritique.objections = parsed.criticNote;
    if (typeof parsed.skepticCritique.evidence !== "string") parsed.skepticCritique.evidence = "No specific evidence cited.";
    if (typeof parsed.skepticCritique.suggestedChanges !== "string") parsed.skepticCritique.suggestedChanges = "N/A";
  }

  return parsed as SkepticResponse;
}

async function callGeminiSkeptic(model: string, temperature: number, prompt: string, systemPrompt: string): Promise<string> {
  return callGeminiWithSystem(model, temperature, systemPrompt, prompt);
}

async function callGeminiWithSystem(model: string, temperature: number, systemPrompt: string, prompt: string): Promise<string> {
  if (!getGeminiApiKey()) throw new Error("Gemini API key not configured");
  const ai = createGeminiClient();

  const supportsThinking = /^gemini-(2\.5|3)/.test(model);
  const config: Record<string, unknown> = {
    responseMimeType: "application/json",
    maxOutputTokens: 8192,
    temperature,
  };
  if (supportsThinking) {
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
  if (!rawText) throw new Error("No text content in Skeptic LLM response");
  return rawText;
}

async function callAnthropicSkeptic(model: string, temperature: number, prompt: string, systemPrompt: string): Promise<string> {
  return callAnthropicWithSystem(model, temperature, systemPrompt, prompt);
}

async function callAnthropicWithSystem(model: string, temperature: number, systemPrompt: string, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const isNew = /^claude-(opus|sonnet)-4-([7-9]|\d{2,})/.test(model);
  const THINKING_BUDGET = 4096;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: isNew ? 12288 : THINKING_BUDGET + 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  };
  if (isNew) {
    // Anthropic Messages API adaptive thinking shape; SDK `thinking` union lags the API.
    params.thinking = { type: "adaptive", display: "summarized" } as Anthropic.MessageCreateParamsNonStreaming["thinking"];
  } else {
    params.thinking = { type: "enabled", budget_tokens: THINKING_BUDGET };
    params.temperature = 1;
  }
  void temperature;
  const message = await client.messages.create(params);

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text content in Skeptic LLM response (Anthropic)");
  }
  return textBlock.text.trim();
}

function extractJson(rawText: string): string {
  let text = rawText;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  return text;
}

async function resolveSkepticPrompt(role: "skeptic" | "skeptic_reeval", defaultPrompt: string): Promise<string> {
  const sharedCtx = await getActivePrompt("shared_context");
  const rolePrompt = await getActivePrompt(role);
  const base = rolePrompt ?? defaultPrompt;
  return sharedCtx ? `${sharedCtx}\n\n${base}` : base;
}

export class ConfigurableSkepticClient implements AiLabSkepticClient {
  readonly modelName: string;
  private provider: AiLabModelProvider;
  private temperature: number;

  constructor(provider: AiLabModelProvider, modelName: string, temperature: number) {
    this.provider = provider;
    this.modelName = modelName;
    this.temperature = temperature;
  }

  async critiqueIdea(request: SkepticRequest): Promise<SkepticResponse> {
    const prompt = buildSkepticPrompt(request);
    const systemPrompt = await resolveSkepticPrompt("skeptic", DEFAULT_SKEPTIC_SYSTEM_PROMPT);

    let rawText: string;
    switch (this.provider) {
      case "google":
        rawText = await callGeminiSkeptic(this.modelName, this.temperature, prompt, systemPrompt);
        break;
      case "anthropic":
        rawText = await callAnthropicSkeptic(this.modelName, this.temperature, prompt, systemPrompt);
        break;
      case "openai":
        rawText = await callOpenAIWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "xai":
        rawText = await callXaiWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      default:
        throw new Error(`Unsupported skeptic provider: ${this.provider}`);
    }

    const cleanText = extractJson(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      logger.error({ rawSnippet: rawText.slice(0, 500) }, "AI Lab Skeptic: JSON parse failure");
      throw new Error("Skeptic response is not valid JSON");
    }

    return validateSkepticResponse(parsed);
  }

  async reEvaluate(request: SkepticReEvalRequest): Promise<SkepticReEvalResponse> {
    const prompt = buildReEvalPrompt(request);
    const systemPrompt = await resolveSkepticPrompt("skeptic_reeval", DEFAULT_SKEPTIC_REEVAL_SYSTEM_PROMPT);

    let rawText: string;
    switch (this.provider) {
      case "google":
        rawText = await callGeminiWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "anthropic":
        rawText = await callAnthropicWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "openai":
        rawText = await callOpenAIWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      case "xai":
        rawText = await callXaiWithSystem(this.modelName, this.temperature, systemPrompt, prompt);
        break;
      default:
        throw new Error(`Unsupported skeptic provider: ${this.provider}`);
    }

    const cleanText = extractJson(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      logger.error({ rawSnippet: rawText.slice(0, 500) }, "AI Lab Skeptic: reEval JSON parse failure");
      throw new Error("Skeptic re-evaluation response is not valid JSON");
    }

    return validateReEvalResponse(parsed);
  }
}

export function createSkepticClient(
  provider: AiLabModelProvider = "google",
  modelName: string = DEFAULT_SKEPTIC_MODEL,
  temperature: number = 0,
): AiLabSkepticClient {
  return new ConfigurableSkepticClient(provider, modelName, temperature);
}
