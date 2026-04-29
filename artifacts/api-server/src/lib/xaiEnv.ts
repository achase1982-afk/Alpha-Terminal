/** xAI Grok API key — matches @ai-sdk/xai default (`XAI_API_KEY`) plus common alternate names. */
export function getXaiApiKey(): string | undefined {
  const k =
    process.env.XAI_API_KEY?.trim()
    || process.env.GROK_XAI?.trim()
    || process.env.XAI_KEY?.trim()
    || process.env.GROK_API_KEY?.trim()
    || process.env.X_AI_API_KEY?.trim();
  return k || undefined;
}
