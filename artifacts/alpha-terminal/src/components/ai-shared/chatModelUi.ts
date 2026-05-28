import {
  ANTHROPIC_OPUS_EFFORT_LABELS,
  aiModelSelectLabel,
  isAnthropicOpusEffortModel,
  migrateLegacyModelIdToCatalog,
  normalizeAnthropicOpusEffort,
  type AnthropicOpusEffort,
  type AnthropicOpusSpeed,
} from "@workspace/ai-models";

export function chatModelShortLabel(modelId: string): string {
  const label = aiModelSelectLabel(migrateLegacyModelIdToCatalog(modelId));
  return label
    .replace(/^Claude /, "")
    .replace(/^Gemini /, "Gemini ")
    .replace(/ \+ .+$/, "")
    .trim();
}

export function chatComposerPillLabel(args: {
  useMultiAgent: boolean;
  multiAgentCount: number;
  modelId: string;
  effort: AnthropicOpusEffort | string | undefined;
  speed: AnthropicOpusSpeed | string | undefined;
  extendedThinking: boolean;
}): string {
  if (args.useMultiAgent) {
    return `Multi · ${args.multiAgentCount || 0}`;
  }
  const model = migrateLegacyModelIdToCatalog(args.modelId);
  const short = chatModelShortLabel(model);
  if (isAnthropicOpusEffortModel(model)) {
    const effort = normalizeAnthropicOpusEffort(args.effort);
    const effortShort = ANTHROPIC_OPUS_EFFORT_LABELS[effort].split(" ")[0] ?? effort;
    const speedBit = args.speed === "fast" ? " · Fast" : "";
    const thinkBit = args.extendedThinking ? "" : " · No think";
    return `${short} · ${effortShort}${speedBit}${thinkBit}`;
  }
  return args.extendedThinking ? short : `${short} · No think`;
}
