import { GoogleGenAI } from "@google/genai";

export function getGeminiApiKey(): string | undefined {
  return (
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY
  );
}

export function hasGeminiApiKey(): boolean {
  return !!getGeminiApiKey();
}

export function createGeminiClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key not configured");
  }

  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  if (baseUrl) {
    return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "", baseUrl } });
  }

  return new GoogleGenAI({ apiKey });
}
