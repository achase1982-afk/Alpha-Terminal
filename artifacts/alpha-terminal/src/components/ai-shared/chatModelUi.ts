import {
  ANTHROPIC_OPUS_EFFORT_LABELS,
  aiModelSelectLabel,
  isAnthropicOpusEffortModel,
  isAnthropicOpusSpeedModel,
  migrateLegacyModelIdToCatalog,
  normalizeAnthropicOpusEffort,
  type AnthropicOpusEffort,
  type AnthropicOpusSpeed,
} from "@workspace/ai-models";

/** Inner composer field (`MarketNewsChatPanel`). */
export const CHAT_COMPOSER_BOX_CLASS = "rounded-2xl border border-card-border/80 bg-[#141414]";

/** Model pill gray (`bg-white/10` on composer `#141414`). */
export const CHAT_COMPOSER_CHIP_SURFACE = "bg-white/10 hover:bg-white/15 transition-colors";

/** Model pill and round icon chips in the composer. */
export const CHAT_COMPOSER_CHIP_CLASS = `rounded-full ${CHAT_COMPOSER_CHIP_SURFACE} text-white/90`;

/**
 * Opaque pull-up sheet surface: visual match for `bg-white/10` on `#141414`
 * (pill on composer), so the menu contrasts with the black terminal chrome.
 */
export const CHAT_MODEL_SHEET_CLASS =
  "rounded-t-2xl border-t border-card-border bg-[#2b2b2b] text-white shadow-[0_-12px_40px_rgba(0,0,0,0.8)]";

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
    const speedBit = isAnthropicOpusSpeedModel(model) && args.speed === "fast" ? " · Fast" : "";
    const thinkBit = args.extendedThinking ? "" : " · No think";
    return `${short} · ${effortShort}${speedBit}${thinkBit}`;
  }
  return args.extendedThinking ? short : `${short} · No think`;
}
