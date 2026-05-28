import {
  ANTHROPIC_OPUS_EFFORT_LEVELS,
  ANTHROPIC_OPUS_SPEED_LEVELS,
  anthropicOpusEffortFromStrategistIdx,
  anthropicOpusSpeedFromStrategistIdx,
  isAnthropicOpusEffortModel,
  migrateLegacyModelIdToCatalog,
  type AnthropicOpusEffort,
  type AnthropicOpusSpeed,
} from "@workspace/ai-models";
import { LlmOpusOptionsFields } from "./LlmOpusOptionsFields";

type Props = {
  slotModelId: string;
  effortIdx: number;
  speedIdx: number;
  onEffortIdxChange: (idx: number) => void;
  onSpeedIdxChange: (idx: number) => void;
};

/** Opus effort/speed under a strategist model slot (maps to DB strategist settings indices). */
export function StrategistSlotOpusOptions({
  slotModelId,
  effortIdx,
  speedIdx,
  onEffortIdxChange,
  onSpeedIdxChange,
}: Props) {
  const modelId = migrateLegacyModelIdToCatalog(slotModelId);
  if (!isAnthropicOpusEffortModel(modelId)) return null;

  const effort = anthropicOpusEffortFromStrategistIdx(effortIdx);
  const speed = anthropicOpusSpeedFromStrategistIdx(speedIdx);

  const setEffort = (level: AnthropicOpusEffort) => {
    const idx = ANTHROPIC_OPUS_EFFORT_LEVELS.indexOf(level);
    if (idx >= 0) onEffortIdxChange(idx);
  };

  const setSpeed = (level: AnthropicOpusSpeed) => {
    const idx = level === "fast" ? 1 : 0;
    onSpeedIdxChange(idx);
  };

  return (
    <LlmOpusOptionsFields
      modelId={modelId}
      effort={effort}
      speed={speed}
      onEffortChange={setEffort}
      onSpeedChange={setSpeed}
      className="pt-1 pb-2 pl-0 sm:pl-1"
    />
  );
}
