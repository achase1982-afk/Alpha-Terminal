import { GoogleGenAI } from "@google/genai";

type GeminiKeySource = "AI_INTEGRATIONS_GEMINI_API_KEY" | "GEMINI_API_KEY" | "GOOGLE_API_KEY";

function getGeminiCredentials(): { apiKey: string; source: GeminiKeySource } | undefined {
  if (process.env.GEMINI_API_KEY) {
    return { apiKey: process.env.GEMINI_API_KEY, source: "GEMINI_API_KEY" };
  }
  if (process.env.GOOGLE_API_KEY) {
    return { apiKey: process.env.GOOGLE_API_KEY, source: "GOOGLE_API_KEY" };
  }
  if (process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    return { apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY, source: "AI_INTEGRATIONS_GEMINI_API_KEY" };
  }
  return undefined;
}

export function getGeminiApiKey(): string | undefined {
  return getGeminiCredentials()?.apiKey;
}

/**
 * Base URL for Gemini `generateContent` REST calls (same key as @google/genai).
 * When using Replit-style integrations, requests go through AI_INTEGRATIONS_GEMINI_BASE_URL.
 */
export function getGeminiGenerateContentBaseUrl(): string {
  const credentials = getGeminiCredentials();
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (baseUrl && credentials?.source === "AI_INTEGRATIONS_GEMINI_API_KEY") {
    return baseUrl.replace(/\/$/, "");
  }
  return "https://generativelanguage.googleapis.com";
}

export function hasGeminiApiKey(): boolean {
  return !!getGeminiApiKey();
}

export function createGeminiClient(): GoogleGenAI {
  const credentials = getGeminiCredentials();
  if (!credentials) {
    throw new Error("Gemini API key not configured");
  }

  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (baseUrl && credentials.source === "AI_INTEGRATIONS_GEMINI_API_KEY") {
    return new GoogleGenAI({ apiKey: credentials.apiKey, httpOptions: { apiVersion: "", baseUrl } });
  }

  return new GoogleGenAI({ apiKey: credentials.apiKey });
}
