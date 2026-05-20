/** Gemini 2.5+ / 3.x thinking models: dynamic budget with thought summaries. */
export function geminiThinkingConfigForModel(model: string):
  | { thinkingBudget: number; includeThoughts: boolean }
  | undefined {
  if (!/^gemini-(2\.5|3)/.test(model)) return undefined;
  return { thinkingBudget: -1, includeThoughts: true };
}
