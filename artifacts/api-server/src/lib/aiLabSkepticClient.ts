import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger.js";
import type {
  AiLabSkepticClient,
  SkepticRequest,
  SkepticResponse,
} from "./aiLabLlmTypes.js";

const SKEPTIC_MODEL = "gemini-2.5-flash";

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

export class GeminiSkepticClient implements AiLabSkepticClient {
  readonly modelName = SKEPTIC_MODEL;
  private ai: GoogleGenAI | null = null;

  private getAi(): GoogleGenAI {
    if (!this.ai) {
      const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
      const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
      if (!baseUrl || !apiKey) throw new Error("Gemini AI integration env vars not configured");
      this.ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
    }
    return this.ai;
  }

  async critiqueIdea(request: SkepticRequest): Promise<SkepticResponse> {
    const prompt = buildSkepticPrompt(request);
    const ai = this.getAi();

    const response = await ai.models.generateContent({
      model: this.modelName,
      contents: [
        { role: "user", parts: [{ text: SKEPTIC_SYSTEM_PROMPT + "\n\n" + prompt }] },
      ],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
      },
    });

    const rawText = (response.text ?? "").trim();
    if (!rawText) {
      throw new Error("No text content in Skeptic LLM response");
    }

    let cleanText = rawText;
    const fenceMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleanText = fenceMatch[1].trim();

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

export function createSkepticClient(): AiLabSkepticClient {
  return new GeminiSkepticClient();
}
