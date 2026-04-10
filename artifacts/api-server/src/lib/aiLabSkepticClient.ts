import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger.js";
import type {
  AiLabSkepticClient,
  SkepticRequest,
  SkepticResponse,
} from "./aiLabLlmTypes.js";
import type { AiLabModelProvider } from "./aiLabConfig.js";

const DEFAULT_SKEPTIC_MODEL = "gemini-2.5-flash";

const SKEPTIC_SYSTEM_PROMPT = `You are the Devil's Advocate on a quantitative trading desk.
Given a candidate trade idea produced by the Analyst, your job is to find weaknesses, risks, and reasons it could fail.

RULES:
- Return ONLY valid JSON matching the schema below. No markdown, no commentary outside JSON.
- critiqueScore: 0 = no concern at all, 100 = extremely dangerous idea. Be calibrated: 30-50 is typical for reasonable ideas.
- Set flags honestly. If liquidity is thin, say so. If the idea overlaps with active portfolio exposure, flag redundancy.
- Keep criticNote under 200 words. Be specific: cite data points from the snapshot.

REQUIRED JSON SCHEMA:
{
  "critiqueScore": 0-100,
  "flags": {
    "liquidityConcern": boolean,
    "regimeMismatch": boolean,
    "overfitWarning": boolean,
    "redundancyWithActiveIdeas": boolean
  },
  "criticNote": string
}`;

function buildSkepticPrompt(request: SkepticRequest): string {
  return `Critique this trade idea for ${request.symbol}.

RUN CONTEXT:
${JSON.stringify(request.runContext, null, 2)}

TICKER SNAPSHOT:
${JSON.stringify(request.tickerSnapshot, null, 2)}

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

  return parsed as SkepticResponse;
}

async function callGeminiSkeptic(model: string, temperature: number, prompt: string): Promise<string> {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("Gemini AI integration env vars not configured");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });

  const response = await ai.models.generateContent({
    model,
    contents: [
      { role: "user", parts: [{ text: SKEPTIC_SYSTEM_PROMPT + "\n\n" + prompt }] },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature,
    },
  });

  const rawText = (response.text ?? "").trim();
  if (!rawText) throw new Error("No text content in Skeptic LLM response");
  return rawText;
}

async function callAnthropicSkeptic(model: string, temperature: number, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature,
    system: SKEPTIC_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

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

    let rawText: string;
    switch (this.provider) {
      case "google":
        rawText = await callGeminiSkeptic(this.modelName, this.temperature, prompt);
        break;
      case "anthropic":
        rawText = await callAnthropicSkeptic(this.modelName, this.temperature, prompt);
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
}

export function createSkepticClient(
  provider: AiLabModelProvider = "google",
  modelName: string = DEFAULT_SKEPTIC_MODEL,
  temperature: number = 0,
): AiLabSkepticClient {
  return new ConfigurableSkepticClient(provider, modelName, temperature);
}
